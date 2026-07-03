// 优化图标 PNG：缩放至 180×180（覆盖 2.5x Retina）+ 压缩
// 桌面图标 CSS 尺寸 72×72，180px 覆盖主流 Retina 显示
// 用法：node scripts/optimize-icons.js
var fs = require('fs');
var path = require('path');
var sharp = require('sharp');

var iconsDir = path.join(__dirname, '..', 'Resources', 'public', 'icons');
var targetSize = 180;

var files = fs.readdirSync(iconsDir).filter(function(f) { return f.endsWith('.png'); });

console.log('优化 ' + files.length + ' 个 PNG 图标（目标 ' + targetSize + '×' + targetSize + '）\n');

var totalBefore = 0;
var totalAfter = 0;

var promises = files.map(function(filename) {
  var filePath = path.join(iconsDir, filename);
  var beforeSize = fs.statSync(filePath).size;
  totalBefore += beforeSize;

  return sharp(filePath)
    .resize(targetSize, targetSize, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer()
    .then(function(buffer) {
      fs.writeFileSync(filePath, buffer);
      var afterSize = buffer.length;
      totalAfter += afterSize;
      var pct = ((1 - afterSize / beforeSize) * 100).toFixed(1);
      console.log('✅ ' + filename.padEnd(18) +
        (beforeSize / 1024).toFixed(1) + 'KB → ' +
        (afterSize / 1024).toFixed(1) + 'KB  (-' + pct + '%)');
    });
});

Promise.all(promises).then(function() {
  console.log('\n========================================');
  console.log('总计: ' + (totalBefore / 1024).toFixed(0) + 'KB → ' + (totalAfter / 1024).toFixed(0) + 'KB');
  console.log('减小: ' + ((1 - totalAfter / totalBefore) * 100).toFixed(1) + '%');
  console.log('========================================');
});
