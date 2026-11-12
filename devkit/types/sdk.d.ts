/**
 * ClassIntra 市场应用 SDK 类型定义（frontend / market-apps 专用）
 *
 * 市场应用（market-apps/<name>/）的前端是原生 ES module，由宿主注入 context 对象——
 * 这是第三方应用与宿主交互的【唯一编程接口】。本文件给出完整类型，供 TS 开发者
 * `/// <reference path="..." />` 引用或直接复制进项目，编辑器即可获得完整补全。
 *
 * 实现源码：client/src/core/market-sdk.js（七大命名空间）+ market-registry.js（生命周期）
 * 权威类型入口：classintra-devkit/sdk；运行时由宿主注入，不需浏览器 import。
 *
 * 命名空间总览：
 *   context.ui      —— 预制 iOS 风格 DOM 片段（返回 UiFragment，不是裸 DOM）
 *   context.data    —— 数据能力（api / realtime / websocket / channels / storage / store）
 *   context.system  —— 系统能力（user / role / can / router / toast / modal / clipboard / share / 搜索收录）
 *   context.device  —— 设备能力（info / filePicker / camera / recordAudio / recordVideo / vibrate / network / screen）
 *   context.theme   —— 主题便捷层（current / getToken / subscribe）
 *   context.app     —— 应用自身（name / version / manifest / config / assetUrl / log / onDestroy / onPause / onResume）
 *   context.compat  —— 兼容探测（chromeVersion / isX5 / has / isBelowBaseline）
 *
 * 注意：context 顶层的 api/websocket/route/router/user/modal 等是 v1 兼容别名（TODO: v2 移除），
 * 新代码一律走命名空间路径（如 context.data.api、context.system.router）。
 */

// ============================================================
// 一、应用入口定义（window.ClassIntraMarket.define 的参数）
// ============================================================

/**
 * 市场应用入口定义。entry.js 末尾调用：
 *   window.ClassIntraMarket.define(definition)
 *
 * 契约：资源回收必须在 context.app.onDestroy 中登记（宿主卸载时会先调它，
 * 再调 definition.unmount，最后做容器级计时器/监听器审计回收）。
 */
export interface MarketAppDefinition {
  /** 应用名，必须与 manifest.json 的 name（即目录名）一致 */
  name: string;
  /**
   * 挂载：宿主把容器 DOM 与 SDK context 交给应用。
   * 应用应在 container 内自建 DOM 并自行绑事件。
   */
  mount(container: HTMLElement, context: MarketContext): void;
  /** 可选卸载：移除容器内容、解绑容器级事件（onDestroy 已覆盖大部分场景） */
  unmount?(container: HTMLElement): void;
  widgets?: Record<string, {
    mount(container: HTMLElement, config: Record<string, unknown>, context: MarketContext): void;
    unmount?(container: HTMLElement): void;
  }>;
}

/** 全局注册表（entry.js 加载完成即应调用 define） */
declare global {
  interface Window {
    ClassIntraMarket: {
      /** 注册应用入口（entry.js 顶层调用一次） */
      define(definition: MarketAppDefinition): MarketAppDefinition;
      defineOverlay(definition: MarketAppDefinition): MarketAppDefinition;
      /** 已注册的定义表（只读用途） */
      apps: Record<string, MarketAppDefinition>;
    };
  }
}

// ============================================================
// 二、manifest 类型（context.app.manifest）
// ============================================================

/** 应用 manifest（市场应用安装后由 market-service 提供的运行时视图） */
export interface AppManifest {
  /** kebab-case 唯一标识，与目录名一致 */
  name: string;
  type: 'app' | 'system';
  /** 语义化版本 x.y.z */
  version: string;
  /** 显示名（桌面上展示） */
  label: string;
  description?: string;
  author?: string;
  /** 图标路径（./ 开头的相对路径由宿主重写为 /market-static/<name>/...） */
  icon?: string;
  /** 主题色（hex） */
  color?: string;
  category?: 'desktop' | 'system' | 'hidden';
  /** 桌面排序权重，越小越靠前（默认 99） */
  order?: number;
  defaultEnabled?: boolean;
  canDisable?: boolean;
  /** 能力披露清单（安装前告知用户） */
  capabilities?: string[];
  /**
   * 版式：fullscreen / sheet / window
   * navbar: 'custom' 表示隐藏宿主导航栏（此时 context.ui.hostNavbar 无效）
   */
  layout?: { mode?: 'fullscreen' | 'sheet' | 'window'; navbar?: 'default' | 'custom'; [key: string]: unknown };
  frontend?: {
    route: string;
    routeName?: string;
    /** 原生 ES module 入口 */
    entry?: string;
    /** 样式表（可选） */
    style?: string;
    static?: string;
    overlay?: string;
    widgets?: Array<{ id: string; name: string; defaultSize?: { w: number; h: number }; [key: string]: unknown }>;
  };
  backend?: {
    mountPath: string;
    entry: string;
    /**
     * ⚠️ 慎用：平台限流键是 req.ip + path，全校/全班多为同一 NAT 出口，
     * 开限流后一个班会把彼此一起锁死。并发控制请在应用自己的后端做。
     */
    rateLimit?: { max: number; windowMs: number; message?: string };
  };
  /** 应用自定义配置（context.app.config 读取处） */
  config?: Record<string, unknown> | Array<{ key: string; label?: string; type?: string; default?: unknown; [key: string]: unknown }>;
  [key: string]: unknown;
}

// ============================================================
// 三、SDK Context
// ============================================================

/** 路由目标：字符串路径或 Vue Router location 对象 */
export type RouteLocation = string | { path?: string; name?: string; params?: Record<string, string>; query?: Record<string, string | number | null | undefined> };

/** 模态选项（context.system.modal / toast 共用） */
export interface ModalOptions {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
}

/** 角色层级（由低到高）；can('officer') 表示「至少是班干」 */
export type AppRole = 'guest' | 'student' | 'officer' | 'admin' | 'classAdmin';

/**
 * UI 片段（context.ui.* 的统一返回值）。
 *
 * ⚠️ 这里返回的不是裸 DOM 节点，而是 { root, update, destroy }。
 * 要挂到页面上请用 parent.appendChild(fragment.root)。
 * 老代码把返回值当元素用，运行时会静默失败 —— 这是本类型文件修正过的最大坑。
 */
export interface UiFragment {
  /** 片段根节点（唯一可插入 DOM 的入口） */
  root: HTMLElement;
  /** 原地更新：回调里改 root 的子节点，不会重建片段 */
  update(fn: (root: HTMLElement) => void): void;
  /** 销毁：内部监听全部解绑，并把 root 从父节点移除 */
  destroy(): void;
}

/** 底部抽屉片段：比 UiFragment 多 open/close */
export interface UiSheetFragment {
  root: HTMLElement;
  destroy(): void;
  open(): UiSheetFragment;
  close(): void;
}

export interface UiAction { label?: string; icon?: string; onClick?: (event: MouseEvent) => void; }
export interface UiButtonOptions extends UiAction { variant?: 'filled' | 'tinted' | 'plain' | 'destructive'; size?: 'sm' | 'md' | 'lg'; disabled?: boolean; }
export interface UiNavbarOptions { title?: string; subtitle?: string; back?: UiAction; actions?: UiAction[]; }
export interface UiSheetOptions { title?: string; message?: string; content?: Node | string; actions?: Array<{ label: string; variant?: 'destructive' | 'plain'; onClick?: () => boolean | void }>; onClose?: () => void; }

/** 应用内上下文（mount 的第二个参数） */
export interface MarketContext {
  /** 应用名（与 manifest.name 一致） */
  appName: string;
  /** SDK 契约版本（当前 '1'） */
  version: string;

  // ---- context.ui：预制 iOS 风格 DOM 片段（实现见 client/src/core/market-sdk-ui.js） ----
  ui: {
    button(options?: UiButtonOptions): UiFragment;
    card(options?: { title?: string; subtitle?: string; padded?: boolean; content?: Node | string }): UiFragment;
    list(options?: { items?: Array<UiAction & { title?: string; subtitle?: string; value?: string | number; chevron?: boolean }> }): UiFragment;
    badge(options?: { text?: string; variant?: 'default' | 'success' | 'warning' | 'danger' }): UiFragment;
    segmented<T = string>(options?: { segments?: Array<{ label: string; value: T }>; value?: T; onChange?: (value: T) => void }): UiFragment;
    toggle(options?: { checked?: boolean; label?: string; onChange?: (checked: boolean, event: Event) => void }): UiFragment;
    searchBar(options?: { placeholder?: string; value?: string; onInput?: (value: string, event: Event) => void; onSearch?: (value: string, event: KeyboardEvent) => void }): UiFragment;
    emptyState(options?: { icon?: string; title?: string; description?: string; actionLabel?: string; onAction?: (event: MouseEvent) => void }): UiFragment;
    spinner(options?: { text?: string }): UiFragment;
    toast(options?: { text?: string; variant?: 'default' | 'success' | 'warning' | 'danger' }): UiFragment;
    sectionTitle(options?: { text?: string }): UiFragment;
    toolbar(options?: { items?: Array<UiAction & { active?: boolean }> }): UiFragment;
    /** 应用自己页面里的顶部导航栏 */
    navbar(options?: UiNavbarOptions): { root: HTMLElement; destroy(): void; update(fn: (value: { title: string; subtitle: string }) => { title?: string; subtitle?: string }): void };
    /** 底部抽屉（对标 UIBottomSheet） */
    sheet(options?: UiSheetOptions): UiSheetFragment;
    /** 底层工具：创建元素并批量设置属性/子节点 */
    el(tag: string, className?: string, attrs?: Record<string, unknown>): HTMLElement;
    /** 确保片段样式表已注入（一般不用手动调） */
    ensureStyles(): void;
    /**
     * 把内容注入「宿主」的统一导航栏（区别于 ui.navbar——那是在应用自己页面里画）。
     * 前提：manifest.layout.navbar 不是 'custom'。卸载时宿主自动 clear。
     */
    hostNavbar: {
      setTitle(title: string): void;
      /** 状态段 DOM 注入标题右侧（如「轮到黑方 · 红方」），节点仍归应用所有 */
      setStatus(element: HTMLElement | null): void;
      setActions(actions: Array<{ id?: string; label?: string; icon?: string; variant?: 'plain' | 'tinted' | 'danger'; disabled?: boolean; element?: HTMLElement; onClick?: () => void }>): void;
      clear(): void;
    };
  };

  // ---- context.data：数据能力 ----
  data: {
    /** 宿主 axios 实例（自动带登录态与统一错误处理） */
    api: ApiClient | null;
    /** 全局实时总线（与宿主共用一条连接；X5 等环境自动降级为 HTTP 长轮询） */
    realtime: RealtimeChannel | null;
    /** WebSocket 连接（与宿主共用） */
    websocket: HostWebSocket | null;
    /**
     * 频道：多人房间 / 大世界 / 对局室的定向实时通道。
     * 房间名自动补前缀成 app:<appName>:<room>，应用之间天然隔离；
     * 全局 realtime 是广播（全校都能收），需要「只发给同一房间的人」时一律用这里。
     */
    channels: ChannelsApi;
    /**
     * 隔离存储：所有键自动加 'ci:app:<appName>:' 前缀，避免与宿主/其他应用冲突；
     * 值自动 JSON 序列化；get 的 fallback 在键不存在时返回
     */
    storage: {
      /** 命名空间前缀（供诊断） */
      prefix: string;
      get<T = unknown>(key: string, fallback?: T): T | null;
      set(key: string, value: unknown): boolean;
      remove(key: string): boolean;
      keys(): string[];
      /** 清空本应用全部键，返回清除数量 */
      clear(): number;
    };
    /**
     * 服务端存储（跟账号走，换设备/重装都能取回）：
     * 与 storage 的分工 —— storage 是本机缓存，store 是服务端数据
     */
    store: StoreApi;
    /** 便捷 GET：等价 data.api.get（api 不可用时 reject） */
    get(url: string, options?: Record<string, unknown>): Promise<any>;
    /** 便捷 POST：等价 data.api.post（api 不可用时 reject） */
    post(url: string, body?: unknown, options?: Record<string, unknown>): Promise<any>;
    /** 便捷 PUT */
    put(url: string, body?: unknown, options?: Record<string, unknown>): Promise<any>;
    /** 便捷 PATCH */
    patch(url: string, body?: unknown, options?: Record<string, unknown>): Promise<any>;
    /** 便捷 DELETE */
    delete(url: string, options?: Record<string, unknown>): Promise<any>;
  };

  // ---- context.system：系统能力 ----
  system: {
    /** 当前登录用户（响应式 getter，未登录为 null；字段见后端 user 表） */
    readonly user: {
      user_id?: string | number;
      id?: string | number;
      net_name?: string;
      [key: string]: unknown;
    } | null;
    /** 当前角色（响应式 getter） */
    readonly role: AppRole;
    /**
     * 角色判定：can('officer') = 「至少是班干」。
     * 层级 classAdmin > admin > officer > student > guest。
     * ⚠️ 前端判定只用于「显不显示入口」，真正的权限必须由后端再判一次。
     */
    can(role: AppRole): boolean;
    /** 是否已登录 */
    readonly isLoggedIn: boolean;
    /** 当前路由（响应式 getter） */
    readonly route: { path: string; params: Record<string, string>; query: Record<string, string> } | null;
    /** Vue Router 实例（应用内跳转/返回桌面） */
    router: {
      push(location: RouteLocation): Promise<void>;
      [key: string]: unknown;
    } | null;
    /** 主题引擎（读取当前 token） */
    theme: unknown | null;
    /** 读取设计令牌（token-injector 收集的 CSS 变量值） */
    getToken(name: string): string;
    /** 宿主事件总线（订阅自动归属 market:<appName>，卸载时整批退订） */
    eventBus: {
      emit(event: string, payload?: unknown): void;
      on(event: string, fn: (payload: any) => void): () => void;
      once(event: string, fn: (payload: any) => void): () => void;
      off(event: string, fn: (payload: any) => void): boolean;
      listenerCount(event: string): number;
    } | null;
    /** 提示三件套（内部走 modal，缺失时安全降级 resolve） */
    toast: {
      alert(options: ModalOptions): Promise<boolean>;
      confirm(options: ModalOptions): Promise<boolean>;
      prompt(options: ModalOptions): Promise<string | null>;
    };
    /** 模态框（原生 Promise 返回） */
    modal: {
      alert(options: ModalOptions): Promise<boolean>;
      confirm(options: ModalOptions): Promise<boolean>;
      prompt(options: ModalOptions): Promise<string | null>;
      [key: string]: unknown;
    } | null;
    /**
     * 系统通知（capability: system.notification）。
     * 前台走宿主 Toast，后台走系统通知；用户拒绝授权时降级为 Toast 而不是 reject。
     */
    notify(title: string, body?: string): Promise<{ channel: string; denied?: boolean }>;
    /** 剪贴板（capability: system.clipboard / system.clipboard.read） */
    clipboard: {
      write(text: string): Promise<{ ok: boolean; method: string }>;
      read(): Promise<{ text: string; method: string }>;
    };
    /** 分享（capability: system.share）：系统面板 → 宿主应用面板 → 复制，逐级降级 */
    share(data: { text?: string; url?: string; title?: string }): Promise<{ channel: 'share' | 'app' | 'clipboard' | 'none' | 'cancelled'; app?: string; error?: string }>;
    /** 桌面角标（capability: system.badge），传 0 / '' / null 清除 */
    setBadge(value: number | string | null): boolean;
    /** 打开另一个应用（capability: system.openApp），params 作为 query 传给目标 */
    openApp(name: string, params?: Record<string, unknown>): Promise<unknown>;
    /**
     * 搜索收录（capability: system.search）：让应用内容出现在全局搜索里。
     * 返回注销函数；卸载时自动注销。
     */
    registerSearchProvider(provider: {
      id?: string;
      category?: string;
      search(query: string): SearchItem[] | Promise<SearchItem[]>;
    }): () => void;
    /** 返回桌面（应用内提供「退出」入口时使用） */
    goDesktop(): void;
    /** 跳转路由（等价 router.push，router 缺失时安全 no-op） */
    navigate(location: RouteLocation): Promise<void>;
  };

  // ---- context.device：设备能力 ----
  device: {
    /** 设备信息（只报浏览器能自报的字段，不猜硬件） */
    info(): {
      platform: 'android' | 'ios' | 'windows' | 'mac' | 'linux' | string;
      viewport: { width: number; height: number };
      dpr: number;
      ua: string;
      online: boolean;
    };
    /** 选文件（capability: device.filePicker）；取消返回空列表 */
    filePicker(options?: { accept?: string; multiple?: boolean; capture?: string }): Promise<File[]>;
    /** 拍照（capability: device.camera），返回 Blob */
    camera(options?: { facingMode?: string; width?: number; height?: number; maxWidth?: number; type?: string; quality?: number }): Promise<Blob>;
    /** 录音（capability: device.microphone）：返回 { blob, duration, mimeType } */
    recordAudio(options?: { maxDuration?: number; mimeType?: string }): Promise<MediaResult>;
    /** 录像（capability: device.camera [+ device.microphone]）：返回 { blob, duration, mimeType, hasAudio } */
    recordVideo(options?: { maxDuration?: number; mimeType?: string; audio?: boolean; facingMode?: string; width?: number; height?: number }): Promise<MediaResult & { hasAudio: boolean }>;
    /** 触觉反馈（不支持时静默返回 false） */
    vibrate(pattern?: number | number[]): boolean;
    /** 网络状态 */
    network(): {
      online: boolean;
      type: string;
      downlinkMbps: number | null;
      rttMs: number | null;
      saveData: boolean;
    };
    /** 屏幕信息 */
    screen(): { width: number; height: number; dpr: number; orientation: 'portrait' | 'landscape' | 'unknown' };
  };

  // ---- context.theme：主题便捷层 ----
  theme: {
    /** 当前主题 id（响应式 getter） */
    readonly current: string;
    /** 读设计令牌（等价 system.getToken） */
    getToken(name: string): string;
    /** 订阅主题变化，返回退订函数 */
    subscribe(fn: (themeId: string, payload: Record<string, unknown>) => void): () => void;
    [key: string]: unknown;
  };

  // ---- context.app：应用自身 ----
  app: {
    name: string;
    version: string;
    /** 应用 manifest（运行时视图） */
    manifest: AppManifest | null;
    /** manifest.config 中的自定义配置 */
    config: NonNullable<AppManifest['config']>;
    /**
     * 注册清理函数（契约优于约定）：应用卸载时自动调用（逆序、幂等）；
     * 计时器/监听器/WebSocket 分片等一律在此登记，否则会被宿主审计器强制回收。
     * 返回退订函数 —— 临时挂的清理（某个面板用完即弃）可以自己撤销。
     */
    onDestroy(fn: () => void): () => void;
    /**
     * 应用静态资源 URL：assetUrl('frontend/logo.png')
     *   → /market-static/<appName>/frontend/logo.png
     * 目录名由平台分配，不要硬编 /market-static/<名字>/（换名/被 fork 就整片 404）。
     */
    assetUrl(relativePath: string): string;
    /** 统一前缀日志（[app:<name>]） */
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    /** 页面切到后台 / 回到前台（返回退订函数） */
    onPause(fn: () => void): () => void;
    onResume(fn: () => void): () => void;
    /** 接收分享（需 manifest 声明 shareTarget）；返回退订函数 */
    onShare(fn: (data: { title: string; text: string; url: string; from: string }) => void): () => void;
  };

  // ---- context.compat：兼容探测 ----
  compat: {
    /** Chrome 主版本（X5 内核按 MQQBrowser 推断；未知为 0） */
    chromeVersion: number;
    /** 是否腾讯 X5/TBS 内核 */
    isX5: boolean;
    /**
     * 能力探测。常用键：'flex-gap'（Chrome 84+）/ 'backdrop-filter' / 'webp' /
     * 'container-query' / 'clipboard' / 'resize-observer' / 'intersection-observer' /
     * 'passive-events' / 'css-vars' / 'local-storage'
     */
    has(name: string): boolean;
    /** 低于 80 基线（建议给出降级提示） */
    isBelowBaseline: boolean;
  };

  // ---- v1 兼容别名（TODO: v2 移除，新代码不要依赖） ----
  /** @deprecated 用 context.data.api */
  readonly api: ApiClient | null;
  /** @deprecated 用 context.data.websocket */
  readonly websocket: HostWebSocket | null;
  /** @deprecated 用 context.data.realtime */
  readonly realtime: RealtimeChannel | null;
  /** @deprecated 用 context.data.realtime */
  readonly realtimeEvents: RealtimeChannel | null;
  /** @deprecated 原始宿主 Vuex store；应用数据请使用 context.data.store */
  readonly store: unknown | null;
  /** @deprecated 用 context.system.route */
  readonly route: MarketContext['system']['route'];
  /** @deprecated 用 context.system.router */
  readonly router: MarketContext['system']['router'];
  /** @deprecated 用 context.system.user */
  readonly user: MarketContext['system']['user'];
  /** @deprecated 用 context.system.eventBus */
  readonly eventBus: MarketContext['system']['eventBus'];
  /** @deprecated 用 context.system.toast */
  readonly toast: MarketContext['system']['toast'];
  /** @deprecated 用 context.system.modal */
  readonly modal: MarketContext['system']['modal'];
}

// ============================================================
// 四、频道（context.data.channels）
// ============================================================

/**
 * 频道 API：按房间定向投递的实时通道（多人房间 / 大世界 / 对局室）。
 *
 * 与 realtime 的区别：realtime 的 publish 是「全校广播」，channel 的 publish 只发给
 * 同一房间的成员。房间名由应用自己起（如 'world' / 'room:abc'），平台自动补
 * app:<appName>: 前缀，应用之间不可能串台。
 *
 * 约束（服务端强制）：单用户最多 64 个频道，单频道最多 300 人；成员关系是内存态，
 * 服务重启即清空 —— 所以 join 必须幂等，应用重连/刷新后无脑再 join 一次。
 */
export interface ChannelsApi {
  /** 加入房间（幂等，重连/刷新/从后台回来都可以再调一次） */
  join(room: string): Promise<{ channel: string; members: number }>;
  /** 离开房间（幂等，不在房里也 resolve） */
  leave(room: string): Promise<unknown>;
  /** 房间内广播：只有成员能发，非成员 403。返回 { delivered: number } */
  publish(room: string, event: string, payload?: unknown): Promise<{ delivered: number }>;
  /**
   * 订阅房间事件，返回退订函数；已自动挂到 app.onDestroy，忘了退订也不会泄漏。
   * event 传 '' / undefined 表示收该房间的所有事件。
   */
  subscribe(room: string, event: string | undefined, handler: (payload: any, message?: unknown) => void): () => void;
  /** 房间与在线人数（不暴露成员 ID） */
  members(room: string): Promise<{ channel: string; count: number }>;
  /** 完整频道名（调试/日志用）：nameOf('world') → 'app:shiguang:world' */
  nameOf(room: string): string;
}

// ============================================================
// 五、服务端存储（context.data.store）
// ============================================================

/** 服务端 KV 与文件（按「应用 + 用户」隔离，登录即可取回，换设备不丢） */
export interface StoreApi {
  /** 读键；不存在返回 null（不抛 404） */
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<boolean>;
  remove(key: string): Promise<boolean>;
  keys(): Promise<Array<{ key: string; updatedAt: number }>>;
  /** 一次取回全部（应用启动时同步用） */
  all(): Promise<Record<string, unknown>>;
  listBlobs(): Promise<BlobMetadata[]>;
  /** 上传文件，返回服务端记录 */
  uploadBlob(name: string, file: Blob | File, mime?: string): Promise<BlobMetadata>;
  /** 取文件可访问 URL（自动 revoke 由宿主在卸载时统一处理） */
  getBlobUrl(name: string): Promise<string>;
  /** 仅撤销由当前 context 创建的 URL；销毁时仍会自动兜底撤销 */
  releaseBlobUrl(url: string): boolean;
  deleteBlob(name: string): Promise<boolean>;
}

// ============================================================
// 六、底层客户端（宽松类型：宿主 axios 封装，返回体已含统一 code 字段）
// ============================================================

/** 宿主 API 客户端（axios 封装；响应为后端统一 { code, message, data? } 结构） */
export interface ApiClient {
  get(url: string, config?: Record<string, unknown>): Promise<any>;
  post(url: string, body?: unknown, config?: Record<string, unknown>): Promise<any>;
  put(url: string, body?: unknown, config?: Record<string, unknown>): Promise<any>;
  patch(url: string, body?: unknown, config?: Record<string, unknown>): Promise<any>;
  delete(url: string, config?: Record<string, unknown>): Promise<any>;
}

/** 实时事件通道（宿主推送总线；on 返回解绑函数） */
export interface RealtimeChannel {
  on(event: string, fn: (payload: any) => void): () => void;
  off(event: string, fn: (payload: any) => void): void;
  subscribe(event: string, fn: (payload: any, message?: unknown) => void): () => void;
  publish(event: string, payload?: unknown, appName?: string): Promise<unknown>;
  isReady(): boolean;
  getConnectionState(): unknown;
  [key: string]: unknown;
}

export interface HostWebSocket {
  send(message: unknown): unknown;
  on(event: string, handler: (...args: any[]) => void): unknown;
  off(event: string, handler: (...args: any[]) => void): void;
  isReady(): boolean;
  [key: string]: unknown;
}

/** duration 的单位是毫秒 */
export interface MediaResult { blob: Blob; duration: number; mimeType: string; }
export interface SearchItem { id?: string; title: string; description?: string; icon?: string; iconColor?: string; action?: () => void; }
export interface BlobMetadata { id: string; name: string; mime: string; size: number; created_at?: number; }
