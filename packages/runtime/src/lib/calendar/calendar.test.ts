import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarError,
  type CalendarErrorCode,
  type CalendarEvent,
  LynxCalendar,
  toICalendar,
} from './calendar';

// iCalendar's property names (RFC 5545).
// cspell:words VCALENDAR PRODID CALSCALE VEVENT DTSTAMP DTSTART DTEND

type Done = (result: {
  result?: string;
  error?: string;
  message?: string;
}) => void;

const createCalendar = () =>
  Injector.create({ providers: [LynxCalendar] }).get(LynxCalendar);

const dinner: CalendarEvent = {
  title: "Dinner at Luigi's",
  start: new Date(Date.UTC(2026, 11, 24, 18, 30)),
  end: new Date(Date.UTC(2026, 11, 24, 20, 0)),
  location: '1 Main St, Springfield',
  notes: 'Booking ABC123',
};

/**
 * Stands in for the shells' AngularLynxCalendar module, as the background
 * thread sees it. `finish` closes the open editor the way the platform would.
 */
const stubModule = () => {
  let done: Done | undefined;
  const addEvent = vi.fn((_event: unknown, callback: Done) => {
    done = callback;
  });
  vi.stubGlobal('NativeModules', { AngularLynxCalendar: { addEvent } });
  return { addEvent, finish: (result: Parameters<Done>[0]) => done?.(result) };
};

const rejection = async (
  promise: Promise<unknown>,
): Promise<{ code: CalendarErrorCode; message: string }> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(CalendarError);
  const { code, message } = error as CalendarError;
  return { code, message };
};

describe('LynxCalendar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the editor with the event, its times in milliseconds, and resolves with how it closed', async () => {
    for (const result of ['saved', 'canceled', 'unknown'] as const) {
      const { addEvent, finish } = stubModule();
      const added = createCalendar().addEvent(dinner);
      await vi.waitFor(() => expect(addEvent).toHaveBeenCalled());
      expect(addEvent.mock.calls[0]![0]).toEqual({
        title: "Dinner at Luigi's",
        start: dinner.start.getTime(),
        end: dinner.end.getTime(),
        allDay: false,
        location: '1 Main St, Springfield',
        notes: 'Booking ABC123',
      });
      finish({ result });
      await expect(added).resolves.toBe(result);
    }
  });

  it('sends neither a location nor notes the event leaves out, and an all-day event as one', async () => {
    const { addEvent, finish } = stubModule();
    const added = createCalendar().addEvent({
      title: 'Holiday',
      start: new Date(2026, 7, 1),
      end: new Date(2026, 7, 14),
      allDay: true,
    });
    await vi.waitFor(() => expect(addEvent).toHaveBeenCalled());
    expect(addEvent.mock.calls[0]![0]).toEqual({
      title: 'Holiday',
      start: new Date(2026, 7, 1).getTime(),
      end: new Date(2026, 7, 14).getTime(),
      allDay: true,
    });
    finish({ result: 'saved' });
    await expect(added).resolves.toBe('saved');
  });

  it("takes an all-day event's days, whatever its times", async () => {
    const { addEvent, finish } = stubModule();
    const added = createCalendar().addEvent({
      title: 'Day off',
      start: new Date(2026, 7, 1, 15),
      end: new Date(2026, 7, 1, 9),
      allDay: true,
    });
    await vi.waitFor(() => expect(addEvent).toHaveBeenCalled());
    finish({ result: 'saved' });
    await expect(added).resolves.toBe('saved');
    await expect(
      createCalendar().addEvent({
        title: 'Day off',
        start: new Date(2026, 7, 2, 9),
        end: new Date(2026, 7, 1, 15),
        allDay: true,
      }),
    ).rejects.toThrow(new TypeError("An event can't end before it starts."));
  });

  it('rejects with unavailable where the host has no module', async () => {
    vi.stubGlobal('NativeModules', {});
    const { code, message } = await rejection(
      createCalendar().addEvent(dinner),
    );
    expect(code).toBe('unavailable');
    expect(message).toContain('"calendar": true');
  });

  it("rejects with the module's error, and calls anything it doesn't know failed", async () => {
    const cases = [
      [
        { error: 'unavailable', message: 'Needs iOS 17.' },
        'unavailable',
        'Needs iOS 17.',
      ],
      [{ error: 'unavailable' }, 'unavailable', undefined],
      [
        { error: 'failed', message: 'Already open.' },
        'failed',
        'Already open.',
      ],
      [{ error: 'odd' }, 'failed', "The event editor couldn't open."],
      [{ result: 'maybe' }, 'failed', "The event editor couldn't open."],
      [undefined, 'failed', "The event editor couldn't open."],
    ] as const;
    for (const [answer, expectedCode, expectedMessage] of cases) {
      const { addEvent, finish } = stubModule();
      const added = createCalendar().addEvent(dinner);
      await vi.waitFor(() => expect(addEvent).toHaveBeenCalled());
      finish(answer as never);
      const { code, message } = await rejection(added);
      expect(code).toBe(expectedCode);
      if (expectedMessage) expect(message).toBe(expectedMessage);
      else expect(message).toContain('iOS 17');
    }
  });

  it.each([
    [{ ...dinner, title: '  ' }, 'An event needs a title.'],
    [{ ...dinner, title: 42 as never }, 'An event needs a title.'],
    [
      { ...dinner, start: new Date(Number.NaN) },
      "An event's start must be a valid Date.",
    ],
    [
      { ...dinner, end: '2026-12-24' as never },
      "An event's end must be a valid Date.",
    ],
    [
      { ...dinner, end: new Date(dinner.start.getTime() - 1) },
      "An event can't end before it starts.",
    ],
  ])('throws a TypeError before opening anything: %#', async (event, text) => {
    const { addEvent } = stubModule();
    await expect(createCalendar().addEvent(event)).rejects.toThrow(
      new TypeError(text),
    );
    expect(addEvent).not.toHaveBeenCalled();
  });
});

/**
 * A page with just what the download uses, which the web preview reaches.
 */
const stubPage = () => {
  const anchors: { href: string; download: string; click: () => void }[] = [];
  const files: { parts: unknown[]; name: string; type: string }[] = [];
  const page = {
    navigator: {},
    document: {
      body: { appendChild: vi.fn() },
      createElement: () => {
        const anchor = {
          href: '',
          download: '',
          style: { display: '' },
          click: vi.fn(),
          remove: vi.fn(),
        };
        anchors.push(anchor);
        return anchor;
      },
    },
    File: class {
      constructor(parts: unknown[], name: string, { type }: { type: string }) {
        files.push({ parts, name, type });
        return { name } as never;
      }
    },
    URL: {
      createObjectURL: vi.fn(() => 'blob:page/event'),
      revokeObjectURL: vi.fn(),
    },
    setTimeout: vi.fn(),
  };
  vi.stubGlobal('SystemInfo', { platform: 'web' });
  vi.stubGlobal('parent', page);
  return { anchors, files };
};

describe('LynxCalendar in the web preview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads the event as an .ics file named for it, and resolves unknown', async () => {
    const { addEvent } = stubModule();
    const { anchors, files } = stubPage();

    await expect(
      createCalendar().addEvent({ ...dinner, title: 'A/B: "Dinner"?' }),
    ).resolves.toBe('unknown');

    expect(addEvent).not.toHaveBeenCalled();
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe('AB Dinner.ics');
    expect(files[0]!.type).toBe('text/calendar');
    expect(files[0]!.parts[0]).toContain('SUMMARY:A/B: "Dinner"?');
    expect(anchors.map(({ download }) => download)).toEqual(['AB Dinner.ics']);
    expect(anchors[0]!.click).toHaveBeenCalled();
  });

  it('names the file "event" when nothing of the title is left', async () => {
    const { files } = stubPage();
    await createCalendar().addEvent({ ...dinner, title: '???' });
    expect(files[0]!.name).toBe('event.ics');
  });
});

describe('toICalendar', () => {
  const now = new Date(Date.UTC(2026, 10, 29, 9, 5, 7));

  it('writes the event with its times in UTC and CRLF line ends', () => {
    expect(toICalendar(dinner, { now, uid: 'u1@angular-lynx' })).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//AngularLynx//LynxCalendar//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:u1@angular-lynx',
        'DTSTAMP:20261129T090507Z',
        'DTSTART:20261224T183000Z',
        'DTEND:20261224T200000Z',
        "SUMMARY:Dinner at Luigi's",
        'LOCATION:1 Main St\\, Springfield',
        'DESCRIPTION:Booking ABC123',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  it("writes an all-day event's local days, with the end the day after the last", () => {
    const ics = toICalendar(
      {
        title: 'Holiday',
        start: new Date(2026, 7, 1, 15),
        end: new Date(2026, 7, 31, 9),
        allDay: true,
      },
      { now, uid: 'u2' },
    );
    expect(ics).toContain('\r\nDTSTART;VALUE=DATE:20260801\r\n');
    expect(ics).toContain('\r\nDTEND;VALUE=DATE:20260901\r\n');
    expect(ics).not.toContain('LOCATION');
    expect(ics).not.toContain('DESCRIPTION');
  });

  it('leaves DTEND out of an event that ends when it starts, to the second', () => {
    const ics = toICalendar(
      {
        ...dinner,
        end: new Date(dinner.start.getTime() + 500),
      },
      { now, uid: 'u5' },
    );
    expect(ics).toContain('\r\nDTSTART:20261224T183000Z\r\nSUMMARY:');
    expect(ics).not.toContain('DTEND');
  });

  it("escapes iCalendar's special characters", () => {
    const ics = toICalendar(
      { ...dinner, notes: 'a\\b;c,d\ne\r\nf' },
      { now, uid: 'u3' },
    );
    expect(ics).toContain('\r\nDESCRIPTION:a\\\\b\\;c\\,d\\ne\\nf\r\n');
  });

  it('folds lines longer than 75 bytes without splitting a character', () => {
    const ics = toICalendar(
      { ...dinner, notes: `${'x'.repeat(70)}${'é'.repeat(40)}€😀` },
      { now, uid: 'u4' },
    );
    const lines = ics.split('\r\n');
    const start = lines.findIndex((line) => line.startsWith('DESCRIPTION:'));
    const folded = [lines[start]!];
    for (let i = start + 1; lines[i]!.startsWith(' '); i++) {
      folded.push(lines[i]!);
    }
    expect(folded.length).toBeGreaterThan(1);
    for (const line of folded) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // Unfolding gives the line back.
    expect(folded.map((line, i) => (i ? line.slice(1) : line)).join('')).toBe(
      `DESCRIPTION:${'x'.repeat(70)}${'é'.repeat(40)}€😀`,
    );
  });
});
