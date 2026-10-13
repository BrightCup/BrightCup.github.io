/*! 追番列表页交互：分类切换 / 分页 / 网格↔列表布局切换 */
(function () {
  'use strict';

  var root = document.getElementById('bgm-page');
  if (!root) return;

  // 每页目标条目数。网格视图下会按实际列数取整（见 pageSizeFor），
  // 因为列数随视口宽度变化，固定 24 条必然导致末行出现空格子。
  var PAGE_TARGET = 24;
  var LS_KEY = 'bgmListLayout';
  var NAV_OFFSET = 80; // 翻页 / 切分类时给顶部固定导航留出的空间
  var RESIZE_DELAY = 160;

  var panels = Array.prototype.slice.call(root.querySelectorAll('.bgm-panel'));
  var tabs = Array.prototype.slice.call(root.querySelectorAll('.bgm-tab'));
  var viewBtns = Array.prototype.slice.call(root.querySelectorAll('.bgm-view__btn'));

  function cardsOf(panel) {
    return Array.prototype.slice.call(panel.querySelectorAll('.bgm-cd'));
  }

  function activePanel() {
    return root.querySelector('.bgm-panel.is-active') || panels[0] || null;
  }

  function layoutOf(panel) {
    var grid = panel.querySelector('.bgm-collection');
    return grid && grid.getAttribute('data-layout') === 'list' ? 'list' : 'grid';
  }

  /**
   * 当前该用多大的分页尺寸。
   * 网格视图按「实际列数 × 整数行」取整，使每页条目数恰好是列数的整数倍，
   * 末行永远填满；数值保持在 PAGE_TARGET 附近（4 列 → 24，5 列 → 25，6 列 → 24）。
   * 列表视图只有一列，直接用 PAGE_TARGET。
   */
  function pageSizeFor(panel) {
    if (layoutOf(panel) === 'list') return PAGE_TARGET;

    var grid = panel.querySelector('.bgm-collection');
    if (!grid) return PAGE_TARGET;

    // 面板隐藏时 getComputedStyle 拿不到网格定义，退回目标值（切到该分类时会重算）
    var cols = 1;
    var tpl = window.getComputedStyle(grid).gridTemplateColumns;
    if (tpl && tpl !== 'none') {
      cols = tpl.split(' ').filter(function (s) { return !!s; }).length || 1;
    }
    if (cols < 1) cols = 1;
    return cols * Math.max(1, Math.round(PAGE_TARGET / cols));
  }

  /* ---------------- 分页 ---------------- */

  function renderPager(panel) {
    var cards = cardsOf(panel);
    var size = pageSizeFor(panel);
    var pages = Math.max(1, Math.ceil(cards.length / size));
    var page = parseInt(panel.getAttribute('data-page') || '1', 10);
    if (!(page >= 1)) page = 1;
    if (page > pages) page = pages;
    panel.setAttribute('data-page', String(page));

    cards.forEach(function (card, i) {
      card.hidden = Math.floor(i / size) + 1 !== page;
    });

    var pager = panel.querySelector('.bgm-pager');
    if (pager) pager.hidden = pages <= 1;

    var num = panel.querySelector('.bgm-pager__num');
    if (num) num.innerHTML = '<b>' + page + '</b> / <i>' + pages + '</i>';

    if (!pager) return;
    var first = pager.querySelector('[data-go="first"]');
    var prev = pager.querySelector('[data-go="prev"]');
    var next = pager.querySelector('[data-go="next"]');
    var last = pager.querySelector('[data-go="last"]');
    if (first) first.disabled = page === 1;
    if (prev) prev.disabled = page === 1;
    if (next) next.disabled = page === pages;
    if (last) last.disabled = page === pages;
  }

  function scrollToTop(el) {
    var top = el.getBoundingClientRect().top + window.pageYOffset - NAV_OFFSET;
    window.scrollTo({ top: top < 0 ? 0 : top, behavior: 'smooth' });
  }

  root.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.bgm-pager__btn') : null;
    if (!btn || !root.contains(btn)) return;

    var panel = btn.closest('.bgm-panel');
    if (!panel) return;

    var size = pageSizeFor(panel);
    var pages = Math.max(1, Math.ceil(cardsOf(panel).length / size));
    var page = parseInt(panel.getAttribute('data-page') || '1', 10);
    var go = btn.getAttribute('data-go');

    if (go === 'first') page = 1;
    else if (go === 'prev') page -= 1;
    else if (go === 'next') page += 1;
    else if (go === 'last') page = pages;

    if (page < 1) page = 1;
    if (page > pages) page = pages;

    panel.setAttribute('data-page', String(page));
    renderPager(panel);
    scrollToTop(root);
  });

  /* ---------------- 分类切换 ---------------- */

  function activateTab(key, doScroll) {
    var hit = false;
    panels.forEach(function (panel) {
      var on = panel.getAttribute('data-panel') === key;
      panel.classList.toggle('is-active', on);
      if (on) {
        hit = true;
        renderPager(panel);
      }
    });
    if (!hit) return;

    tabs.forEach(function (tab) {
      tab.classList.toggle('is-active', tab.getAttribute('data-tab') === key);
    });

    if (window.history && history.replaceState) history.replaceState(null, '', '#' + key);
    if (doScroll) scrollToTop(root);
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      activateTab(tab.getAttribute('data-tab'), true);
    });
  });

  /* ---------------- 布局切换（记忆偏好） ---------------- */

  function applyLayout(layout) {
    root.querySelectorAll('.bgm-collection').forEach(function (el) {
      el.setAttribute('data-layout', layout);
    });
    viewBtns.forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-view') === layout);
    });
    // 布局变了 → 每页条数也不同，当前分类需要重算
    var panel = activePanel();
    if (panel) renderPager(panel);
  }

  viewBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var layout = btn.getAttribute('data-view') === 'list' ? 'list' : 'grid';
      applyLayout(layout);
      try {
        localStorage.setItem(LS_KEY, layout);
      } catch (err) {
        /* 隐私模式下 localStorage 不可用，忽略 */
      }
    });
  });

  /* ---------------- 视口变化 ---------------- */

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      var panel = activePanel();
      if (panel) renderPager(panel);
    }, RESIZE_DELAY);
  });

  /* ---------------- 初始化 ---------------- */

  var saved = 'grid';
  try {
    saved = localStorage.getItem(LS_KEY) || 'grid';
  } catch (err) {
    saved = 'grid';
  }
  applyLayout(saved === 'list' ? 'list' : 'grid');

  // 优先用 URL hash（可分享「在看」这类定位），否则沿用构建时写好的默认分类
  var hash = (location.hash || '').replace(/^#/, '');
  var hasHashTab = tabs.some(function (t) { return t.getAttribute('data-tab') === hash; });
  if (hasHashTab) {
    activateTab(hash, false);
  } else {
    panels.forEach(renderPager);
  }

  /* ---------------- 封面加载失败兜底 ---------------- */

  root.querySelectorAll('.bgm-cd img').forEach(function (img) {
    function fallback() {
      var card = img.closest('.bgm-cd');
      if (card) card.classList.add('is-noimg');
      img.remove();
    }
    // 脚本带 defer，可能晚于图片加载失败：此时 error 事件不会再触发，
    // 需要主动检查一次（naturalWidth 为 0 说明没拿到图）
    if (img.complete && img.naturalWidth === 0) {
      fallback();
      return;
    }
    img.addEventListener('error', fallback);
  });
}());
