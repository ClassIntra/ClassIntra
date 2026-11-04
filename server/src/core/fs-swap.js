// 目录原子替换（带备份与回滚）
// ============================================================
// 为什么单独成模块：
//   市场更新最怕的顺序错误是「先删旧版、再放新版」——一旦第二步失败，旧版本已经没了。
//   这里把正确顺序封成一个小工具，并允许注入删除函数（主服务用分文件删除，
//   测试用 fs.rmSync），从而可以被真正单测覆盖，而不是靠人工演练。
//
// 契约：
//   beginSwap(tmpDir, finalDir, tag, removeTree)
//     → { backupDir, commit(), rollback() }
//   - 旧目录存在时先挪成 .bak-<tag>-<ts>（跨卷/占用时退化为复制备份）
//   - 新目录就位（rename 失败时退化为 mkdir + cpSync）
//   - commit(): 删除备份；rollback(): 删新目录、把备份挪回原位
//
// 编码约定：var / function（与主仓服务端风格一致）

var fs = require('fs');
var path = require('path');

function beginSwap(tmpDir, finalDir, tag, removeTree) {
  var rm = typeof removeTree === 'function' ? removeTree : function (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  };

  var backupDir = '';
  if (fs.existsSync(finalDir)) {
    backupDir = path.join(path.dirname(finalDir), '.bak-' + tag + '-' + Date.now());
    try {
      fs.renameSync(finalDir, backupDir);
    } catch (e) {
      // 跨卷或目录被占用：先复制出备份，再删旧目录
      fs.cpSync(finalDir, backupDir, { recursive: true });
      rm(finalDir);
    }
  }

  try {
    fs.renameSync(tmpDir, finalDir);
  } catch (renameErr) {
    // Windows：目标被占用（EPERM）时退化为覆盖写入（非原子但可靠）
    fs.mkdirSync(finalDir, { recursive: true });
    fs.cpSync(tmpDir, finalDir, { recursive: true });
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e2) {}
  }

  return {
    backupDir: backupDir,

    commit: function () {
      if (!backupDir || !fs.existsSync(backupDir)) return false;
      try { rm(backupDir); } catch (e) {}
      return true;
    },

    rollback: function () {
      try { if (fs.existsSync(finalDir)) rm(finalDir); } catch (e) {}
      if (!backupDir || !fs.existsSync(backupDir)) return false;
      try {
        fs.renameSync(backupDir, finalDir);
        return true;
      } catch (e) {
        try {
          fs.cpSync(backupDir, finalDir, { recursive: true });
          rm(backupDir);
          return true;
        } catch (e2) {
          return false;
        }
      }
    }
  };
}

module.exports = { beginSwap: beginSwap };
