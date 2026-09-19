#!/usr/bin/env node
// ClassIntra 第三方开发脚手架（应用 / 主题 / 桌面小组件 三合一）
// 用法：
//   node scripts/scaffold.js app <app-name> --label "显示名" [--route /<path>]
//   node scripts/scaffold.js theme <theme-id> --name "主题名" [--type light|dark]
//   node scripts/scaffold.js widget <app-name> <widget-id> --name "小组件名"
// 生成内容见各模板；生成后按提示用 node scripts/diag.js 校验。

var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');

// kebab-case → PascalCase（my-app → MyApp）
function pascal(kebab) {
  return kebab.split('-').map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); }).join('');
}

// 十六进制颜色按比例混合（mix('#0A84FF', '#ffffff', 0.38) → 亮 38%）
function mix(hex, other, ratio) {
  var a = String(hex).replace('#', '');
  var b = String(other).replace('#', '');
  if (a.length === 3) a = a.split('').map(function (c) { return c + c; }).join('');
  if (b.length === 3) b = b.split('').map(function (c) { return c + c; }).join('');
  var pa = [0, 2, 4].map(function (i) { return parseInt(a.substr(i, 2), 16) || 0; });
  var pb = [0, 2, 4].map(function (i) { return parseInt(b.substr(i, 2), 16) || 0; });
  return '#' + pa.map(function (v, i) {
    var c = Math.round(v + (pb[i] - v) * ratio);
    return ('0' + c.toString(16)).slice(-2);
  }).join('');
}

// 满铺应用图标模板（512 viewBox）：
// 资产顶格画布、内容铺满 100%，圆角由 AppIcon 容器 CSS 统一裁切（72px + radius 20px + cover）——
// 图标资产本身绝不留白（项目硬性规范，详见 docs/third-party-development.md 图标规范一节）
function iconSvg(label, color) {
  var light = mix(color, '#ffffff', 0.38);
  var dark = mix(color, '#000000', 0.28);
  var initial = String(label).trim().charAt(0).toUpperCase() || 'A';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="gBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${light}"/>
      <stop offset="0.5" stop-color="${color}"/>
      <stop offset="1" stop-color="${dark}"/>
    </linearGradient>
  </defs>

  <!-- 直角满铺底（根 rect 严禁 rx/ry：资产内烘焙圆角小于容器裁切比例 20/72 时，四角会露出透明缝隙） -->
  <rect width="512" height="512" fill="url(#gBg)"/>
  <!-- 顶部柔光提升通透感 -->
  <ellipse cx="256" cy="90" rx="300" ry="170" fill="#FFFFFF" opacity="0.13"/>

  <!-- 首字母（TODO：替换为你的图标主体图形，保持内容顶格铺满） -->
  <text x="256" y="358" text-anchor="middle" font-size="300" font-weight="700"
    font-family="-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fill="#FFFFFF" fill-opacity="0.96">${initial}</text>
</svg>
`;
}

// 解析 --key value 形式参数
function argOf(key, fallback) {
  var i = process.argv.indexOf(key);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : fallback;
}

var kind = process.argv[2];

// ---------------- 应用脚手架 ----------------
function scaffoldApp(name) {
  if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    console.error('应用名必须是 kebab-case（小写字母/数字/连字符）');
    process.exit(1);
  }
  var label = argOf('--label', name);
  var route = argOf('--route', '/' + name);
  var routeName = pascal(name);
  var target = path.join(root, 'apps', name);
  if (fs.existsSync(target)) { console.error('应用目录已存在：' + target); process.exit(1); }
  fs.mkdirSync(path.join(target, 'frontend'), { recursive: true });

  var manifest = {
    name: name,
    type: 'app',
    version: '0.1.0',
    label: label,
    icon: './icon.svg',
    color: '#0A84FF',
    category: 'desktop',
    order: 99,
    defaultEnabled: true,
    canDisable: true,
    frontend: {
      route: route,
      routeName: routeName,
      component: './frontend/' + routeName + '.vue'
    }
  };
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  // 满铺图标：相对路径由 app-registry 自动重写为 /apps-static/<name>/icon.svg
  fs.writeFileSync(path.join(target, 'icon.svg'), iconSvg(label, manifest.color));

  var vue = `<!-- ${label} 应用主页面（第三方应用模板） -->
<!-- 约定：Options API / var 声明 / 单引号 / 2 空格缩进；样式自包含 -->
<template>
  <div class="${name}-page">
    <div class="page-card">
      <h2>${label}</h2>
      <p class="page-tip">这是第三方应用模板，替换为你的业务内容。</p>
      <button class="page-btn" @click="count = count + 1">点击了 {{ count }} 次</button>
    </div>
  </div>
</template>

<script>
export default {
  name: '${routeName}',
  data: function () {
    return {
      count: 0
    };
  }
};
</script>

<style scoped>
.${name}-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 24px;
}
.page-card {
  background: var(--bg-secondary, rgba(255, 255, 255, 0.72));
  border-radius: 18px;
  padding: 32px 40px;
  text-align: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}
.page-tip {
  color: var(--text-secondary, #86868b);
  font-size: 14px;
  margin: 12px 0 20px;
}
.page-btn {
  background: var(--primary, #0A84FF);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 22px;
  font-size: 15px;
  cursor: pointer;
}
</style>
`;
  fs.writeFileSync(path.join(target, 'frontend', routeName + '.vue'), vue);

  var readme = `# ${label}（${name}）

TODO：应用功能说明。

## 开发流程

1. 编辑 \`frontend/${routeName}.vue\` 写页面（Options API / var / 单引号 / 2 空格）
2. 需要后端时：建 \`backend/routes.js\`（参考 apps/ai-chat/backend/routes.js），并在 manifest.json 加 backend 声明
3. 校验：\`node scripts/diag.js app ${name}\`（\`diag.js compat ${name}\` 可查 Chrome 80 兼容性）
4. 构建生效：\`node scripts/build-app.js ${name}\`（含 lint + vite 全量构建；开发期用 cd client && npx vite dev 热更新免构建）
5. 重启服务器：\`cd server && node src/app.js\`（后端 manifest 启动时扫描；改了 manifest.json 或 backend 都要重启）
6. 桌面小组件：\`node scripts/scaffold.js widget ${name} <widget-id> --name "名称"\`（自动合并进 manifest）

## 生效条件速记

- 新增/修改前端页面、小组件 → 必须重新**构建**（前端 manifest 是构建时扫描）
- 新增/修改 backend、manifest.json → 必须重启**服务器**
- 完整文档：\`docs/third-party-development.md\`
`;
  fs.writeFileSync(path.join(target, 'README.md'), readme);

  console.log('已生成应用骨架：apps/' + name + '/');
  console.log('  manifest.json               route=' + route);
  console.log('  icon.svg                    满铺图标模板（首字母渐变，替换为你的图形）');
  console.log('  frontend/' + routeName + '.vue');
  console.log('  README.md');
  console.log('下一步：node scripts/diag.js app ' + name + '  校验，然后开始写业务');
  console.log('开发循环：编辑 → diag 校验 → build-app 构建（或 vite dev 热更新）→ 重启 server；详见生成的 README.md');
}

// ---------------- 主题脚手架 ----------------
function scaffoldTheme(id) {
  if (!id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    console.error('主题 id 必须是 kebab-case（小写字母/数字/连字符）');
    process.exit(1);
  }
  var name = argOf('--name', id);
  var type = argOf('--type', 'light');
  if (type !== 'light' && type !== 'dark') {
    console.error('主题 type 必须为 light 或 dark（theme-loader 强约束）');
    process.exit(1);
  }
  var target = path.join(root, 'themes', id);
  if (fs.existsSync(target)) { console.error('主题目录已存在：' + target); process.exit(1); }
  fs.mkdirSync(target, { recursive: true });

  var manifest = {
    id: id,
    name: name,
    type: type,
    version: '0.1.0',
    description: 'TODO：主题描述',
    tokens: './tokens.js',
    icons: null
  };
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  var tokens = `// ${name} 主题 Token 定义
// 结构对照 themes/dark/tokens.js；tokens.js 导出 TOKENS 对象（theme-loader 读取 TOKENS/default）
// 覆盖哪些 token 就写哪些——未覆盖项回退到全局默认值

var TOKENS = {
  color: {
    // 品牌色
    primary: '#0A84FF',
    primaryHover: '#409CFF',
    primaryPressed: '#0066CC',
    primaryRgb: '10, 132, 255',

    // 应用强调色（桌面图标/入口点缀）
    accent: {
      music: '#FF2D55',
      weather: '#4A90D9',
      community: '#FF9500',
      chat: '#34C759',
      notes: '#FFCC00'
    },

    // 语义色
    semantic: {
      success: '#34C759',
      successRgb: '52, 199, 89',
      warning: '#FF9500',
      warningRgb: '255, 149, 0',
      danger: '#FF3B30',
      dangerRgb: '255, 59, 48'
    }

    // TODO：对照 themes/dark/tokens.js 补全背景/文字/毛玻璃等完整 token 集
  },
  shape: {
    radius: { sm: '6px', md: '12px', lg: '18px' }
  },
  shadow: {
    card: '0 8px 24px rgba(0, 0, 0, 0.08)'
  },
  motion: {
    duration: { fast: '0.15s', normal: '0.25s' }
  }
};

if (typeof module !== 'undefined') module.exports = { TOKENS: TOKENS };
`;
  fs.writeFileSync(path.join(target, 'tokens.js'), tokens);

  console.log('已生成主题骨架：themes/' + id + '/（type=' + type + '）');
  console.log('  manifest.json');
  console.log('  tokens.js            精简骨架，对照 themes/dark/tokens.js 补全');
  console.log('下一步：node scripts/diag.js theme ' + id + '  校验；前端构建后主题列表可见');
}

// ---------------- 桌面小组件脚手架 ----------------
function scaffoldWidget(appName, widgetId) {
  var appDir = path.join(root, 'apps', appName);
  var manifestPath = path.join(appDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('应用不存在：apps/' + appName + '（先 node scripts/scaffold.js app ' + appName + '）');
    process.exit(1);
  }
  if (!widgetId || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(widgetId)) {
    console.error('小组件 id 必须是 kebab-case');
    process.exit(1);
  }
  var widgetName = argOf('--name', widgetId);
  var pascalId = pascal(widgetId);
  var comp = pascalId.slice(-6) === 'Widget' ? pascalId : pascalId + 'Widget'; // 防止 xxx-widget 生成 XxxWidgetWidget
  var widgetsDir = path.join(appDir, 'frontend', 'widgets');
  fs.mkdirSync(widgetsDir, { recursive: true });
  var vuePath = path.join(widgetsDir, comp + '.vue');
  if (fs.existsSync(vuePath)) { console.error('组件已存在：' + vuePath); process.exit(1); }

  var vue = `<!-- ${widgetName} 桌面小组件（${appName}） -->
<!-- 桌面网格以 w/h 为单位（defaultSize/minSize/maxSize 见应用 manifest）；
     config 由桌面按 configSchema 渲染表单并传入 props -->
<template>
  <div class="${widgetId}-widget" @click="$emit('open-app', '${appName}')">
    <div class="widget-title">${widgetName}</div>
    <div class="widget-body">TODO：小组件内容</div>
  </div>
</template>

<script>
export default {
  name: '${comp}',
  props: {
    // configSchema 定义的配置项会作为 props 传入（见应用 manifest）
    config: { type: Object, default: function () { return {}; } }
  }
};
</script>

<style scoped>
.${widgetId}-widget {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 14px;
  border-radius: var(--radius-lg, 18px);
  background: var(--bg-secondary, rgba(255, 255, 255, 0.72));
  cursor: pointer;
}
.widget-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #86868b);
}
.widget-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary, #1d1d1f);
}
</style>
`;
  fs.writeFileSync(vuePath, vue);

  // 自动合并进应用 manifest（消除手动编辑步骤）
  var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.frontend || typeof manifest.frontend !== 'object') manifest.frontend = {};
  if (!Array.isArray(manifest.frontend.widgets)) manifest.frontend.widgets = [];
  var dup = manifest.frontend.widgets.some(function (w) { return w.id === widgetId; });
  if (dup) {
    console.error('小组件 id 已存在于 manifest：' + widgetId + '（组件文件已生成，请手动检查 manifest.frontend.widgets）');
    process.exit(1);
  }
  manifest.frontend.widgets.push({
    id: widgetId,
    name: widgetName,
    component: './frontend/widgets/' + comp + '.vue',
    defaultSize: { w: 2, h: 1 },
    minSize: { w: 1, h: 1 },
    maxSize: { w: 4, h: 2 },
    description: widgetName,
    configSchema: { fields: [] }
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log('已生成小组件组件：apps/' + appName + '/frontend/widgets/' + comp + '.vue');
  console.log('已自动合并进 manifest：frontend.widgets[' + (manifest.frontend.widgets.length - 1) + ']（id=' + widgetId + '，默认 2x1）');
  console.log('');
  console.log('下一步：');
  console.log('  1. 编辑组件写内容；配置项在 manifest 的 configSchema.fields 定义（自动以 props.config 传入）');
  console.log('  2. node scripts/diag.js app ' + appName + '  校验');
  console.log('  3. cd client && node node_modules/vite/bin/vite.js build  构建（前端 manifest 构建时扫描，新组件必须构建后生效）');
}

// ---------------- 入口 ----------------
var handlers = {
  app: function () { scaffoldApp(process.argv[3]); },
  theme: function () { scaffoldTheme(process.argv[3]); },
  widget: function () { scaffoldWidget(process.argv[3], process.argv[4]); }
};

if (!kind || !handlers[kind]) {
  console.log('ClassIntra 第三方开发脚手架');
  console.log('  node scripts/scaffold.js app <app-name> --label "显示名" [--route /路径]');
  console.log('  node scripts/scaffold.js theme <theme-id> --name "主题名" [--type light|dark]');
  console.log('  node scripts/scaffold.js widget <app-name> <widget-id> --name "小组件名"');
  process.exit(kind ? 1 : 0);
}
handlers[kind]();
