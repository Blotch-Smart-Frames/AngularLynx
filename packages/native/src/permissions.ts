import type { Permission } from './options.ts';

/**
 * What each cross-platform permission becomes on each OS. iOS asks the user
 * with the app's own reason string (an Info.plist usage description); Android
 * declares manifest permissions and shows a system message instead.
 */
export const PERMISSION_MAP: Record<
  Permission,
  {
    readonly ios: readonly string[];
    readonly android: readonly string[];
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
  contacts: {
    ios: ['NSContactsUsageDescription'],
    android: ['android.permission.READ_CONTACTS'],
  },
  // iOS asks for notification permission at runtime without a usage string.
  notifications: {
    ios: [],
    android: ['android.permission.POST_NOTIFICATIONS'],
  },
};
