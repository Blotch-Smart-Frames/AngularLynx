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
    // The field's own column; the host element renders as a view too.
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

  it('shows its label', async () => {
    const { host, getByText } = await renderTextarea();
    host.label.set('Notes');
    await waitForUpdate();
    expect(getByText('Notes').classList).toContain('font-medium');
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
  });

  it('shows an error in place of the helper text, with a destructive ring', async () => {
    const { host, ring, getByText, queryByText } = await renderTextarea();
    host.helperText.set('Only you can see this.');
    host.error.set('Too short');
    await waitForUpdate();
    expect(getByText('Too short').classList).toContain('text-destructive');
    expect(queryByText('Only you can see this.')).toBeNull();
    // An invalid field keeps its ring even when it isn't focused.
    expect(ring().style.getPropertyValue('opacity')).toBe('1');
    expect(ring().style.getPropertyValue('box-shadow')).toContain(
      'var(--destructive)',
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
    // Each line is 20px, plus 20px of vertical padding.
    const { host, field, wrapper } = await renderTextarea();
    expect(wrapper().style.getPropertyValue('min-height')).toBe('80px');
    expect(wrapper().style.getPropertyValue('max-height')).toBe('');
    expect(field().hasAttribute('enable-scroll-bar')).toBe(false);

    host.minLines.set(5);
    await waitForUpdate();
    expect(wrapper().style.getPropertyValue('min-height')).toBe('120px');
  });

  it('stops growing at maxLines and shows a scroll bar', async () => {
    const { host, field, wrapper } = await renderTextarea();
    host.maxLines.set(4);
    await waitForUpdate();
    expect(wrapper().style.getPropertyValue('max-height')).toBe('100px');
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
});
