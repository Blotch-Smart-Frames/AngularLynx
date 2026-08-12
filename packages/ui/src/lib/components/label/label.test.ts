import { Component } from '@angular/core';
import { render } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { UiLabel } from './label';

@Component({
  standalone: true,
  imports: [UiLabel, LYNX_ELEMENTS],
  template: `<ui-label [disabled]="disabled">{{ label }}</ui-label>`,
})
class LabelHost {
  disabled = false;
  label = 'Name';
}

@Component({
  standalone: true,
  imports: [UiLabel, LYNX_ELEMENTS],
  template: `<ui-label [disabled]="true">Off</ui-label>`,
})
class DisabledLabelHost {}

describe('UiLabel', () => {
  it('renders projected text', async () => {
    const { getByText } = await render(LabelHost);
    expect(getByText('Name')).toBeTruthy();
  });

  it('renders when disabled (applies opacity)', async () => {
    const { getByText } = await render(DisabledLabelHost);
    expect(getByText('Off')).toBeTruthy();
  });
});
