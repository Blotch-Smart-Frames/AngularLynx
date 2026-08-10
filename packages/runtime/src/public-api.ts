/*
 * Public API Surface of @blotch/angular-lynx
 */

export { LynxAccessibility } from './lib/accessibility';
export { LynxAnimation } from './lib/animation/animation';
export { LynxDevTools, LynxPerformance } from './lib/devtools';
export type { DevToolsStats } from './lib/devtools';
export type {
  BaseLynxAnimation,
  LynxAnimationOptions,
} from './lib/animation/animation';
export { registerDataProcessors } from './lib/data-flow/data-processors';
export type {
  DataProcessorDefinition,
  GlobalData,
  InitData,
  InitDataRaw,
} from './lib/data-flow/data-flow.types';
export { LynxGlobalData } from './lib/data-flow/global-data';
export { LynxInitData } from './lib/data-flow/init-data';
export { LynxErrorHandler } from './lib/error-handler/lynx-error-handler';
export { LynxExposure, LynxGlobalExposure } from './lib/exposure';
export type {
  ExposureEventDetail,
  GlobalExposureEvent,
  ObserverFrameRateOptions,
} from './lib/exposure';
export { LynxFont } from './lib/font';
export { loadLazyBundle } from './lib/lazy-bundle';
export { getLynxAppLocale, LynxLocale, provideLocale } from './lib/locale';
export type {
  LynxFontEntry,
  LynxFontFaceConfig,
  LynxFontStatus,
} from './lib/font';
export {
  BaseGesture,
  ComposedGesture,
  ContinuousGesture,
  FlingGesture,
  Gesture,
  GestureStateManager,
  LongPressGesture,
  LynxGestureDetector,
  PanGesture,
  PinchGesture,
  RotationGesture,
  TapGesture,
  FlingDirection,
  GestureState,
  GestureType,
} from './lib/gesture';
export type {
  FlingGestureEvent,
  GestureCallback,
  GestureCallbackWithState,
  GestureEvent,
  LongPressGestureEvent,
  PanGestureEvent,
  PinchGestureEvent,
  RotationGestureEvent,
  TapGestureEvent,
} from './lib/gesture';
export {
  LYNX_ELEMENTS,
  LYNX_FORM_ACCESSORS,
  LynxBlock,
  LynxFor,
  LynxFrame,
  LynxIf,
  LynxImage,
  LynxInput,
  LynxInputValueAccessor,
  LynxList,
  LynxListItem,
  LynxOverlay,
  LynxRefresh,
  LynxRefreshHeader,
  LynxScrollCoordinator,
  LynxScrollCoordinatorHeader,
  LynxScrollCoordinatorSlot,
  LynxScrollCoordinatorToolbar,
  LynxScrollView,
  LynxSvg,
  LynxText,
  LynxTextarea,
  LynxTextareaValueAccessor,
  LynxView,
  LynxViewPager,
  LynxViewPagerItem,
} from './lib/lynx-elements';
export { LynxLogger } from './lib/lynx-logger';
export { LynxNativeModule } from './lib/native-module';
export { LynxPortal, PortalRef } from './lib/portal';
export type { PortalConfig } from './lib/portal';
export type { NativeModuleMap } from './lib/native-module';
export {
  mainThreadFn,
  backgroundFn,
  MainThreadRef,
  createMainThreadRef,
  MainThreadElement,
  LynxMainThreadEvent,
  LynxMainThread,
} from './lib/main-thread';
export type { MainThreadFnHandle, BackgroundFnHandle } from './lib/main-thread';
export type { MainThread } from './lib/main-thread';
export { LynxResourcePrefetch } from './lib/resource-prefetch';
export {
  LynxSafeArea,
  SAFE_AREA_INSET_BOTTOM,
  SAFE_AREA_INSET_LEFT,
  SAFE_AREA_INSET_RIGHT,
  SAFE_AREA_INSET_TOP,
} from './lib/safe-area';
export type {
  PrefetchCacheTarget,
  PrefetchPriority,
  PrefetchRequest,
  PrefetchResultDetail,
} from './lib/resource-prefetch';
export { LynxSessionStorage } from './lib/session-storage';
export type { SessionStorageSubscription } from './lib/session-storage';
export { LynxSystemInfo } from './lib/system-info';
export { LynxTextMeasure } from './lib/text-measure';
export { LynxTheme } from './lib/theme';
export { LynxTransition, LynxTransitionGroup } from './lib/transition';
export { provideRenderer } from './lib/renderer/providers';
export { LynxLocationStrategy } from './lib/router/lynx-location-strategy';
export { LynxPlatformLocation } from './lib/router/lynx-platform-location';
export { LynxRouteReuseStrategy } from './lib/router/lynx-route-reuse-strategy';
export { provideRouter } from './lib/router/lynx-router';
export { bootstrapApplication } from './lib/runtime';
import './lib/types/runtime-types';
import './lib/types/lynx';
