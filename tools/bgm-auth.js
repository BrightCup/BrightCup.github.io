#!/usr/bin/env node
/**
 * 一次性授权：把「授权码」换成 access_token / refresh_token 并加密存进仓库。
 *
 * 用法（在 Actions 的 Bangumi Auth workflow 里跑，不在你本地跑 ——
 * 本地多半连不上 bgm.tv 的 token 接口，而 runner 可以）：
 *   node tools/bgm-auth.js <code>
 *
 * 需要环境变量：BGM_CLIENT_ID / BGM_CLIENT_SECRET / BGM_KEY（三者都是仓库 secret）
 *
 * 为什么不在浏览器里换 token：Bangumi 的 OAuth 不支持 PKCE，换 token 必须带
 * client_secret，把它放进网页等于公开。所以授权码只负责「换」，密钥只在 runner 里用。
 */

'use strict';

const { saveToken } = require('./bgm-token');

const TOKEN_URL = 'https://bgm.tv/oauth/access_token';
const UA = 'BrightCup-blog/1.0 (https://github.com/BrightCup)';

async function main() {
  const code = (process.argv[2] || '').trim();
  if (!code) throw new Error('缺少授权码：node tools/bgm-auth.js <code>');

  const clientId = (process.env.BGM_CLIENT_ID || '').trim();
  const clientSecret = (process.env.BGM_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('缺少 BGM_CLIENT_ID / BGM_CLIENT_SECRET');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
    redirect_uri: process.env.BGM_REDIRECT_URI || 'https://brightcup.github.io/bangumi-auth/'
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: body.toString(),
    signal: AbortSignal.timeout(20000)
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('token 接口返回了非 JSON：' + text.slice(0, 200));
  }

  if (!res.ok || !data.access_token) {
    throw new Error('换取 token 失败（HTTP ' + res.status + '）：' + (data.error_description || text.slice(0, 200)));
  }

  const expiresIn = Number(data.expires_in) || 604800;
  saveToken({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type || 'Bearer',
    scope: data.scope || '',
    user_id: data.user_id || null,
    expires_at: Date.now() + expiresIn * 1000
  });

  console.log('[auth] 授权成功，用户 id ' + (data.user_id || '未知') +
    '，有效期 ' + Math.round(expiresIn / 86400) + ' 天');
  console.log('[auth] 已写入 source/_data/bangumis/auth.enc（AES-256-GCM 加密）');
}

main().catch(function (err) {
  console.error('[auth] ' + err.message);
  process.exit(1);
});
