/*
 * Public API Surface of @blotch/angular-lynx
 */

export {
  LynxAccessibility,
  LynxAccessibilitySettings,
} from './lib/accessibility';
export type {
  AccessibilityTrait,
  AccessibilityTraitStates,
} from './lib/accessibility/accessibility-traits';
export { LynxAnimation } from './lib/animation/animation';
export { LynxDevTools, LynxPerformance } from './lib/devtools';
export type { DevToolsStats, LynxTraceOptions } from './lib/devtools';
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
// Called by code the build plugin adds to each component's module in a
// development build (see the file).
export { ɵhmrAccept } from './lib/hmr/hmr-accept';
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
  LynxAccessibilityTraits,
  LynxBlock,
  LynxBlurView,
  LynxCoverView,
  LynxFor,
  LynxFrame,
  LynxIf,
  LynxImage,
  LynxInlineTruncation,
  LynxInput,
  LynxInputValueAccessor,
  LynxList,
  LynxListItem,
  LynxOverlay,
  LynxRefresh,
  LynxRefreshHeader,
  LynxRouterLinkActive,
  LynxScrollCoordinator,
  LynxScrollCoordinatorHeader,
  LynxScrollCoordinatorSlot,
  LynxScrollCoordinatorSlotDrag,
  LynxScrollCoordinatorToolbar,
  LynxScrollView,
  LynxSvg,
  LynxText,
  LynxTextarea,
  LynxTextareaValueAccessor,
  LynxTitleBarView,
  LynxVideo,
  LynxView,
  LynxViewPager,
  LynxViewPagerItem,
  LynxWebView,
} from './lib/lynx-elements';
export type { BaseLynxElement } from './lib/lynx-element/types';
export { LynxLogger } from './lib/lynx-logger';
export { LynxNativeModule } from './lib/native-module';
export { LynxPortal, PortalRef } from './lib/portal';
export type { PortalConfig } from './lib/portal';
export type { NativeModuleMap, NativeModuleProxy } from './lib/native-module';
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
  ResourcePrefetchData,
  ResourcePrefetchResult,
} from './lib/resource-prefetch';
export { LynxSessionStorage } from './lib/session-storage';
export type { SessionStorageSubscription } from './lib/session-storage';
export { LynxSystemInfo } from './lib/system-info';
export { LynxTextMeasure } from './lib/text-measure';
export { DYNAMIC_COLOR_ROLES, LynxTheme } from './lib/theme';
export type {
  DynamicColorRole,
  DynamicColors,
  DynamicColorScheme,
} from './lib/theme';
export { LynxTransition, LynxTransitionGroup } from './lib/transition';
export {
  LynxWebAuthSession,
  WebAuthSessionError,
} from './lib/web-auth-session';
export type {
  WebAuthSessionErrorCode,
  WebAuthSessionOptions,
} from './lib/web-auth-session';
export { provideRenderer } from './lib/renderer/providers';
export { LynxLocationStrategy } from './lib/router/lynx-location-strategy';
export { LynxPlatformLocation } from './lib/router/lynx-platform-location';
export { LynxRouteReuseStrategy } from './lib/router/lynx-route-reuse-strategy';
export { provideRouter } from './lib/router/lynx-router';
export { bootstrapApplication, ɵstartBackgroundThread } from './lib/runtime';
import './lib/types/runtime-types';
import './lib/types/lynx';
