// 从 main.js 做静态 import 图遍历，按目录聚合源码体积（近似主包构成）
import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const ROOT = 'D:/NetWork/Integration/ClassIntra/client/src';
const seen = new Map();

function resolveSpec(spec, from) {
  let base;
  if (spec.startsWith('@/')) base = resolve(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null; // 裸模块（node_modules）不计入应用代码
  const cands = [base, base + '.js', base + '.vue', base + '.mjs', resolve(base, 'index.js'), resolve(base, 'index.vue')];
  for (const c of cands) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

const re = /(?:^|\n)\s*(?:import\s+[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"])/g;

function walk(file) {
  if (seen.has(file)) return;
  const src = readFileSync(file, 'utf8');
  seen.set(file, src.length);
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(src))) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    const target = resolveSpec(spec, file);
    if (target) walk(target);
  }
}

walk(resolve(ROOT, 'main.js'));

const groups = new Map();
for (const [file, size] of seen) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const g = rel.includes('/') ? rel.split('/').slice(0, 2).join('/') : rel;
  groups.set(g, (groups.get(g) || 0) + size);
}
const rows = [...groups.entries()].sort((a, b) => b[1] - a[1]);
const total = rows.reduce((s, r) => s + r[1], 0);
console.log('入口静态依赖图（源码字节，未压缩）：合计 ' + Math.round(total / 1024) + 'KB，文件 ' + seen.size + ' 个');
rows.slice(0, 20).forEach(([g, s]) => console.log('  ' + String(Math.round(s / 1024)).padStart(5) + 'KB  ' + g));

const files = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log('\n单文件 Top 15：');
files.forEach(([f, s]) => console.log('  ' + String(Math.round(s / 1024)).padStart(5) + 'KB  ' + relative(ROOT, f).split('\\').join('/')));
