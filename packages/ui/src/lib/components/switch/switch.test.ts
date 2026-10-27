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
import { UiSwitch } from './switch';

@Component({
  imports: [UiSwitch],
  template: `
    <ui-switch
      [(checked)]="checked"
      [disabled]="disabled()"
      class="ml-2"
      (changed)="changes.push($event)"
    />
  `,
})
class SwitchHost {
  readonly checked = signal(false);
  readonly disabled = signal(false);
  readonly changes: boolean[] = [];
}

const renderSwitch = async () => {
  const result = await render(SwitchHost);
  return {
    ...result,
    host: result.componentRef.instance as SwitchHost,
    track: () => result.container.querySelector('.flex-row')!,
    thumb: () => result.container.querySelector('.bg-background')!,
  };
};

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling one. */
const CANCEL = 3;

describe('UiSwitch', () => {
  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => animate.mockRestore());

  it('renders off, with the thumb at the left and the given class', async () => {
    const { track, thumb } = await renderSwitch();
    expect(track().classList).toContain('bg-input');
    expect(track().classList).toContain('ml-2');
    expect(thumb().getAttribute('style')).toContain('translateX(2px)');
  });

  it('turns on and off on tap, emitting `changed`', async () => {
    const { host, track, thumb } = await renderSwitch();

    fireEvent.tap(track());
    await waitForUpdate();
    expect(host.checked()).toBe(true);
    expect(track().classList).toContain('bg-primary');
    expect(thumb().getAttribute('style')).toContain('translateX(22px)');

    fireEvent.tap(track());
    await waitForUpdate();
    expect(host.checked()).toBe(false);
    expect(host.changes).toEqual([true, false]);
  });

  it('springs the thumb across the track, squishing it halfway', async () => {
    const { track, thumb } = await renderSwitch();

    fireEvent.tap(track());
    expect(animate).toHaveBeenCalledWith(thumb(), [
      START,
      expect.any(String),
      [
        { transform: 'translateX(2px) scale(1)' },
        { transform: 'translateX(12px) scale(1.1)' },
        { transform: 'translateX(22px) scale(1)' },
      ],
      expect.objectContaining({ fill: 'forwards' }),
    ]);

    // Turning it back off cuts the first spring short and springs it back.
    fireEvent.tap(track());
    expect(animate).toHaveBeenCalledWith(thumb(), [CANCEL, expect.any(String)]);
    expect(animate).toHaveBeenLastCalledWith(thumb(), [
      START,
      expect.any(String),
      [
        { transform: 'translateX(22px) scale(1)' },
        { transform: 'translateX(12px) scale(1.1)' },
        { transform: 'translateX(2px) scale(1)' },
      ],
      expect.objectContaining({ fill: 'forwards' }),
    ]);
  });

  it('follows its checked binding', async () => {
    const { host, thumb } = await renderSwitch();
    host.checked.set(true);
    await waitForUpdate();
    expect(thumb().getAttribute('style')).toContain('translateX(22px)');
  });

  it('dims and ignores taps while disabled', async () => {
    const { host, track } = await renderSwitch();
    host.disabled.set(true);
    await waitForUpdate();
    expect(track().classList).toContain('opacity-50');

    fireEvent.tap(track());
    await waitForUpdate();
    expect(host.checked()).toBe(false);
    expect(host.changes).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
  });
});
