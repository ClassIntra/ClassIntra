import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git', 'dist-inline', 'backup', 'logs'].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.(vue|scss|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [...walk('apps', []), ...walk('client/src', [])];
const results = [];

for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    // 选择器行：包含 -enter-active / -leave-active，且以 { 收尾（或同行有 {）
    if (!/-enter-active|-leave-active/.test(lines[i])) continue;
    if (!/\{/.test(lines[i])) continue;

    // 收集块内容直到 }
    let body = '';
    let j = i;
    while (j < lines.length && !/\}/.test(lines[j])) { body += lines[j] + ' '; j++; }
    if (j < lines.length) body += lines[j];

    const slow = (body.match(/var\(--duration-slow\)/g) || []).length;
    const norm = (body.match(/var\(--duration-normal\)/g) || []).length;
    if (slow || norm) {
      results.push({
        file: f.replace(/\\/g, '/'),
        line: i + 1,
        slow, norm,
        sel: lines[i].trim().slice(0, 70),
      });
    }
    i = j;
  }
}

results.sort((a, b) => b.slow - a.slow || b.norm - a.norm);

console.log('=== 进场/离场规则块中仍使用 slow(0.35s) / normal(0.25s) 的位置 ===\n');
for (const r of results) {
  const tags = [];
  if (r.slow) tags.push('slow×' + r.slow);
  if (r.norm) tags.push('normal×' + r.norm);
  console.log('  [' + tags.join(' ').padEnd(14) + '] ' + r.file + ':' + r.line);
  console.log('  ' + ' '.repeat(18) + r.sel);
}
console.log('\n共 ' + results.length + ' 处');
