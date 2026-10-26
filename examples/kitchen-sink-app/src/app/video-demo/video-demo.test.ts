import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderOnce } from '../../test-utils/render-once';
import { VideoDemo } from './video-demo';

let destroyDemo: (() => void) | null = null;

afterEach(() => {
  destroyDemo?.();
  destroyDemo = null;
  vi.restoreAllMocks();
});

describe('VideoDemo', () => {
  it('renders a native video element with its source', async () => {
    const { container, destroy } = await renderOnce(VideoDemo);
    destroyDemo = destroy;
    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toContain('flower.mp4');
  });

  it('drives playback through UI methods on the video element', async () => {
    const { instance, destroy } = await renderOnce(VideoDemo);
    destroyDemo = destroy;
    // jsdom has no native player, so record the calls instead.
    const invoke = vi.spyOn(instance.player().nativeElement, 'invoke');

    instance.togglePlay();
    expect(instance.playing()).toBe(true);
    instance.togglePlay();
    expect(instance.playing()).toBe(false);
    instance.seekTo(0);
    instance.stop();

    expect(invoke.mock.calls).toEqual([
      ['play', {}],
      ['pause', {}],
      ['seek', { position: 0 }],
      ['stop', {}],
    ]);
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
