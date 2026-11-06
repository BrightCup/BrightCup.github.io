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

  <div class="sr-paste" id="sr-paste" hidden>
    <div class="sr-paste__title">粘贴邀请链接</div>
    <div class="sr-paste__sub">朋友发你的链接里已经带着房间号和服务器地址</div>
    <div class="sr-paste__row">
      <input id="sr-paste-input" placeholder="https://brightcup.github.io/room/?server=…&amp;invite=…">
      <button class="sr-btn sr-btn--primary" id="sr-paste-go">打开</button>
    </div>
    <div class="sr-paste__err" id="sr-paste-err"></div>
  </div>

  <div class="sr-fallback" id="sr-fallback" hidden>
    <div class="sr-fallback__title">房间服务没有响应</div>
    <div class="sr-fallback__sub" id="sr-fallback-sub"></div>
    <div class="sr-fallback__row">
      <button class="sr-btn sr-btn--primary" id="sr-retry">重试</button>
      <button class="sr-btn" id="sr-change">换个地址</button>
    </div>
    <div class="sr-fallback__hint">先在自己电脑上运行 <code>node src/index.js</code>，再回到这里点重试</div>
  </div>
</div>

<script src="/js/screening-room.js" defer></script>
