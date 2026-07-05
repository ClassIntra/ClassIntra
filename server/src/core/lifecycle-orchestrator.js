// 后端核心：LifecycleOrchestrator 生命周期编排器
// 参考 Ditto packages/core/src/lifecycle-orchestrator.ts
//
// 设计要点：
// 1. 分阶段编排：registerPhase(name, startupFn, shutdownFn) 注册阶段
// 2. startup() 按注册顺序执行 startupFn，任一失败则停止并回滚已启动阶段
// 3. shutdown() 逆序执行 shutdownFn，单个异常不中断
// 4. 本期为预留接口，不强制改造 app.js 现有启动流程
// 5. 阶段 4 集成系统会用此编排器注册 'integrations' 阶段

function LifecycleOrchestrator() {
  this._phases = [];        // [{ name, startup, shutdown }]
  this._started = [];       // 已启动的阶段（按顺序）
  this._running = false;
  this._shuttingDown = false;
}

// 注册阶段
// name: 阶段名（如 'database'、'websocket'、'integrations'）
// startup: async function() | function() — 启动函数
// shutdown: async function() | function() — 关闭函数
LifecycleOrchestrator.prototype.registerPhase = function(name, startup, shutdown) {
  if (!name) throw new Error('LifecycleOrchestrator.registerPhase: name 必填');
  this._phases.push({
    name: name,
    startup: typeof startup === 'function' ? startup : null,
    shutdown: typeof shutdown === 'function' ? shutdown : null
  });
};

// 按顺序启动所有阶段
// 任一阶段失败则停止启动，并逆序回滚已启动阶段
LifecycleOrchestrator.prototype.startup = function() {
  var self = this;
  if (self._running) return Promise.resolve();
  self._running = true;

  return self._phases.reduce(function(chain, phase) {
    return chain.then(function() {
      if (!phase.startup) return;
      return Promise.resolve()
        .then(function() { return phase.startup(); })
        .then(function() {
          self._started.push(phase.name);
          console.log('[lifecycle] phase "' + phase.name + '" started');
        });
    }).catch(function(err) {
      console.error('[lifecycle] phase "' + phase.name + '" startup failed:', err.message);
      // 回滚已启动阶段
      return self.shutdown().then(function() {
        throw err;
      });
    });
  }, Promise.resolve());
};

// 逆序关闭所有已启动阶段
LifecycleOrchestrator.prototype.shutdown = function() {
  var self = this;
  if (self._shuttingDown) return Promise.resolve();
  self._shuttingDown = true;

  var errors = [];
  var chain = Promise.resolve();
  // 逆序关闭
  for (var i = self._started.length - 1; i >= 0; i--) {
    (function(phaseName) {
      chain = chain.then(function() {
        var phase = self._phases.find(function(p) { return p.name === phaseName; });
        if (!phase || !phase.shutdown) return;
        return Promise.resolve()
          .then(function() { return phase.shutdown(); })
          .catch(function(err) {
            errors.push({ name: phaseName, error: err });
            console.error('[lifecycle] phase "' + phaseName + '" shutdown failed:', err.message);
          });
      });
    })(self._started[i]);
  }

  return chain.then(function() {
    self._started = [];
    self._running = false;
    self._shuttingDown = false;
    return errors;
  });
};

// 查询是否正在运行
LifecycleOrchestrator.prototype.isRunning = function() {
  return this._running;
};

// 获取已启动阶段列表
LifecycleOrchestrator.prototype.getStartedPhases = function() {
  return this._started.slice();
};

// ========== 单例 ==========
var _instance = null;
function getLifecycleOrchestrator() {
  if (!_instance) {
    _instance = new LifecycleOrchestrator();
  }
  return _instance;
}

module.exports = {
  LifecycleOrchestrator: LifecycleOrchestrator,
  getLifecycleOrchestrator: getLifecycleOrchestrator
};
