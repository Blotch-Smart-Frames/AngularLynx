import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { renderOnce } from '../test-utils/render-once';
import { App } from './app';

// Minimal routes so the deferred navigateByUrl() in navigateTo() resolves
// cleanly inside the test.
const routes = [
  { path: 'home', children: [] },
  { path: 'events', children: [] },
];

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

  it('starts on the home route', async () => {
    const { instance, destroy } = await renderOnce(App, {
      providers: [provideRouter(routes)],
    });
    destroyApp = destroy;
    expect(instance.currentPath()).toBe('home');
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

  it('navigateTo() updates the current path', async () => {
    const { instance, destroy } = await renderOnce(App, {
      providers: [provideRouter(routes)],
    });
    destroyApp = destroy;

    // currentPath is set synchronously; the navigation itself is deferred.
    instance.navigateTo('events');
    expect(instance.currentPath()).toBe('events');
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
