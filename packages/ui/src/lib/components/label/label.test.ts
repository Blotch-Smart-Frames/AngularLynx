import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { UiLabel } from './label';

@Component({
  imports: [UiLabel],
  template: `<ui-label [disabled]="disabled()">Name</ui-label>`,
})
class LabelHost {
  readonly disabled = signal(false);
}

describe('UiLabel', () => {
  it('renders its text, dimmed while disabled', async () => {
    const { componentRef, getByText } = await render(LabelHost);
    const label = getByText('Name');
    expect(label.classList).toContain('font-medium');
    expect(label.classList).not.toContain('opacity-50');

    (componentRef.instance as LabelHost).disabled.set(true);
    await waitForUpdate();
    expect(label.classList).toContain('opacity-50');
  });
});
