---
title: 追番更新
date: 2026-10-13 13:06:00
layout: page
type: page
comments: false
---

<link rel="stylesheet" href="/css/bangumi-schedule.css">

<div class="bgm-sched">
  <div class="bgm-sched__loading" id="bgm-loading">正在从 Bangumi 获取追番进度…</div>
  <div id="bgm-body" hidden>
    <section class="bgm-card">
      <div class="bgm-card__hd">
        <h3>今日更新</h3>
        <span class="bgm-card__hint" id="bgm-today-date"></span>
      </div>
      <div class="bgm-list" id="bgm-today"></div>
    </section>
    <section class="bgm-card">
      <div class="bgm-card__hd">
        <h3>本周放送日历</h3>
        <span class="bgm-card__hint" id="bgm-week-range"></span>
      </div>
      <div class="bgm-week" id="bgm-week"></div>
    </section>
    <section class="bgm-card">
      <div class="bgm-card__hd">
        <h3>放送中 · 下一集</h3>
        <span class="bgm-card__hint">按剩余时间排序</span>
      </div>
      <div class="bgm-list" id="bgm-airing"></div>
    </section>
    <section class="bgm-card">
      <div class="bgm-card__hd">
        <h3>即将开播</h3>
        <span class="bgm-card__hint">来自「想看 / 在看」</span>
      </div>
      <div class="bgm-list" id="bgm-upcoming"></div>
    </section>
    <div class="bgm-sched__foot">
      <span id="bgm-stat"></span> · <span id="bgm-updated"></span>
    </div>
  </div>
  <div class="bgm-sched__err" id="bgm-err" hidden></div>
</div>

<script src="/js/bangumi-schedule.js" defer></script>
