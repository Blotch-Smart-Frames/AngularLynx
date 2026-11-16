import { Component } from '@angular/core';
import { render } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { lynxMainThread } from '../../../test-utils/lynx-main-thread';
import { UiSkeleton } from './skeleton';

/**
 * The CSS a component brings, which the build adds to the app's.
 */
const componentStyles = (component: unknown): string =>
  (component as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n');

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

  // Core Animation and Android's animators pulse it, so it keeps pulsing
  // while Angular builds a screen, which is when a skeleton shows. Lynx's own
  // animator ticks on Angular's thread, and stood still meanwhile.
  it("pulses on the platform's animator", async () => {
    const animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    const { container } = await render(SkeletonHost);
    const skeleton = container.querySelector('.bg-muted')!;
    expect(skeleton.getAttribute('enable-new-animator')).toBe('false');
    // Android animates only a view of its own.
    expect(skeleton.getAttribute('flatten')).toBe('false');
    // animate() does nothing on an element the platform animates.
    expect(animate).not.toHaveBeenCalled();
    animate.mockRestore();
  });

  it('fades to half and back every 1.5 seconds, for as long as it shows', () => {
    const css = componentStyles(UiSkeleton);
    expect(css).toMatch(
      /@keyframes ui-skeleton-pulse\s*\{\s*0%\s*\{\s*opacity:\s*1;?\s*\}\s*50%\s*\{\s*opacity:\s*0?\.5;?\s*\}\s*100%\s*\{\s*opacity:\s*1;?\s*\}/,
    );
    // The build matches `ui-skeleton` to the class the runtime gives the
    // host, so the app's classes stay its own.
    expect(css).toMatch(
      /ui-skeleton\s*\{\s*animation:\s*ui-skeleton-pulse 1500ms ease-in-out infinite;?\s*\}/,
    );
  });
});
