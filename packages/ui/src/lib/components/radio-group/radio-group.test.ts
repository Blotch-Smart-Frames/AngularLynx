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
import { UiRadioGroup, UiRadioGroupItem } from './radio-group';

@Component({
  imports: [UiRadioGroup, UiRadioGroupItem],
  template: `
    <ui-radio-group
      [(value)]="value"
      [disabled]="disabled()"
      class="mt-2"
      (changed)="changes.push($event)"
    >
      <ui-radio-group-item value="a" class="pl-1">Apple</ui-radio-group-item>
      <ui-radio-group-item value="b">Banana</ui-radio-group-item>
    </ui-radio-group>
  `,
})
class RadioGroupHost {
  readonly value = signal('a');
  readonly disabled = signal(false);
  readonly changes: string[] = [];
}

const renderGroup = async () => {
  const result = await render(RadioGroupHost);
  /**
   * An item's row, which takes the tap: its label's parent.
   */
  const item = (label: string) => result.getByText(label).parentElement!;
  /**
   * An item's dot, inside the circle that's the row's first child.
   */
  const dot = (label: string) =>
    item(label).firstElementChild!.firstElementChild!;
  return {
    ...result,
    host: result.componentRef.instance as RadioGroupHost,
    item,
    dot,
  };
};

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling one. */
const CANCEL = 3;

describe('UiRadioGroup', () => {
  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => animate.mockRestore());

  it('renders each item with its label and class', async () => {
    const { container, item } = await renderGroup();
    expect(container.querySelector('.flex-col')?.classList).toContain('mt-2');
    expect(item('Apple').classList).toContain('pl-1');
    expect(item('Banana').classList).toContain('h-11');
  });

  it('shows the dot of the selected item only', async () => {
    const { dot } = await renderGroup();
    expect(dot('Apple').getAttribute('style')).toContain('opacity: 1');
    expect(dot('Banana').getAttribute('style')).toContain('opacity: 0');
  });

  it('selects the tapped item, updating the value and emitting `changed`', async () => {
    const { host, item, dot } = await renderGroup();
    fireEvent.tap(item('Banana'));
    await waitForUpdate();
    expect(host.value()).toBe('b');
    expect(host.changes).toEqual(['b']);
    expect(dot('Banana').getAttribute('style')).toContain('opacity: 1');
    expect(dot('Apple').getAttribute('style')).toContain('opacity: 0');
  });

  it("doesn't animate the dot on mount, then pops it in and out as the selection changes", async () => {
    const { host, dot } = await renderGroup();
    // A pre-selected item shows its dot without animating it in.
    expect(animate).not.toHaveBeenCalled();

    host.value.set('b');
    await waitForUpdate();
    // The new selection's dot pops in from a smaller scale...
    expect(animate).toHaveBeenCalledWith(dot('Banana'), [
      START,
      expect.any(String),
      [
        { transform: 'scale(0.6)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      expect.objectContaining({ fill: 'forwards' }),
    ]);
    // ...and the old one pops out.
    expect(animate).toHaveBeenCalledWith(dot('Apple'), [
      START,
      expect.any(String),
      [
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(0.8)', opacity: 0 },
      ],
      expect.objectContaining({ fill: 'forwards' }),
    ]);

    // Selecting it again cuts its pop-out short.
    host.value.set('a');
    await waitForUpdate();
    expect(animate).toHaveBeenCalledWith(dot('Apple'), [
      CANCEL,
      expect.any(String),
    ]);
  });

  it('ignores taps while disabled, and dims its items', async () => {
    const { host, item } = await renderGroup();
    host.disabled.set(true);
    await waitForUpdate();
    expect(item('Apple').classList).toContain('opacity-50');

    fireEvent.tap(item('Banana'));
    await waitForUpdate();
    expect(host.value()).toBe('a');
    expect(host.changes).toEqual([]);
  });

  it("can't be selected through its own select() while disabled", async () => {
    // An item checks the group first, but select() is public: a caller that
    // goes straight to the group gets the same rule.
    const { componentRef } = await render(UiRadioGroup);
    componentRef.setInput('disabled', true);
    await waitForUpdate();
    const group = componentRef.instance as UiRadioGroup;
    const changed = vi.fn();
    group.changed.subscribe(changed);

    group.select('b');
    expect(group.value()).toBe('');
    expect(changed).not.toHaveBeenCalled();
  });
});
