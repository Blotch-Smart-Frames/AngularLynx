/** What `LynxCalendar` calls, named as the shells name their module. */
const MODULE = 'AngularLynxCalendar';

/** An event the app opened the editor with, as `LynxCalendar` was given it. */
export type CalendarSheetEvent = {
  readonly title: string;
  readonly start: Date;
  readonly end: Date;
  readonly allDay: boolean;
  readonly location?: string;
  readonly notes?: string;
};

/** How the editor closes, as `LynxCalendar.addEvent()` resolves. */
export type CalendarSheetAnswer = 'saved' | 'canceled' | 'unknown';

/** Why the editor didn't open, as `CalendarError`'s `code` names it. */
export type CalendarSheetFailure = 'unavailable' | 'failed';

/** The event as the runtime sends it to the shells' module. */
type SentEvent = {
  readonly title: string;
  readonly start: number;
  readonly end: number;
  readonly allDay: boolean;
  readonly location?: string;
  readonly notes?: string;
};

/** How the editor closes, as the shells' module calls back. */
type Answer =
  | { readonly result: CalendarSheetAnswer }
  | { readonly error: string; readonly message?: string };

type Done = (answer: Answer) => void;

type FakeCalendarModule = {
  /** Every event the app opened the editor with, in this test. */
  readonly events: CalendarSheetEvent[];
  /** Answers given before the editor opened, for the next ones in turn. */
  readonly queued: Answer[];
  /** The open editor's callback, until it's answered. */
  open: Done | undefined;
  addEvent(event: SentEvent, done: Done): void;
};

/** The part of `@lynx-js/testing-environment`'s environment this uses. */
type TestingEnvironment = {
  readonly backgroundThread: {
    readonly globalThis: { NativeModules?: Record<string, unknown> };
  };
  switchToBackgroundThread(): void;
  switchToMainThread(): void;
};

/**
 * Gives the environment's background thread an `AngularLynxCalendar` module,
 * as the apps `ng build --platform` makes with angular.json's `calendar`
 * have. It keeps each event the app opens the editor with, for
 * {@link calendarEvents}, and leaves the editor open until
 * {@link answerCalendarSheet} or {@link failCalendarSheet} closes it, or
 * closes it at once with what one of them queued before it opened.
 * `LynxCalendar` reaches it through the background thread, as it reaches the
 * shells' module, so specs see the runtime's own behavior.
 *
 * It runs each time the environment injects the background thread's
 * globals: when it's created, and on the reset after each test, so each test
 * starts with no events, no editor open and nothing queued.
 */
export const installCalendarModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const module: FakeCalendarModule = {
    events: [],
    queued: [],
    open: undefined,
    addEvent(event, done) {
      if (this.open) {
        done({ error: 'failed', message: 'The event editor is already open.' });
        return;
      }
      this.events.push({
        title: event.title,
        start: new Date(event.start),
        end: new Date(event.end),
        allDay: event.allDay,
        ...(event.location !== undefined && { location: event.location }),
        ...(event.notes !== undefined && { notes: event.notes }),
      });
      const answer = this.queued.shift();
      if (answer) {
        done(answer);
        return;
      }
      this.open = done;
    },
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

/**
 * The fake module, read through the environment rather than kept here:
 * under `ng test`, the setup file and the specs can load different copies of
 * this file.
 */
const fakeModule = (
  name: string,
): { env: TestingEnvironment; module: FakeCalendarModule } => {
  const env = (globalThis as any).lynxTestingEnv as
    | TestingEnvironment
    | undefined;
  const module = env?.backgroundThread.globalThis.NativeModules?.[MODULE] as
    | FakeCalendarModule
    | undefined;
  if (!env || !module) {
    throw new Error(
      `${name}() needs the testing library's environment, which its setup file installs.`,
    );
  }
  return { env, module };
};

const answer = (name: string, result: Answer): void => {
  const { env, module } = fakeModule(name);
  const open = module.open;
  if (!open) {
    module.queued.push(result);
    return;
  }
  module.open = undefined;
  // The shells call back on the background thread, which relays the answer
  // to the main thread, where specs run: it comes back afterwards.
  env.switchToBackgroundThread();
  try {
    open(result);
  } finally {
    env.switchToMainThread();
  }
};

/**
 * The events the app has opened the system's event editor with, through
 * `LynxCalendar.addEvent()`, in this test, oldest first. Each test starts
 * with none.
 *
 * @example
 * ```ts
 * fireEvent.tap(screen.getByText('Add to calendar'));
 * await waitForUpdate();
 * expect(calendarEvents()).toEqual([
 *   expect.objectContaining({ title: 'Table for 2' }),
 * ]);
 * ```
 */
export const calendarEvents = (): readonly CalendarSheetEvent[] => [
  ...fakeModule('calendarEvents').module.events,
];

/**
 * Closes the event editor as the person would: the open
 * `LynxCalendar.addEvent()` resolves with `result` (`saved` by default), or,
 * when none is open, the next one does as soon as it's called. Each call
 * answers one editor, in order. The answer reaches the app through the
 * background thread, as on a phone: wait for it with `waitForUpdate()`.
 *
 * @example
 * ```ts
 * fireEvent.tap(screen.getByText('Add to calendar'));
 * answerCalendarSheet('saved');
 * await waitForUpdate();
 * expect(screen.getByText('Added to your calendar')).toBeInTheDocument();
 * ```
 */
export const answerCalendarSheet = (
  result: CalendarSheetAnswer = 'saved',
): void => answer('answerCalendarSheet', { result });

/**
 * Ends the open `LynxCalendar.addEvent()`, or the next one, with a
 * `CalendarError` of `code`: `unavailable` for a phone without an editor
 * (before iOS 17, or Android without a calendar app), or `failed`.
 */
export const failCalendarSheet = (
  code: CalendarSheetFailure,
  message?: string,
): void =>
  answer('failCalendarSheet', {
    error: code,
    ...(message !== undefined && { message }),
  });
