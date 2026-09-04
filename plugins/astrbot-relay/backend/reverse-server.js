const WebSocket = require('ws');
const axios = require('axios');
const http = require('http');
const PORT = Number(process.env.ASTRBOT_REVERSE_PORT || 10111);
const BOT_ID = process.env.ASTRBOT_REVERSE_BOT_ID || 'astrbot-linxi';
const botApi = process.env.ASTRBOT_API || 'http://127.0.0.1:6200';
const apiKey = process.env.ASTRBOT_API_KEY || '';
const server = http.createServer();
const wss = new WebSocket.Server({ server });
let bot = null;
const pending = new Map();
function sendChat(userId, result) {
  const chain = result && Array.isArray(result.message_chain) ? result.message_chain : [];
  let texts = chain.filter(x => x && x.type === 'plain' && x.text).map(x => x.text);
  if (!texts.length && result && result.reply) texts = [result.reply];
  return texts;
}
wss.on('connection', ws => {
  if (bot && bot.readyState === WebSocket.OPEN) bot.close(4000, 'replaced');
  bot = ws;
  ws.on('message', raw => {
    let p; try { p = JSON.parse(raw); } catch (_) { return; }
    if (p.type === 'hello') return;
    if (p.type === 'chat_response' && p.request_id) {
      const item = pending.get(p.request_id); if (!item) return;
      pending.delete(p.request_id); item.resolve(p.data || {});
    }
  });
  ws.on('close', () => { if (bot === ws) bot = null; });
  ws.send(JSON.stringify({ type: 'hello', bot_id: BOT_ID, protocol: 1 }));
});
function sendRequest(request) {
  return new Promise((resolve, reject) => {
    if (!bot || bot.readyState !== WebSocket.OPEN) return reject(new Error('Bot reverse client offline'));
    const requestId = require('crypto').randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Bot response timeout')); }, 120000);
    pending.set(requestId, { resolve: x => { clearTimeout(timer); resolve(x); }, reject });
    bot.send(JSON.stringify({ type: 'chat_request', request_id: requestId, data: request }));
  });
}
server.listen(PORT, '0.0.0.0', () => console.log(`[astrbot-reverse] listening on ${PORT}`));
module.exports = { sendRequest, sendChat, status: () => ({ connected: !!bot && bot.readyState === WebSocket.OPEN, port: PORT }) };
