import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it, vi } from 'vitest';
import { lynxMainThread } from '../../../test-utils/lynx-main-thread';
import { type AlertVariant, UiAlert, alertVariants } from './alert';

@Component({
  imports: [UiAlert, LYNX_ELEMENTS],
  template: `
    <ui-alert
      [variant]="variant()"
      [title]="title()"
      [description]="description()"
      class="mt-2"
    >
      <text>Message</text>
    </ui-alert>
  `,
})
class AlertHost {
  readonly variant = signal<AlertVariant>('default');
  readonly title = signal('');
  readonly description = signal('');
}

@Component({
  imports: [UiAlert],
  template: `<ui-alert title="Heads up" class="mt-2" />`,
})
class StaticAttributesHost {}

const renderAlert = async () => {
  const result = await render(AlertHost);
  return {
    ...result,
    host: result.componentRef.instance as AlertHost,
    // The alert: its host, found by the class written on it.
    alert: () => result.container.querySelector('.mt-2')!,
  };
};

describe('alertVariants', () => {
  it('returns default variant classes', () => {
    // On the card color, as a raised surface: in the dark it's a tone
    // lighter than the page it sits on.
    expect(alertVariants()).toContain('bg-card');
    expect(alertVariants()).toContain('border-border');
  });

  it('always includes the base classes', () => {
    for (const variant of ['default', 'destructive'] as const) {
      expect(alertVariants({ variant })).toContain('rounded-xl');
      expect(alertVariants({ variant })).toContain('gap-1');
    }
  });

  it('returns destructive variant classes', () => {
    expect(alertVariants({ variant: 'destructive' })).toContain(
      'bg-destructive-subtle',
    );
  });
});

describe('UiAlert', () => {
  it('renders projected content, without a title or description', async () => {
    const { alert, getByText } = await renderAlert();
    expect(getByText('Message')).toBeTruthy();
    expect(alert().querySelectorAll('text')).toHaveLength(1);
    expect(alert().classList).toContain('mt-2');
  });

  // Static attributes land on a component's host too (issue #181): the
  // margin once, on the alert itself, and the title only as its text.
  it('puts its class on one element, and its title only in its text', async () => {
    const { container, getByText, queryAllByTitle } =
      await render(StaticAttributesHost);
    expect([...container.querySelectorAll('.mt-2')]).toEqual([
      getByText('Heads up').parentElement,
    ]);
    expect(queryAllByTitle('Heads up')).toEqual([]);
  });

  it('renders the title and description when set', async () => {
    const { host, getByText } = await renderAlert();
    host.title.set('Heads up');
    host.description.set('Your download is ready.');
    await waitForUpdate();
    expect(getByText('Heads up').getAttribute('class')).toContain(
      'text-foreground',
    );
    expect(getByText('Heads up').classList).toContain('text-base');
    expect(getByText('Heads up').classList).toContain('font-semibold');
    expect(
      getByText('Your download is ready.').getAttribute('class'),
    ).toContain('text-muted-foreground');
  });

  it('colors every part for the destructive variant', async () => {
    const { host, alert, getByText } = await renderAlert();
    host.variant.set('destructive');
    host.title.set('Error');
    host.description.set('Something went wrong.');
    await waitForUpdate();
    expect(alert().classList).toContain('border-destructive');
    expect(alert().classList).toContain('bg-destructive-subtle');
    expect(getByText('Error').classList).toContain('text-destructive');
    // The title and the edge are red; the message is in the foreground: a
    // paragraph of red on the red tint is hard to read.
    expect(getByText('Something went wrong.').classList).toContain(
      'text-foreground',
    );
    expect(getByText('Something went wrong.').classList).not.toContain(
      'text-destructive',
    );
  });

  it('reveals itself on first render', async () => {
    const animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    const { alert } = await renderAlert();
    expect(animate).toHaveBeenCalledWith(alert(), [
      0, // Starts an animation.
      expect.any(String),
      [
        { transform: 'translateY(4px)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      expect.any(Object),
    ]);
    animate.mockRestore();
  });
});
