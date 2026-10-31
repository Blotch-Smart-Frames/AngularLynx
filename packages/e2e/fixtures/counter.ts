import {
  HttpClient,
  type HttpErrorResponse,
  httpResource,
} from '@angular/common/http';
import {
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  backgroundFn,
  createMainThreadRef,
  LYNX_ELEMENTS,
  LynxMainThread,
  mainThreadFn,
  MainThreadRef,
} from '@blotch/angular-lynx';

import { environment } from '../../environments/environment';
import { TailwindCard } from './tailwind-card';

const factor = createMainThreadRef(2);

/**
 * Runs on the background thread for "Ask background". It's async, and takes a
 * MainThreadRef, so its answer only shows when runOnBackground() awaits the
 * result and hands the ref over as the background thread's copy (issue #54).
 */
const multiply = backgroundFn(async (ref: unknown, n: number) => {
  await Promise.resolve();
  return ref instanceof MainThreadRef ? n * (ref.current as number) : -1;
});

/**
 * How many times Hello's ngOnInit has run `countInit` on the main thread. The
 * lazy page shows it (lazy-route.ts), since this page has no room left.
 */
export const initRuns = signal(0);

const countInit = mainThreadFn(() => {
  initRuns.update((runs) => runs + 1);
});

/**
 * fixtures/http-data.json, which the E2E static server serves in every layer
 * that renders the app (playwright/serve.ts, native/run-native.ts). The URL
 * comes from the app's environment, as an app's backend URL does, so the page
 * only loads it when the build swapped in environment.e2e.ts.
 */
const HTTP_DATA_URL = environment.httpDataUrl;

/**
 * Where the same server answers a request with the `Content-Type` headers it
 * arrived with.
 */
const HTTP_ECHO_URL = 'http://127.0.0.1:3210/e2e-echo';

type HttpData = { reply: string };

/**
 * E2E fixture that replaces the `hello` component the component schematic
 * generates. Tapping "Increment" proves the round trip from a native event,
 * through change detection, to the renderer; "Open lazy page" proves that
 * lazy route chunks load. "Open gestures" opens gestures.ts in the same place.
 * The two share a row so this page gets no taller (see "Ask background").
 *
 * Both are Angular's own `routerLink`s, which listen for `click`: the renderer
 * hands them Lynx's tap, so every check that opens a lazy page also proves a
 * tap on a routerLink navigates. `routerLinkActive` marks the open one with
 * the `selected` accessibility trait, next to its own `button` (issue #113):
 * Layer 3 reads the attribute, and native/lazy-route.yaml asks iOS whether
 * the element is selected.
 *
 * The views the tests tap are accessibility elements with labels, so native UI
 * tests (Maestro, in Layer 6) can find them by name. `<text>` is an
 * accessibility element by default, labeled with its content.
 *
 * Every element a native test taps or checks also turns off flattening. On
 * Android, Lynx draws flattened elements into their parent instead of giving
 * them a View, and unless TalkBack is on (Lynx Explorer sets up accessibility
 * lazily) nothing exposes them, so Maestro can't see them. A View of its own
 * carries the label (or the text) as its content description.
 *
 * Below the buttons are elements from Lynx's XElement library rather than its
 * core: `<input>`, `<svg>` and `<overlay>`. An app shell that doesn't link and
 * register XElement renders nothing for them (on Android, nothing after them
 * either), with no error on screen, so native/xelement.yaml types into the
 * input, finds the svg and opens the overlay. Lynx Explorer bundles XElement;
 * the shells from `ng build --platform` have to as well.
 *
 * "Ask background" calls an async background function from a tap handler.
 * It comes after the XElement elements so it doesn't push the input down:
 * in Lynx Explorer, whose navigation bar sits above the app, the keyboard
 * would then cover the "Typed:" line that native/xelement.yaml checks.
 *
 * "HTTP" loads fixtures/http-data.json twice, through HttpClient and through
 * httpResource, then posts JSON through HttpClient, and shows the replies:
 * "HTTP: pong/pong/json". Lynx has `fetch` on the background thread only, and
 * Angular runs on the main thread, where the runtime relays requests to it
 * (issue #85). The JSON's URL comes from the environment file the production
 * build swaps in (issue #175). "json" means the POST arrived with the one
 * `Content-Type: application/json` HttpClient set; otherwise it shows the
 * types that arrived. The relay used to pass the name lowercase, and Lynx's
 * own fetch then added a `text/plain` one, which iOS sent instead and
 * Android sent as well (issue #176). It shares the "Background" row so this
 * page gets no taller: the lazy and gestures pages render below it, and on
 * CI's 320x640 Android emulator their checks are at the bottom of the
 * screen.
 *
 * The last element is a component with an `.html` template styled by Tailwind
 * (tailwind-card.ts).
 *
 * "Increment" is marked for translation, so Layer 2's `ng extract-i18n` has a
 * message to find, and the later layers render a template i18n block. With
 * no translations loaded, it shows the source text.
 *
 * ngOnInit counts itself through LynxMainThread.runOnMainThread(). The
 * background thread used to start a second copy of the app, whose ngOnInit
 * also reached the main thread and made the count 2 (issue #81). This page is
 * on the first screen, which that copy rendered too.
 */
@Component({
  selector: 'app-hello',
  imports: [LYNX_ELEMENTS, RouterLink, RouterLinkActive, TailwindCard],
  template: `
    <view style="margin-top: 16px; align-items: center;">
      <text flatten="false" style="font-size: 18px;">Count: {{ count() }}</text>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Increment"
        style="margin-top: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="increment()"
      >
        <text i18n="@@e2e.increment">Increment</text>
      </view>
      <view style="display: flex; flex-direction: row; margin-top: 8px;">
        <view
          [flatten]="false"
          [accessibility-element]="true"
          accessibility-label="Open lazy page"
          accessibility-traits="button"
          style="padding: 12px; background-color: #e0e0e0;"
          routerLink="/lazy"
          routerLinkActive="active"
        >
          <text>Open lazy page</text>
        </view>
        <view
          [flatten]="false"
          [accessibility-element]="true"
          accessibility-label="Open gestures"
          accessibility-traits="button"
          style="margin-left: 8px; padding: 12px; background-color: #e0e0e0;"
          routerLink="/gestures"
          routerLinkActive="active"
        >
          <text>Open gestures</text>
        </view>
      </view>
      <input
        accessibility-label="Text field"
        placeholder="Type here"
        style="margin-top: 16px; width: 200px; height: 40px; padding: 0 8px; border-width: 1px; border-color: #999999;"
        (bindinput)="onInput($event)"
      />
      <text flatten="false" style="margin-top: 8px;">Typed: {{ typed() }}</text>
      <!-- Static flatten="false" here and on the <text>s, bound on the <view>s:
        every element's flatten input takes both, and the build checks it. -->
      <svg
        flatten="false"
        [accessibility-element]="true"
        accessibility-label="SVG circle"
        style="margin-top: 8px; width: 24px; height: 24px;"
        content='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#6366f1"/></svg>'
      ></svg>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Open overlay"
        style="margin-top: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="overlayOpen.set(true)"
      >
        <text>Open overlay</text>
      </view>
      <overlay [attr.visible]="overlayOpen()">
        <view
          style="width: 100%; height: 100%; align-items: center; justify-content: center; background-color: rgba(0, 0, 0, 0.4);"
        >
          <view
            [flatten]="false"
            [accessibility-element]="true"
            accessibility-label="Close overlay"
            style="padding: 12px; background-color: #ffffff;"
            (bindtap)="overlayOpen.set(false)"
          >
            <text>Close overlay</text>
          </view>
        </view>
      </overlay>
      <view
        [flatten]="false"
        [accessibility-element]="true"
        accessibility-label="Ask background"
        style="margin-top: 8px; padding: 12px; background-color: #e0e0e0;"
        (bindtap)="askBackground()"
      >
        <text>Ask background</text>
      </view>
      <view style="display: flex; flex-direction: row; margin-top: 8px;">
        <text flatten="false">Background: {{ answer() }}</text>
        <text flatten="false" style="margin-left: 12px;"
          >HTTP: {{ httpReply() }}/{{ resourceReply() }}/{{ postReply() }}</text
        >
      </view>
      <app-tailwind-card />
    </view>
  `,
})
export class Hello implements OnInit {
  readonly #mainThread = inject(LynxMainThread);
  readonly #http = inject(HttpClient);
  readonly count = signal(0);
  readonly typed = signal('');
  readonly overlayOpen = signal(false);
  readonly answer = signal('');
  readonly httpReply = signal('');
  readonly postReply = signal('');
  readonly #resource = httpResource<HttpData>(() => HTTP_DATA_URL);
  readonly resourceReply = computed(() =>
    this.#resource.hasValue()
      ? this.#resource.value().reply
      : (this.#resource.error()?.message ?? ''),
  );

  ngOnInit() {
    void this.#mainThread.runOnMainThread(countInit);
    this.#http.get<HttpData>(HTTP_DATA_URL).subscribe({
      next: (data) => this.httpReply.set(data.reply),
      error: (error: HttpErrorResponse) => this.httpReply.set(error.message),
    });
    // With a header of its own, since when the relay sent two types, which
    // one iOS kept depended on the other names: with this one it kept the
    // `text/plain` one (issue #176, iOS 27), so the check fails there too.
    this.#http
      .post<HttpData>(
        HTTP_ECHO_URL,
        { ping: true },
        { headers: { 'X-Api-Key': 'e2e' } },
      )
      .subscribe({
        next: ({ reply }) =>
          this.postReply.set(reply === 'application/json' ? 'json' : reply),
        error: (error: HttpErrorResponse) => this.postReply.set(error.message),
      });
  }

  increment() {
    this.count.update((count) => count + 1);
  }

  onInput(event: Event) {
    this.typed.set((event as CustomEvent<{ value: string }>).detail.value);
  }

  /**
   * Asks `multiply` for 21 times the ref. Tap handlers run on the main
   * thread, where runOnBackground() exists.
   */
  askBackground() {
    void runOnBackground(multiply, factor, 21).then(
      (result) => this.answer.set(JSON.stringify(result)),
      (error: unknown) => this.answer.set(String(error)),
    );
  }
}
