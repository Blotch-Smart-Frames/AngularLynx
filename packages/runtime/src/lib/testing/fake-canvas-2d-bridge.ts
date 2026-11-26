// The shells' 2D canvas methods on the AngularLynxWebGL module, faked for the
// runtime's 2D context specs: it records every batch the context sends, and
// answers queries from a queue the spec fills.
//
// Not exported from public-api.ts: this is test-only infrastructure, never
// shipped in the published package.
import { vi } from 'vitest';
import type { Canvas2DBridge } from '../canvas/webgl-bridge';

export type FakeCanvas2DBridge = {
  /** Every batch `run2D` was sent, in order. */
  batches: unknown[][];
  /** Answers for the next batch that asks something, in order. */
  answers: unknown[];
  create2D: ReturnType<typeof vi.fn<Canvas2DBridge['create2D']>>;
  destroy2D: ReturnType<typeof vi.fn<Canvas2DBridge['destroy2D']>>;
  /** Answers with a file of bytes 1 and 2, of the type asked for. */
  encode2D: ReturnType<typeof vi.fn<Canvas2DBridge['encode2D']>>;
  /** Every command sent, flattened. */
  sent(): unknown[];
} & Canvas2DBridge;

export const createFakeCanvas2DBridge = (): FakeCanvas2DBridge => {
  const fake: FakeCanvas2DBridge = {
    batches: [],
    answers: [],
    create2D: vi.fn(() => ({ ok: true })),
    destroy2D: vi.fn(),
    encode2D: vi.fn((_contextId, { type }) => ({ base64: 'AQI=', type })),
    run2D: (_contextId, commands) => {
      fake.batches.push(commands);
      return fake.answers.splice(0);
    },
    sent: () => fake.batches.flat(),
  };
  return fake;
};
