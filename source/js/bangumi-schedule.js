/*!
 * 追番更新 (bangumi-schedule)
 * 打开页面时实时从 Bangumi 拉取「在看 / 想看」收藏，推算每部的放送进度，
 * 生成「今日更新 / 本周日历 / 放送中下一集 / 即将开播」四个板块。
 * 无后端、无构建依赖；所有日期统一按东八区计算。
 */
(function () {
  'use strict';

  /* ===================== 配置 ===================== */
  var UID = 1284189;                       // bgm.tv 用户 uid
  var API_BASES = [                        // 依次尝试，失败自动切换
    'https://bgmapi.anibt.net',
    'https://api.bgm.tv'
  ];
  var SITE_BASE = 'https://bangumi.vip';   // 番剧详情跳转域名（官网 bgm.tv 国内不可达，用镜像）
  var TZ = 'Asia/Shanghai';
  var WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  /* 构建期注入的「站内已有详情页」id 白名单（scripts/bangumi-schedule-ids.js）。
     本页数据是打开时才拉的，可能比你上次构建多出几部；那几部还没有站内详情页，
     这时退回 Bangumi 镜像，避免点进去 404。拿不到白名单时按全都有处理。 */
  var KNOWN = null;
  (function () {
    var list = window.BGM_KNOWN_IDS;
    if (!list || !list.length) return;
    KNOWN = {};
    for (var i = 0; i < list.length; i += 1) KNOWN[list[i]] = 1;
  })();

  /** 站内详情页 / Bangumi 镜像，二选一 */
  function resolveLink(id) {
    if (!KNOWN || KNOWN[id]) return { url: '/bangumis/' + id + '/', ext: false };
    return { url: SITE_BASE + '/subject/' + id, ext: true };
  }

  /* ===================== 日期工具（东八区） ===================== */
  function ymdList(s) { return s.split('-').map(Number); }
  function toUTC(s) { var a = ymdList(s); return Date.UTC(a[0], a[1] - 1, a[2]); }
  function todayStr() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  }
  function addDays(s, n) {
    var a = ymdList(s);
    var d = new Date(Date.UTC(a[0], a[1] - 1, a[2]) + n * 864e5);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function diffDays(a, b) { return Math.round((toUTC(a) - toUTC(b)) / 864e5); }
  function weekdayOf(s) { var d = new Date(toUTC(s)).getUTCDay(); return d === 0 ? 7 : d; }
  function mmdd(s) { var a = ymdList(s); return pad(a[1]) + '-' + pad(a[2]); }

  /* ===================== 数据获取 ===================== */
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function fetchCollections(type) {
    var i = 0;
    function attempt() {
      if (i >= API_BASES.length) return Promise.reject(new Error('所有 Bangumi API 均不可达'));
      var base = API_BASES[i++];
      return fetchJSON(base + '/v0/users/' + UID +
        '/collections?subject_type=2&type=' + type + '&limit=100')
        .catch(attempt);
    }
    return attempt().then(function (j) { return j.data || []; });
  }

  /* ===================== 计算单部状态 ===================== */
  function buildItem(rec) {
    var s = rec.subject || {};
    if (!s.id) return null;
    var date = s.date || '';
    var eps = s.eps || s.total_episodes || 0;
    if (!date || !eps) return null;

    var img = s.images || {};
    var link = resolveLink(s.id);
    var item = {
      id: s.id,
      name: s.name_cn || s.name || ('#' + s.id),
      cover: img.grid || img.small || img.common || img.medium || img.large || '',
      url: link.url,
      ext: link.ext,
      start: date,
      eps: eps,
      weekday: weekdayOf(date)
    };

    var today = todayStr();
    var d = diffDays(today, date);   // 距开播的天数

    if (d < 0) {
      item.state = 'upcoming';
      item.daysLeft = -d;
    } else {
      var cur = Math.floor(d / 7) + 1;   // 本周应播到第几话
      if (cur > eps) {
        item.state = 'finished';
        item.lastDate = addDays(date, 7 * (eps - 1));
      } else {
        item.state = 'airing';
        item.curEp = cur;
        item.curDate = addDays(date, 7 * (cur - 1));
        item.nextEp = cur + 1;
        item.nextDate = addDays(date, 7 * cur);
        item.daysToNext = diffDays(item.nextDate, today);
        item.isToday = (d % 7 === 0);
        item.progress = cur / eps;
      }
    }
    return item;
  }

  /* ===================== DOM 工具 ===================== */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function coverStyle(url) {
    return url ? ' style="background-image:url(' + esc(url) + ')"' : '';
  }

  /* 站外链接才新开窗口；站内详情页保持当前页跳转 */
  function extAttrs(it) {
    return it.ext ? ' target="_blank" rel="noopener"' : '';
  }

  /* 列表项：封面 + 标题 + 一行说明 */
  function itemHTML(it, meta, extraClass) {
    return '<a class="bgm-item ' + (extraClass || '') + '" href="' + esc(it.url) + '"' +
      extAttrs(it) + '>' +
      '<span class="bgm-item__cover' + (it.cover ? '' : ' is-empty') + '"' + coverStyle(it.cover) + '></span>' +
      '<span class="bgm-item__body">' +
      '<span class="bgm-item__title">' + esc(it.name) + '</span>' +
      '<span class="bgm-item__meta">' + meta + '</span>' +
      (it.state === 'airing'
        ? '<span class="bgm-bar"><i style="width:' + Math.round(it.progress * 100) + '%"></i></span>'
        : '') +
      '</span></a>';
  }

  /* ===================== 渲染 ===================== */
  function render(items) {
    var today = todayStr();
    var todayWd = weekdayOf(today);

    var airing = items.filter(function (x) { return x.state === 'airing'; });
    var upcoming = items.filter(function (x) { return x.state === 'upcoming'; });
    var finished = items.filter(function (x) { return x.state === 'finished'; });

    /* --- 今日更新 --- */
    var todayList = airing.filter(function (x) { return x.isToday; })
      .sort(function (a, b) { return a.id - b.id; });
    var boxToday = document.getElementById('bgm-today');
    if (todayList.length) {
      boxToday.classList.remove('is-empty');
      boxToday.innerHTML = todayList.map(function (it) {
        return itemHTML(it, '第 <b>' + it.curEp + '</b> 话已更新 · 共 ' + it.eps + ' 话', 'bgm-item--today');
      }).join('');
    } else {
      boxToday.classList.add('is-empty');
      boxToday.innerHTML = '<div class="bgm-empty">今天没有你的追番更新，好好休息 ~</div>';
    }
    document.getElementById('bgm-today-date').textContent =
      mmdd(today) + ' ' + WEEK_CN[todayWd - 1];

    /* --- 本周日历 --- */
    var monday = addDays(today, -(todayWd - 1));
    var weekHtml = '';
    for (var i = 0; i < 7; i++) {
      var dayDate = addDays(monday, i);
      var wd = i + 1;
      var dayItems = [];

      airing.forEach(function (it) {
        if (it.weekday === wd) {
          // 该天播出的是第几话（按开播日推算），而非「今天已播到第几话」
          var ep = Math.floor(diffDays(dayDate, it.start) / 7) + 1;
          if (ep < 1 || ep > it.eps) return;
          dayItems.push('<a class="bgm-chip" href="' + esc(it.url) + '"' + extAttrs(it) + '>' +
            esc(it.name) + '<i>第' + ep + '话</i></a>');
        }
      });
      upcoming.forEach(function (it) {
        if (it.weekday === wd && diffDays(it.start, monday) >= 0 && diffDays(it.start, monday) < 7) {
          dayItems.push('<a class="bgm-chip is-new" href="' + esc(it.url) + '"' + extAttrs(it) + '>' +
            esc(it.name) + '<i>首播</i></a>');
        }
      });

      weekHtml += '<div class="bgm-week__day' + (dayDate === today ? ' is-today' : '') + '">' +
        '<div class="bgm-week__hd"><span>' + WEEK_CN[i] + '</span><em>' + mmdd(dayDate) + '</em></div>' +
        '<div class="bgm-week__items">' +
        (dayItems.length ? dayItems.join('') : '<span class="bgm-week__none">—</span>') +
        '</div></div>';
    }
    document.getElementById('bgm-week').innerHTML = weekHtml;
    document.getElementById('bgm-week-range').textContent =
      mmdd(monday) + ' ~ ' + mmdd(addDays(monday, 6));

    /* --- 放送中 · 下一集 --- */
    airing.sort(function (a, b) { return a.daysToNext - b.daysToNext || a.id - b.id; });
    var boxAiring = document.getElementById('bgm-airing');
    if (airing.length) {
      boxAiring.innerHTML = airing.map(function (it) {
        var when = it.daysToNext === 0 ? '今天更新'
          : (it.daysToNext === 1 ? '明天更新' : '还有 ' + it.daysToNext + ' 天');
        return itemHTML(it,
          '已更新 <b>' + it.curEp + '</b>/' + it.eps + ' 话 · 下一话 ' + mmdd(it.nextDate) +
          ' <em class="bgm-when">' + when + '</em>');
      }).join('');
    } else {
      boxAiring.innerHTML = '<div class="bgm-empty">当前没有正在放送的追番</div>';
    }

    /* --- 即将开播 --- */
    upcoming.sort(function (a, b) { return a.daysLeft - b.daysLeft || a.id - b.id; });
    var boxUp = document.getElementById('bgm-upcoming');
    if (upcoming.length) {
      boxUp.innerHTML = upcoming.map(function (it) {
        var when = it.daysLeft === 1 ? '明天开播' : '还有 ' + it.daysLeft + ' 天';
        return itemHTML(it, mmdd(it.start) + ' 开播 · 共 ' + it.eps + ' 话 <em class="bgm-when">' + when + '</em>');
      }).join('');
    } else {
      boxUp.innerHTML = '<div class="bgm-empty">暂无待开播的番剧</div>';
    }

    /* --- 页脚统计 --- */
    var stat = document.getElementById('bgm-stat');
    if (stat) {
      stat.textContent = '在看 ' + airing.length + ' 部放送中 · 待开播 ' + upcoming.length +
        ' 部 · 已完结 ' + finished.length + ' 部';
    }
  }

  /* ===================== 启动 ===================== */
  function boot() {
    var loading = document.getElementById('bgm-loading');
    var body = document.getElementById('bgm-body');
    var errBox = document.getElementById('bgm-err');

    Promise.all([fetchCollections(3), fetchCollections(1)])
      .then(function (res) {
        var seen = {};
        var items = [];
        res[0].concat(res[1]).forEach(function (rec) {
          var it = buildItem(rec);
          if (it && !seen[it.id]) { seen[it.id] = 1; items.push(it); }
        });
        if (!items.length) throw new Error('没有取到任何番剧数据');
        render(items);
        loading.hidden = true;
        body.hidden = false;
        document.getElementById('bgm-updated').textContent =
          new Intl.DateTimeFormat('zh-CN', {
            timeZone: TZ, month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
          }).format(new Date()) + ' 更新';
      })
      .catch(function (e) {
        loading.hidden = true;
        errBox.hidden = false;
        errBox.textContent = '获取 Bangumi 数据失败：' + (e && e.message ? e.message : e) +
          '（可能是网络或镜像站不可达，稍后刷新重试）';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
