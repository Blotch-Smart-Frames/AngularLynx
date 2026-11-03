/**
 * `ReadableStream` for Lynx's main thread, which has none.
 *
 * A fetch `Response`'s `body` is one (fetch.ts), and code that reads a
 * response checks for the global before it reads `body`. Firestore's
 * WebChannel transport is one: with no `ReadableStream`, it reads the long
 * poll's response with `text()` and hands the string to code that expects
 * the chunks a stream gives, which throws inside a try/catch and drops the
 * response, so a query never returns (issue #205).
 *
 * It covers what libraries use: the constructor with `start`, `pull` and
 * `cancel` and a queuing strategy, a default reader, `cancel()`, `tee()`,
 * async iteration and `ReadableStream.from()`. A `type: 'bytes'` source
 * gets a default controller, which is all a source that only enqueues
 * Uint8Arrays needs; there are no BYOB readers. There's no `pipeTo()` or
 * `pipeThrough()`, since Lynx has no `WritableStream` or `TransformStream`
 * to pipe into.
 */

export type UnderlyingSource<T> = {
  type?: string;
  start?(controller: LynxReadableStreamController<T>): unknown;
  pull?(controller: LynxReadableStreamController<T>): unknown;
  cancel?(reason: unknown): unknown;
};

export type QueuingStrategy<T> = {
  highWaterMark?: number;
  size?(chunk: T): number;
};

export type ReadResult<T> =
  | { done: false; value: T }
  | { done: true; value: undefined };

type ReadRequest<T> = {
  resolve: (result: ReadResult<T>) => void;
  reject: (error: unknown) => void;
};

/**
 * A stream's internal state, which its controller and reader share.
 */
class StreamState<T> {
  state: 'readable' | 'closed' | 'errored' = 'readable';
  storedError: unknown;
  queue: { value: T; size: number }[] = [];
  queueSize = 0;
  closeRequested = false;
  started = false;
  pulling = false;
  pullAgain = false;
  /** Whether it's been read or canceled: `Response.bodyUsed` reports this. */
  disturbed = false;
  reader: LynxReadableStreamDefaultReader<T> | undefined;
  readRequests: ReadRequest<T>[] = [];

  constructor(
    readonly source: UnderlyingSource<T>,
    readonly highWaterMark: number,
    readonly sizeOf: (chunk: T) => number,
    readonly controller: LynxReadableStreamController<T>,
  ) {}

  get desiredSize(): number | null {
    if (this.state === 'errored') return null;
    if (this.state === 'closed') return 0;
    return this.highWaterMark - this.queueSize;
  }

  /**
   * Asks the source for more when a read is waiting or the queue is below
   * its high-water mark, one pull at a time.
   */
  pullIfNeeded(): void {
    if (
      this.state !== 'readable' ||
      this.closeRequested ||
      !this.started ||
      (this.readRequests.length === 0 && this.desiredSize! <= 0)
    ) {
      return;
    }
    if (this.pulling) {
      this.pullAgain = true;
      return;
    }
    this.pulling = true;
    let pulled: unknown;
    try {
      pulled = this.source.pull?.(this.controller);
    } catch (error) {
      this.error(error);
      return;
    }
    Promise.resolve(pulled).then(
      () => {
        this.pulling = false;
        if (this.pullAgain) {
          this.pullAgain = false;
          this.pullIfNeeded();
        }
      },
      (error) => this.error(error),
    );
  }

  enqueue(chunk: T): void {
    if (this.closeRequested || this.state !== 'readable') {
      throw new TypeError(
        "Failed to execute 'enqueue' on 'ReadableStreamDefaultController': Cannot enqueue a chunk into a readable stream that is closed or has been requested to be closed",
      );
    }
    const request = this.readRequests.shift();
    if (request) {
      request.resolve({ done: false, value: chunk });
    } else {
      let size: number;
      try {
        size = this.sizeOf(chunk);
      } catch (error) {
        this.error(error);
        throw error;
      }
      this.queue.push({ value: chunk, size });
      this.queueSize += size;
    }
    this.pullIfNeeded();
  }

  close(): void {
    if (this.closeRequested || this.state !== 'readable') {
      throw new TypeError(
        "Failed to execute 'close' on 'ReadableStreamDefaultController': Cannot close a readable stream that is closed or has been requested to be closed",
      );
    }
    this.closeRequested = true;
    if (this.queue.length === 0) this.finish();
  }

  error(error: unknown): void {
    if (this.state !== 'readable') return;
    this.state = 'errored';
    this.storedError = error;
    this.queue = [];
    this.queueSize = 0;
    for (const request of this.readRequests.splice(0)) request.reject(error);
    this.reader?.settleClosed(error);
  }

  /**
   * Closes the stream: waiting reads end, and the reader's `closed` resolves.
   */
  finish(): void {
    this.state = 'closed';
    for (const request of this.readRequests.splice(0)) {
      request.resolve({ done: true, value: undefined });
    }
    this.reader?.settleClosed();
  }

  read(): Promise<ReadResult<T>> {
    this.disturbed = true;
    if (this.state === 'errored') return Promise.reject(this.storedError);
    const next = this.queue.shift();
    if (next) {
      this.queueSize -= next.size;
      if (this.closeRequested && this.queue.length === 0) {
        this.finish();
      } else {
        this.pullIfNeeded();
      }
      return Promise.resolve({ done: false, value: next.value });
    }
    if (this.state === 'closed') {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve, reject) => {
      this.readRequests.push({ resolve, reject });
      this.pullIfNeeded();
    });
  }

  cancel(reason: unknown): Promise<void> {
    this.disturbed = true;
    if (this.state === 'closed') return Promise.resolve();
    if (this.state === 'errored') return Promise.reject(this.storedError);
    this.queue = [];
    this.queueSize = 0;
    this.finish();
    try {
      return Promise.resolve(this.source.cancel?.(reason)).then(() => {});
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

const states = new WeakMap<object, StreamState<any>>();

const stateOf = <T>(stream: LynxReadableStream<T>): StreamState<T> =>
  states.get(stream)!;

/**
 * Whether a stream has been read from or canceled, for `Response.bodyUsed`.
 *
 * @param stream - The stream.
 * @returns Whether it's disturbed.
 */
export const isDisturbed = (stream: LynxReadableStream<any>): boolean =>
  stateOf(stream).disturbed;

export class LynxReadableStreamController<T> {
  readonly #state: () => StreamState<T>;

  /**
   * @internal The stream passes its state lazily, since it's built after this.
   */
  constructor(state: () => StreamState<T>) {
    this.#state = state;
  }

  get desiredSize(): number | null {
    return this.#state().desiredSize;
  }

  enqueue(chunk: T): void {
    this.#state().enqueue(chunk);
  }

  close(): void {
    this.#state().close();
  }

  error(error?: unknown): void {
    this.#state().error(error);
  }
}

export class LynxReadableStreamDefaultReader<T> {
  #state: StreamState<T> | undefined;
  #settle!: (...error: unknown[]) => void;
  #closed: Promise<undefined>;

  constructor(stream: LynxReadableStream<T>) {
    const state = stateOf(stream);
    if (state.reader) {
      throw new TypeError(
        "Failed to construct 'ReadableStreamDefaultReader': This stream has already been locked for exclusive reading by another reader",
      );
    }
    state.reader = this;
    this.#state = state;
    this.#closed = new Promise((resolve, reject) => {
      this.#settle = (...error) =>
        error.length > 0 ? reject(error[0]) : resolve(undefined);
    });
    // A rejection nobody awaits isn't an unhandled one, as in browsers.
    this.#closed.catch(() => {});
    if (state.state === 'closed') this.#settle();
    else if (state.state === 'errored') this.#settle(state.storedError);
  }

  /**
   * Resolves once the stream closes, and rejects if it errors or the reader is released.
   */
  get closed(): Promise<undefined> {
    return this.#closed;
  }

  /**
   * @internal Settles `closed` when the stream closes or errors.
   */
  settleClosed(...error: unknown[]): void {
    this.#settle(...error);
  }

  read(): Promise<ReadResult<T>> {
    if (!this.#state) {
      return Promise.reject(new TypeError('This reader has been released'));
    }
    return this.#state.read();
  }

  cancel(reason?: unknown): Promise<void> {
    if (!this.#state) {
      return Promise.reject(new TypeError('This reader has been released'));
    }
    return this.#state.cancel(reason);
  }

  releaseLock(): void {
    const state = this.#state;
    if (!state) return;
    const released = new TypeError('This reader has been released');
    // Reads still waiting fail, as the current Streams Standard has it.
    for (const request of state.readRequests.splice(0)) {
      request.reject(released);
    }
    if (state.state === 'readable') {
      this.#settle(released);
    } else {
      // `closed` has settled already; a released reader's rejects anyway.
      this.#closed = Promise.reject(released);
      this.#closed.catch(() => {});
    }
    state.reader = undefined;
    this.#state = undefined;
  }
}

export class LynxReadableStream<T = Uint8Array> {
  constructor(
    source: UnderlyingSource<T> = {},
    strategy: QueuingStrategy<T> = {},
  ) {
    const highWaterMark =
      strategy.highWaterMark ?? (source.type === 'bytes' ? 0 : 1);
    if (Number.isNaN(highWaterMark) || highWaterMark < 0) {
      throw new RangeError(
        "Failed to construct 'ReadableStream': Cannot create a stream with a negative or NaN high-water mark",
      );
    }
    const controller: LynxReadableStreamController<T> =
      new LynxReadableStreamController<T>(() => state);
    const state: StreamState<T> = new StreamState<T>(
      source,
      highWaterMark,
      strategy.size ?? (() => 1),
      controller,
    );
    states.set(this, state);
    const started = source.start?.(controller);
    Promise.resolve(started).then(
      () => {
        state.started = true;
        state.pullIfNeeded();
      },
      (error) => state.error(error),
    );
  }

  get locked(): boolean {
    return stateOf(this).reader !== undefined;
  }

  getReader(
    options: { mode?: string } = {},
  ): LynxReadableStreamDefaultReader<T> {
    if (options.mode !== undefined) {
      throw new TypeError(
        `Failed to execute 'getReader' on 'ReadableStream': Lynx supports only default readers, not '${options.mode}' readers`,
      );
    }
    return new LynxReadableStreamDefaultReader(this);
  }

  cancel(reason?: unknown): Promise<void> {
    if (this.locked) {
      return Promise.reject(
        new TypeError(
          "Failed to execute 'cancel' on 'ReadableStream': Cannot cancel a locked stream",
        ),
      );
    }
    return stateOf(this).cancel(reason);
  }

  /**
   * Two streams that each get every chunk. Reads from this one as either
   * branch needs more, and cancels it once both branches are canceled.
   */
  tee(): [LynxReadableStream<T>, LynxReadableStream<T>] {
    const reader = this.getReader();
    const controllers: LynxReadableStreamController<T>[] = [];
    const canceled = [false, false];
    const reasons: unknown[] = [];
    let reading: Promise<void> | undefined;
    const pull = () =>
      (reading ??= reader.read().then(
        (result) => {
          reading = undefined;
          controllers.forEach((controller, i) => {
            if (canceled[i]) return;
            if (result.done) controller.close();
            else controller.enqueue(result.value);
          });
        },
        (error) => controllers.forEach((controller) => controller.error(error)),
      ));
    const branch = (i: number) =>
      new LynxReadableStream<T>({
        start: (controller) => {
          controllers[i] = controller;
        },
        pull,
        cancel: (reason) => {
          canceled[i] = true;
          reasons[i] = reason;
          if (canceled[0] && canceled[1]) return reader.cancel(reasons);
          return undefined;
        },
      });
    return [branch(0), branch(1)];
  }

  async *values(
    options: { preventCancel?: boolean } = {},
  ): AsyncGenerator<T, undefined> {
    const reader = this.getReader();
    let done = false;
    try {
      for (;;) {
        const result = await reader.read().catch((error: unknown) => {
          // The stream has errored, so there's nothing to cancel.
          done = true;
          throw error;
        });
        if (result.done) {
          done = true;
          return undefined;
        }
        yield result.value;
      }
    } finally {
      // A loop that breaks early cancels the stream, unless told not to.
      if (!done && !options.preventCancel) await reader.cancel();
      reader.releaseLock();
    }
  }

  [Symbol.asyncIterator](
    options: { preventCancel?: boolean } = {},
  ): AsyncGenerator<T, undefined> {
    return this.values(options);
  }

  /**
   * A stream of an iterable's or async iterable's values.
   *
   * @param iterable - The values.
   * @returns The stream.
   */
  static from<T>(
    iterable: Iterable<T> | AsyncIterable<T>,
  ): LynxReadableStream<T> {
    const iterator: Iterator<T> | AsyncIterator<T> =
      typeof (iterable as any)[Symbol.asyncIterator] === 'function'
        ? (iterable as AsyncIterable<T>)[Symbol.asyncIterator]()
        : (iterable as Iterable<T>)[Symbol.iterator]();
    return new LynxReadableStream<T>(
      {
        pull: async (controller) => {
          const result = await iterator.next();
          if (result.done) controller.close();
          else controller.enqueue(await result.value);
        },
        cancel: async (reason) => {
          await iterator.return?.(reason);
        },
      },
      { highWaterMark: 0 },
    );
  }
}
