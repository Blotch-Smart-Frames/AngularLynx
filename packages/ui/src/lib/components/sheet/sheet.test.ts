import { Component, type WritableSignal, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type SheetDetent, UiSheetSource } from '../bottom-sheet/bottom-sheet';
import { UiGlass } from '../glass/glass';
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

/**
 * A glass sheet presented by a glass button, which comes first, as a button
 * above the sheet does.
 */
@Component({
  imports: [UiSheet, UiSheetSource, UiGlass, LYNX_ELEMENTS],
  template: `
    <blur-view ui-glass class="source" [uiSheetSource]="sheet">
      <text>Add</text>
    </blur-view>
    <ui-sheet #sheet variant="glass" [(open)]="open">
      <text>Body</text>
    </ui-sheet>
  `,
})
class SourceHost {
  readonly open = signal(false);
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
const openSheet = async (host: { readonly open: WritableSignal<boolean> }) => {
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

@Component({
  imports: [UiSheet, LYNX_ELEMENTS],
  template: `
    <ui-sheet
      [(open)]="open"
      variant="glass"
      [detents]="['medium', 'large']"
      [(detent)]="detent"
    >
      <text>Body</text>
    </ui-sheet>
  `,
})
class GlassSheetHost {
  readonly open = signal(false);
  readonly detent = signal<SheetDetent | undefined>(undefined);
}

describe('UiSheet glass variant', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes the variant and the detents to its bottom sheet', async () => {
    vi.stubGlobal('SystemInfo', { platform: 'iOS', osVersion: '26.0' });
    const { componentRef, container, getByText } = await render(GlassSheetHost);
    const host = componentRef.instance as GlassSheetHost;
    // A sheet with heights of its own lets its content fill it.
    expect(getByText('Body').parentElement?.classList).toContain('flex-1');

    // Laid out as on a phone, which the medium and large detents need.
    const backdrop = container.querySelector('overlay > view')!;
    fireEvent.layoutchange(backdrop, { detail: { height: 874 } });
    fireEvent.layoutchange(backdrop.firstElementChild!, {
      detail: { height: 812 },
    });
    await openSheet(host);
    expect(
      container.querySelector('blur-view')?.getAttribute('blur-effect'),
    ).toBe('glass');
    expect(host.detent()).toBe('medium');

    // The grabber moves it to the next detent, and the host hears of it.
    const grabber = container.querySelector('overlay .rounded-full')!;
    fireEvent.tap(grabber.parentElement!, { eventType: 'catchEvent' });
    await waitForUpdate();
    expect(host.detent()).toBe('large');
  });
});

describe('UiSheet grown out of its control', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hands the control on to its bottom sheet, which pairs their glass', async () => {
    vi.stubGlobal('SystemInfo', { platform: 'iOS', osVersion: '26.0' });
    const { container } = await render(SourceHost);
    const source = container.querySelector('.source')!;
    const glass = container.querySelector('overlay blur-view[ui-glass]')!;

    expect(source.getAttribute('glass-effect-id')).toMatch(/^ui-sheet-\d+$/);
    expect(glass.getAttribute('glass-effect-id')).toBe(
      source.getAttribute('glass-effect-id'),
    );
    // Shown until the sheet covers it.
    expect((source as HTMLElement).style.visibility).toBe('');
  });
});
