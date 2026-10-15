import { describe, expect, it } from 'vitest';

import { LYNX_IOS_FRAMEWORKS } from '../src/ios/frameworks.ts';
import { APP_PROJECT, HOST_PROJECT } from './generate-ios-project.ts';
import { renderIosProject } from './ios-project.ts';

describe('the iOS template project', () => {
  it('compiles whatever is in App/ but not Info.plist, and copies LynxBundle as a folder', () => {
    const pbxproj = renderIosProject(APP_PROJECT)['project.pbxproj']!;
    expect(pbxproj).toMatch(
      /isa = PBXFileSystemSynchronizedRootGroup;[^}]*path = App;/,
    );
    expect(pbxproj).toMatch(/membershipExceptions = \(\s*Info\.plist,\s*\);/);
    expect(pbxproj).toMatch(/lastKnownFileType = folder; path = LynxBundle;/);
    expect(pbxproj).toContain('/* LynxBundle in Resources */');
  });

  it('builds an iPhone-only app named by the generated xcconfig', () => {
    const pbxproj = renderIosProject(APP_PROJECT)['project.pbxproj']!;
    expect(pbxproj).toContain('TARGETED_DEVICE_FAMILY = 1;');
    expect(pbxproj).not.toContain('TARGETED_DEVICE_FAMILY = "1,2"');
    expect(pbxproj).toContain('PRODUCT_NAME = "$(ANGULAR_LYNX_PRODUCT_NAME)";');
    expect(pbxproj).toMatch(
      /baseConfigurationReference = \w+ \/\* Config\/App\.xcconfig \*\//,
    );
  });

  it('links and embeds every framework the builder downloads', () => {
    const pbxproj = renderIosProject(APP_PROJECT)['project.pbxproj']!;
    for (const name of LYNX_IOS_FRAMEWORKS) {
      expect(pbxproj).toContain(
        `/* ${name}.xcframework in Frameworks */ = {isa = PBXBuildFile;`,
      );
      expect(pbxproj).toContain(
        `/* ${name}.xcframework in Embed Frameworks */ = {isa = PBXBuildFile;`,
      );
    }
  });
});

describe('renderIosProject', () => {
  it('renders the same files for the same spec', () => {
    expect(renderIosProject(HOST_PROJECT)).toEqual(
      renderIosProject(HOST_PROJECT),
    );
  });

  it('lists source files for a project without a synced folder', () => {
    const files = renderIosProject(HOST_PROJECT);
    expect(Object.keys(files).sort()).toEqual([
      'project.pbxproj',
      'project.xcworkspace/contents.xcworkspacedata',
      'xcshareddata/xcschemes/Host.xcscheme',
    ]);
    const pbxproj = files['project.pbxproj']!;
    expect(pbxproj).toContain('/* main.swift in Sources */');
    expect(pbxproj).not.toContain('PBXFileSystemSynchronizedRootGroup');
    expect(pbxproj).not.toContain('Embed Frameworks');
    expect(files['xcshareddata/xcschemes/Host.xcscheme']).toContain(
      'ReferencedContainer = "container:Host.xcodeproj"',
    );
  });
});
