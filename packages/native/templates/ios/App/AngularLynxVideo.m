#import "AngularLynxVideo.h"

#import <AVFoundation/AVFoundation.h>
#import <Lynx/LynxPropsProcessor.h>
#import <QuartzCore/QuartzCore.h>
#import <VideoToolbox/VideoToolbox.h>

static void *const kAngularLynxVideoItemContext = (void *)&kAngularLynxVideoItemContext;

#pragma mark - Frames

/// Where a frame of `size` lands through a track's `transform`. A file's
/// transform turns the frame about its top-left corner, so a turned frame
/// can land left of or above zero: only the rect's size and how far it's
/// off matter.
static CGRect displayRect(CGSize size, CGAffineTransform transform) {
  return CGRectStandardize(
      CGRectApplyAffineTransform(CGRectMake(0, 0, size.width, size.height), transform));
}

/// A frame's size as it's shown, in whole pixels.
static CGSize displaySize(CGSize size, CGAffineTransform transform) {
  CGRect rect = displayRect(size, transform);
  return CGSizeMake(round(rect.size.width), round(rect.size.height));
}

@implementation AngularLynxVideoFrames {
  NSString *_canvasId;
  /// The output on the player's item now, set on the UI thread. Guarded by
  /// self, as is the frame below.
  AVPlayerItemVideoOutput *_output;
  /// The last frame the output handed over: a paused video's output has no
  /// new one to give, and still shows this one.
  CVPixelBufferRef _frame;
  /// How the output's frames are shown: its item's video track's
  /// preferredTransform. The output hands a frame over as the file stores
  /// it, which for a portrait phone recording is landscape, turned by this
  /// transform when it's played. Loaded after the output is set; until then
  /// there's no frame to read, rather than one the wrong way round.
  CGAffineTransform _transform;
  BOOL _hasTransform;
}

- (instancetype)initWithVideoId:(NSString *)videoId {
  if ((self = [super init])) {
    _canvasId = [videoId copy];
  }
  return self;
}

- (void)dealloc {
  CVPixelBufferRelease(_frame);
}

- (NSString *)canvasId {
  return _canvasId;
}

// A video shows itself in its own view: there's nothing to attach.
- (void)attachTarget:(AngularLynxCanvasTarget *)target {
}

- (void)targetDidLayOut:(AngularLynxCanvasTarget *)target {
}

// Only an OffscreenCanvas is transferred: a video has nothing to clear.
- (void)clearForTransfer {
}

- (void)setOutput:(AVPlayerItemVideoOutput *)output {
  @synchronized(self) {
    if (output == _output) return;
    _output = output;
    // The last item's frame isn't this one's: a new source has nothing to
    // draw until its first frame, as in a browser.
    CVPixelBufferRelease(_frame);
    _frame = NULL;
    _hasTransform = NO;
  }
}

- (void)setTransform:(CGAffineTransform)transform forOutput:(AVPlayerItemVideoOutput *)output {
  @synchronized(self) {
    // Loaded for an output that's been replaced since: it's another item's.
    if (output != _output) return;
    _transform = transform;
    _hasTransform = YES;
  }
}

/// Takes over another's output and the frame it last read, for a video
/// whose id changed: a paused video's output gives its frame only once.
- (void)takeOutputAndFrameFrom:(AngularLynxVideoFrames *)other {
  AVPlayerItemVideoOutput *output;
  CVPixelBufferRef frame;
  CGAffineTransform transform;
  BOOL hasTransform;
  @synchronized(other) {
    output = other->_output;
    frame = other->_frame ? CVPixelBufferRetain(other->_frame) : NULL;
    transform = other->_transform;
    hasTransform = other->_hasTransform;
  }
  @synchronized(self) {
    _output = output;
    CVPixelBufferRelease(_frame);
    _frame = frame;
    _transform = transform;
    _hasTransform = hasTransform;
  }
}

/// The frame showing now, retained, and how it's shown, or NULL before the
/// first, or before its transform is loaded.
- (CVPixelBufferRef)copyFrameWithTransform:(CGAffineTransform *)transform CF_RETURNS_RETAINED {
  @synchronized(self) {
    if (!_hasTransform) return NULL;
    *transform = _transform;
    AVPlayerItemVideoOutput *output = _output;
    if (output) {
      // The item's time now, as the layer shows it: the output gives the
      // frame for it, or nothing when it gave that one already.
      CMTime time = [output itemTimeForHostTime:CACurrentMediaTime()];
      if ([output hasNewPixelBufferForItemTime:time]) {
        CVPixelBufferRef frame = [output copyPixelBufferForItemTime:time itemTimeForDisplay:NULL];
        if (frame) {
          CVPixelBufferRelease(_frame);
          _frame = frame;
        }
      }
    }
    return _frame ? CVPixelBufferRetain(_frame) : NULL;
  }
}

- (CGSize)frameSize {
  CGAffineTransform transform;
  CVPixelBufferRef frame = [self copyFrameWithTransform:&transform];
  if (!frame) return CGSizeZero;
  CGSize size = CGSizeMake(CVPixelBufferGetWidth(frame), CVPixelBufferGetHeight(frame));
  CVPixelBufferRelease(frame);
  // Turned, as a browser's videoWidth and videoHeight are: a portrait
  // recording stored landscape is taller than it's wide.
  return displaySize(size, transform);
}

/// The frame as RGBA, rows top to bottom, as a decoded image's, turned as
/// the player shows it. The output hands over the decoder's own format (no
/// pixel format is asked of it, so AVFoundation converts none of the frames
/// nothing reads), which VideoToolbox converts here, for the frames that
/// are read.
- (AngularLynxDecodedImage *)snapshot {
  CGAffineTransform transform;
  CVPixelBufferRef frame = [self copyFrameWithTransform:&transform];
  if (!frame) return nil;
  CGImageRef image = NULL;
  OSStatus status = VTCreateCGImageFromCVPixelBuffer(frame, NULL, &image);
  CVPixelBufferRelease(frame);
  if (status != noErr || !image) return nil;
  CGSize stored = CGSizeMake(CGImageGetWidth(image), CGImageGetHeight(image));
  CGRect shown = displayRect(stored, transform);
  CGSize shownSize = displaySize(stored, transform);
  size_t width = (size_t)shownSize.width;
  size_t height = (size_t)shownSize.height;
  if (width == 0 || height == 0) {
    CGImageRelease(image);
    return nil;
  }
  NSMutableData *pixels = [NSMutableData dataWithLength:width * height * 4];
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(
      pixels.mutableBytes, width, height, 8, width * 4, space,
      kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!context) {
    CGImageRelease(image);
    return nil;
  }
  // Drawn upright, as decodeImage draws a file: the bitmap's first row is
  // the frame's top. The track's transform is in the file's coordinates,
  // whose y runs down, so the context is flipped to match: y down from the
  // bitmap's first row. Then the transform, moved so the turned frame
  // starts at zero, then the frame drawn the right way up in those
  // coordinates (CGContextDrawImage puts an image's top at the larger y).
  CGContextSetBlendMode(context, kCGBlendModeCopy);
  CGContextTranslateCTM(context, 0, height);
  CGContextScaleCTM(context, 1, -1);
  CGContextConcatCTM(context, CGAffineTransformConcat(
                                  transform, CGAffineTransformMakeTranslation(
                                                 -shown.origin.x, -shown.origin.y)));
  CGContextTranslateCTM(context, 0, stored.height);
  CGContextScaleCTM(context, 1, -1);
  CGContextDrawImage(context, CGRectMake(0, 0, stored.width, stored.height), image);
  CGContextRelease(context);
  CGImageRelease(image);
  // A video frame is opaque, so premultiplied or not, its colors are the
  // same.
  return [[AngularLynxDecodedImage alloc] initWithPixels:pixels
                                                   width:(NSInteger)width
                                                  height:(NSInteger)height
                                           premultiplied:YES];
}

@end

#pragma mark - Element

@implementation AngularLynxVideo {
  /// The LynxView's context, kept from when the id was set: the element may
  /// have let go of its own by the time it's freed.
  __weak LynxContext *_lynxContext;
  NSString *_videoId;
  AngularLynxVideoFrames *_frames;
  /// The layer whose player's item gets the output, observed while there's
  /// an id.
  CALayer *_observedLayer;
  /// The item the output is on, and the output.
  AVPlayerItem *_item;
  AVPlayerItemVideoOutput *_output;
}

/// Runs `block` on Lynx's engine thread, where the canvas registry lives.
- (void)onEngineThread:(dispatch_block_t)block {
  [_lynxContext runOnTasmThread:block];
}

LYNX_PROP_SETTER("video-id", setVideoId, NSString *) {
  _lynxContext = self.context.lynxContext;
  NSString *videoId = requestReset || ![value isKindOfClass:NSString.class] ? nil : value;
  if (videoId == _videoId || [videoId isEqualToString:_videoId]) return;
  NSString *old = _videoId;
  AngularLynxVideoFrames *oldFrames = _frames;
  _videoId = [videoId copy];
  _frames = videoId ? [[AngularLynxVideoFrames alloc] initWithVideoId:videoId] : nil;
  AngularLynxVideoFrames *frames = _frames;
  // A new id on the same item: its frames read the output already there,
  // from the frame the old ones last read.
  if (oldFrames) {
    [frames takeOutputAndFrameFrom:oldFrames];
  } else {
    [frames setOutput:_output];
  }
  [self onEngineThread:^{
    if (old && [AngularLynxCanvasRegistry contextForCanvasId:old] == oldFrames) {
      [AngularLynxCanvasRegistry setContext:nil forCanvasId:old];
    }
    if (frames) [AngularLynxCanvasRegistry setContext:frames forCanvasId:frames.canvasId];
  }];
  [self observePlayer:videoId != nil];
  [self attachOutputTo:[self currentItem]];
}

/// How many times, a frame apart, `bindfirstframe` waits for the output's
/// first frame: half a second at most.
static const NSInteger kFirstFrameTries = 30;

/// A frame at 60 Hz, in nanoseconds: how long each try waits.
static const int64_t kFrameNanoseconds = 16666667;

/// XElement's view says it has a first frame when its layer can show one,
/// which is before the output added to the same item hands that frame over:
/// a canvas drawing the video from `bindfirstframe` read nothing, which the
/// E2E canvas flow caught. So the event waits for the output's frame, a
/// frame at a time and for half a second at most, then goes as XElement's
/// would. Android's frame is there first already (VideoUI.onFirstFrame).
- (void)playableDidLoadFirstFrame:(id<LynxVideoPlayable>)playable
                         duration:(NSTimeInterval)duration {
  [self sendFirstFrame:playable item:_item duration:duration triesLeft:kFirstFrameTries];
}

/// `item` is the one the first frame is of: a new `src` while the event
/// waits makes it stale, and the new item's player sends one of its own.
- (void)sendFirstFrame:(id<LynxVideoPlayable>)playable
                  item:(AVPlayerItem *)item
              duration:(NSTimeInterval)duration
             triesLeft:(NSInteger)triesLeft {
  if (item != _item) return;
  if (!_frames || triesLeft <= 0 || [_frames frameSize].width > 0) {
    [super playableDidLoadFirstFrame:playable duration:duration];
    return;
  }
  __weak typeof(self) weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kFrameNanoseconds),
                 dispatch_get_main_queue(), ^{
                   [weakSelf sendFirstFrame:playable
                                       item:item
                                   duration:duration
                                  triesLeft:triesLeft - 1];
                 });
}

/// Watches the player's item while the video has an id, so each item, the
/// first and each new `src`'s, gets an output. XElement's view makes its
/// player with the first source, and replaces the item on the UI thread.
- (void)observePlayer:(BOOL)observe {
  CALayer *layer = self.videoView.layer;
  if (observe && !_observedLayer && [layer isKindOfClass:AVPlayerLayer.class]) {
    [layer addObserver:self
            forKeyPath:@"player.currentItem"
               options:NSKeyValueObservingOptionNew
               context:kAngularLynxVideoItemContext];
    _observedLayer = layer;
  } else if (!observe && _observedLayer) {
    [_observedLayer removeObserver:self
                        forKeyPath:@"player.currentItem"
                           context:kAngularLynxVideoItemContext];
    _observedLayer = nil;
  }
}

- (AVPlayerItem *)currentItem {
  CALayer *layer = self.videoView.layer;
  if (![layer isKindOfClass:AVPlayerLayer.class]) return nil;
  return ((AVPlayerLayer *)layer).player.currentItem;
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary *)change
                       context:(void *)context {
  if (context != kAngularLynxVideoItemContext) {
    [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
    return;
  }
  // AVPlayer tells of a new item on the thread that replaced it, which for
  // XElement's view is the UI thread; the outputs are changed there.
  dispatch_block_t attach = ^{
    [self attachOutputTo:[self currentItem]];
  };
  if (NSThread.isMainThread) {
    attach();
  } else {
    dispatch_async(dispatch_get_main_queue(), attach);
  }
}

/// Moves the output to `item`: a new one for each item, since an output
/// belongs to one item at a time, and none without an id.
- (void)attachOutputTo:(AVPlayerItem *)item {
  if (!_videoId) item = nil;
  if (item == _item) return;
  if (_item && _output) [_item removeOutput:_output];
  _item = item;
  _output = item ? [[AVPlayerItemVideoOutput alloc] initWithPixelBufferAttributes:nil] : nil;
  if (_output) [item addOutput:_output];
  [_frames setOutput:_output];
  if (_output) [self loadTransformOf:item forOutput:_output];
}

/// Loads how `item`'s video track is shown, its preferredTransform, for the
/// frames reading `output`: a phone records portrait video landscape, with a
/// transform that turns it upright, which the output's frames don't have.
/// Loaded without blocking, as AVFoundation asks; a file whose track or
/// transform won't load is shown as stored, as the frames were before.
- (void)loadTransformOf:(AVPlayerItem *)item forOutput:(AVPlayerItemVideoOutput *)output {
  __weak typeof(self) weakSelf = self;
  void (^loaded)(CGAffineTransform) = ^(CGAffineTransform transform) {
    // Back on the UI thread, where the element's frames are replaced: a new
    // video-id while this loaded has new frames on the same output.
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) strongSelf = weakSelf;
      if (strongSelf) [strongSelf->_frames setTransform:transform forOutput:output];
    });
  };
  [item.asset
      loadTracksWithMediaType:AVMediaTypeVideo
            completionHandler:^(NSArray<AVAssetTrack *> *tracks, NSError *error) {
              AVAssetTrack *track = tracks.firstObject;
              if (!track) {
                loaded(CGAffineTransformIdentity);
                return;
              }
              [track loadValuesAsynchronouslyForKeys:@[ @"preferredTransform" ]
                                   completionHandler:^{
                                     loaded([track statusOfValueForKey:@"preferredTransform"
                                                                 error:NULL] ==
                                                    AVKeyValueStatusLoaded
                                                ? track.preferredTransform
                                                : CGAffineTransformIdentity);
                                   }];
            }];
}

- (void)dealloc {
  [self observePlayer:NO];
  if (_item && _output) [_item removeOutput:_output];
  NSString *videoId = _videoId;
  AngularLynxVideoFrames *frames = _frames;
  if (videoId) {
    [self onEngineThread:^{
      if ([AngularLynxCanvasRegistry contextForCanvasId:videoId] == frames) {
        [AngularLynxCanvasRegistry setContext:nil forCanvasId:videoId];
      }
    }];
  }
}

@end
