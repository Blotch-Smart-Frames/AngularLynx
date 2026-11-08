// @vitest-environment jsdom
import '@angular/compiler';
import { Location, LocationStrategy } from '@angular/common';
import { MockLocationStrategy } from '@angular/common/testing';
import {
  Component,
  type OnDestroy,
  type Provider,
  inject,
  provideZonelessChangeDetection,
  type DebugElement,
  signal,
} from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {
  type ActivatedRouteSnapshot,
  ActivatedRoute,
  BaseRouteReuseStrategy,
  type DetachedRouteHandle,
  type Params,
  ROUTER_OUTLET_DATA,
  RouteReuseStrategy,
  Router,
  RouterOutlet,
  type Routes,
  provideRouter as provideAngularRouter,
  withComponentInputBinding,
} from '@angular/router';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { LynxAccessibilitySettings } from '../../accessibility/accessibility-settings';
import { LynxElement } from '../../lynx-element/lynx-element';
import { provideRouter } from '../lynx-router';
import { LynxStackOutlet } from './lynx-stack-outlet';
import { LynxStackPage } from './stack-page';

/** Every page made, so a test can find a page's instance and its fate. */
const made: Page[] = [];

@Component({ selector: 'test-page', template: 'page' })
class Page implements OnDestroy {
  readonly route = inject(ActivatedRoute);
  readonly outletData = inject(ROUTER_OUTLET_DATA);
  readonly stackPage = inject(LynxStackPage);
  destroyed = false;
  readonly params: Params[] = [];
  readonly queryParams: Params[] = [];

  constructor() {
    made.push(this);
    this.route.params.subscribe((params) => this.params.push(params));
    this.route.queryParams.subscribe((params) => this.queryParams.push(params));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }
}

/**
 * A page with an input, which withComponentInputBinding() sets.
 */
@Component({
  selector: 'test-input-page',
  template: '{{ id }}',
  inputs: ['id'],
})
class InputPage {
  id?: string;
}

/**
 * A page with an outlet of its own, for child routes.
 */
@Component({
  selector: 'test-parent-page',
  template: '<router-outlet />',
  imports: [RouterOutlet],
})
class ParentPage {}

@Component({
  selector: 'test-host',
  template: `
    <lynx-stack-outlet [routerOutletData]="data()" />
    <lynx-stack-outlet name="side" />
  `,
  imports: [LynxStackOutlet],
})
class Host {
  readonly data = signal('outlet data');
}

/** Whether the next navigation can leave the guarded page. */
let canLeave = true;

const ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'notes' },
  { path: 'notes', component: Page },
  { path: 'notes/:id', component: Page },
  { path: 'notes/:id/edit', component: Page },
  { path: 'settings', component: Page },
  { path: 'input/:id', component: InputPage },
  {
    path: 'guarded/:id',
    component: Page,
    canDeactivate: [() => canLeave],
  },
  {
    path: 'parent',
    component: ParentPage,
    children: [
      { path: '', component: Page },
      { path: 'child', component: Page },
    ],
  },
  { path: 'aside', component: Page, outlet: 'side' },
];

type Animate = ReturnType<typeof vi.fn>;

describe('LynxStackOutlet', () => {
  let animate: Animate;

  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    made.length = 0;
    canLeave = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    animate = vi.fn(() => ({ cancel: vi.fn() }));
    // jsdom has no Web Animations.
    (Element.prototype as unknown as { animate: Animate }).animate = animate;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    delete (Element.prototype as unknown as { animate?: Animate }).animate;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const setup = async (
    providers: Provider[] = [],
    url = '/notes',
    router: Provider[] | ReturnType<typeof provideRouter> = provideRouter(
      ROUTES,
      withComponentInputBinding(),
    ),
  ) => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), router, ...providers],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const routerService = TestBed.inject(Router);
    const location = TestBed.inject(Location);
    // What bootstrapping does: the router starts following the history, so
    // Location.back() navigates.
    routerService.initialNavigation();
    const host = fixture.nativeElement.querySelector(
      'lynx-stack-outlet',
    ) as HTMLElement;
    const settle = async () => {
      await vi.advanceTimersByTimeAsync(1000);
      fixture.detectChanges();
    };
    const go = async (path: string, extras = {}) => {
      await routerService.navigateByUrl(path, extras);
      fixture.detectChanges();
    };
    await go(url);
    await settle();
    /**
     * The outlet's page frames, the bottom one first.
     */
    const frames = () =>
      Array.from(host.children).filter(
        (child) => child.children.length > 0,
      ) as HTMLElement[];
    const shown = () =>
      frames().filter((frame) => frame.style.visibility !== 'hidden');
    return {
      fixture,
      router: routerService,
      location,
      host,
      settle,
      go,
      frames,
      shown,
    };
  };

  describe('the stack', () => {
    it('shows the first page in a frame filling the outlet', async () => {
      const { frames, fixture } = await setup();
      expect(frames()).toHaveLength(1);
      const frame = frames()[0]!;
      expect(frame.style.position).toBe('absolute');
      expect(frame.style.backgroundColor).toBe('var(--background, #ffffff)');
      expect(frame.textContent).toBe('page');
      expect(animate).not.toHaveBeenCalled();
      const outlet = outletOf(fixture);
      expect(outlet.isActivated).toBe(true);
      expect(outlet.component).toBe(made[0]);
      expect(outlet.activatedComponentRef?.instance).toBe(made[0]);
      expect(outlet.activatedRoute.snapshot.url.join('/')).toBe('notes');
      expect(outlet.activatedRouteData).toEqual({});
    });

    it('pushes a deeper page over the last one, which stays alive', async () => {
      const { go, frames, shown, settle, host } = await setup();
      layOut(host);
      await go('/notes/1');
      expect(frames()).toHaveLength(2);
      // The new page starts off to the right, then slides in on the next turn.
      expect(frames()[1]!.style.transform).toBe('translateX(400px)');
      expect(animate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(0);
      expect(animate).toHaveBeenCalledWith(
        [
          { transform: 'translateX(400px)', opacity: '1' },
          { transform: 'translateX(0px)', opacity: '1' },
        ],
        expect.objectContaining({ duration: 350, fill: 'forwards' }),
      );
      // Rounded and shadowed while it moves.
      expect(frames()[1]!.style.borderRadius).toBe('62px');
      await settle();
      expect(shown()).toEqual([frames()[1]]);
      expect(frames()[1]!.style.borderRadius).toBe('');
      expect(made[0]!.destroyed).toBe(false);
    });

    it('pops back to a page in the stack, which keeps its state', async () => {
      const { go, location, frames, shown, settle } = await setup();
      await go('/notes/1');
      await settle();
      location.back();
      // Angular follows the history a turn later, then the slide starts.
      await vi.advanceTimersByTimeAsync(20);
      // The page under slides back in from a third of the way left.
      expect(animate).toHaveBeenCalledWith(
        [
          { transform: 'translateX(0%)', opacity: '1' },
          { transform: 'translateX(100%)', opacity: '1' },
        ],
        expect.anything(),
      );
      expect(animate).toHaveBeenCalledWith(
        [
          { transform: 'translateX(-30%)', opacity: '1' },
          { transform: 'translateX(0%)', opacity: '1' },
        ],
        expect.anything(),
      );
      await settle();
      expect(frames()).toHaveLength(1);
      expect(shown()).toEqual(frames());
      expect(made[1]!.destroyed).toBe(true);
      expect(made[0]!.destroyed).toBe(false);
      expect(made).toHaveLength(2);
    });

    it('pops back to a page by a link to it', async () => {
      const { go, frames, settle } = await setup();
      await go('/notes/1');
      await go('/notes/1/edit');
      await settle();
      expect(frames()).toHaveLength(3);
      await go('/notes');
      await settle();
      expect(frames()).toHaveLength(1);
      expect(made.map((page) => page.destroyed)).toEqual([false, true, true]);
    });

    it('starts a new stack at once for a page at the same depth', async () => {
      const { go, frames, settle } = await setup();
      await go('/notes/1');
      await settle();
      animate.mockClear();
      await go('/settings');
      expect(frames()).toHaveLength(1);
      expect(made.map((page) => page.destroyed)).toEqual([true, true, false]);
      await settle();
      expect(animate).not.toHaveBeenCalled();
    });

    it('slides in a page that the top one is under from behind', async () => {
      const { go, frames, settle } = await setup([], '/notes/1');
      await go('/notes');
      // The new page goes under the old one, which slides away.
      expect(frames()).toHaveLength(2);
      expect(frames()[0]!.textContent).toBe('page');
      await vi.advanceTimersByTimeAsync(0);
      expect(animate).toHaveBeenCalled();
      await settle();
      expect(frames()).toHaveLength(1);
      expect(made.map((page) => page.destroyed)).toEqual([true, false]);
    });

    it('slides the top page away over a new stack, dropping the rest at once', async () => {
      const { go, frames, settle } = await setup();
      await go('/notes/1');
      await go('/notes/1/edit');
      await settle();
      await go('/settings', { info: { stack: 'pop' } });
      expect(frames()).toHaveLength(2);
      await settle();
      expect(frames()).toHaveLength(1);
      expect(made.map((page) => page.destroyed)).toEqual([
        true,
        true,
        true,
        false,
      ]);
    });

    it("tells each page whether it's on top", async () => {
      const { go, location, settle } = await setup();
      await go('/notes/1');
      await settle();
      expect(made.map((page) => page.stackPage.active())).toEqual([
        false,
        true,
      ]);
      location.back();
      await settle();
      expect(made[0]!.stackPage.active()).toBe(true);
    });

    it('hands pages to a reuse strategy and takes them back', async () => {
      const stored = new Map<string, DetachedRouteHandle>();
      class KeepNotes extends BaseRouteReuseStrategy {
        override shouldDetach(route: ActivatedRouteSnapshot): boolean {
          return route.routeConfig?.path === 'notes/:id';
        }
        override store(
          route: ActivatedRouteSnapshot,
          handle: DetachedRouteHandle | null,
        ): void {
          if (handle) stored.set(route.url.join('/'), handle);
        }
        override shouldAttach(route: ActivatedRouteSnapshot): boolean {
          return stored.has(route.url.join('/'));
        }
        override retrieve(
          route: ActivatedRouteSnapshot,
        ): DetachedRouteHandle | null {
          return stored.get(route.url.join('/')) ?? null;
        }
      }
      const { go, frames, fixture, settle } = await setup([
        { provide: RouteReuseStrategy, useClass: KeepNotes },
      ]);
      const outlet = outletOf(fixture);
      const detached = vi.fn();
      const attached = vi.fn();
      outlet.detachEvents.subscribe(detached);
      outlet.attachEvents.subscribe(attached);
      await go('/notes/1');
      await settle();
      const note = made[1]!;
      // Leaving the note for a page at the same depth hands it to the strategy.
      await go('/settings');
      await settle();
      expect(detached).toHaveBeenCalledWith(note);
      expect(note.destroyed).toBe(false);
      expect(frames()).toHaveLength(1);
      // Going to it again takes it back, and its route follows.
      await go('/notes/1?again=1');
      await settle();
      expect(attached).toHaveBeenCalledWith(note);
      expect(outlet.component).toBe(note);
      expect(note.queryParams.at(-1)).toEqual({ again: '1' });
    });

    it('swaps the top page at once when the URL is replaced', async () => {
      const { go, frames, settle } = await setup();
      await go('/notes/1');
      await settle();
      animate.mockClear();
      await go('/settings', { replaceUrl: true });
      await settle();
      // The page under the replaced one stays.
      expect(frames()).toHaveLength(2);
      expect(made.map((page) => page.destroyed)).toEqual([false, true, false]);
      expect(animate).not.toHaveBeenCalled();
      await go('/notes/1/edit', { info: { stack: 'root' } });
      expect(frames()).toHaveLength(1);
    });

    it("follows the navigation's info", async () => {
      const { go, frames, settle } = await setup();
      await go('/settings', { info: { stack: 'push' } });
      await settle();
      expect(frames()).toHaveLength(2);
    });

    it('finishes a transition at once when another navigation comes', async () => {
      const { go, frames, shown, settle } = await setup();
      await go('/notes/1');
      await go('/notes/1/edit');
      expect(frames()).toHaveLength(3);
      // The first push finished when the second came: its page is hidden.
      expect(shown()).toHaveLength(2);
      await settle();
      expect(shown()).toHaveLength(1);
    });

    it('pushes and pops back again in one turn', async () => {
      const { go, location, frames, settle } = await setup();
      await go('/notes/1');
      location.back();
      await settle();
      expect(frames()).toHaveLength(1);
    });

    it('goes forward through the history with a push', async () => {
      const { go, location, frames, settle } = await setup();
      await go('/notes/1');
      await settle();
      location.back();
      await settle();
      location.forward();
      await settle();
      expect(frames()).toHaveLength(2);
    });

    it('leaves a named outlet empty when the router clears it', async () => {
      const { go, host, settle } = await setup();
      const side = host.nextElementSibling as HTMLElement;
      await go('/notes(side:aside)');
      await settle();
      expect(side.children).toHaveLength(1);
      await go('/notes');
      await settle();
      expect(side.children).toHaveLength(0);
    });

    it('throws when activated twice, or read while empty, as RouterOutlet does', async () => {
      const { fixture } = await setup();
      const outlet = outletOf(fixture);
      expect(() =>
        outlet.activateWith(
          outlet.activatedRoute,
          TestBed.inject(Router)['injector' as never],
        ),
      ).toThrow('Cannot activate an already activated outlet');
      outlet.deactivate();
      expect(outlet.isActivated).toBe(false);
      expect(() => outlet.component).toThrow('Outlet is not activated');
      expect(outlet.activatedRouteData).toEqual({});
      expect(outlet.activatedComponentRef).toBeNull();
      // Deactivating again does nothing.
      outlet.deactivate();
    });

    it('throws for a route without a component', async () => {
      const { fixture } = await setup();
      const outlet = outletOf(fixture);
      const route = outlet.activatedRoute;
      outlet.deactivate();
      const empty = Object.create(route, {
        snapshot: { value: { ...route.snapshot, component: null } },
      });
      expect(() => outlet.activateWith(empty, undefined as never)).toThrow(
        'The route has no component to show',
      );
    });
  });

  describe('pages', () => {
    it('give each page its route, and the outlet data', async () => {
      const { go, settle } = await setup();
      await go('/notes/1');
      await settle();
      expect(made[1]!.route.snapshot.paramMap.get('id')).toBe('1');
      expect(made[1]!.outletData()).toBe('outlet data');
    });

    it('keeps a page’s route live when the app comes back to it', async () => {
      const { go, settle } = await setup();
      await go('/notes?q=a');
      await go('/notes/1');
      await settle();
      await go('/notes?q=b');
      await settle();
      const page = made[0]!;
      expect(page.queryParams).toEqual([{}, { q: 'a' }, { q: 'b' }]);
      expect(page.params).toEqual([{}]);
    });

    it('binds route params to inputs, again when the page comes back', async () => {
      const { go, fixture, settle } = await setup([], '/input/1');
      const outlet = outletOf(fixture);
      expect((outlet.component as InputPage).id).toBe('1');
      await go('/input/1/../../input/1?id=2', { info: { stack: 'push' } });
      await settle();
      expect((outlet.component as InputPage).id).toBe('1');
    });

    it("brings back the outlets of a page's own when the app comes back to it", async () => {
      const { go, frames, settle } = await setup([], '/parent/child');
      expect(made).toHaveLength(1);
      await go('/notes/1/edit');
      await settle();
      await go('/parent/child', { info: { stack: 'pop' } });
      await settle();
      // The parent page came back, and its outlet shows its child again.
      expect(frames()).toHaveLength(1);
      expect(frames()[0]!.textContent).toBe('page');
      expect(made).toHaveLength(3);
    });

    it('draws pages on its classes instead of the theme background', async () => {
      const { fixture, frames } = await setup();
      const outlet = outletOf(fixture);
      setInput(outlet, 'pageClass', 'bg-card');
      TestBed.tick();
      expect(frames()[0]!.className).toBe('bg-card');
      expect(frames()[0]!.style.backgroundColor).toBe('');
      setInput(outlet, 'pageClass', '');
      TestBed.tick();
      expect(frames()[0]!.style.backgroundColor).toBe(
        'var(--background, #ffffff)',
      );
    });
  });

  describe('motion', () => {
    it('cross-fades while Reduce Motion is on', async () => {
      const { go } = await setup([
        {
          provide: LynxAccessibilitySettings,
          useValue: { reduceMotion: () => true },
        },
      ]);
      await go('/notes/1');
      await vi.advanceTimersByTimeAsync(0);
      expect(animate).toHaveBeenCalledWith(
        [
          { transform: 'translateX(0%)', opacity: '0' },
          { transform: 'translateX(0%)', opacity: '1' },
        ],
        expect.objectContaining({ duration: 250 }),
      );
    });

    it('slides and fades as Android does on Android', async () => {
      vi.stubGlobal('SystemInfo', { platform: 'Android' });
      const { go } = await setup();
      await go('/notes/1');
      await vi.advanceTimersByTimeAsync(0);
      expect(animate).toHaveBeenCalledWith(
        [
          { transform: 'translateX(10%)', opacity: '0' },
          { transform: 'translateX(0%)', opacity: '1' },
        ],
        expect.objectContaining({ duration: 450 }),
      );
    });

    it("moves nothing with animation 'none'", async () => {
      const { go, fixture, frames, location, settle } = await setup();
      setInput(outletOf(fixture), 'animation', 'none');
      await go('/notes/1');
      await settle();
      location.back();
      await settle();
      expect(animate).not.toHaveBeenCalled();
      expect(frames()).toHaveLength(1);
    });

    it('rounds only the corners in a corner of the screen', async () => {
      const { go, frames, host } = await setup();
      // Under an app bar: the top corners meet the bar, the bottom ones are
      // the screen's.
      layOut(host, { left: 0, top: 100, width: 400, height: 700 });
      await go('/notes/1');
      expect(frames()[1]!.style.borderRadius).toBe('0px 0px 62px 62px');
    });

    it('moves pages with square corners in no corner of the screen', async () => {
      const { go, frames, host } = await setup();
      layOut(host, { left: 0, top: 100, width: 400, height: 600 });
      await go('/notes/1');
      expect(frames()[1]!.style.borderRadius).toBe('');
      expect(frames()[1]!.style.boxShadow).not.toBe('');
    });

    it('moves pages with square corners before the outlet is laid out', async () => {
      const { go, frames } = await setup();
      await go('/notes/1');
      expect(frames()[1]!.style.transform).toBe('translateX(100%)');
      expect(frames()[1]!.style.borderRadius).toBe('');
    });

    it('moves pages with square corners on a screen of no known size', async () => {
      const { go, frames, host } = await setup();
      layOut(host);
      vi.stubGlobal('innerWidth', undefined);
      vi.stubGlobal('innerHeight', undefined);
      await go('/notes/1');
      expect(frames()[1]!.style.borderRadius).toBe('');
    });

    it('measures the outlet in px once it has been laid out', async () => {
      const { go, host } = await setup();
      layOut(host);
      await go('/notes/1');
      await vi.advanceTimersByTimeAsync(0);
      expect(animate.mock.calls[0]![0]).toEqual([
        { transform: 'translateX(400px)', opacity: '1' },
        { transform: 'translateX(0px)', opacity: '1' },
      ]);
    });

    it('abandons a transition when it is destroyed', async () => {
      const { go, fixture } = await setup();
      await go('/notes/1');
      await vi.advanceTimersByTimeAsync(0);
      const animation = animate.mock.results[0]!.value as {
        cancel: Animate;
      };
      fixture.destroy();
      expect(animation.cancel).toHaveBeenCalled();
    });
  });

  describe('swipe back', () => {
    /**
     * Two pages, the outlet laid out 400 wide.
     */
    const pushed = async (providers: Provider[] = []) => {
      const harness = await setup(providers);
      layOut(harness.host);
      await harness.go('/notes/1');
      await harness.settle();
      animate.mockClear();
      return harness;
    };

    const touch = (
      target: Element,
      type: string,
      x: number,
      y = 300,
      identifier = 0,
    ) => {
      const event = new Event(`bind${type}`, { bubbles: true });
      const point = { identifier, pageX: x, pageY: y };
      Object.assign(event, {
        touches: type === 'touchend' || type === 'touchcancel' ? [] : [point],
        changedTouches: [point],
      });
      target.dispatchEvent(event);
    };

    /**
     * A drag from `from` to `to`, `ms` apart per 10px.
     */
    const drag = async (target: Element, from: number, to: number, ms = 16) => {
      touch(target, 'touchstart', from);
      const step = to > from ? 10 : -10;
      for (let x = from + step; step > 0 ? x <= to : x >= to; x += step) {
        await vi.advanceTimersByTimeAsync(ms);
        touch(target, 'touchmove', x);
      }
    };

    it('drags the top page with the finger over the page under it', async () => {
      const { frames, shown } = await pushed();
      const [under, top] = frames();
      await drag(top!.firstElementChild!, 100, 300, 50);
      expect(top!.style.transform).toBe('translateX(200px)');
      expect(top!.style.borderRadius).toBe('62px');
      expect(under!.style.transform).toBe('translateX(-60px)');
      expect(shown()).toHaveLength(2);
    });

    it('goes back when let go past the middle', async () => {
      const { frames, location, settle } = await pushed();
      const back = vi.spyOn(location, 'historyGo');
      const top = frames()[1]!;
      await drag(top.firstElementChild!, 100, 320, 100);
      touch(top.firstElementChild!, 'touchend', 320);
      await settle();
      expect(back).toHaveBeenCalledWith(-1);
      expect(frames()).toHaveLength(1);
      expect(made[1]!.destroyed).toBe(true);
    });

    it('brings the page back when let go short of the middle', async () => {
      const { frames, shown, settle } = await pushed();
      const top = frames()[1]!;
      await drag(top.firstElementChild!, 100, 160, 100);
      touch(top.firstElementChild!, 'touchend', 160);
      await settle();
      expect(frames()).toHaveLength(2);
      expect(shown()).toEqual([top]);
      expect(top.style.transform).toBe('translateX(0px)');
    });

    it('brings the page back when the touch is canceled', async () => {
      const { frames, shown, settle } = await pushed();
      const top = frames()[1]!;
      await drag(top.firstElementChild!, 100, 320, 100);
      touch(top.firstElementChild!, 'touchcancel', 320);
      await settle();
      expect(shown()).toEqual([top]);
    });

    it('brings the page back when a guard keeps the app on it', async () => {
      const harness = await setup();
      layOut(harness.host);
      await harness.go('/guarded/1');
      await harness.settle();
      canLeave = false;
      const top = harness.frames()[1]!;
      await drag(top.firstElementChild!, 100, 320, 100);
      touch(top.firstElementChild!, 'touchend', 320);
      await harness.settle();
      expect(harness.frames()).toHaveLength(2);
      expect(harness.shown()).toEqual([top]);
      expect(top.style.transform).toBe('translateX(0px)');
    });

    it('leaves a touch that moves left or up to the page', async () => {
      const { frames, settle } = await pushed();
      const top = frames()[1]!;
      await drag(top.firstElementChild!, 200, 100);
      touch(top.firstElementChild!, 'touchend', 100);
      await settle();
      expect(top.style.transform).toBe('translateX(0px)');
      expect(animate).not.toHaveBeenCalled();
    });

    it('leaves a touch that never moved far enough to the page', async () => {
      const { frames, settle } = await pushed();
      const top = frames()[1]!;
      touch(top.firstElementChild!, 'touchstart', 100);
      touch(top.firstElementChild!, 'touchmove', 105);
      touch(top.firstElementChild!, 'touchend', 105);
      await settle();
      expect(animate).not.toHaveBeenCalled();
    });

    it('follows only the finger that started it', async () => {
      const { frames } = await pushed();
      const top = frames()[1]!;
      await drag(top.firstElementChild!, 100, 200);
      const before = top.style.transform;
      touch(top.firstElementChild!, 'touchmove', 380, 300, 1);
      expect(top.style.transform).toBe(before);
      // Another finger lifting leaves this one dragging.
      touch(top.firstElementChild!, 'touchend', 380, 300, 1);
      touch(top.firstElementChild!, 'touchmove', 220);
      expect(top.style.transform).toBe('translateX(120px)');
      // A second touch can't start another swipe meanwhile.
      touch(top.firstElementChild!, 'touchstart', 50, 300, 1);
    });

    it('swipes from the edge in something that scrolls sideways, and not elsewhere in it', async () => {
      const { frames, settle } = await pushed();
      const top = frames()[1]!;
      const scroller = document.createElement('scroll-view');
      scroller.setAttribute('scroll-orientation', 'horizontal');
      top.firstElementChild!.appendChild(scroller);
      await drag(scroller, 100, 300);
      expect(top.style.transform).toBe('translateX(0px)');
      touch(scroller, 'touchend', 300);

      const swiper = document.createElement('viewpager');
      top.firstElementChild!.appendChild(swiper);
      await drag(swiper, 100, 300);
      expect(top.style.transform).toBe('translateX(0px)');
      touch(swiper, 'touchend', 300);

      await drag(scroller, 10, 210);
      expect(top.style.transform).toBe('translateX(200px)');
      touch(scroller, 'touchend', 210);
      await settle();
    });

    it("reads a Lynx touch's target by its unique id", async () => {
      const { frames, host } = await pushed();
      const top = frames()[1]!;
      const event = new Event('bindtouchstart');
      Object.assign(event, {
        touches: [{ identifier: 0, pageX: 100, pageY: 300 }],
      });
      Object.defineProperty(event, 'target', { value: { uid: 12345 } });
      host.dispatchEvent(event);
      await drag(top.firstElementChild!, 100, 200);
      // The touch that started it was already the swipe's.
      expect(top.style.transform).toBe('translateX(100px)');
    });

    it("doesn't swipe with swipeBack off, one page, or mid-transition", async () => {
      const { fixture, frames, go } = await pushed();
      const outlet = outletOf(fixture);
      setInput(outlet, 'swipeBack', false);
      const top = frames()[1]!;
      await drag(top.firstElementChild!, 10, 210);
      expect(top.style.transform).toBe('translateX(0px)');
      touch(top.firstElementChild!, 'touchend', 210);
      setInput(outlet, 'swipeBack', true);

      await go('/notes/1/edit');
      const newTop = frames()[2]!;
      await drag(newTop.firstElementChild!, 10, 210);
      expect(newTop.style.transform).toBe('translateX(400px)');
      touch(newTop.firstElementChild!, 'touchend', 210);
    });

    it("doesn't swipe before the outlet is laid out", async () => {
      const { frames, go, settle, host } = await setup();
      await go('/notes/1');
      await settle();
      const top = frames()[1]!;
      expect(host.getBoundingClientRect().width).toBe(0);
      await drag(top.firstElementChild!, 10, 210);
      expect(top.style.transform).toBe('translateX(0%)');
    });

    it('lets go of a drag when a navigation comes', async () => {
      const { frames, shown, go, settle } = await pushed();
      const top = frames()[1]!;
      await drag(top.firstElementChild!, 100, 300);
      await go('/notes/1/edit');
      await settle();
      expect(shown()).toEqual([frames()[2]]);
      expect(top.style.borderRadius).toBe('');
    });

    it('goes back with Location.back() without the Lynx history', async () => {
      const harness = await setup([], '/notes', [
        provideAngularRouter(ROUTES),
        { provide: LocationStrategy, useClass: MockLocationStrategy },
      ]);
      layOut(harness.host);
      await harness.go('/notes/1');
      await harness.settle();
      const back = vi.spyOn(harness.location, 'back');
      const top = harness.frames()[1]!;
      await drag(top.firstElementChild!, 100, 320, 100);
      touch(top.firstElementChild!, 'touchend', 320);
      await harness.settle();
      expect(back).toHaveBeenCalled();
      expect(harness.frames()).toHaveLength(1);
    });

    it('swipes back over a stack of three, leaving the bottom page hidden', async () => {
      const { go, frames, shown, settle } = await pushed();
      await go('/notes/1/edit');
      await settle();
      const top = frames()[2]!;
      await drag(top.firstElementChild!, 100, 320, 100);
      touch(top.firstElementChild!, 'touchend', 320);
      await settle();
      expect(frames()).toHaveLength(2);
      expect(shown()).toEqual([frames()[1]]);
    });

    it('drags with the mouse in the web preview', async () => {
      vi.stubGlobal('__WEB__', true);
      const { frames, settle } = await pushed();
      const top = frames()[1]!;
      const target = top.firstElementChild!;
      const mouse = (type: string, x: number, buttons = 1) => {
        const event = new Event(`bind${type}`, { bubbles: true });
        Object.assign(event, { x, y: 300, buttons });
        target.dispatchEvent(event);
      };
      mouse('mousedown', 100);
      // Moves without a position, or before a press, do nothing.
      const blank = new Event('bindmousemove', { bubbles: true });
      target.dispatchEvent(blank);
      for (let x = 110; x <= 320; x += 10) {
        await vi.advanceTimersByTimeAsync(100);
        mouse('mousemove', x);
      }
      expect(top.style.transform).toBe('translateX(220px)');
      mouse('mouseup', 320);
      await settle();
      expect(frames()).toHaveLength(1);

      // A press without a position doesn't start one.
      const press = new Event('bindmousedown', { bubbles: true });
      frames()[0]!.dispatchEvent(press);
      // A move without the button held is a release the outlet missed.
      mouse('mousemove', 100, 0);
    });

    it('lets a mouse drag go when the button came up outside the view', async () => {
      vi.stubGlobal('__WEB__', true);
      const { frames, settle } = await pushed();
      const top = frames()[1]!;
      const target = top.firstElementChild!;
      const mouse = (type: string, x: number, buttons = 1) => {
        const event = new Event(`bind${type}`, { bubbles: true });
        Object.assign(event, { x, y: 300, buttons });
        target.dispatchEvent(event);
      };
      mouse('mousedown', 100);
      for (let x = 110; x <= 150; x += 10) mouse('mousemove', x);
      mouse('mousemove', 150, 0);
      await settle();
      expect(top.style.transform).toBe('translateX(0px)');
      // Touches don't drive a mouse drag, nor the mouse a touch's.
      touch(target, 'touchstart', 100);
      mouse('mousemove', 300);
    });

    it("reads Lynx's elements and odd targets", async () => {
      const { frames, host } = await pushed();
      const top = frames()[1]!;
      const startAt = (target: unknown) => {
        const event = new Event('bindtouchstart');
        Object.assign(event, {
          touches: [{ identifier: 0, pageX: 100, pageY: 300 }],
          changedTouches: [],
        });
        Object.defineProperty(event, 'target', { value: target });
        host.dispatchEvent(event);
        touch(top, 'touchend', 100);
      };
      // No target, a target Lynx knows by id, and one out of the tree.
      startAt(null);
      const lynxParent = {
        tagName: 'view',
        getAttribute: () => null,
        parentNode: () => null,
      };
      vi.spyOn(LynxElement, 'byUniqueId').mockReturnValue({
        tagName: 'list',
        getAttribute: (name: string) =>
          name === 'scroll-orientation' ? 'vertical' : null,
        parentNode: () => lynxParent,
      } as never);
      startAt({ uid: 7 });
      startAt(document.createElement('view'));
      // A scroll-view across with scroll-x swipes only from the edge.
      const scroller = document.createElement('scroll-view');
      scroller.setAttribute('scroll-x', 'true');
      top.firstElementChild!.appendChild(scroller);
      await drag(scroller, 100, 300);
      expect(top.style.transform).toBe('translateX(0px)');
    });

    it('shrinks the page as Android’s predictive back does on Android', async () => {
      vi.stubGlobal('SystemInfo', { platform: 'Android' });
      const { frames } = await pushed();
      const top = frames()[1]!;
      await drag(top.firstElementChild!, 100, 300);
      expect(top.style.transform).toBe('translateX(10px) scale(0.95)');
      expect(top.style.borderRadius).toBe('28px');
    });

    it('rounds the square corners as the page shrinks on Android', async () => {
      vi.stubGlobal('SystemInfo', { platform: 'Android' });
      const harness = await setup();
      layOut(harness.host, { left: 0, top: 100, width: 400, height: 700 });
      await harness.go('/notes/1');
      await harness.settle();
      const top = harness.frames()[1]!;
      // Square under the app bar as the drag starts, and halfway to 28px
      // halfway across.
      await drag(top.firstElementChild!, 100, 300);
      expect(top.style.borderRadius).toBe('14px 14px 28px 28px');
      // Lynx can't animate the radius: the page keeps it as it goes.
      touch(top.firstElementChild!, 'touchend', 300);
      await vi.advanceTimersByTimeAsync(0);
      expect(top.style.borderRadius).toBe('14px 14px 28px 28px');
    });

    it('keeps the corners of a page that doesn’t shrink as it drags', async () => {
      const harness = await setup();
      layOut(harness.host, { left: 0, top: 100, width: 400, height: 700 });
      await harness.go('/notes/1');
      await harness.settle();
      const top = harness.frames()[1]!;
      await drag(top.firstElementChild!, 100, 300);
      expect(top.style.borderRadius).toBe('0px 0px 62px 62px');
    });
  });
});

/**
 * The primary outlet in the host.
 */
const outletOf = (fixture: { debugElement: DebugElement }): LynxStackOutlet =>
  fixture.debugElement.query(By.directive(LynxStackOutlet))
    .componentInstance as LynxStackOutlet;

/**
 * Gives an element a box, as Lynx would once it's laid out, on a 400×800
 * screen (the LynxView): the whole screen unless told otherwise.
 */
const layOut = (
  element: HTMLElement,
  box = { left: 0, top: 0, width: 400, height: 800 },
): void => {
  element.getBoundingClientRect = () => box as DOMRect;
  vi.stubGlobal('innerWidth', 400);
  vi.stubGlobal('innerHeight', 800);
};

/**
 * Sets a signal input: JIT-compiled tests don't wire signal inputs up to
 * template bindings or setInput().
 */
const setInput = (component: object, name: string, value: unknown): void => {
  const input = (component as Record<string, unknown>)[name] as object;
  const symbol = Object.getOwnPropertySymbols(input).find(
    (s) => s.toString() === 'Symbol(SIGNAL)',
  )!;
  const node = (input as Record<symbol, object>)[symbol]!;
  (
    Object.getPrototypeOf(node) as {
      applyValueToInputSignal(node: object, value: unknown): void;
    }
  ).applyValueToInputSignal(node, value);
};
