// alias-loader 的 resolve 钩子：
//   1. @shared/xxx → <repo>/shared/src/xxx(.js)
//   2. 相对导入无扩展名时补 .js 重试（Vite 允许、裸 Node 不允许）
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';

var sharedSrc = pathResolve(fileURLToPath(new URL('../shared/src', import.meta.url)));

export async function resolve(specifier, context, next) {
  if (specifier.indexOf('@shared/') === 0) {
    var rest = specifier.slice('@shared/'.length);
    if (!/\.(js|mjs|json)$/.test(rest)) rest += '.js';
    return next(pathToFileURL(pathResolve(sharedSrc, rest)).href, context);
  }
  if ((specifier.indexOf('./') === 0 || specifier.indexOf('../') === 0) && !/\.(js|mjs|json|css|svg|vue)$/.test(specifier)) {
    try {
      return await next(specifier, context);
    } catch (e) {
      return next(specifier + '.js', context);
    }
  }
  return next(specifier, context);
}
