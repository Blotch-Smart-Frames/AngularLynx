const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const { getMainApplication } = AndroidConfig.Manifest;

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withProfileable = config => {
  return withAndroidManifest(config, config => {
    const app = getMainApplication(config.modResults);
    if (app) {
      app['profileable'] = [{ $: { 'android:shell': 'true' } }];
    }
    return config;
  });
};

module.exports = withProfileable;
