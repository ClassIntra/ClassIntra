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
const bad = [];

for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    if (!/transition\s*:/.test(cur)) continue;
    if (/;\s*$/.test(cur)) continue;

    // 合法多行写法 A：本行以逗号收尾，下一行接下一个属性。
    if (/,\s*$/.test(cur)) continue;

    // 合法多行写法 B：`transition:` 后面什么都不写，属性全部在后续行，
    //   且后续行每行都以逗号收尾（最后一行以分号收尾）。
    const afterColon = cur.replace(/^[\s\S]*transition\s*:/, '').trim();
    if (afterColon === '') {
      // 收集到分号行，检查每行（除最后一行）是否都有尾逗号
      let j = i + 1;
      let ok = true;
      while (j < lines.length && !/;\s*$/.test(lines[j])) {
        if (!/,\s*$/.test(lines[j])) { ok = false; break; }
        j++;
      }
      if (ok) continue; // 合法
    }

    const nxt = (lines[i + 1] || '').trim();
    if (/^[a-z-]+\s/.test(nxt)) {
      bad.push(f + ':' + (i + 1) + '  >>' + cur.trim().slice(0, 70) + ' || ' + nxt.slice(0, 50));
    }
  }
}

if (bad.length === 0) {
  console.log('OK: 全项目已无「多行 transition 且下一行以裸属性名开头」的缺逗号写法。');
} else {
  console.log('仍有 ' + bad.length + ' 处：');
  bad.forEach((b) => console.log('  ' + b));
}
