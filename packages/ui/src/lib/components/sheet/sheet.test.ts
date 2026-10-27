import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import {
  UiSheet,
  UiSheetDescription,
  UiSheetFooter,
  UiSheetHeader,
  UiSheetTitle,
} from './sheet';

@Component({
  imports: [
    UiSheet,
    UiSheetHeader,
    UiSheetTitle,
    UiSheetDescription,
    UiSheetFooter,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-sheet [(open)]="open" class="gap-4" (closed)="closed()">
      <ui-sheet-header class="items-center">
        <ui-sheet-title class="text-xl">Title</ui-sheet-title>
        <ui-sheet-description class="italic">Body</ui-sheet-description>
      </ui-sheet-header>
      <ui-sheet-footer class="flex-row"><text>Buttons</text></ui-sheet-footer>
    </ui-sheet>
  `,
})
class SheetHost {
  readonly open = signal(false);
  readonly closed = vi.fn();
}

const renderSheet = async () => {
  const result = await render(SheetHost);
  return {
    ...result,
    host: result.componentRef.instance as SheetHost,
    overlay: result.container.querySelector('overlay')!,
    backdrop: result.container.querySelector('overlay > view')!,
  };
};

/**
 * Opens the sheet and waits out its open sequence: the overlay shows on one
 * tick, and the panel slides in on the next.
 */
const openSheet = async (host: SheetHost) => {
  host.open.set(true);
  for (let i = 0; i < 3; i++) await waitForUpdate();
};

describe('UiSheet', () => {
  it('renders header, title, description, and footer', async () => {
    const { getByText } = await renderSheet();
    expect(getByText('Title')).toBeTruthy();
    expect(getByText('Body')).toBeTruthy();
    expect(getByText('Buttons')).toBeTruthy();
  });

  it("merges each part's class with its own", async () => {
    const { container, getByText } = await renderSheet();
    // The sheet's class goes on the padded content wrapper, not the panel.
    expect(container.querySelector('.px-6')?.classList).toContain('gap-4');
    expect(container.querySelector('.mb-4')?.classList).toContain(
      'items-center',
    );
    expect(getByText('Title').classList).toContain('text-xl');
    expect(getByText('Title').classList).toContain('font-semibold');
    expect(getByText('Body').classList).toContain('italic');
    expect(getByText('Body').classList).toContain('text-muted-foreground');
    expect(container.querySelector('.pt-4')?.classList).toContain('flex-row');
  });

  it('opens with `open`, and reports a dismissal through it and `closed`', async () => {
    const { host, overlay, backdrop } = await renderSheet();
    expect(overlay.getAttribute('visible')).toBe('false');

    await openSheet(host);
    expect(overlay.getAttribute('visible')).toBe('true');

    fireEvent.tap(backdrop);
    expect(host.open()).toBe(false);
    // Once the panel has slid out, the overlay hides and `closed` fires.
    await vi.waitFor(() => expect(host.closed).toHaveBeenCalled());
    await waitForUpdate();
    expect(overlay.getAttribute('visible')).toBe('false');
    expect(host.closed).toHaveBeenCalledOnce();
  });
});
