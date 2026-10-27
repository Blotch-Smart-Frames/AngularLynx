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

const renderAlert = async () => {
  const result = await render(AlertHost);
  return {
    ...result,
    host: result.componentRef.instance as AlertHost,
    alert: () => result.container.querySelector('.rounded-lg')!,
  };
};

describe('alertVariants', () => {
  it('returns default variant classes', () => {
    expect(alertVariants()).toContain('bg-background');
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

  it('renders the title and description when set', async () => {
    const { host, getByText } = await renderAlert();
    host.title.set('Heads up');
    host.description.set('Your download is ready.');
    await waitForUpdate();
    expect(getByText('Heads up').getAttribute('class')).toContain(
      'text-foreground',
    );
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
    expect(getByText('Error').classList).toContain('text-destructive');
    expect(getByText('Something went wrong.').classList).toContain(
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
