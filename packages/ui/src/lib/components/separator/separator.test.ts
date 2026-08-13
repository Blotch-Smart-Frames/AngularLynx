import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiSeparator } from './separator';

describe('UiSeparator', () => {
  it('renders horizontally (default)', async () => {
    const { componentRef } = await render(UiSeparator);
    // The class binding lands on the host element, which is the component's
    // location.nativeElement (a real DOM node representing the ui-separator
    // host). Read the class directly from that node.
    const host = componentRef.location.nativeElement as HTMLElement;
    expect(host.getAttribute('class')).toContain('h-px');
  });

  it('renders vertically when the orientation input is flipped', async () => {
    const { componentRef } = await render(UiSeparator);
    setInputSignal(
      (componentRef.instance as UiSeparator).orientation,
      'vertical',
    );
    await waitForUpdate();
    const host = componentRef.location.nativeElement as HTMLElement;
    expect(host.getAttribute('class')).toContain('w-px');
  });
});
