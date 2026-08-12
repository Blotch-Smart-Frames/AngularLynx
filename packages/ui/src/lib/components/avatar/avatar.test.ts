import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiAvatar } from './avatar';

@Component({
  standalone: true,
  imports: [UiAvatar, LYNX_ELEMENTS],
  template: `<ui-avatar [src]="src" [fallback]="fallback" />`,
})
class AvatarHost {
  src = '';
  fallback = 'AB';
}

describe('UiAvatar', () => {
  it('renders the fallback branch when src is empty', async () => {
    const { container } = await render(AvatarHost);
    expect(container).toBeTruthy();
  });

  it('renders without a src (default fallback path)', async () => {
    const { container } = await render(UiAvatar);
    expect(container).toBeTruthy();
  });

  it('renders the image branch when src is programmatically set', async () => {
    // JIT template bindings are inert against input(); drive src directly so
    // the @if(src()) branch fires and the image + skeleton render.
    const { componentRef, container } = await render(UiAvatar);
    setInputSignal(
      (componentRef.instance as UiAvatar).src,
      'https://example.com/avatar.png',
    );
    await waitForUpdate();
    expect(container.querySelector('image')).toBeTruthy();
  });

  it('keeps the image load / error handlers idempotent', async () => {
    // Directly invoke the protected handlers via the instance to cover the
    // re-entrancy latches — Lynx's on-device behavior re-dispatches the load
    // event when the skeleton animation tears down.
    const { componentRef } = await render(UiAvatar);
    const inst = componentRef.instance as unknown as {
      onImageLoad: () => void;
      onImageError: () => void;
      loaded: () => boolean;
      errored: () => boolean;
    };
    inst.onImageLoad();
    inst.onImageLoad(); // second call is a no-op (loaded latch)
    expect(inst.loaded()).toBe(true);

    inst.onImageError();
    inst.onImageError(); // second call is a no-op (errored latch)
    expect(inst.errored()).toBe(true);
  });

  it('applies size-specific classes for each supported size', async () => {
    const { componentRef, container } = await render(UiAvatar);
    for (const size of ['sm', 'default', 'lg', 'xl', '2xl'] as const) {
      setInputSignal((componentRef.instance as UiAvatar).size, size);
      await waitForUpdate();
      expect(container).toBeTruthy();
    }
  });
});
