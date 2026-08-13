import { describe, it, expect, afterEach } from 'vitest';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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

  it('returns content unchanged for extension-less file paths', () => {
    // extensionOf() returns '' when there's no dot in the path at all — that
    // empty string can never be in FORMATTABLE_EXTENSIONS, so this must
    // short-circuit before ever consulting the filesystem for an oxfmt config.
    const noExtension = join(here, 'Makefile');
    expect(formatContent(messy, noExtension)).toBe(messy);
  });

  describe('outside a workspace with a config but no oxfmt binary', () => {
    let tmpDir: string;

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns content unchanged when no oxfmt binary is discoverable', () => {
      // Config alone isn't enough — dolan also needs to find the oxfmt binary
      // by walking up from the file. Planting only `.oxfmtrc.json` in a tmpdir
      // (well outside this repo's node_modules/.bin) exercises the "config
      // found, binary not found" branch distinctly from the "no config at
      // all" case already covered above.
      tmpDir = join(tmpdir(), `dolan-format-test-${randomUUID().slice(0, 8)}`);
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(join(tmpDir, '.oxfmtrc.json'), '{}');

      const target = join(tmpDir, 'x.ts');
      expect(formatContent(messy, target)).toBe(messy);
    });
  });

  it('falls back to the original content when oxfmt fails to parse it', () => {
    // A formatter failure (e.g. invalid syntax) must never corrupt the file
    // being installed — spawnSync exits non-zero and formatContent should
    // return the original, unformatted content rather than throwing or
    // returning empty/garbage output.
    const broken = 'const x = {';
    const formatted = formatContent(broken, join(here, '__fmt_probe__.ts'));
    expect(formatted).toBe(broken);
  });
});
