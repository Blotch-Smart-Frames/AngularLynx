import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Written next to `ng serve --platform`'s development app once it's built:
 * the hash of the generated project it was built from and where it was built
 * for, then the artifacts. A second `ng serve --platform` with the same
 * native inputs then reinstalls the app without running Xcode or Gradle,
 * which take a minute or more even with nothing to compile. The app loads
 * its bundle from the dev server, so nothing else goes into it.
 */
const STAMP = '.angular-lynx-build';

/**
 * What the development app depends on: the generated project's input hash,
 * and the device it was built for (an iPhone build is signed for that
 * phone; a simulator build is compiled for that simulator's architecture).
 */
export const devBuildKey = (projectHash: string, destination: string) =>
  `${projectHash}\n${destination}\n`;

/**
 * The artifacts the last development build in `outputDir` left, when it was
 * built for `key` and they're all still there; undefined to build again.
 */
export const reusableDevBuild = (
  outputDir: string,
  key: string,
): string[] | undefined => {
  const stamp = path.join(outputDir, STAMP);
  if (!existsSync(stamp)) return undefined;
  const contents = readFileSync(stamp, 'utf8');
  if (!contents.startsWith(key)) return undefined;
  const artifacts = contents
    .slice(key.length)
    .split('\n')
    .filter(Boolean)
    .map((artifact) => path.join(outputDir, artifact));
  return artifacts.length > 0 && artifacts.every((file) => existsSync(file))
    ? artifacts
    : undefined;
};

/**
 * Records a development build, for {@link reusableDevBuild}.
 */
export const recordDevBuild = (
  outputDir: string,
  key: string,
  artifacts: readonly string[],
): void =>
  writeFileSync(
    path.join(outputDir, STAMP),
    key +
      artifacts
        .map((artifact) => path.relative(outputDir, artifact))
        .join('\n'),
  );
