import { describe, expect, it } from 'vitest';
import { Opcode, OpcodeRecorder } from './opcodes';

describe('Opcode enum', () => {
  it('has expected numeric values matching React Lynx convention', () => {
    expect(Opcode.Begin).toBe(0);
    expect(Opcode.End).toBe(1);
    expect(Opcode.Attr).toBe(2);
    expect(Opcode.Text).toBe(3);
  });
});

describe('OpcodeRecorder', () => {
  it('starts with an empty opcodes array', () => {
    const recorder = new OpcodeRecorder();
    expect(recorder.opcodes).toEqual([]);
  });

  describe('nextId', () => {
    it('returns sequential string IDs starting from "0"', () => {
      const recorder = new OpcodeRecorder();
      expect(recorder.nextId()).toBe('0');
      expect(recorder.nextId()).toBe('1');
      expect(recorder.nextId()).toBe('2');
    });
  });

  describe('begin', () => {
    it('pushes [Begin, ssrId, tag] to opcodes', () => {
      const recorder = new OpcodeRecorder();
      recorder.begin('0', 'view');
      expect(recorder.opcodes).toEqual([Opcode.Begin, '0', 'view']);
    });
  });

  describe('end', () => {
    it('pushes [End] to opcodes', () => {
      const recorder = new OpcodeRecorder();
      recorder.end();
      expect(recorder.opcodes).toEqual([Opcode.End]);
    });
  });

  describe('attr', () => {
    it('pushes [Attr, key, value] to opcodes', () => {
      const recorder = new OpcodeRecorder();
      recorder.attr('src', 'image.png');
      expect(recorder.opcodes).toEqual([Opcode.Attr, 'src', 'image.png']);
    });

    it('handles non-string values', () => {
      const recorder = new OpcodeRecorder();
      recorder.attr('disabled', true);
      expect(recorder.opcodes).toEqual([Opcode.Attr, 'disabled', true]);
    });
  });

  describe('text', () => {
    it('pushes [Text, ssrId, content] to opcodes', () => {
      const recorder = new OpcodeRecorder();
      recorder.text('5', 'Hello world');
      expect(recorder.opcodes).toEqual([Opcode.Text, '5', 'Hello world']);
    });
  });

  describe('compound recording', () => {
    it('produces a well-formed opcode stream for a nested tree', () => {
      const recorder = new OpcodeRecorder();
      const rootId = recorder.nextId();
      recorder.begin(rootId, 'view');
      recorder.attr('class', 'container');

      const childId = recorder.nextId();
      recorder.begin(childId, 'text');
      recorder.end();

      const textId = recorder.nextId();
      recorder.text(textId, 'content');

      recorder.end();

      expect(recorder.opcodes).toEqual([
        Opcode.Begin,
        '0',
        'view',
        Opcode.Attr,
        'class',
        'container',
        Opcode.Begin,
        '1',
        'text',
        Opcode.End,
        Opcode.Text,
        '2',
        'content',
        Opcode.End,
      ]);
    });
  });
});
