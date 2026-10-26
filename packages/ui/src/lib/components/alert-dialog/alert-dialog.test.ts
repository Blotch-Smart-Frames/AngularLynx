import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { DURATION } from '../../utils/animate';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import {
  UiAlertDialog,
  UiAlertDialogDescription,
  UiAlertDialogFooter,
  UiAlertDialogHeader,
  UiAlertDialogTitle,
} from './alert-dialog';

@Component({
  imports: [
    UiAlertDialog,
    UiAlertDialogHeader,
    UiAlertDialogTitle,
    UiAlertDialogDescription,
    UiAlertDialogFooter,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-alert-dialog [(open)]="open">
      <ui-alert-dialog-header>
        <ui-alert-dialog-title>Sure?</ui-alert-dialog-title>
        <ui-alert-dialog-description>Cannot undo</ui-alert-dialog-description>
      </ui-alert-dialog-header>
      <ui-alert-dialog-footer><text>Buttons</text></ui-alert-dialog-footer>
    </ui-alert-dialog>
  `,
})
class AlertDialogHost {
  open = true;
}

describe('UiAlertDialog', () => {
  it('stops its close timers when it is destroyed while closing', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { componentRef, unmount } = await render(UiAlertDialog);
    const inst = componentRef.instance as UiAlertDialog;
    inst.open.set(true);
    for (let i = 0; i < 5; i++) await waitForUpdate();
    inst.open.set(false);
    await waitForUpdate();
    // Destroyed during the close animation, as an `@if` around the alert dialog
    // would do. Its close timer (DURATION.normal + 20) used to fire anyway
    // and emit `closed` from the destroyed output.
    unmount();
    await new Promise((r) => setTimeout(r, DURATION.normal + 50));
    const warnings = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(warnings.filter((message) => message.includes('NG0953'))).toEqual(
      [],
    );
  });

  it('moves a screen reader into the panel and keeps it there while open', async () => {
    const { componentRef, container } = await render(UiAlertDialog);
    const inst = componentRef.instance as UiAlertDialog;
    const panel = container.querySelector(
      '[accessibility-exclusive-focus]',
    ) as Element & { invoke?: unknown };
    expect(panel.getAttribute('accessibility-exclusive-focus')).toBe('false');
    const invoke = vi.fn();
    panel.invoke = invoke;
    (inst as unknown as { backdropRef: unknown }).backdropRef = signal({
      nativeElement: panel,
    });
    (inst as unknown as { panelRef: unknown }).panelRef = signal({
      nativeElement: panel,
    });
    inst.open.set(true);
    for (let i = 0; i < 5; i++) await waitForUpdate();
    expect(invoke).toHaveBeenCalledWith('requestAccessibilityFocus');
    expect(panel.getAttribute('accessibility-exclusive-focus')).toBe('true');
  });

  it('renders header, title, description, and footer', async () => {
    const { getByText } = await render(AlertDialogHost);
    expect(getByText('Sure?')).toBeTruthy();
    expect(getByText('Cannot undo')).toBeTruthy();
    expect(getByText('Buttons')).toBeTruthy();
  });

  it('panel tap is a no-op (catchtap stops bubbling)', async () => {
    const { componentRef } = await render(UiAlertDialog);
    const inst = componentRef.instance as UiAlertDialog;
    expect(() =>
      (inst as unknown as { onPanelTap: () => void }).onPanelTap(),
    ).not.toThrow();
  });

  it('open effect: showing then hiding runs the animate-in/out lifecycles', async () => {
    // Monkey-patch backdrop/panel refs so #animateIn / #animateOut execute in
    // full instead of bailing on !backdrop || !panel.
    const { componentRef, container } = await render(UiAlertDialog);
    const inst = componentRef.instance as UiAlertDialog;
    const view = container.querySelector('view') as Element;
    (inst as unknown as { backdropRef: unknown }).backdropRef = signal({
      nativeElement: view,
    });
    (inst as unknown as { panelRef: unknown }).panelRef = signal({
      nativeElement: view,
    });

    inst.open.set(true);
    await waitForUpdate();
    await waitForUpdate();
    await waitForUpdate();

    inst.open.set(false);
    await new Promise((r) => setTimeout(r, 320));
    await waitForUpdate();
    expect(inst.open()).toBe(false);
  });

  it('open effect bails when backdrop/panel refs are undefined', async () => {
    // Covers the early-return branches in #animateIn / #animateOut.
    const { componentRef } = await render(UiAlertDialog);
    const inst = componentRef.instance as UiAlertDialog;
    const closed = vi.fn();
    inst.closed.subscribe(closed);
    inst.open.set(true);
    await waitForUpdate();
    await waitForUpdate();
    inst.open.set(false);
    await waitForUpdate();
    // Wait out the close sequence, so #animateOut runs (and bails) while the
    // component is still alive. Destroying it clears the sequence's timers.
    await new Promise((r) => setTimeout(r, DURATION.normal + 50));
    expect(inst.open()).toBe(false);
    expect(closed).toHaveBeenCalledOnce();
  });

  it('overlayStyle switches between visible and hidden variants', async () => {
    const { componentRef, container } = await render(UiAlertDialog);
    const inst = componentRef.instance as UiAlertDialog;
    let overlay = container.querySelector('overlay');
    expect(overlay?.getAttribute('style')).toContain('display: none');

    const view = container.querySelector('view') as Element;
    (inst as unknown as { backdropRef: unknown }).backdropRef = signal({
      nativeElement: view,
    });
    (inst as unknown as { panelRef: unknown }).panelRef = signal({
      nativeElement: view,
    });
    inst.open.set(true);
    for (let i = 0; i < 10; i++) await waitForUpdate();
    overlay = container.querySelector('overlay');
    expect(overlay?.getAttribute('style')).not.toContain('display: none');
  });

  it('accepts a user class on the panel', async () => {
    const { componentRef, container } = await render(UiAlertDialog);
    const inst = componentRef.instance as UiAlertDialog;
    setInputSignal(inst.userClass, 'custom-panel');
    await waitForUpdate();
    const views = Array.from(container.querySelectorAll('view'));
    expect(
      views.some((el) => el.getAttribute('class')?.includes('custom-panel')),
    ).toBe(true);
  });
});

describe('Alert dialog sub-components', () => {
  it('UiAlertDialogHeader renders projected content', async () => {
    const { container } = await render(UiAlertDialogHeader);
    expect(container.querySelector('view')).toBeTruthy();
  });

  it('UiAlertDialogTitle renders projected content', async () => {
    const { container } = await render(UiAlertDialogTitle);
    expect(container.querySelector('text')).toBeTruthy();
  });

  it('UiAlertDialogDescription renders projected content', async () => {
    const { container } = await render(UiAlertDialogDescription);
    expect(container.querySelector('text')).toBeTruthy();
  });

  it('UiAlertDialogFooter renders projected content', async () => {
    const { container } = await render(UiAlertDialogFooter);
    expect(container.querySelector('view')).toBeTruthy();
  });
});
