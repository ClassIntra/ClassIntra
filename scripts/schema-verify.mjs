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
// KNOWN_ROLES 曾经漏检 → 两份 schema 真的分叉过：shared 有 classAdmin，server 没有，
// 导致 apps/market 每次启动刷 warning，且声明 classAdmin 的市场应用会被 market-service
// 按 errors 判不合格、装不上。5 个导出常量必须一个不落地比对。
ok(JSON.stringify(shared.KNOWN_ROLES) === JSON.stringify(server.KNOWN_ROLES),
  'KNOWN_ROLES 一致（' + (shared.KNOWN_ROLES || []).join(' / ') + '）');
ok(JSON.stringify(Object.keys(shared.FIELD_DEFS)) === JSON.stringify(Object.keys(server.FIELD_DEFS)),
  'FIELD_DEFS 字段名集合一致 (' + Object.keys(shared.FIELD_DEFS).length + ')');

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

console.log('\n=== 10. visibleRoles 受众令牌（前后端必须同口径）===');
// 令牌不是 users.role 的枚举：消费方 Desktop.vue 的 isVisibleForUser() 对 'classAdmin'
// 有独立判定（is_class_admin || is_admin，明确不含 officer 班干）。
// 校验器若不承认它，就会出现「前端认、后端拒」——同一份 manifest 两套结论。
const VR_TOKENS = ['classAdmin', 'admin', 'officer', 'student'];
const hasRoleWarn = (r) => r.warnings.some((w) => w.indexOf('不是已知角色') !== -1);
VR_TOKENS.forEach((t) => {
  ok(shared.KNOWN_ROLES.indexOf(t) !== -1, 'shared 承认受众令牌 ' + t);
  ok(server.KNOWN_ROLES.indexOf(t) !== -1, 'server 承认受众令牌 ' + t);
});
const vrShared = shared.validateManifest({ name: 'vr', label: 'VR', visibleRoles: ['classAdmin'] });
const vrServer = server.validateManifest({ name: 'vr', label: 'VR', visibleRoles: ['classAdmin'] });
ok(!hasRoleWarn(vrShared), 'shared 校验 classAdmin 不再报「不是已知角色」');
ok(!hasRoleWarn(vrServer), 'server 校验 classAdmin 不再报「不是已知角色」');
ok(JSON.stringify(vrShared.manifest.visibleRoles) === JSON.stringify(['classAdmin'])
  && JSON.stringify(vrServer.manifest.visibleRoles) === JSON.stringify(['classAdmin']),
  'visibleRoles 被原样保留（未被过滤或改写）');
// 反向对照：真正未知的令牌必须继续报警，否则说明这道校验已被改废
ok(hasRoleWarn(server.validateManifest({ name: 'vrb', label: 'VRB', visibleRoles: ['nonsense'] })),
  '未知令牌仍然报警（校验未被改废）');

console.log('\n=== 8. 扩展主题 profile 令牌（个人主页装扮接口）===');
// 这条链路没有任何运行时兜底：schema 放行了不该放行的键，就会直接写进 CSS 变量。
const themeSchema = await import(pathToFileURL(ROOT + '/shared/src/theme-extension-schema.js').href);
ok(Array.isArray(themeSchema.PROFILE_TOKENS) && themeSchema.PROFILE_TOKENS.indexOf('accent') !== -1,
  'PROFILE_TOKENS 已导出且包含 accent（消费端别名依赖这份清单）');
ok(themeSchema.CAPABILITIES.indexOf('profile-skin') !== -1,
  'capabilities 枚举包含 profile-skin');

const extBase = { schema: themeSchema.SCHEMA_VERSION, id: 'probe-ext', name: 'Probe Ext', entry: './apply.js' };
const extGood = themeSchema.validateThemeExtensionManifest(Object.assign({}, extBase, {
  profile: {
    accent: '#7C4DFF',
    radius: '20px',
    'cover-overlay': 'linear-gradient(to top, rgba(0, 0, 0, 0.4), transparent)'
  }
}));
ok(extGood.valid && extGood.manifest.profile.accent === '#7C4DFF' && extGood.manifest.profile.radius === '20px',
  '合法 profile（颜色 + 长度 + 渐变）被原样保留');
ok(extGood.manifest.profile['cover-overlay'] === 'linear-gradient(to top, rgba(0, 0, 0, 0.4), transparent)',
  '渐变值中的括号/逗号/透明度不被误杀');

const extBad = themeSchema.validateThemeExtensionManifest(Object.assign({}, extBase, {
  profile: { accent: '#FFFFFF', 'not-a-token': '1', 'card-bg': 'url(http://evil/x.png)' }
}));
ok(extBad.valid, '未知键 / 危险值只产生告警，不阻断整包（开放模型）');
ok(!extBad.manifest.profile['not-a-token'] && !extBad.manifest.profile['card-bg'],
  '未知键与 url() 值被静默丢弃（不会漏进 CSS 变量）');
ok(!themeSchema.validateThemeExtensionManifest(extBase).manifest.profile,
  '未声明 profile 时不注入空对象（保持 manifest 忠实）');

// 命名契约：tokens.profile → --ci-profile-*（消费端 global.scss 的 --pf-* 别名依赖它）
const themeAdapter = await import(pathToFileURL(ROOT + '/shared/src/theme-adapter.js').href);
const flatProfile = themeAdapter.flattenTokens({ profile: extGood.manifest.profile });
ok(flatProfile['--ci-profile-accent'] === '#7C4DFF'
  && flatProfile['--ci-profile-radius'] === '20px'
  && String(flatProfile['--ci-profile-cover-overlay']).indexOf('linear-gradient') === 0,
  'tokens.profile 展平为 --ci-profile-* 且 kebab 键不被二次改写');

console.log('\n================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
