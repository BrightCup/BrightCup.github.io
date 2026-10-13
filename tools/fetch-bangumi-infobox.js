#!/usr/bin/env node
/**
 * 拉取番剧详情里我们关心的信息（放送时间 / 制作阵容）并缓存到
 * source/_data/bangumis/infobox.json。
 *
 * 为什么需要它：hexo-bangumis 写进 bangumis.json 的字段只有
 * id / name / type / image / eps / date / summary / collection / rating，
 * 没有「放送星期」「播放结束」「动画制作」「导演」这些。这些信息在
 * /v0/subjects/{id} 的 infobox 里，因此单独抓一份缓存下来。
 *
 * 设计要点：
 * - 幂等 + 增量：已缓存的 id 不再请求，只抓新增的收藏（每天定时构建时通常只有几部）
 * - 双源容错：镜像 bgmapi.anibt.net 优先（国内可直连），失败退回主站 api.bgm.tv
 * - 永不失败：任何异常都只打警告，退出码始终为 0，不会拖垮 CI 部署
 * - 写文件前比较内容，无变化时不落盘（避免无意义地改动工作区）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'source', '_data', 'bangumis');
const LIST_FILE = path.join(DATA_DIR, 'bangumis.json');
const OUT_FILE = path.join(DATA_DIR, 'infobox.json');

// 镜像优先，主站兜底
const BASES = ['https://bgmapi.anibt.net', 'https://api.bgm.tv'];
const UA = 'BrightCup-blog/1.0 (https://github.com/BrightCup)';
const CONCURRENCY = 4;
const TIMEOUT_MS = 15000;

// 保留的 infobox 字段（数组顺序 = 页面上的展示优先级）
const FIELDS = [
  '放送开始', '放送星期', '播放结束', '话数',
  '播放电视台', '其他电视台', '在线播放平台',
  '动画制作', '导演', '系列构成', '脚本', '人物设定', '音乐',
  '主题歌演出', '原作', '製作', '官方网站'
];

const FIELD_SET = new Set(FIELDS);

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    return fallback;
  }
}

/** 从 bangumis.json 中收集全部番剧 id（保持列表顺序） */
function collectIds(data) {
  const ids = [];
  const seen = new Set();
  ['wantWatch', 'watching', 'watched'].forEach(function (key) {
    (data[key] || []).forEach(function (item) {
      if (item && item.id != null && !seen.has(item.id)) {
        seen.add(item.id);
        ids.push(item.id);
      }
    });
  });
  return ids;
}

/** infobox 的 value 可能是字符串，也可能是 [{v}] 数组 */
function normalizeValue(value) {
  let text;
  if (Array.isArray(value)) {
    text = value
      .map(function (v) { return v && v.v != null ? String(v.v) : ''; })
      .filter(Boolean)
      .join(' / ');
  } else if (value == null) {
    text = '';
  } else {
    text = String(value);
  }
  return text.replace(/\s+/g, ' ').trim();
}

function extractInfo(detail) {
  const out = {};
  (detail.infobox || []).forEach(function (entry) {
    const key = entry && entry.key;
    if (!FIELD_SET.has(key)) return;
    const text = normalizeValue(entry.value);
    if (text) out[key] = text;
  });
  return out;
}

async function fetchDetail(id) {
  let lastErr = null;
  for (const base of BASES) {
    try {
      const res = await fetch(base + '/v0/subjects/' + id, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (res.status === 404) return { detail: null, permanent: true };
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
      return { detail: await res.json(), permanent: false };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('unknown error');
}

/** 简单并发池 */
async function mapPool(items, size, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(size, items.length)).fill(0).map(async function () {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  if (!fs.existsSync(LIST_FILE)) {
    console.log('[infobox] 未找到 bangumis.json，跳过（先执行 `hexo bangumis -u`）');
    return;
  }

  const ids = collectIds(readJSON(LIST_FILE, {}));
  const cache = readJSON(OUT_FILE, {});
  const todo = ids.filter(function (id) { return !cache[id]; });

  console.log('[infobox] 番剧总数 ' + ids.length + '，已缓存 ' + (ids.length - todo.length) + '，待抓取 ' + todo.length);

  let failed = 0;
  const fetched = await mapPool(todo, CONCURRENCY, async function (id) {
    try {
      const res = await fetchDetail(id);
      if (res.detail === null) {
        // 条目不存在/已删除：写入空对象，避免每次构建重复请求
        cache[id] = {};
        return;
      }
      cache[id] = extractInfo(res.detail);
    } catch (err) {
      failed += 1;
      console.warn('[infobox] subject/' + id + ' 获取失败：' + err.message);
    }
  });
  void fetched;

  // 按 bangumis.json 的顺序重排，保持文件 diff 稳定
  const ordered = {};
  ids.forEach(function (id) { if (cache[id]) ordered[id] = cache[id]; });
  // 已不在收藏里但缓存仍在的条目丢弃（避免文件无限增长）

  const next = JSON.stringify(ordered, null, 2) + '\n';
  const prev = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf-8') : '';
  if (next !== prev) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, next, 'utf-8');
    console.log('[infobox] 已写入 ' + path.relative(ROOT, OUT_FILE).replace(/\\/g, '/'));
  } else {
    console.log('[infobox] 缓存无变化');
  }
  if (failed) console.warn('[infobox] 有 ' + failed + ' 部抓取失败，下次构建会自动重试');
}

if (require.main === module) {
  main().catch(function (err) {
    // 绝不因为抓取失败而中断构建
    console.warn('[infobox] 跳过：' + err.message);
  });
}

module.exports = { main, extractInfo, collectIds };
