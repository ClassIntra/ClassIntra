// 宿主版本兼容常量与比较（minHostVersion 校验用）
// KNOWN_HOST_VERSION：随宿主发版同步更新（scripts/version.js 发版时记得改这里）。
// 高于该值的声明只告警不拦截——可能是在为未发布版本开发。

export const KNOWN_HOST_VERSION = '1.7.0';

// x.y.z 数值比较（忽略前导 v 与预发布后缀）；a > b → 1，相等 → 0，a < b → -1
export function compareSemver(a, b) {
  const pa = String(a || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}
