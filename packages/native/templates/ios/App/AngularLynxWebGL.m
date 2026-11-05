#import "AngularLynxWebGL.h"

#import <ImageIO/ImageIO.h>
#import <Lynx/LynxPropsProcessor.h>
#import <QuartzCore/QuartzCore.h>

#pragma mark - Registry

@implementation AngularLynxCanvasRegistry

// Weak both ways: the view belongs to Lynx, the context to the module.
static NSMapTable<NSString *, AngularLynxCanvasView *> *views(void) {
  static NSMapTable *table;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    table = [NSMapTable strongToWeakObjectsMapTable];
  });
  return table;
}

static NSMapTable<NSString *, AngularLynxWebGLContext *> *contexts(void) {
  static NSMapTable *table;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    table = [NSMapTable strongToWeakObjectsMapTable];
  });
  return table;
}

+ (void)setView:(AngularLynxCanvasView *)view forCanvasId:(NSString *)canvasId {
  if (view) {
    [views() setObject:view forKey:canvasId];
  } else {
    [views() removeObjectForKey:canvasId];
  }
  [[contexts() objectForKey:canvasId] attachView:view];
}

+ (AngularLynxCanvasView *)viewForCanvasId:(NSString *)canvasId {
  return [views() objectForKey:canvasId];
}

+ (void)setContext:(AngularLynxWebGLContext *)context forCanvasId:(NSString *)canvasId {
  if (context) {
    [contexts() setObject:context forKey:canvasId];
    [context attachView:[views() objectForKey:canvasId]];
  } else {
    [contexts() removeObjectForKey:canvasId];
  }
}

+ (AngularLynxWebGLContext *)contextForCanvasId:(NSString *)canvasId {
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

/// Decodes an image file to RGBA bytes, as createImageBitmap's options ask:
/// `imageOrientation: 'flipY'` flips it, `premultiplyAlpha: 'premultiply'`
/// keeps CoreGraphics' premultiplied pixels (otherwise they're divided back),
/// and `resizeWidth`/`resizeHeight` scale it.
static AngularLynxDecodedImage *decodeImage(NSData *bytes, NSDictionary *options,
                                            NSString **error) {
  CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)bytes, NULL);
  CGImageRef image = source ? CGImageSourceCreateImageAtIndex(source, 0, NULL) : NULL;
  if (source) CFRelease(source);
  if (!image) {
    *error = @"The data is not an image iOS can decode";
    return nil;
  }
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
    CGImageRelease(image);
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
  CGImageRelease(image);
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

#pragma mark - Module

@implementation AngularLynxWebGLModule {
  NSMutableDictionary<NSNumber *, AngularLynxWebGLContext *> *_contexts;
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
  };
}

- (instancetype)init {
  if ((self = [super init])) {
    _contexts = [NSMutableDictionary dictionary];
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

@end

#pragma mark - Canvas

@implementation AngularLynxCanvasView

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
  }
  return self;
}

- (void)setCanvasId:(NSString *)canvasId {
  if ([_canvasId isEqualToString:canvasId]) return;
  if (_canvasId && [AngularLynxCanvasRegistry viewForCanvasId:_canvasId] == self) {
    [AngularLynxCanvasRegistry setView:nil forCanvasId:_canvasId];
  }
  _canvasId = [canvasId copy];
  if (_canvasId) [AngularLynxCanvasRegistry setView:self forCanvasId:_canvasId];
}

- (void)dealloc {
  // The registry holds the view weakly; a context still showing frames in it
  // stops.
  NSString *canvasId = _canvasId;
  if (canvasId) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (![AngularLynxCanvasRegistry viewForCanvasId:canvasId]) {
        [[AngularLynxCanvasRegistry contextForCanvasId:canvasId] attachView:nil];
      }
    });
  }
}

@end

@implementation AngularLynxCanvas

- (AngularLynxCanvasView *)createView {
  return [[AngularLynxCanvasView alloc] initWithFrame:CGRectZero];
}

LYNX_PROP_SETTER("canvas-id", setCanvasId, NSString *) {
  self.view.canvasId = requestReset || ![value isKindOfClass:NSString.class] ? nil : value;
}

@end
