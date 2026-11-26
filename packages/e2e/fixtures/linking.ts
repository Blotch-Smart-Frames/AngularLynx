import {
  Component,
  effect,
  inject,
  signal,
  untracked,
  type OnInit,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxAppState, LynxLinking } from '@blotch/angular-lynx';

/** A scheme no app declares or handles, for canOpenURL's "no". */
const UNDECLARED_URL = 'angularlynx-e2e-undeclared://x';

/**
 * E2E fixture for LynxLinking (issue #304), loaded through `loadComponent`
 * like lazy-route.ts and opened from the canvas page, which has room for a
 * link.
 *
 * "Can open" shows canOpenURL() for an https URL, then for a scheme nobody
 * declares: "yes/no" in the app's own builds means the shell's module
 * answered, and that the https query the generator writes into Info.plist's
 * LSApplicationQueriesSchemes and the manifest's <queries> reached the build
 * (without it, iOS and Android 11+ answer no). The web preview says
 * "yes/yes", since a browser can't tell, and Lynx Explorer "no/no".
 *
 * "Open sheet" opens a page with openInApp(): "Sheet: open" while it's open,
 * "Sheet: closed" once the person is back, or why it failed.
 *
 * "Returns" counts the times LynxAppState saw the app come back to the front
 * after it left (issue #577): the shells send its state in the global props
 * as the scene or activity moves. It's on this page because only the app's
 * own builds open it: Lynx Explorer sends no state, so it would stay at 0.
 */
@Component({
  selector: 'app-linking',
  imports: [LYNX_ELEMENTS],
  template: `
    <view
      style="display: flex; flex-direction: row; align-items: center; margin-top: 16px;"
    >
      <text flatten="false">Can open: {{ canOpen() }}</text>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Open sheet"
        accessibility-traits="button"
        style="margin-left: 16px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="openSheet()"
      >
        <text>Open sheet</text>
      </view>
    </view>
    <text flatten="false" style="margin-top: 8px;">Sheet: {{ sheet() }}</text>
    <text flatten="false" style="margin-top: 8px;"
      >Returns: {{ returns() }}</text
    >
  `,
})
export class LinkingRoute implements OnInit {
  readonly #linking = inject(LynxLinking);
  readonly canOpen = signal('…');
  readonly sheet = signal('none');
  readonly returns = signal(0);

  constructor() {
    const appState = inject(LynxAppState);
    let away = false;
    effect(() => {
      const active = appState.active();
      if (active && away) untracked(() => this.returns.update((n) => n + 1));
      away = !active;
    });
  }

  ngOnInit(): void {
    Promise.all([
      this.#linking.canOpenURL('https://example.com'),
      this.#linking.canOpenURL(UNDECLARED_URL),
    ]).then(
      (answers) =>
        this.canOpen.set(answers.map((can) => (can ? 'yes' : 'no')).join('/')),
      (error: Error) => this.canOpen.set(error.message),
    );
  }

  openSheet(): void {
    this.sheet.set('open');
    this.#linking.openInApp('https://example.com').then(
      () => this.sheet.set('closed'),
      (error: Error) => this.sheet.set(error.message),
    );
  }
}
