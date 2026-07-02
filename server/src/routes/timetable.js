// 课程表路由
// 数据源：Resources/kb.yml（高中课表，含单双周）
// 不缓存：每次请求都重新读取文件并解析，确保数据实时性
// 解析方式：针对性 YAML 解析器（仅支持 kb.yml 使用的 YAML 语法子集）

var express = require('express');
var router = express.Router();
var fs = require('fs');
var path = require('path');
var config = require('../config');
var auth = require('../middleware/auth');

router.use(auth.requireAuth);

// kb.yml 文件路径
var KB_PATH = path.join(config.resourcesDir, 'kb.yml');

// ===== 针对 kb.yml 的 YAML 解析器 =====
// 支持的语法子集：
//   key: value          键值对（value 为标量：数字/字符串）
//   key:                后跟嵌套结构（数组或对象）
//   - key: value        数组项（对象，含第一个键值对）
//   - key:              数组项（对象，第一个键后跟嵌套）
//   - value             纯值数组项
//   ''                  空字符串
// 规则：
//   - 键值分隔符为 ": "（冒号+空格），或行尾冒号表示嵌套
//   - 数组项 "- " 可与父级 key: 同缩进（YAML 特性）
//   - 缩进决定层级（空格，非 Tab）

// 解析标量值：去除引号，识别数字
function parseScalar(v) {
  if (v === "''" || v === '""') return '';
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") {
    return v.substring(1, v.length - 1);
  }
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    return v.substring(1, v.length - 1);
  }
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

// 解析 kb.yml 文本为 JS 对象
// 算法：逐行处理 + 缩进栈
// 栈元素：{ indent, container, key, isArrayItem }
//   - indent: 该行缩进
//   - container: 当前层级的容器（对象或数组所属的对象）
//   - key: 当前层级对应的键名（key: 后跟嵌套时有效）
//   - isArrayItem: 该栈层是否由数组项创建
function parseKbYaml(text) {
  var lines = text.split(/\r?\n/);
  var root = {};
  var stack = [{ indent: -1, container: root, key: null, isArrayItem: false }];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    // 跳过空行和注释
    if (!trimmed || trimmed[0] === '#') continue;

    // 计算缩进（空格数）
    var indent = 0;
    while (indent < line.length && line[indent] === ' ') indent++;
    var content = line.substring(indent);

    // 出栈到正确层级
    while (stack.length > 1) {
      var top = stack[stack.length - 1];
      if (indent < top.indent) {
        // 缩进减少：肯定离开当前层级
        stack.pop();
      } else if (indent === top.indent) {
        if (top.isArrayItem) {
          // 栈顶是数组项：无论当前行是什么都出栈
          // （数组项结束 → 回到父数组/父对象）
          stack.pop();
        } else if (top.key !== null) {
          // 栈顶是 key: 等待子级
          if (content[0] === '-' && (content[1] === ' ' || content.length === 1)) {
            // 当前行是数组项：属于此 key 的数组，不出栈
            break;
          } else {
            // 当前行是同级键值对：出栈
            stack.pop();
          }
        } else {
          // 栈顶是普通对象容器（不应出现在 indent===top.indent 的情况）
          stack.pop();
        }
      } else {
        // 缩进增加：子级，不出栈
        break;
      }
    }

    var current = stack[stack.length - 1];

    if (content[0] === '-' && (content[1] === ' ' || content.length === 1)) {
      // ===== 数组项 =====
      var itemContent = content.length > 1 ? content.substring(2).trim() : '';

      // 确保 container[key] 是数组
      var arr = current.container[current.key];
      if (!Array.isArray(arr)) {
        arr = [];
        current.container[current.key] = arr;
      }

      if (itemContent.indexOf(': ') > 0) {
        // 数组项是对象 + 第一个键值对
        var obj = {};
        arr.push(obj);
        var colonIdx = itemContent.indexOf(': ');
        var k = itemContent.substring(0, colonIdx).trim();
        var v = itemContent.substring(colonIdx + 2).trim();
        obj[k] = parseScalar(v);
        // 入栈：后续同缩进字段属于此对象
        stack.push({ indent: indent, container: obj, key: null, isArrayItem: true });
      } else if (itemContent.length > 0 && itemContent[itemContent.length - 1] === ':') {
        // 数组项是对象 + 第一个键后跟嵌套
        var obj2 = {};
        arr.push(obj2);
        var k2 = itemContent.substring(0, itemContent.length - 1).trim();
        obj2[k2] = null;
        stack.push({ indent: indent, container: obj2, key: k2, isArrayItem: true });
      } else if (itemContent.length > 0) {
        // 纯值数组项
        arr.push(parseScalar(itemContent));
      }
    } else if (content.indexOf(': ') > 0) {
      // ===== 键值对 =====
      var ci = content.indexOf(': ');
      var key = content.substring(0, ci).trim();
      var val = content.substring(ci + 2).trim();
      current.container[key] = parseScalar(val);
    } else if (content.length > 0 && content[content.length - 1] === ':') {
      // ===== key: 后跟嵌套 =====
      var nk = content.substring(0, content.length - 1).trim();
      current.container[nk] = null;
      stack.push({ indent: indent, container: current.container, key: nk, isArrayItem: false });
    }
  }

  return root;
}

// 读取并解析 kb.yml（不缓存，每次调用都读文件）
function loadTimetableData() {
  var text = fs.readFileSync(KB_PATH, 'utf8');
  var data = parseKbYaml(text);

  // 数据校验 + 补全
  if (!data.subjects) data.subjects = [];
  if (!data.schedules) data.schedules = [];

  // 为每个 schedule 补全字段类型
  for (var i = 0; i < data.schedules.length; i++) {
    var sch = data.schedules[i];
    if (!sch.classes) sch.classes = [];
    if (typeof sch.enable_day !== 'number') sch.enable_day = parseInt(sch.enable_day, 10) || 0;
    if (!sch.weeks) sch.weeks = 'all';
    // 确保 classes 的时间字段为字符串
    for (var j = 0; j < sch.classes.length; j++) {
      var cls = sch.classes[j];
      if (cls.start_time && typeof cls.start_time !== 'string') cls.start_time = String(cls.start_time);
      if (cls.end_time && typeof cls.end_time !== 'string') cls.end_time = String(cls.end_time);
    }
  }

  return data;
}

// GET /api/timetable — 获取完整课表数据
// 返回：{ code: 200, data: { version, subjects, schedules } }
router.get('/', function(req, res) {
  try {
    var data = loadTimetableData();
    res.json({ code: 200, message: 'ok', data: data });
  } catch (err) {
    console.error('[Timetable] 读取课表失败:', err.message);
    res.status(500).json({ code: 500, message: '读取课表数据失败: ' + err.message, data: null });
  }
});

module.exports = router;
