/**
 * LynxCalendar in rendered specs (issue #926).
 *
 * There's no system editor in a spec, so the setup file gives the
 * environment a calendar module that keeps the events the app opens the
 * editor with, for calendarEvents(), and closes it when the spec calls
 * answerCalendarSheet() or failCalendarSheet(). The answers go through the
 * background thread, as the shells' do.
 */

import { Component, inject, signal } from '@angular/core';
import {
  CalendarError,
  LYNX_ELEMENTS,
  LynxCalendar,
} from '@blotch/angular-lynx';
import { afterEach, describe, expect, it } from 'vitest';
import {
  answerCalendarSheet,
  calendarEvents,
  failCalendarSheet,
  fireEvent,
  render,
  screen,
  waitForUpdate,
} from './index.js';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

const START = new Date(Date.UTC(2026, 11, 24, 18, 30));
const END = new Date(Date.UTC(2026, 11, 24, 20, 0));

@Component({
  selector: 'booking-confirmed',
  imports: [LYNX_ELEMENTS],
  template: `
    <view (bindtap)="add()"><text>Add to calendar</text></view>
    <text>{{ status() }}</text>
  `,
})
class BookingConfirmed {
  readonly #calendar = inject(LynxCalendar);
  readonly status = signal('Not added');

  async add(): Promise<void> {
    this.status.set('Adding');
    try {
      const result = await this.#calendar.addEvent({
        title: 'Table for 2',
        start: START,
        end: END,
        location: '1 Main St',
      });
      this.status.set(`Result: ${result}`);
    } catch (error) {
      this.status.set(
        error instanceof CalendarError
          ? `Error: ${error.code}, ${error.message}`
          : 'Error',
      );
    }
  }
}

describe('LynxCalendar under the testing library', () => {
  it('keeps the editor open, with the event, until the spec answers it', async () => {
    await render(BookingConfirmed);
    expect(calendarEvents()).toEqual([]);

    fireEvent.tap(screen.getByText('Add to calendar'));
    await settle();
    expect(screen.getByText('Adding')).toBeInTheDocument();
    expect(calendarEvents()).toEqual([
      {
        title: 'Table for 2',
        start: START,
        end: END,
        allDay: false,
        location: '1 Main St',
      },
    ]);

    answerCalendarSheet();
    await settle();
    expect(screen.getByText('Result: saved')).toBeInTheDocument();
  });

  it('closes the editor at once with an answer queued before it opened', async () => {
    await render(BookingConfirmed);
    answerCalendarSheet('canceled');

    fireEvent.tap(screen.getByText('Add to calendar'));
    await settle();

    expect(screen.getByText('Result: canceled')).toBeInTheDocument();
  });

  it('rejects with the CalendarError a spec fails the editor with', async () => {
    await render(BookingConfirmed);
    failCalendarSheet('unavailable', 'Needs iOS 17.');

    fireEvent.tap(screen.getByText('Add to calendar'));
    await settle();

    expect(
      screen.getByText('Error: unavailable, Needs iOS 17.'),
    ).toBeInTheDocument();
  });

  it('fails a second editor while one is open, as the shells do', async () => {
    const { componentRef } = await render(BookingConfirmed);
    const calendar = componentRef.injector.get(LynxCalendar);
    const event = { title: 'Notes only', start: START, end: END, notes: 'x' };
    const first = calendar.addEvent(event);
    const second = calendar
      .addEvent(event)
      .catch((error: CalendarError) => error);
    await settle();

    expect(await second).toMatchObject({
      code: 'failed',
      message: 'The event editor is already open.',
    });
    failCalendarSheet('failed');
    await expect(first).rejects.toMatchObject({ code: 'failed' });
    expect(calendarEvents()).toEqual([
      {
        title: 'Notes only',
        start: START,
        end: END,
        allDay: false,
        notes: 'x',
      },
    ]);
  });

  it('starts each test with no events', () => {
    expect(calendarEvents()).toEqual([]);
  });

  describe('outside the environment', () => {
    let env: unknown;
    afterEach(() => {
      (globalThis as any).lynxTestingEnv = env;
    });

    it('says the setup file is missing', () => {
      env = (globalThis as any).lynxTestingEnv;
      (globalThis as any).lynxTestingEnv = undefined;

      expect(() => answerCalendarSheet()).toThrowError(
        /answerCalendarSheet\(\) needs the testing library/,
      );
      expect(() => calendarEvents()).toThrowError(
        /calendarEvents\(\) needs the testing library/,
      );
    });
  });
});
