#!/usr/bin/env node
/**
 * 拉取「分集列表」与「我的收藏进度」，给番剧详情页用。
 *
 * 为什么需要它：
 * - hexo-bangumis 写进 bangumis.json 的字段里没有 ep_status / rate / comment，
 *   所以站点原本只能知道「收藏了哪些番」，不知道「看到第几集」。
 * - /v0/users/{uid}/collections 这个公开接口其实带 ep_status、rate、comment，
 *   只是插件丢掉了。这里单独抓一份，一次分页请求就能拿到全部 149 部。
 * - 分集标题/放送日期在 /v0/episodes?subject_id=X，需要逐部抓，因此做增量缓存。
 *
 * 输出：
 * - source/_data/bangumis/progress.json  { "<subjectId>": { type, rate, ep_status, comment, updated_at } }
 * - source/_data/bangumis/episodes.json  { "<subjectId>": { fetchedAt, eps: [{ id, sort, name, airdate }] } }
 *
 * 设计要点与 fetch-bangumi-infobox.js 一致：
 * - 镜像优先、主站兜底；任何异常只告警，退出码始终 0，不拖垮 CI
 * - 增量：progress 每次全量（1~4 个请求），episodes 只补缺失或需要刷新的
 * - 内容无变化时不落盘
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'source', '_data', 'bangumis');
const LIST_FILE = path.join(DATA_DIR, 'bangumis.json');
const INFO_FILE = path.join(DATA_DIR, 'infobox.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const EPISODES_FILE = path.join(DATA_DIR, 'episodes.json');
const CONFIG_FILE = path.join(ROOT, '_config.yml');

const BASES = ['https://bgmapi.anibt.net', 'https://api.bgm.tv'];
const UA = 'BrightCup-blog/1.0 (https://github.com/BrightCup)';
const CONCURRENCY = 4;
const TIMEOUT_MS = 15000;

// 连载中的番剧，分集表可能随时新增，缓存超过这个时长就重抓
const AIRING_TTL_MS = 48 * 60 * 60 * 1000;

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    return fallback;
  }
}

function writeIfChanged(file, text) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  if (prev === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf-8');
  return true;
}

/** 从 _config.yml 取 bgmtv_uid（不引 yaml 依赖，正则足够） */
function readUid() {
  try {
    const text = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const m = /^\s*bgmtv_uid:\s*['"]?(\d+)['"]?(?:\s*#.*)?$/m.exec(text);
    if (m) return m[1];
  } catch (err) {
    /* ignore */
  }
  return null;
}

/** 从 bangumis.json 收集全部条目（保留 id、话数、开播日，供缓存判定使用） */
function collectSubjects(data) {
  const out = [];
  const seen = new Set();
  ['wantWatch', 'watching', 'watched'].forEach(function (key) {
    (data[key] || []).forEach(function (item) {
      if (!item || item.id == null || seen.has(item.id)) return;
      seen.add(item.id);
      out.push({ id: item.id, eps: Number(item.eps) || 0, date: item.date || '' });
    });
  });
  return out;
}

async function getJSON(pathname) {
  let lastErr = null;
  for (const base of BASES) {
    try {
      const res = await fetch(base + pathname, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (res.status === 404) return null;
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('unknown error');
}

async function mapPool(items, size, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(size, items.length)).fill(0).map(async function () {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---------- 我的收藏进度（公开接口，一次分页拿全） ----------

async function fetchProgress(uid) {
  const map = {};
  const limit = 50;
  for (let offset = 0; offset < 2000; offset += limit) {
    const page = await getJSON(
      '/v0/users/' + encodeURIComponent(uid) +
      '/collections?subject_type=2&limit=' + limit + '&offset=' + offset
    );
    if (!page || !Array.isArray(page.data) || !page.data.length) break;
    page.data.forEach(function (row) {
      const subject = row.subject || {};
      if (!subject.id) return;
      map[subject.id] = {
        type: row.type,
        rate: row.rate || 0,
        ep_status: row.ep_status || 0,
        comment: row.comment || '',
        updated_at: row.updated_at || ''
      };
    });
    if (page.data.length < limit) break;
  }
  return map;
}

// ---------- 分集列表 ----------

async function fetchEpisodes(subjectId) {
  const eps = [];
  const limit = 100;
  for (let offset = 0; offset < 2000; offset += limit) {
    const page = await getJSON(
      '/v0/episodes?subject_id=' + subjectId + '&type=0&limit=' + limit + '&offset=' + offset
    );
    if (!page || !Array.isArray(page.data) || !page.data.length) break;
    page.data.forEach(function (ep) {
      eps.push({
        id: ep.id,
        sort: ep.sort == null ? 0 : ep.sort,
        name: ep.name_cn || ep.name || '',
        airdate: ep.airdate || ''
      });
    });
    if (page.data.length < limit) break;
  }
  eps.sort(function (a, b) { return Number(a.sort) - Number(b.sort) || a.id - b.id; });
  return eps;
}

/** 是否需要重抓：缺失 / 集数不足 / 连载中且缓存过期 */
function needsFetch(subject, cached, now, info) {
  if (!cached || !Array.isArray(cached.eps) || !cached.eps.length) return true;
  if (subject.eps > 0 && cached.eps.length < subject.eps) return true;
  if (subject.eps === 0 && cached.eps.length === 0) return true;

  // 已完结（infobox 有播放结束，或开播超过一年）就不必再刷
  const meta = info[subject.id] || {};
  if (meta['播放结束']) return false;
  if (subject.date && now - Date.parse(subject.date) > 400 * 24 * 60 * 60 * 1000) return false;

  const ttl = Number(subject.eps) > 0 && subject.eps <= cached.eps.length ? 7 * 24 * 60 * 60 * 1000 : AIRING_TTL_MS;
  return !cached.fetchedAt || now - Date.parse(cached.fetchedAt) > ttl;
}

async function main() {
  if (!fs.existsSync(LIST_FILE)) {
    console.log('[episodes] 未找到 bangumis.json，跳过（先执行 `hexo bangumis -u`）');
    return;
  }

  const uid = readUid();
  const subjects = collectSubjects(readJSON(LIST_FILE, {}));
  const info = readJSON(INFO_FILE, {});
  const now = Date.now();

  // 1) 进度
  if (uid) {
    try {
      const progress = await fetchProgress(uid);
      const ordered = {};
      subjects.forEach(function (s) { if (progress[s.id]) ordered[s.id] = progress[s.id]; });
      const changed = writeIfChanged(PROGRESS_FILE, JSON.stringify(ordered, null, 2) + '\n');
      console.log('[episodes] 进度 ' + Object.keys(ordered).length + ' 条' + (changed ? '（已更新）' : '（无变化）'));
    } catch (err) {
      console.warn('[episodes] 收藏进度拉取失败，沿用旧缓存：' + err.message);
    }
  } else {
    console.warn('[episodes] _config.yml 里没有 bgmtv_uid，跳过进度拉取');
  }

  // 2) 分集
  const cache = readJSON(EPISODES_FILE, {});
  const todo = subjects.filter(function (s) { return needsFetch(s, cache[s.id], now, info); });
  console.log('[episodes] 番剧 ' + subjects.length + ' 部，缓存有效 ' + (subjects.length - todo.length) + '，待抓取 ' + todo.length);

  let failed = 0;
  await mapPool(todo, CONCURRENCY, async function (subject) {
    try {
      const eps = await fetchEpisodes(subject.id);
      if (!eps.length) return;
      cache[subject.id] = { fetchedAt: new Date().toISOString(), eps: eps };
    } catch (err) {
      failed += 1;
      console.warn('[episodes] subject/' + subject.id + ' 获取失败：' + err.message);
    }
  });

  // 只保留当前收藏里的条目，按列表顺序输出，保证 diff 稳定
  const orderedEps = {};
  subjects.forEach(function (s) { if (cache[s.id]) orderedEps[s.id] = cache[s.id]; });
  const changed = writeIfChanged(EPISODES_FILE, JSON.stringify(orderedEps, null, 2) + '\n');
  console.log('[episodes] 分集缓存 ' + Object.keys(orderedEps).length + ' 部' + (changed ? '（已更新）' : '（无变化）'));
  if (failed) console.warn('[episodes] 有 ' + failed + ' 部抓取失败，下次构建会自动重试');
}

if (require.main === module) {
  main().catch(function (err) {
    console.warn('[episodes] 跳过：' + err.message);
  });
}

module.exports = { main, fetchEpisodes, fetchProgress, collectSubjects };
