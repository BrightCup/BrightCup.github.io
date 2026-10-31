/* global hexo */
'use strict';

/**
 * 接管 /bangumis/ 追番列表页的渲染。
 *
 * 背景：该页面原本由 hexo-bangumis 插件用它内置的 templates/bangumi.ejs 渲染，
 * DOM 结构与内联 <style> 都写死在 node_modules 里，改不动也留不住
 * （CI 每次 npm install 都会还原）。这里在本站 scripts/ 目录中注册一个同名的
 * `bangumis` generator —— Hexo 的 generator 是同名覆盖（generator.js 里直接
 * `store[name] = fn`），且插件加载顺序是「node_modules 先、站点 scripts 后」，
 * 因此本站的注册会生效。
 *
 * 数据源：
 * - source/_data/bangumis/bangumis.json  收藏与基础字段（`hexo bangumis -u` 写入）
 * - source/_data/bangumis/infobox.json   放送时间 / 制作阵容（tools/fetch-bangumi-infobox.js 写入）
 * 两者都存在仓库里，所以页面依旧在构建期生成纯静态 HTML，无 JS 也能读、对爬虫友好。
 */

const fs = require('fs');
const path = require('path');

// 番剧详情页跳转目标：官网 bgm.tv / bangumi.tv 在国内不可达，统一走镜像。
// 与 source/js/bangumi-schedule.js 中的 SITE_BASE 保持一致。
const SITE = 'https://bangumi.vip';

// 每页条目数（网格视图下由前端按实际列数取整，见 source/js/bangumi-list.js）
const PER_PAGE = 24;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ICON_GRID =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor"/>' +
  '<rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor"/>' +
  '<rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor"/>' +
  '<rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor"/>' +
  '</svg>';

const ICON_LIST =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<rect x="1" y="2.2" width="14" height="3" rx="1.5" fill="currentColor"/>' +
  '<rect x="1" y="6.5" width="14" height="3" rx="1.5" fill="currentColor"/>' +
  '<rect x="1" y="10.8" width="14" height="3" rx="1.5" fill="currentColor"/>' +
  '</svg>';

// 三个分类：顺序与 hexo-bangumis 一致，`show` 配置按索引对应
const TABS = [
  { key: 'wish', field: 'wantWatch', label: '想看' },
  { key: 'doing', field: 'watching', label: '在看' },
  { key: 'done', field: 'watched', label: '已看' }
];

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 压掉换行与连续空白，超长截断 */
function clip(text, max) {
  if (!text) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** 解析 "2026-10-01" 或 "2026年10月1日" 为 UTC 零点毫秒数 */
function parseDate(text) {
  if (!text) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(text));
  if (!m) m = /^(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(String(text));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 构建时「今天」（北京时间），用于算放送状态 */
function todayShanghai() {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const p = s.split('-');
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

/** 放送状态：「未开播」「放送中 · 第 N 话」「已完结」 */
function statusOf(item, info, today) {
  const start = parseDate(info['放送开始']) || parseDate(item.date);
  if (start == null) return null;

  const eps = parseInt(item.eps || info['话数'], 10) || 0;
  if (start > today) return { key: 'soon', text: '未开播' };
  if (eps > 0) {
    const n = Math.floor((today - start) / WEEK_MS) + 1;
    if (n > eps) return { key: 'done', text: '已完结' };
    return { key: 'airing', text: '放送中 · 第 ' + n + ' 话' };
  }
  return { key: 'airing', text: '放送中' };
}

/** 一行「标签 + 值」 */
function kvHTML(label, value) {
  if (!value) return '';
  return '<span class="bgm-kv"><i>' + esc(label) + '</i>' + esc(value) + '</span>';
}

// ---------- 列表视图专属的富信息（网格视图下由 CSS 隐藏） ----------

function richHTML(item, info, today) {
  const rows = [];

  // 1) 放送：状态 + 开播日 + 星期 + 电视台 + 结束日
  const start = parseDate(info['放送开始']) || parseDate(item.date);
  const airParts = [];
  if (start != null) airParts.push(isoDate(start) + ' 起');
  if (info['放送星期']) airParts.push('每' + info['放送星期'].replace(/^星期/, '周'));
  if (info['播放电视台']) airParts.push('电视台 ' + clip(info['播放电视台'], 18));
  const end = parseDate(info['播放结束']);
  if (end != null) airParts.push('至 ' + isoDate(end));

  const st = statusOf(item, info, today);
  const chip = st
    ? '<b class="bgm-chip is-' + st.key + '">' + esc(st.text) + '</b>'
    : '';
  if (chip || airParts.length) {
    rows.push('<span class="bgm-row">' + chip + kvHTML('放送', airParts.join(' · ')) + '</span>');
  }

  // 2) 制作阵容：动画制作（缺失时退回製作委员会）· 导演 · 剧本 · 人设 · 音乐 · 原作
  const staff = [];
  const studio = info['动画制作'] ? clip(info['动画制作'], 16) : clip(info['製作'], 22);
  if (studio) staff.push(kvHTML('制作', studio));
  if (info['导演']) staff.push(kvHTML('导演', clip(info['导演'], 24)));
  const script = clip(info['系列构成'] || info['脚本'], 24);
  if (script) staff.push(kvHTML('剧本', script));
  if (info['人物设定']) staff.push(kvHTML('人设', clip(info['人物设定'], 24)));
  if (info['音乐']) staff.push(kvHTML('音乐', clip(info['音乐'], 20)));
  if (info['原作']) staff.push(kvHTML('原作', clip(info['原作'], 26)));
  if (staff.length) rows.push('<span class="bgm-row">' + staff.join('') + '</span>');

  // 3) 评分与收藏热度
  const stats = [];
  const rating = item.rating || {};
  if (rating.score) {
    const extra = [];
    if (rating.rank) extra.push('#' + rating.rank);
    if (rating.total) extra.push(rating.total + ' 人评');
    stats.push(kvHTML('评分', rating.score + (extra.length ? '（' + extra.join(' · ') + '）' : '')));
  }
  const col = item.collection || {};
  ['wish:想看', 'doing:在看', 'collect:已看'].forEach(function (spec) {
    const p = spec.split(':');
    if (col[p[0]]) stats.push(kvHTML(p[1], col[p[0]]));
  });
  if (stats.length) rows.push('<span class="bgm-row bgm-row--stats">' + stats.join('') + '</span>');

  // 4) 简介
  const summary = clip(item.summary, 180);
  if (summary) rows.push('<span class="bgm-sum">' + esc(summary) + '</span>');

  if (!rows.length) return '';
  return '<span class="bgm-rich">' + rows.join('') + '</span>';
}

// ---------- 卡片 ----------

// 封面：优先本地图（download_image: true），文件缺失时留空交给 CSS 占位
function coverHTML(item, name, ctx) {
  if (!item.image) return '';

  let src;
  if (ctx.downloadImage) {
    src = '/images/bangumis/' + item.image;
    if (!fs.existsSync(path.join(ctx.sourceDir, src))) return '';
  } else {
    src = ctx.imageBase + '/pic/cover/' + ctx.imageLevel + '/' + item.image;
  }

  return '<img src="' + esc(src) + '" alt="' + esc(name) + '" loading="lazy" ' +
    'decoding="async" referrerpolicy="no-referrer">';
}

function cardHTML(item, ctx) {
  const name = item.name_cn || item.name || '未知条目';
  // 卡片进站内详情页（可改状态/进度），详情页里再给出 Bangumi 原站链接
  const href = '/bangumis/' + item.id + '/';
  const cover = coverHTML(item, name, ctx);
  const score = item.rating && item.rating.score ? item.rating.score : '';
  const type = item.type || '';
  const eps = item.eps ? '共 ' + item.eps + ' 话' : '话数未定';
  const info = ctx.info[item.id] || {};

  return '<a class="bgm-cd' + (cover ? '' : ' is-noimg') + '" href="' + esc(href) + '">' +
    '<span class="bgm-cd__cover">' + cover +
    (score ? '<i class="bgm-cd__score">' + esc(score) + '</i>' : '') +
    '</span>' +
    '<span class="bgm-cd__body">' +
    '<span class="bgm-cd__head">' +
    '<span class="bgm-cd__title">' + esc(name) + '</span>' +
    (score ? '<i class="bgm-cd__scorex">' + esc(score) + '</i>' : '') +
    '</span>' +
    '<span class="bgm-cd__meta">' +
    (type ? '<span class="bgm-cd__type">' + esc(type) + '</span>' : '') +
    '<span class="bgm-cd__eps">' + esc(eps) + '</span>' +
    '</span>' +
    richHTML(item, info, ctx.today) +
    '</span>' +
    '</a>';
}

// 条目全部静态输出、由 JS 按页显隐：JS 失效时最多是「不分页」，内容不丢。
// 分页条始终输出，仅用 hidden 控制显隐 —— 网格视图下前端要按实际列数
// 重算每页条数（列数随视口变化），页数可能与构建时不同，不能只在页数 > 1 时才输出。
function pagerHTML(total) {
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  return '<div class="bgm-pager"' + (pages <= 1 ? ' hidden' : '') + '>' +
    '<button class="bgm-pager__btn" type="button" data-go="first">首页</button>' +
    '<button class="bgm-pager__btn" type="button" data-go="prev">上一页</button>' +
    '<span class="bgm-pager__num"><b>1</b> / <i>' + pages + '</i></span>' +
    '<button class="bgm-pager__btn" type="button" data-go="next">下一页</button>' +
    '<button class="bgm-pager__btn" type="button" data-go="last">尾页</button>' +
    '</div>';
}

hexo.extend.generator.register('bangumis', function (locals) {
  const cfg = this.config.bangumis;
  if (!cfg || !cfg.enable) return undefined;

  const sourceDir = this.source_dir;
  const jsonPath = path.join(sourceDir, '_data/bangumis/bangumis.json');
  const infoPath = path.join(sourceDir, '_data/bangumis/infobox.json');

  let data = {};
  if (fs.existsSync(jsonPath)) {
    try {
      data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    } catch (err) {
      this.log.error('[bangumi-page] bangumis.json 解析失败：' + err.message);
      data = {};
    }
  } else {
    this.log.warn('[bangumi-page] 未找到 bangumis.json，请先执行 `hexo bangumis -u` 获取数据');
  }

  // 放送时间 / 制作阵容缓存，缺失时降级为只有基础信息
  let info = {};
  if (fs.existsSync(infoPath)) {
    try {
      info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
    } catch (err) {
      this.log.warn('[bangumi-page] infobox.json 解析失败，列表视图将不含制作信息：' + err.message);
      info = {};
    }
  } else {
    this.log.warn('[bangumi-page] 未找到 infobox.json，可执行 `node tools/fetch-bangumi-infobox.js` 生成');
  }

  const ctx = {
    sourceDir: sourceDir,
    info: info,
    today: todayShanghai(),
    downloadImage: cfg.download_image !== false,
    imageLevel: cfg.image_level || 'c',
    imageBase: ((cfg.image_mirrors && cfg.image_mirrors[0]) || 'https://lain.bgm.tv').replace(/\/+$/, '')
  };

  const counts = TABS.map(function (t) {
    return (data[t.field] || []).length;
  });
  const total = counts.reduce(function (a, b) { return a + b; }, 0);

  // 默认打开哪个分类，沿用 _config.yml 的 `show`（原插件语义：show: 1 → 在看）
  let defaultIdx = Number(cfg.show);
  if (!isFinite(defaultIdx) || defaultIdx < 0 || defaultIdx >= TABS.length) defaultIdx = 0;

  const tabBar = TABS.map(function (t, i) {
    return '<button class="bgm-tab' + (i === defaultIdx ? ' is-active' : '') +
      '" type="button" data-tab="' + t.key + '">' +
      esc(t.label) + '<em>' + counts[i] + '</em></button>';
  }).join('');

  const panels = TABS.map(function (t, i) {
    const items = data[t.field] || [];
    const body = items.length
      ? '<div class="bgm-collection" data-layout="grid">' +
        items.map(function (it) { return cardHTML(it, ctx); }).join('') +
        '</div>' + pagerHTML(items.length)
      : '<div class="bgm-collection" data-layout="grid">' +
        '<div class="bgm-empty">这个分类还是空的 ~</div></div>';

    return '<div class="bgm-panel' + (i === defaultIdx ? ' is-active' : '') +
      '" data-panel="' + t.key + '" data-page="1">' + body + '</div>';
  }).join('');

  const contents = [
    '<link rel="stylesheet" href="/css/bangumi-list.css">',
    '<div class="bgm-page" id="bgm-page">',
    cfg.quote ? '<div class="bgm-page__quote">' + esc(cfg.quote) + '</div>' : '',
    '<div class="bgm-page__bar">',
    '<div class="bgm-tabs" id="bgm-tabs">' + tabBar + '</div>',
    '<div class="bgm-view" id="bgm-view" role="group" aria-label="切换布局">',
    '<button class="bgm-view__btn is-active" type="button" data-view="grid" title="网格视图" aria-label="网格视图">' + ICON_GRID + '</button>',
    '<button class="bgm-view__btn" type="button" data-view="list" title="列表视图" aria-label="列表视图">' + ICON_LIST + '</button>',
    '</div>',
    '</div>',
    panels,
    '<div class="bgm-page__foot">共 ' + total + ' 部 · 想看 ' + counts[0] +
    ' / 在看 ' + counts[1] + ' / 已看 ' + counts[2] + ' · 点开任意一部可改状态与进度</div>',
    '</div>',
    '<script src="/js/bangumi-list.js" defer></script>'
  ].filter(Boolean).join('\n');

  return {
    path: cfg.path || 'bangumis/index.html',
    data: Object.assign(
      { title: cfg.title || '追番列表', type: 'page', content: contents },
      cfg.extra_options || {}
    ),
    layout: ['page', 'post']
  };
});
