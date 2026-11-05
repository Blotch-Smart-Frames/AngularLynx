import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { run } from '../process.ts';

/**
 * The prebuilt Lynx XCFrameworks the iOS shell links, with ANGLE's.
 *
 * Lynx publishes iOS only as source pods, and compiling them takes minutes and
 * needs CocoaPods (and so Ruby). scripts/build-lynx-ios-frameworks.sh compiles
 * them once per Lynx version in CI, along with ANGLE (which needs Chromium's
 * tooling, so is no easier to build on a user's Mac); the zip it produces is
 * attached to a GitHub release and pinned here by SHA-256, so every user
 * links the same binaries we tested.
 */
export const LYNX_IOS = {
  version: '4.1.0',
  /**
   * Counts rebuilds of one Lynx version whose frameworks changed (2 added
   * XElement, 3 ANGLE); BUILD in the script. It's part of the cache folder,
   * so a machine that cached an older zip downloads the new one instead of
   * linking frameworks the shell no longer matches.
   */
  build: 3,
  url: 'https://github.com/Blotch-Smart-Frames/AngularLynx/releases/download/lynx-ios-4.1.0-3/lynx-ios-4.1.0-3.zip',
  sha256: 'bc47a48227c9eebb1606ae17d23c0ff4ccc483e667a4e89b47dcb0590fdf0be1' as
    | string
    | undefined,
} as const;

/**
 * The frameworks the zip has from Lynx's pods. The frameworks build reads
 * this list, so it is the only place to change it.
 */
export const LYNX_IOS_FRAMEWORKS = [
  'Lynx',
  'LynxBase',
  'LynxServiceAPI',
  'LynxService',
  'PrimJS',
  'SDWebImage',
  'SDWebImageWebPCoder',
  'libwebp',
  'XElement',
  'ServalSVG',
  'MJRefresh',
] as const;

/**
 * ANGLE's frameworks, which the shell's `<canvas>` draws WebGL with: OpenGL
 * ES 3.0 on Metal (scripts/build-angle-ios-frameworks.sh). libEGL loads
 * libGLESv2 from the app's Frameworks folder.
 */
export const ANGLE_IOS_FRAMEWORKS = ['libEGL', 'libGLESv2'] as const;

/**
 * Every framework in the zip, which the template project (APP_PROJECT in
 * scripts/generate-ios-project.ts) links and embeds.
 */
export const IOS_FRAMEWORKS = [
  ...LYNX_IOS_FRAMEWORKS,
  ...ANGLE_IOS_FRAMEWORKS,
] as const;

/**
 * ANGLE's EGL and OpenGL ES headers, in the zip next to the frameworks: its
 * frameworks have none, and the shell's WebGL context compiles against them.
 */
export const ANGLE_IOS_HEADERS = 'ANGLE/include';

/**
 * Overrides the download with a local folder of XCFrameworks, e.g. the
 * `out/LynxFrameworks` folder build-lynx-ios-frameworks.sh writes. For testing
 * a new Lynx version before its zip is published.
 */
export const FRAMEWORKS_ENV = 'ANGULAR_LYNX_IOS_FRAMEWORKS';

const cacheRoot = () =>
  path.join(
    process.env['XDG_CACHE_HOME'] ?? path.join(os.homedir(), '.cache'),
    'angular-lynx',
    'lynx-ios',
  );

/** Returns a folder holding every XCFramework, downloading it on first use. */
export const resolveLynxFrameworks = async (
  logFile: string,
  log: (message: string) => void,
): Promise<string> => {
  const override = process.env[FRAMEWORKS_ENV];
  if (override) {
    assertComplete(override, `${FRAMEWORKS_ENV} (${override})`);
    return path.resolve(override);
  }

  const dir = path.join(cacheRoot(), `${LYNX_IOS.version}-${LYNX_IOS.build}`);
  const frameworks = path.join(dir, 'LynxFrameworks');
  if (existsSync(path.join(dir, '.complete'))) {
    return frameworks;
  }
  if (!LYNX_IOS.sha256) {
    throw new Error(
      `Prebuilt Lynx ${LYNX_IOS.version} frameworks for iOS aren't published yet. Build them with packages/native/scripts/build-lynx-ios-frameworks.sh from the AngularLynx repository, then set ${FRAMEWORKS_ENV} to the LynxFrameworks folder it creates.`,
    );
  }

  log(`Downloading Lynx ${LYNX_IOS.version} for iOS (once per Lynx version)`);
  const response = await fetch(LYNX_IOS.url);
  if (!response.ok) {
    throw new Error(
      `Downloading ${LYNX_IOS.url} failed with HTTP ${response.status}.`,
    );
  }
  const zip = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(zip).digest('hex');
  if (digest !== LYNX_IOS.sha256) {
    throw new Error(
      `${LYNX_IOS.url} has SHA-256 ${digest}, not the pinned ${LYNX_IOS.sha256}. Not using it.`,
    );
  }

  // Extract next to the final folder and rename, so an interrupted download
  // never leaves a half-extracted cache that looks complete.
  const staging = `${dir}.partial`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const zipFile = path.join(staging, 'frameworks.zip');
  writeFileSync(zipFile, zip);
  // ditto keeps the frameworks' symlinks and code signatures intact.
  await run('ditto', ['-x', '-k', zipFile, staging], {
    cwd: staging,
    logFile,
  });
  rmSync(zipFile);
  assertComplete(path.join(staging, 'LynxFrameworks'), LYNX_IOS.url);
  writeFileSync(path.join(staging, '.complete'), LYNX_IOS.sha256);
  rmSync(dir, { recursive: true, force: true });
  renameSync(staging, dir);
  return frameworks;
};

const assertComplete = (dir: string, source: string) => {
  const missing = [
    ...IOS_FRAMEWORKS.filter(
      (name) =>
        !existsSync(path.join(dir, `${name}.xcframework`, 'Info.plist')),
    ).map((name) => `${name}.xcframework`),
    // A folder from before ANGLE (build 2) has every Lynx framework but
    // these, and the shell wouldn't compile against it.
    ...(existsSync(path.join(dir, ANGLE_IOS_HEADERS, 'EGL/egl.h'))
      ? []
      : [ANGLE_IOS_HEADERS]),
  ];
  if (missing.length > 0) {
    throw new Error(`${source} is missing ${missing.join(', ')}.`);
  }
};

/** The Lynx version a frameworks folder was built from, if it says. */
export const readFrameworksVersion = (dir: string): string | undefined => {
  const versions = path.join(dir, 'VERSIONS');
  if (!existsSync(versions)) {
    return undefined;
  }
  return /^lynx=(.+)$/m.exec(readFileSync(versions, 'utf8'))?.[1];
};
