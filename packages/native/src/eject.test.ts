import { describe, expect, it } from 'vitest';

import { renderEjectedProject } from './eject.ts';
import { EJECT_MARKER } from './generate.ts';
import type { NativeAppOptions } from './options.ts';

const render = (
  platform: 'ios' | 'android',
  options: Omit<NativeAppOptions, 'appId'> = {},
) =>
  renderEjectedProject({
    platform,
    projectRoot: '/project',
    projectName: 'my-app',
    app: { appId: 'com.example.ejected', ...options },
    generatorVersion: '1.2.3',
  });

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

  // angular.json no longer applies to an ejected project, so one ejected
  // without Bluetooth gets no module to add the permission to later.
  it('has the Bluetooth module only when the app asks for Bluetooth', () => {
    for (const [platform, module] of [
      ['ios', 'App/BluetoothModule.swift'],
      ['android', 'app/src/main/java/dev/angularlynx/shell/BluetoothModule.kt'],
    ] as const) {
      expect(render(platform).has(module)).toBe(false);
      expect(
        render(platform, { permissions: { bluetooth: 'x' } }).has(module),
      ).toBe(true);
    }
  });
});
