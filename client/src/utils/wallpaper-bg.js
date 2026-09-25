/**
 * 壁纸解析工具
 *
 * 把 settings.wallpaper 的取值（渐变名 / 图片文件名 / 绝对 URL / 视频文件名）
 * 解析成可直接渲染的背景描述，供登录页、注册页复刻桌面壁纸，
 * 形成「启动动画 → 登录 → 桌面」的视觉连续性。
 *
 * 渐变兜底色值与 views/Desktop.vue 的 WALLPAPER_MAP 保持一致，
 * 两边若调整需同步（此处不改 Desktop，避免触及桌面渲染的热路径）。
 */

// 渐变预设统一为「多层合成」：底层主渐变定基调，
// 叠 1~2 层 radial 光晕营造纵深（iOS 系统壁纸的做法），纯 CSS、无图片开销。
// 需与 views/Desktop.vue 的 WALLPAPER_MAP 保持一致，两边若调整需同步。
var GRADIENT_MAP = {
  'default': 'radial-gradient(90% 70% at 82% 8%, rgba(191,238,255,0.85) 0%, rgba(191,238,255,0) 55%), radial-gradient(110% 85% at 8% 96%, rgba(0,61,122,0.55) 0%, rgba(0,61,122,0) 60%), linear-gradient(135deg, #0A84FF 0%, #2E7CF6 48%, #4FB3F9 100%)',
  'ocean': 'radial-gradient(100% 75% at 80% 12%, rgba(90,200,250,0.5) 0%, rgba(90,200,250,0) 55%), linear-gradient(140deg, #001D45 0%, #003D7A 40%, #0055B8 75%, #007AFF 100%)',
  'sky': 'radial-gradient(90% 70% at 85% 6%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 55%), linear-gradient(135deg, #0A84FF 0%, #3FA1F8 45%, #5AC8FA 75%, #BFEEFF 100%)',
  'night': 'linear-gradient(135deg, #000000 0%, #1C1C1E 50%, #2C2C2E 100%)',
  'dawn': 'radial-gradient(90% 70% at 80% 10%, rgba(255,204,0,0.55) 0%, rgba(255,204,0,0) 55%), linear-gradient(135deg, #FF2D55 0%, #FF9500 55%, #FFCC00 100%)',
  'arctic': 'radial-gradient(90% 70% at 82% 10%, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 55%), linear-gradient(135deg, #90CAF9 0%, #BBDEFB 50%, #E3F2FD 100%)'
};

/**
 * 认证页（登录/注册）的兜底底色：直接引用系统底色令牌。
 * 认证页与桌面共用同一张壁纸（含渐变预设），这个兜底只用于
 * 视频壁纸尚未出画的首帧——避免闪出一块与系统无关的自造深色。
 */
export var AUTH_BACKDROP = 'var(--bg-color)';

var VIDEO_EXTS = ['.mp4', '.webm', '.mov'];
// 含 svg：桌面壁纸目录里有矢量壁纸，按绝对路径存放
var IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg'];

function hasExt(value, exts) {
  if (!value) return false;
  var lower = value.toLowerCase();
  for (var i = 0; i < exts.length; i++) {
    if (lower.indexOf(exts[i], lower.length - exts[i].length) !== -1) return true;
  }
  return false;
}

/**
 * 解析壁纸
 * @param {string} wp settings.wallpaper 的原始值
 * @returns {{type: 'video'|'image'|'gradient', src: string, style: object|null}}
 *   type=video 时用 src 挂 <video>；type=image 时用 style 挂背景图；
 *   type=gradient 时用 style 挂渐变背景。
 */
export function resolveWallpaper(wp) {
  var value = wp || 'default';
  var isAbsolute = value.indexOf('http') === 0 || value.charAt(0) === '/';
  var src = isAbsolute ? value : '/resources/public/wallpaper/' + value;

  if (hasExt(value, VIDEO_EXTS)) {
    return { type: 'video', src: src, style: null };
  }
  if (hasExt(value, IMAGE_EXTS) || (isAbsolute && !GRADIENT_MAP[value])) {
    return {
      type: 'image',
      src: src,
      style: { backgroundImage: 'url(' + src + ')', backgroundSize: 'cover', backgroundPosition: 'center center' }
    };
  }
  return {
    type: 'gradient',
    src: '',
    style: { background: GRADIENT_MAP[value] || GRADIENT_MAP['default'] }
  };
}

export default { resolveWallpaper: resolveWallpaper };