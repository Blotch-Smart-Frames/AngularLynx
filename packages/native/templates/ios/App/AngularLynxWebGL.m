#import "AngularLynxWebGL.h"

#import "AngularLynxVideo.h"

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

/// RGBA pixels, rows top to bottom, as a PNG or JPEG file in base64:
/// `{ base64, type }`, or `{ error }`. Every kind of context encodes with
/// it, so it's here rather than in one of theirs: an app that draws only in
/// 2D has no AngularLynxWebGLContext.m (issue #847).
NSDictionary *AngularLynxEncodeImage(NSData *pixels, size_t width, size_t height,
                                     CGBitmapInfo alphaInfo, NSString *type, double quality) {
  size_t stride = width * 4;
  BOOL jpeg = [type isEqualToString:@"image/jpeg"];
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)pixels);
  CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGImageRef image =
      CGImageCreate(width, height, 8, 32, stride, colorSpace,
                    alphaInfo | kCGBitmapByteOrder32Big, provider, NULL, false,
                    kCGRenderingIntentDefault);
  CGColorSpaceRelease(colorSpace);
  CGDataProviderRelease(provider);
  if (!image) return @{@"error" : @"Could not make an image of the canvas's pixels"};
  NSMutableData *file = [NSMutableData data];
  NSString *fileType = jpeg ? @"public.jpeg" : @"public.png";
  CGImageDestinationRef destination = CGImageDestinationCreateWithData(
      (__bridge CFMutableDataRef)file, (__bridge CFStringRef)fileType, 1, NULL);
  BOOL written = NO;
  if (destination) {
    NSDictionary *properties =
        jpeg ? @{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality : @(quality)}
             : @{};
    CGImageDestinationAddImage(destination, image, (__bridge CFDictionaryRef)properties);
    written = CGImageDestinationFinalize(destination);
    CFRelease(destination);
  }
  CGImageRelease(image);
  if (!written) return @{@"error" : @"Could not encode the canvas's pixels"};
  return @{@"base64" : [file base64EncodedStringWithOptions:0], @"type" : type};
}

/// An image's RGBA bytes, as createImageBitmap's options ask:
/// `imageOrientation: 'flipY'` flips it, `premultiplyAlpha: 'premultiply'`
/// keeps CoreGraphics' premultiplied pixels (otherwise they're divided back),
/// and `resizeWidth`/`resizeHeight` scale it. A size given alone keeps the
/// aspect ratio, the other side rounded up, as the HTML spec has it.
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
                 : MAX(1, (size_t)ceil((double)height * w / width));
    width = w;
  } else if ([resizeHeight isKindOfClass:NSNumber.class] && resizeHeight.integerValue > 0) {
    size_t h = resizeHeight.unsignedIntegerValue;
    width = MAX(1, (size_t)ceil((double)width * h / height));
    height = h;
  }
  // A resize can name sides up to 2^32 - 1, whose bytes would wrap round.
  if (width > SIZE_MAX / 4 / height) {
    *error = @"The image is too large";
    return nil;
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

/// An integer option, or 0 when it's missing or isn't a number.
static long long integerOption(NSDictionary *options, NSString *key) {
  id value = options[key];
  return [value isKindOfClass:NSNumber.class] ? [value longLongValue] : 0;
}

/// Whether createImageBitmap() asked for part of the source (its `sx, sy, sw,
/// sh`), which the runtime sends as cropX, cropY, cropWidth and cropHeight,
/// the sizes made positive.
static BOOL hasCrop(NSDictionary *options) {
  return integerOption(options, @"cropWidth") > 0 && integerOption(options, @"cropHeight") > 0;
}

/// The part of an image createImageBitmap()'s crop rectangle covers, the
/// rectangle's size: what it covers outside the image is transparent black,
/// as the HTML spec has it, and the rest keeps its alpha as it was. The
/// image's rows are copied, so the source is left as it is.
static AngularLynxDecodedImage *cropImage(AngularLynxDecodedImage *image, NSDictionary *options,
                                          NSString **error) {
  long long x = integerOption(options, @"cropX");
  long long y = integerOption(options, @"cropY");
  long long width = integerOption(options, @"cropWidth");
  long long height = integerOption(options, @"cropHeight");
  // At most INT32_MAX bytes, Android's limit too (rgbaByteCount): a side can
  // be 2^31 - 1 (a Web IDL long), and a crop of 8 GB, which pixelsOfSnapshot
  // would copy again, can be allocated lazily and then end the app as the
  // rows are written. Checked before it's multiplied, which could wrap round.
  NSMutableData *pixels = (unsigned long long)width <= INT32_MAX / 4 / (unsigned long long)height
                              ? [NSMutableData dataWithLength:(NSUInteger)(width * height * 4)]
                              : nil;
  if (!pixels) {
    *error = @"The crop rectangle is too large";
    return nil;
  }
  // The columns and rows the rectangle shares with the image.
  long long left = MAX(x, 0);
  long long right = MIN(x + width, (long long)image.width);
  long long top = MAX(y, 0);
  long long bottom = MIN(y + height, (long long)image.height);
  if (left < right && top < bottom) {
    const uint8_t *from = image.pixels.bytes;
    uint8_t *to = pixels.mutableBytes;
    size_t span = (size_t)(right - left) * 4;
    for (long long row = top; row < bottom; row++) {
      memcpy(to + ((row - y) * width + (left - x)) * 4, from + (row * image.width + left) * 4,
             span);
    }
  }
  return [[AngularLynxDecodedImage alloc] initWithPixels:pixels
                                                   width:(NSInteger)width
                                                  height:(NSInteger)height
                                           premultiplied:image.premultiplied];
}

/// Pixels the shell has (a canvas's snapshot, an image it keeps, an
/// ImageData's) as createImageBitmap's options ask, for a new ImageBitmap:
/// cropped first, as the HTML spec orders it, so a resize and a flip apply to
/// the part the crop rectangle names. Without a resize, the bytes are copied,
/// flipped and premultiplied or divided as asked, exactly; a resize draws
/// them at the new size, as a decode does. The source is only read.
static AngularLynxDecodedImage *pixelsOfSnapshot(AngularLynxDecodedImage *snapshot,
                                                 NSDictionary *options, NSString **error) {
  if (hasCrop(options)) {
    snapshot = cropImage(snapshot, options, error);
    if (!snapshot) return nil;
  }
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

/// Keeps a new ImageBitmap's pixels under the id the runtime gave it, and
/// answers its size and, when it was asked for, that the crop was applied: a
/// shell from before cropping leaves `cropped` out, so the runtime can tell
/// it would get all of the source. Or answers why there's no image.
static NSDictionary *keptImage(NSNumber *imageId, AngularLynxDecodedImage *image,
                               NSDictionary *options, NSString *error, NSString *fallback) {
  if (!image) return @{@"width" : @0, @"height" : @0, @"error" : error ?: fallback};
  decodedImages()[imageId] = image;
  return @{
    @"width" : @(image.width),
    @"height" : @(image.height),
    @"cropped" : @(hasCrop(options)),
  };
}

#pragma mark - Module

// The WebGL2 context's lines, between the `angular-lynx:webgl` markers, go
// with AngularLynxWebGLContext.m, AngularLynxWebGLOps.h and ANGLE from an app
// that draws on a canvas only in 2D (@blotch/angular-lynx-native's
// features.ts): the runtime then has no WebGL2 context to call them, and
// nothing else names the class (issue #847).
@implementation AngularLynxWebGLModule {
  // angular-lynx:webgl
  NSMutableDictionary<NSNumber *, AngularLynxWebGLContext *> *_contexts;
  // /angular-lynx:webgl
  NSMutableDictionary<NSNumber *, AngularLynxCanvas2DContext *> *_contexts2D;
  NSMutableDictionary<NSNumber *, AngularLynxBitmapRendererContext *> *_bitmapRenderers;
  /// The 2D contexts' gradients and patterns, which any of them can paint
  /// with.
  NSMutableDictionary<NSNumber *, id> *_canvas2DObjects;
}

+ (NSString *)name {
  return @"AngularLynxWebGL";
}

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    // angular-lynx:webgl
    @"create" : NSStringFromSelector(@selector(create:canvasId:attributes:)),
    @"run" : NSStringFromSelector(@selector(run:commands:)),
    @"destroy" : NSStringFromSelector(@selector(destroy:)),
    @"encodeImage" : NSStringFromSelector(@selector(encodeImage:options:)),
    // /angular-lynx:webgl
    @"decodeImage" : NSStringFromSelector(@selector(decodeImage:bytes:options:)),
    @"releaseImage" : NSStringFromSelector(@selector(releaseImage:)),
    @"imageFromCanvas" : NSStringFromSelector(@selector(imageFromCanvas:canvasId:options:)),
    @"imageFromImage" : NSStringFromSelector(@selector(imageFromImage:sourceId:options:)),
    @"imageFromPixels" : NSStringFromSelector(@selector(imageFromPixels:bytes:options:)),
    @"create2D" : NSStringFromSelector(@selector(create2D:canvasId:attributes:)),
    @"run2D" : NSStringFromSelector(@selector(run2D:commands:)),
    @"destroy2D" : NSStringFromSelector(@selector(destroy2D:)),
    @"encode2D" : NSStringFromSelector(@selector(encode2D:options:)),
    @"release2D" : NSStringFromSelector(@selector(release2D:)),
    @"videoSize" : NSStringFromSelector(@selector(videoSize:)),
    @"createBitmapRenderer" :
        NSStringFromSelector(@selector(createBitmapRenderer:canvasId:attributes:)),
    @"transferToBitmapRenderer" :
        NSStringFromSelector(@selector(transferToBitmapRenderer:imageId:width:height:)),
    @"destroyBitmapRenderer" : NSStringFromSelector(@selector(destroyBitmapRenderer:)),
    @"encodeBitmapRenderer" : NSStringFromSelector(@selector(encodeBitmapRenderer:options:)),
  };
}

- (instancetype)init {
  if ((self = [super init])) {
    // angular-lynx:webgl
    _contexts = [NSMutableDictionary dictionary];
    // /angular-lynx:webgl
    _contexts2D = [NSMutableDictionary dictionary];
    _bitmapRenderers = [NSMutableDictionary dictionary];
    _canvas2DObjects = [NSMutableDictionary dictionary];
  }
  return self;
}

- (instancetype)initWithParam:(id)param {
  return [self init];
}

- (void)dealloc {
  // angular-lynx:webgl
  for (AngularLynxWebGLContext *context in _contexts.allValues) {
    [context destroy];
  }
  // /angular-lynx:webgl
  for (AngularLynxCanvas2DContext *context in _contexts2D.allValues) {
    [AngularLynxCanvasRegistry setContext:nil forCanvasId:context.canvasId];
  }
  for (AngularLynxBitmapRendererContext *context in _bitmapRenderers.allValues) {
    [AngularLynxCanvasRegistry setContext:nil forCanvasId:context.canvasId];
  }
}

// angular-lynx:webgl
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
// /angular-lynx:webgl

/// The size of the frame a `<video>` shows (AngularLynxVideo.m), by its
/// `video-id`: the runtime's videoWidth and videoHeight, and the size a
/// canvas reads it at. Zero before its first frame.
- (NSDictionary *)videoSize:(NSString *)videoId {
  CGSize size = CGSizeZero;
  if ([videoId isKindOfClass:NSString.class]) {
    id context = [AngularLynxCanvasRegistry contextForCanvasId:videoId];
    if ([context isKindOfClass:AngularLynxVideoFrames.class]) {
      size = [(AngularLynxVideoFrames *)context frameSize];
    }
  }
  return @{@"width" : @(size.width), @"height" : @(size.height)};
}

- (NSDictionary *)decodeImage:(NSNumber *)imageId
                        bytes:(NSArray *)bytes
                      options:(NSDictionary *)options {
  if (![options isKindOfClass:NSDictionary.class]) options = @{};
  NSString *error = nil;
  AngularLynxDecodedImage *image = nil;
  if ([bytes isKindOfClass:NSArray.class]) {
    if (hasCrop(options)) {
      // Cropped before it's resized or flipped, as the HTML spec orders it:
      // the file is decoded as it is, with the alpha the bitmap asks for, so
      // the copy needn't convert it, and then cut.
      NSDictionary *plain = @{@"premultiplyAlpha" : options[@"premultiplyAlpha"] ?: @"default"};
      image = decodeImage(AngularLynxBytesFromWords(bytes), plain, &error);
      if (image) image = pixelsOfSnapshot(image, options, &error);
    } else {
      image = decodeImage(AngularLynxBytesFromWords(bytes), options, &error);
    }
  }
  return keptImage(imageId, image, options, error, @"No image data");
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
  // A context that has pixels but couldn't read them is a failure, not a
  // blank canvas.
  if (context && !snapshot) {
    return @{@"width" : @0, @"height" : @0, @"error" : @"The canvas's pixels could not be read"};
  }
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
    // Checked before it's multiplied: two sides near 2^32 would wrap round
    // to a small count, and the copy would read past it.
    NSMutableData *blank =
        (NSUInteger)width <= NSIntegerMax / 4 / (NSUInteger)height
            ? [NSMutableData dataWithLength:(NSUInteger)width * height * 4]
            : nil;
    if (!blank) {
      return @{@"width" : @0, @"height" : @0, @"error" : @"The canvas is too large to copy"};
    }
    snapshot = [[AngularLynxDecodedImage alloc] initWithPixels:blank
                                                         width:width
                                                        height:height
                                                 premultiplied:YES];
  }
  if ([options[@"transfer"] isEqual:@YES]) [context clearForTransfer];
  NSString *error = nil;
  AngularLynxDecodedImage *image = pixelsOfSnapshot(snapshot, options, &error);
  return keptImage(imageId, image, options, error, @"The canvas could not be read");
}

/// An ImageBitmap of an image the module keeps (an ImageBitmap's, or an
/// `<img>`'s), for createImageBitmap(): a copy of its pixels with
/// createImageBitmap's options, so neither the pixels nor the file cross the
/// bridge again. `{ width, height, cropped }`, or `{ error }`.
- (NSDictionary *)imageFromImage:(NSNumber *)imageId
                        sourceId:(NSNumber *)sourceId
                         options:(NSDictionary *)options {
  if (![options isKindOfClass:NSDictionary.class]) options = @{};
  AngularLynxDecodedImage *source =
      [sourceId isKindOfClass:NSNumber.class] ? decodedImages()[sourceId] : nil;
  if (!source) return @{@"width" : @0, @"height" : @0, @"error" : @"The image is gone"};
  NSString *error = nil;
  AngularLynxDecodedImage *image = pixelsOfSnapshot(source, options, &error);
  return keptImage(imageId, image, options, error, @"The image could not be copied");
}

/// An ImageBitmap of an ImageData, for createImageBitmap(): its RGBA bytes,
/// straight, rows top to bottom, sent as words (see AngularLynxBytesFromWords),
/// with its size in `options`, and createImageBitmap's options applied.
/// `{ width, height, cropped }`, or `{ error }`.
- (NSDictionary *)imageFromPixels:(NSNumber *)imageId
                            bytes:(NSArray *)bytes
                          options:(NSDictionary *)options {
  if (![options isKindOfClass:NSDictionary.class]) options = @{};
  long long width = integerOption(options, @"width");
  long long height = integerOption(options, @"height");
  NSData *pixels = [bytes isKindOfClass:NSArray.class] ? AngularLynxBytesFromWords(bytes) : nil;
  // Divided rather than multiplied, so two big sides can't wrap round to the
  // byte count.
  if (width <= 0 || height <= 0 || pixels.length == 0 || pixels.length % 4 ||
      pixels.length / 4 % (unsigned long long)width ||
      pixels.length / 4 / (unsigned long long)width != (unsigned long long)height) {
    return @{@"width" : @0, @"height" : @0, @"error" : @"The pixels don't fill the image"};
  }
  AngularLynxDecodedImage *source =
      [[AngularLynxDecodedImage alloc] initWithPixels:pixels
                                                width:(NSInteger)width
                                               height:(NSInteger)height
                                        premultiplied:NO];
  NSString *error = nil;
  AngularLynxDecodedImage *image = pixelsOfSnapshot(source, options, &error);
  return keptImage(imageId, image, options, error, @"The pixels could not be copied");
}

// angular-lynx:webgl
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
// /angular-lynx:webgl

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

#pragma mark - Bitmap renderer

/// A bitmaprenderer context for the canvas, showing a blank canvas of the
/// `width` and `height` in `attributes`: `{ ok }`.
- (NSDictionary *)createBitmapRenderer:(NSNumber *)contextId
                              canvasId:(NSString *)canvasId
                            attributes:(NSDictionary *)attributes {
  [self destroyBitmapRenderer:contextId];
  if (![canvasId isKindOfClass:NSString.class]) {
    return @{@"ok" : @NO, @"error" : @"The canvas has no id"};
  }
  AngularLynxBitmapRendererContext *context = [[AngularLynxBitmapRendererContext alloc]
      initWithCanvasId:canvasId
            attributes:[attributes isKindOfClass:NSDictionary.class] ? attributes : @{}];
  _bitmapRenderers[contextId] = context;
  [AngularLynxCanvasRegistry setContext:context forCanvasId:canvasId];
  return @{@"ok" : @YES};
}

/// transferFromImageBitmap(): shows the decoded image `imageId` in the
/// canvas, which owns it from then on, or a blank canvas of `width` by
/// `height` for an id of 0. The image leaves the module's images even when
/// the context has gone, as the runtime's bitmap is detached either way and
/// nothing else would free it. `{ ok }`, or `{ ok: false, error }`.
- (NSDictionary *)transferToBitmapRenderer:(NSNumber *)contextId
                                   imageId:(NSNumber *)imageId
                                     width:(NSNumber *)width
                                    height:(NSNumber *)height {
  AngularLynxDecodedImage *image = nil;
  if ([imageId isKindOfClass:NSNumber.class] && imageId.integerValue != 0) {
    image = decodedImages()[imageId];
    [decodedImages() removeObjectForKey:imageId];
    if (!image) return @{@"ok" : @NO, @"error" : @"The ImageBitmap's pixels are gone"};
  }
  AngularLynxBitmapRendererContext *context = _bitmapRenderers[contextId];
  if (!context) return @{@"ok" : @NO, @"error" : @"The canvas has no bitmaprenderer context"};
  if (image) {
    [context showImage:image];
  } else {
    [context showBlankOfWidth:[width isKindOfClass:NSNumber.class] ? width.integerValue : 0
                       height:[height isKindOfClass:NSNumber.class] ? height.integerValue : 0];
  }
  return @{@"ok" : @YES};
}

- (NSNumber *)destroyBitmapRenderer:(NSNumber *)contextId {
  AngularLynxBitmapRendererContext *context = _bitmapRenderers[contextId];
  if (context) {
    if ([AngularLynxCanvasRegistry contextForCanvasId:context.canvasId] == context) {
      [AngularLynxCanvasRegistry setContext:nil forCanvasId:context.canvasId];
    }
    [context attachTarget:nil];
    [_bitmapRenderers removeObjectForKey:contextId];
  }
  return @YES;
}

/// What the canvas shows as an image file, for canvas.toBlob() and
/// toDataURL().
- (NSDictionary *)encodeBitmapRenderer:(NSNumber *)contextId options:(NSDictionary *)options {
  AngularLynxBitmapRendererContext *context = _bitmapRenderers[contextId];
  if (!context) return @{@"error" : @"The canvas has no bitmaprenderer context"};
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
