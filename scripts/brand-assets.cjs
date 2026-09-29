// 品牌资产生成器
//
// 用途：把品牌美术导出的原始大图（仓库 logo/ 下的 white-logo.png / color-logo.png，3072x3072 调色板 PNG、
//       透明底）裁掉留白、压到 Web 尺寸，并生成方块标，落到 Resources/public/brand/。
//
// 输出：
//   logo-mark.png         彩色标（浅色底用：设置·关于、初始化页页头）
//   logo-mark-white.png   白色标（深色底用：启动屏、登录/注册、灵动岛）
//   logo-mark-square.png  方块标位图（备用）
//   logo-mark-square.svg  方块标矢量外壳（深蓝 squircle + 内嵌白色标），favicon.svg 同内容
//
// 用法：node scripts/brand-assets.cjs
// 依赖：server/node_modules/sharp（已随项目安装）
//
// 注意：sharp 的 extend 在 resize 之后执行，故 PAD_RATIO 按【输出】像素计算。
var sharp = require('D:/NetWork/Integration/ClassIntra/server/node_modules/sharp');
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var BRAND = path.join(ROOT, 'Resources/public/brand');
var TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

var MARK_W = 512;          // 显示最大 156px @2-3x DPR
var PAD_RATIO = 0.06;      // 安全边距（注意：sharp 的 extend 在 resize 之后执行，故按【输出】像素计）
var PNG_OPTS = { palette: true, quality: 92, compressionLevel: 9, effort: 10 };

function trimmed(file) {
  return sharp(file).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
}
function kb(f) { return (fs.statSync(f).size / 1024).toFixed(1) + 'KB'; }

async function makeMark(src, out, label) {
  var t = await trimmed(src);
  var w = t.info.width, h = t.info.height;
  var pad = Math.round(MARK_W * PAD_RATIO);
  var info = await sharp(t.data)
    .resize({ width: MARK_W, kernel: 'lanczos3' })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: TRANSPARENT })
    .png(PNG_OPTS)
    .toFile(out);
  console.log('  ' + label.padEnd(24) + ' 源 ' + w + 'x' + h + '  →  ' + info.width + 'x' + info.height +
    '  宽高比 ' + (info.width / info.height).toFixed(3) + '  ' + kb(out));
  return t;
}

async function makeTile(whiteSrc) {
  var t = await trimmed(whiteSrc);
  var ratio = t.info.height / t.info.width;

  // 1) PNG 方块标（备用 / 需要位图时用）
  var S = 512, rx = Math.round(S * 29 / 128);
  var bgSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + S + '" height="' + S + '">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#3A82F7"/><stop offset="1" stop-color="#0B4BD8"/></linearGradient></defs>' +
    '<rect width="' + S + '" height="' + S + '" rx="' + rx + '" fill="url(#g)"/></svg>';
  var bg = await sharp(Buffer.from(bgSvg)).png().toBuffer();
  var markW = Math.round(S * 0.62);
  var mark = await sharp(t.data).resize({ width: markW, kernel: 'lanczos3' }).png().toBuffer();
  await sharp(bg).composite([{ input: mark, gravity: 'center' }]).png(PNG_OPTS).toFile(path.join(BRAND, 'logo-mark-square.png'));
  console.log('  logo-mark-square.png     ' + S + 'x' + S + '  ' + kb(path.join(BRAND, 'logo-mark-square.png')));

  // 2) SVG 方块标（矢量 squircle 边 + 内嵌白标），favicon 与设置页共用
  var embedW = 256;
  var embed = await sharp(t.data).resize({ width: embedW, kernel: 'lanczos3' }).png(PNG_OPTS).toBuffer();
  var b64 = embed.toString('base64');
  var V = 128, vrx = Math.round(V * 29 / 128);
  var vMarkW = Math.round(V * 0.62);
  var vMarkH = +(vMarkW * ratio).toFixed(2);
  var vx = +((V - vMarkW) / 2).toFixed(2);
  var vy = +((V - vMarkH) / 2).toFixed(2);

  var svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="ClassIntra">',
    '  <!--',
    '    ClassIntra 应用图标（iOS squircle 风格方形标）',
    '    深蓝渐变底 + 白色层叠卡标识，用于「关于系统」、站点图标等方形场景。',
    '    <image> 内嵌的白色标识来自品牌美术导出，请勿手工重绘。',
    '  -->',
    '  <defs>',
    '    <linearGradient id="ciSqBg" x1="0" y1="0" x2="1" y2="1">',
    '      <stop offset="0" stop-color="#3A82F7"/>',
    '      <stop offset="1" stop-color="#0B4BD8"/>',
    '    </linearGradient>',
    '    <linearGradient id="ciSqGloss" x1="0" y1="0" x2="0" y2="1">',
    '      <stop offset="0" stop-color="rgba(255,255,255,0.18)"/>',
    '      <stop offset="0.55" stop-color="rgba(255,255,255,0)"/>',
    '    </linearGradient>',
    '  </defs>',
    '  <rect x="0" y="0" width="128" height="128" rx="' + vrx + '" fill="url(#ciSqBg)"/>',
    '  <rect x="0" y="0" width="128" height="128" rx="' + vrx + '" fill="url(#ciSqGloss)"/>',
    '  <image x="' + vx + '" y="' + vy + '" width="' + vMarkW + '" height="' + vMarkH + '" href="data:image/png;base64,' + b64 + '"/>',
    '</svg>',
    ''
  ].join('\n');

  fs.writeFileSync(path.join(BRAND, 'logo-mark-square.svg'), svg, 'utf8');
  fs.writeFileSync(path.join(BRAND, 'favicon.svg'), svg, 'utf8');
  console.log('  logo-mark-square.svg     favicon.svg 同内容  ' + kb(path.join(BRAND, 'logo-mark-square.svg')));
  console.log('  新标宽高比 = ' + (1 / ratio).toFixed(3) + '（横向）');
}

(async function () {
  console.log('== 生成品牌资产 ==');
  // 原始大图统一放在 logo/ 下（2026-09-29 仓库整理时从仓库根移入）
  var SRC = path.join(ROOT, 'logo');
  await makeMark(path.join(SRC, 'color-logo.png'), path.join(BRAND, 'logo-mark.png'), 'logo-mark.png（浅底）');
  await makeMark(path.join(SRC, 'white-logo.png'), path.join(BRAND, 'logo-mark-white.png'), 'logo-mark-white.png（深底）');
  await makeTile(path.join(SRC, 'white-logo.png'));
  console.log('== 完成 ==');
})().catch(function (e) { console.error('ERR', e.message); process.exit(1); });
