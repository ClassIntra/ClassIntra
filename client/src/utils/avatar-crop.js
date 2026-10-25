// 裁切数学（云端唯一真相源）—— 头像与个人封面共用
//
// 为什么裁切参数存在 DB 而**不是**服务端预裁剪：
//   同一张图要在 40px 的聊天列表、64px 的社区评论、240px 的个人页、900px 的封面横幅里显示，
//   预裁剪只能服务一个尺寸；存参数则任何容器都能算出同一个裁切区域。
//   用户改裁切也只是 UPDATE 一行，不用重新传图。
//
// 坐标系：容器为矩形 box（boxW × boxH），图片原始宽高 natW/natH。
//   cover 基础缩放 k0 = max(boxW/natW, boxH/natH) → 铺满容器，长边溢出
//     （正方形容器时 max(S/w, S/h) 恒等于 S/min(w,h)，与旧版一致）
//   用户缩放 zoom ∈ [1,4]                     → 总缩放 s = k0 * zoom
//   偏移 ox/oy ∈ [-1,1]                       → 沿各轴「可移动余量」的比例
// 渲染：img 先 translate(px) 再 scale(s)，origin 为 center。
//   translate 在 scale 左侧 ⇒ 平移量处于未缩放坐标系，px 直接对应屏幕像素。
//
// ⚠️ 服务端 server/src/routes/user.js 的 normalizeCrop() 与这里的 clamp 边界
//    必须保持一致（zoom 1~4、ox/oy -1~1），改一边就要改另一边。

export var AVATAR_CROP_DEFAULT = { zoom: 1, ox: 0, oy: 0 };

export var AVATAR_CROP_LIMITS = { minZoom: 1, maxZoom: 4 };

// 个人封面容器的宽高比（宽/高）。裁剪器与展示端必须用同一个值，
// 否则「裁的时候看到的」和「主页上看到的」会不一致。放这里是为了让
// Profile.vue（展示）与 ProfileEditor.vue（裁剪）共用一份，不靠各自抄常量。
export var COVER_ASPECT = 3.2;

// 归一化/夹紧，返回一个新对象（不修改入参）
export function normalizeCrop(crop) {
  var c = crop || {};
  var zoom = parseFloat(c.zoom);
  var ox = parseFloat(c.ox);
  var oy = parseFloat(c.oy);
  return {
    zoom: isFinite(zoom) ? Math.min(AVATAR_CROP_LIMITS.maxZoom, Math.max(AVATAR_CROP_LIMITS.minZoom, zoom)) : 1,
    ox: isFinite(ox) ? Math.min(1, Math.max(-1, ox)) : 0,
    oy: isFinite(oy) ? Math.min(1, Math.max(-1, oy)) : 0
  };
}

// 计算 img 的 transform 字符串
// natW/natH：图片原始像素；boxW/boxH：容器尺寸(px)；crop：{zoom,ox,oy}
export function computeCropTransform(natW, natH, boxW, boxH, crop) {
  var c = normalizeCrop(crop);
  if (!natW || !natH || !boxW || !boxH) {
    // 尺寸还没测出来（图片未加载）时给一个不裁不挪的初始态，避免闪烁
    return 'translate(0px, 0px) scale(1)';
  }
  var k0 = Math.max(boxW / natW, boxH / natH);
  var s = k0 * c.zoom;
  var dispW = natW * s;
  var dispH = natH * s;
  // 可移动余量（缩放后图片比容器大出来的部分，一半在左一半在右）
  var maxX = Math.max(0, (dispW - boxW) / 2);
  var maxY = Math.max(0, (dispH - boxH) / 2);
  var tx = -c.ox * maxX;
  var ty = -c.oy * maxY;
  return 'translate(' + tx.toFixed(2) + 'px, ' + ty.toFixed(2) + 'px) scale(' + s.toFixed(4) + ')';
}

// 由像素位移反算归一化偏移（拖动交互用）
// dx/dy：本次拖动的像素增量（屏幕坐标，向右/向下为正）
export function offsetFromPixelDelta(natW, natH, boxW, boxH, crop, dx, dy) {
  var c = normalizeCrop(crop);
  var k0 = Math.max(boxW / natW, boxH / natH);
  var s = k0 * c.zoom;
  var maxX = Math.max(0, (natW * s - boxW) / 2);
  var maxY = Math.max(0, (natH * s - boxH) / 2);
  var nextOx = c.ox;
  var nextOy = c.oy;
  // ox 为正 = 图片往右挪（看到左边更多内容），与 dx 同向
  if (maxX > 0) nextOx = Math.min(1, Math.max(-1, c.ox + dx / maxX));
  if (maxY > 0) nextOy = Math.min(1, Math.max(-1, c.oy + dy / maxY));
  return { zoom: c.zoom, ox: nextOx, oy: nextOy };
}
