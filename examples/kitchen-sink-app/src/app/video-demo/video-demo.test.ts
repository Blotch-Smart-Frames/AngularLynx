import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderOnce } from '../../test-utils/render-once';
import { VideoDemo } from './video-demo';

let destroyDemo: (() => void) | null = null;

/**
 * Replaces the lynx global with a SelectorQuery stub that records each invoked
 * UI method, since jsdom has no native player.
 */
const stubSelectorQuery = (): string[] => {
  const methods: string[] = [];
  const query = {
    select: () => query,
    invoke: ({ method }: { method: string }) => {
      methods.push(method);
      return query;
    },
    exec: () => {},
  };
  vi.stubGlobal('lynx', { createSelectorQuery: () => query });
  return methods;
};

afterEach(() => {
  destroyDemo?.();
  destroyDemo = null;
  vi.unstubAllGlobals();
});

describe('VideoDemo', () => {
  it('renders a native video element with its source', async () => {
    const { container, destroy } = await renderOnce(VideoDemo);
    destroyDemo = destroy;
    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toContain('flower.mp4');
  });

  it('drives playback through UI methods', async () => {
    const { instance, destroy } = await renderOnce(VideoDemo);
    destroyDemo = destroy;
    const methods = stubSelectorQuery();

    instance.togglePlay();
    expect(instance.playing()).toBe(true);
    instance.togglePlay();
    expect(instance.playing()).toBe(false);
    instance.seekTo(0);
    instance.stop();

    expect(methods).toEqual(['play', 'pause', 'seek', 'stop']);
  });

  it('reports errors with and without a Lynx error payload', async () => {
    const { instance, destroy } = await renderOnce(VideoDemo);
    destroyDemo = destroy;

    instance.onError(
      new CustomEvent('error', { detail: { errorCode: 3, errorMsg: 'bad' } }),
    );
    expect(instance.status()).toBe('Error 3: bad');

    instance.onError(new Event('error'));
    expect(instance.status()).toBe('Playback failed');
  });
});
