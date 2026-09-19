// 核心层：应用/插件后端热重载
// 开发便利性：修改 apps/<name>/backend 或 plugins/<name>/backend 下的代码后，
// 无需重启服务器，下一次保存自动生效（fs.watch 监听 + require 缓存清除）。
//
// 开关：环境变量 CLASSINTRA_HOT_RELOAD=1 时启用（默认关闭，生产零开销零风险）。
//
// 边界说明：
//   - 只热重载各模块 backend/ 目录内的文件（entry 的 require 依赖树中，
//     位于 backend/ 目录内的模块全部失效重载）
//   - backend 引用的宿主层/共享层代码（server/src/*、shared/src/*）不在监听范围，
//     改这些仍需重启
//   - 模块内存状态（缓存 LRU、登录态上下文等）随重载重置
//   - 语法错误时保留旧代码继续服务，仅打日志——服务不中断

var fs = require('fs');

function enabled() {
  return process.env.CLASSINTRA_HOT_RELOAD === '1';
}

// 清除目录下所有已加载模块的 require 缓存
function clearDirCache(dir) {
  Object.keys(require.cache).forEach(function (k) {
    if (k.indexOf(dir) === 0) delete require.cache[k];
  });
}

// 创建热重载代理中间件
// label: 日志标识（如 'netease-music:/api/netease-music'）
// entryPath: 后端入口绝对路径（导出 Express Router）
// watchDir: 监听目录（entry 所在 backend 目录）
function createHotProxy(label, entryPath, watchDir) {
  var current = null;
  var timer = null;

  function load() {
    try {
      current = require(entryPath);
      console.log('[hot-reload] 已重载:', label);
    } catch (e) {
      console.error('[hot-reload] 重载失败（保留旧代码继续服务）:', label, '-', e.message);
    }
  }

  function schedule() {
    clearTimeout(timer);
    // 300ms 防抖：编辑器保存常触发多次 change 事件
    timer = setTimeout(function () {
      clearDirCache(watchDir);
      load();
    }, 300);
  }

  try {
    fs.watch(watchDir, { recursive: true }, schedule);
    console.log('[hot-reload] 监听中:', watchDir);
  } catch (e) {
    console.error('[hot-reload] 目录监听失败（该模块热重载不可用）:', watchDir, '-', e.message);
  }

  // 首次加载（失败时 current 为 null，请求返回 500 而非静默 404）
  load();

  // 代理中间件：把请求转交给当前版本的 Router
  return function hotProxy(req, res, next) {
    if (!current) return next(new Error('[hot-reload] 模块未成功加载: ' + label));
    current(req, res, next);
  };
}

module.exports = {
  enabled: enabled,
  createHotProxy: createHotProxy
};
