import fs from 'node:fs';
import path from 'node:path';

// Host installer defaults (server/src/core/market-service.js). Keep this list in
// the standalone package so checks work without importing a host installation.
export const ALLOWED_EXTENSIONS = new Set([
  '.json', '.js', '.mjs', '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.txt', '.md', '.html', '.jsonc', '.mov', '.mp4', '.webm',
  '.exe', '.nnue', '.py', '.rb', '.go', '.java', '.rs', '.php', '.sh', '.bat', '.ps1',
  '.toml', '.yaml', '.yml', '.xml', '.csv', '.ini', '.cfg', '.lock',
  '.c', '.h', '.cpp', '.cs', '.kt', '.sql', '.wasm', '.map'
]);

// Check and pack must see the same payload. Editor-only declaration files never
// belong in a runtime package; the host installer does not accept .ts files.
export function packageFiles(dir) {
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.endsWith('.d.ts')) continue;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('包内不支持符号链接: ' + path.relative(dir, full));
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  walk(dir);
  return files;
}

export function packageFile(dir, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || /[\\:\x00-\x1f]/.test(relativePath) ||
      relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
    throw new Error('必须是包内相对路径');
  }
  const root = fs.realpathSync(dir);
  const resolved = fs.realpathSync(path.resolve(root, relativePath));
  const within = path.relative(root, resolved);
  if (within.startsWith('..') || path.isAbsolute(within)) throw new Error('不能越出包目录');
  if (!fs.statSync(resolved).isFile()) throw new Error('必须指向文件');
  return resolved;
}
