import { Component, ErrorHandler, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import { type IconName, provideIcons } from '../icon/icons';
import { UiEmptyState } from './empty-state';
import { searchIcon } from '../icon/icon-set';

// The icons these specs draw by name, registered as an app registers its own.
const TEST_ICONS = provideIcons({ searchIcon });

@Component({
  providers: [TEST_ICONS],
  imports: [UiEmptyState, LYNX_ELEMENTS],
  template: `
    <ui-empty-state
      [icon]="icon()"
      [svg]="svg()"
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
  readonly svg = signal<string | undefined>(undefined);
  readonly description = signal('');
}

/**
 * An app's own one-color mark, with no SVG namespace, as an app writes one.
 */
const MARK =
  '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Z"/></svg>';

describe('UiEmptyState', () => {
  it('shows only the title and projected content by default', async () => {
    const { container, getByText, queryByText } = await render(EmptyStateHost);
    expect(getByText('No results').classList).toContain('font-semibold');
    // A screen's worth of nothing gets a heading, centered if it wraps.
    expect(getByText('No results').classList).toContain('text-xl');
    expect(getByText('No results').classList).toContain('text-center');
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
    expect(getByText('Try adjusting your search').classList).toContain(
      'text-base',
    );
    const icon = container.querySelector('svg')!;
    expect(icon.getAttribute('content')).toContain('<svg');
    // The icon is as quiet as the description: the muted foreground,
    // resolved for the SVG, which can't read the CSS variable.
    expect(icon.getAttribute('content')).toContain(
      ICON_LIGHT_COLORS['muted-foreground'],
    );
    expect(icon.getAttribute('content')).not.toContain(
      ICON_LIGHT_COLORS['foreground'],
    );
    expect(icon.classList).toContain('mb-4');
    expect((icon as unknown as HTMLElement).style.width).toBe('32px');
  });

  it("draws the app's own svg where the set's icon goes", async () => {
    const { componentRef, container } = await render(EmptyStateHost);
    const host = componentRef.instance as EmptyStateHost;
    host.svg.set(MARK);
    await waitForUpdate();
    const icon = container.querySelector('svg')!;
    const content = icon.getAttribute('content') ?? '';
    // The namespace the web preview needs, and the muted foreground in place
    // of currentColor, at the set's icon's size and place.
    expect(content).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(content).toContain(
      `fill="${ICON_LIGHT_COLORS['muted-foreground']}"`,
    );
    expect(icon.classList).toContain('mb-4');
    expect((icon as unknown as HTMLElement).style.width).toBe('32px');
  });

  it('reports an error with both an icon and an svg', async () => {
    const handleError = vi.fn();
    const { componentRef } = await render(EmptyStateHost, {
      providers: [{ provide: ErrorHandler, useValue: { handleError } }],
    });
    const host = componentRef.instance as EmptyStateHost;
    host.icon.set('search');
    host.svg.set(MARK);
    await waitForUpdate();
    expect(handleError.mock.calls.map(([error]) => error)).toContainEqual(
      new Error('<ui-empty-state> takes an icon or an svg, not both.'),
    );
  });
});
