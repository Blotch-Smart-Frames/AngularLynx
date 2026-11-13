// @vitest-environment jsdom
import '@angular/compiler';
import { Location, LocationStrategy } from '@angular/common';
import { MockLocationStrategy } from '@angular/common/testing';
import {
  Component,
  EnvironmentInjector,
  type OnDestroy,
  type Provider,
  createComponent,
  inject,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {
  type ActivatedRouteSnapshot,
  type DetachedRouteHandle,
  type Params,
  type Route,
  type UrlSegment,
  ActivatedRoute,
  BaseRouteReuseStrategy,
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
import type { LynxLocationStrategy } from '../lynx-location-strategy';
import { provideRouter } from '../lynx-router';
import { LynxStackOutlet } from '../stack/lynx-stack-outlet';
import { LynxStackPage } from '../stack/stack-page';
import { LynxTabOutlet } from './lynx-tab-outlet';
import { LynxTabPage } from './tab-page';

/** Every screen made, so a test can find one and its fate. */
const made: Page[] = [];

@Component({ selector: 'test-page', template: 'page' })
class Page implements OnDestroy {
  readonly route = inject(ActivatedRoute);
  readonly outletData = inject(ROUTER_OUTLET_DATA);
  readonly tab = inject(LynxTabPage, { optional: true });
  readonly stackPage = inject(LynxStackPage, { optional: true });
  destroyed = false;
  readonly params: Params[] = [];

  constructor() {
    made.push(this);
    this.route.params.subscribe((params) => this.params.push(params));
  }

  /**
   * Where the screen is, as its route has it.
   */
  get path(): string {
    return this.route.snapshot.pathFromRoot
      .flatMap((route) => route.url.map(String))
      .join('/');
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }
}

/**
 * Microtasks held back while a test says, to run when a screen is built, as
 * a device runs the pending ones inside a synchronous UI method call (the
 * `boundingClientRect` a `getBoundingClientRect()` asks for).
 */
let held: (() => void)[] | null = null;

/**
 * A screen that measures itself as it's built, running held microtasks.
 */
@Component({ selector: 'test-measured', template: 'measured' })
class Measured {
  constructor() {
    for (const task of held?.splice(0) ?? []) task();
  }
}

/**
 * A tab whose screens are a stack.
 */
@Component({
  selector: 'test-stack-tab',
  template: '<lynx-stack-outlet />',
  imports: [LynxStackOutlet],
})
class StackTab {}

/**
 * A tab with a stack and a named stack beside it.
 */
@Component({
  selector: 'test-two-stacks-tab',
  template: '<lynx-stack-outlet /><lynx-stack-outlet name="side" />',
  imports: [LynxStackOutlet],
})
class TwoStacksTab {}

/**
 * A tab whose screens are in a plain router outlet.
 */
@Component({
  selector: 'test-plain-tab',
  template: '<router-outlet />',
  imports: [RouterOutlet],
})
class PlainTab {}

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
 * The app's shell: the tabs, as beside a tab bar.
 */
@Component({
  selector: 'test-shell',
  template: '<lynx-tab-outlet /><lynx-tab-outlet name="side" />',
  imports: [LynxTabOutlet],
})
class Shell {}

/**
 * A stack, whose pages can hold tabs.
 */
@Component({
  selector: 'test-stack-host',
  template: '<lynx-stack-outlet />',
  imports: [LynxStackOutlet],
})
class StackHost {}

@Component({
  selector: 'test-root',
  template: '<router-outlet />',
  imports: [RouterOutlet],
})
class Root {}

/** A tab route matched without a path. */
const MATCHED: Route = {
  matcher: (segments: UrlSegment[]) =>
    segments[0]?.path === 'matched' ? { consumed: segments.slice(0, 1) } : null,
  component: Page,
};

const ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'login', component: Page },
  // Tabs in a route without a component of its own.
  {
    path: 'group',
    children: [
      {
        path: 'tabs',
        component: Shell,
        children: [
          { path: 'a', component: Page },
          { path: 'b', component: Page },
        ],
      },
    ],
  },
  {
    path: 'stacked',
    component: StackHost,
    children: [
      {
        path: 'tabs',
        component: Shell,
        children: [
          { path: 'a', component: Page },
          { path: 'b', component: Page },
          { path: 'aside', component: Page, outlet: 'side' },
        ],
      },
      // Deeper than the tabs: the stack pushes it over them.
      { path: 'tabs/a/more', component: Page },
    ],
  },
  {
    path: '',
    component: Shell,
    children: [
      {
        path: 'home',
        component: StackTab,
        children: [
          { path: '', component: Page },
          { path: 'notes/:id', component: Page },
          { path: 'measured', component: Measured },
        ],
      },
      { path: 'pages', component: Page },
      { path: 'measured', component: Measured },
      { path: 'profile', component: Page, data: { keepAlive: false } },
      { path: 'kept', component: Page, data: { keepAlive: true } },
      {
        path: 'item/:id',
        component: InputPage,
        runGuardsAndResolvers: 'always',
      },
      {
        path: 'nested',
        component: PlainTab,
        children: [
          { path: '', component: Page },
          { path: 'child', component: Page },
        ],
      },
      {
        path: 'two',
        component: TwoStacksTab,
        children: [
          { path: '', component: Page },
          { path: 'aux', component: Page, outlet: 'side' },
        ],
      },
      MATCHED,
    ],
  },
];

describe('LynxTabOutlet', () => {
  let animate: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    made.length = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    animate = vi.fn(() => ({ cancel: vi.fn() }));
    // jsdom has no Web Animations.
    (Element.prototype as unknown as { animate: typeof animate }).animate =
      animate;
  });

  afterEach(() => {
    held = null;
    TestBed.resetTestingModule();
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    vi.useRealTimers();
  });

  const setup = async (
    url = '/home',
    providers: Provider[] = [],
    router: Provider[] | ReturnType<typeof provideRouter> = provideRouter(
      ROUTES,
      withComponentInputBinding(),
    ),
  ) => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), router, ...providers],
    });
    const fixture = TestBed.createComponent(Root);
    fixture.detectChanges();
    const routerService = TestBed.inject(Router);
    const location = TestBed.inject(Location);
    routerService.initialNavigation();
    const settle = async () => {
      await vi.advanceTimersByTimeAsync(1000);
      fixture.detectChanges();
    };
    const go = async (path: string, extras = {}) => {
      const done = await routerService.navigateByUrl(path, extras);
      await settle();
      return done;
    };
    const back = async () => {
      location.back();
      await settle();
    };
    await go(url);
    const outlet = () =>
      fixture.debugElement.query(By.directive(LynxTabOutlet))
        .componentInstance as LynxTabOutlet;
    const host = () =>
      fixture.nativeElement.querySelector('lynx-tab-outlet') as HTMLElement;
    /**
     * The tabs' frames, the first made first.
     */
    const frames = () => Array.from(host().children) as HTMLElement[];
    /**
     * The frame of the tab shown.
     */
    const shown = () =>
      frames().filter((frame) => frame.style.visibility !== 'hidden');
    /**
     * The screens alive, by where they are.
     */
    const alive = () =>
      made.filter((page) => !page.destroyed).map((page) => page.path);
    return {
      fixture,
      router: routerService,
      location,
      go,
      back,
      settle,
      outlet,
      host,
      frames,
      shown,
      alive,
    };
  };

  /**
   * The live screen at `path`, of those made.
   */
  const at = (path: string): Page =>
    made.findLast((page) => !page.destroyed && page.path === path)!;

  describe('tabs', () => {
    it('shows the first tab in a frame filling the outlet', async () => {
      const { frames, shown, host } = await setup('/pages');
      expect(frames()).toHaveLength(1);
      expect(shown()).toEqual(frames());
      expect(frames()[0]!.style.position).toBe('absolute');
      expect(frames()[0]!.textContent).toBe('page');
      expect(host().getAttribute('flatten')).toBe('false');
    });

    it('keeps a tab another one replaces, hidden, and shows it again as it was', async () => {
      const { go, frames, shown, alive } = await setup('/pages');
      const pages = at('pages');
      await go('/profile');
      expect(pages.destroyed).toBe(false);
      expect(frames()).toHaveLength(2);
      expect(shown()).toEqual([frames()[1]]);
      expect(frames()[0]!.style.visibility).toBe('hidden');
      expect(frames()[0]!.style.transform).toBe('translateX(100%)');
      await go('/pages');
      // The same screen, nothing built again.
      expect(at('pages')).toBe(pages);
      expect(shown()).toEqual([frames()[0]]);
      expect(frames()[0]!.style.transform).toBe('');
      expect(made.filter((page) => page.path === 'pages')).toHaveLength(1);
      expect(alive()).toEqual(['pages']);
    });

    it("tells each tab's components whether it's shown", async () => {
      const { go } = await setup('/pages');
      const tab = at('pages').tab!;
      expect(tab.active()).toBe(true);
      await go('/kept');
      expect(tab.active()).toBe(false);
      expect(at('kept').tab!.active()).toBe(true);
      await go('/pages');
      expect(tab.active()).toBe(true);
    });

    it('gives each tab its route, kept live, and the outlet data', async () => {
      const { go, outlet } = await setup('/pages');
      const pages = at('pages');
      expect(pages.outletData).toBe(outlet().routerOutletData);
      expect(outlet().activatedRoute.snapshot.url.join('/')).toBe('pages');
      expect(outlet().activatedRouteData).toEqual({});
      await go('/kept');
      expect(outlet().activatedRouteData).toEqual({ keepAlive: true });
      await go('/pages?again=1');
      // The router made a new route for the tab, which its old one follows.
      expect(pages.route.snapshot.queryParams).toEqual({ again: '1' });
    });

    it('binds route params to inputs, again when the tab comes back', async () => {
      const { go, outlet } = await setup('/item/1');
      const item = outlet().component as InputPage;
      expect(item.id).toBe('1');
      // The guards run again for the shown tab, which goes where it says.
      await go('/item/2');
      expect(item.id).toBe('2');
      await go('/pages');
      await go('/item/3');
      expect(outlet().component).toBe(item);
      expect(item.id).toBe('3');
    });

    it('destroys a tab whose route says not to keep it', async () => {
      const { go, frames } = await setup('/profile');
      const profile = at('profile');
      await go('/pages');
      expect(profile.destroyed).toBe(true);
      expect(frames()).toHaveLength(1);
      await go('/profile');
      expect(at('profile')).not.toBe(profile);
    });

    it('keeps only the tabs `keep` names, and lets go of others as it changes', async () => {
      const { go, outlet, fixture } = await setup('/pages');
      setInput(outlet(), 'keep', ['pages', 'kept']);
      fixture.detectChanges();
      const pages = at('pages');
      await go('/nested');
      const nested = at('nested');
      await go('/matched');
      expect(nested.destroyed).toBe(true);
      expect(pages.destroyed).toBe(false);
      // A route's own word wins, and a tab without a path isn't named.
      await go('/kept');
      const matched = made.find((page) => page.path === 'matched')!;
      expect(matched.destroyed).toBe(true);
      setInput(outlet(), 'keep', ['kept']);
      fixture.detectChanges();
      expect(pages.destroyed).toBe(true);
      expect(at('kept').destroyed).toBe(false);
    });

    it('destroys every tab when the router leaves the outlet', async () => {
      const { go } = await setup('/pages');
      await go('/home');
      const pages = at('pages');
      const home = at('home');
      await go('/login');
      expect(pages.destroyed).toBe(true);
      expect(home.destroyed).toBe(true);
    });

    it('leaves a named outlet empty when the router clears it', async () => {
      const { go, fixture } = await setup('/stacked/tabs/(a//side:aside)');
      const aside = at('stacked/tabs/aside');
      await go('/stacked/tabs/a');
      expect(aside.destroyed).toBe(true);
      expect(
        fixture.nativeElement.querySelectorAll('lynx-tab-outlet')[1].children,
      ).toHaveLength(0);
    });

    it('throws when activated twice, or read while empty, as RouterOutlet does', async () => {
      const { outlet } = await setup('/pages');
      const tabs = outlet();
      const route = tabs.activatedRoute;
      const injector = TestBed.inject(EnvironmentInjector);
      expect(() => tabs.activateWith(route, injector)).toThrow(
        'Cannot activate an already activated outlet',
      );
      tabs.deactivate();
      expect(tabs.isActivated).toBe(false);
      expect(tabs.activatedComponentRef).toBeNull();
      expect(tabs.activatedRouteData).toEqual({});
      expect(() => tabs.component).toThrow('Outlet is not activated');
      expect(() => tabs.activatedRoute).toThrow('Outlet is not activated');
      // Nothing to leave.
      tabs.deactivate();
      // A route without a component has nothing to show.
      const empty = { snapshot: {} } as ActivatedRoute;
      expect(() => tabs.activateWith(empty, injector)).toThrow(
        'The route has no component to show',
      );
    });
  });

  describe('a stack in a tab', () => {
    it('keeps the stack and its screens while another tab is shown', async () => {
      const { go, router } = await setup('/home');
      await go('/home/notes/1');
      const home = at('home');
      const note = at('home/notes/1');
      expect(note.stackPage!.active()).toBe(true);
      await go('/pages');
      expect(note.destroyed).toBe(false);
      expect(home.destroyed).toBe(false);
      // Covered by the other tab, the stack's top page isn't on top.
      expect(note.stackPage!.active()).toBe(false);
      expect(note.tab!.active()).toBe(false);
      animate.mockClear();

      // The tab's own URL, as its tab bar item has it, goes where the tab
      // was left, without building or moving anything.
      expect(await go('/home')).toBe(true);
      expect(router.url).toBe('/home/notes/1');
      expect(at('home/notes/1')).toBe(note);
      expect(at('home')).toBe(home);
      expect(note.stackPage!.active()).toBe(true);
      expect(animate).not.toHaveBeenCalled();
    });

    it('pops the stack from the tab itself, as tapping the selected tab does', async () => {
      const { go, router } = await setup('/home');
      await go('/home/notes/1');
      const note = at('home/notes/1');
      await go('/home');
      expect(router.url).toBe('/home');
      expect(note.destroyed).toBe(true);
    });

    it('goes back through the stack, and then to the other tab', async () => {
      const { go, back, router, location } = await setup('/home');
      await go('/home/notes/1');
      const home = at('home');
      await go('/pages');
      await go('/home');
      expect(router.url).toBe('/home/notes/1');
      // The history leads back through the stack before the other tab.
      await back();
      expect(router.url).toBe('/home');
      expect(at('home')).toBe(home);
      await back();
      expect(router.url).toBe('/pages');
      const strategy = TestBed.inject(LocationStrategy) as LynxLocationStrategy;
      const index = strategy.historyIndex;
      await back();
      expect(router.url).toBe('/home/notes/1');
      // Back where the history has the stack already: nothing more goes in,
      // and Back goes on through it.
      expect(strategy.historyIndex).toBe(index - 1);
      expect(location.path()).toBe('/home/notes/1');
      await back();
      expect(router.url).toBe('/home');
      expect(strategy.historyIndex).toBe(index - 2);
    });

    it('goes where the history says, and where a navigation says root', async () => {
      const { go, settle, router, location } = await setup('/home');
      await go('/pages');
      await go('/home/notes/2');
      await go('/pages');
      // Back to /home, past the tab left at /home/notes/2: the history says
      // where, and the stack pops there.
      location.historyGo(-2);
      await settle();
      expect(router.url).toBe('/home');
      expect(at('home/notes/2')).toBeUndefined();
      await go('/home/notes/3');
      await go('/pages');
      await go('/home', { info: { stack: 'root' } });
      expect(router.url).toBe('/home');
    });

    it('goes to the tab with a query, or with other params, as it says', async () => {
      const { go, router } = await setup('/home');
      await go('/home/notes/1');
      await go('/pages');
      await go('/home?from=pages');
      expect(router.url).toBe('/home?from=pages');
      await go('/item/1');
      await go('/pages');
      await go('/item/2');
      expect(router.url).toBe('/item/2');
    });

    it('goes to a deeper URL in a hidden tab as it says', async () => {
      const { go, router } = await setup('/home');
      await go('/home/notes/1');
      await go('/pages');
      await go('/home/notes/2');
      expect(router.url).toBe('/home/notes/2');
      expect(at('home/notes/1')).toBeUndefined();
    });

    it("puts back a page whose history entry is gone, under the one it's left at", async () => {
      const { go, back, router } = await setup('/home');
      // To the history's first entry, which redirects to /home in its place.
      await back();
      expect(router.url).toBe('/home');
      // The pushed page takes the first page's entry, the first there is.
      await go('/home/notes/1', { replaceUrl: true, info: { stack: 'push' } });
      await go('/pages');
      await back();
      expect(router.url).toBe('/home/notes/1');
      await back();
      expect(router.url).toBe('/home');
    });

    it('lets go of a stack in a tab the router comes back to without it', async () => {
      const { go } = await setup('/two/(side:aux)');
      const aux = at('two/aux');
      await go('/pages');
      expect(aux.destroyed).toBe(false);
      await go('/two', { info: { stack: 'root' } });
      expect(aux.destroyed).toBe(true);
    });

    it('keeps the stack without the Lynx history', async () => {
      const { go, router } = await setup(
        '/home',
        [],
        [
          provideAngularRouter(ROUTES),
          { provide: LocationStrategy, useClass: MockLocationStrategy },
        ],
      );
      await go('/home/notes/1');
      const note = at('home/notes/1');
      await go('/pages');
      await go('/home');
      expect(router.url).toBe('/home/notes/1');
      expect(at('home/notes/1')).toBe(note);
    });
  });

  describe('microtasks a device runs while a screen is built', () => {
    /**
     * Holds the microtasks queued from now on, until a Measured screen is
     * built or the test lets them go.
     */
    const hold = () => {
      const queue = globalThis.queueMicrotask;
      held = [];
      vi.stubGlobal('queueMicrotask', (task: () => void) =>
        held ? held.push(task) : queue(task),
      );
      return () => {
        const rest = held?.splice(0) ?? [];
        held = null;
        vi.unstubAllGlobals();
        for (const task of rest) task();
      };
    };

    it('keeps the tab it leaves for one built mid-navigation', async () => {
      const { go, router, settle } = await setup('/pages');
      const pages = at('pages');
      const release = hold();
      await router.navigateByUrl('/measured');
      release();
      await settle();
      expect(pages.destroyed).toBe(false);
      await go('/pages');
      expect(at('pages')).toBe(pages);
    });

    it('keeps the stack it pushes onto when the pushed screen is built mid-navigation', async () => {
      const { go, router, settle } = await setup('/home');
      const home = at('home');
      const release = hold();
      await router.navigateByUrl('/home/measured');
      release();
      await settle();
      expect(home.destroyed).toBe(false);
      await go('/home');
      expect(at('home')).toBe(home);
    });
  });

  describe('a plain router outlet in a tab', () => {
    it('keeps the tab, and builds the screen in it again', async () => {
      const { go, router } = await setup('/nested/child');
      const child = at('nested/child');
      await go('/pages');
      expect(child.destroyed).toBe(true);
      await go('/nested');
      expect(router.url).toBe('/nested/child');
      expect(at('nested/child')).not.toBe(child);
    });
  });

  describe('in a stack', () => {
    it('keeps its tabs while a page covers it, and lets them go when the router leaves', async () => {
      const { go, fixture } = await setup('/stacked/tabs/(a//side:aside)');
      const a = at('stacked/tabs/a');
      const aside = at('stacked/tabs/aside');
      await go('/stacked/tabs/a/more');
      expect(a.destroyed).toBe(false);
      expect(aside.destroyed).toBe(false);
      // Back without the side tab: the main one shows again as it was, and
      // the side outlet, which the router didn't come back to, empties.
      await go('/stacked/tabs/a');
      expect(at('stacked/tabs/a')).toBe(a);
      expect(aside.destroyed).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('page');
    });
  });

  describe('the guard', () => {
    it('finds the tabs through routes without a component', async () => {
      const { go, router } = await setup('/group/tabs/a');
      await go('/group/tabs/a?q=1');
      await go('/group/tabs/b');
      await go('/group/tabs/a');
      expect(router.url).toBe('/group/tabs/a?q=1');
    });

    it('leaves a navigation from outside the tabs alone', async () => {
      const { go, router } = await setup('/stacked/tabs/a');
      await go('/stacked/tabs/a?q=1');
      // The tabs go with the stack, and a navigation into them from outside
      // finds no tabs to go back to.
      await go('/login');
      await go('/stacked/tabs/a');
      expect(router.url).toBe('/stacked/tabs/a');
    });

    it('gives a route the guard once, beside its own', async () => {
      const own = () => true;
      const routes: Routes = [
        {
          path: '',
          component: Shell,
          children: [
            { path: 'a', component: Page, canActivate: [own] },
            { path: 'b', component: Page },
          ],
        },
      ];
      const { go, router } = await setup('/a', [], provideRouter(routes));
      await go('/b');
      await go('/a');
      // The router's copy of the route has it; the app's is as it was.
      const guards = router.config[0]!.children![0]!.canActivate!;
      expect(guards).toHaveLength(2);
      expect(guards[0]).toBe(own);
      expect(routes[0]!.children![0]!.canActivate).toEqual([own]);
    });
  });

  describe('a reuse strategy', () => {
    it('hands tabs to it and takes them back', async () => {
      const stored = new Map<string, DetachedRouteHandle>();
      class KeepPages extends BaseRouteReuseStrategy {
        override shouldDetach(route: ActivatedRouteSnapshot): boolean {
          return route.routeConfig?.path === 'pages';
        }
        override store(
          route: ActivatedRouteSnapshot,
          handle: DetachedRouteHandle | null,
        ): void {
          if (handle) stored.set(route.url.join('/'), handle);
          else stored.delete(route.url.join('/'));
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
      const { go, outlet, frames } = await setup('/pages', [
        { provide: RouteReuseStrategy, useClass: KeepPages },
      ]);
      const tabs = outlet();
      const detached = vi.fn();
      const attached = vi.fn();
      tabs.detachEvents.subscribe(detached);
      tabs.attachEvents.subscribe(attached);
      const pages = at('pages');
      await go('/kept');
      expect(detached).toHaveBeenCalledWith(pages);
      expect(pages.destroyed).toBe(false);
      expect(frames()).toHaveLength(1);
      await go('/pages');
      expect(attached).toHaveBeenCalledWith(pages);
      expect(tabs.component).toBe(pages);
      expect(pages.tab!.active()).toBe(true);
      expect(frames()).toHaveLength(2);
    });

    it('takes a component it never had, with a route of its own', async () => {
      const { outlet, router } = await setup('/pages');
      const tabs = outlet();
      const route = tabs.activatedRoute;
      tabs.deactivate();
      const ref = createComponent(InputPage, {
        environmentInjector: TestBed.inject(EnvironmentInjector),
      });
      tabs.attach(ref, route);
      expect(tabs.component).toBe(ref.instance);
      expect(router.url).toBe('/pages');
    });
  });
});

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
