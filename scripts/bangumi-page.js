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
 * 数据源仍是 source/_data/bangumis/bangumis.json，所以
 * `hexo bangumis -u` 以及 CI 里那步每日定时更新链路完全不受影响。
 * 页面依旧在构建期生成纯静态 HTML，无 JS 也能读、对爬虫友好。
 */

const fs = require('fs');
const path = require('path');

// 番剧详情页跳转目标：官网 bgm.tv / bangumi.tv 在国内不可达，统一走镜像。
// 与 source/js/bangumi-schedule.js 中的 SITE_BASE 保持一致。
const SITE = 'https://bangumi.vip';

// 每页条目数
const PER_PAGE = 24;

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
  const href = SITE + '/subject/' + item.id;
  const cover = coverHTML(item, name, ctx);
  const score = item.rating && item.rating.score ? item.rating.score : '';
  const type = item.type || '';
  const eps = item.eps ? '共 ' + item.eps + ' 话' : '话数未定';

  return '<a class="bgm-cd' + (cover ? '' : ' is-noimg') + '" href="' + esc(href) +
    '" target="_blank" rel="noopener">' +
    '<span class="bgm-cd__cover">' + cover +
    (score ? '<i class="bgm-cd__score">' + esc(score) + '</i>' : '') +
    '</span>' +
    '<span class="bgm-cd__body">' +
    '<span class="bgm-cd__title">' + esc(name) + '</span>' +
    '<span class="bgm-cd__meta">' +
    (type ? '<span class="bgm-cd__type">' + esc(type) + '</span>' : '') +
    '<span class="bgm-cd__eps">' + esc(eps) + '</span>' +
    '</span>' +
    '</span>' +
    '</a>';
}

// 条目全部静态输出、由 JS 按页显隐：JS 失效时最多是「不分页」，内容不丢
function pagerHTML(total) {
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (pages <= 1) return '';

  return '<div class="bgm-pager">' +
    '<button class="bgm-pager__btn" type="button" data-go="first">首页</button>' +
    '<button class="bgm-pager__btn" type="button" data-go="prev">上一页</button>' +
    '<span class="bgm-pager__num"><b>1</b> / ' + pages + '</span>' +
    '<button class="bgm-pager__btn" type="button" data-go="next">下一页</button>' +
    '<button class="bgm-pager__btn" type="button" data-go="last">尾页</button>' +
    '</div>';
}

hexo.extend.generator.register('bangumis', function (locals) {
  const cfg = this.config.bangumis;
  if (!cfg || !cfg.enable) return undefined;

  const sourceDir = this.source_dir;
  const jsonPath = path.join(sourceDir, '_data/bangumis/bangumis.json');

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

  const ctx = {
    sourceDir: sourceDir,
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
    ' / 在看 ' + counts[1] + ' / 已看 ' + counts[2] + '</div>',
    '</div>',
    '<script src="/js/bangumi-list.js" defer></script>'
  ].filter(Boolean).join('\n');

  return {
    path: cfg.path || 'bangumis/index.html',
    data: Object.assign(
      { title: cfg.title || '追番列表', content: contents },
      cfg.extra_options || {}
    ),
    layout: ['page', 'post']
  };
});
