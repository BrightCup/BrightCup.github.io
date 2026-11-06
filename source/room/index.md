---
title: 放映室
date: 2026-11-06 19:30:00
layout: page
type: room
aside: false
comments: false
top_img: false
---

<link rel="stylesheet" href="/css/screening-room.css">

<div class="sr-frame-wrap" id="sr-wrap">
  <iframe id="sr-frame" title="放映室" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="no-referrer"></iframe>

  <div class="sr-loading" id="sr-loading">
    <div class="sr-loading__dot"></div>
    <div class="sr-loading__text">正在连接放映室…</div>
  </div>

  <div class="sr-waiting" id="sr-paste" hidden>
    <div class="sr-waiting__mark"></div>
    <div class="sr-waiting__title">服务关闭，等待管理员开启</div>
    <div class="sr-waiting__sub">管理员启动放映室后，这里会直接显示房间列表，选一个就能加入。</div>
    <div class="sr-waiting__row">
      <button class="sr-btn sr-btn--primary" id="sr-waiting-retry">重试</button>
      <button class="sr-btn" id="sr-waiting-manual">手动指定地址</button>
    </div>
    <div class="sr-waiting__manual" id="sr-waiting-manual-box" hidden>
      <div class="sr-waiting__manual-sub">如果你手里有管理员发的入口链接，可以粘在这里：</div>
      <div class="sr-paste__row">
        <input id="sr-paste-input" placeholder="https://brightcup.github.io/room/?server=…">
        <button class="sr-btn sr-btn--primary" id="sr-paste-go">打开</button>
      </div>
      <div class="sr-paste__err" id="sr-paste-err"></div>
    </div>
    <div class="sr-waiting__hint" id="sr-waiting-hint">进来过一次之后，浏览器会记住服务地址，下次直接点菜单就行。</div>
  </div>

  <div class="sr-waiting" id="sr-fallback" hidden>
    <div class="sr-waiting__mark"></div>
    <div class="sr-waiting__title">服务关闭，等待管理员开启</div>
    <div class="sr-waiting__sub" id="sr-fallback-sub"></div>
    <div class="sr-waiting__row">
      <button class="sr-btn sr-btn--primary" id="sr-retry">重试</button>
      <button class="sr-btn" id="sr-change">换个地址</button>
    </div>
    <div class="sr-waiting__hint">等服务开启后点「重试」即可，不需要自己填地址。</div>
  </div>
</div>

<script src="/js/screening-room.js" defer></script>
