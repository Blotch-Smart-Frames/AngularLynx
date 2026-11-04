import { render } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { DemoScreen } from './demo-screen';

describe('DemoScreen', () => {
  it('shows the heading, category and description it is given', async () => {
    const { getByText } = await render(DemoScreen, {
      inputs: {
        heading: 'Buttons',
        category: 'Inputs',
        description: 'Every variant and size.',
      },
    });

    expect(getByText('Buttons')).toBeTruthy();
    expect(getByText('Inputs')).toBeTruthy();
    expect(getByText('Every variant and size.')).toBeTruthy();
  });

  it('hides the category badge when the category is empty', async () => {
    const { queryByText, rerender } = await render(DemoScreen, {
      inputs: { heading: 'Buttons', category: 'Inputs' },
    });

    await rerender({ inputs: { category: '' } });

    expect(queryByText('Inputs')).toBeNull();
  });
});
