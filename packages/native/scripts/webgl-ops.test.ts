import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ANDROID_OPS,
  IOS_OPS,
  OPS_SOURCE,
  parseOps,
  renderAndroidOps,
  renderIosOps,
} from './webgl-ops.ts';

describe('WebGL bridge opcodes', () => {
  const ops = parseOps(readFileSync(OPS_SOURCE, 'utf8'));

  it('reads every opcode from the runtime', () => {
    expect(ops.length).toBeGreaterThan(190);
    expect(ops[0]).toEqual(['activeTexture', 1]);
    expect(ops).toContainEqual(['present', expect.any(Number)]);
    expect(ops).toContainEqual(['getParameter', 200]);
    // One number per command.
    expect(new Set(ops.map(([, value]) => value)).size).toBe(ops.length);
  });

  // The runtime and the shells ship in separate packages: a stale copy would
  // make the shell run the wrong GL call. Regenerate with
  // `npm run generate:webgl-ops -w packages/native`.
  it('matches the iOS shell', () => {
    expect(readFileSync(IOS_OPS, 'utf8')).toBe(renderIosOps(ops));
  });

  it('matches the Android shell', () => {
    expect(readFileSync(ANDROID_OPS, 'utf8')).toBe(renderAndroidOps(ops));
  });

  it('names each opcode for its language', () => {
    expect(renderIosOps([['uniformMatrix4fv', 145]])).toContain(
      'ALWebGLOpUniformMatrix4fv = 145,',
    );
    expect(renderAndroidOps([['uniformMatrix4fv', 145]])).toContain(
      'const val UNIFORM_MATRIX4FV = 145',
    );
    expect(renderAndroidOps([['texImage2D', 110]])).toContain(
      'const val TEX_IMAGE2D = 110',
    );
  });
});
