import { Component, signal } from '@angular/core';
import {
  fireEvent,
  render,
  waitForUpdate,
} from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import {
  type ButtonSize,
  type ButtonVariant,
  UiButton,
  buttonVariants,
} from './button';

@Component({
  imports: [UiButton],
  template: `
    <ui-button
      [variant]="variant()"
      [size]="size()"
      [disabled]="disabled()"
      [loading]="loading()"
      class="w-full"
      (pressed)="presses.set(presses() + 1)"
      >Save</ui-button
    >
  `,
})
class ButtonHost {
  readonly variant = signal<ButtonVariant>('default');
  readonly size = signal<ButtonSize>('default');
  readonly disabled = signal(false);
  readonly loading = signal(false);
  readonly presses = signal(0);
}

const renderButton = async () => {
  const result = await render(ButtonHost);
  return {
    ...result,
    host: result.componentRef.instance as ButtonHost,
    // Every size rounds the button, and neither its host nor the spinner does.
    button: () => result.container.querySelector('.rounded-md')!,
    spinner: () => result.container.querySelector('svg'),
  };
};

/**
 * The scale the button's inline style holds, if any.
 */
const scaleOf = (view: Element) =>
  (view as HTMLElement).style.getPropertyValue('transform');

describe('UiButton', () => {
  it('renders its label with the classes for its variant and size', async () => {
    const { button, getByText } = await renderButton();
    expect(button().classList).toContain('bg-primary');
    expect(button().classList).toContain('h-10');
    expect(button().classList).toContain('w-full');
    expect(button().classList).not.toContain('opacity-50');
    expect(getByText('Save').classList).toContain('text-primary-foreground');
    expect(getByText('Save').classList).toContain('text-sm');
  });

  it('restyles the button and its label when the variant or size changes', async () => {
    const { host, button, getByText } = await renderButton();
    host.variant.set('destructive');
    host.size.set('lg');
    await waitForUpdate();
    expect(button().classList).toContain('bg-destructive');
    expect(button().classList).toContain('h-11');
    expect(getByText('Save').classList).toContain(
      'text-destructive-foreground',
    );
    expect(getByText('Save').classList).toContain('text-base');
  });

  it('emits `pressed` when tapped', async () => {
    const { host, button } = await renderButton();
    fireEvent.tap(button());
    fireEvent.tap(button());
    expect(host.presses()).toBe(2);
  });

  it("dims and ignores taps while it's disabled", async () => {
    const { host, button } = await renderButton();
    host.disabled.set(true);
    await waitForUpdate();
    expect(button().classList).toContain('opacity-50');
    fireEvent.tap(button());
    expect(host.presses()).toBe(0);
  });

  it("shows a spinner in place of the label, dims and ignores taps while it's loading", async () => {
    const { host, button, spinner, queryByText } = await renderButton();
    expect(spinner()).toBeNull();

    host.loading.set(true);
    await waitForUpdate();
    expect(spinner()).not.toBeNull();
    expect(queryByText('Save')).toBeNull();
    expect(button().classList).toContain('opacity-50');
    fireEvent.tap(button());
    expect(host.presses()).toBe(0);
  });

  it('shrinks the spinner for a small button', async () => {
    const { host, spinner } = await renderButton();
    host.loading.set(true);
    await waitForUpdate();
    /**
     * The spinner's size: its own view carries it, and the svg fills it.
     */
    const spinnerSize = () =>
      (spinner()!.parentElement as HTMLElement).style.getPropertyValue('width');
    expect(spinnerSize()).toBe('20px');

    host.size.set('sm');
    await waitForUpdate();
    expect(spinnerSize()).toBe('16px');
  });

  it("colors the spinner like each variant's label", async () => {
    const { host, spinner } = await renderButton();
    host.loading.set(true);
    // The spinner draws with SVG, which can't read the theme's CSS variables,
    // so its markup carries the light theme's value of the label's color.
    for (const [variant, color] of [
      ['default', 'rgba(250, 250, 250, 1)'], // --primary-foreground
      ['destructive', 'rgba(250, 250, 250, 1)'], // --destructive-foreground
      ['outline', 'rgba(9, 9, 11, 1)'], // --foreground
      ['secondary', 'rgba(24, 24, 27, 1)'], // --secondary-foreground
      ['ghost', 'rgba(9, 9, 11, 1)'], // --foreground
    ] as const) {
      host.variant.set(variant);
      await waitForUpdate();
      expect(spinner()!.getAttribute('content')).toContain(`stroke="${color}"`);
    }
  });

  it('scales down while pressed by touch, and back on release', async () => {
    const { button } = await renderButton();
    fireEvent.touchstart(button());
    expect(scaleOf(button())).toBe('scale(0.97)');
    fireEvent.touchend(button());
    expect(scaleOf(button())).toBe('scale(1)');

    // A scroll that takes the touch over cancels it: the button scales back
    // rather than staying pressed.
    fireEvent.touchstart(button());
    expect(scaleOf(button())).toBe('scale(0.97)');
    fireEvent.touchcancel(button());
    expect(scaleOf(button())).toBe('scale(1)');
  });

  it('scales down while pressed by mouse, and back on release or leave', async () => {
    // Lynx on the web fires mouse events for a cursor, never touch ones.
    const { button } = await renderButton();
    fireEvent.mousedown(button());
    expect(scaleOf(button())).toBe('scale(0.97)');
    fireEvent.mouseup(button());
    expect(scaleOf(button())).toBe('scale(1)');

    fireEvent.mousedown(button());
    fireLynxEvent(button(), 'mouseleave');
    expect(scaleOf(button())).toBe('scale(1)');
  });

  it("doesn't react to presses while it's disabled or loading", async () => {
    const { host, button } = await renderButton();
    for (const state of [host.disabled, host.loading]) {
      state.set(true);
      await waitForUpdate();
      fireEvent.touchstart(button());
      fireEvent.mousedown(button());
      expect(scaleOf(button())).toBe('');
      fireEvent.touchend(button());
      fireEvent.mouseup(button());
      expect(scaleOf(button())).toBe('');
      state.set(false);
    }
  });
});

describe('buttonVariants', () => {
  it('returns default variant and size classes', () => {
    const result = buttonVariants();
    expect(result).toContain('bg-primary');
    expect(result).toContain('h-10');
    expect(result).toContain('px-4');
  });

  it('returns destructive variant classes', () => {
    const result = buttonVariants({ variant: 'destructive' });
    expect(result).toContain('bg-destructive');
  });

  it('returns outline variant classes', () => {
    const result = buttonVariants({ variant: 'outline' });
    expect(result).toContain('border');
    expect(result).toContain('bg-background');
  });

  it('returns secondary variant classes', () => {
    const result = buttonVariants({ variant: 'secondary' });
    expect(result).toContain('bg-secondary');
  });

  it('returns ghost variant classes', () => {
    const result = buttonVariants({ variant: 'ghost' });
    expect(result).toContain('bg-transparent');
  });

  it('returns small size classes', () => {
    const result = buttonVariants({ size: 'sm' });
    expect(result).toContain('h-9');
    expect(result).toContain('px-3');
  });

  it('returns large size classes', () => {
    const result = buttonVariants({ size: 'lg' });
    expect(result).toContain('h-11');
    expect(result).toContain('px-8');
  });

  it('returns icon size classes', () => {
    const result = buttonVariants({ size: 'icon' });
    expect(result).toContain('h-10');
    expect(result).toContain('w-10');
  });

  it('always includes base classes', () => {
    const result = buttonVariants({ variant: 'ghost', size: 'sm' });
    expect(result).toContain('flex');
    expect(result).toContain('items-center');
    expect(result).toContain('rounded-md');
  });
});
