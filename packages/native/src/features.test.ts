import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_NATIVE_FEATURES,
  NATIVE_FEATURES_FILE,
  readNativeFeatures,
  removeMarkedLines,
  removeTemplateFiles,
} from './features.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-features-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (text: string) =>
  writeFileSync(path.join(dir, NATIVE_FEATURES_FILE), text);

describe('readNativeFeatures', () => {
  it('reads what the build plugin wrote', () => {
    write('{ "canvas": false, "webgl": false }\n');
    expect(readNativeFeatures(dir)).toEqual({ canvas: false, webgl: false });
    write('{ "canvas": true, "webgl": false }\n');
    expect(readNativeFeatures(dir)).toEqual({ canvas: true, webgl: false });
    write('{ "canvas": true, "webgl": true }\n');
    expect(readNativeFeatures(dir)).toEqual({ canvas: true, webgl: true });
  });

  it('reads a file from a plugin before webgl: without a canvas, nothing; with one, everything', () => {
    write('{ "canvas": false }\n');
    expect(readNativeFeatures(dir)).toEqual({ canvas: false, webgl: false });
    write('{ "canvas": true }\n');
    expect(readNativeFeatures(dir)).toEqual(ALL_NATIVE_FEATURES);
  });

  it('never leaves WebGL in without the canvas it draws on', () => {
    write('{ "canvas": false, "webgl": true }\n');
    expect(readNativeFeatures(dir)).toEqual({ canvas: false, webgl: false });
  });

  it('keeps WebGL for a webgl it can’t read', () => {
    write('{ "canvas": true, "webgl": "no" }\n');
    expect(readNativeFeatures(dir)).toEqual(ALL_NATIVE_FEATURES);
  });

  it.each([
    ['the development app, which has no bundle', undefined],
    ['a bundle without the file', 'none'],
    ['a file it can’t read', '{ canvas'],
    ['a file without the feature', '{}'],
    ['a file that isn’t an object', 'null'],
  ])('gives everything to %s', (_, text) => {
    if (text !== undefined && text !== 'none') write(text);
    expect(readNativeFeatures(text === undefined ? undefined : dir)).toEqual(
      ALL_NATIVE_FEATURES,
    );
  });
});

describe('removeTemplateFiles', () => {
  it('deletes the files', () => {
    writeFileSync(path.join(dir, 'a.kt'), '');
    removeTemplateFiles(dir, ['a.kt']);
    expect(existsSync(path.join(dir, 'a.kt'))).toBe(false);
  });

  it('fails for a file the template doesn’t have, rather than keep its new name in every app', () => {
    expect(() => removeTemplateFiles(dir, ['gone.kt'])).toThrow(
      'The template has no gone.kt to leave out.',
    );
  });
});

describe('removeMarkedLines', () => {
  it('takes out every marked block with its markers', () => {
    const file = path.join(dir, 'Main.kt');
    writeFileSync(
      file,
      [
        'a()',
        '    // angular-lynx:canvas',
        '    b()',
        '    // /angular-lynx:canvas',
        'c()',
        '// angular-lynx:canvas',
        'd()',
        '// /angular-lynx:canvas',
        '',
      ].join('\n'),
    );
    removeMarkedLines(file, 'canvas');
    expect(readFileSync(file, 'utf8')).toBe('a()\nc()\n');
  });

  it.each([
    ['no block', 'a()\n'],
    ['a block that never closes', '// angular-lynx:canvas\nb()\n'],
  ])('fails for a file with %s', (_, text) => {
    const file = path.join(dir, 'Main.kt');
    writeFileSync(file, text);
    expect(() => removeMarkedLines(file, 'canvas')).toThrow(
      'has no complete // angular-lynx:canvas … // /angular-lynx:canvas block',
    );
  });
});
