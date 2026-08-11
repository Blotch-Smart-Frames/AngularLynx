import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { formatContent } from './format';

// Resolving paths relative to this test file lets the "project uses oxfmt"
// case walk up to the monorepo root config + hoisted oxfmt binary, while the
// tmpdir case deliberately sits outside any workspace.
const here = dirname(fileURLToPath(import.meta.url));

describe('formatContent', () => {
  const messy = 'const x=1\nexport const f = ()=>{return   x}\n';

  it('returns non-formattable files unchanged (e.g. .css)', () => {
    // oxfmt is a JS/TS formatter — CSS theme files must pass through verbatim
    // even inside the repo where oxfmt is available.
    const css = 'a{color:red ;  }';
    expect(formatContent(css, join(here, 'theme.css'))).toBe(css);
  });

  it('returns content unchanged when the project does not use oxfmt', () => {
    // A path outside any workspace: no .oxfmtrc config is discoverable by
    // walking up, so dolan must leave the content untouched (this is also why
    // the temp-dir fixtures in the command tests are unaffected).
    const outside = join(tmpdir(), 'dolan-format-test', 'x.ts');
    expect(formatContent(messy, outside)).toBe(messy);
  });

  it('normalizes to the project oxfmt config when available', () => {
    // A path inside this monorepo resolves the root .oxfmtrc.json and the
    // hoisted oxfmt binary, so messy input comes back formatted per the
    // project's rules (semicolons, spacing, single quotes, …).
    const formatted = formatContent(messy, join(here, '__fmt_probe__.ts'));
    expect(formatted).not.toBe(messy);
    expect(formatted).toContain('const x = 1;');
    expect(formatted).toContain('return x;');
  });
});
