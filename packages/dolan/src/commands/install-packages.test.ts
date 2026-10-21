import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Packages from '../utils/packages.js';

vi.mock('@clack/prompts', () => ({
  log: { step: vi.fn(), warn: vi.fn() },
}));

const installPackages = vi.fn();
vi.mock('../utils/packages.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Packages>()),
  installPackages: (...args: unknown[]) => installPackages(...args),
}));

let root: string;

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'dolan-install-'));
  writeFileSync(join(root, 'package-lock.json'), '{}');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('installComponentPackages', () => {
  it('does nothing for components without packages', async () => {
    const { installComponentPackages } = await import('./install-packages');
    installComponentPackages(root, ['card']);
    expect(installPackages).not.toHaveBeenCalled();
  });

  it('does nothing when the project already depends on them', async () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { '@tanstack/charts': '^1.1.0', 'd3-shape': '^3.2.0' },
      }),
    );
    const { installComponentPackages } = await import('./install-packages');
    installComponentPackages(root, ['chart']);
    expect(installPackages).not.toHaveBeenCalled();
  });

  it('installs the missing ones', async () => {
    installPackages.mockReturnValue(true);
    const { installComponentPackages } = await import('./install-packages');
    installComponentPackages(root, ['chart', 'line-chart']);
    expect(installPackages).toHaveBeenCalledWith(root, [
      '@tanstack/charts@^1.1.0',
      'd3-shape@^3.2.0',
    ]);
    const p = await import('@clack/prompts');
    expect(p.log.warn).not.toHaveBeenCalled();
  });

  it('prints the command to run when the install fails', async () => {
    installPackages.mockReturnValue(false);
    const { installComponentPackages } = await import('./install-packages');
    installComponentPackages(root, ['chart']);
    const p = await import('@clack/prompts');
    expect(p.log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'npm install @tanstack/charts@^1.1.0 d3-shape@^3.2.0',
      ),
    );
  });
});
