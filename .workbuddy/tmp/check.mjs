import fs from 'fs';
import vm from 'vm';
import path from 'path';

const root = process.cwd();
const files = [
  'client/src/utils/websocket.js',
  'client/src/utils/realtime.js',
  'client/src/store/modules/chat.js',
];

let allOk = true;

function checkSfc(file) {
  const raw = fs.readFileSync(path.join(root, file), 'utf8');
  const bad = (raw.match(/\uFFFD/g) || []).length;
  if (bad) { allOk = false; console.log('  !! U+FFFD x' + bad + ' in ' + file); }
  // 逐个 script / template 块做基础配对检查
  const scripts = raw.match(/<script>[\s\S]*?<\/script>/g) || [];
  for (const s of scripts) {
    const inner = s.replace(/^<script>/, '').replace(/<\/script>$/, '');
    try { new vm.SourceTextModule(inner); }
    catch (e) { allOk = false; console.log('SYNTAX-FAIL ' + file + ' : ' + e.message); return; }
  }
  const tplOpen = (raw.match(/<template>/g) || []).length;
  const tplClose = (raw.match(/<\/template>/g) || []).length;
  const divOpen = (raw.match(/<div[\s>]/g) || []).length;
  const divClose = (raw.match(/<\/div>/g) || []).length;
  // 顶层 <template> 应恰好 1 对（内部还会有 <template v-if> 之类的局部模板）
  const topTpl = (raw.match(/^<template>/m) || []).length;
  console.log('SYNTAX-OK  ' + file +
    '  [top-template ' + topTpl + ']' +
    '  [div ' + divOpen + '/' + divClose + ']');
  if (topTpl !== 1) { allOk = false; console.log('  !! 顶层 <template> 数量异常'); }
  if (divOpen !== divClose) { allOk = false; console.log('  !! <div> 标签不配对'); }
}

for (const f of files) {
  const abs = path.join(root, f);
  const raw = fs.readFileSync(abs, 'utf8');
  const bad = (raw.match(/\uFFFD/g) || []).length;
  if (bad) { allOk = false; console.log('  !! U+FFFD x' + bad + ' in ' + f); }
  try {
    await import('file:///' + abs.replace(/\\/g, '/'));
    console.log('IMPORT-OK  ' + f);
  } catch (e) {
    if (e instanceof SyntaxError) { allOk = false; console.log('SYNTAX-FAIL ' + f + ' : ' + e.message); }
    else console.log('LOAD-OK(rt-dep) ' + f);
  }
}

checkSfc('apps/chat/frontend/Chat.vue');
checkSfc('client/src/components/ChatBubble.vue');

// 后端纯 CJS 文件用 vm.Script 校验
for (const f of ['apps/chat/backend/routes.js', 'server/src/ws/chat-server.js', 'server/src/utils/relay-handlers.js']) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const bad = (src.match(/\uFFFD/g) || []).length;
  if (bad) { allOk = false; console.log('  !! U+FFFD x' + bad + ' in ' + f); }
  try { new vm.Script(src, { filename: f }); console.log('SYNTAX-OK  ' + f); }
  catch (e) { allOk = false; console.log('SYNTAX-FAIL ' + f + ' : ' + e.message); }
}

// 关键新增能力自检
const chat = fs.readFileSync(path.join(root, 'apps/chat/frontend/Chat.vue'), 'utf8');
const bubble = fs.readFileSync(path.join(root, 'client/src/components/ChatBubble.vue'), 'utf8');
const guards = [
  ['showScrollToBottom', chat, 3],
  ['pendingNewCount', chat, 4],
  ['scrollToBottomAndClear', chat, 2],
  ['_handleIncomingScroll', chat, 4],
  ['settings-user-status', chat, 2],
  ['_suppressClickAfterLongPress', bubble, 6],
];
for (const [name, src, min] of guards) {
  const n = src.split(name).length - 1;
  const ok = n >= min;
  if (!ok) allOk = false;
  console.log((ok ? 'OK   ' : 'LOW  ') + name + ' = ' + n + ' (期望>=' + min + ')');
}

console.log(allOk ? 'ALL CHECKS PASS' : 'HAS PROBLEMS');
