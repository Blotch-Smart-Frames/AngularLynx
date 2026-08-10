// Shim for @lynx-js/web-core/client — the actual runtime is loaded via a
// pre-built <script> tag (see rspress.config.ts). This module just waits
// for the <lynx-view> custom element to be registered before resolving,
// so go-web's ensureRuntime() doesn't proceed until the element is ready.
await customElements.whenDefined('lynx-view');
