import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { embedSourceMap, takeSourceMap } from './source-map-comment.js';

const MAP = { version: 3, sources: ['app.ts'], names: [], mappings: 'AAAA' };

const comment = (map: unknown, charset = false) =>
  `//# sourceMappingURL=data:application/json;${charset ? 'charset=utf-8;' : ''}base64,${Buffer.from(
    typeof map === 'string' ? map : JSON.stringify(map),
  ).toString('base64')}`;

describe('takeSourceMap', () => {
  it('leaves code without a map comment as it is', () => {
    const code = 'export const a = 1;\n';
    expect(takeSourceMap(code, 'app.js')).toEqual({ code });
  });

  it('takes the map out of its comment, keeping the lines where they were', () => {
    const { code, map } = takeSourceMap(
      `export const a = 1;\n${comment(MAP)}\n`,
      'app.js',
    );
    expect(code).toBe('export const a = 1;\n\n');
    expect(map).toEqual(MAP);
  });

  it('reads a map with a charset, as Angular writes it', () => {
    const { map } = takeSourceMap(`a;\n${comment(MAP, true)}`, 'app.js');
    expect(map).toEqual(MAP);
  });

  it('reads a map with spaces after it, taking them out with the comment', () => {
    const { code, map } = takeSourceMap(`a;\n${comment(MAP)} \t\n`, 'app.js');
    expect(code).toBe('a;\n\n');
    expect(map).toEqual(MAP);
  });

  // The plugin appends the scope IDs and the hot update code after the map
  // Angular's compiler left (transform-module.ts).
  it('takes the last one, with the code after it', () => {
    const first = { ...MAP, sources: ['first.ts'] };
    const { code, map } = takeSourceMap(
      `a;\n${comment(first)}\n${comment(MAP)}\nApp.ɵcmp.id = 'x';\n`,
      'app.js',
    );
    expect(code).toBe(`a;\n${comment(first)}\n\nApp.ɵcmp.id = 'x';\n`);
    expect(map).toEqual(MAP);
  });

  it('takes one after code on its line', () => {
    const { code, map } = takeSourceMap(
      `export const a = 1; ${comment(MAP)}\n`,
      'app.js',
    );
    expect(code).toBe('export const a = 1; \n');
    expect(map).toEqual(MAP);
  });

  // ECMA-426 reads any spaces after the `#`, and the older `@`.
  it.each(['//#', '//# \t', '//@'])(
    'reads a comment that starts %j',
    (start) => {
      const { code, map } = takeSourceMap(
        `a;\n${comment(MAP).replace('//# ', start)}\n`,
        'app.js',
      );
      expect(code).toBe('a;\n\n');
      expect(map).toEqual(MAP);
    },
  );

  it("doesn't take one in a string", () => {
    const code = `const text = "${comment(MAP)}";\n`;
    expect(takeSourceMap(code, 'app.js')).toEqual({ code });
  });

  // Text that reads like the comment is the string's own there, so taking
  // it out would change what the code does.
  it('leaves a line of a template literal that reads like one', () => {
    const code = `const text = \`before\n${comment({})}\nafter\`;\n`;
    expect(takeSourceMap(code, 'app.js')).toEqual({ code });
  });

  it('takes the real one after such a template literal', () => {
    const literal = `const text = \`\n${comment({})}\n\`;\n`;
    const { code, map } = takeSourceMap(
      `${literal}${comment(MAP)}\n`,
      'app.js',
    );
    expect(code).toBe(`${literal}\n`);
    expect(map).toEqual(MAP);
  });

  // SWC would have ignored it too.
  it('drops a map that is not JSON, with its comment', () => {
    expect(takeSourceMap(`a;\n${comment('{not json')}\n`, 'app.js')).toEqual({
      code: 'a;\n\n',
    });
  });
});

// A library module Angular's transformer had nothing to change in keeps the
// comment it was published with, which names its map file.
describe('takeSourceMap with a map file', () => {
  let dir: string;
  const write = (file: string, contents: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), contents);
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-lynx-map-file-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads the file beside the module', () => {
    const map = { ...MAP, sources: ['../src/index.ts'] };
    write('lib/index.mjs.map', JSON.stringify(map));
    const { code, map: read } = takeSourceMap(
      'export const a = 1;\n//# sourceMappingURL=index.mjs.map\n',
      path.join(dir, 'lib/index.mjs'),
    );
    expect(code).toBe('export const a = 1;\n\n');
    // Its sources already relative to the module's folder.
    expect(read).toEqual(map);
  });

  it("makes a map's sources relative to the module, with its sourceRoot", () => {
    write(
      'lib/maps/the index.mjs.map',
      JSON.stringify({
        ...MAP,
        sourceRoot: '../../',
        sources: ['src/index.ts', 'webpack://lib/other.ts'],
      }),
    );
    const { map } = takeSourceMap(
      'a;\n//# sourceMappingURL=maps/the%20index.mjs.map',
      path.join(dir, 'lib/index.mjs'),
    );
    expect(map).toEqual({
      ...MAP,
      sources: ['../src/index.ts', 'webpack://lib/other.ts'],
    });
  });

  it('keeps a sourceRoot that is a URL', () => {
    const map = { ...MAP, sourceRoot: 'webpack://lib/' };
    write('url-root/index.mjs.map', JSON.stringify(map));
    expect(
      takeSourceMap(
        'a;\n//# sourceMappingURL=../index.mjs.map',
        path.join(dir, 'url-root/other/index.mjs'),
      ).map,
    ).toEqual(map);
  });

  it("drops the comment of a map it can't read", () => {
    write('bad/no-mappings.mjs.map', JSON.stringify({ version: 3 }));
    write('bad/null.mjs.map', 'null');
    write('bad/not-json.mjs.map', '{');
    for (const url of [
      'missing.mjs.map',
      'no-mappings.mjs.map',
      'null.mjs.map',
      'not-json.mjs.map',
      'https://example.com/index.mjs.map',
      'data:application/json,{}',
      // Not a valid escape, which decodeURIComponent() throws on.
      '%E0%A4%A.map',
    ]) {
      expect(
        takeSourceMap(
          `a;\n//# sourceMappingURL=${url}\n`,
          path.join(dir, 'bad/index.mjs'),
        ),
      ).toEqual({ code: 'a;\n\n' });
    }
  });
});

describe('embedSourceMap', () => {
  it('writes a map takeSourceMap reads back', () => {
    const embedded = embedSourceMap('export const a = 1;', MAP);
    expect(takeSourceMap(embedded, 'app.js')).toEqual({
      code: 'export const a = 1;\n',
      map: MAP,
    });
  });
});
