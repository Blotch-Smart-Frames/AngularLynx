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
export { LynxAppState } from './lib/app-state';
export type { LynxAppStateValue } from './lib/app-state';
export { afterFrame } from './lib/animation/after-frame';
export { LynxAnimation } from './lib/animation/animation';
export { ClipboardError, LynxClipboard } from './lib/clipboard';
export type { ClipboardErrorCode } from './lib/clipboard';
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
export { LynxHaptics } from './lib/haptics';
export type { HapticImpactStyle, HapticNotificationType } from './lib/haptics';
export { reportFullyDrawn } from './lib/fully-drawn';
export {
  FILE_PICKER_MAX_BYTES,
  FilePickerError,
  LynxFilePicker,
} from './lib/file-picker';
export type {
  FilePickerErrorCode,
  FilePickerOptions,
  PickedFile,
  SaveFile,
} from './lib/file-picker';
export {
  BARCODE_FORMATS,
  BarcodeScannerError,
  LynxBarcodeScanner,
} from './lib/barcode-scanner';
export type {
  BarcodeFormat,
  BarcodeScan,
  BarcodeScannerErrorCode,
  BarcodeScanOptions,
} from './lib/barcode-scanner';
export { ImagePickerError, LynxImagePicker } from './lib/image-picker';
export type {
  ImagePickerErrorCode,
  ImagePickerOptions,
  PickedImage,
} from './lib/image-picker';
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
  PanOffset,
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
  LynxListFor,
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
export { LynxListForContext } from './lib/list-for';
export type { LynxListForOf, LynxListItemAttributes } from './lib/list-for';
export type { BaseLynxElement } from './lib/lynx-element/types';
// <canvas> and its 2D, WebGL2 and bitmaprenderer contexts, for typing a
// canvas's ElementRef.
export type { LynxImageBitmapRenderingContext } from './lib/canvas/bitmap-renderer-context';
export type { LynxCanvasRenderingContext2D } from './lib/canvas/canvas-2d-context';
export type { LynxCanvasElement } from './lib/canvas/canvas-element';
export type { LynxWebGL2RenderingContext } from './lib/canvas/webgl2-context';
// Called by the build plugin in each main-thread module that can make a
// canvas (a template's <canvas>, document.createElement('canvas'),
// OffscreenCanvas, Image and the like), so apps that never make one leave the
// canvas out of their bundle.
export { ɵenableCanvas } from './lib/canvas/enable-canvas';
// Called by the build plugin in each module that asks for a WebGL2 context,
// so apps that never draw leave the context out of their bundle.
export { ɵenableWebGL2 } from './lib/canvas/enable-webgl2';
// Called by the build plugin in each module that asks for a 2D context.
export { ɵenableCanvas2D } from './lib/canvas/enable-canvas-2d';
// Called by the build plugin in each main-thread module that names fetch,
// XMLHttpRequest, IntersectionObserver (or compiles `@defer (on viewport)`),
// TextEncoder, TextDecoder, ReadableStream or Blob, so apps that use none of
// them leave them out of their bundle.
export {
  ɵenableBlob,
  ɵenableFetch,
  ɵenableReadableStream,
  ɵenableTextDecoder,
  ɵenableTextEncoder,
  ɵenableXMLHttpRequest,
} from './lib/network/enable';
export { ɵenableIntersectionObserver } from './lib/lynx-element/intersection-observer';
export type { LynxPointerEvent } from './lib/lynx-element/pointer-events';
export type { LynxDOMRect } from './lib/lynx-element/layout';
// The type of `$event` on element events. Angular infers it in templates;
// these name it for a handler declared apart from its template.
export type {
  AccessibilityActionDetail,
  LayoutChangeDetail,
  LynxEvent,
  LynxEventTarget,
  UIAppearanceDetail,
} from './lib/types/lynx-event';
export type {
  FrameLoadDetail,
  FrameLoadMetricsDetail,
  ImageErrorDetail,
  ImageLoadDetail,
  InputDetail,
  InputSelectionDetail,
  InputValueDetail,
  ListAttachedCell,
  ListItemInfo,
  ListLayoutCompleteDetail,
  ListScrollDetail,
  ListScrollStateChangeDetail,
  ListSnapDetail,
  OverlayErrorDetail,
  OverlayTouchDetail,
  RefreshHeaderOffsetDetail,
  RefreshStartDetail,
  RefreshStateChangeDetail,
  ScrollCoordinatorOffsetDetail,
  ScrollDetail,
  TextLayoutDetail,
  TextSelectionChangeDetail,
  VideoBufferingDetail,
  VideoErrorDetail,
  VideoFirstFrameDetail,
  VideoTimeUpdateDetail,
  ViewPagerChangeDetail,
  ViewPagerOffsetChangeDetail,
  WebViewErrorDetail,
  WebViewMessageDetail,
  WebViewUrlDetail,
} from './lib/types/element-events';
export { LynxLogger } from './lib/lynx-logger';
export { LinkingError, LynxLinking } from './lib/linking';
export type {
  LinkingErrorCode,
  LynxLinkHandler,
  OpenInAppOptions,
} from './lib/linking';
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
export { LynxShare, ShareError } from './lib/share';
export type { ShareData, ShareErrorCode, ShareFile } from './lib/share';
export { LynxShareTarget } from './lib/share-target';
export type {
  ReceivedShare,
  ReceivedShareFile,
  ShareTargetHandler,
} from './lib/share-target';
export { LynxStoreReview } from './lib/store-review';
export { CalendarError, LynxCalendar } from './lib/calendar';
export type {
  CalendarErrorCode,
  CalendarEvent,
  CalendarSheetResult,
} from './lib/calendar';
export { AppleSignInError, LynxAppleSignIn } from './lib/apple-sign-in';
export type {
  AppleCredentialState,
  AppleRealUserStatus,
  AppleSignInErrorCode,
  AppleSignInFullName,
  AppleSignInOptions,
  AppleSignInResult,
  AppleSignInScope,
} from './lib/apple-sign-in';
export { LynxBackButton } from './lib/back-button';
export { BiometricsError, LynxBiometrics } from './lib/biometrics';
export type {
  BiometricsAuthenticateOptions,
  BiometricsAvailability,
  BiometricsErrorCode,
  BiometryType,
} from './lib/biometrics';
export type { LynxBackHandler } from './lib/back-button';
export { LynxShortcuts } from './lib/shortcuts';
export type { LynxShortcut, LynxShortcutHandler } from './lib/shortcuts';
export {
  LynxSplashScreen,
  provideSplashScreen,
  hideSplashScreenUnlessProvided as ɵhideSplashScreenUnlessProvided,
} from './lib/splash-screen';
export type {
  SplashScreenHide,
  SplashScreenOptions,
} from './lib/splash-screen';
export { LynxLocalStorage, LynxSecureStorage } from './lib/storage';
export type {
  SecureStorageGetOptions,
  SecureStorageSetOptions,
} from './lib/storage';
export { LynxSystemInfo } from './lib/system-info';
export type { PlatformType } from './lib/system-info';
export { LynxTextMeasure } from './lib/text-measure';
export {
  DYNAMIC_COLOR_ROLES,
  LynxTheme,
  provideColorScheme,
} from './lib/theme';
export type {
  DynamicColorRole,
  DynamicColors,
  DynamicColorScheme,
  LynxAppearance,
  LynxColorScheme,
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
export { registerHostElement } from './lib/lynx-document/host-elements';
export type { HostElementTag } from './lib/lynx-document/host-elements';
export { LynxLocationStrategy } from './lib/router/lynx-location-strategy';
export { LynxPlatformLocation } from './lib/router/lynx-platform-location';
export { LynxRouteReuseStrategy } from './lib/router/lynx-route-reuse-strategy';
export { provideDeepLinkRoute } from './lib/router/deep-links';
export type { DeepLink, DeepLinkRoute } from './lib/router/deep-links';
export { provideRouter } from './lib/router/lynx-router';
export { LynxStackOutlet } from './lib/router/stack/lynx-stack-outlet';
export { LynxStackPage } from './lib/router/stack/stack-page';
export type { StackNavigationInfo } from './lib/router/stack/stack-change';
export type { StackAnimation } from './lib/router/stack/stack-motion';
export { LynxStackChrome } from './lib/router/stack/stack-chrome';
export { LynxStackBottomBar } from './lib/router/stack/stack-bottom-bar';
export { LynxTabOutlet } from './lib/router/tabs/lynx-tab-outlet';
export { LynxTabPage } from './lib/router/tabs/tab-page';
export type {
  StackBarMotion,
  StackBottomBar,
  StackBottomBarDefault,
} from './lib/router/stack/stack-chrome';
export { bootstrapApplication, ɵstartBackgroundThread } from './lib/runtime';
import './lib/types/runtime-types';
import './lib/types/lynx';
