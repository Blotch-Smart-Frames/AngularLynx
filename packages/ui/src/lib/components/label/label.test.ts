import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiLabel } from './label';

@Component({
  standalone: true,
  imports: [UiLabel, LYNX_ELEMENTS],
  template: `<ui-label>{{ label }}</ui-label>`,
})
class LabelHost {
  label = 'Name';
}

describe('UiLabel', () => {
  it('renders projected text', async () => {
    const { getByText } = await render(LabelHost);
    expect(getByText('Name')).toBeTruthy();
  });

  it('renders standalone with no host wrapper (default disabled=false)', async () => {
    const { container } = await render(UiLabel);
    const textEl = container.querySelector('text');
    expect(textEl?.getAttribute('class')).toContain('font-medium');
  });

  it('applies opacity when disabled flips to true', async () => {
    // JIT template bindings don't wire signal inputs — drive the input
    // directly to exercise the `disabled() && 'opacity-50'` truthy branch.
    const { componentRef, container } = await render(UiLabel);
    setInputSignal((componentRef.instance as UiLabel).disabled, true);
    await waitForUpdate();
    const textEl = container.querySelector('text');
    expect(textEl?.getAttribute('class')).toContain('opacity-50');
  });
});
