// 市场应用静态审查（第四期「生态工具」）
//
// 用途：第三方应用提交前的静态扫描 + 安装前的能力披露汇总。
//   node scripts/market-review.mjs <app-dir> [--json]
//
// 设计前提：
//   ClassIntra 采用「同页面自由 + 不设沙箱 + 信任开发者」模型（用户已决策）。
//   因此本脚本是**审查辅助**，不是运行时隔离。它把常见问题标出来，
//   让开发者在提交前修掉，而不是在运行期拦截。
//
// 检查分五组：
//   A. manifest 合规   必填字段、路由前缀、sdk 版本、能力/角色合法性
//   B. Chrome 80 语法  ES6+ 语法（第三方不过构建，无 legacy 兜底）
//   C. CSS 兼容        禁用属性/函数、自造圆角与曲线
//   D. 危险 API        eval / new Function / innerHTML 直插 / document.write
//   E. 资源回收        监听器、定时器、实时订阅是否在 onDestroy 中回收

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd().replace(/\\/g, '/');

const targetArg = process.argv[2];
const asJson = process.argv.includes('--json');

if (!targetArg) {
  console.error('用法: node scripts/market-review.mjs <app-dir> [--json]');
  console.error('示例: node scripts/market-review.mjs market-apps/gomoku');
  process.exit(2);
}

const appDir = join(ROOT, targetArg);
if (!existsSync(appDir)) {
  console.error('目录不存在: ' + appDir);
  process.exit(2);
}

// ========== 结果收集 ==========
const findings = []; // { level: 'error'|'warning', group, file, line, message }
function add(level, group, file, line, message) {
  findings.push({ level, group, file, line, message });
}

// ========== 文件遍历 ==========
const SKIP_DIRS = new Set(['node_modules', '.git', 'backend']); // backend 是服务端代码，不受 Chrome 80 约束
const SCAN_EXTS = new Set(['.js', '.css', '.html']);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch (e) { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch (e) { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, out);
    } else if (SCAN_EXTS.has(extname(name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

// 预剥离注释与字符串，避免在注释/文案里误报
// 关键：用等长空白替换，保持行号与列位置不变
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// ========== A. manifest 合规 ==========
const manifestPath = join(appDir, 'manifest.json');
let manifest = null;

if (!existsSync(manifestPath)) {
  add('error', 'A. manifest', 'manifest.json', 0, '缺少 manifest.json');
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    add('error', 'A. manifest', 'manifest.json', 0, 'JSON 解析失败: ' + e.message);
  }
}

if (manifest) {
  const M = manifest;

  if (!M.name) add('error', 'A. manifest', 'manifest.json', 0, '缺少 name');
  else if (!/^[a-z][a-z0-9-]*$/.test(M.name)) {
    add('error', 'A. manifest', 'manifest.json', 0, 'name "' + M.name + '" 不合规（须为 kebab-case）');
  }

  if (!M.label) add('error', 'A. manifest', 'manifest.json', 0, '缺少 label');

  if (!M.version) {
    add('warning', 'A. manifest', 'manifest.json', 0, '缺少 version（将按 0.0.0 处理，无法做更新判断）');
  } else if (!/^v?\d+\.\d+\.\d+/.test(M.version)) {
    add('error', 'A. manifest', 'manifest.json', 0, 'version "' + M.version + '" 不是语义化版本');
  }

  // frontend
  if (!M.frontend || !M.frontend.route) {
    add('error', 'A. manifest', 'manifest.json', 0, '缺少 frontend.route');
  } else if (M.frontend.route[0] !== '/') {
    add('error', 'A. manifest', 'manifest.json', 0, 'frontend.route 必须以 / 开头');
  }
  if (!M.frontend || !M.frontend.entry) {
    add('error', 'A. manifest', 'manifest.json', 0, '缺少 frontend.entry（第三方为 .js 入口）');
  } else if (/\.vue$/.test(M.frontend.entry)) {
    add('error', 'A. manifest', 'manifest.json', 0,
      'frontend.entry 指向 .vue —— 第三方不过构建，必须提供 .js 入口');
  }

  // backend
  if (M.backend) {
    if (!M.backend.mountPath || M.backend.mountPath.indexOf('/api/') !== 0) {
      add('error', 'A. manifest', 'manifest.json', 0, 'backend.mountPath 必须以 /api/ 开头');
    }
    if (!M.backend.entry) {
      add('error', 'A. manifest', 'manifest.json', 0, 'backend.entry 缺失');
    }
  }

  // sdk
  let CURRENT_SDK = '1';
  try {
    CURRENT_SDK = require(join(ROOT, 'server/src/core/manifest-schema.js')).CURRENT_SDK_VERSION;
  } catch (e) { /* 兜底 */ }

  if (M.sdk !== undefined) {
    if (typeof M.sdk !== 'string' || !/^\d+$/.test(M.sdk)) {
      add('error', 'A. manifest', 'manifest.json', 0, 'sdk 应为纯数字字符串（如 "1"）');
    } else if (parseInt(M.sdk, 10) > parseInt(CURRENT_SDK, 10)) {
      add('error', 'A. manifest', 'manifest.json', 0,
        'sdk "v' + M.sdk + '" 高于当前系统 "v' + CURRENT_SDK + '"，安装会被阻断');
    }
  } else {
    add('warning', 'A. manifest', 'manifest.json', 0,
      '未声明 sdk 字段（建议显式声明 "sdk": "1"，便于将来版本演进时明确约束）');
  }

  // capabilities
  let KNOWN_CAPS = [];
  let KNOWN_ROLES = [];
  let LAYOUT_MODES = [];
  try {
    const schema = require(join(ROOT, 'server/src/core/manifest-schema.js'));
    KNOWN_CAPS = schema.KNOWN_CAPABILITIES || [];
    KNOWN_ROLES = schema.KNOWN_ROLES || [];
    LAYOUT_MODES = schema.LAYOUT_MODES || [];
  } catch (e) { /* 兜底 */ }

  if (M.capabilities !== undefined) {
    if (!Array.isArray(M.capabilities)) {
      add('error', 'A. manifest', 'manifest.json', 0, 'capabilities 应为数组');
    } else {
      M.capabilities.forEach((cap, i) => {
        if (typeof cap !== 'string') {
          add('error', 'A. manifest', 'manifest.json', 0, 'capabilities[' + i + '] 应为字符串');
        } else if (KNOWN_CAPS.length && KNOWN_CAPS.indexOf(cap) === -1) {
          add('warning', 'A. manifest', 'manifest.json', 0,
            'capabilities 含未知能力 "' + cap + '"（不影响安装，但披露不准确）');
        }
      });
      if (M.capabilities.length === 0) {
        add('warning', 'A. manifest', 'manifest.json', 0,
          'capabilities 为空数组 —— 若应用实际调用了 context.* 的受控能力，请如实声明');
      }
    }
  } else {
    add('warning', 'A. manifest', 'manifest.json', 0,
      '未声明 capabilities —— 安装页无法向班管披露该应用会用到什么能力');
  }

  // layout
  if (M.layout !== undefined) {
    if (!M.layout || typeof M.layout !== 'object' || Array.isArray(M.layout)) {
      add('error', 'A. manifest', 'manifest.json', 0, 'layout 应为对象');
    } else if (M.layout.mode !== undefined && LAYOUT_MODES.length && LAYOUT_MODES.indexOf(M.layout.mode) === -1) {
      add('error', 'A. manifest', 'manifest.json', 0,
        'layout.mode "' + M.layout.mode + '" 不在枚举中（' + LAYOUT_MODES.join(' / ') + '）');
    }
  }

  // visibleRoles
  if (M.visibleRoles !== undefined) {
    if (!Array.isArray(M.visibleRoles)) {
      add('error', 'A. manifest', 'manifest.json', 0, 'visibleRoles 应为数组');
    } else {
      M.visibleRoles.forEach((role, i) => {
        if (typeof role !== 'string') {
          add('error', 'A. manifest', 'manifest.json', 0, 'visibleRoles[' + i + '] 应为字符串');
        } else if (KNOWN_ROLES.length && KNOWN_ROLES.indexOf(role) === -1) {
          add('error', 'A. manifest', 'manifest.json', 0,
            'visibleRoles 含未知角色 "' + role + '"（合法值：' + KNOWN_ROLES.join(' / ') + '）');
        }
      });
    }
  }
}

// ========== B/C/D. 源码扫描 ==========
const files = walk(appDir);

// B. Chrome 80 语法（仅扫描前端文件，backend 已排除）
const SYNTAX_RULES = [
  { re: /\bconst\s+[A-Za-z_$]/, msg: 'const 声明（Chrome 80 兼容写法：var）' },
  { re: /\blet\s+[A-Za-z_$]/, msg: 'let 声明（Chrome 80 兼容写法：var）' },
  { re: /=>/, msg: '箭头函数（Chrome 80 兼容写法：function）' },
  { re: /`/, msg: '模板字符串（Chrome 80 兼容写法：字符串拼接）' },
  { re: /\?\./, msg: '可选链 ?.（Chrome 80 不支持）' },
  { re: /\?\?/, msg: '空值合并 ??（Chrome 80 不支持）' },
  { re: /\bclass\s+[A-Za-z_$]/, msg: 'class 声明（Chrome 80 兼容写法：构造函数 + prototype）' },
  { re: /\|\|=|&&=|\?\?=/, msg: '逻辑赋值运算符（Chrome 80 不支持）' },
  { re: /\basync\s+function|\bawait\s/, msg: 'async/await（Chrome 80 兼容写法：Promise 链）' },
  { re: /\bnew\s+WebSocket\b/, msg: '直接使用 WebSocket —— 腾讯 X5/TBS 会静默断连，必须改用 context.data.realtime' },
];

// B2. Chrome 80 DOM API 版本（语法合法但 API 不存在 —— 这类问题语法检查抓不到，
//     却和语法问题一样导致运行期 TypeError。gomoku 曾因 replaceChildren 挂载即崩溃。）
// 格式：{ re, msg, since }  since = 该 API 支持的最低 Chrome 主版本
const DOM_API_RULES = [
  { re: /\.replaceChildren\s*\(/, since: 86, msg: 'Element.replaceChildren() 需 Chrome 86+（兼容写法：while(el.firstChild) el.removeChild(el.firstChild)）' },
  { re: /\.append\s*\(/, since: 54, msg: '.append() 需 Chrome 54+（基线内，但多参数/字符串用法在旧版有差异，建议 appendChild）' },
  { re: /\.prepend\s*\(/, since: 54, msg: '.prepend() 需 Chrome 54+（兼容写法：insertBefore(node, el.firstChild)）' },
  { re: /\.replaceWith\s*\(/, since: 54, msg: '.replaceWith() 需 Chrome 54+' },
  { re: /\.before\s*\(\s*[^)]/, since: 54, msg: '.before() 需 Chrome 54+' },
  { re: /\.after\s*\(\s*[^)]/, since: 54, msg: '.after() 需 Chrome 54+' },
  { re: /\.toggleAttribute\s*\(/, since: 69, msg: 'Element.toggleAttribute() 需 Chrome 69+' },
  { re: /\.matches\s*\(/, since: 33, msg: 'Element.matches() 需 Chrome 33+（基线内）' },
  { re: /\.scrollTo\s*\(\s*\{/, since: 61, msg: 'scrollTo({...}) 对象形式需 Chrome 61+（兼容写法：scrollTo(x, y)）' },
  { re: /\.animate\s*\(/, since: 36, msg: 'Element.animate() 需 Chrome 36+（基线内；注意 Safari 前缀）' },
  { re: /structuredClone\s*\(/, since: 98, msg: 'structuredClone() 需 Chrome 98+（兼容写法：JSON.parse(JSON.stringify(x))）' },
  { re: /\brequestIdleCallback\s*\(/, since: 47, msg: 'requestIdleCallback() 需 Chrome 47+（Safari 长期不支持，建议 setTimeout 兜底）' },
  { re: /ResizeObserver\b/, since: 64, msg: 'ResizeObserver 需 Chrome 64+（请用 context.compat.has("resize-observer") 做降级）' },
  { re: /IntersectionObserver\b/, since: 51, msg: 'IntersectionObserver 需 Chrome 51+（请用 context.compat.has("intersection-observer") 做降级）' },
  { re: /\.entries\s*\(\)|\.fromEntries\s*\(/, since: 54, msg: 'Object.entries / Object.fromEntries 需 Chrome 54+ / 73+' },
  { re: /Array\.prototype\.flat\b|\.flatMap\s*\(/, since: 69, msg: 'Array.flat / flatMap 需 Chrome 69+' },
  { re: /\.padStart\s*\(|\.padEnd\s*\(/, since: 57, msg: 'String.padStart / padEnd 需 Chrome 57+' },
  { re: /Object\.values\s*\(/, since: 54, msg: 'Object.values() 需 Chrome 54+' },
  { re: /\.includes\s*\(/, since: 47, msg: 'String/Array.includes() 需 Chrome 47+（基线内）' },
  { re: /globalThis\b/, since: 71, msg: 'globalThis 需 Chrome 71+（兼容写法：window）' },
  { re: /\bBigInt\b/, since: 67, msg: 'BigInt 需 Chrome 67+' },
  { re: /\.at\s*\(\s*-/, since: 92, msg: 'Array.prototype.at() 需 Chrome 92+（兼容写法：arr[arr.length - n]）' },
  { re: /Object\.hasOwn\s*\(/, since: 93, msg: 'Object.hasOwn() 需 Chrome 93+（兼容写法：Object.prototype.hasOwnProperty.call()）' },
  { re: /\bfetch\s*\(/, since: 42, msg: 'fetch() 需 Chrome 42+（基线内，建议优先用 context.data.api）' },
  { re: /navigator\.clipboard\b/, since: 66, msg: 'navigator.clipboard 需 Chrome 66+ 且仅在安全上下文可用（务必保留 execCommand 兜底）' },
];

// D. 危险 API
const DANGER_RULES = [
  { re: /\beval\s*\(/, msg: 'eval() —— 高危，市场审核会重点关注' },
  { re: /\bnew\s+Function\s*\(/, msg: 'new Function() —— 等同于 eval' },
  { re: /\.innerHTML\s*=/, msg: 'innerHTML 直插 —— 用户数据可控时存在 XSS 风险，建议用 textContent 或 createElement' },
  { re: /document\.write\s*\(/, msg: 'document.write() —— 会破坏已解析的文档流' },
  { re: /\.outerHTML\s*=/, msg: 'outerHTML 赋值 —— 会连同节点本身一起重建，事件监听器全部丢失' },
  { re: /\.insertAdjacentHTML\s*\(/, msg: 'insertAdjacentHTML() —— 与 innerHTML 同为 HTML 解析入口，存在 XSS 风险' },
];

// C. CSS 规则
const CSS_RULES = [
  { re: /display\s*:\s*flex[^}]*\bgap\s*:/, msg: 'flex gap（需 Chrome 84+，请用子元素 margin）' },
  { re: /\bgap\s*:\s*[^;]+;/, msg: 'gap 属性（需 Chrome 84+，请用子元素 margin）' },
  { re: /:is\s*\(|:where\s*\(/, msg: ':is() / :where()（需 Chrome 88+）' },
  { re: /\baspect-ratio\s*:/, msg: 'aspect-ratio（需 Chrome 88+，请用 padding-top 撑高）' },
  { re: /@container\b/, msg: '容器查询 @container（需 Chrome 105+）' },
  { re: /\btransition\s*:\s*all\b/, msg: 'transition: all —— 会连带布局属性，改为显式属性列表' },
];

// transition 中的布局属性过渡
const LAYOUT_PROPS = ['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding', 'font-size'];

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const ext = extname(file).toLowerCase();
  let src;
  try { src = readFileSync(file, 'utf8'); } catch (e) { continue; }

  const stripped = stripComments(src);
  const lines = src.split('\n');
  const sLines = stripped.split('\n');

  if (ext === '.js') {
    for (let i = 0; i < sLines.length; i++) {
      for (const rule of SYNTAX_RULES) {
        if (rule.re.test(sLines[i])) {
          add('error', 'B. Chrome80', rel, i + 1, rule.msg);
        }
      }
      for (const rule of DANGER_RULES) {
        if (rule.re.test(sLines[i])) {
          add('error', 'D. 危险API', rel, i + 1, rule.msg);
        }
      }
    }

    // B2. DOM API 版本（仅在低于基线时报警；since <= 80 的属基线内，标记 baseline 跳过）
    //     基线 = Chrome 80。since > 80 的 API 在目标机型上不存在，属阻断性问题。
    const CHROME_BASELINE = 80;
    for (let i = 0; i < sLines.length; i++) {
      for (const rule of DOM_API_RULES) {
        if (rule.since > CHROME_BASELINE && rule.re.test(sLines[i])) {
          add('error', 'B2. DOM API', rel, i + 1, rule.msg);
        }
      }
    }

    // E. 资源回收检查（粗粒度：有监听器/定时器但完全没有 onDestroy）
    const hasListeners = /addEventListener\s*\(/.test(stripped);
    const hasTimers = /\bsetInterval\s*\(|\bsetTimeout\s*\(/.test(stripped);
    const hasRealtime = /realtime\.subscribe\s*\(/.test(stripped);
    const hasOnDestroy = /onDestroy\s*\(/.test(stripped);

    if ((hasListeners || hasTimers || hasRealtime) && !hasOnDestroy) {
      add('error', 'E. 资源回收', rel, 0,
        '使用了监听器/定时器/实时订阅，但未调用 context.app.onDestroy —— 卸载后必然泄漏');
    } else if (hasRealtime && !/onDestroy[\s\S]{0,400}stop|unsub/i.test(stripped)) {
      add('warning', 'E. 资源回收', rel, 0,
        'realtime.subscribe 的取消函数可能未在 onDestroy 中调用');
    }
  }

  if (ext === '.css') {
    for (let i = 0; i < sLines.length; i++) {
      for (const rule of CSS_RULES) {
        if (rule.re.test(sLines[i])) {
          add('warning', 'C. CSS兼容', rel, i + 1, rule.msg);
        }
      }
    }

    // 布局属性过渡
    const transRe = /transition\s*:\s*([^;}]+)/g;
    let tm;
    while ((tm = transRe.exec(stripped)) !== null) {
      const decl = tm[1];
      for (const prop of LAYOUT_PROPS) {
        if (new RegExp('(^|[,\\s])' + prop + '([\\s,]|$)').test(decl)) {
          const lineNo = stripped.slice(0, tm.index).split('\n').length;
          add('warning', 'C. CSS兼容', rel, lineNo,
            '过渡布局属性 "' + prop + '" —— 会触发回流，请改用 transform / opacity');
          break;
        }
      }
    }

    // 自造圆角（八档令牌之外的裸 px）
    const radiusRe = /border-radius\s*:\s*([^;}]+)/g;
    let rm;
    while ((rm = radiusRe.exec(stripped)) !== null) {
      const val = rm[1].trim();
      if (/var\(--ci-shape-|var\(--radius-/.test(val)) continue;
      if (/^(50%|0|9999px|999px|inherit|initial)$/.test(val)) continue;
      const lineNo = stripped.slice(0, rm.index).split('\n').length;
      add('warning', 'C. CSS兼容', rel, lineNo,
        'border-radius 裸值 "' + val + '" —— 请用八档令牌 --ci-shape-{xs|sm|md|lg|xl|2xl|3xl|pill}');
    }

    // 自造曲线
    const easeRe = /cubic-bezier\s*\(/g;
    let em;
    const srcNoComments = stripComments(src);
    while ((em = easeRe.exec(srcNoComments)) !== null) {
      const snippet = srcNoComments.slice(em.index, em.index + 120);
      if (snippet.indexOf('--ci-') !== -1) continue;
      const lineNo = srcNoComments.slice(0, em.index).split('\n').length;
      add('warning', 'C. CSS兼容', rel, lineNo,
        '自造 cubic-bezier —— 请用 --ci-motion-spring-{snappy|bouncy|smooth|interactive}');
    }
  }
}

// ========== 能力披露汇总 ==========
function summarize() {
  const errs = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warning');
  return { errs, warns };
}

const { errs, warns } = summarize();

// ========== 输出 ==========
if (asJson) {
  console.log(JSON.stringify({
    app: manifest ? manifest.name : null,
    dir: targetArg,
    capabilities: manifest && manifest.capabilities ? manifest.capabilities : [],
    visibleRoles: manifest && manifest.visibleRoles ? manifest.visibleRoles : [],
    layout: manifest && manifest.layout ? manifest.layout : null,
    errors: errs,
    warnings: warns,
    summary: { errors: errs.length, warnings: warns.length }
  }, null, 2));
} else {
  console.log('');
  console.log('市场应用静态审查: ' + targetArg);
  console.log('='.repeat(60));

  if (manifest) {
    console.log('');
    console.log('能力披露（安装页将向班管展示）');
    console.log('-'.repeat(60));
    const caps = manifest.capabilities || [];
    if (caps.length) {
      caps.forEach((c) => console.log('  · ' + c));
    } else {
      console.log('  （未声明 capabilities）');
    }

    if (manifest.visibleRoles && manifest.visibleRoles.length) {
      console.log('');
      console.log('可见角色: ' + manifest.visibleRoles.join(', '));
    }
    if (manifest.layout && manifest.layout.mode) {
      console.log('布局模式: ' + manifest.layout.mode);
    }
    if (manifest.sdk) {
      console.log('所需 SDK: v' + manifest.sdk);
    }
  }

  // 按组聚合展示
  const groups = {};
  for (const f of findings) {
    if (!groups[f.group]) groups[f.group] = [];
    groups[f.group].push(f);
  }

  const groupNames = Object.keys(groups).sort();
  for (const g of groupNames) {
    console.log('');
    console.log(g);
    console.log('-'.repeat(60));
    const items = groups[g];
    // 同一文件同一消息去重计数
    const seen = new Map();
    for (const f of items) {
      const key = f.file + '|' + f.message;
      if (seen.has(key)) {
        seen.get(key).count += 1;
        seen.get(key).lines.push(f.line);
      } else {
        seen.set(key, { f, count: 1, lines: [f.line] });
      }
    }
    for (const { f, count, lines } of seen.values()) {
      const mark = f.level === 'error' ? '✗' : '!';
      const loc = f.line ? f.file + ':' + lines.slice(0, 3).join(',') + (lines.length > 3 ? '…' : '') : f.file;
      console.log('  ' + mark + ' ' + f.message);
      if (f.line || count > 1) {
        console.log('      ' + loc + (count > 1 ? '  （' + count + ' 处）' : ''));
      }
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('错误 ' + errs.length + ' 项，警告 ' + warns.length + ' 项');
  if (errs.length) {
    console.log('存在阻断性问题，请修复后再提交市场。');
  } else if (warns.length) {
    console.log('无阻断性问题。警告项建议修复，以保持与系统一致。');
  } else {
    console.log('未发现问题。');
  }
  console.log('');
}

process.exit(errs.length ? 1 : 0);
