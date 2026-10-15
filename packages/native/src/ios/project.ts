import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PlatformGenerator } from '../generate.ts';
import { readPngSize } from '../png.ts';
import type { Orientation, ResolvedApp } from '../options.ts';
import { PERMISSION_MAP } from '../permissions.ts';
import { escapeXml, replaceMarker } from '../xml.ts';

const ORIENTATIONS: Record<Orientation, readonly string[]> = {
  portrait: ['UIInterfaceOrientationPortrait'],
  landscape: [
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ],
  all: [
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ],
};

/**
 * Writes the app options into the iOS template: build settings go in
 * Config/App.xcconfig (which App.xcodeproj reads), and Info.plist entries go
 * between the template's `angular-lynx:info` markers.
 */
export const iosGenerator: PlatformGenerator = {
  configure: (dir, app, projectRoot) => {
    writeFileSync(path.join(dir, 'Config/App.xcconfig'), xcconfig(app));

    const plistPath = path.join(dir, 'App/Info.plist');
    writeFileSync(
      plistPath,
      replaceMarker(
        readFileSync(plistPath, 'utf8'),
        'info',
        infoPlistEntries(app),
      ),
    );

    if (app.icon) {
      const icon = path.resolve(projectRoot, app.icon);
      const size = readPngSize(icon);
      if (size.width !== 1024 || size.height !== 1024) {
        throw new Error(
          `${app.icon} is ${size.width}×${size.height}. The app icon must be a 1024×1024 PNG.`,
        );
      }
      copyFileSync(
        icon,
        path.join(dir, 'App/Assets.xcassets/AppIcon.appiconset/AppIcon.png'),
      );
    }
  },
  bundleDir: (dir) => path.join(dir, 'LynxBundle'),
};

/**
 * xcconfig values can't be quoted; `$` and `//` would start a variable or a comment.
 */
const xcconfigValue = (value: string) =>
  value.replace(/\$/g, '$$$$').replace(/\/\//g, '/$()/');

export const xcconfig = (app: ResolvedApp): string =>
  [
    '// Written by @blotch/angular-lynx-native from the builder options in',
    '// angular.json on every build. Edits here are overwritten; change',
    '// angular.json instead (or eject).',
    `ANGULAR_LYNX_PRODUCT_NAME = ${app.productName}`,
    `ANGULAR_LYNX_DISPLAY_NAME = ${xcconfigValue(app.name)}`,
    `PRODUCT_BUNDLE_IDENTIFIER = ${app.id}`,
    `MARKETING_VERSION = ${app.version}`,
    `CURRENT_PROJECT_VERSION = ${app.buildNumber}`,
    `DEVELOPMENT_TEAM = ${app.ios.teamId ?? ''}`,
    '',
  ].join('\n');

export const infoPlistEntries = (app: ResolvedApp): string => {
  const lines: string[] = [];
  const array = (key: string, values: readonly string[]) => {
    lines.push(`<key>${key}</key>`, '<array>');
    values.forEach((value) =>
      lines.push(`\t<string>${escapeXml(value)}</string>`),
    );
    lines.push('</array>');
  };

  array('UISupportedInterfaceOrientations', ORIENTATIONS[app.orientation]);

  for (const [permission, reason] of Object.entries(app.permissions)) {
    for (const key of PERMISSION_MAP[permission as keyof typeof PERMISSION_MAP]
      .ios) {
      lines.push(`<key>${key}</key>`, `<string>${escapeXml(reason!)}</string>`);
    }
  }

  if (app.deepLinkSchemes.length > 0) {
    lines.push(
      '<key>CFBundleURLTypes</key>',
      '<array>',
      '\t<dict>',
      '\t\t<key>CFBundleURLName</key>',
      `\t\t<string>${escapeXml(app.id)}</string>`,
      '\t\t<key>CFBundleURLSchemes</key>',
      '\t\t<array>',
      ...app.deepLinkSchemes.map(
        (scheme) => `\t\t\t<string>${escapeXml(scheme)}</string>`,
      ),
      '\t\t</array>',
      '\t</dict>',
      '</array>',
    );
  }
  return lines.join('\n');
};
