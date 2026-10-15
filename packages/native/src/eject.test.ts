import { describe, expect, it } from 'vitest';

import { renderEjectedProject } from './eject.ts';
import { EJECT_MARKER } from './generate.ts';

const render = (platform: 'ios' | 'android') =>
  renderEjectedProject({
    platform,
    projectRoot: '/project',
    projectName: 'my-app',
    app: { appId: 'com.example.ejected' },
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
});
