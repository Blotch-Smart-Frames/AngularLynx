import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate as nextUpdate,
  within,
} from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DURATION } from '../../utils/animate';
import { UiMultiSelect, UiMultiSelectItem } from './multi-select';

@Component({
  imports: [UiMultiSelect, UiMultiSelectItem, LYNX_ELEMENTS],
  template: `
    <ui-multi-select
      #select
      label="Topics"
      placeholder="Choose topics"
      class="w-64"
      [searchable]="searchable()"
      [filter]="filter()"
      [disabled]="disabled()"
      [doneLabel]="doneLabel()"
      [(value)]="value"
      [(query)]="query"
      (changed)="changed($event)"
    >
      <ui-multi-select-item value="news" label="News" />
      <ui-multi-select-item value="sport" label="Sport" class="font-bold" />
      <ui-multi-select-item value="science" label="Science">
        <text class="item-glyph">⚛</text>
      </ui-multi-select-item>
    </ui-multi-select>
    <text (bindtap)="select.open()">Choose</text>
    <text (bindtap)="select.toggle()">Toggle</text>
  `,
})
class TopicsHost {
  readonly value = signal<readonly string[]>([]);
  readonly query = signal('');
  readonly searchable = signal(false);
  readonly filter = signal(true);
  readonly disabled = signal(false);
  readonly doneLabel = signal('Done');
  readonly changed = vi.fn((_value: readonly string[]) => {});
}

// Every test runs on a fake clock (see the beforeEach below), so the test
// decides when time passes, as select's spec does.

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
 * How long the sheet takes to open: a zero-delay step to show the overlay,
 * up to ten frames waiting for the screen's layout when it opens at full
 * height, and the slide in.
 */
const OPENED = 10 * 16 + DURATION.normal;

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
});

const renderTopics = async (setUp: (host: TopicsHost) => void = () => {}) => {
  const result = await render(TopicsHost);
  const host = result.componentRef.instance as TopicsHost;
  setUp(host);
  await waitForUpdate();
  const { container, getByRole } = result;
  const overlay = container.querySelector<HTMLElement>('overlay')!;
  const field = container.querySelector<HTMLElement>('.border-input')!;
  return {
    ...result,
    host,
    overlay,
    field,
    column: field.parentElement!,
    trigger: () => getByRole('button', { name: 'Topics' }),
    /** The chips in the field, by their text. */
    chips: () =>
      [...field.querySelectorAll('.bg-secondary')].map((chip) =>
        chip.textContent?.trim(),
      ),
    /** An item's row, found by its label in the sheet. */
    item: (label: string) => within(overlay).getByText(label).parentElement!,
    /** An item's checkbox box. */
    box: (label: string) =>
      within(overlay)
        .getByText(label)
        .parentElement!.querySelector<HTMLElement>('.rounded-sm')!,
    open: async () => {
      fireEvent.tap(getByRole('button', { name: 'Topics' }));
      await vi.advanceTimersByTimeAsync(OPENED);
      await waitForUpdate();
    },
    closed: async () => {
      await vi.advanceTimersByTimeAsync(CLOSED);
      await waitForUpdate();
      return overlay.getAttribute('visible') === 'false';
    },
    type: async (text: string) => {
      fireEvent.input(overlay.querySelector('input')!, {
        detail: { value: text },
      });
      await waitForUpdate();
    },
  };
};

describe('UiMultiSelect field', () => {
  it('shows the placeholder, muted, while nothing is chosen', async () => {
    const { field, chips } = await renderTopics();
    const placeholder = within(field).getByText('Choose topics');
    expect(placeholder.classList).toContain('text-muted-foreground');
    expect(chips()).toEqual([]);
  });

  it("shows the chosen items' labels as chips, in the order of the value", async () => {
    const { field, chips } = await renderTopics((host) =>
      host.value.set(['science', 'news']),
    );
    expect(chips()).toEqual(['Science', 'News']);
    expect(within(field).queryByText('Choose topics')).toBeNull();
    // The chips wrap onto more lines, and the field grows to hold them.
    expect(field.querySelector('.flex-wrap')).not.toBeNull();
    expect(field.classList).toContain('min-h-10');
  });

  it('shows a value that no item has as it is', async () => {
    const { chips } = await renderTopics((host) =>
      host.value.set(['news', 'travel']),
    );
    expect(chips()).toEqual(['News', 'travel']);
  });

  // Static attributes land on a component's host too (issue #181): the
  // width applies once, to the column, the placeholder is only shown, and
  // the accessibility label is only the trigger's.
  it('puts its class on one element, and its placeholder only in its text', async () => {
    @Component({
      imports: [UiMultiSelect, UiMultiSelectItem],
      template: `
        <ui-multi-select
          placeholder="Choose topics"
          accessibility-label="Topics"
          class="w-64"
        >
          <ui-multi-select-item value="news" label="News" />
        </ui-multi-select>
      `,
    })
    class StaticAttributesHost {}

    const {
      container,
      getByText,
      getAllByAccessibilityLabel,
      queryAllByPlaceholderText,
    } = await render(StaticAttributesHost);
    const field = container.querySelector('.border-input')!;
    expect([...container.querySelectorAll('.w-64')]).toEqual([
      field.parentElement,
    ]);
    expect(getAllByAccessibilityLabel('Topics')).toEqual([
      field.firstElementChild,
    ]);
    expect(queryAllByPlaceholderText('Choose topics')).toEqual([]);
    expect(getByText('Choose topics')).toBeTruthy();
  });

  it('shows its label above the field', async () => {
    const { field, column } = await renderTopics();
    // The sheet's title says it too, in the overlay.
    const label = within(column).getAllByText('Topics')[0]!;
    expect(label.parentElement).toBe(column);
    expect(
      label.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(label.getAttribute('accessibility-elements-hidden')).toBe('true');
    expect(column.classList).toContain('w-64');
  });

  it("dims and doesn't open while disabled", async () => {
    const { host, overlay, field, trigger, open, getByText } =
      await renderTopics();
    host.disabled.set(true);
    await waitForUpdate();
    expect(field.classList).toContain('opacity-50');

    await open();
    fireEvent.tap(getByText('Choose'));
    fireEvent.tap(getByText('Toggle'));
    await vi.advanceTimersByTimeAsync(OPENED);
    await waitForUpdate();
    expect(overlay.getAttribute('visible')).toBe('false');
    expect(trigger().getAttribute('accessibility-traits')).toBe(
      'button,disabled',
    );
  });
});

describe('UiMultiSelect sheet', () => {
  it('opens from the field, titled by its label, and closes with Done', async () => {
    const { overlay, open, closed } = await renderTopics();
    expect(overlay.getAttribute('visible')).toBe('false');
    await open();
    expect(overlay.getAttribute('visible')).toBe('true');

    const title = within(overlay).getByText('Topics');
    expect(title.getAttribute('accessibility-traits')).toBe('header');

    fireEvent.tap(within(overlay).getByText('Done'));
    expect(await closed()).toBe(true);
  });

  it("names Done with doneLabel, and is titled by accessibility-label when there's no label", async () => {
    @Component({
      imports: [UiMultiSelect, UiMultiSelectItem],
      template: `
        <ui-multi-select accessibility-label="Topics" doneLabel="Finished">
          <ui-multi-select-item value="news" label="News" />
        </ui-multi-select>
      `,
    })
    class UnlabeledHost {}

    const { container, getByRole } = await render(UnlabeledHost);
    fireEvent.tap(getByRole('button', { name: 'Topics' }));
    await vi.advanceTimersByTimeAsync(OPENED);
    await waitForUpdate();
    const overlay = container.querySelector('overlay')!;
    expect(within(overlay).getByText('Topics')).toBeTruthy();
    expect(within(overlay).getByText('Finished')).toBeTruthy();
  });

  it('opens from code, and toggle() closes it again', async () => {
    const { overlay, getByText, closed } = await renderTopics();
    fireEvent.tap(getByText('Choose'));
    await vi.advanceTimersByTimeAsync(OPENED);
    await waitForUpdate();
    expect(overlay.getAttribute('visible')).toBe('true');

    fireEvent.tap(getByText('Toggle'));
    expect(await closed()).toBe(true);
  });

  it('closes when the field is tapped again', async () => {
    const { trigger, open, closed } = await renderTopics();
    await open();
    fireEvent.tap(trigger());
    expect(await closed()).toBe(true);
  });

  it('closes from the backdrop, and the field opens it again', async () => {
    const { overlay, open, closed } = await renderTopics();
    await open();
    fireEvent.tap(overlay.querySelector('view')!);
    expect(await closed()).toBe(true);

    // The select kept track of the sheet closing itself, so one tap opens it.
    await open();
    expect(overlay.getAttribute('visible')).toBe('true');
  });

  it('caps the list while it fits its content', async () => {
    const { overlay, open } = await renderTopics();
    await open();
    const list = overlay.querySelector('scroll-view')!;
    expect(list.getAttribute('style')).toContain('max-height');
    expect(overlay.querySelector('input')).toBeNull();
  });
});

describe('UiMultiSelectItem', () => {
  it('adds its value to the end when tapped, and the sheet stays open', async () => {
    const { host, overlay, item, chips, open } = await renderTopics((h) =>
      h.value.set(['sport']),
    );
    await open();

    fireEvent.tap(item('News'));
    await waitForUpdate();
    expect(host.value()).toEqual(['sport', 'news']);
    expect(host.changed).toHaveBeenLastCalledWith(['sport', 'news']);
    expect(chips()).toEqual(['Sport', 'News']);

    await vi.advanceTimersByTimeAsync(CLOSED);
    await waitForUpdate();
    expect(overlay.getAttribute('visible')).toBe('true');
  });

  it('removes its value when tapped while chosen', async () => {
    const { host, item, open } = await renderTopics((h) =>
      h.value.set(['news', 'sport', 'science']),
    );
    await open();
    fireEvent.tap(item('Sport'));
    await waitForUpdate();
    expect(host.value()).toEqual(['news', 'science']);
    expect(host.changed).toHaveBeenCalledTimes(1);
    expect(host.changed).toHaveBeenLastCalledWith(['news', 'science']);
  });

  it('marks a chosen item with a checked checkbox', async () => {
    const { box, item, open } = await renderTopics((h) =>
      h.value.set(['news']),
    );
    await open();
    expect(box('News').classList).toContain('bg-primary');
    expect(box('Sport').classList).toContain('bg-transparent');

    fireEvent.tap(item('Sport'));
    await waitForUpdate();
    expect(box('Sport').classList).toContain('bg-primary');
  });

  it('toggles once when its checkbox is the part tapped', async () => {
    const { host, box, open } = await renderTopics();
    await open();
    // The box's tap target is its parent, the checkbox's host.
    fireEvent.tap(box('News').parentElement!);
    await waitForUpdate();
    expect(host.value()).toEqual(['news']);
    expect(box('News').classList).toContain('bg-primary');

    fireEvent.tap(box('News').parentElement!);
    await waitForUpdate();
    expect(host.value()).toEqual([]);
    expect(box('News').classList).toContain('bg-transparent');
  });

  it("draws its content before its label, and adds the class to the row's own", async () => {
    const { overlay, item, open } = await renderTopics();
    await open();
    const glyph = overlay.querySelector('.item-glyph')!;
    const label = within(overlay).getByText('Science');
    expect(glyph.parentElement).toBe(label.parentElement);
    expect(
      glyph.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(item('Sport').classList).toContain('font-bold');
    expect(item('Sport').classList).toContain('pr-4');
  });
});

describe('UiMultiSelect search', () => {
  it('opens at full height with a search field, and filters the items', async () => {
    const { host, overlay, item, open, type } = await renderTopics((h) =>
      h.searchable.set(true),
    );
    await open();
    const field = overlay.querySelector('input')!;
    expect(field.getAttribute('placeholder')).toBe('Search');
    expect(overlay.querySelector('scroll-view')!.classList).toContain('flex-1');

    await type('SC');
    expect(host.query()).toBe('SC');
    expect(item('Science').classList).not.toContain('hidden');
    expect(item('News').classList).toContain('hidden');
    expect(within(overlay).queryByText('No results')).toBeNull();

    await type('weather');
    expect(within(overlay).getByText('No results')).toBeTruthy();
  });

  it('clears the query once the sheet has closed', async () => {
    const { host, overlay, item, open, type, closed } = await renderTopics(
      (h) => h.searchable.set(true),
    );
    await open();
    await type('news');
    fireEvent.tap(within(overlay).getByText('Done'));
    expect(await closed()).toBe(true);
    expect(host.query()).toBe('');
    expect(item('Sport').classList).not.toContain('hidden');
  });

  it('leaves the items to the app while filter is off', async () => {
    const { overlay, item, open, type } = await renderTopics((h) => {
      h.searchable.set(true);
      h.filter.set(false);
    });
    await open();
    await type('weather');
    expect(item('News').classList).not.toContain('hidden');
    expect(within(overlay).queryByText('No results')).toBeNull();
  });
});

describe('UiMultiSelect accessibility', () => {
  it('is one button named by its label, whose value is the chosen labels', async () => {
    const { host, trigger } = await renderTopics();
    expect(trigger().getAttribute('accessibility-element')).toBe('true');
    expect(trigger().getAttribute('accessibility-value')).toBe('Choose topics');

    host.value.set(['sport', 'news']);
    await waitForUpdate();
    expect(trigger().getAttribute('accessibility-value')).toBe('Sport, News');
  });

  it('marks each chosen item selected', async () => {
    const { getByRole, findByRole, open } = await renderTopics();
    await open();
    fireEvent.tap(await findByRole('button', { name: 'News' }));
    await waitForUpdate();
    expect(getByRole('button', { name: 'News', selected: true })).toBeTruthy();
    expect(
      getByRole('button', { name: 'Sport', selected: false }),
    ).toBeTruthy();
  });

  it('is named by what it holds without a label, with no value read twice', async () => {
    @Component({
      imports: [UiMultiSelect, UiMultiSelectItem],
      template: `
        <ui-multi-select [value]="['news']">
          <ui-multi-select-item value="news" label="News" />
        </ui-multi-select>
      `,
    })
    class UnnamedHost {}

    const { getByRole } = await render(UnnamedHost);
    const trigger = getByRole('button', { name: 'News' });
    expect(trigger.hasAttribute('accessibility-value')).toBe(false);
  });
});
