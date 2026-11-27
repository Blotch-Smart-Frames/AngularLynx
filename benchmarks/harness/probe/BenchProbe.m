// The benchmark's probe: the same few marks in every app, made in UIKit rather
// than in each framework, so a tap is timed the same way whatever answers it.
// (benchmarks/SPEC.md, "Probe".)
//
// Every app compiles this file. It does nothing unless the app is launched
// with BENCH_PROBE=1 in its environment, which the harness passes
// (`xctrace record --env`), so the launch benchmarks run without it.
//
// It emits os_signpost events in the Points of Interest category, which the
// harness reads with Instruments, as it reads fully drawn:
//
// - "Touch": a touch reaching the app, in -[UIApplication sendEvent:], before
//   UIKit hands it to a view: `phase=down|up now=<s> hid=<s>`. `now` is when
//   the app got it, `hid` the touch's own timestamp (UIEvent.timestamp, when
//   the touch screen reported it). Both are CACurrentMediaTime() in whole
//   microseconds, as every time in these messages is: Instruments shows a
//   %f to four decimals, which would cut a time to a tenth of a millisecond.
// - "Commit": the end of a main run loop pass that changed a watched
//   property, after Core Animation has committed that pass's transaction, so
//   the change is on its way to the render server: `changes=<n> first=<s>
//   last=<s> commit=<s>`.
// - "Frame": the next display link tick after that commit, whose
//   `targetTimestamp` is the frame the commit can first be shown in:
//   `target=<s> commit=<s> changes=<n>`.
// - "Stall": the busy screen's moving box (the third sentinel color) stood
//   still on screen for one or more display link ticks in a row, or the
//   ticks themselves came late (the main thread was busy), then it moved
//   again: `from=<s> to=<s> ticks=<n>`, from the last tick it moved at to
//   the next. Read from its presentation layer, which is what the screen
//   shows, whether the app moves the layer each frame or Core Animation
//   does.
//
// The watched properties are the ones a benchmark screen changes, chosen so
// that no framework sets them for anything else:
//
// - a layer's background color set to one of the sentinel colors below
//   (CALayer is where UIKit, Lynx and React Native all end up setting a
//   view's background);
// - a view's accessibility label changing from one text to another (the
//   Pokédex's heart: "Add to favorites" becomes "Remove from favorites").
//
// Watching UIKit means the time includes everything each framework does
// between a touch and the native view: its threads, its handlers, its diff
// and its mounting.

#import <QuartzCore/QuartzCore.h>
#import <math.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>
#import <os/signpost.h>

static os_log_t BenchProbeLog;

// Changes seen since the last commit the probe reported, and that commit.
static NSUInteger BenchProbeChanges;
static CFTimeInterval BenchProbeFirstChange;
static CFTimeInterval BenchProbeLastChange;
static NSUInteger BenchProbePendingChanges;
static CFTimeInterval BenchProbePendingCommit;
static CADisplayLink *BenchProbeLink;

// The busy screen's moving box, and where it was at the last tick.
static __weak CALayer *BenchProbeMover;
static CADisplayLink *BenchProbeMoverLink;
static CGFloat BenchProbeMoverX = NAN;
static CFTimeInterval BenchProbeMovedAt;
static NSUInteger BenchProbeStillTicks;
static CFTimeInterval BenchProbeLastTick;

// The sentinel colors, as 8-bit sRGB: the tap screen's box and the update
// screen's rows switch between the first two; the third is the busy
// screen's moving box.
static const uint8_t BenchProbeSentinels[][3] = {
    {0xFE, 0x01, 0x02},
    {0x02, 0x01, 0xFE},
    {0x01, 0xFE, 0x02},
};

// Which sentinel the color is (an index into BenchProbeSentinels), or -1.
static int BenchProbeSentinel(CGColorRef color) {
  if (color == NULL) return -1;
  // Each framework makes its colors in its own color space (sRGB, extended
  // sRGB, the device's RGB); converting to sRGB compares them alike.
  CGColorSpaceRef srgb = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGColorRef converted =
      CGColorCreateCopyByMatchingToColorSpace(srgb, kCGRenderingIntentDefault, color, NULL);
  CGColorSpaceRelease(srgb);
  if (converted == NULL) return -1;
  int match = -1;
  if (CGColorGetNumberOfComponents(converted) == 4) {
    const CGFloat *c = CGColorGetComponents(converted);
    for (size_t i = 0; i < sizeof(BenchProbeSentinels) / sizeof(BenchProbeSentinels[0]); i++) {
      if (fabs(c[0] * 255 - BenchProbeSentinels[i][0]) < 0.6 &&
          fabs(c[1] * 255 - BenchProbeSentinels[i][1]) < 0.6 &&
          fabs(c[2] * 255 - BenchProbeSentinels[i][2]) < 0.6) {
        match = (int)i;
        break;
      }
    }
  }
  CGColorRelease(converted);
  return match;
}

@interface BenchProbeTicker : NSObject
@end

// Times go out as whole microseconds (see "Touch" above).
static unsigned long long BenchProbeMicros(CFTimeInterval seconds) {
  return (unsigned long long)llround(seconds * 1e6);
}

@implementation BenchProbeTicker
- (void)tick:(CADisplayLink *)link {
  if (BenchProbePendingChanges == 0) {
    link.paused = YES;
    return;
  }
  os_signpost_event_emit(BenchProbeLog, OS_SIGNPOST_ID_EXCLUSIVE, "Frame",
                         "target=%llu commit=%llu changes=%lu", BenchProbeMicros(link.targetTimestamp),
                         BenchProbeMicros(BenchProbePendingCommit), (unsigned long)BenchProbePendingChanges);
  BenchProbePendingChanges = 0;
}
@end

@interface BenchProbeMoverTicker : NSObject
@end

@implementation BenchProbeMoverTicker
- (void)tick:(CADisplayLink *)link {
  CALayer *layer = BenchProbeMover.presentationLayer ?: BenchProbeMover;
  if (layer == nil) return;
  // A tick that came late is frames the main thread couldn't draw at all,
  // whatever moves the box: counted as still.
  CFTimeInterval frame = link.targetTimestamp - link.timestamp;
  if (BenchProbeLastTick > 0 && frame > 0) {
    CFTimeInterval late = link.timestamp - BenchProbeLastTick;
    if (late > frame * 1.5) BenchProbeStillTicks += (NSUInteger)llround(late / frame) - 1;
  }
  BenchProbeLastTick = link.timestamp;
  // Where the box is drawn, along the line it moves on: its position and
  // its transform's translation, which is what an animation changes.
  CGFloat x = layer.position.x + layer.transform.m41;
  if (x == BenchProbeMoverX) {
    BenchProbeStillTicks++;
    return;
  }
  if (BenchProbeStillTicks > 0 && !isnan(BenchProbeMoverX)) {
    os_signpost_event_emit(BenchProbeLog, OS_SIGNPOST_ID_EXCLUSIVE, "Stall",
                           "from=%llu to=%llu ticks=%lu", BenchProbeMicros(BenchProbeMovedAt),
                           BenchProbeMicros(link.timestamp),
                           (unsigned long)BenchProbeStillTicks);
  }
  BenchProbeStillTicks = 0;
  BenchProbeMoverX = x;
  BenchProbeMovedAt = link.timestamp;
}
@end

static BenchProbeTicker *BenchProbeTickerInstance;
static BenchProbeMoverTicker *BenchProbeMoverTickerInstance;

// Starts watching the busy screen's box once a layer is given its color.
static void BenchProbeWatchMover(CALayer *layer) {
  BenchProbeMover = layer;
  if (BenchProbeMoverLink != nil) return;
  BenchProbeMoverTickerInstance = [BenchProbeMoverTicker new];
  BenchProbeMoverLink = [CADisplayLink displayLinkWithTarget:BenchProbeMoverTickerInstance
                                                    selector:@selector(tick:)];
  BenchProbeMoverLink.preferredFrameRateRange = CAFrameRateRangeMake(60, 120, 120);
  [BenchProbeMoverLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
}

// UIKit's setters run on the main thread; so does everything here.
static void BenchProbeNoteChange(void) {
  if (![NSThread isMainThread]) return;
  CFTimeInterval now = CACurrentMediaTime();
  if (BenchProbeChanges == 0) BenchProbeFirstChange = now;
  BenchProbeLastChange = now;
  BenchProbeChanges++;
}

// After Core Animation's own commit at the end of a run loop pass (its
// observer's order is 2000000), so the pass's changes are committed.
static void BenchProbeAfterCommit(CFRunLoopObserverRef observer, CFRunLoopActivity activity,
                                  void *info) {
  if (BenchProbeChanges == 0) return;
  CFTimeInterval commit = CACurrentMediaTime();
  os_signpost_event_emit(BenchProbeLog, OS_SIGNPOST_ID_EXCLUSIVE, "Commit",
                         "changes=%lu first=%llu last=%llu commit=%llu",
                         (unsigned long)BenchProbeChanges, BenchProbeMicros(BenchProbeFirstChange),
                         BenchProbeMicros(BenchProbeLastChange), BenchProbeMicros(commit));
  BenchProbePendingChanges += BenchProbeChanges;
  BenchProbePendingCommit = commit;
  BenchProbeChanges = 0;
  BenchProbeLink.paused = NO;
}

static void (*BenchProbeOriginalSetBackgroundColor)(id, SEL, CGColorRef);
static void BenchProbeSetBackgroundColor(id self, SEL _cmd, CGColorRef color) {
  BenchProbeOriginalSetBackgroundColor(self, _cmd, color);
  int sentinel = BenchProbeSentinel(color);
  if (sentinel == 2) {
    if ([NSThread isMainThread]) BenchProbeWatchMover(self);
  } else if (sentinel >= 0) {
    BenchProbeNoteChange();
  }
}

static void (*BenchProbeOriginalSetAccessibilityLabel)(id, SEL, NSString *);
static void BenchProbeSetAccessibilityLabel(id self, SEL _cmd, NSString *label) {
  NSString *before = [self accessibilityLabel];
  BenchProbeOriginalSetAccessibilityLabel(self, _cmd, label);
  if (before.length > 0 && label.length > 0 && ![before isEqualToString:label]) {
    BenchProbeNoteChange();
  }
}

static void (*BenchProbeOriginalSendEvent)(id, SEL, UIEvent *);
static void BenchProbeSendEvent(id self, SEL _cmd, UIEvent *event) {
  if (event.type == UIEventTypeTouches) {
    CFTimeInterval now = CACurrentMediaTime();
    for (UITouch *touch in event.allTouches) {
      const char *phase = touch.phase == UITouchPhaseBegan                                 ? "down"
                          : (touch.phase == UITouchPhaseEnded || touch.phase == UITouchPhaseCancelled) ? "up"
                                                                                         : NULL;
      if (phase == NULL) continue;
      os_signpost_event_emit(BenchProbeLog, OS_SIGNPOST_ID_EXCLUSIVE, "Touch",
                             "phase=%{public}s now=%llu hid=%llu", phase, BenchProbeMicros(now),
                             BenchProbeMicros(touch.timestamp));
    }
  }
  BenchProbeOriginalSendEvent(self, _cmd, event);
}

// Replaces cls's own method, adding it there first if cls only inherits it,
// so the swap doesn't reach the superclass's other subclasses.
static IMP BenchProbeSwap(Class cls, SEL selector, IMP replacement) {
  Method method = class_getInstanceMethod(cls, selector);
  if (method == NULL) return NULL;
  class_addMethod(cls, selector, method_getImplementation(method), method_getTypeEncoding(method));
  return method_setImplementation(class_getInstanceMethod(cls, selector), replacement);
}

@interface BenchProbe : NSObject
@end

@implementation BenchProbe
+ (void)load {
  const char *enabled = getenv("BENCH_PROBE");
  if (enabled == NULL || strcmp(enabled, "1") != 0) return;
  BenchProbeLog = os_log_create("com.angularlynx.bench.probe", "PointsOfInterest");

  BenchProbeOriginalSetBackgroundColor = (void *)BenchProbeSwap(
      [CALayer class], @selector(setBackgroundColor:), (IMP)BenchProbeSetBackgroundColor);
  BenchProbeOriginalSetAccessibilityLabel = (void *)BenchProbeSwap(
      [UIView class], @selector(setAccessibilityLabel:), (IMP)BenchProbeSetAccessibilityLabel);
  BenchProbeOriginalSendEvent = (void *)BenchProbeSwap(
      [UIApplication class], @selector(sendEvent:), (IMP)BenchProbeSendEvent);

  CFRunLoopObserverRef observer = CFRunLoopObserverCreate(
      NULL, kCFRunLoopBeforeWaiting | kCFRunLoopExit, true, 2000001, BenchProbeAfterCommit, NULL);
  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);

  BenchProbeTickerInstance = [BenchProbeTicker new];
  BenchProbeLink = [CADisplayLink displayLinkWithTarget:BenchProbeTickerInstance
                                               selector:@selector(tick:)];
  // As fast as the app may draw, so a frame isn't rounded up to a slower
  // tick: 120 Hz on a ProMotion iPhone for an app that opts in
  // (CADisableMinimumFrameDurationOnPhone), 60 Hz otherwise, as the app's
  // own drawing is.
  BenchProbeLink.preferredFrameRateRange = CAFrameRateRangeMake(60, 120, 120);
  BenchProbeLink.paused = YES;
  [BenchProbeLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
}
@end
