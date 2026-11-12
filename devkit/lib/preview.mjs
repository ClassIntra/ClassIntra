// 开发预览：把作者本地包免安装挂进真实宿主
// ============================================================
// 流程：checkPackage 快速失败 → POST /api/market/dev-preview { dir } → 宿主用与安装
// 同一套校验器 + 热挂载管线加载这个目录（不下载、不落盘、不写数据库，重启即清）。
// 静态资源走宿主 /market-static-dev/ 前缀（同源，局域网平板也能直接预览）；
// 后端复用热挂载——重复挂载即刷新，配合 --watch 实现「改后端代码 → 自动重挂」。
//
// 凭据（与 scripts/probe-*.mjs 同一约定）：
//   --token <JWT>    从已登录班管的浏览器复制（localStorage.token）
//   --secret <KEY>   本地 server/.env 的 JWT_SECRET，配合 --user <班管 user_id> 本地签发
// 两者都不传时读环境变量 CI_DEV_TOKEN / CI_DEV_SECRET + CI_DEV_USER。

import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { checkPackage } from './check.mjs';

const DEFAULT_HOST = 'http://127.0.0.1:9001';
const TOKEN_TTL_SECONDS = 7200; // 与探针脚本一致的 2 小时

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// HS256 JWT（零依赖实现，宿主 auth 中间件只要求 { user_id } + 有效期）
export function signJwt(secret, payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const data = header + '.' + body;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return data + '.' + sig;
}

export function resolveAuth(options = {}) {
  const token = options.token || process.env.CI_DEV_TOKEN || '';
  if (token) return String(token).trim();
  const secret = options.secret || process.env.CI_DEV_SECRET || '';
  if (secret) {
    const user = options.user || process.env.CI_DEV_USER || 'admin';
    return signJwt(String(secret).trim(), {
      user_id: user,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    });
  }
  throw new Error('缺少宿主凭据：--token <JWT>（从班管浏览器复制）或 --secret <JWT_SECRET> --user <班管账号>');
}

export function resolveHost(options = {}) {
  return String(options.host || process.env.CI_DEV_HOST || DEFAULT_HOST).replace(/\/+$/, '');
}

export async function apiCall(options, method, apiPath, body) {
  const token = resolveAuth(options);
  const base = resolveHost(options);
  let res;
  try {
    res = await fetch(base + apiPath, {
      method: method,
      headers: Object.assign(
        { Authorization: 'Bearer ' + token },
        body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new Error('无法连接宿主 ' + base + '：' + e.message + '（服务在跑吗？--host 对吗？）');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 非 JSON 响应按状态码报错 */ }
  if (!res.ok) {
    throw new Error('宿主返回 ' + res.status + '：' + ((data && data.message) || res.statusText));
  }
  return data;
}

// 挂载（或刷新）一个开发预览。返回宿主下发的应用描述符（含 route/_staticBase/_previewAt）。
export async function mountPreview(targetDir, options = {}) {
  const checked = checkPackage(targetDir || '.');
  if (!checked.ok) {
    throw new Error('包体检未通过，先修复再预览：\n  ' + checked.errors.join('\n  '));
  }
  const dir = path.resolve(targetDir || '.');
  const data = await apiCall(options, 'POST', '/api/market/dev-preview', { dir: dir });
  const app = data && data.data && data.data.app;
  if (!app) throw new Error('宿主响应缺少应用描述符');
  return app;
}

export async function unmountPreview(name, options = {}) {
  return apiCall(options, 'DELETE', '/api/market/dev-preview/' + encodeURIComponent(String(name || '')));
}

export async function listPreviews(options = {}) {
  const data = await apiCall(options, 'GET', '/api/market/dev-preview');
  return (data && data.data && data.data.apps) || [];
}

// 监听包内影响后端的变更（backend/ 目录与 manifest.json），防抖后回调。返回停止函数。
// 前端文件不需要重挂：刷新页面即从 /market-static-dev/ 拿到新文件（no-store）。
export function watchForReload(pkgDir, onChange) {
  const dir = path.resolve(pkgDir);
  const watchers = [];
  let timer = null;
  const fire = (what) => {
    clearTimeout(timer);
    timer = setTimeout(function() { onChange(what); }, 300);
  };
  const tryWatch = (target) => {
    try { watchers.push(fs.watch(target, () => fire(target))); } catch (e) { /* 目录不存在则跳过 */ }
  };
  tryWatch(path.join(dir, 'manifest.json'));
  tryWatch(path.join(dir, 'backend'));
  return function stop() {
    clearTimeout(timer);
    watchers.forEach(function(w) { try { w.close(); } catch (e) {} });
  };
}

// 从包目录读 manifest（仅用于 CLI 展示挂载信息；校验由宿主完成）
export function readManifest(targetDir) {
  const manifestPath = path.join(path.resolve(targetDir || '.'), 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}
