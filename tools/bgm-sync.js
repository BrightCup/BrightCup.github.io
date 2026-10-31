#!/usr/bin/env node
/**
 * 把 queue.json 里排队的改动写回 Bangumi。由 GitHub Actions 调用，不在浏览器里跑。
 *
 * 队列格式（source/_data/bangumis/queue.json）：
 *   { "updatedAt": "...", "ops": { "<subjectId>": { type, rate, comment, watched: [epId], at } } }
 *
 * 每个 op 做两件事：
 *   1. POST /v0/users/-/collections/{id}          改收藏状态 / 评分 / 短评
 *   2. PATCH 同上 + /episodes                      勾选分集（type 2 = 看过，0 = 取消）
 * 注意：动画的 ep_status 不能用收藏接口直接改（文档写明那个字段只对书籍有效），
 * 必须通过分集接口标记，Bangumi 会自己重算完成度。
 *
 * 跑完把成功的 op 从队列里删掉，失败的原样留下等下次重试，并写一份 sync-log.json。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { loadToken, saveToken } = require('./bgm-token');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'source', '_data', 'bangumis');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const LOG_FILE = path.join(DATA_DIR, 'sync-log.json');

const API = 'https://api.bgm.tv';
const TOKEN_URL = 'https://bgm.tv/oauth/access_token';
const UA = 'BrightCup-blog/1.0 (https://github.com/BrightCup)';

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

async function api(token, method, pathname, body) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(API + pathname, {
      method: method,
      headers: {
        'User-Agent': UA,
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });

    if (res.status === 429 && attempt === 0) {
      await new Promise(function (r) { setTimeout(r, 3000); });
      continue;
    }
    if (res.status === 204) return null;

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = null; }

    if (!res.ok) {
      const detail = data && (data.description || data.message || data.title);
      throw new Error('HTTP ' + res.status + (detail ? ' ' + detail : ''));
    }
    return data;
  }
  throw new Error('请求被限流');
}

/** 换 access_token（refresh_token 会轮换，因此每次都要写回） */
async function refreshToken(token, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: token.refresh_token,
    redirect_uri: process.env.BGM_REDIRECT_URI || 'https://brightcup.github.io/bangumi-auth/'
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: body.toString(),
    signal: AbortSignal.timeout(20000)
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('刷新 token 时返回了非 JSON：' + text.slice(0, 200));
  }
  if (!res.ok || !data.access_token) {
    throw new Error('刷新 token 失败（HTTP ' + res.status + '）：' +
      (data.error_description || text.slice(0, 200)));
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || token.refresh_token,
    token_type: data.token_type || 'Bearer',
    scope: data.scope || token.scope || '',
    user_id: data.user_id || token.user_id || null,
    expires_at: Date.now() + (Number(data.expires_in) || 604800) * 1000
  };
}

/** 拉取某条目下每集的收藏状态 */
async function fetchEpisodeState(token, subjectId) {
  const map = {};
  const limit = 1000;
  for (let offset = 0; offset < 5000; offset += limit) {
    const page = await api(token, 'GET',
      '/v0/users/-/collections/' + subjectId + '/episodes?limit=' + limit + '&offset=' + offset);
    if (!page || !Array.isArray(page.data) || !page.data.length) break;
    page.data.forEach(function (row) {
      const ep = row.episode || {};
      if (ep.id != null) map[ep.id] = row.type;
    });
    if (page.data.length < limit) break;
  }
  return map;
}

async function applyOp(token, subjectId, op) {
  // 1) 收藏状态 / 评分 / 短评
  await api(token, 'POST', '/v0/users/-/collections/' + subjectId, {
    type: op.type,
    rate: op.rate || 0,
    comment: op.comment || ''
  });

  // 2) 分集（没勾选信息就跳过）
  if (!Array.isArray(op.watched)) return { eps: 0 };

  const current = await fetchEpisodeState(token, subjectId);
  const wanted = op.watched.map(Number).filter(function (id) { return Number.isFinite(id); });
  const wantedSet = new Set(wanted);

  const toMark = wanted.filter(function (id) { return current[id] !== 2; });
  const toClear = Object.keys(current)
    .map(Number)
    .filter(function (id) { return current[id] === 2 && !wantedSet.has(id); });

  if (toMark.length) {
    await api(token, 'PATCH', '/v0/users/-/collections/' + subjectId + '/episodes',
      { episode_id: toMark, type: 2 });
  }
  if (toClear.length) {
    await api(token, 'PATCH', '/v0/users/-/collections/' + subjectId + '/episodes',
      { episode_id: toClear, type: 0 });
  }
  return { eps: toMark.length + toClear.length };
}

async function main() {
  if (!fs.existsSync(QUEUE_FILE)) {
    console.log('[sync] 没有队列文件，跳过');
    return;
  }

  const queue = readJSON(QUEUE_FILE, { ops: {} });
  const ids = Object.keys(queue.ops || {});
  if (!ids.length) {
    console.log('[sync] 队列为空，跳过');
    return;
  }

  const clientId = (process.env.BGM_CLIENT_ID || '').trim();
  const clientSecret = (process.env.BGM_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('缺少 BGM_CLIENT_ID / BGM_CLIENT_SECRET');

  let token = loadToken();
  if (!token.expires_at || token.expires_at - Date.now() < 5 * 60 * 1000) {
    console.log('[sync] access_token 快过期了，先刷新');
    token = await refreshToken(token, clientId, clientSecret);
    saveToken(token);
  }

  const log = readJSON(LOG_FILE, { results: {} });
  log.results = log.results || {};

  let ok = 0;
  let failed = 0;

  for (const id of ids) {
    const op = queue.ops[id];
    try {
      const res = await applyOp(token, id, op);
      delete queue.ops[id];
      log.results[id] = { ok: true, at: new Date().toISOString(), eps: res.eps };
      ok += 1;
      console.log('[sync] #' + id + ' 成功（分集变动 ' + res.eps + '）');
    } catch (err) {
      failed += 1;
      log.results[id] = { ok: false, at: new Date().toISOString(), error: err.message };
      console.warn('[sync] #' + id + ' 失败：' + err.message);
    }
  }

  // 只留最近 200 条日志
  const keys = Object.keys(log.results);
  if (keys.length > 200) {
    keys
      .sort(function (a, b) { return (log.results[a].at || '').localeCompare(log.results[b].at || ''); })
      .slice(0, keys.length - 200)
      .forEach(function (k) { delete log.results[k]; });
  }
  log.updatedAt = new Date().toISOString();

  writeJSON(QUEUE_FILE, {
    updatedAt: new Date().toISOString(),
    ops: queue.ops
  });
  writeJSON(LOG_FILE, log);

  console.log('[sync] 完成：成功 ' + ok + '，失败 ' + failed + '，队列剩余 ' + Object.keys(queue.ops).length);
  if (failed && !ok) throw new Error('全部失败，检查授权或 token 是否过期');
}

main().catch(function (err) {
  console.error('[sync] ' + err.message);
  process.exit(1);
});
