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
import { mountPreview, unmountPreview, watchForReload, readManifest, resolveHost } from '../lib/preview.mjs';
import { installAction } from '../lib/install.mjs';

const VERSION = '0.1.0';

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const booleans = new Set(['help', 'version', 'json', 'force', 'with-backend', 'watch', 'update', 'uninstall']);
  const values = new Set(['label', 'dir', 'port', 'type', 'color', 'order', 'write', 'host', 'token', 'secret', 'user', 'source']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] === '-h' ? '--help' : argv[i] === '-v' ? '--version' : argv[i];
    if (token === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const key = token.slice(2, eq === -1 ? undefined : eq);
      if (!booleans.has(key) && !values.has(key)) throw usageError('未知选项：--' + key);
      if (booleans.has(key)) {
        if (eq !== -1) throw usageError('--' + key + ' 是开关，无需赋值');
        flags[key] = true;
      } else if (eq !== -1) {
        flags[key] = token.slice(eq + 1);
        if (!flags[key]) throw usageError('--' + key + ' 需要指定值');
      } else {
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) throw usageError('--' + key + ' 需要指定值');
        flags[key] = next;
        i++;
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
    '  classintra-devkit preview [目录] [--watch] [--host URL] [--token JWT | --secret KEY --user 账号]',
    '  classintra-devkit install <名> [--source local] [--update] [--uninstall] [--host URL] [凭据同上]',
    '  classintra-devkit sdk types [--write sdk.d.ts] [--force] # 导出宿主 SDK 类型',
    '  classintra-devkit sdk docs  [--write SDK.md] [--force]   # 离线指南与恢复',
    '',
    '示例：',
    '  classintra-devkit create app help-sample --label 示例应用 --dir ./work',
    '  classintra-devkit check ./work/help-sample --json',
    '  classintra-devkit pack ./work/help-sample --write ./market/index.json',
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
  const target = path.relative(process.cwd(), result.dir) || '.';
  const targetArg = '"' + target.replace(/"/g, '\\"') + '"';
  console.log('  1) 改 manifest.json 的 label / version');
  console.log('  2) 写 frontend/entry.js（微前端）或把 dist 拷进 frontend/（静态站）');
  console.log('  3) npx classintra-devkit check ' + targetArg);
  console.log('  4) npx classintra-devkit preview ' + targetArg + '   # 真实宿主免安装预览（需宿主开启 CLASSINTRA_DEV_PREVIEW=1）');
  console.log('  5) npx classintra-devkit pack ' + targetArg + ' --write <market>/index.json → install <名> --source local');
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
    if (flags.json) {
      process.stdout.write(JSON.stringify({ ok: true, ...result, entry: collected.entry }, null, 2) + '\n');
      return;
    }
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

function cmdSdk(positional, flags) {
  const resources = { types: '../types/sdk.d.ts', docs: '../SDK.md' };
  const resource = Object.prototype.hasOwnProperty.call(resources, positional[0]) && resources[positional[0]];
  if (!resource) throw new Error('用法：classintra-devkit sdk <types|docs> [--write 文件] [--force]');
  const content = fs.readFileSync(new URL(resource, import.meta.url), 'utf8');
  if (!flags.write) {
    process.stdout.write(content);
    return;
  }
  if (typeof flags.write !== 'string') throw new Error('--write 需要指定类型文件路径');
  const target = path.resolve(flags.write);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { encoding: 'utf8', flag: flags.force ? 'w' : 'wx' });
  console.log((positional[0] === 'types' ? 'SDK 类型已写入：' : 'SDK 指南已写入：') + target);
}

function authOptions(flags) {
  return { host: flags.host, token: flags.token, secret: flags.secret, user: flags.user };
}

async function cmdPreview(positional, flags) {
  const target = positional[0] || '.';
  const manifest = readManifest(target); // 目录/manifest 非法时 fail fast
  const options = authOptions(flags);
  const app = await mountPreview(target, options);
  const base = resolveHost(options);
  console.log('');
  console.log('预览已挂载：' + app.name + ' v' + (app.version || '0.0.0') + '（免安装，服务重启即清）');
  if (app.route) {
    console.log('  前端：' + base + app.route + '  ← 班管账号登录宿主后打开（局域网平板同地址可达）');
  }
  if (manifest.backend && manifest.backend.mountPath) {
    console.log('  后端：' + base + manifest.backend.mountPath);
  }
  if (flags.watch) {
    console.log('  watch：backend/ 与 manifest.json 变更后自动重挂（前端改动刷新页面即生效）');
    console.log('  退出：Ctrl+C（自动注销预览）');
    const stopWatch = watchForReload(target, function(what) {
      mountPreview(target, options).then(function() {
        console.log('[watch] 已重挂载 ' + app.name + (what ? '（' + path.basename(String(what)) + ' 变更）' : ''));
      }).catch(function(e) {
        console.error('[watch] 重挂载失败: ' + e.message);
      });
    });
    let unmounting = false;
    process.on('SIGINT', function() {
      if (unmounting) return;
      unmounting = true;
      stopWatch();
      unmountPreview(app.name, options).then(function() {
        console.log('\n预览已注销');
        process.exit(0);
      }).catch(function() {
        process.exit(0); // 注销失败不阻断退出（服务重启同样会清掉）
      });
    });
  } else {
    console.log('  注销：Ctrl+C 不会清（本模式挂载保留到服务重启）；要主动注销用 --watch 模式或 DELETE /api/market/dev-preview/' + app.name);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, app: app }, null, 2) + '\n');
  }
  console.log('');
}

async function cmdInstall(positional, flags) {
  const name = positional[0];
  if (!name) {
    console.error('缺少参数：install <应用名> [--source local] [--update] [--uninstall]');
    process.exitCode = 2;
    return;
  }
  const options = Object.assign(
    { action: flags.uninstall ? 'uninstall' : (flags.update ? 'update' : 'install') },
    authOptions(flags),
    { source: flags.source }
  );
  const result = await installAction(name, options);
  const data = (result && result.data) || {};
  const verb = options.action === 'uninstall' ? '已卸载' : (options.action === 'update' ? '已更新' : '已安装');
  console.log('');
  console.log(verb + '：' + name + (data.version ? ' v' + data.version : ''));
  if (options.action !== 'uninstall') {
    console.log('  数据' + (data.dataRetained === false ? '已清除' : '已保留（默认；可用 app-data-purge 主动清）'));
  }
  if (Array.isArray(data.configRequired) && data.configRequired.length) {
    console.log('  待配置项：' + data.configRequired.join(', ') + '（管理端「配置」入口填写）');
  }
  console.log('');
}

async function main() {
  try {
    const { positional, flags } = parseArgs(process.argv.slice(2));
    const command = positional.shift();

    if (command === 'help' || flags.help) return help();
    if (command === 'version' || flags.version) {
      console.log(VERSION);
      return;
    }
    if (!command) return help();

    if (command === 'create') return cmdCreate(positional, flags);
    if (command === 'check') return cmdCheck(positional, flags);
    if (command === 'pack') return cmdPack(positional, flags);
    if (command === 'sdk') return cmdSdk(positional, flags);
    if (command === 'preview') return await cmdPreview(positional, flags);
    if (command === 'install') return await cmdInstall(positional, flags);
    console.error('未知命令: ' + command);
    help();
    process.exitCode = 2;
  } catch (e) {
    console.error('出错：' + (e && e.message ? e.message : e));
    process.exitCode = e.exitCode || 1;
  }
}

main();
