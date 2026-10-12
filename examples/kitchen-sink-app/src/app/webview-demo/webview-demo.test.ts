import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderOnce } from '../../test-utils/render-once';
import { WebViewDemo } from './webview-demo';

let destroyDemo: (() => void) | null = null;

afterEach(() => {
  destroyDemo?.();
  destroyDemo = null;
  vi.unstubAllGlobals();
});

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve));

describe('WebViewDemo', () => {
  it('loads a URL by default', async () => {
    const { container, destroy } = await renderOnce(WebViewDemo);
    destroyDemo = destroy;
    expect(container.querySelector('webview')?.getAttribute('src')).toBe(
      'https://angular.dev',
    );
  });

  it('switches to inline HTML', async () => {
    const { instance, container, destroy } = await renderOnce(WebViewDemo);
    destroyDemo = destroy;

    instance.select('html');
    await flush();

    const webview = container.querySelector('webview');
    expect(webview?.hasAttribute('src')).toBe(false);
    expect(webview?.getAttribute('html')).toContain('Inline HTML');
  });

  it('reloads through the reload UI method', async () => {
    const { instance, destroy } = await renderOnce(WebViewDemo);
    destroyDemo = destroy;
    const invoke = vi.fn();
    const query = { select: () => query, invoke, exec: () => {} };
    invoke.mockReturnValue(query);
    vi.stubGlobal('lynx', { createSelectorQuery: () => query });

    instance.reload();

    expect(invoke).toHaveBeenCalledWith({ method: 'reload', params: {} });
    expect(instance.status()).toBe('Reloading…');
  });
});
