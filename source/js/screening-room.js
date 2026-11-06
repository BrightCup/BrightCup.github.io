/*!
 * 放映室的博客侧外壳（/room/）
 *
 * 只做三件事：
 *   1. 决定 iframe 指向哪个服务地址（常量兜底 → localStorage → ?server=）
 *   2. 等 iframe 里的 `room:ready` 握手；8 秒收不到就出兜底页
 *   3. 博客与 iframe 的深浅色双向同步
 *
 * 为什么不靠 iframe 的 onload：跨域加载失败（连接被拒绝）也会触发 onload，
 * 拿不到任何内容，只能靠握手消息判断服务到底通不通。
 */
(function () {
  'use strict';

  var DEFAULT_SERVER = 'http://127.0.0.1:8787'; // 本地开发兜底；线上靠邀请链接里的 ?server=
  var KEY = 'sr:server';
  var READY_TIMEOUT = 5000;

  var frame = document.getElementById('sr-frame');
  var fallback = document.getElementById('sr-fallback');
  var loading = document.getElementById('sr-loading');
  var sub = document.getElementById('sr-fallback-sub');
  var paste = document.getElementById('sr-paste');
  var pasteInput = document.getElementById('sr-paste-input');
  var pasteErr = document.getElementById('sr-paste-err');
  var waitingHint = document.getElementById('sr-waiting-hint');
  var manualBox = document.getElementById('sr-waiting-manual-box');
  var pendingInvite = '';

  // #rightside / #footer 是 #body-wrap 的兄弟节点，CSS 用 :has() 选；
  // 这里再补一个 class 兜住不支持 :has() 的旧浏览器
  if (document.body) document.body.classList.add('room-page');

  if (!frame || !fallback) return;

  var server = '';
  var readyTimer = null;

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function resolveServer() {
    try {
      var q = new URLSearchParams(location.search).get('server');
      if (q) {
        localStorage.setItem(KEY, q);
        return q;
      }
    } catch (e) { /* ignore */ }

    var saved = localStorage.getItem(KEY);
    if (saved) return saved;

    // 本地跑 hexo server 时默认指本机；线上没地址就显示「等待管理员开启」
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return DEFAULT_SERVER;
    return '';
  }

  /** 服务没开 / 还没有地址：统一的「等待管理员开启」页，默认不要求用户填任何东西 */
  function showWaiting(msg) {
    if (loading) loading.hidden = true;
    fallback.hidden = true;
    if (paste) paste.hidden = false;
    if (msg && waitingHint) waitingHint.textContent = msg;
    if (pasteErr) pasteErr.textContent = '';
  }

  function submitPaste() {
    var raw = (pasteInput && pasteInput.value || '').trim();
    if (!raw) return;
    if (pasteErr) pasteErr.textContent = '';

    var serverVal = '';
    var inviteVal = '';
    try {
      var u = new URL(raw);
      serverVal = u.searchParams.get('server') || '';
      inviteVal = u.searchParams.get('invite') || '';
      if (!serverVal && /^https?:$/.test(u.protocol)) serverVal = u.origin;
    } catch (e) {
      serverVal = raw; // 不是完整 URL，当成裸地址
    }

    if (!/^https?:\/\//i.test(serverVal)) {
      if (pasteErr) pasteErr.textContent = '这不是一个有效地址';
      return;
    }
    localStorage.setItem(KEY, serverVal.replace(/\/+$/, ''));
    if (inviteVal) pendingInvite = inviteVal;
    if (paste) paste.hidden = true;
    load();
  }

  // https 页面嵌 http iframe 会被浏览器直接拦掉，与其白屏不如说清楚
  function mixedBlocked(url) {
    return location.protocol === 'https:' && /^http:\/\//i.test(url);
  }

  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch (e) {
      return '';
    }
  }

  function showFallback(msg) {
    if (loading) loading.hidden = true;
    fallback.hidden = false;
    sub.textContent = msg;
  }

  function load() {
    clearTimeout(readyTimer);
    fallback.hidden = true;
    if (paste) paste.hidden = true;
    if (loading) loading.hidden = false;

    server = resolveServer().replace(/\/+$/, '');

    // 线上第一次打开、还没有任何地址来源：显示等待页，不再逼人粘贴链接
    if (!server) {
      showWaiting();
      return;
    }
    if (!/^https?:\/\//i.test(server)) {
      showWaiting('记下的服务地址格式不对，等服务开启后重试即可。');
      return;
    }
    if (mixedBlocked(server)) {
      showFallback('博客是 HTTPS，浏览器不允许嵌套 http 地址；管理员开启 https 隧道后点「重试」即可。');
      return;
    }

    var invite = pendingInvite;
    if (!invite) {
      try {
        invite = new URLSearchParams(location.search).get('invite') || '';
      } catch (e) { /* ignore */ }
    }

    frame.src = server + '/?embed=1&theme=' + encodeURIComponent(currentTheme()) +
      (invite ? '&invite=' + encodeURIComponent(invite) : '') +
      '&_=' + Date.now();

    readyTimer = setTimeout(function () {
      showFallback('还没有收到服务响应（' + server + '），管理员可能还没开启放映室。');
    }, READY_TIMEOUT);
  }

  function postTheme() {
    if (!server) return;
    var origin = originOf(server);
    if (!origin) return;
    try {
      frame.contentWindow.postMessage({ type: 'blog:theme', theme: currentTheme() }, origin);
    } catch (e) {
      /* iframe 还没就绪，等它自己发 ready 后再同步 */
    }
  }

  function applyTheme(theme) {
    if (theme !== 'dark' && theme !== 'light') return;
    if (window.btf && typeof window.btf.activateDarkMode === 'function') {
      if (theme === 'dark') window.btf.activateDarkMode();
      else window.btf.activateLightMode();
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      /* 隐私模式忽略 */
    }
    // MutationObserver 会跟着触发 postTheme，这里不必重复发
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;

    var origin = originOf(server);
    if (origin && ev.origin !== origin) return; // 只认自己的 iframe

    if (d.type === 'room:ready') {
      clearTimeout(readyTimer);
      if (loading) loading.hidden = true;
      fallback.hidden = true;
      postTheme();
    } else if (d.type === 'room:theme') {
      applyTheme(d.theme);
    }
  });

  // 博客自己切主题（右上角 ◐ / 主题按钮）时同步给 iframe
  if (window.MutationObserver) {
    new MutationObserver(function () {
      postTheme();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  var retryBtn = document.getElementById('sr-retry');
  if (retryBtn) retryBtn.addEventListener('click', load);

  var waitingRetry = document.getElementById('sr-waiting-retry');
  if (waitingRetry) waitingRetry.addEventListener('click', load);

  var manualBtn = document.getElementById('sr-waiting-manual');
  if (manualBtn && manualBox) {
    manualBtn.addEventListener('click', function () {
      manualBox.hidden = !manualBox.hidden;
      if (!manualBox.hidden && pasteInput) pasteInput.focus();
    });
  }

  var pasteGo = document.getElementById('sr-paste-go');
  if (pasteGo) pasteGo.addEventListener('click', submitPaste);
  if (pasteInput) {
    pasteInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitPaste();
    });
  }

  var changeBtn = document.getElementById('sr-change');
  if (changeBtn) {
    changeBtn.addEventListener('click', function () {
      var next = window.prompt('放映室服务器地址（例如 https://xxx.ts.net）', server || DEFAULT_SERVER);
      if (!next) return;
      try {
        localStorage.setItem(KEY, next.trim());
      } catch (e) {
        /* ignore */
      }
      load();
    });
  }

  load();
})();
