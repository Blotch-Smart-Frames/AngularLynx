import { describe, expect, it } from 'vitest';
import { LynxTextDecoder, LynxTextEncoder } from './text-codec';

const encode = (text: string) => new TextEncoder().encode(text);

describe('LynxTextEncoder', () => {
  it('encodes UTF-8, as the platform encoder does', () => {
    const encoder = new LynxTextEncoder();
    expect(encoder.encoding).toBe('utf-8');
    for (const text of ['', 'abc', 'é ✓', '✓ 漢字', '🙂']) {
      expect(encoder.encode(text)).toEqual(encode(text));
    }
    expect(encoder.encode()).toEqual(new Uint8Array(0));
  });

  it('encodes into a buffer, stopping before a character that would not fit', () => {
    const encoder = new LynxTextEncoder();
    const destination = new Uint8Array(4);
    expect(encoder.encodeInto('a✓b', destination)).toEqual({
      read: 2,
      written: 4,
    });
    expect(destination).toEqual(encode('a✓'));
    expect(encoder.encodeInto('🙂', new Uint8Array(3))).toEqual({
      read: 0,
      written: 0,
    });
  });
});

describe('LynxTextDecoder', () => {
  it('decodes UTF-8 from buffers and views', () => {
    const decoder = new LynxTextDecoder();
    expect(decoder.encoding).toBe('utf-8');
    expect(decoder.fatal).toBe(false);
    expect(decoder.ignoreBOM).toBe(false);
    const bytes = encode('xx✓ 漢字 🙂');
    expect(decoder.decode(bytes)).toBe('xx✓ 漢字 🙂');
    expect(decoder.decode(bytes.buffer)).toBe('xx✓ 漢字 🙂');
    expect(decoder.decode(new DataView(bytes.buffer, 2))).toBe('✓ 漢字 🙂');
    expect(decoder.decode()).toBe('');
  });

  it('decodes a body bigger than one slice', () => {
    const text = 'a✓'.repeat(10_000);
    expect(new LynxTextDecoder().decode(encode(text))).toBe(text);
  });

  it('accepts the labels of UTF-8 and rejects others with a RangeError', () => {
    expect(new LynxTextDecoder(' UTF8 ').encoding).toBe('utf-8');
    // Angular's FetchBackend catches this and falls back to new TextDecoder().
    expect(() => new LynxTextDecoder('iso-8859-1')).toThrow(RangeError);
  });

  it('replaces invalid sequences with U+FFFD, as the platform decoder does', () => {
    const decoder = new LynxTextDecoder();
    const platform = new TextDecoder();
    for (const input of [
      [0x80],
      [0xc0, 0x80],
      [0xe0, 0x80, 0x80],
      [0xed, 0xa0, 0x80],
      [0xf0, 0x80, 0x80, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xf5],
      [0xe2, 0x9c],
      [0x61, 0xe2, 0x9c, 0x62],
      [0xf0, 0x9f, 0x99],
    ]) {
      const bytes = new Uint8Array(input);
      expect(decoder.decode(bytes)).toBe(platform.decode(bytes));
    }
  });

  it('throws on invalid input when fatal', () => {
    const decoder = new LynxTextDecoder('utf-8', { fatal: true });
    expect(decoder.fatal).toBe(true);
    expect(() => decoder.decode(new Uint8Array([0xff]))).toThrow(TypeError);
  });

  it('rejects input that is not a buffer', () => {
    expect(() => new LynxTextDecoder().decode('text' as never)).toThrow(
      TypeError,
    );
  });

  it('keeps a sequence cut off at the end of a chunk for the next one when streaming', () => {
    const decoder = new LynxTextDecoder();
    const bytes = encode('a✓🙂b');
    let output = '';
    for (const byte of bytes) {
      output += decoder.decode(new Uint8Array([byte]), { stream: true });
    }
    output += decoder.decode();
    expect(output).toBe('a✓🙂b');
  });

  it('streams chunks that end on a whole character or a single byte', () => {
    const decoder = new LynxTextDecoder();
    expect(decoder.decode(encode('ab'), { stream: true })).toBe('ab');
    expect(decoder.decode(encode('✓'), { stream: true })).toBe('✓');
    expect(
      decoder.decode(new Uint8Array([0x80, 0x80, 0x80]), { stream: true }),
    ).toBe('���');
    expect(decoder.decode(new Uint8Array(0), { stream: true })).toBe('');
  });

  it('ends a stream cut off mid-character with U+FFFD', () => {
    const decoder = new LynxTextDecoder();
    expect(decoder.decode(new Uint8Array([0xe2, 0x9c]), { stream: true })).toBe(
      '',
    );
    expect(decoder.decode()).toBe('�');
  });

  it('drops a leading byte order mark unless told to keep it', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    expect(new LynxTextDecoder().decode(withBom)).toBe('a');
    expect(
      new LynxTextDecoder('utf-8', { ignoreBOM: true }).decode(withBom),
    ).toBe('﻿a');
  });

  it('drops the byte order mark only at the start of a stream', () => {
    const decoder = new LynxTextDecoder();
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    expect(decoder.decode(encode('a'), { stream: true })).toBe('a');
    expect(decoder.decode(bom, { stream: true })).toBe('﻿');
    expect(decoder.decode()).toBe('');
    // A new stream starts after a call without `stream`.
    expect(decoder.decode(bom)).toBe('');
  });
});
