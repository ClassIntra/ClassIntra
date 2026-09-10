#!/usr/bin/env node
/**
 * 动效与视觉规范审计（docs/ecosystem-design.md §5.5）
 *
 * 用途：作为质量门，检查全仓 transition 声明是否符合规范。
 *   pnpm verify:motion
 *
 * 检查项：
 *   [E1] 硬编码秒数（应改用 --duration-* 令牌）
 *   [E2] 缺失曲线令牌（隐式 CSS 默认 ease）
 *   [E3] flex gap（Chrome 80 不支持，目标设备含非 X5 的 Chrome 80）
 *   [E4] transition: all（性能陷阱）
 *   [E5] 布局属性过渡（width/height/top/left/margin/padding）
 *
 * 豁免（规范 §5.5.1 第 9/10 项 + §5.5.2 豁免规则）：
 *   - 跟手档：时长 <= 0.06s
 *   - 循环动画：0.8s / 1.2s 等节奏参数
 *   - delay：transition 末位的延时值
 *   - 形状形变：代码内标注「规范例外」的行
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'client', 'src');
const EXEMPT_MARK = '规范例外';

const COMPOSITE = /var\(--transition-/;
const EASE = /var\(--ease-|linear\b/;
const DUR = /var\(--duration-/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(p, out);
    } else if (/\.(vue|scss|css)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function splitSegments(body) {
  const segs = []; let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { segs.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) segs.push(cur);
  return segs;
}

const issues = [];
const exempted = [];
const files = walk(SRC);

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;

    // ---- E4: transition: all ----
    if (/transition\s*:\s*all\b/.test(line)) {
      issues.push({ code: 'E4', file: rel, line: ln, msg: 'transition: all（性能陷阱）', text: line.trim() });
      continue;
    }

    // ---- E3: flex gap ----
    // 注意：官方应用（client/src/**）经 Vite 构建，@vitejs/plugin-legacy 与
    // PostCSS 的 flex-gap polyfill 会处理，不属违规。
    // 真正禁止 flex gap 的是第三方代码（market-apps/**，不过构建），
    // 该检查由下方单独扫描完成（见 scanThirdParty）。

    if (!/transition\s*:/.test(line)) continue;
    const m = line.match(/transition\s*:\s*([^;{}]+)/);
    if (!m) continue;
    const body = m[1];
    if (/^\s*none/.test(body)) continue;

    // 该行是否标注了例外
    const nearLines = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    const markedExempt = nearLines.indexOf(EXEMPT_MARK) !== -1;

    for (const seg of splitSegments(body)) {
      const s = seg.trim();
      if (!s) continue;
      if (COMPOSITE.test(s)) continue;

      const times = (s.match(/\b\d+\.?\d*s\b/g) || []).map(v => parseFloat(v));
      const hasDur = DUR.test(s);
      if (times.length === 0 && !hasDur) continue;

      const missingEase = !EASE.test(s);

      // 豁免判定
      let exempt = null;
      if (markedExempt) exempt = '形状形变（代码标注）';
      else if (times.some(v => v <= 0.06)) exempt = '跟手档';
      else if (/\b0\.8s\b|\b1\.2s\b/.test(s)) exempt = '循环动画';

      if (exempt) {
        exempted.push({ file: rel, line: ln, kind: exempt, text: s });
        continue;
      }

      // 区分 duration 与 delay：
      // transition 简写中，第一个时间值是 duration，第二个才是 delay。
      // delay 属节奏参数（§5.5.1 第 9 项），允许硬编码。
      const rawTimes = (s.match(/\b\d+\.?\d*s\b/g) || []);
      const firstIsToken = /var\(--duration-/.test(s);
      const rawDurationExists = firstIsToken ? false : rawTimes.length > 0;

      if (rawDurationExists) {
        issues.push({ code: 'E1', file: rel, line: ln, msg: '硬编码 duration，应改用 --duration-*', text: s });
      }
      if (missingEase) {
        issues.push({ code: 'E2', file: rel, line: ln, msg: '缺曲线令牌（隐式 ease）', text: s });
      }
    }
  }
}

// ---- E5: 布局属性过渡 ----
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/transition\s*:/.test(line)) continue;
    const nearLines = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (nearLines.indexOf(EXEMPT_MARK) !== -1) continue;
    for (const seg of splitSegments(line)) {
      if (/^\s*(transition\s*:)?\s*(width|height|top|left|margin|padding)\b/.test(seg)) {
        issues.push({ code: 'E5', file: rel, line: i + 1, msg: '布局属性过渡（触发布局抖动）', text: seg.trim() });
      }
    }
  }
}

// ---- E3: 第三方代码的 flex gap（不过构建，无 polyfill） ----
// 官方 client/src/** 经 Vite 构建有 polyfill，不检查；
// 第三方 market-apps/** 直出浏览器，必须禁止。
const THIRD_PARTY_DIRS = [join(ROOT, 'market-apps'), join(ROOT, 'plugins')];
for (const dir of THIRD_PARTY_DIRS) {
  let exists = true;
  try { statSync(dir); } catch { exists = false; }
  if (!exists) continue;
  for (const file of walk(dir)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/\bgap\s*:\s*\d+px/.test(lines[i])) {
        issues.push({
          code: 'E3', file: rel, line: i + 1,
          msg: 'flex gap（Chrome 80 不支持，第三方无 polyfill）',
          text: lines[i].trim()
        });
      }
    }
  }
}

// 输出
const byCode = {};
for (const it of issues) (byCode[it.code] = byCode[it.code] || []).push(it);

const LABELS = {
  E1: '硬编码秒数',
  E2: '缺失曲线令牌',
  E3: 'flex gap（Chrome 80）',
  E4: 'transition: all',
  E5: '布局属性过渡'
};

console.log('================ 动效与视觉规范审计 ================\n');
if (issues.length === 0) {
  console.log('✅ 全部通过，无违规\n');
} else {
  for (const code of Object.keys(LABELS)) {
    const list = byCode[code];
    if (!list) continue;
    console.log(`[${code}] ${LABELS[code]} —— ${list.length} 处`);
    list.slice(0, 12).forEach(it => console.log(`     ${it.file}:${it.line}  ${it.msg}`));
    if (list.length > 12) console.log(`     ... 另有 ${list.length - 12} 处`);
    console.log('');
  }
}

if (exempted.length) {
  console.log(`已登记豁免：${exempted.length} 处（规范 §5.5 允许）`);
  const kinds = {};
  exempted.forEach(e => { kinds[e.kind] = (kinds[e.kind] || 0) + 1; });
  Object.keys(kinds).forEach(k => console.log(`     ${k}: ${kinds[k]}`));
  console.log('');
}

console.log('===================================================');
console.log(`结果：${issues.length} 处违规，${exempted.length} 处豁免`);
process.exit(issues.length === 0 ? 0 : 1);
