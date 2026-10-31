/* global window, document, localStorage, fetch */
'use strict';

/**
 * 番剧详情页的交互层。
 *
 * 流程：
 *   改状态/进度/评分/短评 → 写入 localStorage（本机草稿，立刻可见）
 *   → 点「同步到 Bangumi」→ 把这次改动合并进仓库里的 queue.json 并触发 workflow
 *   → GitHub Actions 用保管在仓库里的 token 调 Bangumi 接口写回（1~2 分钟）
 *   → 站点重建后，页面上的服务端数据（updated_at）变了，草稿自动作废
 *
 * 为什么不在浏览器里直接调 Bangumi：它的 CORS 只放行 Accept/Content-Type，
 * 不允许 Authorization 头，任何带 token 的跨域写请求都会被预检拦掉。
 */

(function () {
  var payloadEl = document.getElementById('bgm-payload');
  if (!payloadEl) return;

  var BASE;
  try {
    BASE = JSON.parse(payloadEl.textContent);
  } catch (err) {
    return;
  }

  var SUBJECT_ID = BASE.id;
  var EP_IDS = (BASE.eps || []).map(function (ep) { return ep.id; });
  var DRAFT_KEY = 'bgmDraft:' + SUBJECT_ID;
  var CFG_KEY = 'bgmSyncCfg';
  var QUEUE_PATH = 'source/_data/bangumis/queue.json';
  var WORKFLOW = 'bangumi-sync.yml';

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var initial = {
    type: BASE.type || 0,
    rate: BASE.rate || 0,
    comment: BASE.comment || '',
    watched: EP_IDS.slice(0, BASE.epStatus || 0)
  };

  var state = clone(initial);
  var draft = readDraft();

  // 服务端数据变过（说明这次的改动已经写回）→ 丢掉旧草稿
  if (draft && draft.baseUpdatedAt && draft.baseUpdatedAt !== BASE.updatedAt) {
    clearDraft();
    draft = null;
  }
  if (draft) {
    state.type = draft.type;
    state.rate = draft.rate;
    state.comment = draft.comment;
    state.watched = EP_IDS.filter(function (id) {
      return (draft.watched || []).indexOf(id) >= 0;
    });
  }

  // ---------- 工具 ----------

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function readDraft() {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    } catch (err) {
      return null;
    }
  }

  function saveDraft(submittedAt) {
    var payload = {
      type: state.type,
      rate: state.rate,
      comment: state.comment,
      watched: state.watched.slice(),
      at: Date.now(),
      baseUpdatedAt: BASE.updatedAt || '',
      submittedAt: submittedAt || 0
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch (err) {
      /* 隐私模式下写不进去，忽略 */
    }
    draft = payload;
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      /* ignore */
    }
    draft = null;
  }

  function readCfg() {
    try {
      var cfg = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
      if (!cfg || !cfg.token || !cfg.owner || !cfg.repo) return null;
      cfg.branch = cfg.branch || 'main';
      return cfg;
    } catch (err) {
      return null;
    }
  }

  function setStatus(stateName, text) {
    var el = $('#bgm-state');
    if (!el) return;
    el.dataset.state = stateName;
    el.textContent = text;
  }

  function setTip(text) {
    var el = $('#bgm-tip');
    if (el && text) el.textContent = text;
  }

  function dirty() {
    return state.type !== initial.type ||
      state.rate !== initial.rate ||
      (state.comment || '') !== (initial.comment || '') ||
      state.watched.length !== initial.watched.length ||
      state.watched.some(function (id) { return initial.watched.indexOf(id) < 0; });
  }

  // ---------- 渲染 ----------

  function renderStatus() {
    $$('#bgm-status button').forEach(function (btn) {
      btn.classList.toggle('is-active', Number(btn.dataset.type) === state.type);
    });
  }

  function renderRate() {
    $$('#bgm-rate button[data-rate]').forEach(function (btn) {
      btn.classList.toggle('is-active', Number(btn.dataset.rate) === state.rate);
    });
  }

  function renderProgress() {
    var n = state.watched.length;
    var numEl = $('#bgm-prog-num');
    if (numEl) numEl.textContent = n;
    var countEl = $('#bgm-ep-count');
    if (countEl) countEl.textContent = n + ' / ' + EP_IDS.length;
  }

  function renderEpisodes() {
    var boxes = $$('#bgm-eps input[data-ep]');
    boxes.forEach(function (box) {
      var on = state.watched.indexOf(Number(box.dataset.ep)) >= 0;
      box.checked = on;
      var row = box.closest('.bgm-ep');
      if (row) row.classList.toggle('is-watched', on);
    });
  }

  function renderAll() {
    renderStatus();
    renderRate();
    renderProgress();
    renderEpisodes();
  }

  /**
   * 更新「未修改 / 有改动 / 已提交」这行提示。
   * isEdit=true 表示这次刷新来自用户刚做的修改（会把「已提交」状态清掉），
   * 页面加载时则是 false，保留上次提交的时间点。
   */
  function refreshDirty(isEdit) {
    if (!dirty()) {
      clearDraft();
      setStatus('idle', '未修改');
      return;
    }
    var submittedAt = isEdit ? 0 : (draft && draft.submittedAt) || 0;
    saveDraft(submittedAt);
    if (submittedAt) {
      var mins = Math.round((Date.now() - submittedAt) / 60000);
      setStatus('busy', '已提交，等待写回' + (mins > 0 ? '（' + mins + ' 分钟前）' : ''));
    } else {
      setStatus('dirty', '有未同步的改动');
    }
  }

  // ---------- 交互 ----------

  var statusWrap = $('#bgm-status');
  if (statusWrap) {
    statusWrap.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-type]');
      if (!btn) return;
      state.type = Number(btn.dataset.type);
      renderStatus();
      refreshDirty(true);
    });
  }

  var rateWrap = $('#bgm-rate');
  if (rateWrap) {
    rateWrap.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      if (btn.id === 'bgm-rate-clear') {
        state.rate = 0;
      } else if (btn.dataset.rate) {
        var val = Number(btn.dataset.rate);
        state.rate = state.rate === val ? 0 : val;
      } else {
        return;
      }
      renderRate();
      refreshDirty(true);
    });
  }

  var prog = $('.bgm-prog');
  if (prog) {
    prog.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;

      if (btn.id === 'bgm-prog-all') {
        state.watched = EP_IDS.slice();
      } else if (btn.dataset.step) {
        var step = Number(btn.dataset.step);
        var n = state.watched.length;
        if (step > 0) {
          var next = EP_IDS[n];
          if (next != null) state.watched = EP_IDS.slice(0, n + 1);
        } else {
          state.watched = EP_IDS.slice(0, Math.max(0, n - 1));
        }
      } else {
        return;
      }
      renderProgress();
      renderEpisodes();
      refreshDirty(true);
    });
  }

  var epsWrap = $('#bgm-eps');
  if (epsWrap) {
    epsWrap.addEventListener('change', function (e) {
      var box = e.target.closest('input[data-ep]');
      if (!box) return;
      var epId = Number(box.dataset.ep);
      var idx = state.watched.indexOf(epId);
      if (box.checked && idx < 0) state.watched.push(epId);
      if (!box.checked && idx >= 0) state.watched.splice(idx, 1);
      // 保持分集顺序，避免 PATCH 时顺序乱掉
      state.watched.sort(function (a, b) { return EP_IDS.indexOf(a) - EP_IDS.indexOf(b); });
      var row = box.closest('.bgm-ep');
      if (row) row.classList.toggle('is-watched', box.checked);
      renderProgress();
      refreshDirty(true);
    });
  }

  var commentEl = $('#bgm-comment');
  if (commentEl) {
    commentEl.value = state.comment;
    commentEl.addEventListener('input', function () {
      state.comment = commentEl.value;
      refreshDirty(true);
    });
  }

  var resetBtn = $('#bgm-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      clearDraft();
      state = clone(initial);
      if (commentEl) commentEl.value = state.comment;
      renderAll();
      setStatus('idle', '未修改');
    });
  }

  // ---------- 同步 ----------

  function toBase64(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return window.btoa(bin);
  }

  function fromBase64(b64) {
    var bin = window.atob(b64.replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function gh(cfg, path, options) {
    options = options || {};
    return fetch('https://api.github.com' + path, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + cfg.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (err) { data = null; }
        if (!res.ok) {
          var msg = (data && data.message) || ('HTTP ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /** 把这次改动合并进 queue.json，并触发同步 workflow */
  function submit(cfg) {
    var op = {
      type: state.type || 0,
      rate: state.rate || 0,
      comment: state.comment || '',
      watched: state.watched.slice(),
      epTotal: EP_IDS.length,
      at: new Date().toISOString()
    };

    var queuePath = '/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + QUEUE_PATH;

    return gh(cfg, queuePath + '?ref=' + encodeURIComponent(cfg.branch))
      .catch(function (err) {
        // 队列文件还没被创建过：当成空队列处理
        if (err.status === 404) return null;
        throw err;
      })
      .then(function (file) {
        var queue = { ops: {}, updatedAt: '' };
        if (file && file.content) {
          try {
            queue = JSON.parse(fromBase64(file.content)) || queue;
          } catch (err) {
            queue = { ops: {}, updatedAt: '' };
          }
        }
        queue.ops = queue.ops || {};
        queue.ops[SUBJECT_ID] = op;
        queue.updatedAt = op.at;

        // 只保留最近 7 天、且最多 200 条，避免文件无限增长
        var cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        Object.keys(queue.ops).forEach(function (key) {
          var at = Date.parse(queue.ops[key].at || '');
          if (!isFinite(at) || at < cutoff) delete queue.ops[key];
        });

        var body = {
          message: 'chore(bangumi): 排队同步 #' + SUBJECT_ID,
          content: toBase64(JSON.stringify(queue, null, 2) + '\n'),
          branch: cfg.branch
        };
        if (file && file.sha) body.sha = file.sha;
        return gh(cfg, queuePath, { method: 'PUT', body: body });
      })
      .then(function () {
        return gh(cfg, '/repos/' + cfg.owner + '/' + cfg.repo +
          '/actions/workflows/' + WORKFLOW + '/dispatches', {
          method: 'POST',
          body: { ref: cfg.branch }
        });
      });
  }

  var syncBtn = $('#bgm-sync');
  if (syncBtn) {
    syncBtn.addEventListener('click', function () {
      if (!dirty()) {
        setStatus('idle', '没有需要同步的改动');
        return;
      }
      var cfg = readCfg();
      if (!cfg) {
        openSettings();
        setStatus('error', '先完成同步设置');
        return;
      }

      syncBtn.disabled = true;
      setStatus('busy', '正在提交…');
      var submittedAt = Date.now();

      submit(cfg)
        .then(function () {
          saveDraft(submittedAt);
          setStatus('busy', '已提交，等待写回');
          setTip('已交给 GitHub Actions，约 1~2 分钟后可在 Bangumi 上看到');
        })
        .catch(function (err) {
          var text = err.message || '提交失败';
          if (err.status === 401 || err.status === 403) {
            text = '令牌无效或权限不足（需要 Contents 与 Actions 的读写权限）';
          } else if (err.status === 404) {
            text = '找不到仓库或 workflow，检查设置里的用户名/仓库名';
          } else if (err.status === 409) {
            text = '队列文件正在被占用，稍后再试一次';
          }
          setStatus('error', text);
          setTip(text);
        })
        .then(function () {
          syncBtn.disabled = false;
        });
    });
  }

  // ---------- 设置弹层 ----------

  function openSettings() {
    var cfg = readCfg() || {};
    var wrap = document.createElement('div');
    wrap.className = 'bgm-modal';
    wrap.innerHTML =
      '<div class="bgm-modal__box" role="dialog" aria-modal="true" aria-label="同步设置">' +
      '<h3>同步设置</h3>' +
      '<p>需要一个只能访问这个仓库的 GitHub 令牌，用来把改动排进同步队列。' +
      '令牌只保存在这台设备的浏览器里，不会上传到任何地方。' +
      '在 GitHub → Settings → Developer settings → Fine-grained tokens 新建，' +
      '只勾选本仓库的 <b>Contents: Read and write</b> 与 <b>Actions: Read and write</b>。</p>' +
      '<p>第一次用？先走一遍 <a href="/bangumi-auth/" target="_blank" rel="noopener">授权向导</a>，' +
      '让 GitHub Actions 拿到写 Bangumi 的权限。</p>' +
      '<label>用户名 / 组织<input id="bgm-cfg-owner" value="' + escapeAttr(cfg.owner || 'BrightCup') + '" autocomplete="off"></label>' +
      '<label>仓库名<input id="bgm-cfg-repo" value="' + escapeAttr(cfg.repo || 'BrightCup.github.io') + '" autocomplete="off"></label>' +
      '<label>分支<input id="bgm-cfg-branch" value="' + escapeAttr(cfg.branch || 'main') + '" autocomplete="off"></label>' +
      '<label>GitHub 令牌<input id="bgm-cfg-token" type="password" placeholder="github_pat_..." autocomplete="off"></label>' +
      '<div class="bgm-modal__acts">' +
      '<button type="button" class="bgm-btn bgm-btn--primary" id="bgm-cfg-save">保存</button>' +
      '<button type="button" class="bgm-btn" id="bgm-cfg-cancel">取消</button>' +
      '</div>' +
      '</div>';
    // 挂进 .bgm-d 里，才能继承那里定义的一套 CSS 变量（挂 body 上会丢主题色）
    var host = document.getElementById('bgm-detail') || document.body;
    host.appendChild(wrap);

    var tokenEl = wrap.querySelector('#bgm-cfg-token');
    if (cfg.token) tokenEl.value = cfg.token;

    function close() {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) close();
    });
    wrap.querySelector('#bgm-cfg-cancel').addEventListener('click', close);
    wrap.querySelector('#bgm-cfg-save').addEventListener('click', function () {
      var next = {
        owner: wrap.querySelector('#bgm-cfg-owner').value.trim(),
        repo: wrap.querySelector('#bgm-cfg-repo').value.trim(),
        branch: wrap.querySelector('#bgm-cfg-branch').value.trim() || 'main',
        token: tokenEl.value.trim()
      };
      if (!next.owner || !next.repo || !next.token) {
        setStatus('error', '三个字段都要填');
        return;
      }
      try {
        localStorage.setItem(CFG_KEY, JSON.stringify(next));
      } catch (err) {
        setStatus('error', '浏览器不允许写入本地存储');
        return;
      }
      close();
      setStatus(dirty() ? 'dirty' : 'idle', dirty() ? '有未同步的改动' : '未修改');
      setTip('设置已保存，改完点「同步到 Bangumi」即可');
    });
  }

  function escapeAttr(text) {
    return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  var setupBtn = $('#bgm-setup');
  if (setupBtn) setupBtn.addEventListener('click', openSettings);

  // ---------- 初始化 ----------

  renderAll();
  refreshDirty();
  if (!readCfg()) {
    setTip('还没配置 GitHub 令牌，点「同步设置」一次即可');
  }
})();
