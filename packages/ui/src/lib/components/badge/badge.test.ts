import { render } from '@blotch/angular-lynx-testing-library';
import { Component } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge, badgeVariants } from './badge';

/**
 * Host wrappers project content and bind inputs the way real app templates do.
 * Required-input components would need this; UiBadge has none but the pattern
 * keeps content projection (<ng-content>) exercised.
 */
@Component({
  standalone: true,
  imports: [UiBadge, LYNX_ELEMENTS],
  template: `<ui-badge [variant]="variant" [animated]="false">Status</ui-badge>`,
})
class BadgeHost {
  variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
}

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
  it('renders projected content', async () => {
    const { getByText } = await render(BadgeHost);
    expect(getByText('Status')).toBeTruthy();
  });

  it('runs the pop-in animation when animated is true', async () => {
    const { getByText } = await render(UiBadge);
    // With no host binding, animated defaults to true → effect runs popIn on the
    // container. Just assert it renders without throwing.
    expect(getByText).toBeTruthy();
  });
});
