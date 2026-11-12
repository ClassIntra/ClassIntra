import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const DEVKIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(DEVKIT_ROOT, 'bin', 'cli.mjs');

async function temporaryProject(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'classintra-devkit-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

function run(args, cwd, cli = CLI) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000
  });
}

function assertSuccess(result, operation) {
  assert.equal(result.error, undefined, operation + ' process failed to start');
  assert.equal(result.status, 0, operation + ' failed:\n' + result.stderr + result.stdout);
}

async function createApp(root, name = 'author-demo') {
  const parent = path.join(root, 'packages');
  const created = run(['create', 'app', name, '--label', 'Author Demo', '--dir', parent], root);
  assertSuccess(created, 'create');
  return path.join(parent, name);
}

test('CLI creates, checks and packs an app using only the supplied temporary paths', async (t) => {
  const root = await temporaryProject(t);
  const app = await createApp(root);
  const checked = run(['check', app, '--json'], root);

  assertSuccess(checked, 'check generated app');
  const check = JSON.parse(checked.stdout);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  assert.equal(check.info.name, 'author-demo');

  const indexPath = path.join(root, 'market', 'index.json');
  const packed = run(['pack', app, '--write', indexPath], root);
  assertSuccess(packed, 'pack generated app');

  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  const entry = index.apps.find((item) => item.name === 'author-demo');
  assert.ok(entry, 'app entry should be written to the requested index');
  assert.deepEqual(entry.files, [
    'apps/author-demo/README.md',
    'apps/author-demo/frontend/entry.js',
    'apps/author-demo/frontend/style.css',
    'apps/author-demo/manifest.json'
  ]);
  const manifest = await readFile(path.join(app, 'manifest.json'));
  assert.equal(entry.hashes['manifest.json'], createHash('sha256').update(manifest).digest('hex'));
  assert.equal(await readdir(path.join(root, 'market')).then((files) => files.join(',')), 'index.json');
});

test('create prints check and pack commands for the generated --dir target', async (t) => {
  const root = await temporaryProject(t);
  const parent = path.join(root, 'author workspace');
  const created = run(['create', 'app', 'path-demo', '--dir', parent], root);
  assertSuccess(created, 'create with spaced parent directory');

  const target = path.relative(root, path.join(parent, 'path-demo'));
  const quotedTarget = '"' + target + '"';
  assert.match(created.stdout, new RegExp('check ' + quotedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(created.stdout, new RegExp('pack ' + quotedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' --write'));

  const checked = run(['check', target, '--json'], root);
  assertSuccess(checked, 'check generated --dir target');
  assert.equal(JSON.parse(checked.stdout).ok, true);
});

test('check exits non-zero and identifies an invalid manifest field', async (t) => {
  const root = await temporaryProject(t);
  const app = await createApp(root);
  await writeFile(path.join(app, 'manifest.json'), JSON.stringify({
    name: 'different-name',
    type: 'app',
    version: 'not-semver',
    frontend: { route: 'missing-leading-slash', entry: './frontend/entry.js' }
  }));

  const checked = run(['check', app, '--json'], root);
  assert.equal(checked.status, 1);
  const result = JSON.parse(checked.stdout);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes('manifest.name')));
  assert.ok(result.errors.some((message) => message.includes('version')));
  assert.ok(result.errors.some((message) => message.includes('frontend.route')));
});

test('check reports incompatible JavaScript with the file and a fix hint', async (t) => {
  const root = await temporaryProject(t);
  const app = await createApp(root);
  await writeFile(
    path.join(app, 'frontend', 'entry.js'),
    'const mount = () => window.location?.reload();\n'
  );

  const checked = run(['check', app, '--json'], root);
  assert.equal(checked.status, 1);
  const result = JSON.parse(checked.stdout);
  assert.ok(result.errors.some((message) =>
    message.includes('frontend/entry.js') && message.includes('const 声明') && message.includes('改用 var')
  ));
  assert.ok(result.errors.some((message) => message.includes('箭头函数')));
  assert.ok(result.errors.some((message) => message.includes('可选链')));
});

test('check rejects missing declared entry files before authors attempt installation', async (t) => {
  const root = await temporaryProject(t);
  const app = await createApp(root);
  await rm(path.join(app, 'frontend', 'entry.js'));
  const checked = run(['check', app, '--json'], root);
  assert.equal(checked.status, 1);
  assert.ok(JSON.parse(checked.stdout).errors.some(message => message.includes('frontend.entry') && message.includes('不存在')));
});

test('check rejects manifest paths escaping the package directory', async (t) => {
  const root = await temporaryProject(t);
  const app = await createApp(root);
  const manifest = JSON.parse(await readFile(path.join(app, 'manifest.json'), 'utf8'));
  manifest.frontend.entry = '../outside.js';
  await writeFile(path.join(app, 'manifest.json'), JSON.stringify(manifest));
  const checked = run(['check', app, '--json'], root);
  assert.equal(checked.status, 1);
  assert.ok(JSON.parse(checked.stdout).errors.some(message => message.includes('frontend.entry')));
});

test('pack refuses invalid packages without modifying the destination catalog', async (t) => {
  const root = await temporaryProject(t);
  const app = await createApp(root);
  await rm(path.join(app, 'frontend', 'entry.js'));
  const index = path.join(root, 'index.json');
  await writeFile(index, '{"version":7,"apps":[]}\n');
  const packed = run(['pack', app, '--write', index], root);
  assert.equal(packed.status, 1);
  assert.equal(await readFile(index, 'utf8'), '{"version":7,"apps":[]}\n');
});

test('SDK declaration files stay out of market installation payloads', async (t) => {
  const root = await temporaryProject(t);
  const app = await createApp(root);
  await writeFile(path.join(app, 'sdk.d.ts'), 'export interface EditorOnly {}\n');
  const packed = run(['pack', app, '--json'], root);
  assertSuccess(packed, 'pack with editor-only types');
  const entry = JSON.parse(packed.stdout);
  assert.equal(entry.files.some(file => file.endsWith('.d.ts')), false);
});

test('check rejects source files that the host installer cannot distribute', async (t) => {
  const root = await temporaryProject(t);
  const app = await createApp(root);
  await writeFile(path.join(app, 'frontend', 'source.ts'), 'export const message = "draft";');
  const checked = run(['check', app, '--json'], root);
  assert.equal(checked.status, 1);
  assert.ok(JSON.parse(checked.stdout).errors.some(message => message.includes('source.ts')));
});

test('generated app and plugin backends resolve the real installation-relative host path', async (t) => {
  const root = await temporaryProject(t);
  const host = path.join(root, 'host');
  for (const kind of ['app', 'plugin']) {
    const parent = path.join(host, kind === 'app' ? 'market-apps' : 'plugins');
    const name = 'backend-' + kind;
    assertSuccess(run(['create', kind, name, '--dir', parent, '--with-backend'], root), 'create backend ' + kind);
    const file = path.join(parent, name, 'backend', 'routes.js');
    const dependencies = [];
    const fakeDb = { prepare: () => ({ run() {} }) };
    const router = { get() {}, post() {} };
    const require = specifier => {
      if (specifier === 'express') return { Router: () => router };
      dependencies.push(path.resolve(path.dirname(file), specifier));
      return specifier.endsWith('/utils/db') ? fakeDb : { requireAuth() {} };
    };
    vm.runInNewContext(await readFile(file, 'utf8'), { require, module: { exports: {} } }, { filename: file });
    assert.ok(dependencies.includes(path.join(host, 'server', 'src', 'middleware', 'auth')), 'auth path must resolve inside the host installation');
  }
});

test('generated backend cleanup removes tables created by its scheduled job', async (t) => {
  const root = await temporaryProject(t);
  assertSuccess(run(['create', 'app', 'job-demo', '--dir', root, '--with-backend'], root), 'create job sample');
  const file = path.join(root, 'job-demo', 'backend', 'cleanup.js');
  const statements = [];
  const module = { exports: {} };
  vm.runInNewContext(await readFile(file, 'utf8'), {
    module, process: { cwd: () => path.join(root, 'host', 'server') },
    require: specifier => specifier === 'path' ? path : { prepare: sql => ({ run: () => statements.push(sql) }) }
  }, { filename: file });
  module.exports({ name: 'job-demo' });
  assert.ok(statements.includes('DROP TABLE IF EXISTS job_demo_items'));
  assert.ok(statements.includes('DROP TABLE IF EXISTS job_demo_pulse'));
});

test('generated service calls its API relative to the host client base URL', async (t) => {
  const root = await temporaryProject(t);
  assertSuccess(run(['create', 'service', 'service-demo', '--dir', root], root), 'create service');
  let definition;
  vm.runInNewContext(await readFile(path.join(root, 'service-demo', 'frontend', 'entry.js'), 'utf8'), {
    window: { ClassIntraMarket: { define: value => { definition = value; } } },
    document: { createElement: () => ({ style: {} }) }
  });
  const urls = [];
  definition.mount({ appendChild() {} }, { app: { onDestroy() {} }, data: { get: url => {
    urls.push(url);
    return Promise.resolve({ data: { ok: true } });
  } } });
  await Promise.resolve();
  assert.deepEqual(urls, ['/service-demo/health']);
});

test('repacking hashes package files and preserves operator-owned market metadata', async (t) => {
  const root = await temporaryProject(t);
  const app = await createApp(root);
  const indexPath = path.join(root, 'market', 'index.json');
  const firstPack = run(['pack', app, '--write', indexPath], root);
  assertSuccess(firstPack, 'initial pack');

  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  Object.assign(index.apps[0], {
    screenshots: ['screenshots/dark.png'],
    changelog: 'Maintainer-authored release notes',
    tags: ['classroom', 'notes'],
    featured: true,
    homepage: 'https://example.invalid/author-demo'
  });
  index.apps.push({ name: 'another-app', label: 'Keep this entry' });
  await writeFile(indexPath, JSON.stringify(index, null, 2));
  await writeFile(path.join(app, 'frontend', 'entry.js'), 'window.authorDemo = true;\n');

  const repacked = run(['pack', app, '--write', indexPath], root);
  assertSuccess(repacked, 'repack');
  const updated = JSON.parse(await readFile(indexPath, 'utf8'));
  const entry = updated.apps.find((item) => item.name === 'author-demo');
  assert.deepEqual(entry.screenshots, ['screenshots/dark.png']);
  assert.equal(entry.changelog, 'Maintainer-authored release notes');
  assert.deepEqual(entry.tags, ['classroom', 'notes']);
  assert.equal(entry.featured, true);
  assert.equal(entry.homepage, 'https://example.invalid/author-demo');
  assert.ok(updated.apps.some((item) => item.name === 'another-app'));

  const entryBytes = await readFile(path.join(app, 'frontend', 'entry.js'));
  assert.equal(entry.hashes['frontend/entry.js'], createHash('sha256').update(entryBytes).digest('hex'));
  assert.equal(entry.hashes['frontend/entry.js'], createHash('sha256').update('window.authorDemo = true;\n').digest('hex'));
  assert.deepEqual(entry.files, [
    'apps/author-demo/README.md',
    'apps/author-demo/frontend/entry.js',
    'apps/author-demo/frontend/style.css',
    'apps/author-demo/manifest.json'
  ]);
});

test('documented external quick-start commands run through the actual devkit CLI', async (t) => {
  const root = await temporaryProject(t);
  const guide = await readFile(path.resolve(DEVKIT_ROOT, '../docs/third-party-development.md'), 'utf8');
  const section = guide.match(/^## 外部开发者快速开始\s*\n([\s\S]*?)(?=^##? )/m);
  assert.ok(section, 'guide should provide an external developer quick-start section');
  const commandBlock = section[1].match(/```(?:bash|sh)\s*\n([\s\S]*?)```/);
  assert.ok(commandBlock, 'quick-start section should include runnable CLI commands');
  const commands = commandBlock[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('classintra-devkit '))
    .map((line) => line.split(/\s+/).slice(1));
  assert.deepEqual(commands.map((args) => args[0]), ['create', 'check', 'pack']);
  assert.ok(guide.indexOf('## 外部开发者快速开始') < guide.indexOf('## 主仓库贡献者工作流（仅第一方应用）'));
  assert.match(guide, /主仓库贡献者工作流（仅第一方应用）[\s\S]*?不是外部开发者的默认工具/);
  assert.match(guide, /外部市场包请使用上面的独立 devkit/);
  assert.match(guide, /以下应用、主题、小组件示例仅适用于第一方主仓/);
  assert.doesNotMatch(guide, /应用\/主题\/小组件均属\*\*主仓\*\*，直接提交/);
  assert.match(guide, /外部 devkit 包使用 `frontend\.entry`/);
  assert.match(guide, /外部 devkit 主题包使用 `tokens\.json`/);

  for (const args of commands) {
    const result = run(args, root);
    assertSuccess(result, 'documented ' + args[0]);
  }

  const check = JSON.parse(run(['check', './work/docs-sample', '--json'], root).stdout);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  const index = JSON.parse(await readFile(path.join(root, 'market', 'index.json'), 'utf8'));
  assert.ok(index.apps.some((item) => item.name === 'docs-sample'));
});

test('CLI help provides a runnable create-check-pack example', async (t) => {
  const root = await temporaryProject(t);
  const help = run(['--help'], root);
  assertSuccess(help, 'help');
  const examples = help.stdout.match(/示例：\s*\n([\s\S]*?)\n\n约定/);
  assert.ok(examples, 'help should have a standalone examples section');
  const commands = examples[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('classintra-devkit '))
    .map((line) => line.split(/\s+/).slice(1));
  assert.deepEqual(commands.map((args) => args[0]), ['create', 'check', 'pack']);

  for (const args of commands) {
    assertSuccess(run(args, root), 'help example ' + args[0]);
  }
  const index = JSON.parse(await readFile(path.join(root, 'market', 'index.json'), 'utf8'));
  assert.ok(index.apps.some((item) => item.name === 'help-sample'));
});

test('standalone devkit can export SDK types without cloning the host repository', async (t) => {
  const root = await temporaryProject(t);
  const target = path.join(root, 'types', 'classintra-sdk.d.ts');
  const result = run(['sdk', 'types', '--write', target], root);

  assertSuccess(result, 'sdk types');
  const content = await readFile(target, 'utf8');
  assert.match(content, /export interface MarketContext/);
  assert.match(content, /channels:/);
  assert.match(result.stdout, /SDK 类型已写入/);
});

test('standalone devkit exports its offline SDK guide and protects existing author notes', async (t) => {
  const root = await temporaryProject(t);
  const target = path.join(root, 'docs', 'SDK.md');
  const original = await readFile(path.join(DEVKIT_ROOT, 'SDK.md'), 'utf8');
  assertSuccess(run(['sdk', 'docs', '--write', target], root), 'export offline guide');
  assert.equal(await readFile(target, 'utf8'), original);
  await writeFile(target, 'My development notes\n');
  assert.equal(run(['sdk', 'docs', '--write', target], root).status, 1);
  assert.equal(await readFile(target, 'utf8'), 'My development notes\n');
  assertSuccess(run(['sdk', 'docs', '--write', target, '--force'], root), 'restore offline guide');
  assert.equal(await readFile(target, 'utf8'), original);
});

test('SDK export preserves an existing author-owned declaration unless forced', async (t) => {
  const root = await temporaryProject(t);
  const target = path.join(root, 'sdk.d.ts');
  await writeFile(target, '// custom types\n');
  assert.equal(run(['sdk', 'types', '--write', target], root).status, 1);
  assert.equal(await readFile(target, 'utf8'), '// custom types\n');
  assertSuccess(run(['sdk', 'types', '--write', target, '--force'], root), 'force SDK export');
});

test('published devkit files run and provide editor types from outside the monorepo', async (t) => {
  const root = await temporaryProject(t);
  const isolated = path.join(root, 'node_modules', 'classintra-devkit');
  const pkg = JSON.parse(await readFile(path.join(DEVKIT_ROOT, 'package.json'), 'utf8'));
  await mkdir(isolated, { recursive: true });
  for (const item of ['package.json', ...pkg.files]) {
    await cp(path.join(DEVKIT_ROOT, item), path.join(isolated, item), { recursive: true });
  }
  const cli = path.join(isolated, 'bin', 'cli.mjs');
  assertSuccess(run(['sdk', 'types', '--write', './sdk.d.ts'], root, cli), 'isolated SDK export');
  assertSuccess(run(['create', 'app', 'standalone-demo'], root, cli), 'isolated create');
  assertSuccess(run(['check', './standalone-demo'], root, cli), 'isolated check');
  const source = (await readFile(path.join(DEVKIT_ROOT, 'test', 'fixtures', 'sdk-contract.ts'), 'utf8'))
    .replace("'../../types/sdk'", "'classintra-devkit/sdk'");
  const fixture = path.join(root, 'consumer.ts');
  await writeFile(fixture, source);
  const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  for (const [module, resolution] of [['commonjs', 'node'], ['esnext', 'bundler'], ['nodenext', 'nodenext']]) {
    const compiled = spawnSync(process.execPath, [compiler, '--noEmit', '--strict', '--lib', 'ES2020,DOM',
      '--module', module, '--moduleResolution', resolution, fixture], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assertSuccess(compiled, 'isolated SDK consumer compile (' + resolution + ')');
  }
});
