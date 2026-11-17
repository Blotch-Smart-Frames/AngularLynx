import { Platform } from 'react-native';
import AppStartupModule from './src/AppStartupModule';

export function reportInitiallyDrawn() {
  if (Platform.OS === 'ios') {
    return AppStartupModule.reportInitiallyDrawn();
  }
}

export function reportFullyDrawn() {
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    return AppStartupModule.reportFullyDrawn();
  }
}

// The mount benchmark only reads signposts, so Android has nothing to call.
export function reportMountStart() {
  if (Platform.OS === 'ios') {
    return AppStartupModule.reportMountStart();
  }
}

export function reportMountEnd() {
  if (Platform.OS === 'ios') {
    return AppStartupModule.reportMountEnd();
  }
}
