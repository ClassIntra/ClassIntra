// longImage.mdToBlocks 的排版断言（Node 直接跑，不需要浏览器）
// 用法：node scripts/_test-longimage-blocks.mjs
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SRC = 'D:/NetWork/Integration/ClassIntra/apps/ai-chat/frontend/longImage.js';
const TMP = 'D:/NetWork/Integration/ClassIntra/scripts/_longimage-tmp.mjs';
writeFileSync(TMP, readFileSync(SRC, 'utf8'), 'utf8');
const { mdToBlocks } = await import(pathToFileURL(TMP).href);
unlinkSync(TMP);

let PASS = 0, FAIL = 0;
const check = (n, c, e) => { if (c) { PASS++; console.log('  ✓ ' + n); } else { FAIL++; console.log('  ✗ ' + n + (e !== undefined ? ' → ' + JSON.stringify(e) : '')); } };

console.log('\n[A] 表格：分隔行必须消失');
const table = '## 对比\n\n| 定律 | 内容 | 解决的问题 |\n| --- | :---: | --- |\n| 第一定律 | 惯性 | 定义参考系 |\n| 第二定律 | F=ma | 定量计算 |\n\n结尾一段。';
const tb = mdToBlocks(table);
const allLines = tb.filter(b => b.type === 'text').map(b => b.text).join('\n').split('\n');
console.log('  块:', JSON.stringify(tb.map(b => b.type)));
check('没有残留的 --- 行', !allLines.some(l => /^[\s\-:|]+$/.test(l) && l.includes('-')), allLines);
check('表格三行内容都在', ['定律', '第一定律', '第二定律'].every(k => allLines.some(l => l.includes(k))), allLines);
check('没有连续空行', !/\n\s*\n/.test(tb.filter(b => b.type === 'text').map(b => b.text).join('\n')));

console.log('\n[B] 代码块 / 标题 / 列表 / 粗体');
const rich = '## 思路\n\n**加粗**与*斜体*还有`行内代码`。\n\n- 第一点\n- 第二点\n\n```python\nprint("hi")\n```\n\n1. 有序一\n2. 有序二';
const rb = mdToBlocks(rich);
const code = rb.filter(b => b.type === 'code');
const txt = rb.filter(b => b.type === 'text').map(b => b.text).join('\n');
console.log('  块:', JSON.stringify(rb.map(b => b.type)));
check('认出一个代码块', code.length === 1, code);
check('代码内容不带语言行', code[0] && code[0].text.trim() === 'print("hi")', code[0]);
check('标题井号被去掉', txt.includes('思路') && !txt.includes('#'), txt);
check('粗体标记被去掉', txt.includes('加粗') && !txt.includes('**'), txt);
check('无序列表变 ·', txt.includes('· 第一点'), txt);
check('有序列表保留编号', txt.includes('1. 有序一'), txt);

console.log('\n[C] 分割线与空输入');
check('--- 单独成段识别为 hr', mdToBlocks('a\n\n---\n\nb').some(b => b.type === 'hr'));
check('空字符串不产出块', mdToBlocks('').length === 0);
check('纯空白不产出块', mdToBlocks('   \n\n  ').length === 0);
check('代码块里的 --- 不被吃掉', (function () {
  const b = mdToBlocks('```\na --- b\n```');
  return b.length === 1 && b[0].type === 'code' && b[0].text.includes('---');
})());

console.log('\n============================');
console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
console.log('============================');
process.exit(FAIL === 0 ? 0 : 1);
