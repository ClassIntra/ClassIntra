/**
 * 认证页（登录/注册）壁纸
 *
 * 不再镜像用户自选的桌面壁纸（settings.wallpaper 可能指向部署方自添加的任意内容，
 * 包括第三方版权素材），认证页固定使用这张项目内置的纯 CSS 渐变：
 * 深空蓝夜色 + 极光光晕，与品牌蓝同源，适配白色标识与毛玻璃面板。
 * 零资源加载、开箱一致，视觉上仍延续「启动动画 → 登录 → 桌面」的
 * iOS 式多层渐变合成语言（与 views/Desktop.vue 的 WALLPAPER_MAP 同构）。
 */
export var AUTH_WALLPAPER =
  'radial-gradient(90% 70% at 82% 8%, rgba(120,190,255,0.30) 0%, rgba(120,190,255,0) 55%),' +
  'radial-gradient(110% 85% at 10% 96%, rgba(64,140,255,0.32) 0%, rgba(64,140,255,0) 60%),' +
  'linear-gradient(135deg, #001233 0%, #06255C 52%, #0A3D8F 100%)';

export default { AUTH_WALLPAPER: AUTH_WALLPAPER };
