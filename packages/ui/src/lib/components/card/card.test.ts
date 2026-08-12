import { Component } from '@angular/core';
import { render } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { UiCard } from './card';

@Component({
  standalone: true,
  imports: [UiCard, LYNX_ELEMENTS],
  template: `<ui-card><text>Body</text></ui-card>`,
})
class CardHost {}

describe('UiCard', () => {
  it('renders projected content', async () => {
    const { getByText } = await render(CardHost);
    expect(getByText('Body')).toBeTruthy();
  });

  it('renders without a host wrapper', async () => {
    const { container } = await render(UiCard);
    expect(container).toBeTruthy();
  });
});
