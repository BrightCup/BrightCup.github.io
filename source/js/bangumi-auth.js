/* global window, document, location, localStorage, crypto */
'use strict';

/**
 * 授权向导页的交互。
 *
 * 只做三件小事：
 * - 把 URL 上的 ?code= 挖出来显示，方便复制到 Actions
 * - 让用户填一次 App ID，拼出授权链接（App ID 是公开信息，存本机即可）
 * - 生成一枚 32 字节随机密钥当作 BGM_KEY
 *
 * 这里刻意不碰 client_secret，也不碰 token —— 换 token 只发生在 GitHub Actions 里。
 */

(function () {
  var root = document.getElementById('bgm-auth');
  if (!root) return;

  var REDIRECT = 'https://brightcup.github.io/bangumi-auth/';
  var ID_KEY = 'bgmAppId';

  var $ = function (sel) { return document.querySelector(sel); };

  // ---------- 授权码 ----------

  var codeMatch = /[?&]code=([^&#]+)/.exec(location.search);
  if (codeMatch) {
    var code = decodeURIComponent(codeMatch[1]);
    var box = $('#bgm-auth-code');
    var valueEl = $('#bgm-code-value');
    if (box && valueEl) {
      valueEl.textContent = code;
      box.hidden = false;
      if (typeof box.scrollIntoView === 'function') {
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    var copyBtn = $('#bgm-code-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copy(code, copyBtn);
      });
    }
  }

  // ---------- App ID 与授权链接 ----------

  var input = $('#bgm-app-id');
  var goMain = $('#bgm-go-main');
  var goMirror = $('#bgm-go-mirror');

  function buildUrl(base, clientId) {
    return base + '/oauth/authorize?client_id=' + encodeURIComponent(clientId) +
      '&response_type=code&redirect_uri=' + encodeURIComponent(REDIRECT) +
      '&state=brightcup';
  }

  function refreshLinks() {
    var clientId = (input.value || '').trim();
    if (!clientId) {
      goMain.href = '#';
      goMain.setAttribute('aria-disabled', 'true');
      goMirror.href = 'https://bangumi.vip/dev/app';
      return;
    }
    goMain.href = buildUrl('https://bgm.tv', clientId);
    goMirror.href = buildUrl('https://bangumi.vip', clientId);
    goMain.removeAttribute('aria-disabled');
  }

  if (input) {
    try {
      input.value = localStorage.getItem(ID_KEY) || '';
    } catch (err) {
      /* ignore */
    }
    input.addEventListener('input', function () {
      try {
        localStorage.setItem(ID_KEY, input.value.trim());
      } catch (err) {
        /* ignore */
      }
      refreshLinks();
    });
    refreshLinks();
  }

  // ---------- BGM_KEY ----------

  var keyEl = $('#bgm-key');
  var genBtn = $('#bgm-key-gen');
  var keyCopy = $('#bgm-key-copy');

  if (genBtn) {
    genBtn.addEventListener('click', function () {
      var bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      var hex = Array.prototype.map.call(bytes, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
      keyEl.textContent = hex;
    });
  }

  if (keyCopy) {
    keyCopy.addEventListener('click', function () {
      var text = keyEl.textContent || '';
      if (!text || text === '—' || text.length < 32) return;
      copy(text, keyCopy);
    });
  }

  // ---------- 复制 ----------

  function copy(text, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = old; }, 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallback(text, done);
      });
    } else {
      fallback(text, done);
    }
  }

  function fallback(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (err) {
      /* ignore */
    }
    document.body.removeChild(ta);
  }
})();
