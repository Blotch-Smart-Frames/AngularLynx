import { Component, type Provider, signal } from '@angular/core';
import {
  ClipboardError,
  LynxAccessibility,
  LynxClipboard,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { ButtonSize } from '../button/button';
import { UiCopyButton } from './copy-button';

@Component({
  imports: [UiCopyButton],
  template: `
    <ui-copy-button
      [value]="value()"
      [size]="size()"
      [duration]="duration()"
      [accessibility-label]="label()"
      class="w-full"
      (copied)="copies.set(copies().concat($event))"
      (copyFailed)="failures.set(failures().concat($event))"
    >
      Copy code
    </ui-copy-button>
  `,
})
class CopyButtonHost {
  readonly value = signal('ABC-123');
  readonly size = signal<ButtonSize>('default');
  readonly duration = signal(60_000);
  readonly label = signal<string | undefined>(undefined);
  readonly copies = signal<string[]>([]);
  readonly failures = signal<ClipboardError[]>([]);
}

/** The path of the set's `check` icon, which the button shows once it copied. */
const CHECK_PATH = 'M20 6 9 17l-5-5';

/**
 * Waits until the clipboard's promises have settled and the view caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

const renderCopyButton = async (providers: Provider[] = []) => {
  const announce = vi.fn((_content: string) => Promise.resolve());
  const result = await render(CopyButtonHost, {
    providers: [
      { provide: LynxAccessibility, useValue: { announce } },
      ...providers,
    ],
  });
  const host = result.componentRef.instance as CopyButtonHost;
  // The copy button's box carries the host's class.
  const box = result.container.querySelector('.w-full')!;
  return {
    ...result,
    host,
    box,
    announce,
    clipboard: result.componentRef.injector.get(LynxClipboard),
    /** The button's box, inside the copy button's: it takes the taps. */
    button: () => box.querySelector('.grow')!,
    icon: () => box.querySelector('svg')!,
    update: async () => {
      await waitForUpdate();
    },
  };
};

describe('UiCopyButton', () => {
  it('copies its value when tapped, then says so for a moment', async () => {
    const { host, button, icon, clipboard, announce, getByText, update } =
      await renderCopyButton();
    expect(icon().getAttribute('content')).not.toContain(CHECK_PATH);

    host.duration.set(20);
    await update();
    fireEvent.tap(button());
    await settle();

    await expect(clipboard.getString()).resolves.toBe('ABC-123');
    expect(host.copies()).toEqual(['ABC-123']);
    expect(getByText('Copied')).toBeTruthy();
    expect(icon().getAttribute('content')).toContain(CHECK_PATH);
    expect(announce).toHaveBeenCalledWith('Copied');

    await vi.waitFor(() => expect(getByText('Copy code')).toBeTruthy());
    expect(icon().getAttribute('content')).not.toContain(CHECK_PATH);
  });

  it('copies the value it has when tapped, and starts the moment again', async () => {
    const { host, button, clipboard, getByText, queryByText, update } =
      await renderCopyButton();

    fireEvent.tap(button());
    await settle();
    host.value.set('XYZ-789');
    await update();
    fireEvent.tap(button());
    await settle();

    await expect(clipboard.getString()).resolves.toBe('XYZ-789');
    expect(host.copies()).toEqual(['ABC-123', 'XYZ-789']);
    expect(getByText('Copied')).toBeTruthy();
    expect(queryByText('Copy code')).toBeNull();
  });

  it('leaves saying it to Android 13 and later, which show every copy', async () => {
    const { host, button, clipboard, announce, getByText } =
      await renderCopyButton([
        {
          provide: LynxSystemInfo,
          useValue: { platform: 'Android', osVersion: '14' },
        },
      ]);

    fireEvent.tap(button());
    await settle();

    await expect(clipboard.getString()).resolves.toBe('ABC-123');
    expect(host.copies()).toEqual(['ABC-123']);
    expect(getByText('Copy code')).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();
  });

  it('emits why it could not copy, and says nothing', async () => {
    const error = new ClipboardError('unavailable', 'No clipboard here.');
    const { host, button, announce, getByText } = await renderCopyButton([
      {
        provide: LynxClipboard,
        useValue: {
          setString: () => Promise.reject(error),
          confirmsCopies: false,
        },
      },
    ]);

    fireEvent.tap(button());
    await settle();

    expect(host.failures()).toEqual([error]);
    expect(host.copies()).toEqual([]);
    expect(getByText('Copy code')).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();
  });

  it('still says it copied where a screen reader cannot be told', async () => {
    const { button, announce, getByText } = await renderCopyButton();
    announce.mockReturnValue(Promise.reject(new Error('No announcer.')));

    fireEvent.tap(button());
    await settle();

    expect(announce).toHaveBeenCalled();
    expect(getByText('Copied')).toBeTruthy();
  });

  it("changes an icon-only button's label while it says it copied", async () => {
    const { host, button, icon, update } = await renderCopyButton();
    host.size.set('icon');
    host.label.set('Copy code');
    await update();
    expect(button().getAttribute('accessibility-label')).toBe('Copy code');
    expect(icon().style.width).toBe('20px');

    fireEvent.tap(button());
    await settle();

    expect(button().getAttribute('accessibility-label')).toBe('Copied');
  });

  it('fits a smaller icon to the small size', async () => {
    const { host, icon, update } = await renderCopyButton();
    host.size.set('sm');
    await update();

    expect(icon().style.width).toBe('16px');
  });

  it('puts its class on the box the button fills', async () => {
    const { box, button } = await renderCopyButton();

    expect(box.classList).toContain('w-full');
    expect(box.classList).toContain('flex-row');
    expect(button().classList).toContain('grow');
    expect(button().classList).not.toContain('w-full');
  });
});
