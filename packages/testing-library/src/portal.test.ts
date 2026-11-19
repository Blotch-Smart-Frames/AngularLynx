/**
 * LynxPortal on Lynx's element tree. The testing environment's
 * `__CreatePage()` does what Lynx's does: the new page becomes the root and
 * replaces the old one on screen. The portal used to ask for the page with
 * a second `__CreatePage()` each time it opened, so its overlay went into a
 * new page and the app's page left the screen. On iOS and Android,
 * `destroy()` then left the overlay's content on screen (issue #458).
 */

import { Component, Directive, inject, TemplateRef } from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxPortal,
  type PortalRef,
} from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitForUpdate } from './index.js';

@Component({
  selector: 'test-portal-dialog',
  imports: [LYNX_ELEMENTS],
  template: `<view><text>Portal content</text></view>`,
})
class PortalDialog {}

/**
 * Opens the dialog in a portal on the first tap and destroys it on the next,
 * as an app's button does.
 */
@Component({
  selector: 'test-portal-opener',
  imports: [LYNX_ELEMENTS],
  template: `<view (bindtap)="toggle()"><text>App content</text></view>`,
})
class PortalOpener {
  readonly #portal = inject(LynxPortal);
  ref: PortalRef<PortalDialog> | null = null;

  toggle(): void {
    if (this.ref) {
      this.ref.destroy();
      this.ref = null;
    } else {
      this.ref = this.#portal.open(PortalDialog);
    }
  }
}

/**
 * Hands its template to the opener. A `viewChild()` query would need the
 * metadata ahead-of-time compilation adds, and these specs compile just in
 * time (see render()'s `componentRef`).
 */
@Directive({ selector: '[testSaving]' })
class SavingTemplate {
  constructor() {
    inject(TemplatePortalOpener).saving = inject(TemplateRef);
  }
}

/**
 * Opens a template of its own in a portal.
 */
@Component({
  selector: 'test-template-portal-opener',
  imports: [LYNX_ELEMENTS, SavingTemplate],
  template: `
    <text>App content</text>
    <ng-template testSaving><text>Saving</text></ng-template>
  `,
})
class TemplatePortalOpener {
  readonly #portal = inject(LynxPortal);
  saving: TemplateRef<unknown> | null = null;

  open(): PortalRef<null> {
    return this.#portal.openTemplate(this.saving!);
  }
}

describe('LynxPortal', () => {
  it('opens its overlay in the page the app is drawn in', async () => {
    const { container } = await render(PortalOpener);

    fireEvent.tap(screen.getByText('App content'));
    await waitForUpdate();

    // The app stays on screen beside the overlay, which is the page's own
    // child: Lynx draws an overlay above everything only from there.
    expect(container.isConnected).toBe(true);
    expect(screen.getByText('App content')).toBeTruthy();
    const overlay = screen.getByText('Portal content').closest('overlay');
    expect(overlay?.parentElement).toBe(container);
  });

  it('takes the overlay off the screen when destroyed from a tap', async () => {
    const { container } = await render(PortalOpener);
    fireEvent.tap(screen.getByText('App content'));
    await waitForUpdate();

    fireEvent.tap(screen.getByText('App content'));
    await waitForUpdate();

    expect(screen.queryByText('Portal content')).toBeNull();
    expect(container.querySelector('overlay')).toBeNull();
    expect(screen.getByText('App content')).toBeTruthy();
  });

  // Outside an event and outside change detection, as from a timer: the
  // view's detach asks Angular for a tick, and its end commits the removal.
  it('takes the overlay off the screen when destroyed from a timer', async () => {
    const { container, componentRef } = await render(PortalOpener);
    const opener = componentRef.instance;
    opener.toggle();
    await waitForUpdate();
    expect(container.querySelector('overlay')).not.toBeNull();

    await new Promise<void>((resolve) =>
      setTimeout(() => {
        opener.toggle();
        resolve();
      }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(container.querySelector('overlay')).toBeNull();
    expect(screen.getByText('App content')).toBeTruthy();
  });

  it('opens and destroys a template portal in the same page', async () => {
    const { container, componentRef } = await render(TemplatePortalOpener);

    const ref = componentRef.instance.open();
    await waitForUpdate();

    expect(screen.getByText('Saving').closest('overlay')?.parentElement).toBe(
      container,
    );
    expect(screen.getByText('App content')).toBeTruthy();

    ref.destroy();
    await waitForUpdate();

    expect(screen.queryByText('Saving')).toBeNull();
    expect(container.querySelector('overlay')).toBeNull();
  });
});
