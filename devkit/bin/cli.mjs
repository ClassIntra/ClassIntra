#!/usr/bin/env node
// classintra-devkit —— 第三方开发者的单一入口
// ============================================================
// 目标：不在主仓库里也能完成「建 → 查 → 打包」三件事。
// 零依赖、Node 18+、ESM；所有生成物都符合市场安装期校验与 Chrome 80 红线。

import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import { create } from '../lib/create.mjs';
import { checkPackage } from '../lib/check.mjs';
import { collectPackage, mergeIndex } from '../lib/pack.mjs';

const VERSION = '0.1.0';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) { flags[key] = next; i++; }
        else flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function help() {
  const lines = [
    '',
    'classintra-devkit v' + VERSION + ' — ClassIntra 第三方开发工具',
    '',
    '用法：',
    '  classintra-devkit create app <name> [--label 显示名] [--with-backend] [--dir 父目录]',
    '  classintra-devkit create site <name>        # 存量前端项目（同源 iframe）',
    '  classintra-devkit create service <name> [--port 41234]',
    '  classintra-devkit create plugin <name>      # 纯后端插件',
    '  classintra-devkit create theme <id> [--type light|dark]',
    '',
    '  classintra-devkit check [目录] [--json]     # manifest + Chrome 80 + 资源回收',
    '  classintra-devkit pack  [目录] [--write index.json] [--json]',
    '',
    '示例：',
    '  npx classintra-devkit create app hello --label "你好" | cd hello && npx classintra-devkit check .',
    '',
    '约定（check 会自动拦）：',
    '  · 前端 ES5：var / function，禁用 const/let/箭头函数/模板字符串/?. /??/class',
    '  · 颜色圆角动效用 --ci-* 令牌；不要 transition: all',
    '  · 监听器与定时器在 context.app.onDestroy 回收',
    ''
  ];
  console.log(lines.join('\n'));
}

function cmdCreate(positional, flags) {
  const kind = positional[0];
  const name = positional[1];
  if (!kind || !name) {
    console.error('缺少参数：create <app|site|service|plugin|theme> <name>');
    process.exitCode = 2;
    return;
  }
  const result = create(kind, name, {
    label: flags.label,
    dir: flags.dir,
    port: flags.port ? Number(flags.port) : undefined,
    type: flags.type,
    color: flags.color,
    order: flags.order ? Number(flags.order) : undefined,
    withBackend: !!flags['with-backend'],
    force: !!flags.force
  });
  console.log('');
  console.log('已生成 ' + kind + '：' + result.dir);
  for (const f of result.files) console.log('  + ' + f);
  console.log('');
  console.log('下一步：');
  console.log('  1) 改 manifest.json 的 label / version');
  console.log('  2) 写 frontend/entry.js（微前端）或把 dist 拷进 frontend/（静态站）');
  console.log('  3) npx classintra-devkit check ' + path.basename(result.dir));
  console.log('  4) npx classintra-devkit pack ' + path.basename(result.dir) + ' --write <market>/index.json');
  console.log('');
}

function cmdCheck(positional, flags) {
  const target = positional[0] || '.';
  const result = checkPackage(target);
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log('');
    console.log('ClassIntra 包体检：' + result.info.dir);
    console.log('='.repeat(56));
    console.log('类型 ' + (result.info.kind || '?') + ' · ' + (result.info.name || '?') + ' v' + (result.info.version || '?') +
      ' · ' + result.info.files + ' 文件 · ' + (result.info.bytes / 1024 / 1024).toFixed(1) + 'MB');
    console.log('');
    if (result.errors.length) {
      console.log('错误 ' + result.errors.length + ' 项：');
      for (const e of result.errors) console.log('  ✗ ' + e);
      console.log('');
    }
    if (result.warnings.length) {
      console.log('警告 ' + result.warnings.length + ' 项：');
      for (const w of result.warnings) console.log('  ! ' + w);
      console.log('');
    }
    console.log(result.ok ? '结果：通过。' : '结果：存在错误，修完再上架。');
    console.log('');
  }
  if (!result.ok) process.exitCode = 1;
}

function cmdPack(positional, flags) {
  const target = positional[0] || '.';
  const collected = collectPackage(target);
  if (flags.write) {
    const result = mergeIndex(flags.write, collected);
    console.log('');
    console.log((result.replaced ? '已更新' : '已追加') + '：' + result.section + '/' + result.name +
      '（index v' + result.version + '）');
    console.log('目录文件：' + path.resolve(flags.write));
    // 打包阶段提醒比 check 阶段更合适：check 是「代码对不对」，这里是「上架素材全不全」
    if (collected.section === 'apps') {
      const shots = path.join(collected.dir, 'screenshots');
      let hasShot = false;
      try { hasShot = fs.readdirSync(shots).some((f) => /\.(png|jpe?g|webp)$/i.test(f)); } catch (e) { hasShot = false; }
      if (!hasShot) {
        console.log('提示：还没有 screenshots/，市场详情页会是空白。建议放 1–2 张 1043×787 截图（深浅各一）。');
      }
    }
    console.log('');
    return;
  }
  const payload = flags.json
    ? JSON.stringify(collected.entry, null, 2)
    : JSON.stringify(collected.entry, null, 2);
  process.stdout.write(payload + '\n');
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional.shift();

  if (!command || command === 'help' || flags.help) return help();
  if (command === 'version' || flags.version) {
    console.log(VERSION);
    return;
  }

  try {
    if (command === 'create') return cmdCreate(positional, flags);
    if (command === 'check') return cmdCheck(positional, flags);
    if (command === 'pack') return cmdPack(positional, flags);
    console.error('未知命令: ' + command);
    help();
    process.exitCode = 2;
  } catch (e) {
    console.error('出错：' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  }
}

main();
