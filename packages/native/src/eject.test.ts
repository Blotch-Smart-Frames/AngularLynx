import { describe, expect, it } from 'vitest';

import { ANDROID_CANVAS_SOURCES } from './android/project.ts';
import { renderEjectedProject } from './eject.ts';
import { type NativeFeatures } from './features.ts';
import { EJECT_MARKER } from './generate.ts';
import { IOS_CANVAS_SOURCES } from './ios/project.ts';

const render = (platform: 'ios' | 'android', features?: NativeFeatures) =>
  renderEjectedProject({
    platform,
    projectRoot: '/project',
    projectName: 'my-app',
    app: { appId: 'com.example.ejected' },
    generatorVersion: '1.2.3',
    ...(features && { features }),
  });

const ANDROID_SHELL_SOURCES = 'app/src/main/java/dev/angularlynx/shell';

describe('renderEjectedProject', () => {
  it('renders the configured iOS project with the eject marker', () => {
    const files = render('ios');
    expect(files.get('Config/App.xcconfig')?.toString()).toContain(
      'PRODUCT_BUNDLE_IDENTIFIER = com.example.ejected',
    );
    expect(files.has('App.xcodeproj/project.pbxproj')).toBe(true);
    expect(files.get(EJECT_MARKER)?.toString()).toContain(
      'Ejected from @blotch/angular-lynx-native 1.2.3.',
    );
    // npm never packs .gitignore, so eject writes its own.
    expect(files.get('.gitignore')?.toString()).toContain('Frameworks');
  });

  it('renders the configured Android project, binary files included', () => {
    const files = render('android');
    expect(files.get('angular-lynx.properties')?.toString()).toContain(
      'applicationId=com.example.ejected',
    );
    // A jar is a zip: it must come through byte for byte.
    expect(
      files.get('gradle/wrapper/gradle-wrapper.jar')?.subarray(0, 2).toString(),
    ).toBe('PK');
    expect(files.get('.gitignore')?.toString()).toContain('local.properties');
    expect(files.has('local.properties')).toBe(false);
  });

  it('keeps the canvas, WebGL and ANGLE by default, for the user to grow', () => {
    const ios = render('ios');
    for (const file of IOS_CANVAS_SOURCES)
      expect(ios.has(file), file).toBe(true);
    expect(ios.get('App.xcodeproj/project.pbxproj')?.toString()).toContain(
      'libEGL.xcframework',
    );
    const android = render('android');
    for (const file of ANDROID_CANVAS_SOURCES) {
      expect(android.has(`${ANDROID_SHELL_SOURCES}/${file}`), file).toBe(true);
    }
  });

  // The benchmark's ReactLynx iOS app is built from an ejected project, so
  // without this its shell carried the canvas and ANGLE that the AngularLynx
  // app's generated shell leaves out (issue #858).
  it('leaves out what `features` says the app never uses, as a generated project does', () => {
    const none = { canvas: false, webgl: false };
    const ios = render('ios', none);
    for (const file of IOS_CANVAS_SOURCES) {
      expect(ios.has(file), file).toBe(false);
    }
    const project = ios.get('App.xcodeproj/project.pbxproj')?.toString();
    expect(project).not.toMatch(/libEGL|libGLESv2/);
    expect(project).toContain('Lynx.xcframework in Embed Frameworks');
    expect(ios.has(EJECT_MARKER)).toBe(true);

    const android = render('android', none);
    for (const file of ANDROID_CANVAS_SOURCES) {
      expect(android.has(`${ANDROID_SHELL_SOURCES}/${file}`), file).toBe(false);
    }
    expect(
      android.get(`${ANDROID_SHELL_SOURCES}/MainActivity.kt`)?.toString(),
    ).not.toContain('angular-lynx:canvas');
  });
});
