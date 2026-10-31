---
title: Bangumi 授权
date: 2026-10-31 10:00:00
layout: page
type: page
comments: false
---

<link rel="stylesheet" href="/css/bangumi-auth.css">

<div class="bgm-auth" id="bgm-auth">
  <p class="bgm-auth__lead">
    这一步只做一次。完成后，追番列表里每部番剧的详情页都能直接改状态、进度、评分和短评，
    点同步就写回 Bangumi，不用再打开它的网站。
  </p>

  <div class="bgm-auth__code" id="bgm-auth-code" hidden>
    <h2>拿到了授权码</h2>
    <p>复制下面这串，去 Actions 跑一次 <b>Bangumi Auth</b>，粘进 <code>code</code> 输入框。</p>
    <div class="bgm-auth__codewrap">
      <code id="bgm-code-value"></code>
      <button type="button" id="bgm-code-copy">复制</button>
    </div>
    <p><a id="bgm-code-run" href="https://github.com/BrightCup/BrightCup.github.io/actions/workflows/bangumi-auth.yml" target="_blank" rel="noopener">打开 Bangumi Auth workflow ↗</a></p>
    <p class="bgm-auth__hint">授权码只能用一次，几分钟内失效。跑完 workflow 后这串就没用了。</p>
  </div>

  <section class="bgm-auth__step">
    <h2><span>1</span>在 Bangumi 建一个应用</h2>
    <p>打开 <a href="https://bgm.tv/dev/app" target="_blank" rel="noopener">bgm.tv/dev/app</a>
      （国内打不开就用镜像 <a href="https://bangumi.vip/dev/app" target="_blank" rel="noopener">bangumi.vip/dev/app</a>，
      需要过人机验证），点「创建应用」，只填两项：</p>
    <ul>
      <li>应用名：随便，比如 <code>BrightCup 追番</code></li>
      <li>回调地址：<code>https://brightcup.github.io/bangumi-auth/</code></li>
    </ul>
    <p>创建完会拿到 <b>App ID</b> 和 <b>App Secret</b>，下面要用。</p>
    <label class="bgm-auth__field">App ID（只存在这台设备，用来拼授权链接）
      <input id="bgm-app-id" type="text" placeholder="比如 1a2b3c4d5e6f..." autocomplete="off" spellcheck="false">
    </label>
  </section>

  <section class="bgm-auth__step">
    <h2><span>2</span>把三个值填进仓库 Secrets</h2>
    <p>到 <a id="bgm-secrets" href="https://github.com/BrightCup/BrightCup.github.io/settings/secrets/actions" target="_blank" rel="noopener">Settings → Secrets and variables → Actions</a>
      新建三个 secret：</p>
    <ul>
      <li><code>BGM_CLIENT_ID</code> = 上面的 App ID</li>
      <li><code>BGM_CLIENT_SECRET</code> = 上面的 App Secret</li>
      <li><code>BGM_KEY</code> = 下面生成的加密密钥（用来加密保管 token，别丢了，丢了要重新授权）</li>
    </ul>
    <div class="bgm-auth__key">
      <code id="bgm-key">—</code>
      <button type="button" id="bgm-key-gen">生成</button>
      <button type="button" id="bgm-key-copy">复制</button>
    </div>
  </section>

  <section class="bgm-auth__step">
    <h2><span>3</span>授权一次</h2>
    <p>点下面的按钮去 Bangumi 授权（登录后会自动跳回本页，并把 code 显示在最上面）。
      打不开主站就用镜像那条。</p>
    <p class="bgm-auth__acts">
      <a class="bgm-auth__btn" id="bgm-go-main" href="#" target="_blank" rel="noopener">用 bgm.tv 授权</a>
      <a class="bgm-auth__btn is-ghost" id="bgm-go-mirror" href="https://bangumi.vip/" target="_blank" rel="noopener">用 bangumi.vip 镜像</a>
    </p>
    <p class="bgm-auth__hint">授权页要的是「读+写收藏」的权限；本页只负责把 code 转给 Actions，token 不会经过浏览器。</p>
  </section>

  <section class="bgm-auth__step">
    <h2><span>4</span>最后一步：配 GitHub 令牌</h2>
    <p>回到任意一部番剧的详情页，点「同步设置」，填一个只能访问本仓库的 fine-grained token
      （权限只要 <b>Contents: Read and write</b> 与 <b>Actions: Read and write</b>）。
      它只存在你自己的浏览器里，用来把改动排进队列。</p>
  </section>
</div>

<script src="/js/bangumi-auth.js" defer></script>
