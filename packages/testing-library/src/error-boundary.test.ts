/**
 * Error boundary tests — verify Angular's `@boundary` / `@error` template
 * blocks (Angular 22.2+) work end-to-end through the Lynx renderer.
 *
 * `@boundary` is pure Angular runtime (embedded views swapped in and out of an
 * LContainer), so these tests exist to prove the *renderer* side holds up: a
 * primary view that throws mid-update must be fully detached from the Lynx
 * element tree, the `@error` fallback must be inserted at the right anchor, and
 * `$reset()` must swap the primary back in without leaving stale elements.
 */

import {
  ChangeDetectionStrategy,
  Component,
  ErrorHandler,
  type ErrorDetails,
  inject,
  Injectable,
  resource,
  signal,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitForUpdate } from './index.js';
import { LYNX_ELEMENTS, LynxErrorHandler } from '@blotch/angular-lynx';

/**
 * Custom component selectors are unknown to the Lynx document and trigger a
 * console.warn fallback. Suppress for clean output.
 */
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

/**
 * Records every error the boundary reports so tests can assert on routing.
 */
class RecordingErrorHandler extends LynxErrorHandler {
  readonly viewErrors: { error: Error; details: ErrorDetails }[] = [];
  readonly handled: unknown[] = [];

  override onViewError(error: Error, details: ErrorDetails): void {
    this.viewErrors.push({ error, details });
  }

  override handleError(error: unknown): void {
    this.handled.push(error);
  }
}

const texts = (container: Element): string[] =>
  Array.from(container.querySelectorAll('text')).map(
    (t) => t.textContent?.trim() ?? '',
  );

@Component({
  selector: 'crash-on-create',
  template: `<text>never rendered</text>`,
  imports: [LYNX_ELEMENTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class CrashOnCreate {
  constructor() {
    throw new Error('constructor exploded');
  }
}

/**
 * Shared failure switch. Signal `input()`s aren't wired under Vitest's JIT
 * (that needs the AOT compiler transform), so children read state from a
 * root service instead — each render() bootstraps a fresh app, so it never
 * leaks between tests.
 */
@Injectable({ providedIn: 'root' })
class FailureSwitch {
  readonly mode = signal<'none' | 'network' | 'other'>('none');
}

class NetworkError extends Error {
  override name = 'NetworkError';
}

@Component({
  selector: 'fragile-widget',
  template: `<view class="widget"
    ><text>{{ label() }}</text></view
  >`,
  imports: [LYNX_ELEMENTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class FragileWidget {
  readonly #failure = inject(FailureSwitch);

  label(): string {
    const mode = this.#failure.mode();
    if (mode === 'network') throw new NetworkError('offline');
    if (mode === 'other') throw new Error('widget broke');
    return 'widget ok';
  }
}

describe('@boundary — creation errors', () => {
  it('renders the @error fallback when a child constructor throws', async () => {
    @Component({
      selector: 'test-create-host',
      template: `
        <view class="root">
          <text>before</text>
          @boundary {
            <crash-on-create />
          } @error (let err) {
            <text class="fallback">caught: {{ err.message }}</text>
          }
          <text>after</text>
        </view>
      `,
      imports: [LYNX_ELEMENTS, CrashOnCreate],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class Host {}

    const handler = new RecordingErrorHandler();
    const { container } = await render(Host, {
      providers: [{ provide: ErrorHandler, useValue: handler }],
    });
    await waitForUpdate();

    // The fallback must land between its siblings — proves the renderer
    // inserted it before the boundary's anchor, not appended to the end.
    expect(texts(container)).toEqual([
      'before',
      'caught: constructor exploded',
      'after',
    ]);
    expect(container.textContent).not.toContain('never rendered');
    expect(handler.viewErrors).toHaveLength(1);
    expect(handler.viewErrors[0].error.message).toBe('constructor exploded');
    expect(handler.viewErrors[0].details.boundary?.type).toBe(Host);
  });
});

/**
 * Reach the app's FailureSwitch so a test can flip it mid-render.
 */
const failureSwitch = (componentRef: {
  injector: { get: (t: typeof FailureSwitch) => FailureSwitch };
}): FailureSwitch => componentRef.injector.get(FailureSwitch);

describe('@boundary — update errors and reset', () => {
  @Component({
    selector: 'test-update-host',
    template: `
      <view class="root">
        @boundary {
          <fragile-widget />
        } @error (let err) {
          <view class="fallback">
            <text>failed: {{ err.message }}</text>
          </view>
        }
      </view>
    `,
    imports: [LYNX_ELEMENTS, FragileWidget],
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  class UpdateHost {}

  it('swaps the primary view for the fallback when an update throws', async () => {
    const handler = new RecordingErrorHandler();
    const { container, componentRef } = await render(UpdateHost, {
      providers: [{ provide: ErrorHandler, useValue: handler }],
    });

    expect(texts(container)).toEqual(['widget ok']);

    failureSwitch(componentRef).mode.set('other');
    await waitForUpdate();

    // The primary view's Lynx elements must be fully detached — a leftover
    // `.widget` would mean removeChild didn't reach the native tree.
    expect(container.querySelector('.widget')).toBeNull();
    expect(container.querySelector('.fallback')).not.toBeNull();
    expect(texts(container)).toEqual(['failed: widget broke']);
    expect(handler.viewErrors).toHaveLength(1);
    expect(handler.handled).toHaveLength(0);
  });

  it('re-renders the primary view after a reset once the cause is fixed', async () => {
    const handler = new RecordingErrorHandler();
    const { container, componentRef } = await render(UpdateHost, {
      providers: [{ provide: ErrorHandler, useValue: handler }],
    });
    const failure = failureSwitch(componentRef);

    failure.mode.set('other');
    await waitForUpdate();
    expect(container.querySelector('.fallback')).not.toBeNull();

    // Reset via the ErrorDetails handle — the same function `$reset` calls.
    failure.mode.set('none');
    handler.viewErrors[0].details.boundary!.reset();
    await waitForUpdate();

    expect(container.querySelector('.fallback')).toBeNull();
    expect(container.querySelectorAll('.widget')).toHaveLength(1);
    expect(texts(container)).toEqual(['widget ok']);
  });

  it('shows the fallback again if the reset re-renders into the same error', async () => {
    const handler = new RecordingErrorHandler();
    const { container, componentRef } = await render(UpdateHost, {
      providers: [{ provide: ErrorHandler, useValue: handler }],
    });

    failureSwitch(componentRef).mode.set('other');
    await waitForUpdate();
    handler.viewErrors[0].details.boundary!.reset();
    await waitForUpdate();

    expect(container.querySelector('.widget')).toBeNull();
    expect(container.querySelectorAll('.fallback')).toHaveLength(1);
    expect(handler.viewErrors).toHaveLength(2);
  });
});

describe('@boundary — reset from inside the fallback', () => {
  it('calls $reset from a tap handler in the @error block', async () => {
    @Component({
      selector: 'test-tap-reset',
      template: `
        @boundary {
          <fragile-widget />
        } @error (retry = $reset) {
          <view class="retry" (bindtap)="fix(); retry()">
            <text>retry</text>
          </view>
        }
      `,
      imports: [LYNX_ELEMENTS, FragileWidget],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class TapResetHost {
      readonly #failure = inject(FailureSwitch);

      constructor() {
        this.#failure.mode.set('other');
      }

      fix(): void {
        this.#failure.mode.set('none');
      }
    }

    const { container } = await render(TapResetHost, {
      providers: [
        { provide: ErrorHandler, useValue: new RecordingErrorHandler() },
      ],
    });
    await waitForUpdate();
    expect(texts(container)).toEqual(['retry']);

    fireEvent.tap(container.querySelector('.retry')!);
    await waitForUpdate();

    expect(texts(container)).toEqual(['widget ok']);
  });
});

describe('@boundary — conditional @error blocks', () => {
  @Component({
    selector: 'test-when-host',
    template: `
      @boundary {
        <fragile-widget />
      } @error (let err; when isNetwork(err)) {
        <text>network: {{ err.message }}</text>
      } @error (let err) {
        <text>other: {{ err.message }}</text>
      }
    `,
    imports: [LYNX_ELEMENTS, FragileWidget],
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  class WhenHost {
    isNetwork(err: unknown): boolean {
      return err instanceof NetworkError;
    }
  }

  it('picks the first @error whose `when` matches', async () => {
    const { container, componentRef } = await render(WhenHost, {
      providers: [
        { provide: ErrorHandler, useValue: new RecordingErrorHandler() },
      ],
    });
    failureSwitch(componentRef).mode.set('network');
    await waitForUpdate();
    expect(texts(container)).toEqual(['network: offline']);
  });

  it('falls through to the unconditional @error', async () => {
    const { container, componentRef } = await render(WhenHost, {
      providers: [
        { provide: ErrorHandler, useValue: new RecordingErrorHandler() },
      ],
    });
    failureSwitch(componentRef).mode.set('other');
    await waitForUpdate();
    expect(texts(container)).toEqual(['other: widget broke']);
  });
});
describe('@boundary — nesting', () => {
  it('lets the innermost boundary catch, leaving outer content intact', async () => {
    @Component({
      selector: 'test-nested-host',
      template: `
        @boundary {
          <text>outer ok</text>
          @boundary {
            <crash-on-create />
          } @error {
            <text>inner fallback</text>
          }
        } @error {
          <text>outer fallback</text>
        }
      `,
      imports: [LYNX_ELEMENTS, CrashOnCreate],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class NestedHost {}

    const { container } = await render(NestedHost, {
      providers: [
        { provide: ErrorHandler, useValue: new RecordingErrorHandler() },
      ],
    });
    await waitForUpdate();
    expect(texts(container)).toEqual(['outer ok', 'inner fallback']);
  });
});

describe('@boundary — resource() in the error state', () => {
  it('catches the throw from value() and recovers on reload', async () => {
    let failLoads = true;

    @Component({
      selector: 'test-resource-host',
      template: `
        @if (data.isLoading() && !data.hasValue()) {
          <text>loading</text>
        } @else {
          @boundary {
            <text>value: {{ data.value() }}</text>
          } @error {
            <text>load failed: {{ data.error()?.message }}</text>
          }
        }
      `,
      imports: [LYNX_ELEMENTS],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ResourceHost {
      // resource() injects TransferState on construction, whose factory reads
      // DOCUMENT.getElementById — this also guards that the Lynx DOCUMENT stub
      // supports it.
      readonly data = resource({
        loader: async () => {
          if (failLoads) throw new Error('503');
          return 'fresh';
        },
      });
    }

    const handler = new RecordingErrorHandler();
    const { container, componentRef } = await render(ResourceHost, {
      providers: [{ provide: ErrorHandler, useValue: handler }],
    });
    await waitForUpdate();
    await waitForUpdate();

    expect(texts(container)).toEqual(['load failed: 503']);
    expect(handler.viewErrors).toHaveLength(1);

    failLoads = false;
    (componentRef.instance as ResourceHost).data.reload();
    await waitForUpdate();
    await waitForUpdate();

    expect(texts(container)).toEqual(['value: fresh']);
  });
});
