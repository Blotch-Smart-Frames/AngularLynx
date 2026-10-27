import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { lynxMainThread } from '../../../test-utils/lynx-main-thread';
import { type BadgeVariant, UiBadge, badgeVariants } from './badge';

@Component({
  imports: [UiBadge],
  template: `
    <ui-badge [variant]="variant()" [animated]="animated()" class="ml-1">
      Status
    </ui-badge>
  `,
})
class BadgeHost {
  readonly variant = signal<BadgeVariant>('default');
  readonly animated = signal(true);
}

/**
 * The keyframes of the animations started on `element`.
 */
const keyframesOn = (calls: [Element, unknown[]][], element: Element) =>
  calls
    .filter(([target, [operation]]) => target === element && operation === 0)
    .map(([, args]) => args[2]);

describe('badgeVariants', () => {
  it('returns default variant classes', () => {
    expect(badgeVariants()).toContain('bg-primary');
  });

  it('returns each explicit variant', () => {
    expect(badgeVariants({ variant: 'secondary' })).toContain('bg-secondary');
    expect(badgeVariants({ variant: 'destructive' })).toContain(
      'bg-destructive',
    );
    expect(badgeVariants({ variant: 'outline' })).toContain('border');
  });
});

describe('UiBadge', () => {
  it('renders its label in the variant colors', async () => {
    const { componentRef, getByText } = await render(BadgeHost);
    const label = getByText('Status');
    expect(label.classList).toContain('text-primary-foreground');
    expect(label.parentElement?.classList).toContain('bg-primary');
    expect(label.parentElement?.classList).toContain('ml-1');

    (componentRef.instance as BadgeHost).variant.set('outline');
    await waitForUpdate();
    expect(label.classList).toContain('text-foreground');
    expect(label.parentElement?.classList).toContain('border-border');
  });

  it('pops in on first render', async () => {
    const animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    const { getByText } = await render(BadgeHost);
    const badge = getByText('Status').parentElement!;
    expect(keyframesOn(animate.mock.calls, badge)).toEqual([
      [
        { transform: 'scale(0.6)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ],
    ]);
    animate.mockRestore();
  });

  it("doesn't animate when animated is off", async () => {
    @Component({
      imports: [UiBadge],
      template: `<ui-badge [animated]="false">Status</ui-badge>`,
    })
    class StillBadgeHost {}

    const animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    const { getByText } = await render(StillBadgeHost);
    expect(
      keyframesOn(animate.mock.calls, getByText('Status').parentElement!),
    ).toEqual([]);
    animate.mockRestore();
  });
});
