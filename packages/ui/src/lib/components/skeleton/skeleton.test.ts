import { Component } from '@angular/core';
import { render } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { lynxMainThread } from '../../../test-utils/lynx-main-thread';
import { UiSkeleton } from './skeleton';

@Component({
  imports: [UiSkeleton],
  template: `<ui-skeleton class="h-4 w-32" />`,
})
class SkeletonHost {}

describe('UiSkeleton', () => {
  it('renders a muted placeholder with the given class', async () => {
    const { container } = await render(SkeletonHost);
    const skeleton = container.querySelector('.bg-muted');
    expect(skeleton?.classList).toContain('h-4');
    expect(skeleton?.classList).toContain('w-32');
  });

  it('pulses', async () => {
    const animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    const { container } = await render(SkeletonHost);
    expect(animate).toHaveBeenCalledWith(
      container.querySelector('.bg-muted'),
      expect.any(Array),
    );
    animate.mockRestore();
  });
});
