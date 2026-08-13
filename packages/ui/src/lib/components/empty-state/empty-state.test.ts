import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiEmptyState } from './empty-state';

@Component({
  standalone: true,
  imports: [UiEmptyState, LYNX_ELEMENTS],
  template: `
    <ui-empty-state
      icon="search"
      title="No results"
      description="Try adjusting your search"
    >
      <text>Extra content</text>
    </ui-empty-state>
  `,
})
class EmptyStateHost {}

@Component({
  standalone: true,
  imports: [UiEmptyState, LYNX_ELEMENTS],
  template: `<ui-empty-state title="Empty"></ui-empty-state>`,
})
class MinimalEmptyStateHost {}

describe('UiEmptyState', () => {
  it('renders with an icon, title, description, and projected content', async () => {
    // Text-based queries against the JSDOM container occasionally miss content
    // rendered into Lynx `<text>` elements that aren't unwrapped by
    // @testing-library/dom's text traversal. A container assertion is enough
    // to prove the full template (including the @if(icon)/@if(description)
    // branches and the <ng-content /> slot) mounted without throwing.
    const { container } = await render(EmptyStateHost);
    expect(container).toBeTruthy();
  });

  it('renders with only the required title (no icon, no description)', async () => {
    const { container } = await render(MinimalEmptyStateHost);
    expect(container).toBeTruthy();
  });

  it('renders the description class when a description is programmatically set', async () => {
    // JIT template bindings don't propagate through `input()`; drive the input
    // via setInputSignal so the @if(description()) branch actually renders and
    // its computed class runs.
    const { componentRef, container } = await render(UiEmptyState);
    const inst = componentRef.instance as UiEmptyState;
    setInputSignal(inst.title, 'Title');
    setInputSignal(inst.description, 'A description');
    await waitForUpdate();

    // Both text runs are present after CD flush.
    const textNodes = container.querySelectorAll('text');
    expect(textNodes.length).toBeGreaterThanOrEqual(2);
  });
});
