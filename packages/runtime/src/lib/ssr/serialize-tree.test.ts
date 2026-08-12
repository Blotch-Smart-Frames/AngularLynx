import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { OpcodeRecorder } from './opcodes';
import { serializeElementTree } from './serialize-tree';

describe('serializeElementTree', () => {
  let recorder: OpcodeRecorder;

  beforeEach(() => {
    recorder = new OpcodeRecorder();
    globalThis.__MarkTemplateElement = vi.fn();
    globalThis.__MarkPartElement = vi.fn();
    globalThis.__GetTag = vi.fn();
    globalThis.__GetAttributeByName = vi.fn(() => '');
    globalThis.__GetAttributes = vi.fn(() => ({}));
    globalThis.__GetClasses = vi.fn(() => []);
    globalThis.__GetInlineStyles = vi.fn(() => '');
    globalThis.__GetChildren = vi.fn(() => []);
  });

  it('marks the root as a template element', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('view');

    serializeElementTree(root, recorder);

    expect(__MarkTemplateElement).toHaveBeenCalledWith(root);
  });

  it('serializes a single element node with Begin/End', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('view');

    serializeElementTree(root, recorder);

    expect(recorder.opcodes).toContain(0); // Opcode.Begin
    expect(recorder.opcodes).toContain('view');
  });

  it('serializes a raw-text node with Text opcode', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('raw-text');
    vi.mocked(__GetAttributeByName).mockReturnValue('Hello');

    serializeElementTree(root, recorder);

    // Text opcode = 3, followed by ssrId and content
    expect(recorder.opcodes).toEqual([3, '0', 'Hello']);
  });

  it('serializes a rawtextelement node the same as raw-text', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('rawtextelement');
    vi.mocked(__GetAttributeByName).mockReturnValue('World');

    serializeElementTree(root, recorder);

    expect(recorder.opcodes).toEqual([3, '0', 'World']);
  });

  it('uses empty string when textContent is null', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('raw-text');
    vi.mocked(__GetAttributeByName).mockReturnValue(null);

    serializeElementTree(root, recorder);

    expect(recorder.opcodes).toEqual([3, '0', '']);
  });

  it('serializes attributes from __GetAttributes', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('image');
    vi.mocked(__GetAttributes).mockReturnValue({
      src: 'pic.png',
      alt: 'A pic',
    });

    serializeElementTree(root, recorder);

    // Begin, ssrId, tag, then Attr pairs
    expect(recorder.opcodes).toContain('src');
    expect(recorder.opcodes).toContain('pic.png');
    expect(recorder.opcodes).toContain('alt');
    expect(recorder.opcodes).toContain('A pic');
  });

  it('skips null/undefined attribute values', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('view');
    vi.mocked(__GetAttributes).mockReturnValue({
      valid: 'yes',
      empty: null,
      undef: undefined,
    });

    serializeElementTree(root, recorder);

    expect(recorder.opcodes).toContain('valid');
    expect(recorder.opcodes).toContain('yes');
    expect(recorder.opcodes).not.toContain('empty');
    expect(recorder.opcodes).not.toContain('undef');
  });

  it('skips function attribute values', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('view');
    vi.mocked(__GetAttributes).mockReturnValue({ handler: () => {} });

    serializeElementTree(root, recorder);

    expect(recorder.opcodes).not.toContain('handler');
  });

  it('serializes classes as a single class attr', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('view');
    vi.mocked(__GetClasses).mockReturnValue(['bg-blue', 'p-4']);

    serializeElementTree(root, recorder);

    expect(recorder.opcodes).toContain('class');
    expect(recorder.opcodes).toContain('bg-blue p-4');
  });

  it('does not add class attr when classes are empty', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('view');
    vi.mocked(__GetClasses).mockReturnValue([]);

    serializeElementTree(root, recorder);

    expect(recorder.opcodes).not.toContain('class');
  });

  it('serializes inline styles as a style attr', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('view');
    vi.mocked(__GetInlineStyles).mockReturnValue('color:red;font-size:14px');

    serializeElementTree(root, recorder);

    expect(recorder.opcodes).toContain('style');
    expect(recorder.opcodes).toContain('color:red;font-size:14px');
  });

  it('does not add style attr when inline styles are empty', () => {
    const root = {} as ElementRef;
    vi.mocked(__GetTag).mockReturnValue('view');
    vi.mocked(__GetInlineStyles).mockReturnValue('');

    serializeElementTree(root, recorder);

    expect(recorder.opcodes).not.toContain('style');
  });

  it('recursively serializes children', () => {
    const root = {} as ElementRef;
    const child1 = {} as ElementRef;
    const child2 = {} as ElementRef;

    vi.mocked(__GetTag).mockImplementation((el) => {
      if (el === root) return 'view';
      if (el === child1) return 'text';
      return 'raw-text';
    });
    vi.mocked(__GetChildren).mockImplementation((el) => {
      if (el === root) return [child1, child2];
      return [];
    });
    vi.mocked(__GetAttributeByName).mockImplementation((el) => {
      if (el === child2) return 'leaf';
      return '';
    });

    serializeElementTree(root, recorder);

    // root marks as template, all three get __MarkPartElement
    expect(__MarkPartElement).toHaveBeenCalledTimes(3);
  });

  it('assigns sequential ssrIds across the tree', () => {
    const root = {} as ElementRef;
    const child = {} as ElementRef;

    vi.mocked(__GetTag).mockImplementation((el) => {
      if (el === root) return 'view';
      return 'text';
    });
    vi.mocked(__GetChildren).mockImplementation((el) => {
      if (el === root) return [child];
      return [];
    });

    serializeElementTree(root, recorder);

    // root gets ssrId '0', child gets ssrId '1'
    expect(__MarkPartElement).toHaveBeenCalledWith(root, '0');
    expect(__MarkPartElement).toHaveBeenCalledWith(child, '1');
  });
});
