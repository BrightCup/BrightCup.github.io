/*! 追番列表页交互：分类切换 / 分页 / 网格↔列表布局切换 */
(function () {
  'use strict';

  var root = document.getElementById('bgm-page');
  if (!root) return;

  var PAGE_SIZE = 24;
  var LS_KEY = 'bgmListLayout';
  var NAV_OFFSET = 80; // 翻页 / 切分类时给顶部固定导航留出的空间

  var panels = Array.prototype.slice.call(root.querySelectorAll('.bgm-panel'));
  var tabs = Array.prototype.slice.call(root.querySelectorAll('.bgm-tab'));
  var viewBtns = Array.prototype.slice.call(root.querySelectorAll('.bgm-view__btn'));

  /* ---------------- 分页 ---------------- */

  function renderPager(panel) {
    var cards = Array.prototype.slice.call(panel.querySelectorAll('.bgm-cd'));
    var pages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
    var page = parseInt(panel.getAttribute('data-page') || '1', 10);
    if (!(page >= 1)) page = 1;
    if (page > pages) page = pages;
    panel.setAttribute('data-page', String(page));

    cards.forEach(function (card, i) {
      card.hidden = Math.floor(i / PAGE_SIZE) + 1 !== page;
    });

    var num = panel.querySelector('.bgm-pager__num b');
    if (num) num.textContent = String(page);

    var pager = panel.querySelector('.bgm-pager');
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

    var pages = Math.max(1, Math.ceil(panel.querySelectorAll('.bgm-cd').length / PAGE_SIZE));
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
    img.addEventListener('error', function () {
      var card = img.closest('.bgm-cd');
      if (card) card.classList.add('is-noimg');
      img.remove();
    });
  });
}());
