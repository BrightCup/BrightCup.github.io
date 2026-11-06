/*!
 * 放映室的博客侧外壳（/room/）
 *
 * 1. 决定 iframe 指向哪个服务地址：
 *    - URL 里显式带 ?server= → 用它（旧邀请链接兼容，失败不自动篡改）
 *    - 线上固定入口（不带参数）→ 读博客仓库里的「地址公告板」room/server.json
 *    - 本地开发 → 127.0.0.1:8787
 * 2. 等 iframe 里的 `room:ready` 握手；5 秒收不到就出兜底页并自动重连
 * 3. 博客与 iframe 的深浅色双向同步
 *
 * 为什么不靠 iframe 的 onload：跨域加载失败（连接被拒绝）也会触发 onload，
 * 拿不到任何内容，只能靠握手消息判断服务到底通不通。
 *
 * 为什么读 GitHub API 而不是等 Pages 构建：服务端更新地址时用 [skip ci] 提交，
 * 不跑 Hexo CI；这里直接读仓库里的文件（API / raw 双通道），push 完就能拿到，
 * 同源的 /room/server.json 只作为兜底（它只在正常构建后才更新）。
 */
(function () {
  'use strict';

  var DEFAULT_SERVER = 'http://127.0.0.1:8787'; // 本地开发兜底
  var KEY = 'sr:server';
  var READY_TIMEOUT = 5000;
  var RETRY_MS = 10000;

  var REPO_PATH = 'source/room/server.json';
  var REPO_API = 'https://api.github.com/repos/BrightCup/BrightCup.github.io/contents/' + REPO_PATH + '?ref=main';
  var REPO_RAW = 'https://raw.githubusercontent.com/BrightCup/BrightCup.github.io/main/' + REPO_PATH;
  var SAME_ORIGIN = '/room/server.json';

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
  var autoTimer = null;
  var explicitServer = false;
  var isLocalDev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var forceDiscover = false;
  try {
    forceDiscover = new URLSearchParams(location.search).get('discover') === '1';
  } catch (e) { /* ignore */ }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  /** 带超时的 JSON 抓取；GitHub API 默认返回 base64，要解开 */
  async function fetchOne(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 5000) : null;
    try {
      var sep = url.indexOf('?') >= 0 ? '&' : '?';
      var r = await fetch(url + sep + 't=' + Date.now(), {
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!r.ok) return null;
      var j = await r.json();
      if (j && j.content && j.encoding === 'base64') {
        var bin = atob(String(j.content).replace(/\s/g, ''));
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        j = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      }
      if (!j || typeof j.server !== 'string') return null;
      return j;
    } catch (e) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 三通道并行，取 updatedAt 最新的那条公告，任一失败都不影响其它 */
  async function discover() {
    var all = await Promise.all([
      fetchOne(REPO_API),
      fetchOne(REPO_RAW),
      fetchOne(SAME_ORIGIN)
    ]);
    var best = null;
    all.forEach(function (j) {
      if (!j) return;
      if (!best || String(j.updatedAt || '') > String(best.updatedAt || '')) best = j;
    });
    return best;
  }

  async function resolveServer() {
    var q = '';
    try { q = new URLSearchParams(location.search).get('server') || ''; } catch (e) { /* ignore */ }
    explicitServer = !!q;
    if (q) {
      try { localStorage.setItem(KEY, q); } catch (e) { /* ignore */ }
      return q;
    }

    // 线上（或显式 ?discover=1）才去读公告板；本地开发保持原来的本机直连
    if (!isLocalDev || forceDiscover) {
      var ann = await discover();
      if (ann) {
        if (ann.online === false) return ''; // 管理员主动关了服务
        if (/^https?:\/\//i.test(ann.server)) {
          try { localStorage.setItem(KEY, ann.server); } catch (e) { /* ignore */ }
          return ann.server;
        }
      }
    }
    if (isLocalDev) return DEFAULT_SERVER;

    var saved = '';
    try { saved = localStorage.getItem(KEY) || ''; } catch (e) { /* ignore */ }
    return saved; // 公告板全挂时至少还有上次记住的地址
  }

  function scheduleAutoRetry() {
    clearTimeout(autoTimer);
    // 显式 ?server= 是别人发的定向链接，过期了交给「转到最新入口」按钮，
    // 不擅自把用户指定的地址换掉
    if (explicitServer) return;
    autoTimer = setTimeout(load, RETRY_MS);
  }

  /** 服务没开 / 还没有地址：统一的等待页，默认不要求用户填任何东西 */
  function showWaiting(msg) {
    if (loading) loading.hidden = true;
    fallback.hidden = true;
    if (paste) paste.hidden = false;
    if (msg && waitingHint) waitingHint.textContent = msg;
    else if (waitingHint) {
      waitingHint.textContent = '管理员开启放映室后会自动连上，不用重新输入网址；也可以点「重试」立刻再试。';
    }
    if (pasteErr) pasteErr.textContent = '';
    scheduleAutoRetry();
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
    try { localStorage.setItem(KEY, serverVal.replace(/\/+$/, '')); } catch (e) { /* ignore */ }
    if (inviteVal) pendingInvite = inviteVal;
    if (paste) paste.hidden = true;
    explicitServer = true; // 手动指定的地址按显式链接处理
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
    var retry = document.getElementById('sr-retry');
    if (retry) retry.textContent = explicitServer ? '转到最新入口' : '重试';
    scheduleAutoRetry();
  }

  async function load() {
    clearTimeout(readyTimer);
    clearTimeout(autoTimer);
    fallback.hidden = true;
    if (paste) paste.hidden = true;
    if (loading) loading.hidden = false;

    server = (await resolveServer()).replace(/\/+$/, '');

    // 还没有任何地址来源：显示等待页，不再逼人粘贴链接
    if (!server) {
      showWaiting();
      return;
    }
    if (!/^https?:\/\//i.test(server)) {
      showWaiting('记下的服务地址格式不对，等服务开启后会自动重连。');
      return;
    }
    if (mixedBlocked(server)) {
      showFallback('博客是 HTTPS，浏览器不允许嵌套 http 地址；管理员开启 https 隧道后会自动重连。');
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
      showFallback(
        explicitServer
          ? '这个入口链接已过期（' + server + '）。点「转到最新入口」会自动换成管理员刚发布的新地址。'
          : '还没有收到服务响应（' + server + '），管理员可能还没开启放映室。'
      );
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
      clearTimeout(autoTimer);
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

  /** 过期链接点一下就换成最新公告地址，保留 invite 参数 */
  function retryClick() {
    if (explicitServer) {
      try {
        var u = new URL(location.href);
        u.searchParams.delete('server');
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) { /* ignore */ }
      explicitServer = false;
      var btn = document.getElementById('sr-retry');
      if (btn) btn.textContent = '重试';
    }
    load();
  }

  var retryBtn = document.getElementById('sr-retry');
  if (retryBtn) retryBtn.addEventListener('click', retryClick);
  var waitingRetry = document.getElementById('sr-waiting-retry');
  if (waitingRetry) waitingRetry.addEventListener('click', retryClick);

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
      var next = window.prompt('放映室服务器地址（例如 https://xxx.trycloudflare.com）', server || DEFAULT_SERVER);
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
