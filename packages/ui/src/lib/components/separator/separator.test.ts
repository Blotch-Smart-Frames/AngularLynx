import { render } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { UiSeparator } from './separator';

describe('UiSeparator', () => {
  it('renders horizontally (default)', async () => {
    const { container } = await render(UiSeparator);
    expect(container).toBeTruthy();
  });
});
