import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { UiSeparator } from './separator';

@Component({
  imports: [UiSeparator],
  template: `<ui-separator [orientation]="orientation()" class="my-2" />`,
})
class SeparatorHost {
  readonly orientation = signal<'horizontal' | 'vertical'>('horizontal');
}

describe('UiSeparator', () => {
  it('draws a horizontal line by default, and a vertical one when asked', async () => {
    const { componentRef, container } = await render(SeparatorHost);
    // The classes are on the host element, the separator's only element.
    const line = container.querySelector('.bg-border')!;
    expect(line.classList).toContain('h-px');
    expect(line.classList).toContain('my-2');
    // One element: a static class lands on the host, so a view inside it
    // would take it twice (issue #181).
    expect(container.querySelectorAll('.my-2')).toHaveLength(1);

    (componentRef.instance as SeparatorHost).orientation.set('vertical');
    await waitForUpdate();
    expect(line.classList).toContain('w-px');
    expect(line.classList).not.toContain('h-px');
  });
});
