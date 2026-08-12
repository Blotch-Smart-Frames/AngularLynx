import { describe, expect, it } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { buildElementQueueFromOpcodes } from './build-element-queue';
import { Opcode } from './opcodes';

describe('buildElementQueueFromOpcodes', () => {
  const makeRef = (label: string): ElementRef => ({ _label: label }) as any;

  it('returns an empty queue for an empty opcode stream', () => {
    const result = buildElementQueueFromOpcodes([], {});
    expect(result).toEqual([]);
  });

  it('maps Begin opcodes to their ElementRefs via ssrId', () => {
    const ref0 = makeRef('view-0');
    const ref1 = makeRef('text-1');
    const opcodes = [
      Opcode.Begin,
      '0',
      'view',
      Opcode.Begin,
      '1',
      'text',
      Opcode.End,
      Opcode.End,
    ];
    const refsMap: Record<string, ElementRef> = { '0': ref0, '1': ref1 };

    const result = buildElementQueueFromOpcodes(opcodes, refsMap);

    expect(result).toEqual([ref0, ref1]);
  });

  it('maps Text opcodes to their ElementRefs via ssrId', () => {
    const refText = makeRef('raw-text');
    const opcodes = [Opcode.Text, '3', 'hello'];
    const refsMap: Record<string, ElementRef> = { '3': refText };

    const result = buildElementQueueFromOpcodes(opcodes, refsMap);

    expect(result).toEqual([refText]);
  });

  it('skips Begin opcodes with no matching ref in the map', () => {
    const ref1 = makeRef('exists');
    const opcodes = [
      Opcode.Begin,
      '0',
      'view',
      Opcode.Begin,
      '1',
      'text',
      Opcode.End,
      Opcode.End,
    ];
    const refsMap: Record<string, ElementRef> = { '1': ref1 };

    const result = buildElementQueueFromOpcodes(opcodes, refsMap);

    expect(result).toEqual([ref1]);
  });

  it('skips Text opcodes with no matching ref in the map', () => {
    const opcodes = [Opcode.Text, '99', 'orphan'];
    const result = buildElementQueueFromOpcodes(opcodes, {});
    expect(result).toEqual([]);
  });

  it('skips Attr opcodes without adding to queue', () => {
    const ref0 = makeRef('view');
    const opcodes = [
      Opcode.Begin,
      '0',
      'view',
      Opcode.Attr,
      'class',
      'container',
      Opcode.Attr,
      'id',
      'main',
      Opcode.End,
    ];
    const refsMap: Record<string, ElementRef> = { '0': ref0 };

    const result = buildElementQueueFromOpcodes(opcodes, refsMap);

    expect(result).toEqual([ref0]);
  });

  it('skips End opcodes without adding to queue', () => {
    const opcodes = [Opcode.End, Opcode.End, Opcode.End];
    const result = buildElementQueueFromOpcodes(opcodes, {});
    expect(result).toEqual([]);
  });

  it('handles unknown opcodes by advancing one position', () => {
    const ref0 = makeRef('view');
    const opcodes = [999, Opcode.Begin, '0', 'view', Opcode.End];
    const refsMap: Record<string, ElementRef> = { '0': ref0 };

    const result = buildElementQueueFromOpcodes(opcodes, refsMap);

    expect(result).toEqual([ref0]);
  });

  it('preserves insertion order for a complex mixed stream', () => {
    const refA = makeRef('a');
    const refB = makeRef('b');
    const refC = makeRef('c');
    const opcodes = [
      Opcode.Begin,
      'a',
      'view',
      Opcode.Attr,
      'x',
      '1',
      Opcode.Text,
      'b',
      'hello',
      Opcode.Begin,
      'c',
      'text',
      Opcode.End,
      Opcode.End,
    ];
    const refsMap: Record<string, ElementRef> = {
      a: refA,
      b: refB,
      c: refC,
    };

    const result = buildElementQueueFromOpcodes(opcodes, refsMap);

    expect(result).toEqual([refA, refB, refC]);
  });
});
