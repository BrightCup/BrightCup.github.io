/* global hexo */
'use strict';

/**
 * 给 /schedule/ 页面注入「站内已有详情页」的 id 白名单。
 *
 * 追番更新页的数据是浏览器打开时实时从 Bangumi 拉的，而详情页是构建期生成的。
 * 你在 Bangumi 上刚加了一部「想看」，更新页立刻就有它，但详情页要等下一次构建
 * 才生成 —— 这中间点进去会 404。所以这里把本次构建实际产出详情页的 id 写进页面，
 * 前端据此决定跳站内详情页还是退回 bangumi.vip。
 *
 * 白名单只含数字 id，无任何隐私信息（列表页本来就公开了这些条目）。
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join('_data', 'bangumis', 'bangumis.json');

function collectIds(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const ids = [];
  const seen = new Set();
  ['wantWatch', 'watching', 'watched'].forEach(function (key) {
    (json[key] || []).forEach(function (item) {
      if (!item || item.id == null || seen.has(item.id)) return;
      seen.add(item.id);
      ids.push(item.id);
    });
  });
  return ids;
}

hexo.extend.filter.register('after_render:html', function (str, data) {
  const output = String((data && data.path) || '').replace(/\\/g, '/');
  if (output !== 'schedule/index.html') return str;
  if (str.indexOf('</head>') < 0) return str;

  let ids;
  try {
    ids = collectIds(path.join(hexo.source_dir, DATA));
  } catch (err) {
    // 读不到数据就不注入：前端拿不到白名单时默认全部走站内详情页
    return str;
  }
  if (!ids.length) return str;

  const tag = '<script>window.BGM_KNOWN_IDS=' + JSON.stringify(ids) + ';</script>';
  return str.replace('</head>', tag + '</head>');
});
