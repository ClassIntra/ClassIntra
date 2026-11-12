import type { PluginError, StreamRelay, TicketKit, TicketStore, PluginHost } from '../../types/backend';

declare const PluginErrorConstructor: import('../../types/backend').PluginErrorConstructor;
declare const createTicketKit: import('../../types/backend').BackendRelay['createTicketKit'];
declare const createRelay: import('../../types/backend').BackendRelay['createRelay'];
declare const store: TicketStore;
declare const host: PluginHost;

const error: PluginError = new PluginErrorConstructor(400, '参数错误');
error.code.toFixed();

const tickets: TicketKit<{ userId: string; songId: string }> = createTicketKit(store, 'demo:');
const ticket = tickets.create({ userId: 'u1', songId: 's1' }, 1000);
const payload = tickets.verify(ticket);
payload?.songId.toUpperCase();

const relay: StreamRelay = createRelay({
  getConfig: () => ({ proxy: '', audioCache: '0', cacheDir: '' }),
  imageHostAllow: /example\.invalid$/
});
void relay;

// 宿主能力门面：require('_sdk/backend/host') 的类型形状
const rows = host.db.prepare('SELECT 1').all();
void rows;
declare const req: Record<string, unknown>;
declare const res: unknown;
host.auth.requireAuth(req, res, () => {});
const missing = host.appConfig.getValue('demo-app', 'API_KEY', '');
void missing;
host.appData.kvSet('demo-app', 'u1', 'note', { text: 'hi' });
void host.ledger;

// @ts-expect-error host has no such stable namespace
host.notARealNamespace;
// @ts-expect-error a ticket payload is not an arbitrary string
tickets.create('wrong');
// @ts-expect-error status code must be numeric
new PluginErrorConstructor('400', '参数错误');
