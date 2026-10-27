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
import { UiInput } from './input';

@Component({
  imports: [UiInput],
  template: `
    <ui-input
      [(value)]="email"
      [label]="label()"
      placeholder="you@example.com"
      type="email"
      [helperText]="helperText()"
      [error]="error()"
      [disabled]="disabled()"
      class="w-full"
      (changed)="changes.push($event)"
      (focused)="events.push('focused')"
      (blurred)="events.push('blurred')"
    />
  `,
})
class InputHost {
  readonly email = signal('');
  readonly label = signal('');
  readonly helperText = signal('');
  readonly error = signal('');
  readonly disabled = signal(false);
  readonly changes: string[] = [];
  readonly events: string[] = [];
}

const renderInput = async () => {
  const result = await render(InputHost);
  return {
    ...result,
    host: result.componentRef.instance as InputHost,
    field: () => result.container.querySelector('input')!,
    // The field's own column; the host element renders as a view too.
    column: () => result.container.querySelector('.flex-col')!,
    wrapper: () => result.container.querySelector('.bg-muted')!,
    // The layer that draws the focus ring around the field.
    ring: () => result.container.querySelector('.absolute') as HTMLElement,
  };
};

/** `__ElementAnimate`'s first argument for starting an animation. */
const START = 0;
/** `__ElementAnimate`'s first argument for canceling an animation. */
const CANCEL = 3;

describe('UiInput', () => {
  // Watched per test: the testing library resets the main thread after each.
  let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
  beforeEach(() => {
    animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
  });
  afterEach(() => animate.mockRestore());

  it('renders a native input with its placeholder and type, and no label', async () => {
    const { field, column, queryByText } = await renderInput();
    expect(field().getAttribute('placeholder')).toBe('you@example.com');
    expect(field().getAttribute('type')).toBe('email');
    expect(column().classList).toContain('w-full');
    expect(queryByText('you@example.com')).toBeNull();
  });

  it('shows its label', async () => {
    const { host, getByText } = await renderInput();
    host.label.set('Email');
    await waitForUpdate();
    expect(getByText('Email').classList).toContain('font-medium');
  });

  it('updates `value` and emits `changed` as the user types', async () => {
    const { host, field } = await renderInput();
    // Lynx puts the typed text in the event's detail, not on its target.
    fireEvent.input(field(), { detail: { value: 'jane@' } });
    fireEvent.input(field(), { detail: { value: 'jane@example.com' } });
    expect(host.email()).toBe('jane@example.com');
    expect(host.changes).toEqual(['jane@', 'jane@example.com']);
  });

  it("dims and ignores typing while it's disabled", async () => {
    const { host, field, wrapper } = await renderInput();
    host.disabled.set(true);
    await waitForUpdate();
    expect(wrapper().classList).toContain('opacity-50');

    fireEvent.input(field(), { detail: { value: 'blocked' } });
    expect(host.email()).toBe('');
    expect(host.changes).toEqual([]);
  });

  it('disables the native input only while disabled', async () => {
    // Lynx treats any `disabled` value, even false, as disabled, so the
    // attribute has to go rather than be set to false.
    const setAttribute = vi.spyOn(lynxMainThread(), '__SetAttribute');
    const { host, field } = await renderInput();
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
    const { host, field, ring } = await renderInput();
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
    const { host, getByText } = await renderInput();
    host.helperText.set("We'll never share it.");
    await waitForUpdate();
    expect(getByText("We'll never share it.").classList).toContain(
      'text-muted-foreground',
    );
  });

  it('shows an error in place of the helper text, with a destructive ring', async () => {
    const { host, ring, getByText, queryByText } = await renderInput();
    host.helperText.set("We'll never share it.");
    host.error.set('Enter a valid email');
    await waitForUpdate();
    expect(getByText('Enter a valid email').classList).toContain(
      'text-destructive',
    );
    expect(queryByText("We'll never share it.")).toBeNull();
    // An invalid field keeps its ring even when it isn't focused.
    expect(ring().style.getPropertyValue('opacity')).toBe('1');
    expect(ring().style.getPropertyValue('box-shadow')).toContain(
      'var(--destructive)',
    );
  });

  it('shakes when an error appears, but not when it only changes', async () => {
    const { host, column } = await renderInput();
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

    host.error.set('Enter a valid email');
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

  it('makes the wrapper a stacking context so the field scrolls with it', async () => {
    // On Lynx a z-indexed element inside a scroll-view only follows the scroll
    // when an ancestor inside the scroll content is a stacking context. Without
    // z-0 on the wrapper, the native field (and its placeholder) stays fixed on
    // screen while the page scrolls.
    const { wrapper } = await renderInput();
    expect(wrapper().classList).toContain('z-0');
  });
});
