import {
  Component,
  Injectable,
  type OnDestroy,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxPortal,
  type PortalRef,
} from '@blotch/angular-lynx';

/** How many rows, each holding an overlay, the card has. */
const ROWS = 12;
/** How many times a run replaces them. */
const ROUNDS = 20;
/** How long the card stays away, as while the next rows load. */
const LOADING_MS = 100;
/** How long "Open portal later" waits to open the portal, and to close it. */
const PORTAL_DELAY_MS = 100;

/**
 * The names of a round's rows.
 */
const rowsOf = (round: number): string[] =>
  Array.from({ length: ROWS }, (_, i) => `Row ${round}.${i + 1}`);

/**
 * What the loader watches and the page shows, shared between them.
 */
@Injectable()
class OverlaysState {
  /** Counts the replacements asked for; the loader acts on each. */
  readonly requested = signal(0);
  /** Whether the next rows are loading, which takes the card away. */
  readonly loading = signal(false);
}

/**
 * Starts loading the next rows from an effect, during change detection, as
 * an app that loads data when a selection changes does. So the card goes in
 * a second pass of the same change detection, after the rows dropped their
 * menus in the first.
 */
@Component({
  selector: 'app-overlays-loader',
  template: ``,
})
class OverlaysLoader {
  readonly #state = inject(OverlaysState);

  protected readonly load = effect(() => {
    if (this.#state.requested() > 0) this.#state.loading.set(true);
  });
}

/**
 * A row with a closed menu: an `<overlay>` styled `position: fixed` for the
 * web, as `ui-menu`'s and the dialogs' are, which Lynx draws from the page
 * rather than from the row.
 */
@Component({
  selector: 'app-overlays-row',
  imports: [LYNX_ELEMENTS],
  template: `
    <view style="display: flex; flex-direction: row; padding: 4px 0;">
      <text>{{ name() }}</text>
      @if (menu()) {
        <view>
          <overlay
            [attr.visible]="false"
            style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; display: none;"
          >
            <view style="width: 100%; height: 100%;">
              <scroll-view scroll-orientation="vertical" style="height: 200px;">
                <text>{{ name() }} menu</text>
              </scroll-view>
            </view>
          </overlay>
        </view>
      }
    </view>
  `,
})
class OverlaysRow {
  readonly name = input.required<string>();
  readonly menu = input.required<boolean>();
}

/**
 * What the page opens with `LynxPortal` (issue #458): a dialog over the whole
 * screen with a button that closes it.
 */
@Component({
  selector: 'app-overlays-portal',
  imports: [LYNX_ELEMENTS],
  host: {
    style:
      'width: 100%; height: 100%; align-items: center; justify-content: center; background-color: rgba(0, 0, 0, 0.4);',
  },
  template: `
    <view
      [flatten]="false"
      [accessibility-element]="true"
      accessibility-label="Close portal"
      accessibility-traits="button"
      style="padding: 12px; background-color: #ffffff;"
      (bindtap)="closed.emit()"
    >
      <text>Close portal</text>
    </view>
  `,
})
class OverlaysPortal {
  readonly closed = output();
}

/**
 * E2E fixture for issue #345, loaded through `loadComponent` like
 * linking.ts and opened from the web view page.
 *
 * "Replace rows" replaces a card of rows, each holding an `<overlay>`, 20
 * times. Each time, the rows drop their menus and the card goes in one
 * change detection, the rows first (see OverlaysLoader), and new rows come
 * back a moment later. Lynx then had to take each overlay off the page from
 * the row it went from, which had left the page too, so it never did: the
 * page kept drawing overlays that were freed, and iOS crashed in Lynx's
 * layout within a few replacements. "Overlays: replaced 20 times" shows once
 * every replacement has been drawn.
 *
 * "Open portal" opens a dialog with `LynxPortal.open()` from the tap, and its
 * "Close portal" calls `PortalRef.destroy()` from its own (issue #458). "Open
 * portal later" does both from a timer instead. The portal used to put its
 * overlay in a page of its own, which took the screen's root from the app's
 * page, so on iOS and Android the dialog stayed on screen after destroy().
 * "Portal: closed" and the count of portals closed show once destroy() has
 * returned.
 */
@Component({
  selector: 'app-overlays',
  imports: [LYNX_ELEMENTS, OverlaysLoader, OverlaysRow],
  providers: [OverlaysState],
  template: `
    <app-overlays-loader />
    <view
      [flatten]="false"
      [accessibility-element]="true"
      accessibility-label="Replace rows"
      accessibility-traits="button"
      style="margin-top: 16px; padding: 12px; background-color: #e0e0e0; align-self: flex-start;"
      (bindtap)="replace()"
    >
      <text>Replace rows</text>
    </view>
    <text flatten="false" style="margin-top: 8px;"
      >Overlays: {{ status() }}</text
    >
    <view style="display: flex; flex-direction: row; margin-top: 8px;">
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Open portal"
        accessibility-traits="button"
        style="padding: 12px; background-color: #e0e0e0;"
        (bindtap)="openPortal()"
      >
        <text>Open portal</text>
      </view>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Open portal later"
        accessibility-traits="button"
        style="margin-left: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="openPortalLater()"
      >
        <text>Open portal later</text>
      </view>
    </view>
    <text flatten="false" style="margin-top: 8px;"
      >Portal: {{ portalStatus() }}</text
    >
    @if (!state.loading()) {
      <view style="margin-top: 8px;">
        @for (row of rows(); track row) {
          <app-overlays-row [name]="row" [menu]="menus()" />
        }
      </view>
    }
  `,
})
export class OverlaysRoute implements OnDestroy {
  protected readonly state = inject(OverlaysState);
  readonly #portal = inject(LynxPortal);
  readonly status = signal('ready');
  readonly menus = signal(true);
  readonly rows = signal(rowsOf(0));
  readonly portalStatus = signal('ready');
  #timer: ReturnType<typeof setTimeout> | undefined;
  #portalTimer: ReturnType<typeof setTimeout> | undefined;
  #portalRef: PortalRef<OverlaysPortal> | null = null;
  #portalsClosed = 0;

  /**
   * Opens the dialog now, and closes it as soon as its button is tapped.
   */
  openPortal(): void {
    this.#openPortal(() => this.#closePortal());
  }

  /**
   * Opens the dialog from a timer, and closes it from another once its
   * button is tapped.
   */
  openPortalLater(): void {
    this.#later(() =>
      this.#openPortal(() => this.#later(() => this.#closePortal())),
    );
  }

  /**
   * Runs `fn` after PORTAL_DELAY_MS, in place of anything still waiting: a
   * second tap within the delay would otherwise leave a timer ngOnDestroy
   * can't cancel, which could open a portal after the page has gone.
   */
  #later(fn: () => void): void {
    clearTimeout(this.#portalTimer);
    this.#portalTimer = setTimeout(fn, PORTAL_DELAY_MS);
  }

  #openPortal(close: () => void): void {
    this.#portalRef = this.#portal.open(OverlaysPortal);
    this.#portalRef.instance?.closed.subscribe(close);
    this.portalStatus.set('open');
  }

  #closePortal(): void {
    this.#portalRef?.destroy();
    this.#portalRef = null;
    this.#portalsClosed++;
    this.portalStatus.set(`closed ${this.#portalsClosed}`);
  }

  replace(round = 1): void {
    this.status.set(`replacing ${round}`);
    this.menus.set(false);
    this.state.requested.set(round);
    this.#timer = setTimeout(() => {
      this.rows.set(rowsOf(round));
      this.menus.set(true);
      this.state.loading.set(false);
      this.#timer = setTimeout(() => {
        if (round < ROUNDS) this.replace(round + 1);
        else this.status.set(`replaced ${ROUNDS} times`);
      }, LOADING_MS);
    }, LOADING_MS);
  }

  ngOnDestroy(): void {
    clearTimeout(this.#timer);
    clearTimeout(this.#portalTimer);
    // A portal stays open when its opener goes (see LynxPortal).
    this.#portalRef?.destroy();
  }
}
