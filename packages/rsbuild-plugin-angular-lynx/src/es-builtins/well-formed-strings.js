import { definePolyfills, toThisString } from './shared.js';

/**
 * ES2024 well-formed Unicode strings: the index of the first surrogate that
 * isn't half of a pair, or -1.
 */
const loneSurrogateIndex = (string, from) => {
  for (let index = from; index < string.length; index++) {
    const code = string.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    if (code <= 0xdbff) {
      const next = string.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
        continue;
      }
    }
    return index;
  }
  return -1;
};

definePolyfills(String.prototype, {
  isWellFormed() {
    return loneSurrogateIndex(toThisString(this), 0) === -1;
  },
  toWellFormed() {
    const string = toThisString(this);
    let result = '';
    let start = 0;
    for (
      let index = loneSurrogateIndex(string, 0);
      index !== -1;
      index = loneSurrogateIndex(string, start)
    ) {
      result += string.slice(start, index) + '\uFFFD';
      start = index + 1;
    }
    return result + string.slice(start);
  },
});
