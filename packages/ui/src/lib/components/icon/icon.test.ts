import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiIcon } from './icon';
import { ICONS, type IconName } from './icons';

@Component({
  standalone: true,
  imports: [UiIcon, LYNX_ELEMENTS],
  template: `<ui-icon [name]="name" [size]="size" [color]="color" />`,
})
class IconHost {
  name: IconName = 'check';
  size: 'xs' | 'sm' | 'md' | 'lg' = 'md';
  color?: string;
}

describe('UiIcon', () => {
  it('renders the requested icon at default size', async () => {
    const { container } = await render(IconHost);
    expect(container).toBeTruthy();
  });

  it('applies the size input to the width/height style', async () => {
    // JIT template bindings are inert against `input()` — drive the signals
    // directly so sizeStyle and svgContent both re-run.
    const { componentRef, container } = await render(UiIcon);
    setInputSignal((componentRef.instance as UiIcon).name, 'check' as IconName);
    setInputSignal((componentRef.instance as UiIcon).size, 'xs');
    await waitForUpdate();
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('style')).toContain('16px');
  });

  it('substitutes currentColor with the color input value', async () => {
    const { componentRef, container } = await render(UiIcon);
    setInputSignal((componentRef.instance as UiIcon).name, 'check' as IconName);
    setInputSignal(
      (componentRef.instance as UiIcon).color,
      'rgb(255, 0, 0)',
    );
    await waitForUpdate();
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('content')).toContain('rgb(255, 0, 0)');
    expect(svg?.getAttribute('content')).not.toContain('currentColor');
  });
});

describe('ICONS registry', () => {
  it('exports at least one icon', () => {
    expect(Object.keys(ICONS).length).toBeGreaterThan(0);
  });
});
