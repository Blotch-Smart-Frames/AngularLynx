import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * The shell: black from edge to edge, with the current screen filling it.
 * The screens pad themselves by the safe-area insets, so on a phone the
 * nav bar sits below the status bar and the Order button above the home
 * indicator.
 */
@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, RouterOutlet],
  template: `<router-outlet />`,
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
