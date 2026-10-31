/* global hexo */
'use strict';

/**
 * 为每部收藏的番剧生成一个详情页 /bangumis/<id>/。
 *
 * 页面分两块：
 * - 静态部分（构建期输出，无 JS 也能读）：封面、简介、制作阵容、分集表
 * - 交互部分（source/js/bangumi-detail.js 接管）：改状态 / 改进度 / 打分 / 短评，
 *   改动先落 localStorage，点「同步」后交给 GitHub Actions 写回 Bangumi
 *
 * 数据源：
 * - bangumis.json   基础信息（hexo bangumis -u）
 * - infobox.json    放送 / 制作（tools/fetch-bangumi-infobox.js）
 * - episodes.json   分集表（tools/fetch-bangumi-episodes.js）
 * - progress.json   我的状态与进度（同上）
 *
 * 所有 id 都来自本地数据文件，不在这里发网络请求，构建可离线重复。
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '_data/bangumis';
const SITE = 'https://bangumi.vip';

// 收藏状态：Bangumi 的 type 取值
const STATUS = [
  { type: 1, label: '想看' },
  { type: 3, label: '在看' },
  { type: 2, label: '已看' },
  { type: 4, label: '搁置' },
  { type: 5, label: '抛弃' }
];

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

function episodeRows(eps, watchedCount) {
  if (!eps || !eps.length) {
    return '<p class="bgm-d__empty">这个条目还没有分集信息。</p>';
  }
  return eps.map(function (ep, i) {
    const no = ep.sort == null ? i + 1 : ep.sort;
    const watched = i < watchedCount;
    return '<label class="bgm-ep' + (watched ? ' is-watched' : '') + '">' +
      '<input type="checkbox" data-ep="' + ep.id + '"' + (watched ? ' checked' : '') + '>' +
      '<span class="bgm-ep__no">' + esc(no) + '</span>' +
      '<span class="bgm-ep__name">' + esc(ep.name || '第 ' + no + ' 话') + '</span>' +
      '<span class="bgm-ep__date">' + esc(ep.airdate || '') + '</span>' +
      '</label>';
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
    const watched = Math.min(Number(mine.ep_status) || 0, epCount);
    const name = item.name_cn || item.name || '未知条目';
    const orig = item.name_cn && item.name ? item.name : '';

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

    // 交互面板初值
    const payload = {
      id: item.id,
      type: Number(mine.type) || 0,
      rate: Number(mine.rate) || 0,
      epStatus: watched,
      comment: mine.comment || '',
      updatedAt: mine.updated_at || '',
      eps: eps.map(function (ep) { return { id: ep.id, sort: ep.sort, name: ep.name, airdate: ep.airdate }; })
    };

    const statusBtns = STATUS.map(function (s) {
      return '<button type="button" data-type="' + s.type + '"' +
        (Number(mine.type) === s.type ? ' class="is-active"' : '') + '>' + s.label + '</button>';
    }).join('');

    const rateBtns = [];
    for (let i = 1; i <= 10; i += 1) {
      rateBtns.push('<button type="button" data-rate="' + i + '"' +
        (Number(mine.rate) === i ? ' class="is-active"' : '') + '>' + i + '</button>');
    }

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
      '<a class="bgm-d__link" href="' + SITE + '/subject/' + item.id +
      '" target="_blank" rel="noopener">在 Bangumi 查看条目 ↗</a>',
      '</div>',
      '</div>',

      // ---- 我的记录 ----
      '<section class="bgm-d__mine" id="bgm-mine">',
      '<div class="bgm-d__mine-head">',
      '<h2>我的记录</h2>',
      '<span class="bgm-d__state" id="bgm-state" data-state="idle">未修改</span>',
      '</div>',
      '<div class="bgm-d__row">',
      '<span class="bgm-d__label">状态</span>',
      '<div class="bgm-seg" id="bgm-status">' + statusBtns + '</div>',
      '</div>',
      '<div class="bgm-d__row">',
      '<span class="bgm-d__label">进度</span>',
      '<div class="bgm-prog">',
      '<button type="button" class="bgm-prog__btn" data-step="-1" aria-label="减一集">−</button>',
      '<span class="bgm-prog__num"><b id="bgm-prog-num">' + watched + '</b> / <i id="bgm-prog-total">' + epCount + '</i></span>',
      '<button type="button" class="bgm-prog__btn" data-step="1" aria-label="加一集">＋</button>',
      '<button type="button" class="bgm-prog__all" id="bgm-prog-all">全部看完</button>',
      '</div>',
      '</div>',
      '<div class="bgm-d__row">',
      '<span class="bgm-d__label">评分</span>',
      '<div class="bgm-rate" id="bgm-rate">' + rateBtns.join('') +
      '<button type="button" class="bgm-rate__clear" id="bgm-rate-clear">清除</button></div>',
      '</div>',
      '<div class="bgm-d__row">',
      '<span class="bgm-d__label">短评</span>',
      '<textarea class="bgm-comment" id="bgm-comment" maxlength="500" rows="3" ' +
      'placeholder="一句话记一下感受，会同步到 Bangumi">' + esc(mine.comment || '') + '</textarea>',
      '</div>',
      '<div class="bgm-d__foot">',
      '<button type="button" class="bgm-btn bgm-btn--primary" id="bgm-sync">同步到 Bangumi</button>',
      '<button type="button" class="bgm-btn" id="bgm-reset">放弃改动</button>',
      '<button type="button" class="bgm-btn bgm-btn--ghost" id="bgm-setup">同步设置</button>',
      '<span class="bgm-d__tip" id="bgm-tip">改动会先存在本机，点同步后约 1~2 分钟写回</span>',
      '</div>',
      '</section>',

      // ---- 简介 ----
      item.summary
        ? '<section class="bgm-d__sec"><h2>简介</h2><p class="bgm-d__summary">' +
          esc(String(item.summary).replace(/\r\n/g, '\n')) + '</p></section>'
        : '',

      // ---- 分集 ----
      '<section class="bgm-d__sec"><h2>分集 <em id="bgm-ep-count">' + watched + ' / ' + epCount + '</em></h2>' +
      '<div class="bgm-eps" id="bgm-eps">' + episodeRows(eps, watched) + '</div></section>',

      '</div>',
      '<script type="application/json" id="bgm-payload">' + JSON.stringify(payload) + '</script>',
      '<script src="/js/bangumi-detail.js" defer></script>'
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
