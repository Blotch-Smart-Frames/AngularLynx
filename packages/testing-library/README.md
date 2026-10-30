# @blotch/angular-lynx-testing-library

Testing utilities for [AngularLynx](https://github.com/Blotch-Smart-Frames/AngularLynx) apps. Renders Angular standalone components through the Lynx PAPI pipeline into a JSDOM tree, then exposes the result via [@testing-library/dom](https://testing-library.com/docs/dom-testing-library/intro) queries, which also read Lynx's `accessibility-*` attributes.

## Installation

```sh
ng generate @blotch/angular-lynx:add-testing
```

It installs this package (and Vitest and jsdom, if the project doesn't have them; `ng new` adds both) and makes sure `ng test` runs through AngularLynx's unit-test builder. To install it by hand: `npm install --save-dev @blotch/angular-lynx-testing-library`.

## Setup

None. Tests run with `ng test`, whose builder (`@blotch/angular-lynx-build:unit-test`, which `ng add` sets up) loads this package's setup before the tests whenever the project has it. There is no Vitest config or setup file to write.

The setup:

- Enables Angular JIT compilation (`@angular/compiler`), for components compiled at runtime
- Installs `LynxTestingEnv` on the jsdom window
- Switches to the Lynx main thread (where PAPI functions live)
- Polyfills PAPI functions the testing environment doesn't implement (`__GetParent`, `__QuerySelector`, etc.)
- Makes `lynx.reportError` return for a warning, as Lynx does, instead of throwing it, so an `@boundary` shows its fallback with the default error handler
- Installs `@testing-library/jest-dom` matchers

`ng test` compiles the tests ahead of time, like the app, and checks templates strictly, as the Angular Language Service does: a component that uses Lynx elements imports `LYNX_ELEMENTS` from `@blotch/angular-lynx`. The examples below do.

### Without Angular CLI

Under plain Vitest, load the setup yourself and define the compile-time flags the AngularLynx runtime reads (the rsbuild plugin defines them in the app, and `ng test` sets them too):

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEV__: JSON.stringify(true),
    __MAIN_THREAD__: JSON.stringify(true),
    __WEB__: JSON.stringify(false),
    __PROFILE__: JSON.stringify(false),
    __ENABLE_SSR__: JSON.stringify(false),
  },
  // Angular's JIT compiler reads the metadata of legacy decorators.
  oxc: { decorator: { legacy: true } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['@blotch/angular-lynx-testing-library/setup'],
  },
});
```

## API

### `render(component, options?)`

Bootstraps a standalone Angular component and returns a JSDOM container with `@testing-library/dom` queries bound to it.

```ts
import { render } from '@blotch/angular-lynx-testing-library';

const { container, getByText, queryByRole } = await render(MyComponent);
```

`render` is **async** — it `await`s Angular's `bootstrapApplication`. The initial change detection cycle runs before the promise resolves, so the container is ready to query immediately.

**Options:**

| Option      | Type                                   | Description                                                           |
| ----------- | -------------------------------------- | --------------------------------------------------------------------- |
| `providers` | `(Provider \| EnvironmentProviders)[]` | Additional providers injected into the app (services, tokens, mocks). |

`provideZonelessChangeDetection()` and `provideRenderer()` are always included — you do not need to provide them.

**Return value:**

| Property     | Type         | Description                                                                                                            |
| ------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `container`  | `Element`    | The JSDOM `<page>` root element. All rendered children are descendants.                                                |
| `unmount`    | `() => void` | Destroys the Angular app.                                                                                              |
| `...queries` | —            | Every query in [`queries`](#queries) bound to `container` (`getByText`, `getByRole`, `getByAccessibilityLabel`, etc.). |

### `cleanup()`

Destroys the current Angular app and resets the Lynx environment. Called automatically after each test — you only need this for manual control.

```ts
import { cleanup } from '@blotch/angular-lynx-testing-library';

afterEach(cleanup);
```

Set `ATL_SKIP_AUTO_CLEANUP=true` to disable auto-cleanup.

### `waitForUpdate()`

Waits for Angular's zoneless change detection scheduler to flush pending reactive updates, then forces a synchronous CD cycle.

```ts
import { waitForUpdate } from '@blotch/angular-lynx-testing-library';

const count = signal(0);
count.set(1);
await waitForUpdate();
// DOM now reflects count = 1
```

Call this after any signal mutation that happens outside an event handler (e.g. direct `.set()` in test code).

### `fireEvent`

Fires Lynx events at JSDOM elements. Use the named helpers for standard Lynx events:

```ts
import { fireEvent } from '@blotch/angular-lynx-testing-library';

fireEvent.tap(element);
fireEvent.input(element, { value: 'hello' });
fireEvent.scroll(element, { scrollTop: 100 });
```

A named helper runs the handlers a device would, in the same order:

- **Touch events bubble.** A tap, long press or touch runs the element's own `(bindtap)` or `(catchtap)`, then its ancestors' on the way up to the page. So a tap on a row inside a pressable card reaches the card's `(click)`. `(capture-bind…)` and `(capture-catch…)` handlers run before them, from the page down.
- **Mouse, wheel and key events bubble too**, as Lynx sends them on desktop and web.
- **A `catch` handler stops the event** where it runs: a `(catchtap)` panel keeps a tap from reaching the backdrop behind it.
- **Other events stay on their element.** `scroll`, `input`, `layoutchange` and the rest run only the element's own handler.

`init.bubbles` overrides the event's own: `fireEvent.tap(element, { bubbles: false })` runs only the element's handler.

`init.eventType` fires at one kind of handler on the element and nothing else: `fireEvent.tap(element, { eventType: 'catchEvent' })` dispatches the DOM event `"catchEvent:tap"`, which reaches only the element's `(catchtap)`.

To dispatch a raw DOM event directly:

```ts
fireEvent(element, new Event('bindEvent:tap'));
```

**Available named helpers:**

`tap` · `longtap` · `touchstart` · `touchmove` · `touchcancel` · `touchend` · `longpress` · `scroll` · `scrollend` · `focus` · `blur` · `input` · `confirm` · `layoutchange` · `transitionend` · `animationend`

### `eventMap`

The full Lynx event registry. Each entry has a `defaultInit` object: `{ bubbles: true }` for the events Lynx sends up the response chain, `{}` for the rest.

```ts
import { eventMap } from '@blotch/angular-lynx-testing-library';

console.log(Object.keys(eventMap));
// ['tap', 'longtap', 'touchstart', ...]
```

### `*ByAccessibilityLabel`

Find elements by their `accessibility-label`, the text a screen reader reads on Lynx. Testing Library's `*ByLabelText` reads `<label>` and `aria-*` attributes, which Lynx elements don't have.

```ts
const { getByAccessibilityLabel } = await render(Toolbar);

fireEvent.tap(getByAccessibilityLabel('Close'));
```

They come in Testing Library's six variants (`getBy`, `getAllBy`, `queryBy`, `queryAllBy`, `findBy`, `findAllBy`) and take its TextMatch (a string, RegExp or function) and MatcherOptions (`exact`, `normalizer`).

### `*ByRole`

Testing Library's `*ByRole`, reading Lynx's accessibility attributes as a screen reader does. Elements Testing Library gives a role still match, such as an `<input>` as a `textbox`.

```ts
const { getByRole } = await render(Toolbar);

fireEvent.tap(getByRole('button', { name: 'Save' }));
expect(getByRole('button', { name: 'Week', selected: true })).toBeTruthy();
```

| `accessibility-traits` | Role        |
| ---------------------- | ----------- |
| `button`               | `button`    |
| `link`                 | `link`      |
| `image`                | `img`       |
| `header`               | `heading`   |
| `search`               | `searchbox` |
| `adjustable`           | `slider`    |
| `tabbar`               | `tablist`   |

- **Role**: from each trait in the table. An `<image>` is an `img` unless it sets `accessibility-traits`.
- **Reachable**: a screen reader reaches `<text>`, `<image>`, and other elements with `accessibility-element="true"`, outside `accessibility-elements-hidden`. A `tabbar` is read from the container around the tabs, so it needs no `accessibility-element`. Others match only with `hidden: true`.
- **`name`**: the `accessibility-label`, or a `<text>`'s own text. A `<view>` gets no name from the text inside it, since iOS doesn't read it.
- **`selected`**: the `selected` trait, as in `accessibility-traits="button,selected"`, which an active `routerLinkActive` element gets, and which `[lynxAccessibilityTraits]="{ selected: true }"` adds. iOS reads a comma-separated list. Android reads one trait (`button` or `image`) and treats a list as `none`.
- **`value: { text }`**: the `accessibility-value`.
- **Other ARIA states** (`checked`, `pressed`, `expanded`, `level`, …) have no Lynx attribute, so Lynx elements never match them.

### `screen`, `within()` and `getQueriesForElement()`

Testing Library's, with the queries above: `screen` binds every query to `document.body`, and `within(element)` binds them to `element`. `getQueriesForElement` is `within`.

### `queries`

Every query, unbound (each takes the container first). Spread it into your own queries to keep them next to these. Each query is also exported on its own, such as `getByAccessibilityLabel(container, 'Close')`.

## Usage

### Rendering a component

```ts
import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { render } from '@blotch/angular-lynx-testing-library';

@Component({
  selector: 'greeting',
  imports: [LYNX_ELEMENTS],
  template: `<text>Hello, {{ name }}!</text>`,
})
class GreetingComponent {
  name = 'Lynx';
}

it('renders the greeting', async () => {
  const { container } = await render(GreetingComponent);
  expect(container.querySelector('text')!.textContent).toBe('Hello, Lynx!');
});
```

### Injecting providers

```ts
import { Component, InjectionToken, inject } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { render } from '@blotch/angular-lynx-testing-library';

const GREETING = new InjectionToken<string>('GREETING');

@Component({
  selector: 'test-greeting',
  imports: [LYNX_ELEMENTS],
  template: `<text>{{ greeting() }}</text>`,
})
class GreetingComponent {
  greeting = inject(GREETING);
}

it('uses the injected value', async () => {
  const { container } = await render(GreetingComponent, {
    providers: [{ provide: GREETING, useValue: 'Hola' }],
  });
  expect(container.querySelector('text')!.textContent).toBe('Hola');
});
```

### Reactive signals

Define the signal outside the component so both the component and the test can access it:

```ts
import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';

const count = signal(0);

@Component({
  selector: 'test-counter',
  imports: [LYNX_ELEMENTS],
  template: `<text>{{ count() }}</text>`,
})
class CounterComponent {
  count = count;
}

it('updates when the signal changes', async () => {
  const { container } = await render(CounterComponent);
  expect(container.querySelector('text')!.textContent).toBe('0');

  count.set(42);
  await waitForUpdate();

  expect(container.querySelector('text')!.textContent).toBe('42');
});
```

### Handling events

AngularLynx event bindings use Lynx prefixes: `(bindtap)`, `(catchtap)`, `(bindinput)`, etc.

```ts
import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  render,
  fireEvent,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';

@Component({
  selector: 'test-button',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="increment()">
      <text>{{ count() }}</text>
    </view>
  `,
})
class ButtonComponent {
  count = signal(0);
  increment() {
    this.count.update((n) => n + 1);
  }
}

it('increments on tap', async () => {
  const { container } = await render(ButtonComponent);

  fireEvent.tap(container.querySelector('view')!);
  await waitForUpdate();

  expect(container.querySelector('text')!.textContent).toBe('1');
});
```

### Control flow — `@if`

```ts
it('shows content conditionally', async () => {
  const visible = signal(true);

  @Component({
    selector: 'test-if',
    imports: [LYNX_ELEMENTS],
    template: `@if (visible()) {
      <text>Hello</text>
    }`,
  })
  class IfComponent {
    visible = visible;
  }

  const { container } = await render(IfComponent);
  expect(container.querySelector('text')).not.toBeNull();

  visible.set(false);
  await waitForUpdate();
  expect(container.querySelector('text')).toBeNull();
});
```

### Control flow — `@for`

```ts
it('renders a dynamic list', async () => {
  const items = signal(['A', 'B', 'C']);

  @Component({
    selector: 'test-for',
    imports: [LYNX_ELEMENTS],
    template: `@for (item of items(); track item) {
      <text>{{ item }}</text>
    }`,
  })
  class ListComponent {
    items = items;
  }

  const { container } = await render(ListComponent);
  expect(container.querySelectorAll('text').length).toBe(3);

  items.set(['A', 'B', 'C', 'D']);
  await waitForUpdate();
  expect(container.querySelectorAll('text').length).toBe(4);
});
```

## Architecture notes

### Single-thread model

AngularLynx runs **entirely on the Lynx main thread** (`__MAIN_THREAD__ = true`). This differs from React Lynx and Vue Lynx, which split rendering across two threads:

| Library         | Thread model                                                     |
| --------------- | ---------------------------------------------------------------- |
| React Lynx      | Dual: background thread runs React, main thread applies PAPI ops |
| Vue Lynx        | Dual: background thread runs Vue, main thread applies PAPI ops   |
| **AngularLynx** | **Single: Angular renderer calls PAPI directly on main thread**  |

In tests, this means there is no thread switching — `__MAIN_THREAD__` stays `true` throughout, and PAPI functions (`__CreatePage`, `__CreateView`, etc.) are always available.

### The render pipeline

```
render(Component)
  └─ bootstrapApplication(Component, {
       provideZonelessChangeDetection(),
       provideRenderer(),
       ...providers
     })
       └─ LynxDocument.createRootElement()
            └─ __CreatePage()  →  <page> appended to document.body
       └─ Angular renders component tree
            └─ __CreateView / __CreateText / …  →  JSDOM children
       └─ LynxRendererFactory2.end()
            └─ __FlushElementTree()  (no-op in tests)
  └─ appRef.tick()  →  force synchronous CD
  └─ return { container: elementTree.root, ...queries }
```

### Event dispatch

AngularLynx registers event handlers via `__AddEvent(element, eventType, eventName, { type: 'worklet', value: callback })`. The testing environment stores this as a DOM event listener under the key `"${eventType}:${eventName}"` (e.g. `"bindEvent:tap"`).

`fireEvent.tap(el)` walks Lynx's event response chain, from the page down to `el` and back up, and calls each element's listener for the kind of handler it has, stopping at a `catch` one. The listener calls `runWorklet(callback, [event])` which invokes the Angular handler directly on the main thread. One bubbling `"bindEvent:tap"` DOM event wouldn't do: it would pass a `(catchtap)` ancestor's `"catchEvent:tap"` listener by and run the handlers above it.

Template binding → PAPI registration → DOM listener key:

| Template       | Listener key       |
| -------------- | ------------------ |
| `(bindtap)`    | `bindEvent:tap`    |
| `(catchtap)`   | `catchEvent:tap`   |
| `(bindinput)`  | `bindEvent:input`  |
| `(bindscroll)` | `bindEvent:scroll` |

## Comparison with React/Vue Lynx testing libraries

| Feature                 | React Lynx              | Vue Lynx          | AngularLynx             |
| ----------------------- | ----------------------- | ----------------- | ----------------------- |
| `render()` return       | Sync                    | Sync              | **Async**               |
| Thread model            | Dual (BG+MT)            | Dual (BG+MT)      | **Main only**           |
| Auto-cleanup env var    | `PTL_SKIP_AUTO_CLEANUP` | —                 | `ATL_SKIP_AUTO_CLEANUP` |
| `renderHook()`          | ✓                       | —                 | —                       |
| Snapshot serializer     | ✓ (RefProxy)            | —                 | —                       |
| Vitest plugin           | ✓                       | —                 | — (`ng test` sets up)   |
| Named fireEvent helpers | 30+                     | 16                | 16                      |
| Thread-aware fireEvent  | ✓                       | ✓                 | — (single thread)       |
| Async state helper      | `waitSchedule()`        | `waitForUpdate()` | `waitForUpdate()`       |
