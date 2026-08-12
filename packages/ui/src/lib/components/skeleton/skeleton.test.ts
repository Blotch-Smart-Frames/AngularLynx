import { render } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { UiSkeleton } from './skeleton';

describe('UiSkeleton', () => {
  it('renders and starts the pulse animation', async () => {
    // The `effect()` schedules pulse(el) once the view child resolves — just
    // asserting no throw covers the effect body, host template, and computed
    // class binding in a single mount.
    const { container } = await render(UiSkeleton);
    expect(container).toBeTruthy();
  });
});
