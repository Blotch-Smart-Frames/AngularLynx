import { definePolyfills } from './shared.js';

// ES2025 RegExp.escape, to match a string literally in a pattern. Following
// EncodeForRegExpEscape, a leading letter or digit is escaped too, so the
// result can follow an escape like `\0` or `\c` without changing it.
const CONTROL_ESCAPES = {
  '\t': 't',
  '\n': 'n',
  '\v': 'v',
  '\f': 'f',
  '\r': 'r',
};
const hexEscape = (code, digits) =>
  (digits === 2 ? '\\x' : '\\u') + code.toString(16).padStart(digits, '0');

definePolyfills(RegExp, {
  escape(string) {
    if (typeof string !== 'string') throw new TypeError('Expected a string');
    let escaped = '';
    // By code point, so a surrogate pair stays as it is and a lone surrogate
    // is escaped.
    for (const char of string) {
      const code = char.codePointAt(0);
      if (escaped === '' && /[0-9A-Za-z]/.test(char)) {
        escaped += hexEscape(code, 2);
      } else if ('^$\\.*+?()[]{}|/'.includes(char)) {
        escaped += '\\' + char;
      } else if (char in CONTROL_ESCAPES) {
        escaped += '\\' + CONTROL_ESCAPES[char];
      } else if (
        ',-=<>#&!%:;@~\'`"'.includes(char) ||
        /[ \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/.test(
          char,
        ) ||
        (code >= 0xd800 && code <= 0xdfff)
      ) {
        escaped += code <= 0xff ? hexEscape(code, 2) : hexEscape(code, 4);
      } else {
        escaped += char;
      }
    }
    return escaped;
  },
});
