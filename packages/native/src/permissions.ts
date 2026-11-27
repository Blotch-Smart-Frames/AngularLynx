import type { Permission } from './options.ts';

/**
 * A manifest permission: its name alone, or with the attributes that narrow
 * it.
 */
export type AndroidPermission =
  | string
  | {
      readonly name: string;
      /**
       * The newest API level that gets the permission, for one a later
       * Android version replaced with another.
       */
      readonly maxSdkVersion?: number;
      /**
       * `|`-separated promises about how the app uses it, such as
       * `neverForLocation`.
       */
      readonly usesPermissionFlags?: string;
    };

/**
 * What each cross-platform permission becomes on each OS. iOS asks the user
 * with the app's own reason string (an Info.plist usage description); Android
 * declares manifest permissions and shows a system message instead.
 */
export const PERMISSION_MAP: Record<
  Permission,
  {
    readonly ios: readonly string[];
    readonly android: readonly AndroidPermission[];
    /**
     * Hardware the Android permission implies. Declared as not required, or
     * Google Play hides the app from devices without it (a tablet without a
     * camera, say), which a permission alone silently causes.
     */
    readonly androidFeatures?: readonly string[];
  }
> = {
  camera: {
    ios: ['NSCameraUsageDescription'],
    android: ['android.permission.CAMERA'],
    androidFeatures: ['android.hardware.camera'],
  },
  microphone: {
    ios: ['NSMicrophoneUsageDescription'],
    android: ['android.permission.RECORD_AUDIO'],
    androidFeatures: ['android.hardware.microphone'],
  },
  location: {
    ios: ['NSLocationWhenInUseUsageDescription'],
    android: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
    ],
    androidFeatures: ['android.hardware.location'],
  },
  photos: {
    ios: ['NSPhotoLibraryUsageDescription'],
    android: ['android.permission.READ_MEDIA_IMAGES'],
  },
  // Adding to the photo library only, as the share sheet's Save Image does
  // (LynxShare). Android needs no permission for it.
  savePhotos: {
    ios: ['NSPhotoLibraryAddUsageDescription'],
    android: [],
  },
  contacts: {
    ios: ['NSContactsUsageDescription'],
    android: ['android.permission.READ_CONTACTS'],
  },
  // Connecting to a device or server on the local network, such as a printer,
  // a TV or a server on the Mac during development: iOS (14 and later) asks
  // first, with this reason. Android needs no permission for it.
  localNetwork: {
    ios: ['NSLocalNetworkUsageDescription'],
    android: [],
  },
  // Bluetooth LE devices, through LynxBluetooth. iOS asks with this reason the
  // first time the app uses Bluetooth. Android 12 replaced BLUETOOTH and
  // BLUETOOTH_ADMIN with the nearby devices permissions it asks for at
  // runtime, so the old ones stop where it starts; before it, a scan also
  // needs location. neverForLocation promises the app doesn't work out where
  // the phone is from what a scan finds, so scanning needs no location from
  // Android 12, which leaves some beacons out of the results in return.
  bluetooth: {
    ios: ['NSBluetoothAlwaysUsageDescription'],
    android: [
      { name: 'android.permission.BLUETOOTH', maxSdkVersion: 30 },
      { name: 'android.permission.BLUETOOTH_ADMIN', maxSdkVersion: 30 },
      { name: 'android.permission.ACCESS_FINE_LOCATION', maxSdkVersion: 30 },
      {
        name: 'android.permission.BLUETOOTH_SCAN',
        usesPermissionFlags: 'neverForLocation',
      },
      'android.permission.BLUETOOTH_CONNECT',
    ],
    androidFeatures: ['android.hardware.bluetooth_le'],
  },
  // iOS asks for notification permission at runtime without a usage string.
  notifications: {
    ios: [],
    android: ['android.permission.POST_NOTIFICATIONS'],
  },
};
