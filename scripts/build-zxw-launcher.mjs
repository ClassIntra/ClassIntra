#!/usr/bin/env node
/*
 * ZXW 启动页构建器：launcher.src.html（不入库）→ launcher.html（入库）
 *
 * 保密模型：一次性密钥（OTP）。
 *   - 构建时用 crypto.randomBytes 生成与明文等长的真随机填充流，对 BODY/JS 做 XOR；
 *   - 密文（Base64）写入入库产物 launcher.html；
 *   - 填充流写入 server/config/zxw-boot.json（.gitignore，不入库），
 *     由服务端在响应启动页时注入（window.__P1/__P2）。
 *   - 仓库静态产物不含密钥 ⇒ 无论算力（含 AI）多大，都无法从仓库单独还原明文。
 *
 * 注意：每次构建都会重新生成填充流并覆盖旧产物与密钥文件（OTP 密钥永不复用）。
 * 产物自检：round-trip 解码比对 + 解码后 JS 语法预检。
 * 用法：node scripts/build-zxw-launcher.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '../server/public/zxw/launcher.src.html');
const OUT = join(here, '../server/public/zxw/launcher.html');
const BOOT = join(here, '../server/config/zxw-boot.json');

function cut(s, a, b) {
  const i = s.indexOf(a), j = s.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('marker missing: ' + a);
  return s.slice(i + a.length, j);
}
function xorB64(bytes, pad) {
  const c = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) c[i] = bytes[i] ^ pad[i];
  return c.toString('base64');
}
function unxorB64(b64, padB64) {
  const c = Buffer.from(b64, 'base64');
  const p = Buffer.from(padB64, 'base64');
  const o = Buffer.alloc(c.length);
  for (let i = 0; i < c.length; i++) o[i] = c[i] ^ p[i];
  return o.toString('utf8');
}

const src = readFileSync(SRC, 'utf8');
const head = cut(src, '<!--HEAD-->', '<!--/HEAD-->').trim();
const body = cut(src, '<!--BODY-->', '<!--/BODY-->').trim();
const js = cut(src, '/*JS-START*/', '/*JS-END*/').trim();

// 解码后 JS 语法预检（防把坏产物提交进仓库）
const tmpJs = join(tmpdir(), 'zxw-launcher-check.js');
writeFileSync(tmpJs, js);
const chk = spawnSync(process.execPath, ['--check', tmpJs], { encoding: 'utf8' });
if (chk.status !== 0) throw new Error('JS 语法检查失败:\n' + (chk.stderr || chk.stdout));

const bodyBuf = Buffer.from(body, 'utf8');
const jsBuf = Buffer.from(js, 'utf8');

// 一次性填充流：与「body+js」明文等长，绝不复用
const pad = randomBytes(bodyBuf.length + jsBuf.length);
const padBody = pad.subarray(0, bodyBuf.length);
const padJs = pad.subarray(bodyBuf.length);

const B = xorB64(bodyBuf, padBody);
const J = xorB64(jsBuf, padJs);
const padBodyB64 = padBody.toString('base64');
const padJsB64 = padJs.toString('base64');

// round-trip 自检
if (unxorB64(B, padBodyB64) !== body || unxorB64(J, padJsB64) !== js) {
  throw new Error('round-trip 校验失败');
}

const out = `<!doctype html>
<html lang="zh-CN">
<head>
${head}
</head>
<body>
<div id="r"></div>
<script>window.__P1="__ZXW_PAD1__";window.__P2="__ZXW_PAD2__";</script>
<script>
(function(){
var r=document.getElementById('r');
try{
  var p1=window.__P1||'',p2=window.__P2||'';
  if(!p1||!p2||p1.indexOf('__')===0||p2.indexOf('__')===0){
    r.textContent='启动密钥未部署（server/config/zxw-boot.json 缺失，请在本机重新构建启动页）';
    return;
  }
  var c1=atob('${B}'),c2=atob('${J}');
  var b1=atob(p1),b2=atob(p2);
  if(b1.length<c1.length||b2.length<c2.length){
    r.textContent='启动密钥与产物不匹配（请在本机重新构建启动页）';
    return;
  }
  function dx(c,p){
    var s='';
    for(var i=0;i<c.length;i++)s+=String.fromCharCode(c.charCodeAt(i)^p.charCodeAt(i));
    try{return decodeURIComponent(escape(s))}catch(e){return s}
  }
  r.innerHTML=dx(c1,b1);
  (new Function(dx(c2,b2)))();
}catch(e){
  r.textContent='启动失败: '+e;
}
})();
</script>
</body>
</html>
`;
writeFileSync(OUT, out);

writeFileSync(BOOT, JSON.stringify({
  _note: 'ZXW 启动页一次性填充流（不入库）。与 launcher.html 内密文配对；重新构建即轮换。',
  builtAt: new Date().toISOString(),
  pad1: padBodyB64,
  pad2: padJsB64
}, null, 2));

console.log('[zxw-build] launcher.html 已生成（OTP）: head=' + head.length + 'B(明文), body=' + bodyBuf.length + 'B→' + B.length + 'B, js=' + jsBuf.length + 'B→' + J.length + 'B, 填充流 ' + pad.length + 'B → zxw-boot.json（不入库）');
