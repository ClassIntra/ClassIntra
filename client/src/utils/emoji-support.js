var canvasEl = null;
var ctx = null;
var renderCache = {};
var oldDeviceChecked = false;
var oldDevice = false;

var KNOWN_NEW = {
  '🥲': 1, '🫡': 1, '🫥': 1, '🥸': 1, '🫶': 1, '🫰': 1, '🫵': 1,
  '🫱': 1, '🫲': 1, '🫳': 1, '🫴': 1, '🫀': 1, '🫁': 1, '🪃': 1,
  '🪀': 1, '🦾': 1, '🦿': 1, '🦵': 1, '🦶': 1, '🦻': 1
};

function isOldDevice() {
  if (!oldDeviceChecked) {
    oldDeviceChecked = true;
    oldDevice = !isRenderable('🫡');
  }
  return oldDevice;
}

function getCtx() {
  if (!ctx) {
    canvasEl = document.createElement('canvas');
    canvasEl.width = 48;
    canvasEl.height = 48;
    ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  }
  return ctx;
}

function renderToData(text) {
  var c = getCtx();
  c.clearRect(0, 0, 48, 48);
  c.font = '40px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  c.textBaseline = 'top';
  c.textAlign = 'left';
  c.fillStyle = '#000';
  c.fillText(text, 4, 4);
  return c.getImageData(0, 0, 48, 48).data;
}

function analyze(data) {
  var total = 0;
  var colorful = 0;
  var minX = 48, minY = 48, maxX = -1, maxY = -1;
  for (var y = 0; y < 48; y++) {
    for (var x = 0; x < 48; x++) {
      var i = (y * 48 + x) * 4;
      if (data[i + 3] <= 16) continue;
      total++;
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var mx = r > g ? r : g; mx = b > mx ? b : mx;
      var mn = g < r ? g : r; mn = b < mn ? b : mn;
      if (mx - mn > 40) colorful++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { total: total, colorful: colorful, minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

function isHollowBox(data, a) {
  var bw = a.maxX - a.minX + 1;
  var bh = a.maxY - a.minY + 1;
  var ratio = bw / bh;
  if (ratio < 0.65 || ratio > 1.55) return false;
  var mx = Math.floor(bw * 0.3);
  var my = Math.floor(bh * 0.3);
  var cx0 = a.minX + mx, cx1 = a.maxX - mx;
  var cy0 = a.minY + my, cy1 = a.maxY - my;
  var centerTotal = 0, centerFilled = 0;
  for (var y = cy0; y <= cy1; y++) {
    for (var x = cx0; x <= cx1; x++) {
      centerTotal++;
      if (data[(y * 48 + x) * 4 + 3] > 16) centerFilled++;
    }
  }
  if (centerTotal === 0) return false;
  if (centerFilled / centerTotal > 0.25) return false;
  if (a.total - centerFilled < 20) return false;
  return true;
}

function isRenderable(emoji) {
  if (renderCache.hasOwnProperty(emoji)) return renderCache[emoji];
  var result = true;
  try {
    var data = renderToData(emoji);
    var a = analyze(data);
    if (a.total === 0) {
      result = false;
    } else if (a.colorful <= 4 && isHollowBox(data, a)) {
      result = false;
    }
  } catch (e) {
    result = true;
  }
  renderCache[emoji] = result;
  return result;
}

function filterRenderable(list) {
  if (!list || !list.length) return [];
  try {
    if (!isRenderable('😀')) return list.slice();
  } catch (e) {
    return list.slice();
  }
  var old = false;
  try {
    old = isOldDevice();
  } catch (e) {
    old = false;
  }
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var emoji = list[i];
    if (old && KNOWN_NEW[emoji]) continue;
    if (isRenderable(emoji)) out.push(emoji);
  }
  return out;
}

export { isRenderable, filterRenderable };
