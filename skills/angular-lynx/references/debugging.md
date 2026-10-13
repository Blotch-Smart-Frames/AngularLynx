# Debugging

## The Problem

Lynx apps run on-device (iPhone/Android via Lynx Explorer). There is no browser console, no DevTools, no `console.log` visible panel. You must use alternative approaches to see logs and errors.

## LynxLogger

Remote logger that sends logs from device to your dev terminal via the rspeedy dev server.

```typescript
import { inject } from '@angular/core';
import { LynxLogger } from '@blotch/angular-lynx';

export class MyComponent {
  #logger = inject(LynxLogger);

  onTap() {
    this.#logger.log('tap event fired');
    this.#logger.warn('something suspicious');
    this.#logger.error('something broke', someObject);
  }
}
```

### How It Works

- **Background thread**: sends logs directly via `fetch()` to the dev server
- **Main thread** (event handlers): no `fetch` available. Relays logs to background thread via IPC (`lynx.getJSContext().dispatchEvent`)
- **Production**: all methods are no-ops (dead-code eliminated via `__DEV__` guard)

### Methods

- `log(...args)` — general logging
- `warn(...args)` — warnings
- `error(...args)` — errors
- `info(...args)` — informational
- `debug(...args)` — debug-level

## On-Screen Error Display

For errors that occur before logging is set up, or when you need to see errors visually:

```typescript
@Component({
  template: `
    @if (lastError()) {
      <view style="background-color: red; padding: 8px; margin: 8px;">
        <text style="color: white; font-size: 12px; word-break: break-all;">
          {{ lastError() }}
        </text>
      </view>
    }
    <!-- rest of template -->
  `,
})
export class AppComponent {
  lastError = signal('');

  constructor() {
    // Check for errors captured by the global handler
    const err = (globalThis as any).__lynxLastError;
    if (err) {
      this.lastError.set(err);
      (globalThis as any).__lynxLastError = '';
    }
  }
}
```

## Global Error Capture

The runtime installs global error handlers automatically:

```typescript
// Automatically set up by bootstrapApplication()
globalThis.__lynxLastError = '';
globalThis.onerror = (msg, src, line, col, err) => {
  globalThis.__lynxLastError = err ? `${err.name}: ${err.message}\n${err.stack}` : String(msg);
};
globalThis.onunhandledrejection = (event) => {
  globalThis.__lynxLastError = /* formats the rejection reason */;
};
```

Read `globalThis.__lynxLastError` at any point to see the last uncaught error.

## Debugging Strategies

1. **Render state on screen** — add `<text>{{ debugSignal() }}</text>` to see values in real-time
2. **Use LynxLogger** — logs appear in your terminal where rspeedy is running
3. **Check `__lynxLastError`** — after operations that might fail (navigation, data loading)
4. **Wrap in try/catch** — catch errors in event handlers and display them

## Common Issues

| Symptom                   | Likely Cause                                              |
| ------------------------- | --------------------------------------------------------- |
| Blank screen              | Crash during bootstrap — check `__lynxLastError`          |
| App freezes               | DOM mutation inside event worklet (missing `setTimeout`)  |
| Element disappears        | Element pool exhausted (~256 slots)                       |
| Navigation silently fails | Missing default route (empty path redirect)               |
| Styles not applying       | CSS inheritance assumption (styles don't inherit in Lynx) |
