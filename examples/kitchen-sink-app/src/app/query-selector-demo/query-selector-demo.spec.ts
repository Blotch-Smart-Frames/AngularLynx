import { getQueriesForElement } from '@blotch/angular-lynx-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { renderOnce } from '../../test-utils/render-once';
import { QuerySelectorDemo } from './query-selector-demo';

// This demo renders <ui-icon>, whose `name` is a required input(). The shared
// render() helper's extra appRef.tick() trips an Angular 22 zoneless-JIT bug that
// resets that required input to undefined mid-render, crashing UiIcon. renderOnce()
// bootstraps with a single tick and avoids it (see src/test-utils/render-once.ts
// and motion-demo.spec.ts).
let destroyDemo: (() => void) | null = null;

afterEach(() => {
  destroyDemo?.();
  destroyDemo = null;
});

describe('QuerySelectorDemo', () => {
  it('renders the page title', async () => {
    const { container, destroy } = await renderOnce(QuerySelectorDemo);
    destroyDemo = destroy;
    expect(container.textContent).toContain('querySelector');
  });

  it('renders the element tree being queried', async () => {
    const { container, destroy } = await renderOnce(QuerySelectorDemo);
    destroyDemo = destroy;
    const { getByText } = getQueriesForElement(container);
    expect(getByText('Item A')).toBeTruthy();
    expect(getByText('Item B (active)')).toBeTruthy();
    expect(getByText('Item C')).toBeTruthy();
    expect(getByText('Label')).toBeTruthy();
  });

  // The component resolves its query results in ngAfterViewInit via a
  // `viewChild.required('subject')` ElementRef. That template-ref query does NOT
  // resolve in the jsdom test renderer (Lynx-created elements aren't tracked as
  // Angular local refs here — the same limitation the motion-demo overlay tests
  // document), so the component's result signals stay 'pending' under test and
  // can't be asserted directly. Instead we verify the underlying capability the
  // component relies on: querySelector/querySelectorAll against the rendered
  // element tree. `container` is that exact tree — the virtual DOM the component
  // queries on-device — so these assertions mirror ngAfterViewInit's own logic.

  it('querySelector finds the active element by class selector', async () => {
    const { container, destroy } = await renderOnce(QuerySelectorDemo);
    destroyDemo = destroy;
    expect(container.querySelector('.qs-active')).toBeTruthy();
  });

  it('querySelectorAll reflects 3 qs-item elements', async () => {
    const { container, destroy } = await renderOnce(QuerySelectorDemo);
    destroyDemo = destroy;
    expect(container.querySelectorAll('.qs-item').length).toBe(3);
  });

  it('querySelector finds element by ID selector', async () => {
    const { container, destroy } = await renderOnce(QuerySelectorDemo);
    destroyDemo = destroy;
    expect(container.querySelector('#qs-first')).toBeTruthy();
  });

  it('querySelector finds element with compound tag+class selector', async () => {
    const { container, destroy } = await renderOnce(QuerySelectorDemo);
    destroyDemo = destroy;
    expect(container.querySelector('text.qs-label')).toBeTruthy();
  });

  it('querySelector supports descendant combinator selectors in jsdom', async () => {
    const { container, destroy } = await renderOnce(QuerySelectorDemo);
    destroyDemo = destroy;
    // jsdom's native CSS engine DOES support descendant combinator selectors
    // ('view view'). On a real Lynx device the background thread's querySelector
    // intentionally does NOT support combinators and returns null — this
    // divergence is exactly why the combinator case exists in the demo.
    expect(container.querySelector('view view')).toBeTruthy();
  });
});
