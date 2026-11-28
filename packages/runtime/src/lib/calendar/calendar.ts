import { Injectable } from '@angular/core';
import { callOnBackground } from '../background-call';
import { download, pageWindow } from '../share/share';

// iCalendar's property names (RFC 5545).
// cspell:words VCALENDAR PRODID CALSCALE VEVENT DTSTAMP DTSTART DTEND

/**
 * The native module of the apps `ng build --platform` makes with angular.json's
 * `calendar` (`CalendarModule.swift` and `CalendarModule.kt` in
 * `packages/native/templates`).
 */
const CALENDAR_MODULE = 'AngularLynxCalendar';

/** An event {@link LynxCalendar.addEvent} fills the system's editor in with. */
export type CalendarEvent = {
  /** What the event is called, such as "Dinner at Luigi's". */
  readonly title: string;
  /** When it starts. */
  readonly start: Date;
  /** When it ends: not before {@link start}. */
  readonly end: Date;
  /** Where it is, as text: an address or a place's name. */
  readonly location?: string;
  /** Anything else to keep with it, such as a booking reference. */
  readonly notes?: string;
  /**
   * Whether it takes whole days rather than set times, such as a hotel stay.
   * It then covers the days of {@link start} and {@link end}, both included,
   * in the phone's time zone; their times don't matter.
   */
  readonly allDay?: boolean;
};

/**
 * How the system's event editor closed:
 * - `saved`: the person added the event.
 * - `canceled`: the person closed the editor without adding it.
 * - `unknown`: the platform doesn't say. Android's calendar apps needn't
 *   answer, and Google Calendar answers the same whether or not the event
 *   was saved; the web preview downloads an `.ics` file, which the person
 *   may or may not open.
 */
export type CalendarSheetResult = 'saved' | 'canceled' | 'unknown';

/**
 * Why {@link LynxCalendar.addEvent} couldn't open the editor:
 * - `unavailable`: the host has no editor to open. Only the apps
 *   `ng build --platform` makes with `"calendar": true` in angular.json have
 *   one, on iOS 17 and later (earlier versions only open it for an app with
 *   full calendar access) and on an Android phone with a calendar app. Lynx
 *   Explorer has none.
 * - `failed`: the editor couldn't open, or one was already open.
 */
export type CalendarErrorCode = 'unavailable' | 'failed';

/** The error {@link LynxCalendar.addEvent} rejects with. */
export class CalendarError extends Error {
  constructor(
    readonly code: CalendarErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CalendarError';
  }
}

/** How the editor closed, as the native module reports it. */
type AddEventResult = {
  readonly result?: string;
  readonly error?: string;
  readonly message?: string;
};

const RESULTS: readonly CalendarSheetResult[] = [
  'saved',
  'canceled',
  'unknown',
];

const DEFAULT_MESSAGES: Record<CalendarErrorCode, string> = {
  unavailable:
    'This host has no event editor. Only the apps `ng build --platform` makes with `"calendar": true` in angular.json, on iOS 17 and later or on Android with a calendar app, and the web preview have one.',
  failed: "The event editor couldn't open.",
};

/**
 * Throws for an event the editors can't take, before anything opens: the
 * platforms would otherwise open an empty editor, or one that can't save.
 */
const validate = (event: CalendarEvent): void => {
  if (typeof event.title !== 'string' || !event.title.trim()) {
    throw new TypeError('An event needs a title.');
  }
  for (const [name, date] of [
    ['start', event.start],
    ['end', event.end],
  ] as const) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError(`An event's ${name} must be a valid Date.`);
    }
  }
  // An all-day event's times don't matter, only its days: one that starts
  // at 15:00 and ends at 09:00 on the same day takes that day.
  const endsBeforeStart = event.allDay
    ? localDate(event.end) < localDate(event.start)
    : event.end.getTime() < event.start.getTime();
  if (endsBeforeStart) {
    throw new TypeError("An event can't end before it starts.");
  }
};

// ─── The web preview ─────────────────────────────────────────────────────────

/**
 * A text value with iCalendar's escapes (RFC 5545, 3.3.11).
 */
const icsText = (text: string): string =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/**
 * The bytes a code point takes in UTF-8, which iCalendar's lines count.
 */
const utf8Length = (character: string): number => {
  const code = character.codePointAt(0)!;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
};

/**
 * A content line folded at 75 bytes, as RFC 5545 (3.1) asks: each further
 * line starts with a space, which a reader drops. It never splits a
 * character.
 */
const fold = (line: string): string => {
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const length = utf8Length(character);
    // The first line holds 75 bytes; the others 74 after their space.
    const limit = lines.length === 0 ? 75 : 74;
    if (bytes + length > limit) {
      lines.push(current);
      current = '';
      bytes = 0;
    }
    current += character;
    bytes += length;
  }
  lines.push(current);
  return lines.join('\r\n ');
};

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * A UTC date-time, as `20261129T183000Z`.
 */
const utcDateTime = (date: Date): string =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
  `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

/**
 * A date in the local time zone, as `20261129`.
 */
const localDate = (date: Date): string =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;

/**
 * The day after `date`'s, at the same local time.
 */
const nextDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

/**
 * The event as an iCalendar file (RFC 5545), which every calendar app on a
 * computer or a phone opens as "add this event".
 *
 * Times go in UTC, which needs no time zone definitions in the file. An
 * all-day event's dates are the local days, with the end the day after the
 * last, since iCalendar's end is exclusive.
 */
export const toICalendar = (
  event: CalendarEvent,
  { now = new Date(), uid }: { readonly now?: Date; readonly uid: string },
): string => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AngularLynx//LynxCalendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcDateTime(now)}`,
    ...(event.allDay
      ? [
          `DTSTART;VALUE=DATE:${localDate(event.start)}`,
          `DTEND;VALUE=DATE:${localDate(nextDay(event.end))}`,
        ]
      : [
          `DTSTART:${utcDateTime(event.start)}`,
          `DTEND:${utcDateTime(event.end)}`,
        ]),
    `SUMMARY:${icsText(event.title)}`,
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    ...(event.notes ? [`DESCRIPTION:${icsText(event.notes)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // iCalendar's lines end with CRLF, the last one too.
  return `${lines.map(fold).join('\r\n')}\r\n`;
};

/**
 * The `.ics` file's name: the event's title without what a file system
 * rejects, so the person sees what they're opening.
 */
const fileName = (title: string): string => {
  const name = [...title]
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return code >= 0x20 && code !== 0x7f && !'\\/:*?"<>|'.includes(character);
    })
    .join('')
    .trim()
    .slice(0, 60)
    .trim();
  return `${name || 'event'}.ics`;
};

/**
 * A UID no other event shares, which a calendar app keys the event on.
 */
const newUid = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}@angular-lynx`;

// ─── The shells ──────────────────────────────────────────────────────────────

/**
 * Adds an event to the person's calendar through the system's own event
 * editor, filled in with the app's event, so they choose the calendar and
 * can change anything before they save: a booking, a ticket or an
 * appointment. The app needs no calendar permission, and never sees the
 * person's calendars.
 *
 * - **iOS 17 and later:** EventKitUI's `EKEventEditViewController`, which
 *   runs outside the app and saves the event itself. Earlier versions open
 *   it only for an app with full calendar access, so `addEvent()` rejects
 *   with `unavailable` there.
 * - **Android:** the calendar app's editor, through `ACTION_INSERT` on
 *   `CalendarContract.Events`. Calendar apps needn't say whether the person
 *   saved, so it resolves `unknown` unless one does.
 * - **Web preview:** downloads the event as an `.ics` file, which the
 *   browser or the computer's calendar app opens, and resolves `unknown`.
 *
 * The native module is in an app only when angular.json's build options set
 * `"calendar": true`. Without it, and in Lynx Explorer, `addEvent()` rejects
 * with `unavailable`. The testing library's `calendarEvents()` lists the
 * events a spec's app opened the editor with, and `answerCalendarSheet()`
 * closes it.
 *
 * @usageNotes
 * ```jsonc
 * // angular.json, in the build target's options
 * "calendar": true
 * ```
 *
 * ```typescript
 * // Injected in a field: a method has no injection context.
 * readonly #calendar = inject(LynxCalendar);
 *
 * async addToCalendar(booking: Booking) {
 *   const result = await this.#calendar.addEvent({
 *     title: `Table for ${booking.guests}`,
 *     start: booking.start,
 *     end: booking.end,
 *     location: booking.restaurant.address,
 *     notes: `Booking ${booking.reference}`,
 *   });
 *   this.added.set(result === 'saved');
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxCalendar {
  /**
   * Opens the system's event editor with `event`, and resolves with how it
   * closed. Throws a `TypeError` for an event without a title, with an
   * invalid date or ending before it starts, and rejects with a
   * {@link CalendarError} when there's no editor to open.
   */
  async addEvent(event: CalendarEvent): Promise<CalendarSheetResult> {
    validate(event);

    const page = pageWindow();
    if (page) {
      // Made and clicked before anything awaits, while the tap that asked
      // for it still counts for the browser.
      const file = new page.File(
        [toICalendar(event, { uid: newUid() })],
        fileName(event.title),
        { type: 'text/calendar' },
      );
      download(page, [file]);
      return 'unknown';
    }

    let answer: AddEventResult | undefined;
    try {
      // callNativeModuleAsync keeps the module's callback on the background
      // thread, where NativeModules lives, so nothing stays registered once
      // it answers.
      answer = (await callOnBackground(
        'callNativeModuleAsync',
        CALENDAR_MODULE,
        'addEvent',
        [
          {
            title: event.title,
            start: event.start.getTime(),
            end: event.end.getTime(),
            allDay: event.allDay ?? false,
            ...(event.location !== undefined && { location: event.location }),
            ...(event.notes !== undefined && { notes: event.notes }),
          },
        ],
      )) as AddEventResult | undefined;
    } catch {
      // The host has no module: Lynx Explorer, or an app built without
      // `calendar`.
      throw new CalendarError('unavailable', DEFAULT_MESSAGES.unavailable);
    }
    if (RESULTS.includes(answer?.result as CalendarSheetResult)) {
      return answer!.result as CalendarSheetResult;
    }
    const code: CalendarErrorCode =
      answer?.error === 'unavailable' ? 'unavailable' : 'failed';
    throw new CalendarError(code, answer?.message ?? DEFAULT_MESSAGES[code]);
  }
}
