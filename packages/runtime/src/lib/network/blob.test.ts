import { describe, expect, it } from 'vitest';
import {
  blobForURL,
  createObjectURL,
  dataURLForObjectURL,
  decodeDataURL,
  LynxBlob,
  revokeObjectURL,
} from './blob';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('LynxBlob', () => {
  it('joins its parts', async () => {
    const inner = new LynxBlob(['c']);
    const blob = new LynxBlob(
      [
        'a',
        new Uint8Array([98]).buffer,
        inner,
        new Uint16Array([0x6564]),
        42 as unknown as string,
      ],
      { type: 'Text/Plain' },
    );
    expect(blob.size).toBe(7);
    expect(blob.type).toBe('text/plain');
    expect(await blob.text()).toBe('abcde42');
    expect(text(await blob.bytes())).toBe('abcde42');
    expect(text(new Uint8Array(await blob.arrayBuffer()))).toBe('abcde42');
    expect(Object.prototype.toString.call(blob)).toBe('[object Blob]');
  });

  it('is empty by default, and drops a type that isn’t printable ASCII', () => {
    const blob = new LynxBlob();
    expect(blob.size).toBe(0);
    expect(new LynxBlob([], { type: 'image/✓' }).type).toBe('');
    expect(new LynxBlob([]).type).toBe('');
  });

  it('slices, counting from the end for negative positions', async () => {
    const blob = new LynxBlob(['hello world']);
    expect(await blob.slice(6).text()).toBe('world');
    expect(await blob.slice(-5, -2, 'text/x').text()).toBe('wor');
    expect(blob.slice(-50, 50).size).toBe(11);
    expect(blob.slice(0, 2, 'text/x').type).toBe('text/x');
    expect(await blob.slice().text()).toBe('hello world');
  });

  it('streams its bytes in one chunk', async () => {
    const reader = new LynxBlob(['hi']).stream().getReader();
    expect(text((await reader.read()).value!)).toBe('hi');
    expect((await reader.read()).done).toBe(true);
    const empty = new LynxBlob().stream().getReader();
    expect((await empty.read()).done).toBe(true);
  });
});

describe('object URLs', () => {
  it('name a blob until they’re revoked', () => {
    const blob = new LynxBlob(['x']);
    const url = createObjectURL(blob);
    expect(url).toMatch(/^blob:lynx\/\d+$/);
    expect(createObjectURL(blob)).not.toBe(url);
    expect(blobForURL(url)).toBe(blob);
    revokeObjectURL(url);
    expect(blobForURL(url)).toBeUndefined();
  });
});

describe('decodeDataURL', () => {
  it('reads base64 and percent-encoded data, with its type', () => {
    expect(decodeDataURL('data:image/png;base64,AQI D')).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      type: 'image/png',
    });
    const plain = decodeDataURL('data:,a%20b')!;
    expect(text(plain.bytes)).toBe('a b');
    expect(plain.type).toBe('text/plain;charset=US-ASCII');
    expect(decodeDataURL('data:;base64,AQ==')!.type).toBe(
      'text/plain;charset=US-ASCII',
    );
    expect(decodeDataURL('data:no-comma')).toBeNull();
  });
});

describe('dataURLForObjectURL', () => {
  it('holds the bytes of the blob an object URL names, with its type', () => {
    const typed = createObjectURL(new LynxBlob(['hi'], { type: 'text/x' }));
    const untyped = createObjectURL(new LynxBlob(['hi']));
    expect(dataURLForObjectURL(typed)).toBe('data:text/x;base64,aGk=');
    expect(dataURLForObjectURL(untyped)).toBe(
      'data:application/octet-stream;base64,aGk=',
    );
    revokeObjectURL(typed);
    expect(dataURLForObjectURL(typed)).toBeUndefined();
    revokeObjectURL(untyped);
  });

  it('is undefined for a URL that isn’t an object URL', () => {
    expect(dataURLForObjectURL('https://example.com/a.png')).toBeUndefined();
    expect(dataURLForObjectURL('data:text/plain,hi')).toBeUndefined();
  });
});
