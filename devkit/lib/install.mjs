// 测试安装：从本地市场源把包装进宿主（/api/market/install|update|uninstall）
// ============================================================
// 「创建 → 预览调试 → 测试安装」闭环的最后一步：pack --write 进本地 market 仓
// （内置 local 源，默认 <项目根>/../market，可用 MARKET_LOCAL_DIR 指向别处），
// 再用本命令直接装到宿主验证完整安装链路（下载校验/原子落盘/热挂载/回滚），
// 不必进管理界面点按钮。凭据约定与 preview 相同（--token 或 --secret + --user）。

import { apiCall } from './preview.mjs';

// action: 'install' | 'update' | 'uninstall'
export async function installAction(name, options = {}) {
  const who = String(name || '').trim();
  if (!who) throw new Error('缺少应用名');
  const action = options.action || 'install';
  if (action === 'uninstall') {
    return apiCall(options, 'POST', '/api/market/uninstall', { name: who });
  }
  const source = String(options.source || 'gitee');
  const path = action === 'update' ? '/api/market/update' : '/api/market/install';
  return apiCall(options, 'POST', path, { name: who, source: source });
}
