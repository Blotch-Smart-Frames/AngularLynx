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

  // A class on a component lands on its host too (issue #181): the host is
  // the placeholder, so its size is set once.
  it('is one element, with the class written on it', async () => {
    const { container } = await render(SkeletonHost);
    expect(container.querySelectorAll('.h-4')).toHaveLength(1);
    expect(container.querySelector('.h-4')?.classList).toContain('bg-muted');
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
