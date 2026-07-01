// 图标优化脚本：将"假 SVG"（内嵌 base64 PNG 的 SVG）转换为真正的 PNG 文件
// 根因：Resources/public/icons/*.svg 实际是 <svg><image href="data:image/png;base64,..."/></svg>
// 每个文件 145KB-834KB，导致图标加载极慢
// 本脚本用 sharp 读取 SVG 并输出压缩后的 192×192 PNG（足够 60-80px 图标在 3x DPI 下清晰）
//
// 用法：node server/scripts/convert-icons.js

var fs = require('fs');
var path = require('path');
var sharp = require('sharp');

var ICONS_DIR = path.resolve(__dirname, '../../Resources/public/icons');
var OUTPUT_SIZE = 192;  // 输出尺寸（px），60-80px 图标 × 3x DPI = 180-240px，192 足够

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(2) + 'MB';
}

async function convertOne(svgFile) {
  var svgPath = path.join(ICONS_DIR, svgFile);
  var pngFile = svgFile.replace(/\.svg$/i, '.png');
  var pngPath = path.join(ICONS_DIR, pngFile);

  var svgSize = fs.statSync(svgPath).size;

  try {
    // sharp 读取 SVG（含 base64 image）→ resize → PNG
    // fit: 'contain' 保持比例，background 透明
    var info = await sharp(svgPath)
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({
        quality: 90,
        compressionLevel: 9,
        palette: true
      })
      .toFile(pngPath);

    var pngSize = fs.statSync(pngPath).size;
    var ratio = ((1 - pngSize / svgSize) * 100).toFixed(1);
    console.log('  ' + svgFile + ' → ' + pngFile);
    console.log('    ' + formatBytes(svgSize) + ' → ' + formatBytes(pngSize) + '  (减小 ' + ratio + '%)');
    return { file: svgFile, svgSize: svgSize, pngSize: pngSize, ok: true };
  } catch (err) {
    console.error('  ' + svgFile + ' 转换失败: ' + err.message);
    return { file: svgFile, ok: false, error: err.message };
  }
}

async function main() {
  console.log('=== 图标优化脚本 ===');
  console.log('源目录: ' + ICONS_DIR);
  console.log('输出尺寸: ' + OUTPUT_SIZE + 'x' + OUTPUT_SIZE + ' px');
  console.log('');

  if (!fs.existsSync(ICONS_DIR)) {
    console.error('错误：目录不存在 ' + ICONS_DIR);
    process.exit(1);
  }

  var svgFiles = fs.readdirSync(ICONS_DIR).filter(function(f) {
    return /\.svg$/i.test(f);
  });

  if (svgFiles.length === 0) {
    console.log('未找到 SVG 文件');
    process.exit(0);
  }

  console.log('找到 ' + svgFiles.length + ' 个 SVG 文件，开始转换...');
  console.log('');

  var results = [];
  for (var i = 0; i < svgFiles.length; i++) {
    var r = await convertOne(svgFiles[i]);
    results.push(r);
  }

  // 汇总
  console.log('');
  console.log('=== 转换汇总 ===');
  var totalSvg = 0, totalPng = 0, okCount = 0;
  results.forEach(function(r) {
    if (r.ok) {
      totalSvg += r.svgSize;
      totalPng += r.pngSize;
      okCount++;
    }
  });
  console.log('成功: ' + okCount + '/' + svgFiles.length);
  if (okCount > 0) {
    console.log('总体积: ' + formatBytes(totalSvg) + ' → ' + formatBytes(totalPng));
    console.log('减小: ' + ((1 - totalPng / totalSvg) * 100).toFixed(1) + '%');
  }
  console.log('');
  console.log('注意：请手动修改 client/src/store/modules/desktop.js 中 APP_REGISTRY 的 icon 路径 .svg → .png');
}

main().catch(function(err) {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
