// 共享层：主题 Token 兼容重导出层
//
// 历史上 LIGHT_TOKENS / DARK_TOKENS 定义在此文件中。
// 自架构规范化起，主题数据已迁移到独立的顶级 themes/ 目录：
//   themes/light/tokens.js
//   themes/dark/tokens.js
//
// 此文件保留为向后兼容的薄重导出层，旧代码 `import { LIGHT_TOKENS } from '@shared/theme-tokens'`
// 仍可正常工作。新代码应直接从 themes/ 导入或通过 ThemeEngine 获取。

export { TOKENS as LIGHT_TOKENS } from '../../themes/light/tokens.js';
export { TOKENS as DARK_TOKENS } from '../../themes/dark/tokens.js';
