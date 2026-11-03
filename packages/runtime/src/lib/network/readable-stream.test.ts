import { describe, expect, it, vi } from 'vitest';
import {
  isDisturbed,
  LynxReadableStream,
  type LynxReadableStreamController,
} from './readable-stream';

/**
 * Lets pending promise callbacks run.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Reads every chunk, as `for await` does.
 */
const readAll = async <T>(stream: LynxReadableStream<T>): Promise<T[]> => {
  const chunks: T[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};

describe('LynxReadableStream', () => {
  it('reads the chunks a source enqueues in start(), then ends', async () => {
    const stream = new LynxReadableStream<number>({
      start: (controller) => {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.close();
      },
    });
    const reader = stream.getReader();
    expect(await reader.read()).toEqual({ done: false, value: 1 });
    expect(await reader.read()).toEqual({ done: false, value: 2 });
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    await expect(reader.closed).resolves.toBeUndefined();
  });

  it('works with no source, as an empty stream that never ends', async () => {
    const reader = new LynxReadableStream().getReader();
    let read = false;
    void reader.read().then(() => (read = true));
    await settle();
    expect(read).toBe(false);
  });

  it('answers a waiting read with the next chunk enqueued', async () => {
    let controller!: LynxReadableStreamController<string>;
    const stream = new LynxReadableStream<string>({
      start: (c) => {
        controller = c;
      },
    });
    const reader = stream.getReader();
    const first = reader.read();
    const second = reader.read();
    controller.enqueue('a');
    controller.close();
    expect(await first).toEqual({ done: false, value: 'a' });
    expect(await second).toEqual({ done: true, value: undefined });
  });

  it('pulls once started, up to the high-water mark, one pull at a time', async () => {
    let n = 0;
    const pull = vi.fn(
      async (controller: LynxReadableStreamController<number>) => {
        await settle();
        controller.enqueue(n++);
        if (n === 3) controller.close();
      },
    );
    const stream = new LynxReadableStream<number>(
      { pull },
      { highWaterMark: 2 },
    );
    const controllerSize = await new Promise<number | null>((resolve) => {
      new LynxReadableStream<number>(
        {
          start: (controller) => {
            controller.enqueue(9);
            resolve(controller.desiredSize);
          },
        },
        { highWaterMark: 2 },
      );
    });
    expect(controllerSize).toBe(1);
    expect(await readAll(stream)).toEqual([0, 1, 2]);
    expect(pull).toHaveBeenCalledTimes(3);
  });

  it('pulls again when a read arrives during a pull', async () => {
    let n = 0;
    const stream = new LynxReadableStream<number>(
      {
        pull: async (controller) => {
          await settle();
          controller.enqueue(n++);
        },
      },
      { highWaterMark: 0 },
    );
    const reader = stream.getReader();
    const reads = [reader.read(), reader.read(), reader.read()];
    expect((await Promise.all(reads)).map((r) => r.value)).toEqual([0, 1, 2]);
  });

  it('measures chunks with the strategy, and errors when size() throws', async () => {
    let controller!: LynxReadableStreamController<string>;
    const stream = new LynxReadableStream<string>(
      {
        start: (c) => {
          controller = c;
        },
      },
      {
        highWaterMark: 10,
        size: (chunk) => {
          if (chunk === 'bad') throw new Error('size');
          return chunk.length;
        },
      },
    );
    controller.enqueue('abcd');
    expect(controller.desiredSize).toBe(6);
    expect(() => controller.enqueue('bad')).toThrow('size');
    expect(controller.desiredSize).toBeNull();
    await expect(stream.getReader().read()).rejects.toThrow('size');
  });

  it('refuses a negative or NaN high-water mark', () => {
    expect(() => new LynxReadableStream({}, { highWaterMark: -1 })).toThrow(
      RangeError,
    );
    expect(
      () => new LynxReadableStream({}, { highWaterMark: Number.NaN }),
    ).toThrow(RangeError);
  });

  it('treats a byte source as a default one, with no BYOB readers', async () => {
    const stream = new LynxReadableStream<Uint8Array>({
      type: 'bytes',
      start: (controller) => {
        expect(controller.desiredSize).toBe(0);
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    expect(() => stream.getReader({ mode: 'byob' })).toThrow(TypeError);
    expect(await readAll(stream)).toEqual([new Uint8Array([1])]);
  });

  it('refuses to enqueue or close once closed', () => {
    new LynxReadableStream({
      start: (controller) => {
        controller.close();
        expect(controller.desiredSize).toBe(0);
        expect(() => controller.enqueue(1)).toThrow(TypeError);
        expect(() => controller.close()).toThrow(TypeError);
      },
    });
  });

  it('keeps queued chunks readable after close() until they are read', async () => {
    let controller!: LynxReadableStreamController<number>;
    const stream = new LynxReadableStream<number>({
      start: (c) => {
        controller = c;
      },
    });
    controller.enqueue(1);
    controller.close();
    expect(() => controller.enqueue(2)).toThrow(TypeError);
    expect(await readAll(stream)).toEqual([1]);
  });

  it('errors: waiting and later reads reject, and closed rejects', async () => {
    let controller!: LynxReadableStreamController<number>;
    const stream = new LynxReadableStream<number>({
      start: (c) => {
        controller = c;
      },
    });
    controller.enqueue(1);
    const reader = stream.getReader();
    expect((await reader.read()).value).toBe(1);
    const waiting = reader.read();
    controller.error(new Error('boom'));
    controller.error(new Error('ignored'));
    await expect(waiting).rejects.toThrow('boom');
    await expect(reader.read()).rejects.toThrow('boom');
    await expect(reader.closed).rejects.toThrow('boom');
    await expect(reader.cancel()).rejects.toThrow('boom');
    expect(controller.desiredSize).toBeNull();
    // A reader made after the error sees it at once.
    reader.releaseLock();
    await expect(stream.cancel()).rejects.toThrow('boom');
    await expect(stream.getReader().closed).rejects.toThrow('boom');
  });

  it('errors when start() or pull() rejects, and when pull() throws', async () => {
    const fromStart = new LynxReadableStream({
      start: () => Promise.reject(new Error('start')),
    });
    await expect(fromStart.getReader().read()).rejects.toThrow('start');

    const fromPull = new LynxReadableStream({
      pull: () => Promise.reject(new Error('pull')),
    });
    await expect(fromPull.getReader().read()).rejects.toThrow('pull');

    const throwing = new LynxReadableStream({
      pull: () => {
        throw new Error('sync pull');
      },
    });
    await expect(throwing.getReader().read()).rejects.toThrow('sync pull');
  });

  it('throws from the constructor when start() throws', () => {
    expect(
      () =>
        new LynxReadableStream({
          start: () => {
            throw new Error('start');
          },
        }),
    ).toThrow('start');
  });

  describe('locking', () => {
    it('allows one reader at a time', async () => {
      const stream = new LynxReadableStream<number>({
        start: (controller) => controller.enqueue(1),
      });
      expect(stream.locked).toBe(false);
      const reader = stream.getReader();
      expect(stream.locked).toBe(true);
      expect(() => stream.getReader()).toThrow(TypeError);
      await expect(stream.cancel()).rejects.toThrow(TypeError);
      reader.releaseLock();
      reader.releaseLock();
      expect(stream.locked).toBe(false);
      expect((await stream.getReader().read()).value).toBe(1);
    });

    it('fails reads still waiting, and closed, when the lock is released', async () => {
      const stream = new LynxReadableStream<number>();
      const reader = stream.getReader();
      const waiting = reader.read();
      reader.releaseLock();
      await expect(waiting).rejects.toThrow('released');
      await expect(reader.closed).rejects.toThrow('released');
      await expect(reader.read()).rejects.toThrow('released');
      await expect(reader.cancel()).rejects.toThrow('released');
    });

    it('rejects closed once released, even after the stream closed', async () => {
      const stream = new LynxReadableStream({
        start: (controller) => controller.close(),
      });
      const reader = stream.getReader();
      await expect(reader.closed).resolves.toBeUndefined();
      reader.releaseLock();
      await expect(reader.closed).rejects.toThrow('released');
    });
  });

  describe('cancel', () => {
    it('drops the queue, ends reads, and tells the source', async () => {
      const cancel = vi.fn();
      const stream = new LynxReadableStream<number>({
        start: (controller) => controller.enqueue(1),
        cancel,
      });
      const reader = stream.getReader();
      expect(isDisturbed(stream)).toBe(false);
      await expect(reader.cancel('why')).resolves.toBeUndefined();
      expect(isDisturbed(stream)).toBe(true);
      expect(cancel).toHaveBeenCalledWith('why');
      expect(await reader.read()).toEqual({ done: true, value: undefined });
      await expect(reader.closed).resolves.toBeUndefined();
      reader.releaseLock();
      await expect(stream.cancel()).resolves.toBeUndefined();
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("works without the source's cancel, and passes on its failure", async () => {
      await expect(new LynxReadableStream().cancel()).resolves.toBeUndefined();
      await expect(
        new LynxReadableStream({
          cancel: () => Promise.reject(new Error('async')),
        }).cancel(),
      ).rejects.toThrow('async');
      await expect(
        new LynxReadableStream({
          cancel: () => {
            throw new Error('sync');
          },
        }).cancel(),
      ).rejects.toThrow('sync');
    });
  });

  it('marks itself disturbed once read', async () => {
    const stream = new LynxReadableStream({
      start: (controller) => controller.close(),
    });
    const reader = stream.getReader();
    expect(isDisturbed(stream)).toBe(false);
    await reader.read();
    expect(isDisturbed(stream)).toBe(true);
  });

  describe('async iteration', () => {
    it('cancels the stream when a loop stops early, unless told not to', async () => {
      const cancel = vi.fn();
      const make = () =>
        new LynxReadableStream<number>({
          start: (controller) => {
            controller.enqueue(1);
            controller.enqueue(2);
          },
          cancel,
        });

      const stream = make();
      for await (const chunk of stream) {
        expect(chunk).toBe(1);
        break;
      }
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);

      const kept = make();
      for await (const chunk of kept.values({ preventCancel: true })) {
        expect(chunk).toBe(1);
        break;
      }
      expect(cancel).toHaveBeenCalledTimes(1);
      expect((await kept.getReader().read()).value).toBe(2);

      const viaSymbol = make()[Symbol.asyncIterator]({ preventCancel: true });
      expect((await viaSymbol.next()).value).toBe(1);
      await viaSymbol.return(undefined);
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('throws the error of a stream that errors', async () => {
      const stream = new LynxReadableStream({
        pull: () => Promise.reject(new Error('broken')),
      });
      await expect(readAll(stream)).rejects.toThrow('broken');
      expect(stream.locked).toBe(false);
    });
  });

  describe('tee', () => {
    it('gives each branch every chunk', async () => {
      const [a, b] = new LynxReadableStream<number>({
        start: (controller) => {
          controller.enqueue(1);
          controller.enqueue(2);
          controller.close();
        },
      }).tee();
      expect(await readAll(a)).toEqual([1, 2]);
      expect(await readAll(b)).toEqual([1, 2]);
    });

    it('keeps feeding one branch when the other is canceled, and cancels the source once both are', async () => {
      const cancel = vi.fn();
      const source = new LynxReadableStream<number>({
        start: (controller) => {
          controller.enqueue(1);
          controller.enqueue(2);
          controller.close();
        },
        cancel,
      });
      const [a, b] = source.tee();
      expect(source.locked).toBe(true);
      await a.cancel('a');
      expect(cancel).not.toHaveBeenCalled();
      expect(await readAll(b)).toEqual([1, 2]);

      const open = new LynxReadableStream<number>({ cancel });
      const [c, d] = open.tee();
      await c.cancel('c');
      await d.cancel('d');
      expect(cancel).toHaveBeenCalledWith(['c', 'd']);
    });

    it('errors both branches when the source errors', async () => {
      const [a, b] = new LynxReadableStream({
        pull: () => Promise.reject(new Error('source')),
      }).tee();
      await expect(a.getReader().read()).rejects.toThrow('source');
      await expect(b.getReader().read()).rejects.toThrow('source');
    });
  });

  describe('from', () => {
    it('streams an iterable or an async iterable', async () => {
      expect(await readAll(LynxReadableStream.from([1, 2]))).toEqual([1, 2]);
      expect(await readAll(LynxReadableStream.from('ab'))).toEqual(['a', 'b']);
      const values = async function* () {
        yield 1;
        yield 2;
      };
      expect(await readAll(LynxReadableStream.from(values()))).toEqual([1, 2]);
    });

    it('ends the iterator when canceled, if it can be ended', async () => {
      const finished = vi.fn();
      const values = function* () {
        try {
          yield 1;
          yield 2;
        } finally {
          finished();
        }
      };
      const stream = LynxReadableStream.from(values());
      const reader = stream.getReader();
      expect((await reader.read()).value).toBe(1);
      await reader.cancel();
      expect(finished).toHaveBeenCalled();

      const plain = LynxReadableStream.from({
        [Symbol.iterator]: () => ({ next: () => ({ done: false, value: 1 }) }),
      });
      await expect(plain.cancel()).resolves.toBeUndefined();
    });
  });
});
