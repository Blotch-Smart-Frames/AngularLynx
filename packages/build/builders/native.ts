import { readFileSync } from 'node:fs';
import path from 'node:path';

import type * as Native from '@blotch/angular-lynx-native' with {
  'resolution-mode': 'import',
};

export type NativeModule = typeof Native;

/**
 * Like the rsbuild plugin, the native builder is this package's own
 * dependency, resolved from here. Imported only for `--platform`, so a plain
 * bundle build or `ng serve` never loads it.
 */
export const importNative = (): Promise<NativeModule> =>
  import('@blotch/angular-lynx-native');

/** The project's package.json version, the app's default version. */
export const readPackageVersion = (projectRoot: string): string | undefined => {
  try {
    return JSON.parse(
      readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ).version;
  } catch {
    return undefined;
  }
};
