#import "AngularLynxWebGL.h"

#import <ImageIO/ImageIO.h>
#import <Lynx/LynxPropsProcessor.h>
#import <QuartzCore/QuartzCore.h>

#pragma mark - Registry

@implementation AngularLynxCanvasRegistry

// Weak both ways: the target belongs to its view, the context to the module.
static NSMapTable<NSString *, AngularLynxCanvasTarget *> *targets(void) {
  static NSMapTable *table;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    table = [NSMapTable strongToWeakObjectsMapTable];
  });
  return table;
}

static NSMapTable<NSString *, id<AngularLynxCanvasContext>> *contexts(void) {
  static NSMapTable *table;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    table = [NSMapTable strongToWeakObjectsMapTable];
  });
  return table;
}

+ (void)setTarget:(AngularLynxCanvasTarget *)target forCanvasId:(NSString *)canvasId {
  if (target) {
    [targets() setObject:target forKey:canvasId];
  } else {
    [targets() removeObjectForKey:canvasId];
  }
  [[contexts() objectForKey:canvasId] attachTarget:target];
}

+ (AngularLynxCanvasTarget *)targetForCanvasId:(NSString *)canvasId {
  return [targets() objectForKey:canvasId];
}

+ (void)setContext:(id<AngularLynxCanvasContext>)context forCanvasId:(NSString *)canvasId {
  if (context) {
    [contexts() setObject:context forKey:canvasId];
    [context attachTarget:[targets() objectForKey:canvasId]];
  } else {
    [contexts() removeObjectForKey:canvasId];
  }
}

+ (id<AngularLynxCanvasContext>)contextForCanvasId:(NSString *)canvasId {
  return [contexts() objectForKey:canvasId];
}

@end

#pragma mark - Decoded images

@implementation AngularLynxDecodedImage

static NSMutableDictionary<NSNumber *, AngularLynxDecodedImage *> *decodedImages(void) {
  static NSMutableDictionary *images;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    images = [NSMutableDictionary dictionary];
  });
  return images;
}

- (instancetype)initWithPixels:(NSData *)pixels
                         width:(NSInteger)width
                        height:(NSInteger)height
                 premultiplied:(BOOL)premultiplied {
  if ((self = [super init])) {
    _pixels = pixels;
    _width = width;
    _height = height;
    _premultiplied = premultiplied;
  }
  return self;
}

+ (AngularLynxDecodedImage *)imageWithId:(NSInteger)imageId {
  return decodedImages()[@(imageId)];
}

@end

/// The bytes the runtime sends as 32-bit words, with the byte count last (see
/// toWords in webgl-bridge.ts). Every iOS device is little-endian, so the
/// words land in memory as the bytes were.
NSData *AngularLynxBytesFromWords(NSArray *words) {
  NSUInteger count = words.count;
  if (count == 0) return [NSData data];
  NSUInteger byteLength = [words[count - 1] unsignedIntegerValue];
  NSUInteger wordCount = count - 1;
  NSMutableData *data = [NSMutableData dataWithLength:wordCount * 4];
  uint32_t *out = data.mutableBytes;
  __unsafe_unretained id *objects =
      (__unsafe_unretained id *)malloc(sizeof(id) * (wordCount ? wordCount : 1));
  [words getObjects:objects range:NSMakeRange(0, wordCount)];
  for (NSUInteger i = 0; i < wordCount; i++) {
    out[i] = (uint32_t)[(NSNumber *)objects[i] unsignedLongLongValue];
  }
  free(objects);
  data.length = MIN(byteLength, wordCount * 4);
  return data;
}

/// An image's RGBA bytes, as createImageBitmap's options ask:
/// `imageOrientation: 'flipY'` flips it, `premultiplyAlpha: 'premultiply'`
/// keeps CoreGraphics' premultiplied pixels (otherwise they're divided back),
/// and `resizeWidth`/`resizeHeight` scale it.
static AngularLynxDecodedImage *pixelsOfImage(CGImageRef image, NSDictionary *options,
                                              NSString **error) {
  size_t width = CGImageGetWidth(image);
  size_t height = CGImageGetHeight(image);
  NSNumber *resizeWidth = options[@"resizeWidth"];
  NSNumber *resizeHeight = options[@"resizeHeight"];
  if ([resizeWidth isKindOfClass:NSNumber.class] && resizeWidth.integerValue > 0) {
    size_t w = resizeWidth.unsignedIntegerValue;
    height = [resizeHeight isKindOfClass:NSNumber.class] && resizeHeight.integerValue > 0
                 ? resizeHeight.unsignedIntegerValue
                 : MAX(1, (size_t)llround((double)height * w / width));
    width = w;
  } else if ([resizeHeight isKindOfClass:NSNumber.class] && resizeHeight.integerValue > 0) {
    size_t h = resizeHeight.unsignedIntegerValue;
    width = MAX(1, (size_t)llround((double)width * h / height));
    height = h;
  }
  NSMutableData *pixels = [NSMutableData dataWithLength:width * height * 4];
  CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  // CoreGraphics draws RGBA only premultiplied.
  CGContextRef context = CGBitmapContextCreate(
      pixels.mutableBytes, width, height, 8, width * 4, colorSpace,
      kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(colorSpace);
  if (!context) {
    *error = @"Could not allocate the image's pixels";
    return nil;
  }
  CGContextSetBlendMode(context, kCGBlendModeCopy);
  CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
  // A bitmap context's first row in memory is the top of what's drawn, so
  // drawing as is gives rows top to bottom; flipping the context gives them
  // bottom to top.
  if ([options[@"imageOrientation"] isEqual:@"flipY"]) {
    CGContextTranslateCTM(context, 0, height);
    CGContextScaleCTM(context, 1, -1);
  }
  CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
  CGContextRelease(context);
  BOOL premultiply = [options[@"premultiplyAlpha"] isEqual:@"premultiply"];
  if (!premultiply) {
    uint8_t *p = pixels.mutableBytes;
    for (size_t i = 0; i < width * height * 4; i += 4) {
      uint8_t alpha = p[i + 3];
      if (alpha != 0 && alpha != 255) {
        p[i] = (uint8_t)MIN(255, (p[i] * 255 + alpha / 2) / alpha);
        p[i + 1] = (uint8_t)MIN(255, (p[i + 1] * 255 + alpha / 2) / alpha);
        p[i + 2] = (uint8_t)MIN(255, (p[i + 2] * 255 + alpha / 2) / alpha);
      }
    }
  }
  return [[AngularLynxDecodedImage alloc] initWithPixels:pixels
                                                   width:width
                                                  height:height
                                           premultiplied:premultiply];
}

/// Decodes an image file to RGBA bytes, with createImageBitmap's options (see
/// pixelsOfImage).
static AngularLynxDecodedImage *decodeImage(NSData *bytes, NSDictionary *options,
                                            NSString **error) {
  CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)bytes, NULL);
  CGImageRef image = source ? CGImageSourceCreateImageAtIndex(source, 0, NULL) : NULL;
  if (source) CFRelease(source);
  if (!image) {
    *error = @"The data is not an image iOS can decode";
    return nil;
  }
  AngularLynxDecodedImage *decoded = pixelsOfImage(image, options, error);
  CGImageRelease(image);
  return decoded;
}

/// A canvas's pixels (its context's snapshot) as createImageBitmap's options
/// ask, for an ImageBitmap of the canvas. Without a resize, the bytes are
/// copied, flipped and premultiplied or divided as asked, exactly; a resize
/// draws them at the new size, as a decode does.
static AngularLynxDecodedImage *pixelsOfSnapshot(AngularLynxDecodedImage *snapshot,
                                                 NSDictionary *options, NSString **error) {
  NSNumber *resizeWidth = options[@"resizeWidth"];
  NSNumber *resizeHeight = options[@"resizeHeight"];
  BOOL resize = ([resizeWidth isKindOfClass:NSNumber.class] && resizeWidth.integerValue > 0) ||
                ([resizeHeight isKindOfClass:NSNumber.class] && resizeHeight.integerValue > 0);
  if (resize) {
    CGDataProviderRef provider =
        CGDataProviderCreateWithCFData((__bridge CFDataRef)snapshot.pixels);
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGImageRef image = CGImageCreate(
        snapshot.width, snapshot.height, 8, 32, snapshot.width * 4, space,
        (snapshot.premultiplied ? kCGImageAlphaPremultipliedLast : kCGImageAlphaLast) |
            kCGBitmapByteOrder32Big,
        provider, NULL, false, kCGRenderingIntentDefault);
    CGColorSpaceRelease(space);
    CGDataProviderRelease(provider);
    if (!image) {
      *error = @"Could not read the canvas's pixels";
      return nil;
    }
    AngularLynxDecodedImage *pixels = pixelsOfImage(image, options, error);
    CGImageRelease(image);
    return pixels;
  }
  NSInteger width = snapshot.width;
  NSInteger height = snapshot.height;
  NSUInteger stride = (NSUInteger)width * 4;
  NSMutableData *pixels = [NSMutableData dataWithLength:stride * height];
  if (!pixels) {
    *error = @"Could not allocate the image's pixels";
    return nil;
  }
  const uint8_t *from = snapshot.pixels.bytes;
  uint8_t *to = pixels.mutableBytes;
  BOOL flipY = [options[@"imageOrientation"] isEqual:@"flipY"];
  for (NSInteger y = 0; y < height; y++) {
    memcpy(to + (NSUInteger)y * stride, from + (NSUInteger)(flipY ? height - 1 - y : y) * stride,
           stride);
  }
  BOOL premultiply = [options[@"premultiplyAlpha"] isEqual:@"premultiply"];
  if (premultiply != snapshot.premultiplied) {
    for (NSUInteger i = 0; i < stride * height; i += 4) {
      uint8_t alpha = to[i + 3];
      if (alpha == 255) continue;
      for (NSUInteger c = 0; c < 3; c++) {
        if (premultiply) {
          to[i + c] = (uint8_t)((to[i + c] * alpha + 127) / 255);
        } else if (alpha != 0) {
          to[i + c] = (uint8_t)MIN(255, (to[i + c] * 255 + alpha / 2) / alpha);
        }
      }
    }
  }
  return [[AngularLynxDecodedImage alloc] initWithPixels:pixels
                                                   width:width
                                                  height:height
                                           premultiplied:premultiply];
}

#pragma mark - Module

@implementation AngularLynxWebGLModule {
  NSMutableDictionary<NSNumber *, AngularLynxWebGLContext *> *_contexts;
  NSMutableDictionary<NSNumber *, AngularLynxCanvas2DContext *> *_contexts2D;
  /// The 2D contexts' gradients and patterns, which any of them can paint
  /// with.
  NSMutableDictionary<NSNumber *, id> *_canvas2DObjects;
}

+ (NSString *)name {
  return @"AngularLynxWebGL";
}

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"create" : NSStringFromSelector(@selector(create:canvasId:attributes:)),
    @"run" : NSStringFromSelector(@selector(run:commands:)),
    @"destroy" : NSStringFromSelector(@selector(destroy:)),
    @"decodeImage" : NSStringFromSelector(@selector(decodeImage:bytes:options:)),
    @"releaseImage" : NSStringFromSelector(@selector(releaseImage:)),
    @"imageFromCanvas" : NSStringFromSelector(@selector(imageFromCanvas:canvasId:options:)),
    @"encodeImage" : NSStringFromSelector(@selector(encodeImage:options:)),
    @"create2D" : NSStringFromSelector(@selector(create2D:canvasId:attributes:)),
    @"run2D" : NSStringFromSelector(@selector(run2D:commands:)),
    @"destroy2D" : NSStringFromSelector(@selector(destroy2D:)),
    @"encode2D" : NSStringFromSelector(@selector(encode2D:options:)),
    @"release2D" : NSStringFromSelector(@selector(release2D:)),
  };
}

- (instancetype)init {
  if ((self = [super init])) {
    _contexts = [NSMutableDictionary dictionary];
    _contexts2D = [NSMutableDictionary dictionary];
    _canvas2DObjects = [NSMutableDictionary dictionary];
  }
  return self;
}

- (instancetype)initWithParam:(id)param {
  return [self init];
}

- (void)dealloc {
  for (AngularLynxWebGLContext *context in _contexts.allValues) {
    [context destroy];
  }
  for (AngularLynxCanvas2DContext *context in _contexts2D.allValues) {
    [AngularLynxCanvasRegistry setContext:nil forCanvasId:context.canvasId];
  }
}

- (NSDictionary *)create:(NSNumber *)contextId
                canvasId:(NSString *)canvasId
              attributes:(NSDictionary *)attributes {
  [_contexts[contextId] destroy];
  NSString *error = nil;
  AngularLynxWebGLContext *context =
      [[AngularLynxWebGLContext alloc] initWithCanvasId:canvasId
                                             attributes:attributes ?: @{}
                                                  error:&error];
  if (!context) {
    return @{@"ok" : @NO, @"error" : error ?: @"OpenGL ES 3.0 is not available"};
  }
  _contexts[contextId] = context;
  [AngularLynxCanvasRegistry setContext:context forCanvasId:canvasId];
  return @{@"ok" : @YES};
}

- (NSArray *)run:(NSNumber *)contextId commands:(NSArray *)commands {
  AngularLynxWebGLContext *context = _contexts[contextId];
  if (!context || ![commands isKindOfClass:NSArray.class]) return @[];
  return [context run:commands];
}

- (NSNumber *)destroy:(NSNumber *)contextId {
  AngularLynxWebGLContext *context = _contexts[contextId];
  if (context) {
    [AngularLynxCanvasRegistry setContext:nil forCanvasId:context.canvasId];
    [context destroy];
    [_contexts removeObjectForKey:contextId];
  }
  return @YES;
}

- (NSDictionary *)decodeImage:(NSNumber *)imageId
                        bytes:(NSArray *)bytes
                      options:(NSDictionary *)options {
  NSString *error = nil;
  AngularLynxDecodedImage *image =
      [bytes isKindOfClass:NSArray.class]
          ? decodeImage(AngularLynxBytesFromWords(bytes),
                        [options isKindOfClass:NSDictionary.class] ? options : @{}, &error)
          : nil;
  if (!image) {
    return @{@"width" : @0, @"height" : @0, @"error" : error ?: @"No image data"};
  }
  decodedImages()[imageId] = image;
  return @{@"width" : @(image.width), @"height" : @(image.height)};
}

- (NSNumber *)releaseImage:(NSNumber *)imageId {
  [decodedImages() removeObjectForKey:imageId];
  return @YES;
}

/// An ImageBitmap of a canvas, for createImageBitmap() and
/// OffscreenCanvas.transferToImageBitmap(): a copy of the canvas's pixels
/// now, kept under `imageId` as a decoded image is, so texture uploads and
/// drawImage read it as they read one. The pixels never cross the bridge.
/// `options` holds createImageBitmap's options, the canvas's size (a canvas
/// with no context is transparent black, as in a browser) and `transfer`,
/// which clears the canvas after it's read. `{ width, height }`, or
/// `{ error }`.
- (NSDictionary *)imageFromCanvas:(NSNumber *)imageId
                         canvasId:(NSString *)canvasId
                          options:(NSDictionary *)options {
  if (![options isKindOfClass:NSDictionary.class]) options = @{};
  id<AngularLynxCanvasContext> context =
      [canvasId isKindOfClass:NSString.class]
          ? [AngularLynxCanvasRegistry contextForCanvasId:canvasId]
          : nil;
  // A WebGL context's snapshot makes it current; the next batch of any
  // context makes its own current again (see AngularLynxWebGLContext run:).
  AngularLynxDecodedImage *snapshot = [context snapshot];
  if (!snapshot) {
    NSInteger width = [options[@"width"] isKindOfClass:NSNumber.class]
                          ? [options[@"width"] integerValue]
                          : 0;
    NSInteger height = [options[@"height"] isKindOfClass:NSNumber.class]
                           ? [options[@"height"] integerValue]
                           : 0;
    if (width <= 0 || height <= 0) {
      return @{@"width" : @0, @"height" : @0, @"error" : @"The canvas has no pixels"};
    }
    snapshot = [[AngularLynxDecodedImage alloc]
        initWithPixels:[NSMutableData dataWithLength:(NSUInteger)width * height * 4]
                 width:width
                height:height
         premultiplied:YES];
  }
  if ([options[@"transfer"] isEqual:@YES]) [context clearForTransfer];
  NSString *error = nil;
  AngularLynxDecodedImage *image = pixelsOfSnapshot(snapshot, options, &error);
  if (!image) {
    return @{@"width" : @0, @"height" : @0, @"error" : error ?: @"The canvas could not be read"};
  }
  decodedImages()[imageId] = image;
  return @{@"width" : @(image.width), @"height" : @(image.height)};
}

/// The drawing buffer as an image file, for canvas.toBlob() and toDataURL():
/// `options` holds the MIME type (image/jpeg, or image/png for anything
/// else, as browsers fall back), the JPEG quality and premultipliedAlpha.
- (NSDictionary *)encodeImage:(NSNumber *)contextId options:(NSDictionary *)options {
  AngularLynxWebGLContext *context = _contexts[contextId];
  if (!context) return @{@"error" : @"The canvas has no WebGL context"};
  if (![options isKindOfClass:NSDictionary.class]) options = @{};
  NSString *type = [options[@"type"] isEqual:@"image/jpeg"] ? @"image/jpeg" : @"image/png";
  NSNumber *quality = options[@"quality"];
  return [context
      encodeImageOfType:type
                quality:[quality isKindOfClass:NSNumber.class] ? quality.doubleValue : 0.92
          premultiplied:![options[@"premultipliedAlpha"] isEqual:@NO]];
}

#pragma mark - 2D

/// A 2D context for the canvas: `{ ok }`, or `{ ok: false, error }`.
- (NSDictionary *)create2D:(NSNumber *)contextId
                  canvasId:(NSString *)canvasId
                attributes:(NSDictionary *)attributes {
  [self destroy2D:contextId];
  NSString *error = nil;
  AngularLynxCanvas2DContext *context = [[AngularLynxCanvas2DContext alloc]
      initWithCanvasId:canvasId
            attributes:[attributes isKindOfClass:NSDictionary.class] ? attributes : @{}
               objects:_canvas2DObjects
                 error:&error];
  if (!context) return @{@"ok" : @NO, @"error" : error ?: @"Could not make the canvas's bitmap"};
  _contexts2D[contextId] = context;
  [AngularLynxCanvasRegistry setContext:context forCanvasId:canvasId];
  return @{@"ok" : @YES};
}

- (NSArray *)run2D:(NSNumber *)contextId commands:(NSArray *)commands {
  AngularLynxCanvas2DContext *context = _contexts2D[contextId];
  if (!context || ![commands isKindOfClass:NSArray.class]) return @[];
  return [context run:commands];
}

- (NSNumber *)destroy2D:(NSNumber *)contextId {
  AngularLynxCanvas2DContext *context = _contexts2D[contextId];
  if (context) {
    if ([AngularLynxCanvasRegistry contextForCanvasId:context.canvasId] == context) {
      [AngularLynxCanvasRegistry setContext:nil forCanvasId:context.canvasId];
    }
    [context attachTarget:nil];
    [_contexts2D removeObjectForKey:contextId];
  }
  return @YES;
}

/// Frees a gradient or pattern, which every 2D context in the LynxView
/// shares, whether or not the context that made it is still there.
- (NSNumber *)release2D:(NSNumber *)objectId {
  if ([objectId isKindOfClass:NSNumber.class]) [_canvas2DObjects removeObjectForKey:objectId];
  return @YES;
}

/// The bitmap as an image file, for canvas.toBlob() and toDataURL().
- (NSDictionary *)encode2D:(NSNumber *)contextId options:(NSDictionary *)options {
  AngularLynxCanvas2DContext *context = _contexts2D[contextId];
  if (!context) return @{@"error" : @"The canvas has no 2D context"};
  if (![options isKindOfClass:NSDictionary.class]) options = @{};
  NSString *type = [options[@"type"] isEqual:@"image/jpeg"] ? @"image/jpeg" : @"image/png";
  NSNumber *quality = options[@"quality"];
  return [context encodeImageOfType:type
                            quality:[quality isKindOfClass:NSNumber.class] ? quality.doubleValue
                                                                           : 0.92];
}

@end

#pragma mark - Canvas

@implementation AngularLynxCanvasTarget

- (instancetype)initWithView:(AngularLynxCanvasView *)view {
  if ((self = [super init])) {
    _layer = (CAMetalLayer *)view.layer;
    _view = view;
  }
  return self;
}

@end

@implementation AngularLynxCanvasView {
  /// Shows a 2D context's bitmap. Made the first time one is shown, over the
  /// Metal layer a WebGL context draws in, which a 2D canvas leaves empty.
  CALayer *_imageLayer;
}

+ (Class)layerClass {
  return [CAMetalLayer class];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if ((self = [super initWithFrame:frame])) {
    // ANGLE sets the layer's device and pixel format when it makes the
    // window surface, and sizes its drawables from the layer's bounds and
    // scale, so the frame copied into it is at the screen's resolution.
    self.layer.opaque = NO;
    self.opaque = NO;
    self.contentScaleFactor = UIScreen.mainScreen.scale;
    // Lynx dispatches touches itself, from the LynxView.
    self.userInteractionEnabled = NO;
    _target = [[AngularLynxCanvasTarget alloc] initWithView:self];
  }
  return self;
}

/// Runs `block` on Lynx's engine thread, where the module's calls arrive and
/// every GL call is made: next on it, or at once when this is it (it's the UI
/// thread under Lynx's default thread strategy). Nothing runs once the
/// LynxView has gone, nor do its contexts.
- (void)onEngineThread:(dispatch_block_t)block {
  [_lynxContext runOnTasmThread:block];
}

// A frame drawn before Lynx gave the view a size waits for one (see
// present). An app that draws only when something changes, such as a photo
// editor drawing its photo once, would otherwise show nothing until it drew
// again; one drawing every frame never noticed.
- (void)layoutSubviews {
  [super layoutSubviews];
  if (_imageLayer) {
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    _imageLayer.frame = self.layer.bounds;
    [CATransaction commit];
  }
  // ANGLE sizes the layer's next drawable from its bounds and scale, as here.
  CGSize size = self.bounds.size;
  CGFloat scale = self.layer.contentsScale;
  _target.pixelSize = CGSizeMake(floor(size.width * scale), floor(size.height * scale));
  NSString *canvasId = _canvasId;
  AngularLynxCanvasTarget *target = _target;
  if (!canvasId) return;
  [self onEngineThread:^{
    [[AngularLynxCanvasRegistry contextForCanvasId:canvasId] targetDidLayOut:target];
  }];
}

- (void)showImage:(CGImageRef)image opaque:(BOOL)opaque canvasId:(NSString *)canvasId {
  // A frame queued before the view was given another canvas isn't its.
  if (![canvasId isEqualToString:_canvasId]) return;
  if (!_imageLayer) {
    if (!image) return;
    _imageLayer = [CALayer layer];
    // Scaled to the view, as a canvas's bitmap is to its CSS size, smoothly.
    _imageLayer.contentsGravity = kCAGravityResize;
    _imageLayer.minificationFilter = kCAFilterTrilinear;
    _imageLayer.frame = self.layer.bounds;
    [self.layer addSublayer:_imageLayer];
  }
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _imageLayer.contents = (__bridge id)image;
  _imageLayer.opaque = opaque;
  [CATransaction commit];
}

- (void)setCanvasId:(NSString *)canvasId {
  if ([_canvasId isEqualToString:canvasId]) return;
  // Another canvas starts blank: the last one's bitmap isn't its.
  _imageLayer.contents = nil;
  NSString *old = _canvasId;
  _canvasId = [canvasId copy];
  NSString *new = _canvasId;
  AngularLynxCanvasTarget *target = _target;
  [self onEngineThread:^{
    if (old && [AngularLynxCanvasRegistry targetForCanvasId:old] == target) {
      [AngularLynxCanvasRegistry setTarget:nil forCanvasId:old];
    }
    if (new) [AngularLynxCanvasRegistry setTarget:target forCanvasId:new];
  }];
}

- (void)dealloc {
  // The context holds the target, and its layer, while it shows frames in
  // it; it lets go here.
  NSString *canvasId = _canvasId;
  AngularLynxCanvasTarget *target = _target;
  if (canvasId) {
    [_lynxContext runOnTasmThread:^{
      if ([AngularLynxCanvasRegistry targetForCanvasId:canvasId] == target) {
        [AngularLynxCanvasRegistry setTarget:nil forCanvasId:canvasId];
      }
    }];
  }
}

@end

@implementation AngularLynxCanvas

- (AngularLynxCanvasView *)createView {
  return [[AngularLynxCanvasView alloc] initWithFrame:CGRectZero];
}

LYNX_PROP_SETTER("canvas-id", setCanvasId, NSString *) {
  self.view.lynxContext = self.context.lynxContext;
  self.view.canvasId = requestReset || ![value isKindOfClass:NSString.class] ? nil : value;
}

@end
