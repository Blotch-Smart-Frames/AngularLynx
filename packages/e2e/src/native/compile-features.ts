import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import type { NativeFeatures } from '@blotch/angular-lynx-native';

import { CheckError, check, step } from '../process.ts';
import {
  buildFromBundle,
  loadNativePackage,
  type Platform,
  readAngularJson,
} from './native-package.ts';

/**
 * The projects `ng build --platform` generates with code left out, which the
 * E2E app, with a fixture for every feature, never gets: no canvas at all
 * (issue #837), the build most apps get, and a canvas that draws only in 2D
 * (#847), what a chart or a signature pad gets.
 *
 * The first is also built without `permissions.biometrics` and
 * `permissions.camera`, as most apps are, which leaves the biometrics module
 * (#918) and the barcode scanner's (#917) out. The E2E app asks for both, so
 * its own build has the modules.
 */
export const VARIANTS: readonly {
  readonly name: string;
  readonly features: NativeFeatures;
  readonly biometrics: boolean;
  readonly camera: boolean;
}[] = [
  {
    name: 'no-canvas',
    features: { canvas: false, webgl: false },
    biometrics: false,
    camera: false,
  },
  {
    name: 'canvas-2d',
    features: { canvas: true, webgl: false },
    biometrics: true,
    camera: true,
  },
];

/**
 * A file of each set the builder leaves out, relative to the generated
 * project: whether it's there shows the variant really is the project an app
 * with those features gets, rather than everything compiled again (a features
 * file the builder stopped reading, for instance, gives an app everything).
 */
const PROBES: Record<
  Platform,
  { canvas: string; webgl: string; biometrics: string; camera: string }
> = {
  ios: {
    canvas: 'App/AngularLynxCanvas2DContext.m',
    webgl: 'App/AngularLynxWebGLContext.m',
    biometrics: 'App/BiometricsModule.swift',
    camera: 'App/BarcodeScannerModule.swift',
  },
  android: {
    canvas: 'app/src/main/java/dev/angularlynx/shell/Canvas2DContext.kt',
    webgl: 'app/src/main/java/dev/angularlynx/shell/WebGLContext.kt',
    biometrics: 'app/src/main/java/dev/angularlynx/shell/BiometricsModule.kt',
    camera: 'app/src/main/java/dev/angularlynx/shell/BarcodeScannerModule.kt',
  },
};

/**
 * Compiles the app's native project once per VARIANTS entry, without
 * running it, with the native builder in `nativeDir`.
 *
 * Unit tests read the generated sources, but only the compiler and the linker
 * see everything a project with code left out still names: while #852 was
 * written, the 2D-only iOS project compiled and then failed to link, since
 * the 2D context called a function defined in the WebGL context's file
 * (#853). Each variant builds from a copy of the app's dist/ whose features
 * file says what the variant uses, so the builder generates the project as it
 * would for an app that uses only that. The bundle still draws on a canvas,
 * which is why nothing runs it.
 */
export const compileFeatureVariants = async ({
  platform,
  appDir,
  nativeDir,
  artifactsDir,
}: {
  platform: Platform;
  appDir: string;
  nativeDir: string;
  artifactsDir: string;
}) => {
  mkdirSync(artifactsDir, { recursive: true });
  const logFile = path.join(artifactsDir, `${platform}-features.log`);
  writeFileSync(logFile, '');
  const log = (message: string) => {
    console.log(message);
    appendFileSync(logFile, `${message}\n`);
  };
  const native = await loadNativePackage(nativeDir);
  const root = mkdtempSync(
    path.join(tmpdir(), 'angular-lynx-e2e-native-features-'),
  );
  const failures: string[] = [];
  try {
    const appPermissions =
      (Object.values(readAngularJson(appDir).projects)[0]!.architect.build
        .options['permissions'] as Record<string, string> | undefined) ?? {};
    for (const { name, features, biometrics, camera } of VARIANTS) {
      step(`The ${platform} project with ${name}`);
      const variantDir = path.join(root, name);
      const bundleDir = path.join(variantDir, 'dist');
      // The bundle and its assets, without the binaries already built
      // beside them, which copyBundle would skip anyway.
      cpSync(path.join(appDir, 'dist'), bundleDir, {
        recursive: true,
        filter: (source) =>
          !['ios', 'android'].includes(
            path.relative(path.join(appDir, 'dist'), source),
          ),
      });
      writeFileSync(
        path.join(bundleDir, native.NATIVE_FEATURES_FILE),
        `${JSON.stringify(features, null, 2)}\n`,
      );
      // The builder reads the file the same way, so a format it no longer
      // reads fails here rather than compiling everything again unnoticed.
      const read = native.readNativeFeatures(bundleDir);
      if (JSON.stringify(read) !== JSON.stringify(features)) {
        failures.push(
          `${name}: the native builder read ${JSON.stringify(read)} from ${native.NATIVE_FEATURES_FILE}, not ${JSON.stringify(features)}.`,
        );
        continue;
      }
      try {
        const { artifacts, projectDir } = await buildFromBundle({
          native,
          platform,
          appDir,
          bundleDir,
          // A folder per variant, apart from the app's own build, so each
          // generates its own project.
          workDir: path.join(variantDir, 'work'),
          outputDir: path.join(variantDir, 'out'),
          log,
          // The app's permissions without the ones the variant leaves out.
          overrides:
            biometrics && camera
              ? {}
              : {
                  permissions: Object.fromEntries(
                    Object.entries(appPermissions).filter(
                      ([permission]) =>
                        (biometrics || permission !== 'biometrics') &&
                        (camera || permission !== 'camera'),
                    ),
                  ),
                },
        });
        const kept = { ...features, biometrics, camera };
        for (const [feature, file] of Object.entries(PROBES[platform]) as [
          keyof typeof kept,
          string,
        ][]) {
          if (existsSync(path.join(projectDir, file)) !== kept[feature]) {
            failures.push(
              `${name}: the generated project ${kept[feature] ? 'has no' : 'still has'} ${file}, so it isn't the project an app with ${JSON.stringify(kept)} gets.`,
            );
          }
        }
        check(
          artifacts.length > 0,
          `${name}: the build wrote no app to ${path.join(variantDir, 'out')}.`,
        );
        for (const artifact of artifacts) {
          log(`  ✓ ${name}: ${path.basename(artifact)}`);
        }
      } catch (error) {
        // The builder's error names its log, which is under `root`: keep
        // the build's own log with the artifacts.
        const buildLog = path.join(variantDir, 'work/logs', `${platform}.log`);
        if (existsSync(buildLog)) {
          cpSync(
            buildLog,
            path.join(artifactsDir, `${platform}-${name}-build.log`),
          );
        }
        failures.push(`${name}: ${(error as Error).message}`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  check(
    failures.length === 0,
    `The ${platform} projects with code left out failed to build:\n  - ${failures.join('\n  - ')}\nThe build logs are in ${artifactsDir}.`,
  );
  console.log(
    `✓ The ${platform} projects build with ${VARIANTS.map(({ name }) => name).join(' and ')}`,
  );
};

/**
 *   node packages/e2e/src/native/compile-features.ts --platform ios \
 *     --app <app> --native <unpacked @blotch/angular-lynx-native>
 *
 * `--app` is a built app's folder, with its bundle in dist/ (node_modules
 * isn't needed), as CI's build-app job exports it.
 */
if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string' },
      app: { type: 'string' },
      native: { type: 'string' },
      'artifacts-dir': { type: 'string' },
    },
  });
  try {
    check(
      values.platform === 'ios' || values.platform === 'android',
      '--platform must be ios or android',
    );
    check(values.app, '--app must point at the built app');
    check(
      values.native,
      '--native must point at an unpacked or installed @blotch/angular-lynx-native',
    );
    await compileFeatureVariants({
      platform: values.platform,
      appDir: path.resolve(values.app),
      nativeDir: path.resolve(values.native),
      artifactsDir: path.resolve(
        values['artifacts-dir'] ??
          path.join(import.meta.dirname, '../../artifacts'),
      ),
    });
  } catch (error) {
    console.error(
      `\n✗ ${error instanceof CheckError ? error.message : (error as Error).stack}`,
    );
    process.exit(1);
  }
}
