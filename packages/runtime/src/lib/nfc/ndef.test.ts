import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../network/base64';
import { encodeRecord, parseRecord, type RawNdefRecord } from './ndef';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

const raw = (tnf: number, type: Uint8Array, payload: Uint8Array) => ({
  tnf,
  type: bytesToBase64(type),
  payload: bytesToBase64(payload),
});

const payloadOf = (record: RawNdefRecord) => [...base64ToBytes(record.payload)];

describe('parseRecord', () => {
  it('reads a UTF-8 text record with its language', () => {
    expect(
      parseRecord(
        raw(
          1,
          ascii('T'),
          bytes(2, ...ascii('fr'), ...new TextEncoder().encode('Café')),
        ),
      ),
    ).toEqual({ type: 'text', value: 'Café', lang: 'fr' });
  });

  it('reads a UTF-16 text record, big-endian or with a byte order mark', () => {
    expect(
      parseRecord(
        raw(1, ascii('T'), bytes(0x82, ...ascii('en'), 0, 0x48, 0, 0x69)),
      ),
    ).toEqual({ type: 'text', value: 'Hi', lang: 'en' });
    expect(
      parseRecord(
        raw(
          1,
          ascii('T'),
          bytes(0x82, ...ascii('en'), 0xff, 0xfe, 0x48, 0, 0x69, 0),
        ),
      ),
    ).toEqual({ type: 'text', value: 'Hi', lang: 'en' });
    expect(
      parseRecord(
        raw(1, ascii('T'), bytes(0x82, ...ascii('en'), 0xfe, 0xff, 0, 0x48)),
      ),
    ).toEqual({ type: 'text', value: 'H', lang: 'en' });
  });

  it("expands a URI record's prefix", () => {
    expect(
      parseRecord(raw(1, ascii('U'), bytes(4, ...ascii('example.com/a')))),
    ).toEqual({ type: 'url', value: 'https://example.com/a' });
    expect(
      parseRecord(raw(1, ascii('U'), bytes(5, ...ascii('+15550100')))),
    ).toEqual({ type: 'url', value: 'tel:+15550100' });
    // A reserved code keeps the rest as it is.
    expect(
      parseRecord(raw(1, ascii('U'), bytes(0x7f, ...ascii('x:y')))),
    ).toEqual({ type: 'url', value: 'x:y' });
  });

  it('reads a media record', () => {
    expect(parseRecord(raw(2, ascii('application/json'), ascii('{}')))).toEqual(
      { type: 'mime', mediaType: 'application/json', data: ascii('{}') },
    );
  });

  it('keeps any other record raw, as it does a damaged text or URI record', () => {
    expect(parseRecord(raw(4, ascii('example.com:t'), bytes(1, 2)))).toEqual({
      type: 'other',
      tnf: 4,
      recordType: ascii('example.com:t'),
      data: bytes(1, 2),
    });
    expect(parseRecord(raw(1, ascii('T'), bytes()))).toMatchObject({
      type: 'other',
    });
    expect(parseRecord(raw(1, ascii('T'), bytes(5, 0x65)))).toMatchObject({
      type: 'other',
    });
    expect(parseRecord(raw(1, ascii('U'), bytes()))).toMatchObject({
      type: 'other',
    });
    expect(parseRecord(raw(1, ascii('Sp'), bytes(1)))).toMatchObject({
      type: 'other',
      tnf: 1,
    });
  });
});

describe('encodeRecord', () => {
  it('writes a text record, in English unless it says', () => {
    const record = encodeRecord({ type: 'text', value: 'Hi' });
    expect(record.tnf).toBe(1);
    expect([...base64ToBytes(record.type)]).toEqual([...ascii('T')]);
    expect(payloadOf(record)).toEqual([2, ...ascii('en'), ...ascii('Hi')]);
    expect(
      payloadOf(encodeRecord({ type: 'text', value: '', lang: 'pt-BR' })),
    ).toEqual([5, ...ascii('pt-BR')]);
  });

  it("refuses a text record without a string or with a language the status byte can't hold", () => {
    expect(() =>
      encodeRecord({ type: 'text', value: 1 as unknown as string }),
    ).toThrow(TypeError);
    expect(() => encodeRecord({ type: 'text', value: 'a', lang: '' })).toThrow(
      /1 to 63/,
    );
    expect(() =>
      encodeRecord({ type: 'text', value: 'a', lang: 'x'.repeat(64) }),
    ).toThrow(/1 to 63/);
  });

  it('writes a URI record with the longest prefix it starts with', () => {
    expect(
      payloadOf(
        encodeRecord({ type: 'url', value: 'https://www.example.com' }),
      ),
    ).toEqual([2, ...ascii('example.com')]);
    expect(
      payloadOf(encodeRecord({ type: 'url', value: 'urn:epc:id:gid:1' })),
    ).toEqual([0x1e, ...ascii('gid:1')]);
    expect(payloadOf(encodeRecord({ type: 'url', value: 'geo:1,2' }))).toEqual([
      0,
      ...ascii('geo:1,2'),
    ]);
    expect(() => encodeRecord({ type: 'url', value: '' })).toThrow(TypeError);
  });

  it('reads back what it writes', () => {
    for (const record of [
      { type: 'text', value: 'Hello, 世界', lang: 'en' },
      { type: 'url', value: 'mailto:someone@example.com' },
      { type: 'mime', mediaType: 'text/vcard', data: ascii('BEGIN:VCARD') },
      { type: 'other', tnf: 4, recordType: ascii('a:b'), data: bytes(9) },
    ] as const) {
      expect(parseRecord(encodeRecord(record))).toEqual(record);
    }
  });

  it('refuses a media or raw record without its parts', () => {
    expect(() =>
      encodeRecord({ type: 'mime', mediaType: '', data: bytes() }),
    ).toThrow(TypeError);
    expect(() =>
      encodeRecord({
        type: 'mime',
        mediaType: 'a/b',
        data: [1] as unknown as Uint8Array,
      }),
    ).toThrow(TypeError);
    expect(() =>
      encodeRecord({
        type: 'other',
        tnf: 6,
        recordType: bytes(),
        data: bytes(),
      }),
    ).toThrow(/0 to 5/);
    expect(() =>
      encodeRecord({
        type: 'other',
        tnf: 4,
        recordType: 'a' as unknown as Uint8Array,
        data: bytes(),
      }),
    ).toThrow(TypeError);
    expect(() =>
      encodeRecord({ type: 'nope' } as unknown as Parameters<
        typeof encodeRecord
      >[0]),
    ).toThrow(/Unknown NFC record type/);
  });
});
