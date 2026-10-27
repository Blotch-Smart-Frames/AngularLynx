import {
  fireEvent,
  getQueriesForElement,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { provideRouter } from '@blotch/angular-lynx';
import { afterEach, describe, expect, it } from 'vitest';
import { renderOnce } from '../test-utils/render-once';
import { App } from './app';

// Minimal routes for the drawer's routerLinks to navigate between.
const routes = [
  { path: '', pathMatch: 'full' as const, redirectTo: 'home' },
  { path: 'home', children: [] },
  { path: 'events', children: [] },
];

/**
 * The drawer item labeled `label`: the item's host, which carries its
 * routerLink, around the view that draws its highlight.
 */
const drawerItem = (container: HTMLElement, label: string) => {
  const highlight =
    getQueriesForElement(container).getByText(label).parentElement!;
  return { host: highlight.parentElement!, highlight };
};

/**
 * Runs change detection until `done` holds: navigation takes a few ticks.
 */
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 20 && !done(); i++) {
    await waitForUpdate();
  }
  expect(done()).toBe(true);
};

let destroyApp: (() => void) | null = null;

afterEach(() => {
  destroyApp?.();
  destroyApp = null;
});

describe('App', () => {
  it('renders the app bar title', async () => {
    const { container, destroy } = await renderOnce(App, {
      providers: [provideRouter(routes)],
    });
    destroyApp = destroy;
    expect(container.textContent).toContain('AngularLynx');
  });

  it("starts on the home route, with Home's drawer item active", async () => {
    const { container, destroy } = await renderOnce(App, {
      providers: [provideRouter(routes)],
    });
    destroyApp = destroy;

    const home = drawerItem(container, 'Home');
    await until(() => home.highlight.classList.contains('bg-accent'));
    expect(home.host.getAttribute('accessibility-traits')).toBe('selected');
  });

  it('openDrawer() opens the nav drawer', async () => {
    const { instance, destroy } = await renderOnce(App, {
      providers: [provideRouter(routes)],
    });
    destroyApp = destroy;

    expect(instance.drawerOpen()).toBe(false);
    instance.openDrawer();
    expect(instance.drawerOpen()).toBe(true);
  });

  it('navigates when a drawer item is tapped, and marks it active', async () => {
    const { container, destroy } = await renderOnce(App, {
      providers: [provideRouter(routes)],
    });
    destroyApp = destroy;
    const home = drawerItem(container, 'Home');
    const events = drawerItem(container, 'Events');
    await until(() => home.highlight.classList.contains('bg-accent'));

    // The item's routerLink hears the tap as a click.
    fireEvent.tap(events.host);

    await until(() => events.highlight.classList.contains('bg-accent'));
    expect(home.highlight.classList.contains('bg-accent')).toBe(false);
  });

  it('groups every route in the nav drawer', async () => {
    const { instance, destroy } = await renderOnce(App, {
      providers: [provideRouter(routes)],
    });
    destroyApp = destroy;

    const paths = instance.navGroups.flatMap((g) => g.items.map((i) => i.path));
    expect(paths).toContain('events');
    expect(paths).toContain('forms-demo');
    expect(paths.length).toBeGreaterThan(20);
  });
});
