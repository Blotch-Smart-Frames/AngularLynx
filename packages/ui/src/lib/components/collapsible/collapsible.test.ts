import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
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
import {
  UiCollapsible,
  UiCollapsibleContent,
  UiCollapsibleTrigger,
} from './collapsible';

@Component({
  imports: [
    UiCollapsible,
    UiCollapsibleTrigger,
    UiCollapsibleContent,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-collapsible [(open)]="open" [disabled]="disabled()" class="gap-2">
      <ui-collapsible-trigger class="px-2">
        <text>Toggle</text>
      </ui-collapsible-trigger>
      <ui-collapsible-content class="pt-1">
        <text>Details</text>
      </ui-collapsible-content>
    </ui-collapsible>
  `,
})
class CollapsibleHost {
  readonly open = signal(false);
  readonly disabled = signal(false);
}

const renderCollapsible = async () => {
  const result = await render(CollapsibleHost);
  return {
    ...result,
    host: result.componentRef.instance as CollapsibleHost,
    // The trigger's own view holds the tap listener; the projected text is
    // inside it.
    trigger: () => result.getByText('Toggle').parentElement!,
    // The content's own view wraps the projected text while it's open.
    content: () => result.queryByText('Details')?.parentElement ?? null,
  };
};

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling an animation. */
const CANCEL = 3;

describe('UiCollapsible', () => {
  it("merges each part's class with its own", async () => {
    const { container, host, trigger, content } = await renderCollapsible();
    expect(container.querySelector('.flex-col.gap-2')).not.toBeNull();
    expect(trigger().classList).toContain('flex-row');
    expect(trigger().classList).toContain('px-2');

    host.open.set(true);
    await waitForUpdate();
    expect(content()!.classList).toContain('flex-col');
    expect(content()!.classList).toContain('pt-1');
  });

  // A class on a component lands on its host too (issue #181): each part is
  // its host, so each class applies once, and closed content, which is
  // hidden, takes no room for its padding.
  it('puts each class on one element', async () => {
    const { container, host, trigger, content } = await renderCollapsible();
    expect(container.querySelectorAll('.gap-2')).toHaveLength(1);
    expect([...container.querySelectorAll('.px-2')]).toEqual([trigger()]);
    const [closed] = container.querySelectorAll('.pt-1');
    expect(closed!.classList).toContain('hidden');

    host.open.set(true);
    await waitForUpdate();
    expect([...container.querySelectorAll('.pt-1')]).toEqual([content()]);
    expect(content()!.classList).not.toContain('hidden');
  });

  it('opens and closes when the trigger is tapped', async () => {
    const { host, trigger, content } = await renderCollapsible();
    // Closed, the content isn't mounted at all.
    expect(content()).toBeNull();

    fireEvent.tap(trigger());
    await waitForUpdate();
    expect(content()).not.toBeNull();
    expect(host.open()).toBe(true);

    fireEvent.tap(trigger());
    await waitForUpdate();
    expect(content()).toBeNull();
    expect(host.open()).toBe(false);
  });

  it('opens when its `open` is set', async () => {
    const { host, content } = await renderCollapsible();
    host.open.set(true);
    await waitForUpdate();
    expect(content()).not.toBeNull();
  });

  it('dims its trigger and ignores taps while disabled', async () => {
    const { host, trigger, content } = await renderCollapsible();
    expect(trigger().classList).not.toContain('opacity-50');

    host.disabled.set(true);
    await waitForUpdate();
    expect(trigger().classList).toContain('opacity-50');

    fireEvent.tap(trigger());
    await waitForUpdate();
    expect(content()).toBeNull();
    expect(host.open()).toBe(false);
  });

  describe('reveal animation', () => {
    // Watched per test: the testing library resets the main thread after each.
    let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
    beforeEach(() => {
      animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    });
    afterEach(() => animate.mockRestore());

    /**
     * The keys of the animations started on an element.
     */
    const startedOn = (element: Element | null) =>
      animate.mock.calls
        .filter(
          ([target, [operation]]) => target === element && operation === START,
        )
        .map(([, [, key]]) => key);

    it('slides the content down into place each time it opens', async () => {
      const { trigger, content } = await renderCollapsible();

      fireEvent.tap(trigger());
      // The first update runs the effect, which waits a macrotask so the
      // content is committed to Lynx's tree; the second lets that run.
      await waitForUpdate();
      await waitForUpdate();
      expect(animate).toHaveBeenCalledWith(content(), [
        START,
        expect.any(String),
        [
          { transform: 'translateY(-8px)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 },
        ],
        // No fill: once it ends, the content's own style applies.
        expect.objectContaining({ fill: 'none' }),
      ]);
      const [firstKey] = startedOn(content());

      fireEvent.tap(trigger());
      await waitForUpdate();
      fireEvent.tap(trigger());
      await waitForUpdate();
      await waitForUpdate();
      // Reopening stops the previous reveal before it plays a new one.
      expect(animate).toHaveBeenCalledWith(content(), [CANCEL, firstKey]);
      expect(startedOn(content())).toHaveLength(2);
    });

    it("doesn't animate content that closed before its reveal began", async () => {
      const { componentRef, trigger, content } = await renderCollapsible();

      fireEvent.tap(trigger());
      // The effect has scheduled the reveal for the next macrotask.
      await waitForUpdate();
      // Close it before then, and render that straight away.
      fireEvent.tap(trigger());
      componentRef.changeDetectorRef.detectChanges();
      expect(content()).toBeNull();

      await waitForUpdate();
      expect(
        animate.mock.calls.filter(([, [operation]]) => operation === START),
      ).toEqual([]);
    });
  });
});
