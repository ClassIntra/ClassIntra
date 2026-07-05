// 深色主题预设
// 从 shared/src/theme-tokens.js 导入 DARK_TOKENS，转发给 ThemeEngine 注册
// 未来可在此扩展更多深色预设（如 'dark-oled'、'dark-blue' 等）

import { DARK_TOKENS } from '@shared/theme-tokens';

var darkPreset = {
  id: 'dark',
  name: '默认深色',
  type: 'dark',
  icons: null,
  tokens: DARK_TOKENS
};

export { darkPreset, DARK_TOKENS };
export default darkPreset;
