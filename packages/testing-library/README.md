# @blotch/angular-lynx-testing-library

Testing utilities for [AngularLynx](https://github.com/blotchit/angular-lynx) apps. Renders Angular standalone components through the Lynx PAPI pipeline into a JSDOM tree, then exposes the result via [@testing-library/dom](https://testing-library.com/docs/dom-testing-library/intro) queries.

## Installation

```sh
npm install --save-dev @blotch/angular-lynx-testing-library \
  @lynx-js/testing-environment \
  @testing-library/dom \
  @testing-library/jest-dom \
  vitest jsdom
```

## Setup

Add a `vitest.config.ts` to your project:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  define: {
    __DEV__: JSON.stringify(true),
    __MAIN_THREAD__: JSON.stringify(true),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['@blotch/angular-lynx-testing-library/setup'],
  },
});
```

The setup file:

- Enables Angular JIT compilation (`@angular/compiler`)
- Installs `LynxTestingEnv` on the jsdom window
- Switches to the Lynx main thread (where PAPI functions live)
- Polyfills PAPI functions the testing environment doesn't implement (`__GetParent`, `__QuerySelector`, etc.)
- Installs `@testing-library/jest-dom` matchers

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

| Property     | Type         | Description                                                                                                 |
| ------------ | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `container`  | `Element`    | The JSDOM `<page>` root element. All rendered children are descendants.                                     |
| `unmount`    | `() => void` | Destroys the Angular app.                                                                                   |
| `...queries` | —            | All `@testing-library/dom` queries bound to `container` (`getByText`, `queryByRole`, `findByTestId`, etc.). |

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

Dispatches Lynx events on JSDOM elements. Use the named helpers for standard Lynx events:

```ts
import { fireEvent } from '@blotch/angular-lynx-testing-library';

fireEvent.tap(element);
fireEvent.input(element, { value: 'hello' });
fireEvent.scroll(element, { scrollTop: 100 });
```

Named helpers dispatch a DOM event with the key `"bindEvent:<name>"` (e.g. `"bindEvent:tap"`), which matches the listener registered by `__AddEvent` when Angular processes a `(bindtap)` template binding.

To dispatch a raw DOM event directly:

```ts
fireEvent(element, new Event('bindEvent:tap'));
```

**Available named helpers:**

`tap` · `longtap` · `touchstart` · `touchmove` · `touchcancel` · `touchend` · `longpress` · `scroll` · `scrollend` · `focus` · `blur` · `input` · `confirm` · `layoutchange` · `transitionend` · `animationend`

### `eventMap`

The full Lynx event registry. Each entry has a `defaultInit` object (currently empty for all events, but present for forward-compatibility).

```ts
import { eventMap } from '@blotch/angular-lynx-testing-library';

console.log(Object.keys(eventMap));
// ['tap', 'longtap', 'touchstart', ...]
```

### Re-exports from `@testing-library/dom`

`screen` · `within` · `getQueriesForElement`

## Usage

### Rendering a component

```ts
import { Component } from '@angular/core';
import { render } from '@blotch/angular-lynx-testing-library';

@Component({
  selector: 'greeting',
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
import { InjectionToken, inject } from '@angular/core';
import { render } from '@blotch/angular-lynx-testing-library';

const GREETING = new InjectionToken<string>('GREETING');

@Component({
  selector: 'test-greeting',
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
import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';

const count = signal(0);

@Component({
  selector: 'test-counter',
  template: `<text>{{ count() }}</text>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import {
  render,
  fireEvent,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';

@Component({
  selector: 'test-button',
  template: `
    <view (bindtap)="increment()">
      <text>{{ count() }}</text>
    </view>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    template: `@if (visible()) {
      <text>Hello</text>
    }`,
    changeDetection: ChangeDetectionStrategy.OnPush,
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
    template: `@for (item of items(); track item) {
      <text>{{ item }}</text>
    }`,
    changeDetection: ChangeDetectionStrategy.OnPush,
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

`fireEvent.tap(el)` dispatches a `"bindEvent:tap"` DOM event, which triggers the listener. The listener calls `runWorklet(callback, [event])` which invokes the Angular handler directly on the main thread.

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
| Vitest plugin           | ✓                       | —                 | —                       |
| Named fireEvent helpers | 30+                     | 16                | 16                      |
| Thread-aware fireEvent  | ✓                       | ✓                 | — (single thread)       |
| Async state helper      | `waitSchedule()`        | `waitForUpdate()` | `waitForUpdate()`       |
