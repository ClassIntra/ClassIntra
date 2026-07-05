// 浅色主题预设
// 从 shared/src/theme-tokens.js 导入 LIGHT_TOKENS，转发给 ThemeEngine 注册
// 未来可在此扩展更多浅色预设（如 'light-warm'、'light-cool' 等）

import { LIGHT_TOKENS } from '@shared/theme-tokens';

var lightPreset = {
  id: 'light',
  name: '默认浅色',
  type: 'light',
  icons: null,
  tokens: LIGHT_TOKENS
};

export { lightPreset, LIGHT_TOKENS };
export default lightPreset;
