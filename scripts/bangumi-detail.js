/* global hexo */
'use strict';

/**
 * 为每部收藏的番剧生成一个详情页 /bangumis/<id>/。
 *
 * 这是一个**纯静态只读页**：没有任何表单、不发任何请求、不加载 JS。
 * 状态的事实来源是 Bangumi 本身，改状态请去 bangumi.vip，站点在每日定时构建时
 * 会把最新数据拉回到 progress.json / bangumis.json。
 *
 * 数据源：
 * - bangumis.json   基础信息（hexo bangumis -u）
 * - infobox.json    放送 / 制作（tools/fetch-bangumi-infobox.js）
 * - episodes.json   分集表（tools/fetch-bangumi-episodes.js）
 * - progress.json   我的状态与进度（同上）
 *
 * 所有 id 都来自本地数据文件，构建期不发网络请求，可离线重复。
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '_data/bangumis';
const SITE = 'https://bangumi.vip';

// 收藏状态：Bangumi 的 type 取值
const STATUS = {
  1: { label: '想看', cls: 'is-want' },
  2: { label: '看过', cls: 'is-done' },
  3: { label: '在看', cls: 'is-doing' },
  4: { label: '搁置', cls: 'is-hold' },
  5: { label: '抛弃', cls: 'is-drop' }
};

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    return fallback;
  }
}

function kv(label, value) {
  if (!value) return '';
  return '<span class="bgm-d__kv"><i>' + esc(label) + '</i>' + esc(value) + '</span>';
}

/** 把 "2025-07-07" / "2025年7月7日" 变成 "2025 年 7 月" */
function monthOf(text) {
  const s = String(text || '');
  const m = /^(\d{4})-(\d{1,2})/.exec(s) || /^(\d{4})年(\d{1,2})月/.exec(s);
  return m ? m[1] + ' 年 ' + Number(m[2]) + ' 月' : '';
}

/** 日期只留 "2025-07-07" 部分，避免 infobox 里的长描述撑破行 */
function shortDate(text) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(text || ''));
  return m ? m[0] : String(text || '');
}

function episodeRows(eps, watchedCount) {
  if (!eps || !eps.length) {
    return '<p class="bgm-d__empty">这个条目还没有分集信息。</p>';
  }
  return eps.map(function (ep, i) {
    const no = ep.sort == null ? i + 1 : ep.sort;
    const watched = i < watchedCount;
    return '<div class="bgm-ep' + (watched ? ' is-watched' : '') + '">' +
      '<span class="bgm-ep__mark" aria-hidden="true"></span>' +
      '<span class="bgm-ep__no">' + esc(no) + '</span>' +
      '<span class="bgm-ep__name">' + esc(ep.name || '第 ' + no + ' 话') + '</span>' +
      '<span class="bgm-ep__date">' + esc(shortDate(ep.airdate)) + '</span>' +
      '</div>';
  }).join('');
}

hexo.extend.generator.register('bangumi-detail', function (locals) {
  const cfg = this.config.bangumis;
  if (!cfg || !cfg.enable) return undefined;

  const base = path.join(this.source_dir, DATA_DIR);
  const sourceDir = this.source_dir;
  const data = readJSON(path.join(base, 'bangumis.json'), {});
  if (!data.wantWatch && !data.watching && !data.watched) return undefined;

  const info = readJSON(path.join(base, 'infobox.json'), {});
  const episodes = readJSON(path.join(base, 'episodes.json'), {});
  const progress = readJSON(path.join(base, 'progress.json'), {});

  const items = [];
  const seen = new Set();
  ['watching', 'wantWatch', 'watched'].forEach(function (key) {
    (data[key] || []).forEach(function (item) {
      if (!item || item.id == null || seen.has(item.id)) return;
      seen.add(item.id);
      items.push(item);
    });
  });

  const pages = items.map(function (item) {
    const meta = info[item.id] || {};
    const mine = progress[item.id] || { type: 0, rate: 0, ep_status: 0, comment: '' };
    const eps = (episodes[item.id] && episodes[item.id].eps) || [];
    const epCount = eps.length || Number(item.eps) || 0;

    // Bangumi 里「看过」本身就等于看完全部，ep_status 只是可选细粒度记录。
    // 很多条目的 ep_status 是 0（在网页上直接标「看过」不会填进度），
    // 照实显示会变成「看过 · 0 / 13 话」这种自相矛盾的文案，所以这里补齐。
    const rawWatched = Number(mine.ep_status) || 0;
    const isDone = Number(mine.type) === 2;
    const watched = epCount > 0
      ? (isDone && rawWatched === 0 ? epCount : Math.min(rawWatched, epCount))
      : rawWatched;
    const name = item.name_cn || item.name || '未知条目';
    const orig = item.name_cn && item.name ? item.name : '';
    const pct = epCount > 0 ? Math.round((watched / epCount) * 100) : 0;
    const rate = Number(mine.rate) || 0;
    const comment = String(mine.comment || '').trim();
    const status = STATUS[Number(mine.type)] || null;
    const subjectUrl = SITE + '/subject/' + item.id + '/';

    const score = item.rating && item.rating.score ? item.rating.score : '';
    const rank = item.rating && item.rating.rank ? '#' + item.rating.rank : '';

    // 顶部信息条
    const metaChips = [
      item.type ? '<span class="bgm-d__chip">' + esc(item.type) + '</span>' : '',
      epCount ? '<span class="bgm-d__chip">' + epCount + ' 话</span>' : '',
      monthOf(meta['放送开始'] || item.date)
        ? '<span class="bgm-d__chip">' + esc(monthOf(meta['放送开始'] || item.date)) + '</span>' : '',
      score ? '<span class="bgm-d__chip is-score">Bangumi ' + esc(score) + (rank ? ' · ' + esc(rank) : '') + '</span>' : ''
    ].filter(Boolean).join('');

    // 制作信息
    const staff = ['动画制作', '导演', '系列构成', '脚本', '人物设定', '音乐', '原作', '播放电视台']
      .map(function (k) { return kv(k === '动画制作' ? '制作' : k, meta[k]); })
      .filter(Boolean).join('');

    const contents = [
      '<link rel="stylesheet" href="/css/bangumi-detail.css">',
      '<div class="bgm-d" id="bgm-detail">',
      '<a class="bgm-d__back" href="/bangumis/">← 返回追番列表</a>',

      '<div class="bgm-d__hero">',
      '<div class="bgm-d__cover">' + coverHTML(item, name, sourceDir) + '</div>',
      '<div class="bgm-d__intro">',
      '<h1 class="bgm-d__title">' + esc(name) + '</h1>',
      orig ? '<p class="bgm-d__orig">' + esc(orig) + '</p>' : '',
      '<div class="bgm-d__chips">' + metaChips + '</div>',
      '<div class="bgm-d__staff">' + staff + '</div>',
      '</div>',
      '</div>',

      // ---- 我的记录（只读） ----
      '<section class="bgm-d__mine">',
      '<div class="bgm-d__mine-head">',
      '<h2>我的记录</h2>',
      status
        ? '<span class="bgm-badge ' + status.cls + '">' + status.label + '</span>'
        : '<span class="bgm-badge">未收藏</span>',
      '</div>',

      epCount
        ? '<div class="bgm-d__prog">' +
          '<span class="bgm-d__prog-num"><b>' + watched + '</b> / ' + epCount + ' 话</span>' +
          '<span class="bgm-d__bar"><i style="width:' + pct + '%"></i></span>' +
          '</div>'
        : '',

      '<div class="bgm-d__meta">',
      '<span class="bgm-d__kv"><i>评分</i>' + (rate ? rate + ' 分' : '未评分') + '</span>',
      mine.updated_at
        ? '<span class="bgm-d__kv"><i>更新于</i>' + esc(shortDate(mine.updated_at)) + '</span>'
        : '',
      '</div>',

      comment
        ? '<blockquote class="bgm-d__quote">' + esc(comment) + '</blockquote>'
        : '',

      '<div class="bgm-d__foot">',
      '<a class="bgm-btn bgm-btn--primary" href="' + esc(subjectUrl) +
      '" target="_blank" rel="noopener">去 Bangumi 记录 ↗</a>',
      '<span class="bgm-d__tip">只读展示 · 状态每天随站点定时构建从 Bangumi 拉取</span>',
      '</div>',
      '</section>',

      // ---- 简介 ----
      item.summary
        ? '<section class="bgm-d__sec"><h2>简介</h2><p class="bgm-d__summary">' +
          esc(String(item.summary).replace(/\r\n/g, '\n')) + '</p></section>'
        : '',

      // ---- 分集 ----
      '<section class="bgm-d__sec"><h2>分集 <em>' + watched + ' / ' + epCount + '</em></h2>' +
      '<div class="bgm-eps">' + episodeRows(eps, watched) + '</div></section>',

      '</div>'
    ].filter(Boolean).join('\n');

    return {
      path: 'bangumis/' + item.id + '/index.html',
      // type 用于让主题识别这是普通页面（否则会被当成首页，<title> 会退化成站点名）
      data: { title: name + ' | 追番', type: 'page', content: contents },
      layout: ['page', 'post']
    };
  });

  return pages;
});

/** 封面：与列表页一致，优先本地图，缺失时留空交给 CSS 占位 */
function coverHTML(item, name, sourceDir) {
  if (!item.image) return '';
  const src = '/images/bangumis/' + item.image;
  if (sourceDir && !fs.existsSync(path.join(sourceDir, src))) return '';
  return '<img src="' + esc(src) + '" alt="' + esc(name) + '" decoding="async" referrerpolicy="no-referrer">';
}
