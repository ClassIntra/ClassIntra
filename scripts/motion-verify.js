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
 *   [E6] 硬编码 border-radius（应改用 --radius-* 令牌）
 *   [E7] 引用不存在的圆角令牌（如 --radius-full）
 *   [E8] scale(0) 起步（应改为 scale(0.9~0.96) + opacity）
 *
 * 豁免（规范 §5.5.1 第 9/10 项 + §5.5.2 豁免规则）：
 *   - 跟手档：时长 <= 0.06s
 *   - 循环动画：0.8s / 1.2s 等节奏参数
 *   - delay：transition 末位的延时值
 *   - 形状形变：代码内标注「规范例外」的行
 *   - 圆形 50% / 直角 0：语义明确，非令牌可表达
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
// 扫描范围：
//   client/src/**  核心前端
//   apps/**        官方应用（同样经 Vite 构建，享 polyfill；但样式规范必须一致）
// 不扫描 market-apps/** 与 plugins/**（第三方），它们的专用红线由 E3 单独处理。
const SCAN_DIRS = [join(ROOT, 'client', 'src'), join(ROOT, 'apps')];
const EXEMPT_MARK = '规范例外';

// 现存圆角令牌白名单（与 client/src/styles/global.scss 的 --radius-* 定义保持一致）
const KNOWN_RADIUS = [
  '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg',
  '--radius-xl', '--radius-2xl', '--radius-3xl', '--radius-pill'
];

const COMPOSITE = /var\(--transition-/;
const EASE = /var\(--ease-|var\(--motion-spring-|linear\b/;
const DUR = /var\(--duration-/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'backend') continue;
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
const files = SCAN_DIRS.flatMap((d) => walk(d));

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
      // 长时长节奏参数：进度条生长、背景交叉淡入、歌词逐行浮现等
      // 这些场景需要「缓慢可见」的过渡，属 §5.5.1 第 9 项节奏参数
      else if (/\b0\.[567]s\b|\b[1-9]\.?[0-9]*s\b/.test(s)) exempt = '节奏参数（长时长）';

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

// ---- E6: 硬编码 border-radius ----
// 规范：圆角必须取自 8 档令牌梯度
//   xs(4) sm(8) md(12) lg(16) xl(20) 2xl(24) 3xl(28) pill(9999)
// 豁免：50%（圆形）、0（直角）、以及标注「规范例外」的装饰性形状。
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/border-radius\s*:\s*([^;]+?)\s*;/);
    if (!m) continue;
    const raw = m[1].trim();
    // 已用令牌 -> 进入 E7 检查
    if (!raw.includes('var(')) {
      if (raw === '50%' || raw === '0') continue;
      // 圆形与异形可能出现在多值里，如 "50% 50% 50% 50% / 40% 40% 60% 60%"
      const nearLines = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (nearLines.indexOf(EXEMPT_MARK) !== -1) {
        exempted.push({ file: rel, line: i + 1, kind: '形状形变（代码标注）', text: raw });
        continue;
      }
      if (/^(50%|0)(\s+(50%|0))/.test(raw) || /\//.test(raw)) continue; // 纯圆形/异形
      issues.push({
        code: 'E6', file: rel, line: i + 1,
        msg: '硬编码 border-radius，应改用 --radius-* 令牌',
        text: raw
      });
      continue;
    }
    // ---- E7: 引用不存在的圆角令牌 ----
    const tokens = raw.match(/var\(\s*(--radius-[a-z0-9-]+)/g) || [];
    for (const t of tokens) {
      const name = t.replace(/var\(\s*/, '');
      if (KNOWN_RADIUS.indexOf(name) === -1) {
        issues.push({
          code: 'E7', file: rel, line: i + 1,
          msg: `引用不存在的圆角令牌 ${name}`,
          text: raw
        });
      }
    }
  }
}

// ---- E8: scale(0) 起步 ----
// 原则（iOS HIG / §5.5.2）：从 scale(0) 做入场动画会产生「通用崩坏感」，
// 应改为 scale(0.9 ~ 0.96) + opacity，让元素看起来是「长大」而非「凭空出现」。
// 豁免：scaleX(0) / scaleY(0) 用于进度条、波形条等「长度从零生长」的语义，
//       这不是缩小到消失，而是维度展开，属合理用法。
//       同时需要剔除注释中的说明文字（如「never from scale(0)」）。
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = src.split('\n');
  // 预剥离注释：块注释可能跨行，统一在扫描前替换为空白（保留行号），
  // 避免注释里的说明文字（如「never animate from scale(0)」）被误报
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n');
  for (let i = 0; i < lines.length; i++) {
    const codeOnly = (stripped[i] || '').trim();
    if (!/scale\(\s*0\s*\)/.test(codeOnly)) continue;
    const nearLines = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
    if (nearLines.indexOf(EXEMPT_MARK) !== -1) continue;
    issues.push({
      code: 'E8', file: rel, line: i + 1,
      msg: 'scale(0) 起步，应改为 scale(0.9~0.96) + opacity',
      text: codeOnly
    });
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
  E5: '布局属性过渡',
  E6: '硬编码 border-radius',
  E7: '引用不存在的圆角令牌',
  E8: 'scale(0) 起步'
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
