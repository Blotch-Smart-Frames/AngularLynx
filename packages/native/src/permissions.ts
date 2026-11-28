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
  // Reading the photo library, on iOS only. Nothing in the shells reads it:
  // LynxImagePicker uses PHPicker and Android's Photo Picker, which need no
  // permission. Android declares nothing for it, since Google Play rejects
  // an app that declares READ_MEDIA_IMAGES without a core need for the
  // whole library (its Photo and Video Permissions policy).
  photos: {
    ios: ['NSPhotoLibraryUsageDescription'],
    android: [],
  },
  // Adding to the photo library only, as the share sheet's Save Image and
  // LynxPhotoLibrary do. The shells' photo library module is only in apps
  // that ask for this. Android 10 and later need no permission for it, and
  // LynxPhotoLibrary saves nothing before that.
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
  // Face ID, Touch ID or a fingerprint, for LynxBiometrics and the values
  // LynxSecureStorage keeps behind them. iOS shows the reason the first time
  // the app uses Face ID (Touch ID needs none), and ends nothing without it:
  // Face ID just fails. Android's USE_BIOMETRIC is granted at install. The
  // shells' biometrics module is only in apps that ask for this.
  biometrics: {
    ios: ['NSFaceIDUsageDescription'],
    android: ['android.permission.USE_BIOMETRIC'],
  },
  // iOS asks for notification permission at runtime without a usage string.
  notifications: {
    ios: [],
    android: ['android.permission.POST_NOTIFICATIONS'],
  },
};
