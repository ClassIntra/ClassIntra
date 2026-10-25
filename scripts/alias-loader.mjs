// 裸 Node 跑 client 核心模块测试用的路径解析钩子（供 scripts/*-smoke.mjs 使用）
// 把 Vite 别名 @shared/* 映射到 shared/src/*。
// 用法：node --import ./scripts/alias-loader.mjs your-test.mjs
import { register } from 'node:module';

register(new URL('./alias-resolve.mjs', import.meta.url).href);
