import { base64ToBytes, bytesToBase64 } from '../network/base64';
import { LynxTextDecoder, LynxTextEncoder } from '../network/text-codec';

// The NFC Forum's record definitions: NDEF's type name formats (TNF), and the
// well-known Text ("T") and URI ("U") records.
// cspell:words btspp btgoep tcpobex irdaobex rtsp

/**
 * One record of a tag's NDEF message, as {@link LynxNfc} reads it.
 *
 * - `text`: a well-known Text record, with its language tag (`en`, `fr-CA`).
 * - `url`: a well-known URI record: a link, a `tel:` number, a `mailto:`
 *   address. The value is the whole URI, with the record's short prefix
 *   expanded.
 * - `mime`: data of a media type, such as `application/json` or a vCard's
 *   `text/vcard`.
 * - `other`: any other record (a smart poster, an Android application
 *   record, an external type), with its raw type name format (`tnf`), type
 *   and payload, for an app that knows the format.
 */
export type NfcRecord =
  | { readonly type: 'text'; readonly value: string; readonly lang: string }
  | { readonly type: 'url'; readonly value: string }
  | {
      readonly type: 'mime';
      readonly mediaType: string;
      readonly data: Uint8Array;
    }
  | {
      readonly type: 'other';
      readonly tnf: number;
      readonly recordType: Uint8Array;
      readonly data: Uint8Array;
    };

/**
 * A record {@link LynxNfc.write} writes: an {@link NfcRecord}, where a text
 * record's language may be left out (it's then `en`).
 */
export type NfcRecordInit =
  | { readonly type: 'text'; readonly value: string; readonly lang?: string }
  | Exclude<NfcRecord, { readonly type: 'text' }>;

/**
 * A record as it crosses the module call: its type name format, and its
 * type, ID and payload as base64. The shells only build and take apart the
 * records, so both platforms read the same values the same way.
 */
export type RawNdefRecord = {
  readonly tnf: number;
  readonly type: string;
  readonly id?: string;
  readonly payload: string;
};

/** NDEF's type name formats (NFC Forum NDEF 1.0, 3.2.6). */
const TNF_EMPTY = 0;
const TNF_WELL_KNOWN = 1;
const TNF_MEDIA = 2;
const TNF_UNCHANGED = 6;

/**
 * The URI record's prefixes, by the code its first byte holds (NFC Forum URI
 * RTD 1.0, 3.2.2). A tag stores `https://` as the single byte 4.
 */
const URI_PREFIXES = [
  '',
  'http://www.',
  'https://www.',
  'http://',
  'https://',
  'tel:',
  'mailto:',
  'ftp://anonymous:anonymous@',
  'ftp://ftp.',
  'ftps://',
  'sftp://',
  'smb://',
  'nfs://',
  'ftp://',
  'dav://',
  'news:',
  'telnet://',
  'imap:',
  'rtsp://',
  'urn:',
  'pop:',
  'sip:',
  'sips:',
  'tftp:',
  'btspp://',
  'btl2cap://',
  'btgoep://',
  'tcpobex://',
  'irdaobex://',
  'file://',
  'urn:epc:id:',
  'urn:epc:tag:',
  'urn:epc:pat:',
  'urn:epc:raw:',
  'urn:epc:',
  'urn:nfc:',
] as const;

const encoder = new LynxTextEncoder();
const decoder = new LynxTextDecoder();

const ascii = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

const sameType = (bytes: Uint8Array, type: string): boolean =>
  bytes.length === type.length && ascii(bytes) === type;

/**
 * UTF-16 text, big-endian unless a byte order mark says otherwise.
 */
const decodeUtf16 = (bytes: Uint8Array): string => {
  let littleEndian = false;
  let start = 0;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    littleEndian = true;
    start = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    start = 2;
  }
  const units: number[] = [];
  for (let i = start; i + 1 < bytes.length; i += 2) {
    units.push(
      littleEndian
        ? bytes[i]! | (bytes[i + 1]! << 8)
        : (bytes[i]! << 8) | bytes[i + 1]!,
    );
  }
  return String.fromCharCode(...units);
};

/**
 * A Text record's payload: a status byte (bit 7 set for UTF-16, bits 0-5
 * the language tag's length), the language tag, then the text.
 */
const parseText = (payload: Uint8Array): NfcRecord | undefined => {
  if (payload.length === 0) return undefined;
  const status = payload[0]!;
  const langLength = status & 0x3f;
  if (1 + langLength > payload.length) return undefined;
  const lang = ascii(payload.subarray(1, 1 + langLength));
  const text = payload.subarray(1 + langLength);
  return {
    type: 'text',
    value: status & 0x80 ? decodeUtf16(text) : decoder.decode(text),
    lang,
  };
};

/**
 * A URI record's payload: the prefix's code, then the rest in UTF-8.
 */
const parseUri = (payload: Uint8Array): NfcRecord | undefined => {
  if (payload.length === 0) return undefined;
  // A code past the table is reserved: the URI is the rest as it is.
  const prefix = URI_PREFIXES[payload[0]!] ?? '';
  return { type: 'url', value: prefix + decoder.decode(payload.subarray(1)) };
};

/**
 * A record from the module, as the app reads it. A Text or URI record too
 * short to hold its own header is `other`, as an unknown record is, so a
 * damaged tag still reads.
 */
export const parseRecord = (raw: RawNdefRecord): NfcRecord => {
  const recordType = base64ToBytes(raw.type);
  const data = base64ToBytes(raw.payload);
  if (raw.tnf === TNF_WELL_KNOWN && sameType(recordType, 'T')) {
    const text = parseText(data);
    if (text) return text;
  }
  if (raw.tnf === TNF_WELL_KNOWN && sameType(recordType, 'U')) {
    const uri = parseUri(data);
    if (uri) return uri;
  }
  if (raw.tnf === TNF_MEDIA) {
    return { type: 'mime', mediaType: ascii(recordType), data };
  }
  return { type: 'other', tnf: raw.tnf, recordType, data };
};

/**
 * The longest prefix the URI starts with, as its code.
 */
const uriPrefix = (uri: string): number => {
  let best = 0;
  URI_PREFIXES.forEach((prefix, code) => {
    if (
      prefix.length > URI_PREFIXES[best]!.length &&
      uri.toLowerCase().startsWith(prefix)
    ) {
      best = code;
    }
  });
  return best;
};

const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

const raw = (
  tnf: number,
  type: Uint8Array,
  payload: Uint8Array,
): RawNdefRecord => ({
  tnf,
  type: bytesToBase64(type),
  payload: bytesToBase64(payload),
});

/**
 * A record to write, for the module. Throws a `TypeError` for one a tag
 * can't hold, before anything opens.
 */
export const encodeRecord = (record: NfcRecordInit): RawNdefRecord => {
  switch (record.type) {
    case 'text': {
      if (typeof record.value !== 'string') {
        throw new TypeError("A text record's value must be a string.");
      }
      const lang = encoder.encode(record.lang ?? 'en');
      // The status byte holds the tag's length in 6 bits, and the tag is
      // ASCII (IANA language tags are).
      if (lang.length === 0 || lang.length > 0x3f) {
        throw new TypeError(
          `A text record's language "${record.lang}" must be 1 to 63 characters.`,
        );
      }
      return raw(
        TNF_WELL_KNOWN,
        encoder.encode('T'),
        concat(Uint8Array.of(lang.length), lang, encoder.encode(record.value)),
      );
    }
    case 'url': {
      if (typeof record.value !== 'string' || !record.value) {
        throw new TypeError('A url record needs a URI.');
      }
      const code = uriPrefix(record.value);
      return raw(
        TNF_WELL_KNOWN,
        encoder.encode('U'),
        concat(
          Uint8Array.of(code),
          encoder.encode(record.value.slice(URI_PREFIXES[code]!.length)),
        ),
      );
    }
    case 'mime': {
      if (typeof record.mediaType !== 'string' || !record.mediaType) {
        throw new TypeError('A mime record needs a media type.');
      }
      if (!(record.data instanceof Uint8Array)) {
        throw new TypeError("A mime record's data must be a Uint8Array.");
      }
      return raw(TNF_MEDIA, encoder.encode(record.mediaType), record.data);
    }
    case 'other': {
      // Unchanged (6) only continues a chunked record, which a message the
      // platforms write never holds; 7 is reserved.
      if (
        !Number.isInteger(record.tnf) ||
        record.tnf < TNF_EMPTY ||
        record.tnf >= TNF_UNCHANGED
      ) {
        throw new TypeError(
          `A record's tnf must be a whole number from 0 to 5, not ${record.tnf}.`,
        );
      }
      if (
        !(record.recordType instanceof Uint8Array) ||
        !(record.data instanceof Uint8Array)
      ) {
        throw new TypeError(
          "A record's recordType and data must be Uint8Arrays.",
        );
      }
      return raw(record.tnf, record.recordType, record.data);
    }
    default:
      throw new TypeError(
        `Unknown NFC record type "${(record as { type: unknown }).type}". Use text, url, mime or other.`,
      );
  }
};
