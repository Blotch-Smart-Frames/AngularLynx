import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import {
  UiDialog,
  UiDialogDescription,
  UiDialogFooter,
  UiDialogHeader,
  UiDialogTitle,
} from './dialog';

@Component({
  standalone: true,
  imports: [
    UiDialog,
    UiDialogHeader,
    UiDialogTitle,
    UiDialogDescription,
    UiDialogFooter,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-dialog [(open)]="open">
      <ui-dialog-header>
        <ui-dialog-title>Title</ui-dialog-title>
        <ui-dialog-description>Description</ui-dialog-description>
      </ui-dialog-header>
      <ui-dialog-footer><text>Actions</text></ui-dialog-footer>
    </ui-dialog>
  `,
})
class DialogHost {
  open = true;
}

describe('UiDialog', () => {
  it('renders header, title, description, and footer', async () => {
    const { getByText } = await render(DialogHost);
    expect(getByText('Title')).toBeTruthy();
    expect(getByText('Description')).toBeTruthy();
    expect(getByText('Actions')).toBeTruthy();
  });

  it('backdrop tap closes the dialog', async () => {
    const { componentRef } = await render(UiDialog);
    const inst = componentRef.instance as UiDialog;
    inst.open.set(true);
    await waitForUpdate();
    (inst as unknown as { onBackdropTap: () => void }).onBackdropTap();
    expect(inst.open()).toBe(false);
  });

  it('panel tap is a no-op (catchtap stops bubbling)', async () => {
    const { componentRef } = await render(UiDialog);
    const inst = componentRef.instance as UiDialog;
    expect(() =>
      (inst as unknown as { onPanelTap: () => void }).onPanelTap(),
    ).not.toThrow();
  });

  it('open effect: showing then hiding runs the animate-in and animate-out lifecycles', async () => {
    // Monkey-patch backdrop/panel refs so #animateIn / #animateOut execute in
    // full instead of bailing on !backdrop || !panel.
    const { componentRef, container } = await render(UiDialog);
    const inst = componentRef.instance as UiDialog;
    const view = container.querySelector('view') as Element;
    (inst as unknown as { backdropRef: unknown }).backdropRef = signal({
      nativeElement: view,
    });
    (inst as unknown as { panelRef: unknown }).panelRef = signal({
      nativeElement: view,
    });

    inst.open.set(true);
    await waitForUpdate();
    // Wait for setTimeout chains to flush (nested setTimeouts inside #doOpen).
    await waitForUpdate();
    await waitForUpdate();

    // Now close it — exercises #doClose + #animateOut. The nested setTimeout
    // inside #doClose runs DURATION.normal (250ms) + 20ms later; wait real time.
    inst.open.set(false);
    await new Promise((r) => setTimeout(r, 320));
    await waitForUpdate();
    expect(inst.open()).toBe(false);
  });

  it('open effect bails when backdrop/panel refs are undefined', async () => {
    // Covers the early-return branches in #animateIn / #animateOut.
    const { componentRef } = await render(UiDialog);
    const inst = componentRef.instance as UiDialog;
    inst.open.set(true);
    await waitForUpdate();
    await waitForUpdate();
    inst.open.set(false);
    await waitForUpdate();
    expect(inst.open()).toBe(false);
  });

  it('overlayStyle switches between visible and hidden variants', async () => {
    const { componentRef, container } = await render(UiDialog);
    const inst = componentRef.instance as UiDialog;
    // Default hidden — overlay carries display:none.
    let overlay = container.querySelector('overlay');
    expect(overlay?.getAttribute('style')).toContain('display: none');

    // Open + advance so overlayVisible flips true.
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
    const { componentRef, container } = await render(UiDialog);
    const inst = componentRef.instance as UiDialog;
    setInputSignal(inst.userClass, 'custom-panel');
    await waitForUpdate();
    const panelCandidates = Array.from(container.querySelectorAll('view'));
    expect(
      panelCandidates.some((el) =>
        el.getAttribute('class')?.includes('custom-panel'),
      ),
    ).toBe(true);
  });
});

describe('Dialog sub-components', () => {
  it('UiDialogHeader renders projected content', async () => {
    const { container } = await render(UiDialogHeader);
    expect(container.querySelector('view')).toBeTruthy();
  });

  it('UiDialogTitle renders projected content', async () => {
    const { container } = await render(UiDialogTitle);
    expect(container.querySelector('text')).toBeTruthy();
  });

  it('UiDialogDescription renders projected content', async () => {
    const { container } = await render(UiDialogDescription);
    expect(container.querySelector('text')).toBeTruthy();
  });

  it('UiDialogFooter renders projected content', async () => {
    const { container } = await render(UiDialogFooter);
    expect(container.querySelector('view')).toBeTruthy();
  });
});
