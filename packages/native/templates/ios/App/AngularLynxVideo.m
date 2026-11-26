#import "AngularLynxVideo.h"

#import <AVFoundation/AVFoundation.h>
#import <Lynx/LynxPropsProcessor.h>
#import <QuartzCore/QuartzCore.h>
#import <VideoToolbox/VideoToolbox.h>

static void *const kAngularLynxVideoItemContext = (void *)&kAngularLynxVideoItemContext;

#pragma mark - Frames

@implementation AngularLynxVideoFrames {
  NSString *_canvasId;
  /// The output on the player's item now, set on the UI thread. Guarded by
  /// self, as is the frame below.
  AVPlayerItemVideoOutput *_output;
  /// The last frame the output handed over: a paused video's output has no
  /// new one to give, and still shows this one.
  CVPixelBufferRef _frame;
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

- (void)setOutput:(AVPlayerItemVideoOutput *)output {
  @synchronized(self) {
    if (output == _output) return;
    _output = output;
    // The last item's frame isn't this one's: a new source has nothing to
    // draw until its first frame, as in a browser.
    CVPixelBufferRelease(_frame);
    _frame = NULL;
  }
}

/// The frame showing now, retained, or NULL before the first.
- (CVPixelBufferRef)copyFrame CF_RETURNS_RETAINED {
  @synchronized(self) {
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
  CVPixelBufferRef frame = [self copyFrame];
  if (!frame) return CGSizeZero;
  CGSize size = CGSizeMake(CVPixelBufferGetWidth(frame), CVPixelBufferGetHeight(frame));
  CVPixelBufferRelease(frame);
  return size;
}

/// The frame as RGBA, rows top to bottom, as a decoded image's. The output
/// hands over the decoder's own format (no pixel format is asked of it, so
/// AVFoundation converts none of the frames nothing reads), which
/// VideoToolbox converts here, for the frames that are read.
- (AngularLynxDecodedImage *)snapshot {
  CVPixelBufferRef frame = [self copyFrame];
  if (!frame) return nil;
  CGImageRef image = NULL;
  OSStatus status = VTCreateCGImageFromCVPixelBuffer(frame, NULL, &image);
  CVPixelBufferRelease(frame);
  if (status != noErr || !image) return nil;
  size_t width = CGImageGetWidth(image);
  size_t height = CGImageGetHeight(image);
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
  // the frame's top.
  CGContextSetBlendMode(context, kCGBlendModeCopy);
  CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
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
  [self onEngineThread:^{
    if (old && [AngularLynxCanvasRegistry contextForCanvasId:old] == oldFrames) {
      [AngularLynxCanvasRegistry setContext:nil forCanvasId:old];
    }
    if (frames) [AngularLynxCanvasRegistry setContext:frames forCanvasId:frames.canvasId];
  }];
  [self observePlayer:videoId != nil];
  [self attachOutputTo:[self currentItem]];
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
