/**
 * Basic render tests — verify the full pipeline:
 * Angular component → LynxRenderer → PAPI → JSDOM
 */

import {
  Component,
  InjectionToken,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { describe, it, expect } from 'vitest';
import { render, cleanup, waitForUpdate } from './index.js';

@Component({
  selector: 'test-view',
  template: `<view></view>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class SingleView {}

@Component({
  selector: 'test-text',
  template: `<text>Hello Lynx</text>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TextDisplay {}

@Component({
  selector: 'test-nested',
  template: `
    <view>
      <text>First</text>
      <text>Second</text>
    </view>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Nested {}

describe('render', () => {
  it('renders a single view element', async () => {
    const { container, asFragment } = await render(SingleView);
    expect(container.querySelector('view')).not.toBeNull();
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <view />
        </page>
      </DocumentFragment>
    `);
  });

  it('renders a text element with content', async () => {
    const { container, asFragment } = await render(TextDisplay);
    const textEl = container.querySelector('text');
    expect(textEl).not.toBeNull();
    expect(textEl!.textContent).toBe('Hello Lynx');
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <text>
            Hello Lynx
          </text>
        </page>
      </DocumentFragment>
    `);
  });

  it('renders nested elements', async () => {
    const { container, asFragment } = await render(Nested);
    const texts = container.querySelectorAll('text');
    expect(texts.length).toBe(2);
    expect(texts[0]!.textContent).toBe('First');
    expect(texts[1]!.textContent).toBe('Second');
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <view>
            <text>
              First
            </text>
            <text>
              Second
            </text>
          </view>
        </page>
      </DocumentFragment>
    `);
  });

  it('cleans up between renders', async () => {
    @Component({
      selector: 'test-first',
      template: `<text>First render</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class First {}

    @Component({
      selector: 'test-second',
      template: `<text>Second render</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class Second {}

    await render(First);
    const { container } = await render(Second);

    const texts = container.querySelectorAll('text');
    expect(texts.length).toBe(1);
    expect(texts[0]!.textContent).toBe('Second render');
  });

  it('reflects signal updates after waitForUpdate', async () => {
    // Define signal outside the component so tests can drive state changes.
    const label = signal('initial');

    @Component({
      selector: 'test-signal-update',
      template: `<text>{{ label() }}</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class SignalUpdate {
      label = label;
    }

    const { container, asFragment } = await render(SignalUpdate);
    expect(container.querySelector('text')!.textContent).toBe('initial');
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <text>
            initial
          </text>
        </page>
      </DocumentFragment>
    `);

    label.set('updated');
    await waitForUpdate();

    expect(container.querySelector('text')!.textContent).toBe('updated');
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <text>
            updated
          </text>
        </page>
      </DocumentFragment>
    `);
  });
});

describe('@if control flow', () => {
  it('renders conditional content', async () => {
    @Component({
      selector: 'test-if',
      template: `
        @if (show()) {
          <text>Visible</text>
        }
      `,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ConditionalIf {
      show = signal(true);
    }

    const { container, asFragment } = await render(ConditionalIf);
    expect(container.querySelector('text')!.textContent).toBe('Visible');
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <text>
            Visible
          </text>
          <view
            style="display: none;"
          />
        </page>
      </DocumentFragment>
    `);
  });
});

describe('@for control flow', () => {
  it('renders a list of items', async () => {
    @Component({
      selector: 'test-for',
      template: `
        @for (item of items(); track item) {
          <text>{{ item }}</text>
        }
      `,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ForLoop {
      items = signal(['Alpha', 'Beta', 'Gamma']);
    }

    const { container, asFragment } = await render(ForLoop);
    const texts = container.querySelectorAll('text');
    expect(texts.length).toBe(3);
    expect(texts[0]!.textContent).toBe('Alpha');
    expect(texts[1]!.textContent).toBe('Beta');
    expect(texts[2]!.textContent).toBe('Gamma');
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <text>
            Alpha
          </text>
          <text>
            Beta
          </text>
          <text>
            Gamma
          </text>
          <view
            style="display: none;"
          />
        </page>
      </DocumentFragment>
    `);
  });

  it('renders nothing for an empty list', async () => {
    @Component({
      selector: 'test-for-empty',
      template: `
        @for (item of items(); track item) {
          <text>{{ item }}</text>
        }
      `,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ForEmpty {
      items = signal<string[]>([]);
    }

    const { container, asFragment } = await render(ForEmpty);
    expect(container.querySelectorAll('text').length).toBe(0);
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <view
            style="display: none;"
          />
        </page>
      </DocumentFragment>
    `);
  });

  it('updates the list when the signal changes', async () => {
    const items = signal(['A']);

    @Component({
      selector: 'test-for-update',
      template: `
        @for (item of items(); track item) {
          <text>{{ item }}</text>
        }
      `,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ForUpdate {
      items = items;
    }

    const { container, asFragment } = await render(ForUpdate);
    expect(container.querySelectorAll('text').length).toBe(1);
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <text>
            A
          </text>
          <view
            style="display: none;"
          />
        </page>
      </DocumentFragment>
    `);

    items.set(['A', 'B', 'C']);
    await waitForUpdate();

    expect(container.querySelectorAll('text').length).toBe(3);
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <text>
            A
          </text>
          <text>
            B
          </text>
          <text>
            C
          </text>
          <view
            style="display: none;"
          />
        </page>
      </DocumentFragment>
    `);
  });
});

describe('@if control flow — reactive toggle', () => {
  it('hides content when the signal is false', async () => {
    const show = signal(false);

    @Component({
      selector: 'test-if-false',
      template: `
        @if (show()) {
          <text>Conditional</text>
        }
      `,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class IfFalse {
      show = show;
    }

    const { container, asFragment } = await render(IfFalse);
    expect(container.querySelector('text')).toBeNull();
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <view
            style="display: none;"
          />
        </page>
      </DocumentFragment>
    `);
  });

  it('toggles content on signal change', async () => {
    const show = signal(true);

    @Component({
      selector: 'test-if-toggle',
      template: `
        @if (show()) {
          <text>Conditional</text>
        }
      `,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class IfToggle {
      show = show;
    }

    const { container, asFragment } = await render(IfToggle);
    expect(container.querySelector('text')).not.toBeNull();
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <text>
            Conditional
          </text>
          <view
            style="display: none;"
          />
        </page>
      </DocumentFragment>
    `);

    show.set(false);
    await waitForUpdate();

    expect(container.querySelector('text')).toBeNull();
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <view
            style="display: none;"
          />
        </page>
      </DocumentFragment>
    `);
  });
});

describe('cleanup', () => {
  it('destroys the app without error', async () => {
    await render(SingleView);
    expect(() => cleanup()).not.toThrow();
  });

  it('is safe to call when no app is mounted', () => {
    cleanup(); // ensure clean state
    expect(() => cleanup()).not.toThrow();
  });
});

describe('unmount', () => {
  it('destroys the app without error', async () => {
    const { unmount } = await render(SingleView);
    expect(() => unmount()).not.toThrow();
  });

  it('makes waitForUpdate a no-op afterwards', async () => {
    const { unmount } = await render(SingleView);
    unmount();
    await expect(waitForUpdate()).resolves.toBeUndefined();
  });
});

describe('waitForUpdate', () => {
  it('resolves without error when no app is mounted', async () => {
    cleanup();
    await expect(waitForUpdate()).resolves.toBeUndefined();
  });
});

describe('rerender', () => {
  it('renders the new component in place of the old one', async () => {
    @Component({
      selector: 'test-rerender-a',
      template: `<text>Component A</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class RerenderA {}

    @Component({
      selector: 'test-rerender-b',
      template: `<text>Component B</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class RerenderB {}

    const { container, rerender, asFragment } = await render(RerenderA);
    expect(container.querySelector('text')!.textContent).toBe('Component A');
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <text>
            Component A
          </text>
        </page>
      </DocumentFragment>
    `);

    const result = await rerender(RerenderB);
    expect(result.container.querySelector('text')!.textContent).toBe(
      'Component B',
    );
    expect(result.asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <text>
            Component B
          </text>
        </page>
      </DocumentFragment>
    `);
  });

  it('does not leave elements from the previous component', async () => {
    @Component({
      selector: 'test-rerender-cleanup-a',
      template: `<text>Old</text><text>Also old</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class Old {}

    @Component({
      selector: 'test-rerender-cleanup-b',
      template: `<text>New</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class New {}

    const { rerender } = await render(Old);
    const { container } = await rerender(New);

    const texts = container.querySelectorAll('text');
    expect(texts.length).toBe(1);
    expect(texts[0]!.textContent).toBe('New');
  });

  it('accepts new providers for the rerendered component', async () => {
    const TOKEN = new InjectionToken<string>('rerender-token');

    @Component({
      selector: 'test-rerender-provider',
      template: `<text>{{ value }}</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class WithToken {
      value = inject(TOKEN);
    }

    @Component({
      selector: 'test-rerender-provider-initial',
      template: `<text>initial</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class Initial {}

    const { rerender } = await render(Initial);
    const { container } = await rerender(WithToken, {
      providers: [{ provide: TOKEN, useValue: 'from-rerender' }],
    });

    expect(container.querySelector('text')!.textContent).toBe('from-rerender');
  });

  it('returned result has working @testing-library/dom queries', async () => {
    @Component({
      selector: 'test-rerender-queries-a',
      template: `<text>Before</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class Before {}

    @Component({
      selector: 'test-rerender-queries-b',
      template: `<text>After</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class After {}

    const { rerender } = await render(Before);
    const { getByText, queryByText } = await rerender(After);

    expect(getByText('After')).not.toBeNull();
    expect(queryByText('Before')).toBeNull();
  });

  it('returned result has a working asFragment()', async () => {
    @Component({
      selector: 'test-rerender-fragment-a',
      template: `<view></view>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class FragmentBefore {}

    @Component({
      selector: 'test-rerender-fragment-b',
      template: `<text>Fragment content</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class FragmentAfter {}

    const { rerender } = await render(FragmentBefore);
    const { asFragment } = await rerender(FragmentAfter);
    const fragment = asFragment();

    expect(fragment).toBeInstanceOf(DocumentFragment);
    expect(fragment.querySelector('text')!.textContent).toBe(
      'Fragment content',
    );
  });

  it('returned componentRef refers to the new component instance', async () => {
    @Component({
      selector: 'test-rerender-component-ref-a',
      template: `<view></view>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ComponentRefBefore {}

    @Component({
      selector: 'test-rerender-component-ref-b',
      template: `<view></view>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class ComponentRefAfter {}

    const { rerender } = await render(ComponentRefBefore);
    const { componentRef } = await rerender(ComponentRefAfter);

    expect(componentRef.instance).toBeInstanceOf(ComponentRefAfter);
  });

  it('custom queries option works on the rerendered result', async () => {
    const getByTag = (container: HTMLElement, tag: string): HTMLElement => {
      const el = container.querySelector(tag);
      if (!el) throw new Error(`No <${tag}>`);
      return el as HTMLElement;
    };

    @Component({
      selector: 'test-rerender-custom-q-a',
      template: `<view></view>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class CustomQBefore {}

    @Component({
      selector: 'test-rerender-custom-q-b',
      template: `<text>Custom</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class CustomQAfter {}

    const { rerender } = await render(CustomQBefore);
    const result = await rerender(CustomQAfter, {
      queries: { getByTag },
    });

    expect(result.getByTag('text').textContent).toBe('Custom');
  });
});

describe('asFragment', () => {
  it('returns a DocumentFragment containing the rendered output', async () => {
    const { asFragment } = await render(TextDisplay);
    const fragment = asFragment();
    expect(fragment).toBeInstanceOf(DocumentFragment);
    expect(fragment.querySelector('text')!.textContent).toBe('Hello Lynx');
  });

  it('matches a snapshot', async () => {
    const { asFragment } = await render(Nested);
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <view>
            <text>
              First
            </text>
            <text>
              Second
            </text>
          </view>
        </page>
      </DocumentFragment>
    `);
  });

  it('reflects the DOM at the moment it is called', async () => {
    const label = signal('before');

    @Component({
      selector: 'test-fragment-signal',
      template: `<text>{{ label() }}</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class FragmentSignal {
      label = label;
    }

    const { asFragment } = await render(FragmentSignal);
    expect(asFragment().querySelector('text')!.textContent).toBe('before');

    label.set('after');
    await waitForUpdate();

    expect(asFragment().querySelector('text')!.textContent).toBe('after');
  });
});

describe('options.providers', () => {
  it('makes custom providers available to the component', async () => {
    const TOKEN = new InjectionToken<string>('test-render-token');

    @Component({
      selector: 'test-with-provider',
      template: `<text>{{ value }}</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class WithProvider {
      value = inject(TOKEN);
    }

    const { container, asFragment } = await render(WithProvider, {
      providers: [{ provide: TOKEN, useValue: 'hello-from-provider' }],
    });

    expect(container.querySelector('text')!.textContent).toBe(
      'hello-from-provider',
    );
    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <page
          ng-version="22.0.2"
        >
          <text>
            hello-from-provider
          </text>
        </page>
      </DocumentFragment>
    `);
  });
});

describe('componentRef', () => {
  it('is present in the render result', async () => {
    const { componentRef } = await render(SingleView);
    expect(componentRef).toBeDefined();
    expect(componentRef.instance).toBeInstanceOf(SingleView);
  });

  it('provides injector access for retrieving services', async () => {
    const TOKEN = new InjectionToken<string>('component-ref-token');

    @Component({
      selector: 'test-component-ref-injector',
      template: `<view></view>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class InjectorTest {}

    const { componentRef } = await render(InjectorTest, {
      providers: [{ provide: TOKEN, useValue: 'from-injector' }],
    });

    expect(componentRef.injector.get(TOKEN)).toBe('from-injector');
  });

  it('exposes instance signals for direct state manipulation', async () => {
    /**
     * In the Vitest JIT environment, Angular does not compile signal inputs
     * (input()) or @Input() decorators into the component definition — both
     * require the full AOT pipeline or TestBed. The practical test-authoring
     * pattern is to expose a writable signal() on the instance and drive it
     * directly via componentRef.instance.
     */
    @Component({
      selector: 'test-component-ref-signal',
      template: `<text>{{ label() }}</text>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class InstanceSignal {
      label = signal('initial');
    }

    const { container, componentRef } = await render(InstanceSignal);
    expect(container.querySelector('text')!.textContent).toBe('initial');

    (componentRef.instance as InstanceSignal).label.set('updated');
    await waitForUpdate();

    expect(container.querySelector('text')!.textContent).toBe('updated');
  });
});

describe('returned queries', () => {
  it('getByText finds an element by its text content', async () => {
    const { getByText } = await render(TextDisplay);
    expect(getByText('Hello Lynx')).not.toBeNull();
  });

  it('queryByText returns null when the text is absent', async () => {
    const { queryByText } = await render(TextDisplay);
    expect(queryByText('Not present')).toBeNull();
  });
});

describe('options.queries', () => {
  const queryByTag = (
    container: HTMLElement,
    tag: string,
  ): HTMLElement | null => container.querySelector(tag);

  const getByTag = (container: HTMLElement, tag: string): HTMLElement => {
    const el = container.querySelector(tag);
    if (!el) throw new Error(`Unable to find element with tag: ${tag}`);
    return el as HTMLElement;
  };

  const customQueries = { queryByTag, getByTag };

  it('merges custom queries into the render result', async () => {
    const result = await render(TextDisplay, { queries: customQueries });
    expect(typeof result.getByTag).toBe('function');
    expect(typeof result.queryByTag).toBe('function');
  });

  it('custom query finds the correct element', async () => {
    const result = await render(TextDisplay, { queries: customQueries });
    const el = result.getByTag('text');
    expect(el).not.toBeNull();
    expect(el.textContent).toBe('Hello Lynx');
  });

  it('custom query returns null when the element is absent', async () => {
    const result = await render(TextDisplay, { queries: customQueries });
    expect(result.queryByTag('image')).toBeNull();
  });

  it('standard queries still work alongside custom queries', async () => {
    const result = await render(TextDisplay, { queries: customQueries });
    expect(result.getByText('Hello Lynx')).not.toBeNull();
    expect(result.getByTag('text')).not.toBeNull();
  });
});
