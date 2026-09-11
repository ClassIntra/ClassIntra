// manifest-schema 扩展字段验证（第三期「规范收敛」）
//
// 用途：作为质量门，验证 manifest schema 的新增字段与前后端一致性。
//   pnpm verify:schema
//
// 检查范围：
//   1. shared 与 server 两份 schema 的常量一致性（防止改一处漏一处）
//   2. 向后兼容：旧 manifest（无 sdk/capabilities/layout）仍能通过
//   3. sdk 版本校验：高于当前主版本时阻断，格式非法时降级
//   4. capabilities 披露：未知能力不阻断（开放模型），但产生警告
//   5. layout 布局偏好：枚举校验与类型校验

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd().replace(/\\/g, '/');
const shared = await import(pathToFileURL(ROOT + '/shared/src/manifest-schema.js').href);
const require = createRequire(pathToFileURL(ROOT + '/'));
const server = require(ROOT + '/server/src/core/manifest-schema.js');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

console.log('=== 1. 常量一致性（shared 与 server）===');
ok(shared.CURRENT_SDK_VERSION === server.CURRENT_SDK_VERSION,
  'CURRENT_SDK_VERSION 一致 (' + shared.CURRENT_SDK_VERSION + ')');
ok(JSON.stringify(shared.KNOWN_CAPABILITIES) === JSON.stringify(server.KNOWN_CAPABILITIES),
  'KNOWN_CAPABILITIES 一致（' + shared.KNOWN_CAPABILITIES.length + ' 项）');
ok(JSON.stringify(shared.LAYOUT_MODES) === JSON.stringify(server.LAYOUT_MODES),
  'LAYOUT_MODES 一致');
ok(Object.keys(shared.FIELD_DEFS).length === Object.keys(server.FIELD_DEFS).length,
  'FIELD_DEFS 字段数一致 (' + Object.keys(shared.FIELD_DEFS).length + ')');

console.log('\n=== 2. 向后兼容：旧 manifest（无 sdk/capabilities/layout）===');
const legacy = { name: 'legacy-app', label: '旧应用', frontend: { route: '/legacy', component: 'Legacy' } };
const r1 = shared.validateManifest(legacy);
ok(r1.valid === true, '旧 manifest 仍通过验证');
ok(r1.manifest.sdk === '1', 'sdk 缺省为 "1"');
ok(Array.isArray(r1.manifest.capabilities) && r1.manifest.capabilities.length === 0,
  'capabilities 缺省为空数组');
ok(r1.manifest.layout === undefined, 'layout 未声明时不产生字段');

console.log('\n=== 3. sdk 版本校验 ===');
const sdkEqual = shared.validateManifest({ name: 'a', label: 'A', sdk: '1' });
ok(sdkEqual.valid === true, 'sdk="1"（等于当前）通过');

const sdkOld = shared.validateManifest({ name: 'b', label: 'B', sdk: '1' });
ok(sdkOld.valid === true, 'sdk 与当前相同通过');

const sdkNew = shared.validateManifest({ name: 'c', label: 'C', sdk: '2' });
ok(sdkNew.valid === false, 'sdk="2"（高于当前）被阻断');
ok(sdkNew.errors.some((e) => e.includes('SDK v2')), '错误信息包含所需版本号');
ok(sdkNew.errors.some((e) => e.includes('升级 ClassIntra')), '错误信息给出行动指引');

const sdkBad = shared.validateManifest({ name: 'd', label: 'D', sdk: 'abc' });
ok(sdkBad.valid === true, 'sdk 格式非法时不阻断（仅警告）');
ok(sdkBad.warnings.some((w) => w.includes('sdk 字段应为纯数字')), 'sdk 格式非法产生警告');
ok(sdkBad.manifest.sdk === '1', 'sdk 格式非法时回落为缺省值');

console.log('\n=== 4. capabilities 披露（非拦截）===');
const capsOk = shared.validateManifest({
  name: 'e', label: 'E',
  capabilities: ['data.storage', 'system.notification']
});
ok(capsOk.valid === true, '已知能力不阻断');
ok(capsOk.manifest.capabilities.length === 2, 'abilities 正常保留 2 项');
ok(capsOk.warnings.length === 0, '已知能力不产生警告');

const capsUnknown = shared.validateManifest({
  name: 'f', label: 'F',
  capabilities: ['data.storage', 'system.telepathy']
});
ok(capsUnknown.valid === true, '未知能力不阻断（开放模型）');
ok(capsUnknown.warnings.some((w) => w.includes('system.telepathy')), '未知能力产生警告');

const capsBadType = shared.validateManifest({ name: 'g', label: 'G', capabilities: 'not-array' });
ok(capsBadType.valid === true, 'capabilities 非数组不阻断');
ok(capsBadType.warnings.some((w) => w.includes('capabilities 应为数组')), 'capabilities 非数组产生警告');
ok(Array.isArray(capsBadType.manifest.capabilities), 'capabilities 归一化为空数组');

const capsMixed = shared.validateManifest({ name: 'h', label: 'H', capabilities: ['data.storage', 123, null] });
ok(capsMixed.manifest.capabilities.length === 1, '非字符串能力项被过滤（保留 1 项）');

console.log('\n=== 5. layout 布局偏好 ===');
const layoutOk = shared.validateManifest({
  name: 'i', label: 'I',
  layout: { mode: 'window', resizable: true, minWidth: 480, minHeight: 360 }
});
ok(layoutOk.valid === true, '合法 layout 通过');
ok(layoutOk.manifest.layout.mode === 'window', 'layout.mode 保留');
ok(layoutOk.manifest.layout.minWidth === 480, 'layout.minWidth 保留');

const layoutDefault = shared.validateManifest({ name: 'j', label: 'J', layout: {} });
ok(layoutDefault.manifest.layout.mode === 'fullscreen', '缺省 mode 为 fullscreen');

const layoutBadMode = shared.validateManifest({ name: 'k', label: 'K', layout: { mode: 'floating' } });
ok(layoutBadMode.manifest.layout.mode === 'fullscreen', '非法 mode 降级为 fullscreen');
ok(layoutBadMode.warnings.some((w) => w.includes('floating')), '非法 mode 产生警告');

const layoutBadType = shared.validateManifest({ name: 'l', label: 'L', layout: 'fullscreen' });
ok(layoutBadType.manifest.layout === undefined, 'layout 非对象时被忽略');

const layoutBadNum = shared.validateManifest({ name: 'm', label: 'M', layout: { minWidth: 'wide' } });
ok(layoutBadNum.manifest.layout.minWidth === undefined, 'layout.minWidth 非法类型被剔除');
ok(layoutBadNum.warnings.some((w) => w.includes('minWidth')), 'layout.minWidth 非法产生警告');

console.log('\n=== 6. compareVersions ===');
ok(shared.compareVersions('1.2.3', '1.2.3') === 0, '1.2.3 == 1.2.3');
ok(shared.compareVersions('2.0.0', '1.9.9') === 1, '2.0.0 > 1.9.9');
ok(shared.compareVersions('1.0.0', '1.0.1') === -1, '1.0.0 < 1.0.1');
ok(shared.compareVersions('1.2', '1.2.0') === 0, '1.2 == 1.2.0（缺位补零）');
ok(server.compareVersions('2.0.0', '1.0.0') === 1, '服务端 compareVersions 一致');

console.log('\n=== 7. 组合场景：新应用声明全部新字段 ===');
const full = shared.validateManifest({
  name: 'my-modern-app',
  label: '现代应用',
  version: '1.2.0',
  sdk: '1',
  capabilities: ['data.storage', 'data.realtime', 'ui.toast'],
  layout: { mode: 'fullscreen', resizable: false },
  frontend: { route: '/modern', component: 'Modern' }
});
ok(full.valid === true, '完整字段的 manifest 通过');
ok(full.errors.length === 0, '无错误');
ok(full.warnings.length === 0, '无警告');

console.log('\n=== 8. 能力目录与 schema 的 KNOWN_CAPABILITIES 一致性 ===');
// shared/src/capability-catalog.js 是能力的「展示层」，manifest-schema 是「校验层」。
// 两者枚举必须完全一致，否则会出现「能通过校验但 UI 显示未登记」的错位。
const catalog = await import('../shared/src/capability-catalog.js');
const schemaCaps = shared.KNOWN_CAPABILITIES || [];
const catalogNames = catalog.KNOWN_CAPABILITY_NAMES || [];
const missingInCatalog = schemaCaps.filter((c) => catalogNames.indexOf(c) === -1);
const extraInCatalog = catalogNames.filter((c) => schemaCaps.indexOf(c) === -1);
ok(missingInCatalog.length === 0, 'schema 中每个能力都在目录里有展示元数据'
  + (missingInCatalog.length ? '（缺: ' + missingInCatalog.join(', ') + '）' : ''));
ok(extraInCatalog.length === 0, '目录中没有 schema 未登记的能力'
  + (extraInCatalog.length ? '（多: ' + extraInCatalog.join(', ') + '）' : ''));

console.log('\n=== 9. describeCapability 行为 ===');
const d1 = catalog.describeCapability('data.realtime');
ok(d1.known === true && d1.label === '实时通信', '已知能力返回中文标签');
const d2 = catalog.describeCapability('future.unknown');
ok(d2.known === false && d2.label === 'future.unknown', '未知能力回退为原始名并标记未登记');
const sorted = catalog.describeCapabilities(['ui.toast', 'system.notification']);
ok(sorted[0].level === 'notice', 'notice 级能力排在普通能力之前');
ok(catalog.countNotices(['ui.toast', 'system.notification', 'device.camera']) === 2, 'countNotices 统计正确');
ok(catalog.describeCapabilities(null).length === 0, 'describeCapabilities 对非数组返回空数组');

console.log('\n================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
