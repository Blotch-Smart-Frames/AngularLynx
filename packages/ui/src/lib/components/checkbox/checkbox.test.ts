import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import { UiCheckbox } from './checkbox';

@Component({
  imports: [UiCheckbox],
  template: `
    <ui-checkbox
      [(checked)]="checked"
      [disabled]="disabled()"
      class="mr-2"
      (changed)="changes.push($event)"
    />
  `,
})
class CheckboxHost {
  readonly checked = signal(false);
  readonly disabled = signal(false);
  readonly changes: boolean[] = [];
}

const renderCheckbox = async () => {
  const result = await render(CheckboxHost);
  return {
    ...result,
    host: result.componentRef.instance as CheckboxHost,
    /** The 44pt tap target around the box: the checkbox's host. */
    target: () => result.container.firstElementChild!,
    box: () => result.container.querySelector('.rounded-sm')!,
    checkmark: () => result.getByText('✓'),
  };
};

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling one. */
const CANCEL = 3;

describe('UiCheckbox', () => {
  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => animate.mockRestore());

  it('renders an empty box', async () => {
    const { box, checkmark } = await renderCheckbox();
    expect(box().classList).toContain('bg-transparent');
    expect(checkmark().getAttribute('style')).toContain('opacity: 0');
  });

  // A class on a component lands on its host too (issue #181): the class is
  // the box's, so the host, the tap target, drops its copy.
  it('puts its class on one element, the box', async () => {
    const { container, box, target } = await renderCheckbox();
    expect([...container.querySelectorAll('.mr-2')]).toEqual([box()]);
    expect((target() as HTMLElement).style.width).toBe('2.75rem');
  });

  it('checks and unchecks on tap, emitting `changed`', async () => {
    const { host, target, box, checkmark } = await renderCheckbox();

    fireEvent.tap(target());
    await waitForUpdate();
    expect(host.checked()).toBe(true);
    expect(box().classList).toContain('bg-primary');
    expect(checkmark().getAttribute('style')).toContain('opacity: 1');

    fireEvent.tap(target());
    await waitForUpdate();
    expect(host.checked()).toBe(false);
    expect(host.changes).toEqual([true, false]);
  });

  it("doesn't animate on mount, then pops the checkmark in and out", async () => {
    const { target, checkmark } = await renderCheckbox();
    expect(animate).not.toHaveBeenCalled();

    fireEvent.tap(target());
    await waitForUpdate();
    expect(animate).toHaveBeenCalledWith(checkmark(), [
      START,
      expect.any(String),
      [
        { transform: 'scale(0.6)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      expect.objectContaining({ fill: 'forwards' }),
    ]);

    // Unchecking cuts the pop-in short and pops the checkmark out.
    fireEvent.tap(target());
    await waitForUpdate();
    expect(animate).toHaveBeenCalledWith(checkmark(), [
      CANCEL,
      expect.any(String),
    ]);
    expect(animate).toHaveBeenLastCalledWith(checkmark(), [
      START,
      expect.any(String),
      [
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(0.8)', opacity: 0 },
      ],
      expect.objectContaining({ fill: 'forwards' }),
    ]);
  });

  it("doesn't animate two taps in one frame, which leave it as it was", async () => {
    const { host, target } = await renderCheckbox();
    fireEvent.tap(target());
    fireEvent.tap(target());
    await waitForUpdate();
    expect(host.checked()).toBe(false);
    expect(host.changes).toEqual([true, false]);
    expect(animate).not.toHaveBeenCalled();
  });

  it('dims and ignores taps while disabled', async () => {
    const { host, target, box } = await renderCheckbox();
    host.disabled.set(true);
    await waitForUpdate();
    expect(box().classList).toContain('opacity-50');

    fireEvent.tap(target());
    await waitForUpdate();
    expect(host.checked()).toBe(false);
    expect(host.changes).toEqual([]);
  });
});
