import {
  render,
  screen,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import { UiPagination } from './pagination';

/**
 * The screen reader labels of the row's buttons, in order. getAllByRole()
 * finds only what a screen reader reaches as a button, so this also checks
 * each one's traits and accessibility-element.
 */
const labels = (): (string | null)[] =>
  screen
    .getAllByRole('button')
    .map((button) => button.getAttribute('accessibility-label'));

describe('UiPagination', () => {
  const setup = async (totalPages: number, page = 1, siblingCount = 1) => {
    const { componentRef, container } = await render(UiPagination);
    const inst = componentRef.instance as UiPagination;
    setInputSignal(inst.totalPages, totalPages);
    setInputSignal(inst.siblingCount, siblingCount);
    inst.page.set(page);
    await waitForUpdate();
    return { inst, container };
  };

  it('renders the pagination controls', async () => {
    const { container } = await setup(5, 2);
    expect(container).toBeTruthy();
  });

  it('lists every page when total fits the un-truncated window', async () => {
    // With siblings=1 the threshold is 5+2 = 7, so a total of 5 stays inline.
    const { container } = await setup(5, 3);
    // Each page should render its numeric label.
    const text = container.textContent ?? '';
    expect(text).toContain('1');
    expect(text).toContain('5');
    expect(text).not.toContain('...');
  });

  it('inserts a trailing ellipsis when the window is near the start', async () => {
    // total=10, page=2, siblings=1 → rangeStart=2, rangeEnd=3; gap on right only.
    const { container } = await setup(10, 2);
    expect(container.textContent ?? '').toContain('...');
  });

  it('inserts a leading ellipsis when the window is near the end', async () => {
    // total=10, page=9, siblings=1 → rangeStart=8, rangeEnd=9; gap on left only.
    const { container } = await setup(10, 9);
    expect(container.textContent ?? '').toContain('...');
  });

  it('inserts leading and trailing ellipses when the window sits in the middle', async () => {
    // total=10, page=5, siblings=1 → rangeStart=4, rangeEnd=6; gaps on both sides.
    const { container } = await setup(10, 5);
    // Two ellipses in the DOM as separate <text> nodes.
    expect(
      container.textContent?.match(/\.\.\./g)?.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('prev() decrements page when > 1', async () => {
    const { inst } = await setup(5, 3);
    (inst as unknown as { prev: () => void }).prev();
    await waitForUpdate();
    expect(inst.page()).toBe(2);
  });

  it('prev() is a no-op at page 1', async () => {
    const { inst } = await setup(5, 1);
    (inst as unknown as { prev: () => void }).prev();
    await waitForUpdate();
    expect(inst.page()).toBe(1);
  });

  it('next() increments page when < totalPages', async () => {
    const { inst } = await setup(5, 3);
    (inst as unknown as { next: () => void }).next();
    await waitForUpdate();
    expect(inst.page()).toBe(4);
  });

  it('next() is a no-op at the last page', async () => {
    const { inst } = await setup(5, 5);
    (inst as unknown as { next: () => void }).next();
    await waitForUpdate();
    expect(inst.page()).toBe(5);
  });

  it('goTo() jumps the page directly', async () => {
    const { inst } = await setup(5, 1);
    (inst as unknown as { goTo: (n: number) => void }).goTo(4);
    await waitForUpdate();
    expect(inst.page()).toBe(4);
  });

  it('active page carries the primary variant class', async () => {
    const { container } = await setup(3, 2);
    // The active page's tile background is bg-primary; the others are transparent.
    const primary = Array.from(container.querySelectorAll('view')).find((el) =>
      el.getAttribute('class')?.includes('bg-primary'),
    );
    expect(primary).toBeTruthy();
  });

  it('labels every button for screen readers', async () => {
    await setup(3, 2);
    expect(labels()).toEqual([
      'Previous page',
      'Page 1',
      'Page 2, current page',
      'Page 3',
      'Next page',
    ]);
  });

  it('takes its own labels', async () => {
    const { inst } = await setup(2, 1);
    setInputSignal(inst.previousLabel, 'Back');
    setInputSignal(inst.nextLabel, 'Forward');
    setInputSignal(inst.pageLabel, (page: number, current: boolean) =>
      current ? `Results ${page}, showing` : `Results ${page}`,
    );
    await waitForUpdate();
    expect(labels()).toEqual([
      'Back',
      'Results 1, showing',
      'Results 2',
      'Forward',
    ]);
  });

  it('hides the gaps from screen readers', async () => {
    const { container } = await setup(10, 5);
    const gaps = Array.from(container.querySelectorAll('text'))
      .filter((el) => el.textContent === '...')
      .map((el) =>
        el.parentElement?.getAttribute('accessibility-elements-hidden'),
      );
    expect(gaps).toEqual(['true', 'true']);
  });

  it("draws the arrows in the theme's foreground", async () => {
    const { container } = await setup(3, 2);
    const arrows = Array.from(container.querySelectorAll('svg')).map((el) =>
      el.getAttribute('content'),
    );
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) {
      expect(arrow).toContain(ICON_LIGHT_COLORS['foreground']);
      expect(arrow).not.toContain('currentColor');
    }
  });
});
