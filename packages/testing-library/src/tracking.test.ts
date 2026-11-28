/**
 * LynxTracking under the testing library: the setup gives the environment's
 * background thread an AngularLynxTracking module, which starts at
 * notDetermined and answers the prompt as setTrackingAnswer() says, so a
 * spec can check what the app does with each answer.
 */

import { Component, inject } from '@angular/core';
import { LYNX_ELEMENTS, LynxTracking } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  setAppState,
  setTrackingAnswer,
  setTrackingStatus,
  trackingPrompts,
  waitForUpdate,
} from './index.js';
import { installTrackingModule } from './tracking.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

@Component({
  selector: 'ad-consent',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="ask()"><text>Continue</text></view>
    <text>Tracking: {{ tracking.status() }}</text>
  `,
})
class AdConsent {
  readonly tracking = inject(LynxTracking);

  async ask() {
    await this.tracking.requestPermission();
  }
}

describe('LynxTracking under the testing library', () => {
  it('starts at notDetermined, and the prompt allows tracking by default', async () => {
    await render(AdConsent);
    await settle();
    expect(screen.getByText('Tracking: notDetermined')).toBeInTheDocument();
    expect(trackingPrompts()).toBe(0);

    fireEvent.tap(screen.getByText('Continue').parentElement!);
    await settle();
    expect(screen.getByText('Tracking: authorized')).toBeInTheDocument();
    expect(trackingPrompts()).toBe(1);

    // Answered: iOS doesn't ask again.
    fireEvent.tap(screen.getByText('Continue').parentElement!);
    await settle();
    expect(trackingPrompts()).toBe(1);
  });

  it('answers the prompt as setTrackingAnswer() says', async () => {
    setTrackingAnswer('denied');
    await render(AdConsent);
    fireEvent.tap(screen.getByText('Continue').parentElement!);
    await settle();
    expect(screen.getByText('Tracking: denied')).toBeInTheDocument();
    expect(trackingPrompts()).toBe(1);
  });

  it('reads the status setTrackingStatus() sets, without a prompt', async () => {
    setTrackingStatus('restricted');
    await render(AdConsent);
    await settle();
    expect(screen.getByText('Tracking: restricted')).toBeInTheDocument();
    fireEvent.tap(screen.getByText('Continue').parentElement!);
    await settle();
    expect(trackingPrompts()).toBe(0);
  });

  it('reads a status changed in Settings when the app comes back', async () => {
    setTrackingStatus('authorized');
    await render(AdConsent);
    await settle();
    setTrackingStatus('denied');
    setAppState('background');
    await settle();
    expect(screen.getByText('Tracking: authorized')).toBeInTheDocument();
    setAppState('active');
    await settle();
    expect(screen.getByText('Tracking: denied')).toBeInTheDocument();
  });

  it('does nothing outside the environment', () => {
    const env = (globalThis as any).lynxTestingEnv;
    try {
      (globalThis as any).lynxTestingEnv = undefined;
      setTrackingStatus('denied');
      setTrackingAnswer('denied');
      expect(trackingPrompts()).toBe(0);
    } finally {
      (globalThis as any).lynxTestingEnv = env;
    }
  });

  it('keeps the modules the thread already has', () => {
    const other = {};
    const globals: { NativeModules?: Record<string, unknown> } = {
      NativeModules: { Other: other },
    };
    installTrackingModule(globals);
    expect(globals.NativeModules?.['Other']).toBe(other);
    expect(globals.NativeModules?.['AngularLynxTracking']).toBeDefined();

    const empty: { NativeModules?: Record<string, unknown> } = {};
    installTrackingModule(empty);
    expect(Object.keys(empty.NativeModules ?? {})).toEqual([
      'AngularLynxTracking',
    ]);
  });
});
