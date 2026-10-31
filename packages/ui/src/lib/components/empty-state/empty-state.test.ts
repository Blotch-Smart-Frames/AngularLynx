import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import type { IconName } from '../icon/icons';
import { UiEmptyState } from './empty-state';

@Component({
  imports: [UiEmptyState, LYNX_ELEMENTS],
  template: `
    <ui-empty-state
      [icon]="icon()"
      title="No results"
      [description]="description()"
      class="py-6"
    >
      <text>Clear the filters</text>
    </ui-empty-state>
  `,
})
class EmptyStateHost {
  readonly icon = signal<IconName | undefined>(undefined);
  readonly description = signal('');
}

describe('UiEmptyState', () => {
  it('shows only the title and projected content by default', async () => {
    const { container, getByText, queryByText } = await render(EmptyStateHost);
    expect(getByText('No results').classList).toContain('font-semibold');
    expect(getByText('Clear the filters')).toBeTruthy();
    expect(queryByText('Try adjusting your search')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.py-6')).toBeTruthy();
  });

  // Static attributes land on a component's host too (issue #181): the
  // padding once, on the empty state itself, and the title only as its text.
  it('puts its class on one element, and its title only in its text', async () => {
    const { container, queryAllByTitle } = await render(EmptyStateHost);
    expect(container.querySelectorAll('.py-6')).toHaveLength(1);
    expect(container.querySelector('.py-6')?.classList).toContain('flex-col');
    expect(queryAllByTitle('No results')).toEqual([]);
  });

  it('adds the icon and description when they are set', async () => {
    const { componentRef, container, getByText } = await render(EmptyStateHost);
    const host = componentRef.instance as EmptyStateHost;
    host.icon.set('search');
    host.description.set('Try adjusting your search');
    await waitForUpdate();
    expect(getByText('Try adjusting your search').classList).toContain(
      'text-muted-foreground',
    );
    expect(container.querySelector('svg')?.getAttribute('content')).toContain(
      '<svg',
    );
  });
});
