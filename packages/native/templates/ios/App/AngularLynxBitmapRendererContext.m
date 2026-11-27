// `<canvas>`'s bitmaprenderer context for the AngularLynx runtime
// (packages/runtime/src/lib/canvas/bitmap-renderer-context.ts):
// ImageBitmapRenderingContext, which shows an ImageBitmap in the canvas.
//
// An ImageBitmap's pixels live here, as a decoded image the module keeps by
// id (decodeImage, imageFromCanvas). transferFromImageBitmap() detaches the
// bitmap and hands its id to the context, which takes the image from the
// module and shows it in the canvas's view as the 2D context shows its
// bitmap (AngularLynxCanvasView's image layer). The CGImage it shows reads
// the image's own bytes, so a frame drawn in an OffscreenCanvas reaches the
// screen without a copy in JavaScript or here, as the spec intends.
//
// The canvas reads as what it shows: drawImage(), texImage2D(),
// createImageBitmap() and the encoders take its snapshot, which is the
// image itself.
//
// Everything runs on Lynx's engine thread, where the module's calls arrive;
// only showing the image hops to the UI thread.

#import "AngularLynxWebGL.h"

NSDictionary *AngularLynxEncodeImage(NSData *pixels, size_t width, size_t height,
                                     CGBitmapInfo alphaInfo, NSString *type, double quality);

/// RGBA pixels of a blank canvas: transparent black, or opaque black without
/// alpha. Nil when there are none, or more than memory can count.
static NSData *blankPixels(NSInteger width, NSInteger height, BOOL alpha) {
  if (width <= 0 || height <= 0) return nil;
  // Checked before it's multiplied: two sides near 2^32 would wrap round.
  if ((NSUInteger)width > NSIntegerMax / 4 / (NSUInteger)height) return nil;
  NSUInteger length = (NSUInteger)width * height * 4;
  NSMutableData *pixels = [NSMutableData dataWithLength:length];
  if (!pixels) return nil;
  if (!alpha) {
    uint8_t *bytes = pixels.mutableBytes;
    for (NSUInteger i = 3; i < length; i += 4) bytes[i] = 255;
  }
  return pixels;
}

/// The image composited over opaque black, premultiplied, as the spec shows
/// a context made with `alpha: false`. Premultiplied colors are already what
/// they'd be over black; straight ones are multiplied by their alpha.
static AngularLynxDecodedImage *overBlack(AngularLynxDecodedImage *image) {
  NSMutableData *pixels = [image.pixels mutableCopy];
  uint8_t *bytes = pixels.mutableBytes;
  NSUInteger length = pixels.length;
  for (NSUInteger i = 0; i + 3 < length; i += 4) {
    uint8_t alpha = bytes[i + 3];
    if (alpha == 255) continue;
    if (!image.premultiplied) {
      for (NSUInteger c = 0; c < 3; c++) bytes[i + c] = (uint8_t)((bytes[i + c] * alpha + 127) / 255);
    }
    bytes[i + 3] = 255;
  }
  return [[AngularLynxDecodedImage alloc] initWithPixels:pixels
                                                   width:image.width
                                                  height:image.height
                                           premultiplied:YES];
}

@implementation AngularLynxBitmapRendererContext {
  BOOL _alpha;
  /// What the canvas shows, or nil while it's blank.
  AngularLynxDecodedImage *_image;
  /// The blank's size: the canvas's, as the runtime last said.
  NSInteger _blankWidth;
  NSInteger _blankHeight;
  AngularLynxCanvasTarget *_target;
  /// Something was to be shown before the view had a size.
  BOOL _framePending;
}

- (instancetype)initWithCanvasId:(NSString *)canvasId attributes:(NSDictionary *)attributes {
  if ((self = [super init])) {
    _canvasId = [canvasId copy];
    _alpha = ![attributes[@"alpha"] isEqual:@NO];
    NSNumber *width = attributes[@"width"];
    NSNumber *height = attributes[@"height"];
    _blankWidth = [width isKindOfClass:NSNumber.class] ? MAX(0, width.integerValue) : 300;
    _blankHeight = [height isKindOfClass:NSNumber.class] ? MAX(0, height.integerValue) : 150;
  }
  return self;
}

- (void)showImage:(AngularLynxDecodedImage *)image {
  _image = _alpha ? image : overBlack(image);
  [self present];
}

- (void)showBlankOfWidth:(NSInteger)width height:(NSInteger)height {
  _image = nil;
  _blankWidth = MAX(0, width);
  _blankHeight = MAX(0, height);
  [self present];
}

#pragma mark Showing the image

- (void)attachTarget:(AngularLynxCanvasTarget *)target {
  if (_target == target) return;
  _target = target;
  if (target) [self present];
}

- (void)targetDidLayOut:(AngularLynxCanvasTarget *)target {
  if (target == _target && _framePending) [self present];
}

/// The image goes to the view, as a 2D context's bitmap does (see its
/// present), once the view has a size.
- (void)present {
  AngularLynxCanvasTarget *target = _target;
  if (!target || target.pixelSize.width < 1 || target.pixelSize.height < 1) {
    _framePending = YES;
    return;
  }
  _framePending = NO;
  CGImageRef image = [self newImage];
  BOOL opaque = !_alpha;
  NSString *canvasId = _canvasId;
  dispatch_async(dispatch_get_main_queue(), ^{
    [target.view showImage:image opaque:opaque canvasId:canvasId];
    if (image) CGImageRelease(image);
  });
}

/// What the canvas shows, as an image over the pixels themselves: NULL for a
/// blank canvas with alpha, which shows nothing.
- (CGImageRef)newImage {
  AngularLynxDecodedImage *shown = _image ?: (_alpha ? nil : [self snapshot]);
  if (!shown) return NULL;
  return [self newImageOf:shown alphaInfo:[self alphaInfoOf:shown]];
}

- (CGBitmapInfo)alphaInfoOf:(AngularLynxDecodedImage *)image {
  if (!_alpha) return (CGBitmapInfo)kCGImageAlphaNoneSkipLast;
  return (CGBitmapInfo)(image.premultiplied ? kCGImageAlphaPremultipliedLast : kCGImageAlphaLast);
}

- (CGImageRef)newImageOf:(AngularLynxDecodedImage *)image alphaInfo:(CGBitmapInfo)alphaInfo {
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)image.pixels);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGImageRef cgImage =
      CGImageCreate(image.width, image.height, 8, 32, image.width * 4, space,
                    alphaInfo | kCGBitmapByteOrder32Big, provider, NULL, false,
                    kCGRenderingIntentDefault);
  CGColorSpaceRelease(space);
  CGDataProviderRelease(provider);
  return cgImage;
}

#pragma mark Reading it

/// What the canvas shows: the image itself, whose pixels nothing changes
/// (every reader copies them), or a blank of the canvas's size.
- (AngularLynxDecodedImage *)snapshot {
  if (_image) return _image;
  NSData *blank = blankPixels(_blankWidth, _blankHeight, _alpha);
  if (!blank) return nil;
  return [[AngularLynxDecodedImage alloc] initWithPixels:blank
                                                   width:_blankWidth
                                                  height:_blankHeight
                                           premultiplied:YES];
}

/// After OffscreenCanvas.transferToImageBitmap() took the image: the canvas
/// is blank, as the runtime then says again with the size of the bitmap taken.
- (void)clearForTransfer {
  _image = nil;
  if (_target) [self present];
}

- (NSDictionary *)encodeImageOfType:(NSString *)type quality:(double)quality {
  AngularLynxDecodedImage *image = [self snapshot];
  if (!image) return @{@"error" : @"The canvas has no pixels"};
  // A JPEG has no transparency: its transparent pixels come out black, as
  // in browsers, which premultiplied colors already are.
  if ([type isEqualToString:@"image/jpeg"]) {
    if (!image.premultiplied) image = overBlack(image);
    return AngularLynxEncodeImage(image.pixels, image.width, image.height,
                                  (CGBitmapInfo)kCGImageAlphaNoneSkipLast, type, quality);
  }
  return AngularLynxEncodeImage(image.pixels, image.width, image.height,
                                [self alphaInfoOf:image], type, quality);
}

@end
