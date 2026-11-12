import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate as nextUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { DURATION } from '../../utils/animate';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import { UiSelect, UiSelectItem } from './select';

@Component({
  imports: [UiSelect, UiSelectItem, LYNX_ELEMENTS],
  template: `
    <ui-select
      #select
      [(value)]="value"
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      class="w-48"
      (changed)="changed($event)"
    >
      <ui-select-item value="apple" label="Apple" />
      <ui-select-item value="pear" label="Pear" class="font-bold" />
    </ui-select>
    <text class="open-from-code" (bindtap)="select.open()">Choose</text>
  `,
})
class SelectHost {
  readonly value = signal('');
  readonly placeholder = signal('Pick a fruit');
  readonly disabled = signal(false);
  readonly changed = vi.fn((_value: string) => {});
}

const renderSelect = async () => {
  const result = await render(SelectHost);
  const { container } = result;
  const overlay = container.querySelector<HTMLElement>('overlay')!;
  return {
    ...result,
    host: result.componentRef.instance as SelectHost,
    overlay,
    // The host is the field's column; the row inside the field takes the taps.
    column: container.querySelector('.border-input')!.parentElement!,
    field: container.querySelector('.border-input')!,
    trigger: container.querySelector('.border-input')!.firstElementChild!,
    triggerText: () => container.querySelector('.border-input text')!,
    // An item's tappable row, found by its label in the sheet.
    item: (label: string) => within(overlay).getByText(label).parentElement!,
  };
};

// Every test runs on a fake clock (see the beforeEach below), so the test
// decides when time passes. On real time, a busy machine fired the sheet's
// close timers late, and a test looked before they had.

/**
 * The testing library's waitForUpdate on the fake clock. It waits on a
 * zero-delay timer, which Node runs a millisecond later; the fake clock puts
 * a zero-delay timer set by another timer a millisecond later too, so this
 * lets one pass.
 */
const waitForUpdate = async () => {
  const update = nextUpdate();
  await vi.advanceTimersByTimeAsync(1);
  await update;
};

/**
 * How long the sheet takes to close: a zero-delay step, then its slide out
 * and 20ms more.
 */
const CLOSED = DURATION.normal + 30;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Waits out the sheet's open sequence: the overlay shows on one tick, and the
 * panel slides in on the next.
 */
const waitForOpen = async () => {
  for (let i = 0; i < 3; i++) await waitForUpdate();
};

/**
 * Waits for the sheet's close sequence to finish: the panel slides out, then
 * the overlay hides.
 */
const waitForClose = async (overlay: Element) => {
  await vi.advanceTimersByTimeAsync(CLOSED);
  await waitForUpdate();
  expect(overlay.getAttribute('visible')).toBe('false');
};

describe('UiSelect', () => {
  it('is 48px tall, a touch target on Android and iOS alike', async () => {
    const { field, trigger } = await renderSelect();
    expect(field.classList).toContain('h-[48px]');
    // The trigger fills the field and centers its text.
    expect(trigger.classList).toContain('items-center');
  });

  it('shows the placeholder, muted, until a value is chosen', async () => {
    const { triggerText, column } = await renderSelect();
    expect(triggerText().textContent).toBe('Pick a fruit');
    expect(triggerText().classList).toContain('text-muted-foreground');
    expect(column.classList).toContain('w-48');
  });

  // Static attributes land on a component's host too (issue #181): the
  // width applies once, to the column, the placeholder is only shown, and
  // the accessibility label is only the trigger's.
  it('puts its class on one element, and its placeholder only in its text', async () => {
    @Component({
      imports: [UiSelect, UiSelectItem],
      template: `
        <ui-select
          placeholder="Pick a fruit"
          accessibility-label="Fruit"
          class="w-48"
        >
          <ui-select-item value="apple" label="Apple" class="font-bold" />
        </ui-select>
      `,
    })
    class StaticAttributesHost {}

    const {
      container,
      getByText,
      getAllByAccessibilityLabel,
      queryAllByPlaceholderText,
    } = await render(StaticAttributesHost);
    expect([...container.querySelectorAll('.w-48')]).toEqual([
      container.querySelector('.border-input')!.parentElement,
    ]);
    expect(getAllByAccessibilityLabel('Fruit')).toEqual([
      container.querySelector('.border-input')!.firstElementChild,
    ]);
    expect(queryAllByPlaceholderText('Pick a fruit')).toEqual([]);
    expect(getByText('Pick a fruit')).toBeTruthy();
    expect([...container.querySelectorAll('.font-bold')]).toEqual([
      getByText('Apple').parentElement,
    ]);
  });

  it("shows the chosen item's label", async () => {
    const { host, triggerText } = await renderSelect();
    host.value.set('pear');
    await waitForUpdate();
    expect(triggerText().textContent).toBe('Pear');
    expect(triggerText().classList).toContain('text-foreground');
  });

  it('shows a value that no item has as it is', async () => {
    const { host, triggerText } = await renderSelect();
    host.value.set('kiwi');
    await waitForUpdate();
    expect(triggerText().textContent).toBe('kiwi');
  });

  it('opens its list when the trigger is tapped, and closes it from the sheet', async () => {
    const { overlay, trigger } = await renderSelect();
    expect(overlay.getAttribute('visible')).toBe('false');

    fireEvent.tap(trigger);
    await waitForOpen();
    expect(overlay.getAttribute('visible')).toBe('true');

    // Tapping the backdrop closes the sheet, which the select keeps track of:
    // the next tap on the trigger opens it again.
    fireEvent.tap(overlay.querySelector('view')!);
    await waitForClose(overlay);
    expect(overlay.getAttribute('visible')).toBe('false');
    fireEvent.tap(trigger);
    await waitForOpen();
    expect(overlay.getAttribute('visible')).toBe('true');
  });

  it('closes its list when the trigger is tapped again', async () => {
    const { overlay, trigger } = await renderSelect();
    fireEvent.tap(trigger);
    await waitForOpen();
    fireEvent.tap(trigger);
    await waitForClose(overlay);
    expect(overlay.getAttribute('visible')).toBe('false');
  });

  it('opens from code with open()', async () => {
    const { overlay, getByText } = await renderSelect();
    fireEvent.tap(getByText('Choose'));
    await waitForOpen();
    expect(overlay.getAttribute('visible')).toBe('true');
  });

  it("dims and doesn't open while disabled", async () => {
    const { host, overlay, field, trigger, getByText } = await renderSelect();
    host.disabled.set(true);
    await waitForUpdate();
    expect(field.classList).toContain('opacity-50');

    fireEvent.tap(trigger);
    fireEvent.tap(getByText('Choose'));
    await waitForOpen();
    expect(overlay.getAttribute('visible')).toBe('false');
  });
});

describe('UiSelectItem', () => {
  it('chooses its value when tapped, and closes the list', async () => {
    const { host, overlay, trigger, triggerText, item } = await renderSelect();
    fireEvent.tap(trigger);
    await waitForOpen();

    fireEvent.tap(item('Apple'));
    expect(host.value()).toBe('apple');
    expect(host.changed).toHaveBeenCalledWith('apple');
    await waitForUpdate();
    expect(triggerText().textContent).toBe('Apple');
    await waitForClose(overlay);
    expect(overlay.getAttribute('visible')).toBe('false');
  });

  it('marks the chosen item with a highlight and a check', async () => {
    const { host, item } = await renderSelect();
    host.value.set('pear');
    await waitForUpdate();
    expect(item('Pear').classList).toContain('bg-accent');
    // In the text's color, which the SVG can't read for itself.
    expect(
      item('Pear').querySelector('svg')!.getAttribute('content'),
    ).toContain(ICON_LIGHT_COLORS['foreground']);
    expect(item('Apple').classList).not.toContain('bg-accent');
    expect(item('Apple').querySelector('svg')).toBeNull();
  });

  it("adds the class to the item's own", async () => {
    const { item } = await renderSelect();
    expect(item('Pear').classList).toContain('font-bold');
    expect(item('Pear').classList).toContain('px-4');
    // A touch target's height on Android and iOS alike.
    expect(item('Pear').classList).toContain('min-h-[48px]');
  });
});

describe('UiSelect accessibility', () => {
  @Component({
    imports: [UiSelect, UiSelectItem],
    template: `
      <ui-select
        label="Country"
        placeholder="Choose your country"
        [disabled]="disabled()"
        [(value)]="country"
      >
        <ui-select-item value="de" label="Germany" />
        <ui-select-item value="jp" label="Japan" />
      </ui-select>
    `,
  })
  class LabeledHost {
    readonly country = signal('');
    readonly disabled = signal(false);
  }

  it('shows its label above the field, and names the trigger with it', async () => {
    const { container, getByRole, getByText } = await render(LabeledHost);
    const label = getByText('Country');
    // Above the field, in its column, and hidden: the trigger reads it.
    const field = container.querySelector('.border-input')!;
    expect(label.parentElement).toBe(field.parentElement);
    expect(
      label.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(label.getAttribute('accessibility-elements-hidden')).toBe('true');

    const trigger = getByRole('button', { name: 'Country' });
    expect(trigger.getAttribute('accessibility-element')).toBe('true');
    expect(trigger.getAttribute('accessibility-value')).toBe(
      'Choose your country',
    );
  });

  it('opens from the trigger, and marks the chosen item selected', async () => {
    const { componentRef, getByRole, findByRole, queryByRole } =
      await render(LabeledHost);
    expect(queryByRole('button', { selected: true })).toBeNull();

    fireEvent.tap(getByRole('button', { name: 'Country' }));
    await waitForOpen();
    fireEvent.tap(await findByRole('button', { name: 'Germany' }));
    await waitForUpdate();

    expect((componentRef.instance as LabeledHost).country()).toBe('de');
    expect(
      getByRole('button', { name: 'Germany', selected: true }),
    ).toBeTruthy();
    expect(
      getByRole('button', { name: 'Japan', selected: false }),
    ).toBeTruthy();
    expect(
      getByRole('button', { name: 'Country' }).getAttribute(
        'accessibility-value',
      ),
    ).toBe('Germany');
  });

  it('is dimmed to screen readers while disabled', async () => {
    const { componentRef, getByRole } = await render(LabeledHost);
    const trigger = getByRole('button', { name: 'Country' });
    expect(trigger.getAttribute('accessibility-traits')).toBe('button');

    (componentRef.instance as LabeledHost).disabled.set(true);
    await waitForUpdate();
    expect(trigger.getAttribute('accessibility-traits')).toBe(
      'button,disabled',
    );
  });

  it('takes its name from accessibility-label when shown without a label', async () => {
    @Component({
      imports: [UiSelect, UiSelectItem],
      template: `
        <ui-select accessibility-label="Fruit" value="apple">
          <ui-select-item value="apple" label="Apple" />
        </ui-select>
      `,
    })
    class UnlabeledHost {}

    const { getByRole, queryByText } = await render(UnlabeledHost);
    expect(queryByText('Fruit')).toBeNull();
    expect(
      getByRole('button', { name: 'Fruit' }).getAttribute(
        'accessibility-value',
      ),
    ).toBe('Apple');
  });

  it('is named by what it shows without either, with no value read twice', async () => {
    const { getByRole } = await renderSelect();
    const trigger = getByRole('button', { name: 'Pick a fruit' });
    expect(trigger.hasAttribute('accessibility-value')).toBe(false);
  });
});

describe('UiSelect search', () => {
  @Component({
    imports: [UiSelect, UiSelectItem, LYNX_ELEMENTS],
    template: `
      <ui-select
        label="Fruit"
        searchable
        [filter]="filter()"
        [emptyText]="emptyText()"
        [(value)]="value"
        [(query)]="query"
      >
        <ui-select-item value="apple" label="Apple" />
        <ui-select-item value="pear" label="Pear">
          <text class="pear-glyph">P</text>
        </ui-select-item>
        <ui-select-item value="pineapple" label="Pineapple" />
      </ui-select>
    `,
  })
  class SearchHost {
    readonly value = signal('');
    readonly query = signal('');
    readonly filter = signal(true);
    readonly emptyText = signal('No results');
  }

  /** The phone the sheet is laid out on: an iPhone 18 Pro, in px. */
  const SCREEN = 874;
  /** The screen below the status bar, which the large detent fills. */
  const LARGE = 812;

  const renderSearch = async () => {
    const result = await render(SearchHost);
    const { container, getByRole } = result;
    const overlay = container.querySelector<HTMLElement>('overlay')!;
    const backdrop = overlay.querySelector('view')!;
    const panel = backdrop.children[1] as HTMLElement;
    // Lynx reports the screen's layout after the first frame; jsdom never
    // does, so the test reports it.
    fireEvent.layoutchange(backdrop, { detail: { height: SCREEN } });
    fireEvent.layoutchange(backdrop.children[0]!, {
      detail: { height: LARGE },
    });
    await waitForUpdate();
    return {
      ...result,
      host: result.componentRef.instance as SearchHost,
      overlay,
      panel,
      field: () => overlay.querySelector('input')!,
      list: () => overlay.querySelector('scroll-view')!,
      item: (label: string) => within(overlay).getByText(label).parentElement!,
      /** An item's host, found by its name, which it keeps while hidden. */
      row: (label: string) =>
        overlay.querySelector<HTMLElement>(`[accessibility-label="${label}"]`)!,
      openSheet: async () => {
        fireEvent.tap(getByRole('button', { name: 'Fruit' }));
        await waitForOpen();
      },
      type: async (text: string) => {
        fireEvent.input(overlay.querySelector('input')!, {
          detail: { value: text },
        });
        await waitForUpdate();
      },
    };
  };

  it('opens at full height with a search field above a list that fills it', async () => {
    const { panel, field, list, openSheet } = await renderSearch();
    await openSheet();
    expect(panel.style.getPropertyValue('height')).toBe(`${LARGE}px`);
    expect(field().getAttribute('placeholder')).toBe('Search');
    expect(
      field().compareDocumentPosition(list()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(list().classList).toContain('flex-1');
    expect(list().getAttribute('style') ?? '').not.toContain('max-height');
  });

  it("hides the items whose label doesn't contain the query, ignoring case", async () => {
    const { host, row, type, openSheet } = await renderSearch();
    await openSheet();
    await type(' APP ');
    expect(host.query()).toBe(' APP ');
    // The query is trimmed: "Apple" and "Pineapple" hold "app", "Pear"
    // doesn't.
    expect(row('Apple').classList).not.toContain('hidden');
    expect(row('Pineapple').classList).not.toContain('hidden');
    expect(row('Pear').classList).toContain('hidden');
    // `hidden` and the row's own `flex` would fight: only one stays.
    expect(row('Pear').classList).not.toContain('flex');
  });

  // On iOS a `display: none` element's children still paint, so a hidden
  // item's label and content drew on top of the list. The clip stops that,
  // and the content stays: removed with an `@if`, the projected glyph didn't
  // come back on iOS.
  it('clips a hidden item, keeps its content, and hides it from screen readers', async () => {
    const { overlay, row, type, openSheet } = await renderSearch();
    await openSheet();
    const glyph = overlay.querySelector('.pear-glyph')!;
    await type('app');
    expect(row('Pear').classList).toContain('hidden');
    expect(row('Pear').classList).toContain('overflow-hidden');
    expect(row('Pear').getAttribute('accessibility-elements-hidden')).toBe(
      'true',
    );
    expect(row('Apple').classList).not.toContain('overflow-hidden');
    expect(row('Apple').hasAttribute('accessibility-elements-hidden')).toBe(
      false,
    );
    // Its label and glyph are still in it, the same elements as before.
    expect(within(row('Pear')).getByText('Pear')).toBeTruthy();
    expect(glyph.parentElement).toBe(row('Pear'));

    // Shown again, nothing of it has changed but the host's classes.
    await type('');
    expect(row('Pear').classList).not.toContain('hidden');
    expect(row('Pear').classList).not.toContain('overflow-hidden');
    expect(overlay.querySelector('.pear-glyph')).toBe(glyph);
    expect(row('Pear').hasAttribute('accessibility-elements-hidden')).toBe(
      false,
    );
  });

  it('shows the empty text while no item shows', async () => {
    const { host, overlay, type, openSheet } = await renderSearch();
    await openSheet();
    expect(within(overlay).queryByText('No results')).toBeNull();
    await type('kiwi');
    expect(within(overlay).getByText('No results')).toBeTruthy();

    host.emptyText.set('Nothing matches');
    await waitForUpdate();
    expect(within(overlay).getByText('Nothing matches')).toBeTruthy();
  });

  it('clears the query once the sheet has closed, so it opens on every item', async () => {
    const { host, overlay, item, type, openSheet } = await renderSearch();
    await openSheet();
    await type('pear');
    fireEvent.tap(item('Pear'));
    expect(host.value()).toBe('pear');
    await waitForClose(overlay);
    expect(host.query()).toBe('');
    expect(item('Apple').classList).not.toContain('hidden');
  });

  it('takes the keyboard from the search field as the sheet starts closing', async () => {
    const invoke = vi.spyOn(
      globalThis as unknown as {
        __InvokeUIMethod: (element: unknown, method: string) => void;
      },
      '__InvokeUIMethod',
    );
    const { overlay, openSheet } = await renderSearch();
    await openSheet();
    expect(invoke.mock.calls.map(([, method]) => method)).not.toContain('blur');

    fireEvent.tap(overlay.querySelector('view')!);
    await waitForUpdate();
    expect(invoke.mock.calls.map(([, method]) => method)).toContain('blur');
  });

  it('leaves the items to the app while filter is off', async () => {
    const { host, overlay, item, type, openSheet } = await renderSearch();
    host.filter.set(false);
    await openSheet();
    await type('kiwi');
    expect(item('Apple').classList).not.toContain('hidden');
    expect(within(overlay).queryByText('No results')).toBeNull();
  });

  it('makes room under the list for the keyboard while the field has it', async () => {
    vi.stubGlobal('SystemInfo', {
      platform: 'iOS',
      osVersion: '26.0',
      pixelWidth: 1206,
      pixelHeight: 2622,
      pixelRatio: 3,
    });
    const { field, list, openSheet } = await renderSearch();
    await openSheet();
    const spacer = () =>
      list().querySelector<HTMLElement>(':scope > view > view:last-child')!;
    expect(spacer().style.getPropertyValue('height')).toBe('0px');

    fireEvent.focus(field());
    fireLynxEvent(field(), 'keyboardheightchange', {
      detail: { height: 336 },
    });
    await waitForUpdate();
    expect(spacer().style.getPropertyValue('height')).toBe('336px');
  });
});

describe('UiSelect projected content', () => {
  @Component({
    imports: [UiSelect, UiSelectItem, LYNX_ELEMENTS],
    template: `
      <ui-select label="Icon" value="house">
        <text leading class="chosen-glyph">⌂</text>
        <ui-select-item value="house" label="House">
          <text class="item-glyph">⌂</text>
        </ui-select-item>
      </ui-select>
    `,
  })
  class GlyphHost {}

  it('draws content marked leading in the field, before its text', async () => {
    const { container, getByRole } = await render(GlyphHost);
    const trigger = getByRole('button', { name: 'Icon' });
    const glyph = container.querySelector('.chosen-glyph')!;
    expect(glyph.parentElement).toBe(trigger);
    expect(
      glyph.compareDocumentPosition(within(trigger).getByText('House')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("draws an item's content before its label", async () => {
    const { container } = await render(GlyphHost);
    const overlay = container.querySelector('overlay')!;
    const glyph = overlay.querySelector('.item-glyph')!;
    const label = within(overlay).getByText('House');
    expect(glyph.parentElement).toBe(label.parentElement);
    expect(
      glyph.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
