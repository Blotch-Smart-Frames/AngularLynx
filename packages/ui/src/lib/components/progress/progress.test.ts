import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiProgress } from './progress';

@Component({
  standalone: true,
  imports: [UiProgress, LYNX_ELEMENTS],
  template: `<ui-progress [value]="value" [indeterminate]="indeterminate" />`,
})
class ProgressHost {
  value = 40;
  indeterminate = false;
}

describe('UiProgress', () => {
  it('renders at the given value', async () => {
    const { container } = await render(ProgressHost);
    expect(container).toBeTruthy();
  });

  it('renders indeterminate mode without throwing', async () => {
    @Component({
      standalone: true,
      imports: [UiProgress, LYNX_ELEMENTS],
      template: `<ui-progress [indeterminate]="true" />`,
    })
    class IndeterminateHost {}
    const { container } = await render(IndeterminateHost);
    expect(container).toBeTruthy();
  });

  it('scales the fill width by the value/max ratio', async () => {
    // JIT template bindings are inert against input(); drive the signals so
    // the percent/fillStyle computed signals actually run.
    const { componentRef, container } = await render(UiProgress);
    setInputSignal((componentRef.instance as UiProgress).value, 25);
    setInputSignal((componentRef.instance as UiProgress).max, 100);
    await waitForUpdate();
    const fill = container.querySelectorAll('view')[1];
    expect(fill?.getAttribute('style')).toContain('width: 25%');
  });

  it('clamps the fill to 100% when the value exceeds max', async () => {
    const { componentRef, container } = await render(UiProgress);
    setInputSignal((componentRef.instance as UiProgress).value, 500);
    setInputSignal((componentRef.instance as UiProgress).max, 100);
    await waitForUpdate();
    const fill = container.querySelectorAll('view')[1];
    expect(fill?.getAttribute('style')).toContain('width: 100%');
  });

  it('clamps the fill to 0% when max is zero (division safety)', async () => {
    const { componentRef, container } = await render(UiProgress);
    setInputSignal((componentRef.instance as UiProgress).value, 50);
    setInputSignal((componentRef.instance as UiProgress).max, 0);
    await waitForUpdate();
    const fill = container.querySelectorAll('view')[1];
    expect(fill?.getAttribute('style')).toContain('width: 0%');
  });

  it('uses the fixed 40% fill width when indeterminate is true', async () => {
    const { componentRef, container } = await render(UiProgress);
    setInputSignal(
      (componentRef.instance as UiProgress).indeterminate,
      true,
    );
    await waitForUpdate();
    const fill = container.querySelectorAll('view')[1];
    expect(fill?.getAttribute('style')).toContain('width: 40%');
  });
});
