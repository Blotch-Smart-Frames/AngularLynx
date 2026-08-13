import { Component } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { setInputSignal } from '../../../test-utils/set-input-signal';
import { UiAlert, alertVariants } from './alert';

@Component({
  standalone: true,
  imports: [UiAlert, LYNX_ELEMENTS],
  template: `<ui-alert [variant]="variant"><text>Message</text></ui-alert>`,
})
class AlertHost {
  variant: 'default' | 'destructive' = 'default';
}

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
  it('renders projected content', async () => {
    const { getByText } = await render(AlertHost);
    expect(getByText('Message')).toBeTruthy();
  });

  it('renders title and description slots when their inputs are set', async () => {
    // JIT template bindings don't propagate through input(); drive the signals
    // directly so the @if(title()) / @if(description()) branches render and
    // their computed class functions run.
    const { componentRef, container } = await render(UiAlert);
    const inst = componentRef.instance as UiAlert;
    setInputSignal(inst.title, 'Heads up');
    setInputSignal(inst.description, 'Your download is ready.');
    await waitForUpdate();

    const texts = container.querySelectorAll('text');
    expect(texts.length).toBeGreaterThanOrEqual(2);
  });
});
