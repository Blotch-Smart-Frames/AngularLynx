import { Component } from '@angular/core';
import { LYNX_ELEMENTS, LynxStackOutlet } from '@blotch/angular-lynx';

/**
 * The shell: black from edge to edge, with the current screen filling it.
 * The screens pad themselves by the safe-area insets, so on a phone the
 * nav bar sits below the status bar and the Order button above the home
 * indicator.
 *
 * `<lynx-stack-outlet>` moves between the screens as the platform does: a
 * product slides in over the gallery, and the back chevron, Android's back
 * button or a drag to the right slides it away again, onto the gallery as
 * you left it, scrolled where it was.
 */
@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, LynxStackOutlet],
  template: `<lynx-stack-outlet />`,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background-color: #000;
    }
  `,
})
export class App {}
