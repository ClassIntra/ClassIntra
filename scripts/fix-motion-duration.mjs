/**
 * fix-motion-duration.mjs
 *
 * 第十二轮修复：两波动效缺陷
 *
 * 缺陷 A（正确性 Bug）—— transition 简写里多个属性之间缺逗号：
 *   transition: opacity X curve transform Y curve;
 *   少一个逗号 → 整条 transition 声明非法 → 浏览器整条丢弃 → 属性瞬变，无过渡。
 *   同类还有 App.vue 里的多余右括号 `var(--ease-accelerate))`。
 *
 * 缺陷 B（时长过长）—— apps/*.vue 的局部 transition 类覆盖了 global.scss 的全局同名类，
 *   且用了更慢的档位（例如 fade-slide 全局 fast 被覆盖成 normal 等）。
 *   处理策略：删掉局部定义，让全局统一定义生效（全局已是 iOS 分档后的正确值）。
 *   仅当局部类名在全局不存在时才保留（例如 tab-fade / sidebar-slide / player-slide）。
 *
 * 用法：
 *   node scripts/fix-motion-duration.mjs            # 应用
 *   node scripts/fix-motion-duration.mjs --dry-run  # 只看会改什么
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');

const report = { A: [], A2: [], B: [], skipped: [] };

/* ------------------------------------------------------------------ *
 * 缺陷 A：transition 多属性缺逗号 + 多余括号
 * ------------------------------------------------------------------ */

/**
 * 匹配形如：
 *   transition: opacity var(--duration-normal) var(--ease-decelerate)
 *               transform var(--duration-normal) var(--ease-decelerate);
 * 即「属性名 + 值 + 下一个属性名 + 值」之间没有逗号。
 *
 * 判定：在 transition 声明体内，出现 `var(--xxx)` 紧接（中间只有空白/换行）
 *       一个裸 CSS 属性名（transform / opacity / background / color / box-shadow 等），
 *       即视为缺逗号。
 */
const TRANSITION_PROP = /^(transform|opacity|background-color|background|border-color|color|box-shadow|height|width|left|top|right|bottom|filter|border-radius|max-height|margin|padding)$/;

/**
 * 缺陷 A2：`transition: a, b, c, d, e, f var(--duration-X) var(--ease-Y);`
 *   → 前 5 个属性裸奔（无时长无曲线 → 浏览器按 0s 处理 → 属性瞬变），
 *     只有最后一个属性带时长曲线。
 *   这是第十轮批量展开 `transition: all` 时留下的缺陷。
 *
 * 修法：把裸属性逐个补上「时长 + 曲线」，与最后一个对齐。
 */
function fixBarePropertyList(src, file) {
  const hits = [];
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/transition\s*:/.test(line)) continue;
    if (!/;\s*$/.test(line)) continue; // 只处理单行完整声明

    const m = line.match(/transition\s*:\s*(.+?)\s*;\s*$/);
    if (!m) continue;

    const body = m[1];
    // 形如 `a, b, c, d, e, f var(--duration-normal) var(--ease-standard)`
    const parts = body.split(',').map((p) => p.trim());
    if (parts.length < 3) continue;

    // 最后一个部分必须带时长令牌
    const tail = parts[parts.length - 1];
    const tailMatch = tail.match(/^([a-z-]+)\s+(var\(--duration-[a-z]+\)|var\(--motion-spring-[a-z]+\))\s+(var\(--ease-[a-z]+\)|var\(--motion-spring-[a-z]+\))$/);
    if (!tailMatch) continue;

    // 前面是否全是裸属性名（无值）
    const bareProps = parts.slice(0, -1);
    const allBare = bareProps.every((p) => /^[a-z-]+$/.test(p));
    if (!allBare) continue;

    const dur = tailMatch[2];
    const ease = tailMatch[3];
    const rebuilt =
      bareProps.map((p) => p + ' ' + dur + ' ' + ease).join(', ') +
      ', ' +
      tail;

    lines[i] = line.replace(body, rebuilt);
    hits.push(i + 1);
  }

  if (hits.length) report.A2.push({ file, count: hits.length, lines: hits });
  return lines.join('\n');
}

function fixMissingCommas(src, file) {
  const hits = [];

  // 先把「多行 transition 声明」折叠成单行（保留缩进），修完再还原。
  // Vue SFC 里常见写法：
  //   transition: opacity var(--a) var(--b)
  //               transform var(--c) var(--d);
  // 缺少逗号 → 整条声明非法 → 浏览器丢弃 → 属性瞬变。
  const lines = src.split('\n');
  let inTransition = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isStart = /transition\s*:/.test(line);

    if (isStart && !/;\s*$/.test(line)) {
      // 多行声明：向下收集到分号行，合并成一行
      let end = i + 1;
      while (end < lines.length && !/;\s*$/.test(lines[end])) end++;
      if (end < lines.length) {
        const merged =
          line.replace(/\s*$/, '') +
          ' ' +
          lines
            .slice(i + 1, end + 1)
            .map((l) => l.trim())
            .join(' ');
        lines.splice(i, end - i + 1, merged);
        inTransition = false;
        // 合并后继续处理这一行（下方逻辑）
        i--;
        continue;
      }
      inTransition = true;
      continue;
    }

    if (isStart) inTransition = false;
    if (!isStart && !inTransition) continue;

    let fixed = line;

    // (1) 多余右括号：var(--ease-accelerate))  ->  var(--ease-accelerate)
    fixed = fixed.replace(/var\(--[a-z0-9-]+\)\)(?=\s*[,;\s])/g, (m) => m.slice(0, -1));
    fixed = fixed.replace(/var\(--[a-z0-9-]+\)\)\s*;/g, (m) => m.slice(0, -2) + ';');

    // (2) 缺逗号：`)` + 空白 + 裸属性名 + 空白 + 值
    fixed = fixed.replace(
      /(\))\s+([a-z-]+)(?=\s+(?:var\(|[0-9.]+s|cubic-bezier|[a-z-]*ease\b))/g,
      (m, paren, next) => {
        if (!TRANSITION_PROP.test(next)) return m;
        return paren + ', ' + next;
      }
    );

    if (fixed !== line) {
      lines[i] = fixed;
      hits.push(i + 1);
    }
  }

  if (hits.length) report.A.push({ file, count: hits.length, lines: hits });
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * 缺陷 B：局部 transition 类覆盖全局 → 删除局部定义
 * ------------------------------------------------------------------ */

// 在 global.scss 中已定义的 transition 类名 → 局部重复定义应删除
const GLOBAL_OWNED = [
  'fade-slide',
  'fade-quick',
  'modal-fade',
  'msg-list',
  'section-fade',
  'fade-up',
  'conv-list',
  'res-list',
];

/**
 * 从 .vue 的 <style> 段里删除指定 transition 类的全部规则块。
 * 规则块形如：
 *   .fade-slide-enter-active,
 *   .fade-slide-leave-active {
 *     ...
 *   }
 * 或单行形式。
 */
function stripLocalTransitionClasses(src, classes) {
  let out = src;
  const removed = [];

  for (const cls of classes) {
    // 收集所有以 .<cls>- 开头的选择器组（可能多行、逗号分隔）
    const blockRe = new RegExp(
      '[ \\t]*\\.' + cls.replace(/-/g, '\\-') + '\\-[a-z\\-]+(?:[^{};]*?)\\{[^{}]*\\}\\s*',
      'g'
    );
    const matches = out.match(blockRe);
    if (!matches) continue;

    // 仅当该块的选择器全部属于 .<cls>-* 时删除（避免误删组合选择器）
    let removedForCls = 0;
    for (const block of matches) {
      const selectorPart = block.slice(0, block.indexOf('{'));
      // 选择器里每一段都应指向 .<cls>-
      const sels = selectorPart.split(',').map((s) => s.trim()).filter(Boolean);
      const allOurs = sels.length > 0 && sels.every((s) => s.startsWith('.' + cls + '-'));
      if (!allOurs) continue;

      out = out.replace(block, '');
      removedForCls++;
    }
    if (removedForCls) removed.push(cls + ' (' + removedForCls + ' 块)');
  }

  return { out, removed };
}

/* ------------------------------------------------------------------ *
 * 目标文件
 * ------------------------------------------------------------------ */

const TARGETS = [
  'client/src/App.vue',
  'apps/chat/frontend/Chat.vue',
  'apps/admin/frontend/Admin.vue',
  'apps/settings/frontend/Settings.vue',
  'apps/ai-chat/frontend/AIChat.vue',
  'apps/notes/frontend/Notes.vue',
  'apps/community/frontend/Community.vue',
  'apps/music/frontend/Music.vue',
  'apps/resource/frontend/Resource.vue',
  'apps/resource/frontend/CloudDrive.vue',
  'apps/resource/frontend/CloudUpload.vue',
  'apps/resource/frontend/GuestUpload.vue',
  'apps/resource/frontend/CloudFilePicker.vue',
  'apps/calculator/frontend/Calculator.vue',
  'apps/calendar/frontend/Calendar.vue',
  'apps/countdown/frontend/Countdown.vue',
  'apps/timetable/frontend/Timetable.vue',
  'apps/timetable/frontend/widgets/TimetableTodayWidget.vue',
];

for (const rel of TARGETS) {
  const abs = resolve(ROOT, rel);
  let src;
  try {
    src = readFileSync(abs, 'utf8');
  } catch {
    report.skipped.push(rel + ' (不存在)');
    continue;
  }

  const before = src;

  // 1) 缺陷 A：缺逗号 / 多余括号
  let stage1 = fixMissingCommas(src, rel);

  // 2) 缺陷 A2：裸属性列表
  stage1 = fixBarePropertyList(stage1, rel);

  // 3) 缺陷 B：删除覆盖全局的局部 transition 类
  const { out: stage2, removed } = stripLocalTransitionClasses(stage1, GLOBAL_OWNED);
  if (removed.length) report.B.push({ file: rel, removed });

  if (stage2 !== before) {
    if (!DRY) writeFileSync(abs, stage2, 'utf8');
  }
}

/* ------------------------------------------------------------------ *
 * 报告
 * ------------------------------------------------------------------ */

console.log('\n=== 缺陷 A：transition 缺逗号 / 多余括号 ===');
if (report.A.length === 0) console.log('  (无)');
for (const r of report.A) {
  console.log('  ' + r.file + '  → ' + r.count + ' 处  行 ' + r.lines.join(','));
}

console.log('\n=== 缺陷 A2：transition 裸属性列表（仅末项带时长） ===');
if (report.A2.length === 0) console.log('  (无)');
for (const r of report.A2) {
  console.log('  ' + r.file + '  → ' + r.count + ' 处  行 ' + r.lines.join(','));
}

console.log('\n=== 缺陷 B：删除覆盖全局的局部 transition 类 ===');
if (report.B.length === 0) console.log('  (无)');
for (const r of report.B) console.log('  ' + r.file + '  → ' + r.removed.join(', '));

if (report.skipped.length) {
  console.log('\n=== 跳过 ===');
  for (const s of report.skipped) console.log('  ' + s);
}

console.log('\n' + (DRY ? '[dry-run] 未写入任何文件' : '已写入。'));
