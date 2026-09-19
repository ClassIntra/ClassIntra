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
    icon: '/resources/public/icons/AppDefault.png',
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
3. 校验：\`node scripts/diag.js app ${name}\`
4. 构建：\`cd client && node node_modules/vite/bin/vite.js build\`
5. 桌面小组件：\`node scripts/scaffold.js widget ${name} <widget-id> --name "名称"\`
`;
  fs.writeFileSync(path.join(target, 'README.md'), readme);

  console.log('已生成应用骨架：apps/' + name + '/');
  console.log('  manifest.json               route=' + route);
  console.log('  frontend/' + routeName + '.vue');
  console.log('  README.md');
  console.log('下一步：node scripts/diag.js app ' + name + '  校验，然后开始写业务');
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

  var snippet = JSON.stringify({
    id: widgetId,
    name: widgetName,
    component: './frontend/widgets/' + comp + '.vue',
    defaultSize: { w: 2, h: 1 },
    minSize: { w: 1, h: 1 },
    maxSize: { w: 4, h: 2 },
    description: widgetName,
    configSchema: { fields: [] }
  }, null, 2).split('\n').map(function (l) { return '    ' + l; }).join('\n');

  console.log('已生成小组件组件：apps/' + appName + '/frontend/widgets/' + comp + '.vue');
  console.log('');
  console.log('下一步（必须手动）：把以下片段合并进 apps/' + appName + '/manifest.json 的 frontend.widgets[] 数组：');
  console.log('');
  console.log(snippet);
  console.log('');
  console.log('然后：node scripts/diag.js app ' + appName + '  校验');
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
