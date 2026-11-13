import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import { UiPagination } from './pagination';

@Component({
  imports: [UiPagination],
  template: `
    <ui-pagination
      [(page)]="page"
      [totalPages]="totalPages()"
      [siblingCount]="siblingCount()"
      class="mt-4"
    />
  `,
})
class PaginationHost {
  readonly page = signal(1);
  readonly totalPages = signal(5);
  readonly siblingCount = signal(1);
}

@Component({
  imports: [UiPagination],
  template: `
    <ui-pagination
      [totalPages]="2"
      previousLabel="Back"
      nextLabel="Forward"
      [pageLabel]="resultsLabel"
    />
  `,
})
class LabeledPaginationHost {
  readonly resultsLabel = (page: number, current: boolean): string =>
    current ? `Results ${page}, showing` : `Results ${page}`;
}

/**
 * Renders the row at a page of a total, with `siblingCount` pages on each
 * side of the current one.
 */
const renderPagination = async (
  totalPages: number,
  page = 1,
  siblingCount = 1,
) => {
  const result = await render(PaginationHost);
  const host = result.componentRef.instance as PaginationHost;
  host.totalPages.set(totalPages);
  host.siblingCount.set(siblingCount);
  host.page.set(page);
  await waitForUpdate();
  return {
    ...result,
    host,
    /** The button a screen reader reads as `label`. */
    button: (label: string) => result.getByRole('button', { name: label }),
  };
};

/**
 * What a gap between pages shows: one character, the ellipsis, rather than
 * three full stops.
 */
const GAP = '…';

/**
 * What the row shows between its arrows, in order: page numbers and gaps.
 */
const shown = (container: Element): (string | null)[] =>
  Array.from(container.querySelectorAll('text')).map(
    (el) => el.textContent?.trim() ?? null,
  );

/**
 * The screen reader labels of the row's buttons, in order. getAllByRole()
 * finds only what a screen reader reaches as a button, so this also checks
 * each one's traits and accessibility-element.
 */
const labels = (container: Element): (string | null)[] =>
  within(container as HTMLElement)
    .getAllByRole('button')
    .map((button) => button.getAttribute('accessibility-label'));

describe('UiPagination', () => {
  it('lists every page when they all fit, with the given class', async () => {
    // With one sibling, up to 5 + 1 * 2 = 7 pages fit without gaps.
    const { container } = await renderPagination(7, 3);
    expect(shown(container)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(container.querySelector('.gap-1')?.classList).toContain('mt-4');
  });

  // Angular gives a component's host every static attribute written on it,
  // so a row inside the host as well applied the class twice (issue #181).
  it('puts its class on one element, the row', async () => {
    const { container } = await renderPagination(7, 3);
    expect([...container.querySelectorAll('.mt-4')]).toEqual([
      container.querySelector('.gap-1'),
    ]);
  });

  it('leaves a gap before the last page near the start', async () => {
    const { container } = await renderPagination(10, 2);
    expect(shown(container)).toEqual(['1', '2', '3', GAP, '10']);
  });

  it('leaves a gap after the first page near the end', async () => {
    const { container } = await renderPagination(10, 9);
    expect(shown(container)).toEqual(['1', GAP, '8', '9', '10']);
  });

  it('leaves gaps on both sides in the middle', async () => {
    const { container } = await renderPagination(10, 5);
    expect(shown(container)).toEqual(['1', GAP, '4', '5', '6', GAP, '10']);
  });

  it('widens the window around the current page with more siblings', async () => {
    const { container } = await renderPagination(12, 6, 2);
    expect(shown(container)).toEqual([
      '1',
      GAP,
      '4',
      '5',
      '6',
      '7',
      '8',
      GAP,
      '12',
    ]);
  });

  it('makes every button a 44px touch target that gives up width on a narrow screen', async () => {
    // Nine buttons at full width need more than most phones have, so they
    // shrink before they push the row off the screen.
    const { container, button } = await renderPagination(10, 5);
    for (const label of ['Previous page', 'Page 5, current page', 'Page 10']) {
      for (const name of ['h-11', 'w-11', 'shrink', 'rounded-lg']) {
        expect(button(label).classList).toContain(name);
      }
    }
    expect(within(button('Page 10')).getByText('10').classList).toContain(
      'text-base',
    );
    // A gap is as tall as the buttons, and narrower.
    const gap = within(container as HTMLElement).getAllByText(GAP)[0]!;
    expect(gap.classList).toContain('text-base');
    expect(gap.parentElement!.classList).toContain('h-11');
    expect(gap.parentElement!.classList).toContain('w-6');
  });

  it('highlights the current page', async () => {
    const { button } = await renderPagination(3, 2);
    expect(button('Page 2, current page').classList).toContain('bg-primary');
    expect(button('Page 1').classList).toContain('bg-transparent');
    expect(button('Page 2, current page').textContent?.trim()).toBe('2');
  });

  it('goes to a tapped page', async () => {
    const { host, button } = await renderPagination(5, 1);
    fireEvent.tap(button('Page 4'));
    await waitForUpdate();
    expect(host.page()).toBe(4);
    expect(button('Page 4, current page').classList).toContain('bg-primary');
  });

  it('steps back and forward with the arrows', async () => {
    const { host, button } = await renderPagination(5, 3);
    fireEvent.tap(button('Previous page'));
    await waitForUpdate();
    expect(host.page()).toBe(2);

    fireEvent.tap(button('Next page'));
    fireEvent.tap(button('Next page'));
    await waitForUpdate();
    expect(host.page()).toBe(4);
  });

  it("dims the arrow that can't go further, and ignores its taps", async () => {
    const first = await renderPagination(5, 1);
    expect(first.button('Previous page').classList).toContain('opacity-50');
    expect(first.button('Next page').classList).not.toContain('opacity-50');
    fireEvent.tap(first.button('Previous page'));
    await waitForUpdate();
    expect(first.host.page()).toBe(1);

    const last = await renderPagination(5, 5);
    expect(last.button('Next page').classList).toContain('opacity-50');
    fireEvent.tap(last.button('Next page'));
    await waitForUpdate();
    expect(last.host.page()).toBe(5);
  });

  it('labels every button for screen readers', async () => {
    const { container } = await renderPagination(3, 2);
    expect(labels(container)).toEqual([
      'Previous page',
      'Page 1',
      'Page 2, current page',
      'Page 3',
      'Next page',
    ]);
  });

  it('takes its own labels', async () => {
    const { container } = await render(LabeledPaginationHost);
    expect(labels(container)).toEqual([
      'Back',
      'Results 1, showing',
      'Results 2',
      'Forward',
    ]);
  });

  it('hides the gaps from screen readers', async () => {
    const { container } = await renderPagination(10, 5);
    const gaps = Array.from(container.querySelectorAll('text'))
      .filter((el) => el.textContent === GAP)
      .map((el) =>
        el.parentElement?.getAttribute('accessibility-elements-hidden'),
      );
    expect(gaps).toEqual(['true', 'true']);
  });

  it("draws the arrows in the theme's foreground", async () => {
    const { container } = await renderPagination(3, 2);
    const arrows = Array.from(container.querySelectorAll('svg')).map((el) =>
      el.getAttribute('content'),
    );
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) {
      expect(arrow).toContain(ICON_LIGHT_COLORS['foreground']);
      expect(arrow).not.toContain('currentColor');
    }
    // 20px chevrons.
    for (const svg of container.querySelectorAll('svg')) {
      expect((svg as unknown as HTMLElement).style.width).toBe('20px');
      expect((svg as unknown as HTMLElement).style.height).toBe('20px');
    }
  });
});
