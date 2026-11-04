// 单包体检：与市场安装期的硬校验同源，外加 Chrome 80 语法红线。
// 不依赖主仓库、不依赖任何 npm 包 —— 外部开发者 clone 自己的包就能跑。

import fs from 'node:fs';
import path from 'node:path';

const KNOWN_CAPABILITIES = [
  'data.storage', 'data.realtime', 'data.http', 'data.store',
  'system.notification', 'system.clipboard', 'system.share', 'system.shareTarget', 'system.navigate',
  'system.badge', 'system.openApp', 'system.search',
  'ui.toast', 'ui.modal', 'ui.sheet', 'ui.overlay',
  'app.config', 'app.storage',
  'device.info', 'device.filePicker', 'device.camera', 'device.microphone',
  'device.vibrate', 'device.network', 'device.screen'
];

const LIMITS = { files: 300, fileBytes: 60 * 1024 * 1024, totalBytes: 80 * 1024 * 1024 };

const CSS_RULES = [
  { re: /(^|[;{\s])gap\s*:/, msg: 'flex/grid gap（Chrome 84+ 才有）', hint: '改用子元素 margin' },
  { re: /:is\s*\(|:where\s*\(/, msg: ':is() / :where()（Chrome 88+）', hint: '展开选择器' },
  { re: /aspect-ratio\s*:/, msg: 'aspect-ratio（Chrome 88+）', hint: '用 padding-top 百分比' },
  { re: /transition\s*:\s*all\b/, msg: 'transition: all', hint: '只过渡 transform / opacity' }
];

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function stripJsLiterals(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  out = out.replace(/'(?:\\.|[^'\\\n])*'/g, "''");
  out = out.replace(/"(?:\\.|[^"\\\n])*"/g, '""');
  return out;
}

function findBacktick(src) {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  let inSingle = false;
  let inDouble = false;
  let esc = false;
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (inSingle) { if (ch === "'") inSingle = false; continue; }
    if (inDouble) { if (ch === '"') inDouble = false; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') return i;
  }
  return -1;
}

export function checkPackage(targetDir) {
  const dir = path.resolve(targetDir || '.');
  const errors = [];
  const warnings = [];
  const info = { dir, kind: '', name: '', version: '', files: 0, bytes: 0 };

  const err = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    err('缺少 manifest.json');
    return { ok: false, errors, warnings, info };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    err('manifest.json 解析失败: ' + e.message);
    return { ok: false, errors, warnings, info };
  }

  // ---- 类型判定 ----
  let kind = 'app';
  if (manifest.type === 'plugin') kind = 'plugin';
  else if (manifest.type === 'light' || manifest.type === 'dark') kind = 'theme';
  info.kind = kind;

  const dirName = path.basename(dir);
  const isTheme = manifest.type === 'light' || manifest.type === 'dark';
  // 主题的身份是 id（name 是显示名，允许中文和空格）；应用/插件的身份是 name
  info.name = String(isTheme ? (manifest.id || '') : (manifest.name || manifest.id || ''));
  info.version = String(manifest.version || '');

  if (!/^[a-z][a-z0-9-]{1,63}$/.test(info.name)) err((isTheme ? 'id' : 'name') + ' 需为 kebab-case: ' + info.name);
  if (kind !== 'theme' && info.name !== dirName) {
    err('manifest.name (' + info.name + ') 与目录名 (' + dirName + ') 不一致');
  }
  if (!/^\d+\.\d+\.\d+/.test(info.version)) err('version 需为语义化版本: ' + info.version);

  if (kind === 'app') {
    if (!manifest.label) err('缺少 label');
    if (!manifest.frontend || !manifest.frontend.route || String(manifest.frontend.route).indexOf('/') !== 0) {
      err('frontend.route 缺失或未以 / 开头');
    }
    const hasEntry = manifest.frontend && manifest.frontend.entry;
    const hasStatic = manifest.frontend && manifest.frontend.static;
    if (!hasEntry && !hasStatic) err('frontend.entry 与 frontend.static 至少需要一个');
    if (manifest.backend && manifest.backend.mountPath && String(manifest.backend.mountPath).indexOf('/api/') !== 0) {
      err('backend.mountPath 必须以 /api/ 开头');
    }
  }

  if (kind === 'plugin') {
    if (!manifest.label) err('缺少 label');
    if (!manifest.backend || !manifest.backend.mountPath) err('插件必须有 backend.mountPath');
    else if (String(manifest.backend.mountPath).indexOf('/api/') !== 0) err('backend.mountPath 必须以 /api/ 开头');
    if (!manifest.backend || !manifest.backend.entry) err('插件必须有 backend.entry');
  }

  if (kind === 'theme') {
    if (manifest.id !== dirName) err('manifest.id (' + manifest.id + ') 与目录名 (' + dirName + ') 不一致');
    if (manifest.id === 'light' || manifest.id === 'dark') err('主题 id 不能是 light / dark');
    if (!manifest.name) err('缺少 name');
    if (manifest.type !== 'light' && manifest.type !== 'dark') err('type 必须为 light / dark');
    if (!manifest.tokens || String(manifest.tokens).slice(-5) !== '.json') err('tokens 必须指向 .json 文件');
    else if (!fs.existsSync(path.join(dir, manifest.tokens))) err('tokens 文件不存在: ' + manifest.tokens);
  }

  // ---- backend.jobs：定时任务声明 ----
  if (manifest.backend && manifest.backend.jobs !== undefined) {
    if (!Array.isArray(manifest.backend.jobs)) {
      err('backend.jobs 应为数组');
    } else {
      const names = new Set();
      manifest.backend.jobs.forEach((job, i) => {
        const at = 'backend.jobs[' + i + ']';
        if (!job || typeof job !== 'object') { err(at + ' 应为对象'); return; }
        if (!job.name || !/^[a-z][a-z0-9-]{1,40}$/.test(String(job.name))) err(at + '.name 缺失或非 kebab-case');
        else if (names.has(job.name)) err(at + '.name 重复: ' + job.name);
        else names.add(job.name);
        if (!job.handler || String(job.handler).indexOf('./') !== 0 || String(job.handler).indexOf('..') !== -1) {
          err(at + '.handler 必须是包内相对路径（./backend/jobs/x.js）');
        }
        if (job.every === undefined && job.daily === undefined) err(at + ' 需要 every 或 daily');
        if (job.every !== undefined) {
          const raw = String(job.every);
          const n = parseInt(raw, 10);
          const mult = /m$/i.test(raw) ? 60 : (/h$/i.test(raw) ? 3600 : 1);
          if (!isFinite(n) || n * mult < 60) err(at + '.every 不能小于 60 秒');
        }
        if (job.daily !== undefined && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(String(job.daily))) {
          err(at + '.daily 必须是 HH:MM（24 小时制）');
        }
      });
    }
  }

  // ---- capabilities ----
  const caps = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  for (const cap of caps) {
    if (KNOWN_CAPABILITIES.indexOf(cap) === -1) {
      warn('未知能力名（拼写错误？）: ' + cap);
    }
  }

  // ---- 文件规模与图标 ----
  const all = walk(dir, []);
  info.files = all.length;
  let bytes = 0;
  for (const abs of all) {
    const size = fs.statSync(abs).size;
    bytes += size;
    if (size > LIMITS.fileBytes) err('单文件超过 60MB: ' + path.relative(dir, abs));
  }
  info.bytes = bytes;
  if (all.length > LIMITS.files) err('文件数 ' + all.length + ' 超过上限 ' + LIMITS.files);
  if (bytes > LIMITS.totalBytes) err('包总大小超过 80MB');

  if (manifest.icon) {
    const iconAbs = path.join(dir, String(manifest.icon));
    if (!fs.existsSync(iconAbs)) warn('manifest.icon 指向的文件不存在: ' + manifest.icon);
  }

  // ---- 运行时脚本体检（静态站形态不适用）----
  const isStatic = !!(manifest.frontend && manifest.frontend.static && !manifest.frontend.entry);
  const jsFiles = all.filter((abs) => {
    const rel = path.relative(dir, abs).replace(/\\/g, '/');
    if (!rel.endsWith('.js')) return false;
    return rel.startsWith('frontend/') || rel === 'entry.js';
  });

  for (const abs of jsFiles) {
    const rel = path.relative(dir, abs).replace(/\\/g, '/');
    const src = fs.readFileSync(abs, 'utf8');
    const stripped = stripJsLiterals(src);

    // 危险 API（任何形态都拦）
    if (/\beval\s*\(/.test(stripped)) err(rel + ': 使用 eval()（市场审查会拒）');
    if (/new\s+Function\s*\(/.test(stripped)) err(rel + ': 使用 new Function()（市场审查会拒）');
    if (/document\.write\s*\(/.test(stripped)) err(rel + ': 使用 document.write()');

    if (isStatic) continue; // 自己构建的产物，语法红线不适用

    const bt = findBacktick(src);
    if (bt !== -1) {
      const line = src.slice(0, bt).split('\n').length;
      err(rel + ':' + line + ' 使用模板字符串（反引号）—— Chrome 80 直接白屏');
    }
    const rules = [
      { re: /\bconst\s+[A-Za-z_$]/, msg: 'const 声明', hint: '改用 var' },
      { re: /\blet\s+[A-Za-z_$]/, msg: 'let 声明', hint: '改用 var' },
      { re: /=>/, msg: '箭头函数', hint: '改用 function' },
      { re: /\?\./, msg: '可选链 ?.', hint: '改用 a && a.b' },
      { re: /\?\?/, msg: '空值合并 ??', hint: '改用显式 null 判断' },
      { re: /\bclass\s+[A-Za-z_$]/, msg: 'class 声明', hint: '改用构造函数 + prototype' },
      { re: /\basync\s+function|\bawait\s+/, msg: 'async / await', hint: '改用 Promise 链' },
      { re: /\.replaceChildren\s*\(/, msg: 'Element.replaceChildren()', hint: "改用 innerHTML = ''" }
    ];
    for (const rule of rules) {
      const m = stripped.match(rule.re);
      if (m) {
        const line = stripped.slice(0, m.index).split('\n').length;
        err(rel + ':' + line + ' 使用 ' + rule.msg + '（' + rule.hint + '）');
      }
    }

    // 资源回收：用了就要登记 onDestroy
    const usesResource = /setInterval\s*\(|setTimeout\s*\(|addEventListener\s*\(|\.subscribe\s*\(/.test(stripped);
    const hasCleanup = /onDestroy\s*\(/.test(stripped);
    if (usesResource && !hasCleanup) {
      warn(rel + ': 使用了监听器/定时器/订阅，但没有 context.app.onDestroy 回收');
    }
  }

  for (const abs of all.filter((a) => a.endsWith('.css'))) {
    const rel = path.relative(dir, abs).replace(/\\/g, '/');
    const src = fs.readFileSync(abs, 'utf8');
    for (const rule of CSS_RULES) {
      const m = src.match(rule.re);
      if (m) {
        const line = src.slice(0, m.index).split('\n').length;
        warn(rel + ':' + line + ' 使用 ' + rule.msg + '（' + rule.hint + '）');
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, info };
}
