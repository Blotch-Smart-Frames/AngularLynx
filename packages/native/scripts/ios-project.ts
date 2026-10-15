import { createHash } from 'node:crypto';

import { build as buildPbxproj } from '@bacons/xcode/json';
import { build as buildScheme } from '@bacons/xcode/scheme';
import { build as buildWorkspace } from '@bacons/xcode/workspace';

/**
 * Describes an iOS app's Xcode project in TypeScript and renders its files
 * (`project.pbxproj`, the shared scheme and the workspace) with @bacons/xcode,
 * which knows Xcode's formats. It replaces XcodeGen, so maintainers need only
 * Node and Xcode, nothing installed separately.
 *
 * Only maintainers run this (scripts/generate-ios-project.ts). Users get the
 * committed result in the npm package and never generate a project.
 */
export type IosProjectSpec = {
  /** The project and target name: `App` for App.xcodeproj. */
  readonly name: string;
  /**
   * The folder holding the app's sources and resources (Swift files, asset
   * catalogs, Info.plist). With `synced`, Xcode picks up whatever is in it,
   * so adding a Swift file never changes the project. Otherwise, the files to
   * compile.
   */
  readonly sources:
    | { readonly synced: string; readonly excluded?: readonly string[] }
    | { readonly folder: string; readonly files: readonly string[] };
  /** Folders copied into the app as they are, keeping their layout. */
  readonly folderResources?: readonly string[];
  /** XCFrameworks under `Frameworks/`, linked and embedded. */
  readonly frameworks?: readonly string[];
  /** An xcconfig file whose settings the target builds on. */
  readonly xcconfig?: string;
  /** The target's own build settings, for both configurations. */
  readonly settings: Readonly<Record<string, string | readonly string[]>>;
  readonly deploymentTarget: string;
};

export type IosProjectFiles = {
  /** Paths inside `<name>.xcodeproj/` → contents. */
  readonly [relativePath: string]: string;
};

/** The Xcode version the generated files say they come from. */
const XCODE_VERSION = '2700';
const XCODE_VERSION_STRING = '27.0';

/**
 * Object IDs derived from what each object is, not random, so regenerating
 * an unchanged spec writes an identical project and the drift test can
 * compare files byte for byte.
 */
const idFor = (projectName: string) => (key: string) =>
  createHash('sha256')
    .update(`${projectName}/${key}`)
    .digest('hex')
    .slice(0, 24)
    .toUpperCase();

/**
 * Project-wide settings: what `File → New → Project → iOS App` sets in Xcode
 * 27, minus the ones a Swift-only app without tests never reads.
 */
const projectSettings = (
  deploymentTarget: string,
  configuration: 'Debug' | 'Release',
) => ({
  ALWAYS_SEARCH_USER_PATHS: 'NO',
  ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS: 'YES',
  CLANG_ANALYZER_NONNULL: 'YES',
  CLANG_ENABLE_MODULES: 'YES',
  CLANG_ENABLE_OBJC_ARC: 'YES',
  COPY_PHASE_STRIP: 'NO',
  ENABLE_STRICT_OBJC_MSGSEND: 'YES',
  ENABLE_USER_SCRIPT_SANDBOXING: 'YES',
  GCC_NO_COMMON_BLOCKS: 'YES',
  IPHONEOS_DEPLOYMENT_TARGET: deploymentTarget,
  LOCALIZATION_PREFERS_STRING_CATALOGS: 'YES',
  SDKROOT: 'iphoneos',
  SWIFT_VERSION: '5.0',
  ...(configuration === 'Debug'
    ? {
        DEBUG_INFORMATION_FORMAT: 'dwarf',
        ENABLE_TESTABILITY: 'YES',
        GCC_OPTIMIZATION_LEVEL: '0',
        GCC_PREPROCESSOR_DEFINITIONS: ['DEBUG=1', '$(inherited)'],
        ONLY_ACTIVE_ARCH: 'YES',
        SWIFT_ACTIVE_COMPILATION_CONDITIONS: 'DEBUG $(inherited)',
        SWIFT_OPTIMIZATION_LEVEL: '-Onone',
      }
    : {
        DEBUG_INFORMATION_FORMAT: 'dwarf-with-dsym',
        ENABLE_NS_ASSERTIONS: 'NO',
        SWIFT_COMPILATION_MODE: 'wholemodule',
        VALIDATE_PRODUCT: 'YES',
      }),
});

export const renderIosProject = (spec: IosProjectSpec): IosProjectFiles => {
  const id = idFor(spec.name);
  const objects: Record<string, Record<string, unknown>> = {};
  const add = (key: string, object: Record<string, unknown>) => {
    const uuid = id(key);
    objects[uuid] = object;
    return uuid;
  };

  const targetId = id('target');
  const synced = 'synced' in spec.sources ? spec.sources : undefined;
  const listed = 'files' in spec.sources ? spec.sources : undefined;

  // Sources: a synchronized folder, or a group listing each file.
  const sourceFiles: string[] = [];
  let sourceGroup: string;
  if (synced) {
    const exceptions = synced.excluded?.length
      ? [
          add('sources/exceptions', {
            isa: 'PBXFileSystemSynchronizedBuildFileExceptionSet',
            membershipExceptions: [...synced.excluded],
            target: targetId,
          }),
        ]
      : undefined;
    sourceGroup = add('sources', {
      isa: 'PBXFileSystemSynchronizedRootGroup',
      ...(exceptions && { exceptions }),
      path: synced.synced,
      sourceTree: '<group>',
    });
  } else {
    const children = listed!.files.map((file) => {
      const ref = add(`sources/${file}`, {
        isa: 'PBXFileReference',
        lastKnownFileType: 'sourcecode.swift',
        path: file,
        sourceTree: '<group>',
      });
      sourceFiles.push(
        add(`sources/${file}/build`, { isa: 'PBXBuildFile', fileRef: ref }),
      );
      return ref;
    });
    sourceGroup = add('sources', {
      isa: 'PBXGroup',
      children,
      path: listed!.folder,
      sourceTree: '<group>',
    });
  }

  // Folders copied verbatim ("folder references", blue in Xcode), so a
  // bundle's static/ layout survives into the app.
  const folderRefs = (spec.folderResources ?? []).map((folder) =>
    add(`folder/${folder}`, {
      isa: 'PBXFileReference',
      lastKnownFileType: 'folder',
      path: folder,
      sourceTree: '<group>',
    }),
  );
  const resourceFiles = folderRefs.map((ref, index) =>
    add(`folder/${spec.folderResources![index]}/build`, {
      isa: 'PBXBuildFile',
      fileRef: ref,
    }),
  );

  // XCFrameworks: linked, then embedded and signed into the app.
  const frameworks = spec.frameworks ?? [];
  const frameworkRefs = frameworks.map((name) =>
    add(`framework/${name}`, {
      isa: 'PBXFileReference',
      lastKnownFileType: 'wrapper.xcframework',
      path: `${name}.xcframework`,
      sourceTree: '<group>',
    }),
  );
  const linkFiles = frameworkRefs.map((ref, index) =>
    add(`framework/${frameworks[index]}/link`, {
      isa: 'PBXBuildFile',
      fileRef: ref,
    }),
  );
  const embedFiles = frameworkRefs.map((ref, index) =>
    add(`framework/${frameworks[index]}/embed`, {
      isa: 'PBXBuildFile',
      fileRef: ref,
      settings: { ATTRIBUTES: ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] },
    }),
  );

  const xcconfigRef = spec.xcconfig
    ? add('xcconfig', {
        isa: 'PBXFileReference',
        lastKnownFileType: 'text.xcconfig',
        path: spec.xcconfig,
        sourceTree: '<group>',
      })
    : undefined;

  const productRef = add('product', {
    isa: 'PBXFileReference',
    explicitFileType: 'wrapper.application',
    includeInIndex: 0,
    path: `${spec.name}.app`,
    sourceTree: 'BUILT_PRODUCTS_DIR',
  });
  const productsGroup = add('group/products', {
    isa: 'PBXGroup',
    children: [productRef],
    name: 'Products',
    sourceTree: '<group>',
  });
  const mainGroup = add('group/main', {
    isa: 'PBXGroup',
    children: [
      sourceGroup,
      ...folderRefs,
      ...(xcconfigRef ? [xcconfigRef] : []),
      ...(frameworkRefs.length > 0
        ? [
            add('group/frameworks', {
              isa: 'PBXGroup',
              children: frameworkRefs,
              path: 'Frameworks',
              sourceTree: '<group>',
            }),
          ]
        : []),
      productsGroup,
    ],
    sourceTree: '<group>',
  });

  const buildPhases = [
    add('phase/sources', {
      isa: 'PBXSourcesBuildPhase',
      buildActionMask: 2147483647,
      files: sourceFiles,
      runOnlyForDeploymentPostprocessing: 0,
    }),
    add('phase/frameworks', {
      isa: 'PBXFrameworksBuildPhase',
      buildActionMask: 2147483647,
      files: linkFiles,
      runOnlyForDeploymentPostprocessing: 0,
    }),
    add('phase/resources', {
      isa: 'PBXResourcesBuildPhase',
      buildActionMask: 2147483647,
      files: resourceFiles,
      runOnlyForDeploymentPostprocessing: 0,
    }),
    ...(embedFiles.length > 0
      ? [
          add('phase/embed', {
            isa: 'PBXCopyFilesBuildPhase',
            buildActionMask: 2147483647,
            dstPath: '',
            // 10: the app's Frameworks folder.
            dstSubfolderSpec: 10,
            files: embedFiles,
            name: 'Embed Frameworks',
            runOnlyForDeploymentPostprocessing: 0,
          }),
        ]
      : []),
  ];

  const configurationList = (
    scope: string,
    settings: (configuration: 'Debug' | 'Release') => Record<string, unknown>,
    base?: string,
  ) =>
    add(`configurations/${scope}`, {
      isa: 'XCConfigurationList',
      buildConfigurations: (['Debug', 'Release'] as const).map((name) =>
        add(`configurations/${scope}/${name}`, {
          isa: 'XCBuildConfiguration',
          ...(base && { baseConfigurationReference: base }),
          buildSettings: settings(name),
          name,
        }),
      ),
      defaultConfigurationIsVisible: 0,
      defaultConfigurationName: 'Release',
    });

  objects[targetId] = {
    isa: 'PBXNativeTarget',
    buildConfigurationList: configurationList(
      'target',
      () => ({ ...spec.settings }),
      xcconfigRef,
    ),
    buildPhases,
    buildRules: [],
    dependencies: [],
    ...(synced && { fileSystemSynchronizedGroups: [sourceGroup] }),
    name: spec.name,
    productName: spec.name,
    productReference: productRef,
    productType: 'com.apple.product-type.application',
  };

  const projectId = add('project', {
    isa: 'PBXProject',
    attributes: {
      BuildIndependentTargetsInParallel: 1,
      LastSwiftUpdateCheck: XCODE_VERSION,
      LastUpgradeCheck: XCODE_VERSION,
      TargetAttributes: {
        [targetId]: { CreatedOnToolsVersion: XCODE_VERSION_STRING },
      },
    },
    buildConfigurationList: configurationList('project', (configuration) =>
      projectSettings(spec.deploymentTarget, configuration),
    ),
    developmentRegion: 'en',
    hasScannedForEncodings: 0,
    knownRegions: ['en', 'Base'],
    mainGroup,
    minimizedProjectReferenceProxies: 1,
    preferredProjectObjectVersion: 77,
    productRefGroup: productsGroup,
    projectDirPath: '',
    projectRoot: '',
    targets: [targetId],
  });

  const buildable = {
    buildableIdentifier: 'primary',
    blueprintIdentifier: targetId,
    buildableName: `${spec.name}.app`,
    blueprintName: spec.name,
    referencedContainer: `container:${spec.name}.xcodeproj`,
  };
  const runnable = {
    runnableDebuggingMode: '0',
    buildableReference: buildable,
  };

  return {
    'project.pbxproj': buildPbxproj({
      archiveVersion: 1,
      classes: {},
      // 77: Xcode 16's format, the first with synchronized folders.
      objectVersion: 77,
      objects: objects as never,
      rootObject: projectId,
    }),
    [`xcshareddata/xcschemes/${spec.name}.xcscheme`]: buildScheme({
      lastUpgradeVersion: XCODE_VERSION,
      version: '1.7',
      buildAction: {
        parallelizeBuildables: true,
        buildImplicitDependencies: true,
        entries: [
          {
            buildForTesting: true,
            buildForRunning: true,
            buildForProfiling: true,
            buildForArchiving: true,
            buildForAnalyzing: true,
            buildableReference: buildable,
          },
        ],
      },
      testAction: {
        buildConfiguration: 'Debug',
        selectedDebuggerIdentifier: 'Xcode.DebuggerFoundation.Debugger.LLDB',
        selectedLauncherIdentifier: 'Xcode.DebuggerFoundation.Launcher.LLDB',
        shouldUseLaunchSchemeArgsEnv: true,
      },
      launchAction: {
        buildConfiguration: 'Debug',
        selectedDebuggerIdentifier: 'Xcode.DebuggerFoundation.Debugger.LLDB',
        selectedLauncherIdentifier: 'Xcode.DebuggerFoundation.Launcher.LLDB',
        launchStyle: '0',
        useCustomWorkingDirectory: false,
        ignoresPersistentStateOnLaunch: false,
        debugDocumentVersioning: true,
        debugServiceExtension: 'internal',
        allowLocationSimulation: true,
        buildableProductRunnable: runnable,
      },
      profileAction: {
        buildConfiguration: 'Release',
        shouldUseLaunchSchemeArgsEnv: true,
        savedToolIdentifier: '',
        useCustomWorkingDirectory: false,
        debugDocumentVersioning: true,
        buildableProductRunnable: runnable,
      },
      analyzeAction: { buildConfiguration: 'Debug' },
      archiveAction: {
        buildConfiguration: 'Release',
        revealArchiveInOrganizer: true,
      },
    }),
    'project.xcworkspace/contents.xcworkspacedata': buildWorkspace({
      version: '1.0',
      fileRefs: [{ location: 'self:' }],
    }),
  };
};
