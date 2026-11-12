/** Type declarations only. Runtime modules are provided by the host plugin SDK. */
export interface PluginError extends Error {
  code: number;
  cause: unknown;
}
export interface PluginErrorConstructor {
  new(code: number, message: string, cause?: unknown): PluginError;
}
export interface BackendErrors {
  PluginError: PluginErrorConstructor;
  isNetworkError(error: unknown): boolean;
}
export interface TicketStore {
  cacheSet(key: string, payload: unknown, ttlMs: number): unknown;
  cacheGet(key: string): { fresh: boolean; payload: unknown } | null;
}
/** verify reads a short-lived ticket; it does not consume or revoke the ticket. */
export interface TicketKit<T = unknown> {
  create(payload: T, ttlMs?: number): string;
  verify(ticket: string | null | undefined): T | null;
}
export interface RelayConfig {
  proxy?: string;
  audioCache?: string;
  audioCacheMaxMB?: string | number;
  cacheDir?: string;
}
export interface HeaderBag { [name: string]: string | string[] | undefined; }
export interface ReadableLike {
  on(event: string, listener: (...args: any[]) => void): this;
  pipe<T>(destination: T): T;
}
export interface IncomingLike { headers: HeaderBag; }
export interface ResponseLike {
  writeHead(statusCode: number, headers?: HeaderBag): this;
  end(data?: string | Uint8Array): this;
}
export interface UpstreamResponse {
  status: number;
  headers: HeaderBag;
  stream: ReadableLike;
}
export interface RelayAudioOptions {
  resolveStreamUrl(songId: string, quality: string, userId: string | number | null): Promise<{ url: string } | null> | { url: string } | null;
  songId: string | number;
  quality?: string;
  userId?: string | number | null;
}
export interface RelayOptions {
  getConfig?: () => RelayConfig;
  imageHostAllow?: RegExp;
  imageHeaders?: HeaderBag;
  audioMime?: string;
}
export interface StreamRelay {
  streamAudio(request: IncomingLike, response: ResponseLike, options: RelayAudioOptions): Promise<void | ResponseLike>;
  streamImage(request: IncomingLike, response: ResponseLike, imageUrl: string): Promise<void | ResponseLike>;
}
export interface BackendRelay {
  createTicketKit<T = unknown>(store: TicketStore, prefix?: string): TicketKit<T>;
  createRelay(options?: RelayOptions): StreamRelay;
  fetchRaw(url: string, headers?: HeaderBag, proxyUrl?: string): Promise<UpstreamResponse>;
  httpGetJson<T = unknown>(url: string, proxyUrl?: string): Promise<T>;
  proxyConnect(proxyUrl: string, targetHost: string, targetPort: number): Promise<unknown>;
}

// ============================================================
// 宿主能力门面：require('_sdk/backend/host') 的形状
// ============================================================
// 第三方后端引用宿主能力一律通过这个稳定门面（NODE_PATH 已注入 plugins/ 目录），
// 禁止直连 ../../../server/src/... 内部路径或 process.cwd() 解析——devkit check 会拦。
// 各命名空间的具体成员以宿主源码为准；这里声明的是跨版本稳定的入口形状。

/** better-sqlite3 句柄的最小契约（与宿主同一连接） */
export interface HostDb {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): unknown;
  transaction<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
}

export interface HostAuth {
  requireAuth(req: unknown, res: unknown, next: () => void): void;
  requireAdmin(req: unknown, res: unknown, next: () => void): void;
}

/** manifest.config 声明的配置读取（DB → env → default 三级回退） */
export interface HostAppConfig {
  getValue(appName: string, key: string, fallback?: string): string;
  getConfigStatus(appName: string, schema: unknown[]): { configured: boolean; missingRequired: string[] };
}

/** KV + blob 存储（按 app + 用户隔离；HTTP 面 /api/app-data/*） */
export interface HostAppData {
  kvGet(app: string, owner: string, key: string): unknown;
  kvSet(app: string, owner: string, key: string, value: unknown): unknown;
  usage(app: string): { kvBytes: number; blobBytes: number };
  purgeApp(app: string): unknown;
}

/** 学元账本应用 API：唯一登记的第三方经济入口（只能碰 PRACTICE 资产） */
export interface HostLedger {
  [method: string]: ((...args: never[]) => unknown) | undefined;
}

/**
 * require('_sdk/backend/host') 的返回形状。
 * 未列出的成员（cache/time/constants/jwt/password/realtimeBus/relayBus/appEvents/
 * appScheduler/yuanbao/weather/errors/relay）随宿主版本提供，见宿主 plugins/_sdk/backend/host.js。
 */
export interface PluginHost {
  db: HostDb;
  auth: HostAuth;
  appConfig: HostAppConfig;
  appData: HostAppData;
  ledger: HostLedger;
  errors: BackendErrors;
  relay: BackendRelay;
}
