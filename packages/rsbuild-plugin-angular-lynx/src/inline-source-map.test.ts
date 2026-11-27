import { describe, expect, it } from 'vitest';
import { takeInlineSourceMap } from './inline-source-map.js';

const MAP = { version: 3, sources: ['app.ts'], names: [], mappings: 'AAAA' };

const comment = (map: unknown, charset = false) =>
  `//# sourceMappingURL=data:application/json;${charset ? 'charset=utf-8;' : ''}base64,${Buffer.from(
    typeof map === 'string' ? map : JSON.stringify(map),
  ).toString('base64')}`;

describe('takeInlineSourceMap', () => {
  it('leaves code without an inline map as it is', () => {
    const code = 'export const a = 1;\n//# sourceMappingURL=index.mjs.map\n';
    expect(takeInlineSourceMap(code, 'app.js')).toEqual({ code });
  });

  it('takes the map out of its comment, keeping the lines where they were', () => {
    const { code, map } = takeInlineSourceMap(
      `export const a = 1;\n${comment(MAP)}\n`,
      'app.js',
    );
    expect(code).toBe('export const a = 1;\n\n');
    expect(JSON.parse(map!)).toEqual(MAP);
  });

  it('reads a map with a charset, as Angular writes it', () => {
    const { map } = takeInlineSourceMap(`a;\n${comment(MAP, true)}`, 'app.js');
    expect(JSON.parse(map!)).toEqual(MAP);
  });

  it('reads a map with spaces after it, taking them out with the comment', () => {
    const { code, map } = takeInlineSourceMap(
      `a;\n${comment(MAP)} \t\n`,
      'app.js',
    );
    expect(code).toBe('a;\n\n');
    expect(JSON.parse(map!)).toEqual(MAP);
  });

  // The plugin appends the scope IDs and the hot update code after the map
  // Angular's compiler left (transform-module.ts).
  it('takes the last one, with the code after it', () => {
    const first = { ...MAP, sources: ['first.ts'] };
    const { code, map } = takeInlineSourceMap(
      `a;\n${comment(first)}\n${comment(MAP)}\nApp.ɵcmp.id = 'x';\n`,
      'app.js',
    );
    expect(code).toBe(`a;\n${comment(first)}\n\nApp.ɵcmp.id = 'x';\n`);
    expect(JSON.parse(map!)).toEqual(MAP);
  });

  it("doesn't take one that isn't at the start of a line", () => {
    const code = `const text = "${comment(MAP)}";\n`;
    expect(takeInlineSourceMap(code, 'app.js')).toEqual({ code });
  });

  // Text that reads like the comment is the string's own there, so taking
  // it out would change what the code does.
  it('leaves a line of a template literal that reads like one', () => {
    const code = `const text = \`before\n${comment({})}\nafter\`;\n`;
    expect(takeInlineSourceMap(code, 'app.js')).toEqual({ code });
  });

  it('takes the real one after such a template literal', () => {
    const literal = `const text = \`\n${comment({})}\n\`;\n`;
    const { code, map } = takeInlineSourceMap(
      `${literal}${comment(MAP)}\n`,
      'app.js',
    );
    expect(code).toBe(`${literal}\n`);
    expect(JSON.parse(map!)).toEqual(MAP);
  });

  // SWC would have ignored it too.
  it('drops a map that is not JSON, with its comment', () => {
    expect(
      takeInlineSourceMap(`a;\n${comment('{not json')}\n`, 'app.js'),
    ).toEqual({
      code: 'a;\n\n',
    });
  });
});
