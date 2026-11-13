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
} from '@blotch/dolan/testing/lynx-main-thread';
import { ICON_LIGHT_COLORS } from '../icon/icon-theme';
import { UiTextarea } from './textarea';

@Component({
  imports: [UiTextarea],
  template: `
    <ui-textarea
      [(value)]="notes"
      [label]="label()"
      placeholder="Add a note"
      [helperText]="helperText()"
      [error]="error()"
      [disabled]="disabled()"
      [minLines]="minLines()"
      [maxLines]="maxLines()"
      class="w-full"
      (changed)="changes.push($event)"
      (focused)="events.push('focused')"
      (blurred)="events.push('blurred')"
    />
  `,
})
class TextareaHost {
  readonly notes = signal('');
  readonly label = signal('');
  readonly helperText = signal('');
  readonly error = signal('');
  readonly disabled = signal(false);
  readonly minLines = signal(3);
  readonly maxLines = signal<number | undefined>(undefined);
  readonly changes: string[] = [];
  readonly events: string[] = [];
}

const renderTextarea = async () => {
  const result = await render(TextareaHost);
  return {
    ...result,
    host: result.componentRef.instance as TextareaHost,
    field: () => result.container.querySelector('textarea')!,
    // The field's column: its host.
    column: () => result.container.querySelector('.flex-col')!,
    wrapper: () => result.container.querySelector('.bg-muted') as HTMLElement,
    // The layer that draws the focus ring around the field.
    ring: () => result.container.querySelector('.absolute') as HTMLElement,
  };
};

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling an animation. */
const CANCEL = 3;

describe('UiTextarea', () => {
  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => animate.mockRestore());

  it('renders a native textarea with its placeholder, and no label', async () => {
    const { field, column, queryByText } = await renderTextarea();
    expect(field().getAttribute('placeholder')).toBe('Add a note');
    expect(column().classList).toContain('w-full');
    expect(queryByText('Add a note')).toBeNull();
  });

  // Angular gives a component's host every static attribute written on it
  // (issue #181): the class styled the column twice, and the placeholder made
  // a second match for getByPlaceholderText.
  it('puts its class and placeholder on one element each', async () => {
    const { container, field, getAllByPlaceholderText } =
      await renderTextarea();
    expect(container.querySelectorAll('.w-full')).toHaveLength(1);
    expect(getAllByPlaceholderText('Add a note')).toEqual([field()]);
  });

  it('shows its label', async () => {
    const { host, getByText } = await renderTextarea();
    host.label.set('Notes');
    await waitForUpdate();
    // A phone's body size, in medium weight, as ui-input's label is.
    expect(getByText('Notes').classList).toContain('text-base');
    expect(getByText('Notes').classList).toContain('font-medium');
  });

  it("draws the placeholder in the theme's muted foreground, on every platform", async () => {
    // jsdom drops a style it doesn't know, such as -x-placeholder-color:
    // watch what reaches Lynx's inline style API instead.
    const addInlineStyle = vi.spyOn(lynxMainThread(), '__AddInlineStyle');
    const { field } = await renderTextarea();
    // Neither can read a CSS variable, so the color is the token's value.
    // The web preview reads the attribute, and iOS only the style.
    expect(field().getAttribute('placeholder-color')).toBe(
      ICON_LIGHT_COLORS['muted-foreground'],
    );
    expect(addInlineStyle).toHaveBeenCalledWith(
      field(),
      '-x-placeholder-color',
      ICON_LIGHT_COLORS['muted-foreground'],
    );
    addInlineStyle.mockRestore();
  });

  it('updates `value` and emits `changed` as the user types', async () => {
    const { host, field } = await renderTextarea();
    // Lynx puts the typed text in the event's detail, not on its target.
    fireEvent.input(field(), { detail: { value: 'Call' } });
    fireEvent.input(field(), { detail: { value: 'Call Sam' } });
    expect(host.notes()).toBe('Call Sam');
    expect(host.changes).toEqual(['Call', 'Call Sam']);
  });

  it('hides its placeholder while it has a value', async () => {
    // Lynx's iOS textarea would otherwise draw the placeholder over a value
    // the app sets.
    const { host, field } = await renderTextarea();
    host.notes.set('Call Sam');
    await waitForUpdate();
    expect(field().hasAttribute('placeholder')).toBe(false);

    host.notes.set('');
    await waitForUpdate();
    expect(field().getAttribute('placeholder')).toBe('Add a note');
  });

  it("dims and ignores typing while it's disabled", async () => {
    const { host, field, wrapper } = await renderTextarea();
    host.disabled.set(true);
    await waitForUpdate();
    expect(wrapper().classList).toContain('opacity-50');

    fireEvent.input(field(), { detail: { value: 'blocked' } });
    expect(host.notes()).toBe('');
    expect(host.changes).toEqual([]);
  });

  it('disables the native textarea only while disabled', async () => {
    // Lynx treats any `disabled` value, even false, as disabled, so the
    // attribute has to go rather than be set to false.
    const setAttribute = vi.spyOn(lynxMainThread(), '__SetAttribute');
    const { host, field } = await renderTextarea();
    expect(setAttribute).not.toHaveBeenCalledWith(
      field(),
      'disabled',
      expect.anything(),
    );

    host.disabled.set(true);
    await waitForUpdate();
    expect(setAttribute).toHaveBeenLastCalledWith(field(), 'disabled', 'true');
    setAttribute.mockRestore();
  });

  it('shows a focus ring while focused, and emits `focused` and `blurred`', async () => {
    const { host, field, ring } = await renderTextarea();
    expect(ring().style.getPropertyValue('opacity')).toBe('0');

    fireEvent.focus(field());
    await waitForUpdate();
    expect(ring().style.getPropertyValue('opacity')).toBe('1');
    expect(ring().style.getPropertyValue('box-shadow')).toContain(
      'var(--ring)',
    );

    fireEvent.blur(field());
    await waitForUpdate();
    expect(ring().style.getPropertyValue('opacity')).toBe('0');
    expect(host.events).toEqual(['focused', 'blurred']);
  });

  it('shows its helper text', async () => {
    const { host, getByText } = await renderTextarea();
    host.helperText.set('Only you can see this.');
    await waitForUpdate();
    expect(getByText('Only you can see this.').classList).toContain(
      'text-muted-foreground',
    );
    expect(getByText('Only you can see this.').classList).toContain('text-sm');
  });

  it('shows an error in place of the helper text, with a destructive ring', async () => {
    const { host, ring, getByText, queryByText } = await renderTextarea();
    host.helperText.set('Only you can see this.');
    host.error.set('Too short');
    await waitForUpdate();
    expect(getByText('Too short').classList).toContain('text-destructive');
    expect(queryByText('Only you can see this.')).toBeNull();
    // An invalid field keeps its ring even when it isn't focused: one thin
    // ring, as on ui-input.
    expect(ring().style.getPropertyValue('opacity')).toBe('1');
    expect(ring().style.getPropertyValue('box-shadow')).toBe(
      '0 0 0 1.5px var(--destructive)',
    );
  });

  it('shakes when an error appears, but not when it only changes', async () => {
    const { host, column } = await renderTextarea();
    const shakes = () =>
      animate.mock.calls.filter(([, [action]]) => action === START);
    expect(shakes()).toEqual([]);

    host.error.set('Required');
    await waitForUpdate();
    expect(animate).toHaveBeenCalledWith(column(), [
      START,
      expect.any(String),
      expect.arrayContaining([{ transform: 'translateX(-4px)' }]),
      expect.anything(),
    ]);
    expect(shakes()).toHaveLength(1);

    host.error.set('Too short');
    await waitForUpdate();
    expect(shakes()).toHaveLength(1);

    // Once fixed, the next error shakes again, replacing the last shake.
    host.error.set('');
    await waitForUpdate();
    host.error.set('Required');
    await waitForUpdate();
    expect(shakes()).toHaveLength(2);
    expect(animate).toHaveBeenCalledWith(column(), [
      CANCEL,
      expect.any(String),
    ]);
  });

  it('opens at minLines tall and grows without limit by default', async () => {
    // Each line is 1.5rem, plus 1.5rem of vertical padding: in rem, as the
    // wrapper's padding class is, so the sums hold at any root font size.
    const { host, field, wrapper } = await renderTextarea();
    expect(field().style.getPropertyValue('line-height')).toBe('1.5rem');
    expect(wrapper().classList).toContain('py-3');
    expect(wrapper().style.getPropertyValue('min-height')).toBe('6rem');
    expect(wrapper().style.getPropertyValue('max-height')).toBe('');
    expect(field().hasAttribute('enable-scroll-bar')).toBe(false);

    host.minLines.set(5);
    await waitForUpdate();
    expect(wrapper().style.getPropertyValue('min-height')).toBe('9rem');
  });

  it('stops growing at maxLines and shows a scroll bar', async () => {
    const { host, field, wrapper } = await renderTextarea();
    host.maxLines.set(4);
    await waitForUpdate();
    expect(wrapper().style.getPropertyValue('max-height')).toBe('7.5rem');
    expect(field().getAttribute('enable-scroll-bar')).toBe('true');
  });

  it('makes the wrapper a stacking context so the field scrolls with it', async () => {
    // On Lynx a z-indexed element inside a scroll-view only follows the scroll
    // when an ancestor inside the scroll content is a stacking context. Without
    // z-0 on the wrapper, the native field (and its placeholder) stays fixed on
    // screen while the page scrolls.
    const { wrapper } = await renderTextarea();
    expect(wrapper().classList).toContain('z-0');
  });

  it("has ui-input's shape, and body-size text", async () => {
    const { wrapper, field, ring } = await renderTextarea();
    for (const name of ['rounded-lg', 'bg-muted', 'px-4']) {
      expect(wrapper().classList).toContain(name);
    }
    // The ring follows the field's corners.
    expect(ring().classList).toContain('rounded-lg');
    expect(field().classList).toContain('text-base');
  });
});
