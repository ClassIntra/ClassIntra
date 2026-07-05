# ClassIntra Chrome 80 兼容性约束

> ClassIntra 必须兼容 Chrome 80+（教育终端常见版本）。
> 本文档列出禁用语法、已 polyfill 的 API、替代方案和检查方法。

---

## 目录

- [禁用语法](#1-禁用语法)
- [已 Polyfill 的 API](#2-已-polyfill-的-api)
- [替代方案速查](#3-替代方案速查)
- [项目代码风格约定](#4-项目代码风格约定)
- [检查方法](#5-检查方法)
- [常见错误](#6-常见错误)

---

## 1. 禁用语法

### 1.1 ES2020+ 语法（Chrome 80 不支持）

| 语法 | 引入版本 | Chrome 80 支持 | 替代方案 |
|------|----------|---------------|----------|
| `?.`（可选链） | ES2020 | ❌ Chrome 80+ 才支持 | 显式 `&&` 判断 |
| `??`（空值合并） | ES2020 | ❌ Chrome 80+ 才支持 | `\|\|` 配合显式 null 检查 |
| `??=`（逻辑空赋值） | ES2021 | ❌ | 显式赋值 |
| `\|\|=`（逻辑或赋值） | ES2021 | ❌ | 显式赋值 |
| `&&=`（逻辑与赋值） | ES2021 | ❌ | 显式赋值 |

### 1.2 ES2022+ 语法（Chrome 80 不支持）

| 语法 | 引入版本 | Chrome 80 支持 | 替代方案 |
|------|----------|---------------|----------|
| `class` 字段声明 | ES2022 | ❌ | 构造函数中赋值 |
| 私有字段 `#field` | ES2022 | ❌ | 命名约定 `_field` |
| `static` 块 | ES2022 | ❌ | 静态方法 |
| 顶层 `await` | ES2022 | ❌ | IIFE 或 module.exports 包装 |

### 1.3 项目代码风格约定（与 Chrome 80 无关，但项目要求遵守）

| 语法 | 项目约定 | 原因 | 替代方案 |
|------|----------|------|----------|
| `class` 语法 | ❌ 禁用 | 与现有代码风格不一致 | 构造函数 + prototype |
| `let` / `const` | ❌ 禁用 | 项目约定使用 `var` | `var` |
| 模板字符串 `` ` `` | ❌ 禁用 | 与现有代码风格不一致 | 字符串拼接 `'...' + var` |
| 箭头函数 `=>` | ❌ 禁用 | 与现有代码风格不一致 | `function` |
| `import()` 动态导入 | ⚠️ 慎用 | Vite 构建会处理，但运行时 Chrome 80 不支持 | 使用 Vite 的静态 `import` |

### 1.4 后端代码

后端运行在 Node.js（不受 Chrome 80 约束），但**同样遵守项目代码风格约定**（`var` / 单引号 / function / 2 空格缩进）。

例外：可以安全使用 Node.js 内置的现代 API（如 `crypto.timingSafeEqual` / `fetch`（Node 18+））。

---

## 2. 已 Polyfill 的 API

[client/src/main.js](../client/src/main.js#L1-L82) 在入口处 polyfill 了以下 API：

### 2.1 Object.hasOwn (ES2022, Chrome 93+)

```javascript
// polyfill 实现
if (!Object.hasOwn) {
  Object.hasOwn = function(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
}
```

**使用方式**：

```javascript
// ✓ 可直接使用（polyfill 已生效）
if (Object.hasOwn(obj, 'key')) {
  // ...
}

// ✓ 也可用旧 API
if (Object.prototype.hasOwnProperty.call(obj, 'key')) {
  // ...
}
```

### 2.2 String.prototype.replaceAll (ES2021, Chrome 85+)

```javascript
// polyfill 实现
if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function(search, replacement) {
    if (typeof search === 'string') {
      return String(this).split(search).join(replacement);
    }
    if (Object.prototype.toString.call(search) === '[object RegExp]') {
      if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
      return String(this).replace(search, replacement);
    }
    return String(this).split(String(search)).join(replacement);
  };
}
```

**使用方式**：

```javascript
// ✓ 可直接使用
var normalized = str.replaceAll('-', '_');

// ✓ 也可用旧 API
var normalized = str.split('-').join('_');
// 或
var normalized = str.replace(/-/g, '_');
```

### 2.3 Promise.any + AggregateError (ES2021, Chrome 85+)

```javascript
// polyfill 实现
if (!Promise.any) {
  Promise.any = function(promises) {
    return new Promise(function(resolve, reject) {
      var errors = [];
      var remaining = 0;
      var list = Array.from(promises || []);
      if (list.length === 0) {
        reject(new AggregateErrorImpl([], 'All promises were rejected'));
        return;
      }
      remaining = list.length;
      for (var i = 0; i < list.length; i++) {
        (function(idx) {
          Promise.resolve(list[idx]).then(function(val) {
            resolve(val);
          }, function(err) {
            errors[idx] = err;
            remaining--;
            if (remaining === 0) {
              reject(new AggregateErrorImpl(errors, 'All promises were rejected'));
            }
          });
        })(i);
      }
    });
  };
}
```

**使用方式**：

```javascript
// ✓ 可直接使用
Promise.any([
  fetch('/api/primary').then(function(r) { return r.json(); }),
  fetch('/api/fallback').then(function(r) { return r.json(); })
]).then(function(data) {
  // 第一个成功的响应
}).catch(function(aggregateError) {
  // 全部失败
  console.error(aggregateError.errors);  // 错误数组
});
```

### 2.4 Array.prototype.at (ES2022, Chrome 92+)

```javascript
// polyfill 实现
if (!Array.prototype.at) {
  Array.prototype.at = function(index) {
    var len = this.length;
    var relativeIndex = index < 0 ? len + index : index;
    if (relativeIndex < 0 || relativeIndex >= len) return undefined;
    return this[relativeIndex];
  };
}

if (!String.prototype.at) {
  String.prototype.at = function(index) {
    var len = this.length;
    var relativeIndex = index < 0 ? len + index : index;
    if (relativeIndex < 0 || relativeIndex >= len) return undefined;
    return this.charAt(relativeIndex);
  };
}
```

**使用方式**：

```javascript
// ✓ 可直接使用
var last = arr.at(-1);          // 等价于 arr[arr.length - 1]
var first = arr.at(0);          // 等价于 arr[0]
var char = 'hello'.at(-1);      // 'o'
```

### 2.5 未 Polyfill 的 API（需手动避免）

以下 API Chrome 80 不支持，**且未 polyfill**，必须用替代方案：

| API | 引入版本 | 替代方案 |
|-----|----------|----------|
| `Array.prototype.flat` | ES2019, Chrome 69+ | `Array.prototype.reduce` + `concat`，或 `[].concat.apply([], arr)` |
| `Array.prototype.flatMap` | ES2019, Chrome 69+ | `arr.map(fn).reduce(function(a,b){return a.concat(b);},[])` |
| `Object.fromEntries` | ES2019, Chrome 73+ | `reduce` 手动构建 |
| `String.prototype.matchAll` | ES2020, Chrome 73+ | `RegExp.exec` 循环 |
| `globalThis` | ES2020, Chrome 71+ | `window`（浏览器）/ `global`（Node） |
| `BigInt` | ES2020, Chrome 67+ | 一般场景用 Number，超大数用第三方库 |
| `Promise.allSettled` | ES2020, Chrome 76+ | 自行实现（如 `outbound-dispatcher.js` 中的降级） |

> **注意**：上述部分 API 在 Chrome 80 实际可用（如 `flat` / `flatMap` / `Object.fromEntries`），但为保险起见建议避免。

---

## 3. 替代方案速查

### 3.1 可选链 `?.`

```javascript
// ❌ 禁用
var name = user?.profile?.name;
var first = arr?.[0];

// ✓ 替代方案 1：&& 链
var name = user && user.profile && user.profile.name;

// ✓ 替代方案 2：try/catch（性能略差，但可读性好）
var name;
try { name = user.profile.name; } catch (e) { name = undefined; }

// ✓ 数组访问
var first = arr && arr[0];
```

### 3.2 空值合并 `??`

```javascript
// ❌ 禁用
var x = a ?? b;

// ✓ 替代方案 1：显式 null/undefined 检查
var x = (a !== null && a !== undefined) ? a : b;

// ✓ 替代方案 2：|| （仅当 0/''/false 是有效值时不能用）
var x = a || b;
// 注意：a 为 0、''、false、NaN 时会取 b，与 ?? 行为不同！
```

### 3.3 逻辑赋值 `??=` / `||=` / `&&=`

```javascript
// ❌ 禁用
obj.prop ??= defaultValue;
obj.count ||= 1;
obj.enabled &&= false;

// ✓ 替代方案
if (obj.prop === null || obj.prop === undefined) {
  obj.prop = defaultValue;
}

if (!obj.count) {
  obj.count = 1;
}

if (obj.enabled) {
  obj.enabled = false;
}
```

### 3.4 模板字符串

```javascript
// ❌ 禁用
var msg = `Hello ${name}, you have ${count} messages`;
var html = `
  <div>${content}</div>
`;

// ✓ 替代方案：字符串拼接
var msg = 'Hello ' + name + ', you have ' + count + ' messages';
var html = '<div>' + content + '</div>';
```

### 3.5 箭头函数

```javascript
// ❌ 禁用
var sum = (a, b) => a + b;
arr.map(x => x * 2);
setTimeout(() => console.log('hi'), 1000);

// ✓ 替代方案：function
var sum = function(a, b) { return a + b; };
arr.map(function(x) { return x * 2; });
setTimeout(function() { console.log('hi'); }, 1000);
```

### 3.6 class 语法

```javascript
// ❌ 禁用
class MyClass {
  constructor() { this.x = 1; }
  method() { return this.x; }
  static create() { return new MyClass(); }
}

// ✓ 替代方案：构造函数 + prototype
function MyClass() {
  this.x = 1;
}

MyClass.prototype.method = function() {
  return this.x;
};

MyClass.create = function() {
  return new MyClass();
};
```

### 3.7 let / const

```javascript
// ❌ 禁用
let counter = 0;
const MAX = 100;

// ✓ 替代方案：var
var counter = 0;
var MAX = 100;
```

### 3.8 解构赋值

解构赋值 Chrome 80 支持，**可以使用**。但部分场景需注意：

```javascript
// ✓ 可用：解构
var { name, age } = user;
var [first, second] = arr;

// ✓ 可用：默认值
var { name = '匿名' } = user;

// ✓ 可用：重命名
var { name: userName } = user;

// ⚠️ 慎用：嵌套解构（Chrome 80 支持，但代码可读性差）
var { profile: { name } } = user;  // 建议拆分
```

### 3.9 展开运算符 `...`

展开运算符 Chrome 80 支持，**可以使用**：

```javascript
// ✓ 可用：数组展开
var newArr = [].concat(arr, [1, 2, 3]);
// 等价于 ES6: var newArr = [...arr, 1, 2, 3];

// ✓ 可用：对象展开（Chrome 60+）
var newObj = Object.assign({}, obj, { key: 'value' });
// 等价于 ES6: var newObj = { ...obj, key: 'value' };

// ✓ 可用：函数参数展开
fn.apply(null, args);
// 等价于 ES6: fn(...args);
```

> **项目约定**：与现有代码风格一致，优先使用 `Object.assign` / `concat` / `apply`，但展开运算符也可接受。

### 3.10 async/await

async/await Chrome 80 支持，**可以使用**。但项目约定优先用 Promise 链：

```javascript
// ✓ 项目偏好：Promise 链
function fetchData() {
  return api.get('/api/data')
    .then(function(res) {
      return res.data;
    })
    .catch(function(err) {
      console.error('失败:', err);
      throw err;
    });
}

// ✓ 也可接受：async/await（Chrome 80 支持）
async function fetchData() {
  try {
    var res = await api.get('/api/data');
    return res.data;
  } catch (err) {
    console.error('失败:', err);
    throw err;
  }
}
```

---

## 4. 项目代码风格约定

### 4.1 强制约定

| 约定 | 原因 |
|------|------|
| `var` 不用 `let`/`const` | 与现有代码一致 |
| 单引号 `'...'` | 与现有代码一致 |
| 2 空格缩进 | 与现有代码一致 |
| Vue Options API | 项目使用 Vue 2.7，统一 Options API |
| `function` 不用箭头函数 | 与现有代码一致 |
| 字符串拼接不用模板字符串 | 与现有代码一致 |
| 构造函数 + prototype 不用 `class` | 与现有代码一致 |

### 4.2 推荐约定

| 约定 | 原因 |
|------|------|
| 模块级函数放在 `export default` 之前 | 提升可读性 |
| `import X from 'path'` 不用 `require` | 前端 ES Module |
| 单例模式 `getXxx()` | 与核心层一致 |
| 文件名 kebab-case | 与现有代码一致 |
| Vue 组件名 PascalCase | 与现有代码一致 |
| CSS 类 kebab-case | 与现有代码一致 |

### 4.3 后端约定

| 约定 | 原因 |
|------|------|
| `require` 不用 `import` | 后端 CommonJS |
| `module.exports = {}` | 同上 |
| 其他约定与前端一致 | - |

---

## 5. 检查方法

### 5.1 ESLint 检查（如有配置）

```bash
cd client && npx eslint src/
```

### 5.2 手动 grep 检查禁用语法

```bash
# 检查可选链
grep -rn '?\.' client/src/ shared/src/ --include='*.js' --include='*.vue'

# 检查空值合并
grep -rn '??' client/src/ shared/src/ --include='*.js' --include='*.vue'

# 检查模板字符串
grep -rn '`' client/src/ shared/src/ --include='*.js' --include='*.vue'

# 检查箭头函数
grep -rn '=>' client/src/ shared/src/ --include='*.js' --include='*.vue'

# 检查 class 语法
grep -rn '^class \| class [A-Z]' client/src/ shared/src/ --include='*.js' --include='*.vue'

# 检查 let / const
grep -rn '^\s*let \|^\s*const ' client/src/ shared/src/ --include='*.js' --include='*.vue'
```

### 5.3 构建验证

```bash
# 前端构建（Vite 会自动转译，但不能保证运行时兼容）
cd client && npx vite build

# 实际测试：在 Chrome 80 中打开应用
# 1. 安装 Chrome 80（或使用 BrowserStack / Sauce Labs）
# 2. 打开应用 URL
# 3. F12 控制台检查是否有语法错误
# 4. 测试核心功能
```

### 5.4 Vite 构建配置

[client/vite.config.js](../client/vite.config.js) 中应配置 `target: 'chrome80'`：

```javascript
export default {
  build: {
    target: 'chrome80'  // 确保 Vite 输出兼容 Chrome 80 的代码
  }
};
```

> **注意**：即使 Vite 配置了 target，源代码中的禁用语法（如 `?.`）依然会被保留。必须在编写代码时就避免使用。

---

## 6. 常见错误

### 6.1 SyntaxError: Unexpected token '.'

```javascript
// 错误代码
var name = user?.name;
//           ^ Unexpected token '.'

// 修复
var name = user && user.name;
```

### 6.2 SyntaxError: Unexpected token '?'

```javascript
// 错误代码
var x = a ?? b;
//         ^ Unexpected token '?'

// 修复
var x = (a !== null && a !== undefined) ? a : b;
```

### 6.3 SyntaxError: Unexpected token '`'

```javascript
// 错误代码
var msg = `Hello ${name}`;
//         ^ Unexpected token '`'

// 修复
var msg = 'Hello ' + name;
```

### 6.4 SyntaxError: Unexpected token '=>'

```javascript
// 错误代码
var fn = () => console.log('hi');
//          ^ Unexpected token '=>'

// 修复
var fn = function() { console.log('hi'); };
```

### 6.5 SyntaxError: Unexpected token 'class'

```javascript
// 错误代码（在某些低版本浏览器中）
class MyClass {}
//     ^ Unexpected token 'class'

// 修复
function MyClass() {}
MyClass.prototype.method = function() {};
```

### 6.6 TypeError: Object.hasOwn is not a function

```javascript
// 错误：polyfill 未加载或加载顺序错误
// 确保 main.js 入口的 polyfill 在所有其他代码之前执行

// 检查 main.js 是否包含 polyfill
// 应该在文件最顶部（import 之前）有 IIFE 包裹的 polyfill
```

### 6.7 TypeError: arr.at is not a function

```javascript
// 错误：polyfill 未加载
// 或使用了非数组的 .at（如某些自定义对象）

// 修复：使用传统索引访问
var last = arr[arr.length - 1];
```

---

## 附录：Chrome 80 支持的 ES 特性

以下是 Chrome 80 **支持**的主要 ES 特性，可安全使用：

| 特性 | ES 版本 | Chrome 版本 |
|------|---------|------------|
| `let` / `const` | ES6 | Chrome 49+ |
| 箭头函数 | ES6 | Chrome 45+ |
| 模板字符串 | ES6 | Chrome 41+ |
| 解构赋值 | ES6 | Chrome 49+ |
| 类（class） | ES6 | Chrome 49+ |
| Promise | ES6 | Chrome 32+ |
| `for...of` | ES6 | Chrome 38+ |
| Symbol | ES6 | Chrome 38+ |
| Map / Set / WeakMap / WeakSet | ES6 | Chrome 36+ |
| 默认参数 | ES6 | Chrome 49+ |
| 展开运算符 `...` | ES6 | Chrome 46+（数组）/ 60+（对象） |
| async/await | ES2017 | Chrome 55+ |
| `Object.entries` / `Object.values` | ES2017 | Chrome 54+ |
| `Object.getOwnPropertyDescriptors` | ES2017 | Chrome 54+ |
| `String.prototype.padStart` / `padEnd` | ES2017 | Chrome 57+ |
| `SharedArrayBuffer` / `Atomics` | ES2017 | Chrome 68+ |
| 异步迭代 `for await...of` | ES2018 | Chrome 63+ |
| `Promise.prototype.finally` | ES2018 | Chrome 63+ |
| `Rest`/`Spread` 属性 | ES2018 | Chrome 60+ |
| `Array.prototype.flat` / `flatMap` | ES2019 | Chrome 69+ |
| `Object.fromEntries` | ES2019 | Chrome 73+ |
| `String.prototype.matchAll` | ES2020 | Chrome 73+ |
| `globalThis` | ES2020 | Chrome 71+ |
| `BigInt` | ES2020 | Chrome 67+ |
| `Promise.allSettled` | ES2020 | Chrome 76+ |

> **注意**：虽然上述特性 Chrome 80 支持，但**项目代码风格约定**仍然禁用 `let` / `const` / 箭头函数 / 模板字符串 / `class`。请遵守项目约定。

---

## 附录：相关文档

| 文档 | 说明 |
|------|------|
| [architecture.md#10-chrome-80-兼容约束](./architecture.md#10-chrome-80-兼容约束) | 架构文档中的兼容性概览 |
| [development-guide.md#9-代码风格约定](./development-guide.md#9-代码风格约定) | 开发指南中的代码风格 |
| [CLAUDE.md](../CLAUDE.md) | 项目根目录的协作规则 |
