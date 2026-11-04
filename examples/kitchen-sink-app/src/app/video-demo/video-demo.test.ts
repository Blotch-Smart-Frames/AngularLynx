import { fireEvent } from '@blotch/angular-lynx-testing-library';
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

  it('reports errors with their code and message', async () => {
    const { container, instance, destroy } = await renderOnce(VideoDemo);
    destroyDemo = destroy;

    fireEvent.error(container.querySelector('video')!, {
      detail: { errorCode: 3, errorMsg: 'bad' },
    });
    expect(instance.status()).toBe('Error 3: bad');
  });
});
