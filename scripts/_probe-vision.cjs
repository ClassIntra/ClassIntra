// 视觉（看图）路由级集成测试
// 无测试框架：复制生产库 → 指向临时库 → 起一个假的上游 OpenAI 端点 → 直接打 router。
// 覆盖：原生视觉 / 统一转述 / 未配置转述应拒绝 / 导出路由已下线 / 管理端配置校验。
var fs = require('fs');
var path = require('path');
var http = require('http');
var crypto = require('crypto');

var ROOT = path.join(__dirname, '..');
var DB_TMP = path.join(ROOT, 'server/database/_probe_vision.db');
try { fs.unlinkSync(DB_TMP); } catch (e) {}
try { fs.unlinkSync(DB_TMP + '-shm'); } catch (e) {}
try { fs.unlinkSync(DB_TMP + '-wal'); } catch (e) {}
fs.copyFileSync(path.join(ROOT, 'server/database/classintra.db'), DB_TMP);
process.env.DB_PATH = DB_TMP;

require(path.join(ROOT, 'node_modules/.pnpm/dotenv@16.6.1/node_modules/dotenv')).config({ path: path.join(ROOT, 'server/.env') });

// 云盘物理目录指向临时目录，避免污染真实 Resources
var TMP_RES = path.join(ROOT, 'server/database/_probe_res');
var SHARED = path.join(TMP_RES, 'cloud', 'shared');
fs.mkdirSync(SHARED, { recursive: true });
var config = require(path.join(ROOT, 'server/src/config'));
config.resourcesDir = TMP_RES;

var db = require(path.join(ROOT, 'server/src/utils/db'));
// 补跑迁移 015（生产库副本还没有这两列）
require(path.join(ROOT, 'server/src/migrations/015_ai_vision.js')).up(db);

var aiService = require(path.join(ROOT, 'server/src/services/ai-chat'));
var appConfig = require(path.join(ROOT, 'server/src/utils/app-config'));
var cloudStore = require(path.join(ROOT, 'server/src/services/cloud-store'));

// ---------- 假上游 ----------
var upstreamCalls = [];
var MOCK_PORT = 19221;
var server = http.createServer(function(req, res) {
  var chunks = [];
  req.on('data', function(c) { chunks.push(c); });
  req.on('end', function() {
    var body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    upstreamCalls.push(body);
    var text = body.model.indexOf('relay') >= 0 ? '图里写着：贝尔不等式 2026' : '这是模型回答';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: text } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60 }
    }));
  });
});

// ---------- 测试数据 ----------
var USER = 'probe_vision_user';
var CONV = 'probe_conv_1';
var MOCK_URL = 'http://127.0.0.1:' + MOCK_PORT + '/v1';

function setup() {
  db.prepare('DELETE FROM users WHERE user_id = ?').run(USER);
  db.prepare("INSERT INTO users (user_id, net_name, real_name, password_hash, is_admin, role, status) VALUES (?, '探针', '探针', 'x', 1, 'student', 1)").run(USER);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(CONV);
  db.prepare("INSERT INTO conversations (id, user_id, title, messages_json, created_at, updated_at) VALUES (?, ?, '探针对话', '[]', datetime('now'), datetime('now'))").run(CONV, USER);

  ['probe-vision', 'probe-text', 'probe-relay'].forEach(function(id) {
    db.prepare('DELETE FROM ai_models WHERE id = ?').run(id);
  });
  db.prepare("UPDATE ai_models SET is_default = 0 WHERE is_default = 1").run();
  function ins(id, label, modelName, vision) {
    db.prepare([
      'INSERT INTO ai_models (id, label, api_url, api_key, model, color, api_style, supports_thinking, supports_search,',
      ' is_free, enabled, is_default, builtin, sort_order, price_in, price_out, price_cache_hit, supports_stream_options, supports_vision, vision_max_images)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 1, 0, 0, 500, 1000, 2000, 100, 1, ?, 0)'
    ].join('\n')).run(id, label, MOCK_URL, 'sk-test', modelName, '#6366f1', 'openai', vision ? 1 : 0);
  }
  ins('probe-vision', '视觉模型', 'vision-model', true);
  ins('probe-text', '纯文本模型', 'text-model', false);
  ins('probe-relay', '转述模型', 'relay-model', true);
  db.prepare("UPDATE ai_models SET is_default = 1 WHERE id = 'probe-text'").run();

  // 造一张 1x1 PNG 放进（临时）云盘
  var PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001' +
    '0d0a2db40000000049454e44ae426082', 'hex');
  var hash = crypto.createHash('sha256').update(PNG).digest('hex');
  var storagePath = hash.substring(0, 2) + '/' + hash + '.png';
  fs.mkdirSync(path.join(SHARED, hash.substring(0, 2)), { recursive: true });
  fs.writeFileSync(path.join(SHARED, storagePath), PNG);
  db.prepare('DELETE FROM cloud_files WHERE hash = ?').run(hash);
  db.prepare('DELETE FROM cloud_user_files WHERE user_id = ?').run(USER);
  db.prepare("INSERT INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path) VALUES (?, ?, 'probe.png', ?, 'image/png', ?)")
    .run(hash, USER, PNG.length, storagePath);
  db.prepare("INSERT INTO cloud_user_files (user_id, file_hash, display_name, folder) VALUES (?, ?, '探针图.png', '')").run(USER, hash);
  return hash;
}

// ---------- 路由调用器 ----------
function compilePath(p) {
  var re = p.replace(/:[A-Za-z0-9_]+/g, '([^/]+)');
  return new RegExp('^' + re + '$');
}
function call(router, method, url, body, user) {
  return new Promise(function(resolve, reject) {
    var pathname = url.split('?')[0];
    var handler = null;
    var params = {};
    for (var i = 0; i < router.stack.length; i++) {
      var layer = router.stack[i];
      if (!layer.route) continue;
      if (layer.route.methods[method] !== true) continue;
      var m = compilePath(layer.route.path).exec(pathname);
      if (!m) continue;
      var keys = (layer.route.path.match(/:[A-Za-z0-9_]+/g) || []).map(function(k) { return k.substring(1); });
      keys.forEach(function(k, idx) { params[k] = decodeURIComponent(m[idx + 1]); });
      handler = layer.route.stack[layer.route.stack.length - 1].handle;
      break;
    }
    if (!handler) return resolve({ status: 404, body: null, missing: true });

    var req = { method: method.toUpperCase(), url: url, body: body || {}, params: params, query: {}, user: user, headers: {} };
    var qs = url.split('?')[1];
    if (qs) qs.split('&').forEach(function(kv) { var p = kv.split('='); req.query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    var finished = false;
    var res = {
      statusCode: 200,
      status: function(c) { this.statusCode = c; return this; },
      json: function(b) { if (finished) return; finished = true; resolve({ status: this.statusCode, body: b }); },
      send: function(b) { if (finished) return; finished = true; resolve({ status: this.statusCode, body: b }); },
      write: function() {},
      end: function() { if (finished) return; finished = true; resolve({ status: this.statusCode, body: null }); },
      writeHead: function(c) { this.statusCode = c; },
      setHeader: function() {},
      flushHeaders: function() {},
      writableEnded: true
    };
    try { handler(req, res, function() {}); } catch (e) { if (!finished) resolve({ status: 599, body: { message: 'THREW: ' + e.message } }); }
  });
}

var PASS = 0;
var FAIL = 0;
function check(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')); }
}

function main() {
  return new Promise(function(resolve) {
    server.listen(MOCK_PORT, '127.0.0.1', function() { resolve(); });
  });
}

main().then(function() {
  var HASH = setup();
  var router = require(path.join(ROOT, 'apps/ai-chat/backend/routes.js'));
  var admin = { user_id: USER, is_admin: 1 };

  console.log('\n[1] 云盘读取服务');
  var r0 = cloudStore.readUserFile(HASH, USER, 4 * 1024 * 1024);
  check('能读到自己的云盘图片', !r0.error && r0.buffer && r0.buffer.length > 0, r0.error);
  check('mime 判定为图片', cloudStore.isImageMime(r0.mime), r0.mime);
  var r0b = cloudStore.readUserFile(HASH, 'someone_else', 4 * 1024 * 1024);
  check('别人的文件读不到（越权拦截）', !!r0b.error, r0b);
  var r0c = cloudStore.readUserFile('../../etc/passwd', USER, 4 * 1024 * 1024);
  check('非法 hash 被拒', !!r0c.error);

  console.log('\n[2] /models 返回视觉能力');
  return call(router, 'get', '/models', {}, admin).then(function(r) {
    check('/models 200', r.status === 200 && r.body.code === 200, r.body);
    var v = r.body.data.vision;
    check('带 vision 总览', !!v, v);
    var vis = r.body.data.models.filter(function(m) { return m.id === 'probe-vision'; })[0];
    check('probe-vision.supports_vision = true', vis && vis.supports_vision === true, vis);

    console.log('\n[3] 原生视觉：图片直接进内容块');
    upstreamCalls = [];
    return call(router, 'post', '/chat', {
      conversation_id: CONV, message: '这是什么？', model: 'probe-vision', images: [{ hash: HASH }]
    }, admin);
  }).then(function(r) {
    check('返回 200', r.status === 200 && r.body.code === 200, r.body);
    check('上游只被调一次', upstreamCalls.length === 1, upstreamCalls.length);
    var last = upstreamCalls[0].messages[upstreamCalls[0].messages.length - 1];
    check('用户消息是多模态数组', Array.isArray(last.content), typeof last.content);
    var imgParts = last.content.filter(function(p) { return p && p.image_url; });
    check('含 1 个 image_url 块', imgParts.length === 1, imgParts.length);
    check('图片是 data URL', imgParts.length === 1 && /^data:image\/png;base64,/.test(imgParts[0].image_url.url));
    check('文本块保留提问', last.content[0].text.indexOf('这是什么？') >= 0, last.content[0].text);

    console.log('\n[4] 统一转述模型：非视觉模型也能看图');
    appConfig.saveValues('ai-chat', { vision_relay_model: 'probe-relay', vision_enabled: '1' });
    upstreamCalls = [];
    db.prepare("UPDATE conversations SET messages_json = '[]' WHERE id = ?").run(CONV);
    return call(router, 'post', '/chat', {
      conversation_id: CONV, message: '这是什么？', model: 'probe-text', images: [{ hash: HASH }]
    }, admin);
  }).then(function(r) {
    check('返回 200', r.status === 200 && r.body.code === 200, r.body);
    check('上游被调用两次（转述 + 回答）', upstreamCalls.length === 2, upstreamCalls.length);
    var relayCall = upstreamCalls[0];
    check('第一次打的是转述模型', relayCall.model === 'relay-model', relayCall.model);
    var relayLast = relayCall.messages[relayCall.messages.length - 1];
    check('转述请求带了图片', Array.isArray(relayLast.content) && relayLast.content.some(function(p) { return p && p.image_url; }));
    var mainCall = upstreamCalls[1];
    check('第二次打的是对话模型', mainCall.model === 'text-model', mainCall.model);
    var mainLast = mainCall.messages[mainCall.messages.length - 1];
    check('对话模型拿到的是纯文本', typeof mainLast.content === 'string', typeof mainLast.content);
    check('文本内含转述结果', mainLast.content.indexOf('贝尔不等式') >= 0, mainLast.content.substring(0, 120));
    check('文本内含原始提问', mainLast.content.indexOf('这是什么？') >= 0);

    console.log('\n[5] 记账');
    var rows = db.prepare("SELECT source, model_id, prompt_tokens, completion_tokens FROM ai_usage_log WHERE conversation_id = ? ORDER BY id").all(CONV);
    var visionRows = rows.filter(function(x) { return x.source === 'vision'; });
    check('转述消耗单独记一笔 source=vision', visionRows.length === 1, rows);
    check('vision 账记在转述模型上', visionRows.length === 1 && visionRows[0].model_id === 'probe-relay', visionRows[0]);
    var chatRows = rows.filter(function(x) { return x.source === 'chat'; });
    check('对话账仍在（且含缓存拆分）', chatRows.length >= 1, rows);

    console.log('\n[6] 未配置转述 → 明确拒绝');
    appConfig.saveValues('ai-chat', { vision_relay_model: '' });
    db.prepare("UPDATE conversations SET messages_json = '[]' WHERE id = ?").run(CONV);
    return call(router, 'post', '/chat', {
      conversation_id: CONV, message: '看图', model: 'probe-text', images: [{ hash: HASH }]
    }, admin);
  }).then(function(r) {
    check('返回 400', r.status === 400, r.body);
    check('提示要配转述模型', r.body && /统一转述模型/.test(r.body.message || ''), r.body && r.body.message);

    console.log('\n[7] 越权图片 / 非法图片');
    var fakeHash = crypto.createHash('sha256').update('nope').digest('hex');
    return call(router, 'post', '/chat', {
      conversation_id: CONV, message: '看图', model: 'probe-vision', images: [{ hash: fakeHash }]
    }, admin);
  }).then(function(r) {
    check('不存在的 hash 被拒（400）', r.status === 400, r.body);
    return call(router, 'post', '/chat', {
      conversation_id: CONV, message: '看图', model: 'probe-vision', images: [{ hash: HASH }, { hash: HASH }, { hash: HASH }, { hash: HASH }, { hash: HASH }]
    }, admin);
  }).then(function(r) {
    check('超过 4 张被拒', r.status === 400 && /最多发送/.test(r.body.message || ''), r.body);

    console.log('\n[7b] 流式接口同样受图片前置校验保护');
    return call(router, 'post', '/chat/stream', {
      conversation_id: CONV, message: '看图', model: 'probe-text', images: [{ hash: HASH }]
    }, admin);
  }).then(function(r) {
    check('stream 未配转述 → 400', r.status === 400, r.body);
    return call(router, 'post', '/chat/stream', {
      conversation_id: CONV, message: '看图', model: 'probe-vision', images: [{ hash: 'not-a-hash' }]
    }, admin);
  }).then(function(r) {
    check('stream 非法图片 → 400', r.status === 400, r.body);

    console.log('\n[8] 管理端配置校验');
    return call(router, 'put', '/admin/vision', { relay_model: 'probe-text' }, admin);
  }).then(function(r) {
    check('转述模型必须自身支持视觉（400）', r.status === 400, r.body);
    return call(router, 'put', '/admin/vision', { relay_model: 'probe-relay' }, admin);
  }).then(function(r) {
    check('合法转述模型写入成功', r.status === 200 && r.body.data.relay_model === 'probe-relay', r.body);
    return call(router, 'get', '/admin/vision', {}, admin);
  }).then(function(r) {
    check('GET /admin/vision 回读一致', r.status === 200 && r.body.data.relay_model === 'probe-relay', r.body && r.body.data);
    check('GET 列出模型能力位', r.status === 200 && r.body.data.models.some(function(m) { return m.id === 'probe-vision' && m.supports_vision; }));

    console.log('\n[8b] 内置 default 模型的编辑路径冲突');
    // 历史坑：模型 id "default" 与「设为默认」的接口路径同名，编辑本体永远 404
    return call(router, 'put', '/admin/models/default', { supports_vision: true }, admin);
  }).then(function(r) {
    check('不带 body.id → 更新 default 本体（200）', r.status === 200, r.body);
    var row2 = db.prepare("SELECT supports_vision FROM ai_models WHERE id = 'default'").get();
    check('落库确实改了（supports_vision=1）', row2 && row2.supports_vision === 1, row2);
    return call(router, 'put', '/admin/models/default', { id: 'probe-vision' }, admin);
  }).then(function(r) {
    check('带 body.id → 仍是「设为默认」语义', r.status === 200, r.body);
    check('默认模型已切换', (db.prepare("SELECT id FROM ai_models WHERE is_default = 1").get() || {}).id === 'probe-vision');
    return call(router, 'put', '/admin/models/probe-vision', { supports_vision: true }, admin);
  }).then(function(r) {
    check('普通 :id 更新仍可用', r.status === 200, r.body);

    console.log('\n[9] 文件导出已下线');
    return call(router, 'get', '/conversations/' + CONV + '/export?format=md', {}, admin);
  }).then(function(r) {
    check('export 路由不存在（404）', r.status === 404 || r.missing === true, r.status);

    console.log('\n[10] 用户消息落库只存 hash');
    db.prepare("UPDATE conversations SET messages_json = '[]' WHERE id = ?").run(CONV);
    return call(router, 'post', '/chat', {
      conversation_id: CONV, message: '再看看这张', model: 'probe-vision', images: [{ hash: HASH }]
    }, admin);
  }).then(function(r) {
    var conv = db.prepare('SELECT messages_json FROM conversations WHERE id = ?').get(CONV);
    var msgs = JSON.parse(conv.messages_json);
    var userMsgs = msgs.filter(function(m) { return m.role === 'user'; });
    check('有用户消息', userMsgs.length > 0, msgs.length);
    var withImg = userMsgs.filter(function(m) { return m.images && m.images.length; })[0];
    check('图片以 hash/url 形式留存', !!withImg && withImg.images[0].hash === HASH, withImg);
    check('库里没有 base64', JSON.stringify(msgs).indexOf('base64') === -1);

    console.log('\n============================');
    console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
    console.log('============================');
    server.close();
    db.close();
    try { fs.unlinkSync(DB_TMP); } catch (e) {}
    try { fs.rmSync(TMP_RES, { recursive: true, force: true }); } catch (e) {}
    process.exit(FAIL === 0 ? 0 : 1);
  }).catch(function(e) {
    console.error('HARNESS ERROR:', e);
    server.close();
    try { fs.unlinkSync(DB_TMP); } catch (e2) {}
    process.exit(1);
  });
});
