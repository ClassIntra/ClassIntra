// 从 SVG 中提取 base64 PNG 数据并保存为纯 PNG 文件
// 用法：node scripts/svg-to-png.js
var fs = require('fs');
var path = require('path');

var iconsDir = path.join(__dirname, '..', 'Resources', 'public', 'icons');
var files = fs.readdirSync(iconsDir).filter(function(f) { return f.endsWith('.svg'); });

console.log('找到 ' + files.length + ' 个 SVG 文件\n');

files.forEach(function(filename) {
  var svgPath = path.join(iconsDir, filename);
  var svgContent = fs.readFileSync(svgPath, 'utf8');

  // 匹配 <image href="data:image/png;base64,..." />
  var match = svgContent.match(/href="data:image\/png;base64,([^"]+)"/);
  if (!match) {
    console.log('跳过 ' + filename + '（未找到 base64 PNG 数据）');
    return;
  }

  var base64Data = match[1].replace(/\s/g, '');
  var pngBuffer = Buffer.from(base64Data, 'base64');

  var pngFilename = filename.replace('.svg', '.png');
  var pngPath = path.join(iconsDir, pngFilename);
  fs.writeFileSync(pngPath, pngBuffer);

  var svgSize = (Buffer.byteLength(svgContent) / 1024).toFixed(1);
  var pngSize = (pngBuffer.length / 1024).toFixed(1);
  var reduction = ((1 - pngBuffer.length / Buffer.byteLength(svgContent)) * 100).toFixed(1);

  console.log('✅ ' + filename + ' → ' + pngFilename +
    '  (' + svgSize + 'KB → ' + pngSize + 'KB, 减小 ' + reduction + '%)');
});

console.log('\n完成！PNG 文件已保存到 ' + iconsDir);
console.log('将 desktop.js 和 index.html 中的 .svg 改回 .png 即可。');
