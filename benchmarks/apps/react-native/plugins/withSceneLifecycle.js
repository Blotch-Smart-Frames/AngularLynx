// Adopts UIKit's scene life cycle in the generated iOS app, which iOS 27
// requires of apps built with its SDK (Xcode 27): without it, the app stops
// at launch in UIKit. Expo 54's template predates that, so this adds the
// scene manifest and a SceneDelegate (plugins/scene-lifecycle), and takes the
// window and React Native's start out of the AppDelegate. Expo 58's template
// does the same itself, so apps/react-native-0.88 doesn't need this.
const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');

const SCENE_DELEGATE = 'SceneDelegate.swift';

const START_IN_APP_DELEGATE = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;

const withSceneManifest = config =>
  withInfoPlist(config, config => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return config;
  });

const withoutAppDelegateWindow = config =>
  withAppDelegate(config, config => {
    const { contents } = config.modResults;
    if (!contents.includes(START_IN_APP_DELEGATE)) {
      throw new Error(
        "withSceneLifecycle: the AppDelegate doesn't start React Native the way Expo 54's template does",
      );
    }
    config.modResults.contents = contents.replace(
      START_IN_APP_DELEGATE,
      '    // SceneDelegate makes the window and starts React Native (iOS 27 needs the scene life cycle).\n',
    );
    return config;
  });

const withSceneDelegateFile = config =>
  withDangerousMod(config, [
    'ios',
    config => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
      fs.copyFileSync(
        path.join(__dirname, 'scene-lifecycle', SCENE_DELEGATE),
        path.join(config.modRequest.platformProjectRoot, projectName, SCENE_DELEGATE),
      );
      return config;
    },
  ]);

const withSceneDelegateInProject = config =>
  withXcodeProject(config, config => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    const filepath = `${projectName}/${SCENE_DELEGATE}`;
    if (!config.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: config.modResults,
      });
    }
    return config;
  });

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withSceneLifecycle = config =>
  withSceneDelegateInProject(
    withSceneDelegateFile(withoutAppDelegateWindow(withSceneManifest(config))),
  );

module.exports = withSceneLifecycle;
