#!/usr/bin/env node
/**
 * Bangumi token 的本地保管。
 *
 * 仓库是公开的，token 不能明文提交；但又必须让 Action 能读到并在刷新后写回
 * （Bangumi 每次刷新都会轮换 refresh_token，存成仓库 secret 的话没法自动更新）。
 * 所以做法是：用仓库 secret 里的 BGM_KEY 做 AES-256-GCM 加密，密文提交进仓库。
 *
 * 文件：source/_data/bangumis/auth.enc
 * 格式：{ v: 1, iv, tag, data } —— 全部 base64
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUTH_FILE = path.join(ROOT, 'source', '_data', 'bangumis', 'auth.enc');

function readKey() {
  const hex = (process.env.BGM_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('BGM_KEY 缺失或格式不对（需要 64 位十六进制，即 32 字节）');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(obj, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf-8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  };
}

function decrypt(payload, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]);
  return JSON.parse(out.toString('utf-8'));
}

function loadToken() {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error('还没有授权过：先在 /bangumi-auth/ 走一次授权，再运行 Bangumi Auth workflow');
  }
  const payload = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  return decrypt(payload, readKey());
}

function saveToken(token) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(encrypt(token, readKey()), null, 2) + '\n', 'utf-8');
}

module.exports = { loadToken, saveToken, AUTH_FILE };
