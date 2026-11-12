import type { MarketContext, MarketAppDefinition, UiFragment } from '../../types/sdk';

declare const context: MarketContext;
declare const container: HTMLElement;

const fragment: UiFragment = context.ui.button({ label: '保存', onClick: (event: MouseEvent) => event.preventDefault() });
container.appendChild(fragment.root);
context.app.onDestroy(fragment.destroy)();
const sheet = context.ui.sheet({ content: fragment.root });
sheet.open().close();
context.ui.el('p', 'note', { text: 'Hello' });
context.ui.hostNavbar.setActions([{ id: 'save', label: '保存', onClick: () => {} }]);

context.app.onShare(data => data.text.toUpperCase());
context.theme.subscribe(id => id.toUpperCase())();
context.data.store.get<{ title: string }>('draft').then(value => value?.title.toUpperCase());
context.data.store.keys().then(keys => keys[0]?.key.toUpperCase());
context.data.store.releaseBlobUrl('blob:example');
context.device.camera().then(blob => blob.size.toFixed());
context.device.recordAudio().then(result => result.blob.size.toFixed());
context.device.recordVideo().then(result => result.hasAudio.valueOf());
context.data.realtime?.subscribe('changed', payload => void payload)();
context.data.put('/notes/1', { title: 'Draft' });

const definition: MarketAppDefinition = {
  name: 'typed-demo',
  mount(element, ctx) { element.appendChild(ctx.ui.spinner().root); },
  widgets: { clock: { mount(element, config, ctx) { element.textContent = ctx.app.name; } } }
};
window.ClassIntraMarket.define(definition);
window.ClassIntraMarket.defineOverlay({ name: 'typed-demo', mount() {} });

// @ts-expect-error fragments must be appended via .root
container.appendChild(fragment);
// @ts-expect-error a typo must not silently grant access
context.system.can('clasAdmin');
// @ts-expect-error camera returns a Blob, not an object with .blob
context.device.camera().then(result => result.blob);
