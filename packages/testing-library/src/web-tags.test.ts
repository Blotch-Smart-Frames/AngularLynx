/**
 * Web tags: a template written for the browser, with `<div>`, `<p>`, `<a>`,
 * `<img>` and `(input)`, rendered through the Lynx renderer. Each HTML tag
 * becomes the Lynx element it renders as (`div` a view, `p` a text, `img` an
 * image), and the DOM events Lynx sends under the same name reach `(input)`
 * and the like.
 */

import { Component, signal } from '@angular/core';
import { RouterLink, RouterOutlet, type Routes } from '@angular/router';
import { LYNX_ELEMENTS, provideRouter } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitForUpdate } from './index.js';

/** Component hosts are unknown tags, which warn as they fall back to views. */
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

@Component({
  selector: 'web-card',
  template: `
    <div class="card">
      <h2>{{ name() }}</h2>
      <p>
        Hello, <strong>{{ name() }}</strong>!
      </p>
      <img class="avatar" src="https://example.com/a.png" alt="Avatar" />
      <input class="name" (input)="name.set($any($event.target).value)" />
      <span class="badge" [hidden]="!badge()">New</span>
      <button class="toggle" (click)="badge.set(!badge())">Toggle</button>
      <ul>
        <li class="perk">No account needed</li>
      </ul>
    </div>
  `,
})
class WebCard {
  readonly name = signal('Ada');
  readonly badge = signal(true);
}

@Component({
  selector: 'home-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Home page</text>`,
})
class HomePage {}

@Component({
  selector: 'settings-page',
  imports: [LYNX_ELEMENTS],
  template: `<text>Settings page</text>`,
})
class SettingsPage {}

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: HomePage },
  { path: 'settings', component: SettingsPage },
];

@Component({
  selector: 'web-nav',
  imports: [RouterOutlet, RouterLink],
  template: `
    <nav>
      <a class="settings" routerLink="/settings">Settings</a>
    </nav>
    <router-outlet />
  `,
})
class WebNav {}

describe('web tags', () => {
  it('renders each tag as the Lynx element it maps to', async () => {
    const { container } = await render(WebCard);

    expect(container.querySelector('view.card')).not.toBeNull();
    expect(container.querySelector('text._ngtag-h2')).not.toBeNull();
    expect(container.querySelector('text._ngtag-p')).not.toBeNull();
    expect(container.querySelector('text._ngtag-button')).not.toBeNull();
    // The text is inside a <text>, so Lynx draws it, and the <strong> runs
    // inline in the <p>'s.
    expect(container.querySelector('text._ngtag-p')!.textContent).toBe(
      'Hello, Ada!',
    );
  });

  it('draws text straight inside a block tag, in a <text> of its own', async () => {
    const { container } = await render(WebCard);

    const perk = screen.getByText('No account needed');
    expect(perk.tagName.toLowerCase()).toBe('text');
    expect(perk.parentElement).toBe(container.querySelector('view.perk'));
  });

  it('sizes an <img> to its picture, and reads its alt', async () => {
    const { container } = await render(WebCard);
    const avatar = container.querySelector('image.avatar')!;

    expect(avatar.getAttribute('auto-size')).toBe('true');
    expect(avatar.getAttribute('accessibility-label')).toBe('Avatar');
    expect(avatar.hasAttribute('alt')).toBe(false);
  });

  it("gives (input) the field's text in $event.target.value", async () => {
    const { container } = await render(WebCard);

    fireEvent.input(container.querySelector('input.name')!, {
      detail: { value: 'Grace' },
    });
    await waitForUpdate();

    expect(container.querySelector('text._ngtag-h2')!.textContent).toBe(
      'Grace',
    );
  });

  it('hides an element with [hidden], and runs (click) on a tap', async () => {
    const { container } = await render(WebCard);
    const badge = container.querySelector('.badge') as HTMLElement;
    expect(badge.style.display).toBe('');

    fireEvent.tap(container.querySelector('.toggle')!);
    await waitForUpdate();

    expect(badge.style.display).toBe('none');
  });

  it('navigates when an <a routerLink> is tapped', async () => {
    const { container } = await render(WebNav, {
      providers: [provideRouter(routes)],
    });
    for (let i = 0; i < 20 && !screen.queryByText('Home page'); i++) {
      await waitForUpdate();
    }

    // RouterLink takes an <a> for a browser link, and leaves a tap that isn't
    // a left click to the browser. It's a <text> here, so it navigates.
    fireEvent.tap(container.querySelector('.settings')!);
    for (let i = 0; i < 20 && !screen.queryByText('Settings page'); i++) {
      await waitForUpdate();
    }

    expect(screen.getByText('Settings page')).toBeInTheDocument();
  });
});

@Component({
  selector: 'web-quote',
  template: `
    <p class="said">He said <q>hello</q>.</p>
    <p class="nested">
      <q>She wrote <q>hi</q> to me</q>
    </p>
    <div class="loose">Then <q>bye</q> came</div>
    <p class="live">
      <q>
        @if (shown()) {
          <b>so </b>
        }
        @for (word of words(); track word) {
          <span>{{ word }}</span>
        }
      </q>
    </p>
    @if (quoted()) {
      <p class="toggled"><q>back</q></p>
    }
  `,
})
class WebQuote {
  readonly shown = signal(false);
  readonly words = signal(['get']);
  readonly quoted = signal(true);
}

@Component({
  selector: 'web-cite',
  template: `<q><ng-content /></q>`,
})
class WebCite {}

@Component({
  selector: 'web-cites',
  imports: [WebCite],
  template: `<view class="projected"
    ><web-cite><q>this</q> one</web-cite></view
  >`,
})
class WebCites {}

describe('<q>', () => {
  const text = (container: Element, selector: string): string | null =>
    container.querySelector(selector)!.textContent;

  it('draws quotation marks around its text, as a browser does', async () => {
    const { container } = await render(WebQuote);

    expect(text(container, 'text.said')).toBe('He said “hello”.');
    expect(text(container, 'view.loose')).toBe('Then “bye” came');
  });

  it('draws single marks inside another <q>, as a browser does', async () => {
    const { container } = await render(WebQuote);

    expect(text(container, 'text.nested')).toBe('“She wrote ‘hi’ to me”');
  });

  it('keeps the marks at its ends as its content changes', async () => {
    const { container, componentRef } = await render(WebQuote);
    expect(text(container, 'text.live')).toBe('“get”');

    componentRef.instance.shown.set(true);
    componentRef.instance.words.set(['for', 'get']);
    await waitForUpdate();
    expect(text(container, 'text.live')).toBe('“so forget”');

    componentRef.instance.shown.set(false);
    componentRef.instance.words.set(['it']);
    await waitForUpdate();
    expect(text(container, 'text.live')).toBe('“it”');
  });

  it('keeps its marks when it comes back', async () => {
    const { container, componentRef } = await render(WebQuote);

    componentRef.instance.quoted.set(false);
    await waitForUpdate();
    expect(container.querySelector('text.toggled')).toBeNull();

    componentRef.instance.quoted.set(true);
    await waitForUpdate();
    expect(text(container, 'text.toggled')).toBe('“back”');
  });

  it('counts a <q> projected into another as nested', async () => {
    const { container } = await render(WebCites);

    expect(text(container, 'view.projected')).toBe('“‘this’ one”');
  });
});
