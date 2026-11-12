import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run real browser modules, adapting imports only. Each keeps its own scope.
export function loadMarketSdk(globals = {}) {
  const sandbox = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, URL, ...globals });
  function load(relativePath, imports = {}) {
    const file = new URL('../../src/' + relativePath, import.meta.url);
    const source = readFileSync(file, 'utf8')
      .replace(/^import .*;\r?$/gm, '')
      .replace(/export\s*\{([\s\S]*?)\};?\s*$/, 'return {$1};');
    const names = Object.keys(imports);
    return new vm.Script('(function(' + names.join(',') + ') {\n' + source + '\n})', { filename: file.pathname })
      .runInContext(sandbox)(...Object.values(imports));
  }
  const ui = load('core/market-sdk-ui.js');
  const tokens = load('core/token-injector.js');
  const navbar = load('core/app-navbar-store.js');
  const events = load('core/event-bus.js', { ClassIntraError: { fromUnknown: value => value }, ERROR_CODES: {} });
  const search = load('core/search-registry.js', {
    APP_REGISTRY: [], marketRegistry: { getInstalledApps: () => [] },
    getDefaultStore: () => ({ get: () => null, set: () => true })
  });
  const requests = load('core/market-sdk-request.js');
  const sdk = load('core/market-sdk.js', {
    ...ui, ...tokens, ...requests, navbarStore: navbar
  });
  return { ...sdk, EventEmitter: events.EventEmitter, SearchRegistry: search.SearchRegistry, ui, sandbox };
}
