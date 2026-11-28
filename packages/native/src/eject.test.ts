import { describe, expect, it } from 'vitest';

import { ANDROID_CANVAS_SOURCES } from './android/project.ts';
import { renderEjectedProject } from './eject.ts';
import { type NativeFeatures } from './features.ts';
import { EJECT_MARKER } from './generate.ts';
import { IOS_CANVAS_SOURCES } from './ios/project.ts';
import type { NativeAppOptions } from './options.ts';

const render = (
  platform: 'ios' | 'android',
  features?: NativeFeatures,
  options: Omit<NativeAppOptions, 'appId'> = {},
) =>
  renderEjectedProject({
    platform,
    projectRoot: '/project',
    projectName: 'my-app',
    app: { appId: 'com.example.ejected', ...options },
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

  // angular.json no longer applies to an ejected project, so one ejected
  // without filePicker has no module to turn on later: it's added by hand,
  // from the template.
  it('has the file picker module only when the app sets filePicker', () => {
    for (const [platform, module] of [
      ['ios', 'App/FilePickerModule.swift'],
      ['android', `${ANDROID_SHELL_SOURCES}/FilePickerModule.kt`],
    ] as const) {
      expect(render(platform).has(module)).toBe(false);
      expect(
        render(platform, undefined, { filePicker: true }).has(module),
      ).toBe(true);
    }
  });

  // angular.json no longer applies to an ejected project, so one ejected
  // without storeReview has no module to turn on later: it's added by hand,
  // from the template.
  it('has the store review module only when the app sets storeReview', () => {
    for (const [platform, module] of [
      ['ios', 'App/StoreReviewModule.swift'],
      ['android', `${ANDROID_SHELL_SOURCES}/StoreReviewModule.kt`],
    ] as const) {
      expect(render(platform).has(module)).toBe(false);
      expect(
        render(platform, undefined, { storeReview: true }).has(module),
      ).toBe(true);
    }
  });

  it('has the calendar module only when the app sets calendar', () => {
    for (const [platform, module] of [
      ['ios', 'App/CalendarModule.swift'],
      ['android', `${ANDROID_SHELL_SOURCES}/CalendarModule.kt`],
    ] as const) {
      expect(render(platform).has(module)).toBe(false);
      expect(render(platform, undefined, { calendar: true }).has(module)).toBe(
        true,
      );
    }
  });

  it('has the share target module, and on iOS the Share Extension, only when the app sets shareTarget', () => {
    const shareTarget = { mimeTypes: ['image/*'] };
    for (const [platform, module] of [
      ['ios', 'App/ShareTargetModule.swift'],
      ['android', `${ANDROID_SHELL_SOURCES}/ShareTargetModule.kt`],
    ] as const) {
      expect(render(platform).has(module)).toBe(false);
      expect(render(platform, undefined, { shareTarget }).has(module)).toBe(
        true,
      );
    }
    expect(render('ios').has('ShareExtension/ShareViewController.swift')).toBe(
      false,
    );
    const sharing = render('ios', undefined, { shareTarget });
    expect(sharing.has('ShareExtension/ShareViewController.swift')).toBe(true);
    expect(sharing.get('App.xcodeproj/project.pbxproj')?.toString()).toContain(
      'ShareExtension.appex',
    );
  });

  // Sign in with Apple is iOS's alone: the Android shell has no module.
  it('has the Sign in with Apple module and its entitlement only when the app sets signInWithApple', () => {
    const ejected = render('ios');
    expect(ejected.has('App/AppleSignInModule.swift')).toBe(false);
    expect(ejected.has('Config/App.entitlements')).toBe(false);
    const signingIn = render('ios', undefined, { signInWithApple: true });
    expect(signingIn.has('App/AppleSignInModule.swift')).toBe(true);
    expect(signingIn.get('Config/App.entitlements')?.toString()).toContain(
      '<key>com.apple.developer.applesignin</key>',
    );
  });
});
