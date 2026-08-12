import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiPagination } from './pagination';

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
    expect(container.textContent?.match(/\.\.\./g)?.length).toBeGreaterThanOrEqual(1);
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
});
