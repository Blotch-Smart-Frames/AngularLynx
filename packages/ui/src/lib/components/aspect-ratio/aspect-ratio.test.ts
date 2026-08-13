import { render } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { UiAspectRatio } from './aspect-ratio';

describe('UiAspectRatio', () => {
  it('renders with the default 1:1 ratio', async () => {
    const { container } = await render(UiAspectRatio);
    expect(container).toBeTruthy();
  });
});
