import { Component, type Provider, signal } from '@angular/core';
import { LynxTheme } from '@blotch/angular-lynx';
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
import { ICON_DARK_COLORS, ICON_LIGHT_COLORS } from '../icon/icon-theme';
import { UiCheckbox } from './checkbox';

@Component({
  imports: [UiCheckbox],
  template: `
    <ui-checkbox
      [(checked)]="checked"
      [label]="label()"
      [accessibility-label]="accessibilityLabel()"
      [disabled]="disabled()"
      class="mr-2"
      (changed)="changes.push($event)"
    />
  `,
})
class CheckboxHost {
  readonly checked = signal(false);
  readonly label = signal('');
  readonly accessibilityLabel = signal('');
  readonly disabled = signal(false);
  readonly changes: boolean[] = [];
}

const renderCheckbox = async (providers: Provider[] = []) => {
  const result = await render(CheckboxHost, { providers });
  return {
    ...result,
    host: result.componentRef.instance as CheckboxHost,
    /**
     * The checkbox: its host, which takes the taps. It's the box alone, or
     * with a label the row that holds both.
     */
    checkbox: () => result.container.firstElementChild!,
    /** The check mark, an SVG, and the box drawn around it. */
    checkmark: () => result.container.querySelector('svg')!,
    box: () => result.container.querySelector('svg')!.parentElement!,
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

  it('renders an empty box, edged in the muted foreground', async () => {
    const { box, checkmark } = await renderCheckbox();
    // A control's size, in px, not text that scales.
    for (const name of [
      'h-[22px]',
      'w-[22px]',
      'rounded-[6px]',
      'border-[1.5px]',
    ]) {
      expect(box().classList).toContain(name);
    }
    // The primary is kept for the checked state.
    expect(box().classList).toContain('bg-transparent');
    expect(box().classList).toContain('border-muted-foreground');
    expect(checkmark().getAttribute('style')).toContain('opacity: 0');
  });

  it('draws the check as an SVG, in the color of what sits on the primary', async () => {
    // An SVG can't read a CSS variable, so the markup holds the token's
    // value.
    const { checkmark } = await renderCheckbox();
    expect(checkmark().getAttribute('content')).toContain(
      `stroke="${ICON_LIGHT_COLORS['primary-foreground']}"`,
    );
    expect(checkmark().getAttribute('content')).not.toContain('currentColor');
    expect(checkmark().getAttribute('style')).toContain('width: 14px');
  });

  it("draws the check in the dark theme's color in a dark app", async () => {
    const { checkmark } = await renderCheckbox([
      { provide: LynxTheme, useValue: { appearance: () => 'dark' } },
    ]);
    expect(checkmark().getAttribute('content')).toContain(
      `stroke="${ICON_DARK_COLORS['primary-foreground']}"`,
    );
  });

  // Angular gives a component's host every static attribute written on it
  // (issue #181). The host is the checkbox, so the class is its own: on the
  // box as well, a margin applied twice.
  it('puts its class on one element, the checkbox', async () => {
    const { container, checkbox, box } = await renderCheckbox();
    expect([...container.querySelectorAll('.mr-2')]).toEqual([checkbox()]);
    expect(box().parentElement).toBe(checkbox());
  });

  it('checks and unchecks on tap, emitting `changed`', async () => {
    const { host, checkbox, box, checkmark } = await renderCheckbox();

    fireEvent.tap(checkbox());
    await waitForUpdate();
    expect(host.checked()).toBe(true);
    expect(box().classList).toContain('bg-primary');
    expect(box().classList).toContain('border-primary');
    expect(box().classList).not.toContain('border-muted-foreground');
    expect(checkmark().getAttribute('style')).toContain('opacity: 1');

    fireEvent.tap(checkbox());
    await waitForUpdate();
    expect(host.checked()).toBe(false);
    expect(box().classList).toContain('bg-transparent');
    expect(host.changes).toEqual([true, false]);
  });

  it("doesn't animate on mount, then pops the checkmark in and out", async () => {
    const { checkbox, checkmark } = await renderCheckbox();
    expect(animate).not.toHaveBeenCalled();

    fireEvent.tap(checkbox());
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
    fireEvent.tap(checkbox());
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
    const { host, checkbox } = await renderCheckbox();
    fireEvent.tap(checkbox());
    fireEvent.tap(checkbox());
    await waitForUpdate();
    expect(host.checked()).toBe(false);
    expect(host.changes).toEqual([true, false]);
    expect(animate).not.toHaveBeenCalled();
  });

  it('dims and ignores taps while disabled', async () => {
    const { host, checkbox } = await renderCheckbox();
    expect(checkbox().classList).not.toContain('opacity-50');
    host.disabled.set(true);
    await waitForUpdate();
    // The whole checkbox dims, its label with the box.
    expect(checkbox().classList).toContain('opacity-50');

    fireEvent.tap(checkbox());
    await waitForUpdate();
    expect(host.checked()).toBe(false);
    expect(host.changes).toEqual([]);
  });
});

describe('UiCheckbox without a label', () => {
  it('is only the box, with a touch target wider than it looks', async () => {
    const { checkbox, box } = await renderCheckbox();
    expect(box().parentElement).toBe(checkbox());
    expect(checkbox().querySelector('text')).toBeNull();
    expect(checkbox().classList).not.toContain('min-h-11');
    expect(checkbox().classList).not.toContain('gap-3');
    // Lynx's hit-slop takes touches 13px around the 22px box, to 48px,
    // without the room padding would take.
    expect(checkbox().getAttribute('hit-slop')).toBe('13px');
  });

  it('has no name for screen readers until it is given one', async () => {
    const { host, checkbox, queryByText } = await renderCheckbox();
    expect(checkbox().hasAttribute('accessibility-label')).toBe(false);

    // Such as a checkbox in a row of the app's own, which shows the words.
    host.accessibilityLabel.set('Select all');
    await waitForUpdate();
    expect(checkbox().getAttribute('accessibility-label')).toBe('Select all');
    expect(queryByText('Select all')).toBeNull();
  });
});

describe('UiCheckbox with a label', () => {
  const renderLabeled = async () => {
    const result = await renderCheckbox();
    result.host.label.set('Accept terms');
    await waitForUpdate();
    return result;
  };

  it('shows the label beside the box, in a row 44px tall at least', async () => {
    const { checkbox, box, getByText } = await renderLabeled();
    const label = getByText('Accept terms');
    expect(label.classList).toContain('text-base');
    expect(label.parentElement).toBe(checkbox());
    expect(
      box().compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(checkbox().classList).toContain('min-h-11');
    expect(checkbox().classList).toContain('gap-3');
    // The row is 44px tall already: 2px more on each side makes 48px.
    expect(checkbox().getAttribute('hit-slop')).toBe('2px');
  });

  it('toggles wherever the row is tapped, the label included', async () => {
    // On a phone the words are the easier target.
    const { host, box, getByText } = await renderLabeled();
    fireEvent.tap(getByText('Accept terms'));
    await waitForUpdate();
    expect(host.checked()).toBe(true);
    expect(box().classList).toContain('bg-primary');

    fireEvent.tap(box());
    await waitForUpdate();
    expect(host.checked()).toBe(false);
    expect(host.changes).toEqual([true, false]);
  });

  it('is named by its label, which wins over an accessibility label', async () => {
    const { host, checkbox, getByText } = await renderLabeled();
    host.accessibilityLabel.set('Terms');
    await waitForUpdate();
    expect(checkbox().getAttribute('accessibility-label')).toBe('Accept terms');
    // The checkbox reads the label, so the text isn't a second stop.
    expect(
      getByText('Accept terms').getAttribute('accessibility-elements-hidden'),
    ).toBe('true');
  });
});

describe('UiCheckbox accessibility', () => {
  it('is one element, a button described as a checkbox, whose value says whether it is checked', async () => {
    const { checkbox } = await renderCheckbox();
    expect(checkbox().getAttribute('accessibility-element')).toBe('true');
    expect(checkbox().getAttribute('accessibility-traits')).toBe('button');
    expect(checkbox().getAttribute('accessibility-role-description')).toBe(
      'checkbox',
    );
    expect(checkbox().getAttribute('accessibility-value')).toBe('Unchecked');

    fireEvent.tap(checkbox());
    await waitForUpdate();
    expect(checkbox().getAttribute('accessibility-value')).toBe('Checked');
  });

  it('is dimmed to screen readers while disabled', async () => {
    const { host, checkbox } = await renderCheckbox();
    host.disabled.set(true);
    await waitForUpdate();
    expect(checkbox().getAttribute('accessibility-traits')).toBe(
      'button,disabled',
    );
  });
});
