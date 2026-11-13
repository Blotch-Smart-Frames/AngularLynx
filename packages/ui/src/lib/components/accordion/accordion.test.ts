import { Component, signal, viewChild } from '@angular/core';
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
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import {
  UiAccordion,
  UiAccordionContent,
  UiAccordionItem,
  UiAccordionTrigger,
} from './accordion';

@Component({
  imports: [
    UiAccordion,
    UiAccordionItem,
    UiAccordionTrigger,
    UiAccordionContent,
    LYNX_ELEMENTS,
  ],
  template: `
    <ui-accordion [type]="type()" class="w-80">
      <ui-accordion-item value="a" class="px-1">
        <ui-accordion-trigger class="gap-2">Alpha</ui-accordion-trigger>
        <ui-accordion-content class="pt-1">
          <text>Alpha body</text>
        </ui-accordion-content>
      </ui-accordion-item>
      <ui-accordion-item value="b">
        <ui-accordion-trigger>Beta</ui-accordion-trigger>
        <ui-accordion-content>
          <text>Beta body</text>
        </ui-accordion-content>
      </ui-accordion-item>
    </ui-accordion>
  `,
})
class AccordionHost {
  readonly type = signal<'single' | 'multiple'>('single');
  readonly accordion = viewChild.required(UiAccordion);
}

const renderAccordion = async () => {
  const result = await render(AccordionHost);
  /**
   * An item's trigger: its own view, which holds the tap listener, around
   * its label.
   */
  const trigger = (label: string) => result.getByText(label).parentElement!;
  return {
    ...result,
    host: result.componentRef.instance as AccordionHost,
    trigger,
    tap: async (label: string) => {
      fireEvent.tap(trigger(label));
      await waitForUpdate();
    },
    /**
     * The chevron's box beside an item's label: the box turns, with the
     * drawing inside it.
     */
    chevron: (label: string) =>
      result.getByText(label).nextElementSibling as HTMLElement,
    /** An item's content view, which is only mounted while it's expanded. */
    content: (text: string) => result.queryByText(text)?.parentElement ?? null,
  };
};

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling an animation. */
const CANCEL = 3;

describe('UiAccordion', () => {
  it("merges each part's class with its own", async () => {
    const { container, trigger, tap, content } = await renderAccordion();
    expect(container.querySelector('.flex-col.w-80')).not.toBeNull();
    expect(container.querySelector('.border-b.px-1')).not.toBeNull();
    expect(trigger('Alpha').classList).toContain('justify-between');
    expect(trigger('Alpha').classList).toContain('gap-2');

    await tap('Alpha');
    expect(content('Alpha body')!.classList).toContain('pb-4');
    expect(content('Alpha body')!.classList).toContain('pt-1');
  });

  // A class on a component lands on its host too (issue #181): each part is
  // its host, so each class applies once, and collapsed content, which is
  // hidden, takes no room for its padding.
  it('puts each class on one element', async () => {
    const { container, trigger, tap, getByText } = await renderAccordion();
    expect(container.querySelectorAll('.w-80')).toHaveLength(1);
    expect(container.querySelectorAll('.px-1')).toHaveLength(1);
    expect([...container.querySelectorAll('.gap-2')]).toEqual([
      trigger('Alpha'),
    ]);
    const [collapsed] = container.querySelectorAll('.pt-1');
    expect(collapsed!.classList).toContain('hidden');

    await tap('Alpha');
    expect([...container.querySelectorAll('.pt-1')]).toEqual([
      getByText('Alpha body').parentElement,
    ]);
    expect(collapsed!.classList).not.toContain('hidden');
  });

  it('expands an item when its trigger is tapped, and collapses it on a second tap', async () => {
    const { tap, chevron, content } = await renderAccordion();
    const turn = (label: string) =>
      chevron(label).style.getPropertyValue('transform');
    // Collapsed, the content isn't mounted at all, and the chevron points
    // down.
    expect(content('Alpha body')).toBeNull();
    expect(turn('Alpha')).toBe('rotate(0deg)');

    // Expanded, it turns to point up.
    await tap('Alpha');
    expect(content('Alpha body')).not.toBeNull();
    expect(turn('Alpha')).toBe('rotate(180deg)');
    // Only the tapped item's.
    expect(turn('Beta')).toBe('rotate(0deg)');

    await tap('Alpha');
    expect(content('Alpha body')).toBeNull();
    expect(turn('Alpha')).toBe('rotate(0deg)');
  });

  it('draws a 20px chevron in the muted foreground, which turns rather than jumps', async () => {
    const { chevron, queryByText } = await renderAccordion();
    expect(chevron('Alpha').style.getPropertyValue('width')).toBe('20px');
    expect(chevron('Alpha').style.getPropertyValue('height')).toBe('20px');
    expect(chevron('Alpha').style.getPropertyValue('transition')).toContain(
      'transform',
    );
    // An SVG, whose markup holds the color: it can't read a CSS variable.
    // It was a character, whose shape was whatever the phone's font drew.
    expect(
      chevron('Alpha').querySelector('svg')!.getAttribute('content'),
    ).toContain(`stroke="${ICON_LIGHT_COLORS['muted-foreground']}"`);
    expect(queryByText('▶')).toBeNull();
    expect(queryByText('▼')).toBeNull();
  });

  it('makes each trigger a row at least 48px tall, with a body-size label', async () => {
    const { trigger, getByText } = await renderAccordion();
    // A full touch target.
    expect(trigger('Beta').classList).toContain('min-h-12');
    expect(trigger('Beta').classList).toContain('py-3');
    // The label takes the room the chevron leaves.
    for (const name of ['flex-1', 'text-base', 'font-medium']) {
      expect(getByText('Beta').classList).toContain(name);
    }
  });

  it('dims a trigger under a finger or the mouse, from the press', async () => {
    // Touches on a phone, and a mouse in the web preview, which sends no
    // touches for a cursor. A canceled touch (a scroll taking over) and a
    // cursor leaving release too.
    const { trigger } = await renderAccordion();
    const presses: readonly (readonly [() => unknown, () => unknown])[] = [
      [
        () => fireEvent.touchstart(trigger('Alpha')),
        () => fireEvent.touchend(trigger('Alpha')),
      ],
      [
        () => fireEvent.touchstart(trigger('Alpha')),
        () => fireEvent.touchcancel(trigger('Alpha')),
      ],
      [
        () => fireEvent.mousedown(trigger('Alpha')),
        () => fireEvent.mouseup(trigger('Alpha')),
      ],
      [
        () => fireEvent.mousedown(trigger('Alpha')),
        () => fireLynxEvent(trigger('Alpha'), 'mouseleave'),
      ],
    ];
    expect(trigger('Alpha').classList).not.toContain('opacity-60');
    for (const [down, up] of presses) {
      down();
      await waitForUpdate();
      expect(trigger('Alpha').classList).toContain('opacity-60');
      // Only the row under the finger.
      expect(trigger('Beta').classList).not.toContain('opacity-60');
      up();
      await waitForUpdate();
      expect(trigger('Alpha').classList).not.toContain('opacity-60');
    }
  });

  it('keeps one item expanded at a time by default', async () => {
    const { tap, content } = await renderAccordion();
    await tap('Alpha');
    await tap('Beta');
    expect(content('Alpha body')).toBeNull();
    expect(content('Beta body')).not.toBeNull();
  });

  it('keeps every expanded item open when its type is multiple', async () => {
    const { host, tap, content } = await renderAccordion();
    host.type.set('multiple');
    await waitForUpdate();

    await tap('Alpha');
    await tap('Beta');
    expect(content('Alpha body')).not.toBeNull();
    expect(content('Beta body')).not.toBeNull();
  });

  it('expands an item from code, and says which items are expanded', async () => {
    const { host, content } = await renderAccordion();
    host.accordion().toggle('b');
    await waitForUpdate();
    expect(content('Beta body')).not.toBeNull();
    expect(host.accordion().isExpanded('b')).toBe(true);
    expect(host.accordion().isExpanded('a')).toBe(false);
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

    it('slides the content down into place each time it expands', async () => {
      const { tap, content } = await renderAccordion();

      await tap('Alpha');
      // The effect waits a macrotask so the content is committed to Lynx's
      // tree before animating it; this update lets that run.
      await waitForUpdate();
      expect(animate).toHaveBeenCalledWith(content('Alpha body'), [
        START,
        expect.any(String),
        [
          { transform: 'translateY(-8px)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 },
        ],
        // No fill: once it ends, the content's own style applies.
        expect.objectContaining({ fill: 'none' }),
      ]);
      const [firstKey] = startedOn(content('Alpha body'));

      await tap('Alpha');
      await tap('Alpha');
      await waitForUpdate();
      // Expanding again stops the previous reveal before it plays a new one.
      expect(animate).toHaveBeenCalledWith(content('Alpha body'), [
        CANCEL,
        firstKey,
      ]);
      expect(startedOn(content('Alpha body'))).toHaveLength(2);
    });

    it("doesn't animate content that collapsed before its reveal began", async () => {
      const { componentRef, trigger, tap, content } = await renderAccordion();

      // The effect has scheduled the reveal for the next macrotask.
      await tap('Alpha');
      // Collapse it before then, and render that straight away.
      fireEvent.tap(trigger('Alpha'));
      componentRef.changeDetectorRef.detectChanges();
      expect(content('Alpha body')).toBeNull();

      await waitForUpdate();
      expect(
        animate.mock.calls.filter(([, [operation]]) => operation === START),
      ).toEqual([]);
    });
  });
});
