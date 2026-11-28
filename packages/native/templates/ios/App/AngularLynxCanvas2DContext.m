// `<canvas>`'s 2D context for the AngularLynx runtime: the bitmap the
// runtime's CanvasRenderingContext2D (packages/runtime/src/lib/canvas/
// canvas-2d-context.ts) draws on, with Core Graphics, the engine Safari's
// canvas drew with for years. The runtime sends its calls in batches, as the
// WebGL context does, through the AngularLynxWebGL module's `run2D`.
//
// The runtime keeps the state its getters answer and builds paths itself, in
// the canvas's pixels (arcs and rounded rectangles arrive as Bézier curves),
// so this side draws what it's told: a path filled or stroked with the
// current style, text, an image. Everything is drawn into one RGBA bitmap,
// premultiplied, rows top to bottom, the canvas's `width` by `height`; after
// each task that drew, the runtime asks for it to be shown, and a copy goes
// to the canvas's view (AngularLynxCanvasView's image layer).
//
// What the canvas spec has that Core Graphics doesn't is made here:
// - Compositing that clears what the shape doesn't cover (source-in,
//   source-out, destination-in, destination-atop, copy), and shadows, draw
//   the shape into a layer over the canvas first, which is then drawn over
//   it with the operation and the shadow; a shadow cast from far off the
//   canvas has a layer of its own there.
// - The filter (blur(), drop-shadow(), the color functions) is applied to
//   that layer's pixels, before it's drawn over the canvas.
// - Conic gradients (CGContextDrawConicGradient needs iOS 17) are worked out
//   a pixel at a time.
// - Text is laid out with Core Text: drawn as glyphs for a color fill (so
//   emoji draw), and as the glyphs' outlines for a gradient or pattern, and
//   for strokes.
//
// Everything runs on Lynx's engine thread, where the module's calls arrive;
// only showing the bitmap hops to the UI thread.

// cspell:words fabs fmod isfinite lround Roundhand

#import "AngularLynxWebGL.h"

#import <CoreText/CoreText.h>
#import <ImageIO/ImageIO.h>

#import "AngularLynxCanvas2DOps.h"

NSData *AngularLynxBytesFromWords(NSArray *words);
NSDictionary *AngularLynxEncodeImage(NSData *pixels, size_t width, size_t height,
                                     CGBitmapInfo alphaInfo, NSString *type, double quality);

#pragma mark - Reading a batch

typedef struct {
  __unsafe_unretained id *items;
  NSUInteger count;
  NSUInteger index;
} ALReader;

static inline id readItem(ALReader *r) {
  return r->index < r->count ? r->items[r->index++] : nil;
}

static inline double readNumber(ALReader *r) {
  id item = readItem(r);
  return [item isKindOfClass:NSNumber.class] ? [item doubleValue] : 0;
}

static inline NSInteger readInt(ALReader *r) { return (NSInteger)readNumber(r); }

static inline NSString *readString(ALReader *r) {
  id item = readItem(r);
  return [item isKindOfClass:NSString.class] ? item : @"";
}

static inline NSArray *readArray(ALReader *r) {
  id item = readItem(r);
  return [item isKindOfClass:NSArray.class] ? item : @[];
}

static inline NSDictionary *readMap(ALReader *r) {
  id item = readItem(r);
  return [item isKindOfClass:NSDictionary.class] ? item : @{};
}

/// Bytes as words for the trip back, the byte count last (see fromWords in
/// network/words.ts).
static NSArray *wordsFrom(const uint8_t *bytes, NSUInteger length) {
  NSUInteger wordCount = (length + 3) / 4;
  NSMutableArray *words = [NSMutableArray arrayWithCapacity:wordCount + 1];
  for (NSUInteger i = 0; i < wordCount; i++) {
    uint32_t word = 0;
    memcpy(&word, bytes + i * 4, MIN(4, length - i * 4));
    [words addObject:@(word)];
  }
  [words addObject:@(length)];
  return words;
}

/// A path from the runtime's segments (PATH_OP in canvas-2d-ops.ts): in the
/// canvas's pixels, top-left origin.
static CGMutablePathRef pathFromSegments(NSArray *segments) {
  CGMutablePathRef path = CGPathCreateMutable();
  NSUInteger count = segments.count;
  __unsafe_unretained id *items = (__unsafe_unretained id *)malloc(sizeof(id) * MAX(count, 1));
  [segments getObjects:items range:NSMakeRange(0, count)];
  NSUInteger i = 0;
#define NEXT (i < count ? [items[i++] doubleValue] : 0)
  while (i < count) {
    NSInteger op = (NSInteger)[items[i++] doubleValue];
    switch ((ALCanvas2DPathOp)op) {
      case ALCanvas2DPathOpMoveTo: {
        CGFloat x = NEXT, y = NEXT;
        CGPathMoveToPoint(path, NULL, x, y);
        break;
      }
      case ALCanvas2DPathOpLineTo: {
        CGFloat x = NEXT, y = NEXT;
        if (CGPathIsEmpty(path)) {
          CGPathMoveToPoint(path, NULL, x, y);
        } else {
          CGPathAddLineToPoint(path, NULL, x, y);
        }
        break;
      }
      case ALCanvas2DPathOpQuadTo: {
        CGFloat cx = NEXT, cy = NEXT, x = NEXT, y = NEXT;
        if (CGPathIsEmpty(path)) CGPathMoveToPoint(path, NULL, cx, cy);
        CGPathAddQuadCurveToPoint(path, NULL, cx, cy, x, y);
        break;
      }
      case ALCanvas2DPathOpCubicTo: {
        CGFloat ax = NEXT, ay = NEXT, bx = NEXT, by = NEXT, x = NEXT, y = NEXT;
        if (CGPathIsEmpty(path)) CGPathMoveToPoint(path, NULL, ax, ay);
        CGPathAddCurveToPoint(path, NULL, ax, ay, bx, by, x, y);
        break;
      }
      case ALCanvas2DPathOpClose:
        if (!CGPathIsEmpty(path)) CGPathCloseSubpath(path);
        break;
      default:
        i = count;
    }
  }
#undef NEXT
  free(items);
  return path;
}

static BOOL invertible(CGAffineTransform t) {
  CGFloat det = t.a * t.d - t.b * t.c;
  return det != 0 && isfinite(det);
}

#pragma mark - State

typedef NS_ENUM(NSInteger, ALStyleKind) {
  ALStyleColor,
  ALStyleGradient,
  ALStylePattern,
};

typedef struct {
  ALStyleKind kind;
  CGFloat rgba[4];
  /// A pattern's image, by the runtime's id.
  NSInteger objectId;
  /// A pattern's transform, which crosses with the style.
  CGAffineTransform transform;
} ALStyle;

@class ALCanvas2DGradient;

/// What canvas `save()` keeps. The clip is Core Graphics' own state, saved
/// with it.
@interface ALCanvas2DState : NSObject <NSCopying>
@property(nonatomic) CGAffineTransform transform;
@property(nonatomic) CGFloat globalAlpha;
@property(nonatomic) NSInteger composite;
@property(nonatomic) ALStyle fill;
@property(nonatomic) ALStyle stroke;
/// The gradients the styles paint with, which cross whole with the style.
@property(nonatomic, strong) ALCanvas2DGradient *fillGradient;
@property(nonatomic, strong) ALCanvas2DGradient *strokeGradient;
@property(nonatomic) CGFloat lineWidth;
@property(nonatomic) CGLineCap lineCap;
@property(nonatomic) CGLineJoin lineJoin;
@property(nonatomic) CGFloat miterLimit;
@property(nonatomic, copy) NSArray<NSNumber *> *lineDash;
@property(nonatomic) CGFloat lineDashOffset;
@property(nonatomic) CGFloat shadowBlur;
@property(nonatomic) CGFloat shadowOffsetX;
@property(nonatomic) CGFloat shadowOffsetY;
@property(nonatomic) CGFloat shadowR, shadowG, shadowB, shadowA;
@property(nonatomic, strong) UIFont *font;
@property(nonatomic) NSInteger textAlign;
@property(nonatomic) NSInteger textBaseline;
@property(nonatomic) BOOL rtl;
@property(nonatomic) CGFloat letterSpacing;
@property(nonatomic) BOOL smoothing;
@property(nonatomic) NSInteger smoothingQuality;
/// The filter, as its steps (see parsedFilter).
@property(nonatomic, copy) NSArray<NSNumber *> *filterSteps;
@end

@implementation ALCanvas2DState

- (instancetype)init {
  if ((self = [super init])) {
    _transform = CGAffineTransformIdentity;
    _globalAlpha = 1;
    _fill = (ALStyle){ALStyleColor, {0, 0, 0, 1}, 0, CGAffineTransformIdentity};
    _stroke = (ALStyle){ALStyleColor, {0, 0, 0, 1}, 0, CGAffineTransformIdentity};
    _lineWidth = 1;
    _lineCap = kCGLineCapButt;
    _lineJoin = kCGLineJoinMiter;
    _miterLimit = 10;
    _lineDash = @[];
    _font = [UIFont systemFontOfSize:10];
    _textAlign = 0;
    _textBaseline = 3;
    _smoothing = YES;
    _filterSteps = @[];
  }
  return self;
}

- (id)copyWithZone:(NSZone *)zone {
  ALCanvas2DState *copy = [[ALCanvas2DState alloc] init];
  copy.transform = _transform;
  copy.globalAlpha = _globalAlpha;
  copy.composite = _composite;
  copy.fill = _fill;
  copy.stroke = _stroke;
  copy.fillGradient = _fillGradient;
  copy.strokeGradient = _strokeGradient;
  copy.lineWidth = _lineWidth;
  copy.lineCap = _lineCap;
  copy.lineJoin = _lineJoin;
  copy.miterLimit = _miterLimit;
  copy.lineDash = _lineDash;
  copy.lineDashOffset = _lineDashOffset;
  copy.shadowBlur = _shadowBlur;
  copy.shadowOffsetX = _shadowOffsetX;
  copy.shadowOffsetY = _shadowOffsetY;
  copy.shadowR = _shadowR;
  copy.shadowG = _shadowG;
  copy.shadowB = _shadowB;
  copy.shadowA = _shadowA;
  copy.font = _font;
  copy.textAlign = _textAlign;
  copy.textBaseline = _textBaseline;
  copy.rtl = _rtl;
  copy.letterSpacing = _letterSpacing;
  copy.smoothing = _smoothing;
  copy.smoothingQuality = _smoothingQuality;
  copy.filterSteps = _filterSteps;
  return copy;
}

@end

#pragma mark - Gradients and patterns

/// A CanvasGradient: linear, radial or conic, and its stops, in order.
@interface ALCanvas2DGradient : NSObject
@property(nonatomic) NSInteger type;  // 0 linear, 1 radial, 2 conic
@property(nonatomic) CGFloat p0, p1, p2, p3, p4, p5;
@property(nonatomic, readonly) NSMutableArray<NSArray<NSNumber *> *> *stops;
- (nullable CGGradientRef)gradient;
- (void)colorAt:(CGFloat)t into:(CGFloat *)rgba;
@end

@implementation ALCanvas2DGradient {
  CGGradientRef _gradient;
}

- (instancetype)init {
  if ((self = [super init])) _stops = [NSMutableArray array];
  return self;
}

- (void)dealloc {
  if (_gradient) CGGradientRelease(_gradient);
}

- (void)addStop:(CGFloat)offset r:(CGFloat)r g:(CGFloat)g b:(CGFloat)b a:(CGFloat)a {
  // A stop goes after the stops at the same offset, as the spec has it, so
  // two at one offset make a hard edge.
  NSUInteger index = _stops.count;
  while (index > 0 && [_stops[index - 1][0] doubleValue] > offset) index--;
  [_stops insertObject:@[ @(offset), @(r), @(g), @(b), @(a) ] atIndex:index];
  if (_gradient) {
    CGGradientRelease(_gradient);
    _gradient = NULL;
  }
}

/// The stops as a CGGradient, extended to 0 and 1 with the end colors, or
/// NULL when there are none (the gradient paints nothing).
- (CGGradientRef)gradient {
  if (_gradient || _stops.count == 0) return _gradient;
  NSMutableArray<NSArray<NSNumber *> *> *stops = [_stops mutableCopy];
  if ([stops.firstObject[0] doubleValue] > 0) {
    NSMutableArray *first = [stops.firstObject mutableCopy];
    first[0] = @0;
    [stops insertObject:first atIndex:0];
  }
  if ([stops.lastObject[0] doubleValue] < 1) {
    NSMutableArray *last = [stops.lastObject mutableCopy];
    last[0] = @1;
    [stops addObject:last];
  }
  size_t count = stops.count;
  CGFloat *components = malloc(sizeof(CGFloat) * count * 4);
  CGFloat *locations = malloc(sizeof(CGFloat) * count);
  for (size_t i = 0; i < count; i++) {
    locations[i] = [stops[i][0] doubleValue];
    for (size_t c = 0; c < 4; c++) {
      CGFloat value = [stops[i][c + 1] doubleValue];
      components[i * 4 + c] = c < 3 ? value / 255.0 : value;
    }
  }
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  _gradient = CGGradientCreateWithColorComponents(space, components, locations, count);
  CGColorSpaceRelease(space);
  free(components);
  free(locations);
  return _gradient;
}

/// The color at `t` (0 to 1), for the conic gradient, which is worked out a
/// pixel at a time: interpolated between the stops on either side, before
/// multiplying by alpha, as the spec has it. 0 to 1 each.
- (void)colorAt:(CGFloat)t into:(CGFloat *)rgba {
  NSUInteger count = _stops.count;
  NSArray<NSNumber *> *before = _stops.firstObject;
  NSArray<NSNumber *> *after = _stops.lastObject;
  for (NSUInteger i = 0; i < count; i++) {
    if ([_stops[i][0] doubleValue] <= t) before = _stops[i];
    if ([_stops[count - 1 - i][0] doubleValue] >= t) after = _stops[count - 1 - i];
  }
  CGFloat t0 = [before[0] doubleValue];
  CGFloat t1 = [after[0] doubleValue];
  CGFloat f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  for (int c = 0; c < 4; c++) {
    CGFloat a = [before[c + 1] doubleValue];
    CGFloat b = [after[c + 1] doubleValue];
    CGFloat value = a + (b - a) * f;
    rgba[c] = c < 3 ? value / 255.0 : value;
  }
}

@end

/// A CanvasPattern: an image, how it repeats, and its own transform.
@interface ALCanvas2DPattern : NSObject
@property(nonatomic) CGImageRef image;
@property(nonatomic) NSInteger repetition;  // 0 repeat, 1 repeat-x, 2 repeat-y, 3 no-repeat
@property(nonatomic) CGInterpolationQuality quality;
@end

@implementation ALCanvas2DPattern

- (void)dealloc {
  CGImageRelease(_image);
}

@end

static void drawPatternCell(void *info, CGContextRef c) {
  ALCanvas2DPattern *pattern = (__bridge ALCanvas2DPattern *)info;
  CGFloat width = CGImageGetWidth(pattern.image);
  CGFloat height = CGImageGetHeight(pattern.image);
  // Pattern space is the canvas's, top-left origin, so the image is drawn
  // the right way up by flipping it in its cell.
  CGContextSetInterpolationQuality(c, pattern.quality);
  CGContextTranslateCTM(c, 0, height);
  CGContextScaleCTM(c, 1, -1);
  CGContextDrawImage(c, CGRectMake(0, 0, width, height), pattern.image);
}

#pragma mark - Fonts

/// CSS's weights as UIKit's.
static UIFontWeight fontWeightFor(NSInteger weight) {
  if (weight < 150) return UIFontWeightUltraLight;
  if (weight < 250) return UIFontWeightThin;
  if (weight < 350) return UIFontWeightLight;
  if (weight < 450) return UIFontWeightRegular;
  if (weight < 550) return UIFontWeightMedium;
  if (weight < 650) return UIFontWeightSemibold;
  if (weight < 750) return UIFontWeightBold;
  if (weight < 850) return UIFontWeightHeavy;
  return UIFontWeightBlack;
}

static UIFont *withItalic(UIFont *font, BOOL italic) {
  if (!italic) return font;
  UIFontDescriptor *descriptor =
      [font.fontDescriptor fontDescriptorWithSymbolicTraits:font.fontDescriptor.symbolicTraits |
                                                            UIFontDescriptorTraitItalic];
  return descriptor ? [UIFont fontWithDescriptor:descriptor size:font.pointSize] : font;
}

/// The first of the families iOS has, at the weight and style, as a
/// browser's font matching picks it. CSS's generic families are Safari's.
static UIFont *fontFor(NSString *families, NSInteger weight, BOOL italic, CGFloat size) {
  UIFontWeight uiWeight = fontWeightFor(weight);
  for (NSString *raw in [families componentsSeparatedByString:@"\n"]) {
    NSString *family = [raw stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    NSString *lower = family.lowercaseString;
    UIFont *font = nil;
    if ([@[ @"sans-serif", @"system-ui", @"-apple-system", @"ui-sans-serif", @"ui-rounded" ]
            containsObject:lower]) {
      font = [UIFont systemFontOfSize:size weight:uiWeight];
      if ([lower isEqualToString:@"ui-rounded"]) {
        UIFontDescriptor *rounded =
            [font.fontDescriptor fontDescriptorWithDesign:UIFontDescriptorSystemDesignRounded];
        if (rounded) font = [UIFont fontWithDescriptor:rounded size:size];
      }
    } else if ([lower isEqualToString:@"ui-monospace"]) {
      font = [UIFont monospacedSystemFontOfSize:size weight:uiWeight];
    } else if ([lower isEqualToString:@"ui-serif"]) {
      UIFontDescriptor *serif = [[UIFont systemFontOfSize:size weight:uiWeight].fontDescriptor
          fontDescriptorWithDesign:UIFontDescriptorSystemDesignSerif];
      if (serif) font = [UIFont fontWithDescriptor:serif size:size];
    } else {
      NSString *name = family;
      if ([lower isEqualToString:@"serif"]) name = @"Times New Roman";
      if ([lower isEqualToString:@"monospace"]) name = @"Courier";
      if ([lower isEqualToString:@"cursive"]) name = @"Snell Roundhand";
      if ([lower isEqualToString:@"fantasy"]) name = @"Papyrus";
      // A family name, matched without case, then a font's own name.
      NSString *match = nil;
      for (NSString *installed in UIFont.familyNames) {
        if ([installed caseInsensitiveCompare:name] == NSOrderedSame) {
          match = installed;
          break;
        }
      }
      if (match) {
        UIFontDescriptor *descriptor = [UIFontDescriptor fontDescriptorWithFontAttributes:@{
          UIFontDescriptorFamilyAttribute : match,
          UIFontDescriptorTraitsAttribute : @{UIFontWeightTrait : @(uiWeight)},
        }];
        font = [UIFont fontWithDescriptor:descriptor size:size];
      } else {
        font = [UIFont fontWithName:name size:size];
      }
    }
    if (font) return withItalic(font, italic);
  }
  return withItalic([UIFont systemFontOfSize:size weight:uiWeight], italic);
}

#pragma mark - Filters

// The 2D context's `filter`, which the runtime parses into steps
// (packages/runtime/src/lib/canvas/css-filter.ts): a Gaussian blur, a color
// matrix, or a drop shadow, applied in order to the layer what's drawn went
// into, after its alpha and before its shadow and compositing, as the
// canvas spec has it. They
// work on the layer's bytes, premultiplied RGBA, in sRGB, which is where
// the spec has filter functions work. Android's shell runs the same steps
// the same way (CanvasFilter.kt), so the two draw alike.

/// The steps' kinds, as css-filter.ts's FILTER_STEP numbers them.
enum { ALFilterBlur = 0, ALFilterMatrix = 1, ALFilterDropShadow = 2 };

static inline uint8_t clampByte(double value) {
  return value <= 0 ? 0 : value >= 255 ? 255 : (uint8_t)(value + 0.5);
}

static inline double clampUnit(double value) { return value < 0 ? 0 : value > 1 ? 1 : value; }

/// A color matrix (row by row: red, green, blue, alpha; each row's factors
/// and offset) on the colors not premultiplied, clamped, as feColorMatrix is.
static void applyColorMatrix(uint8_t *bytes, size_t pixels, const double *m) {
  for (size_t i = 0; i < pixels; i++) {
    uint8_t *p = bytes + i * 4;
    double a = p[3] / 255.0;
    double r = 0, g = 0, b = 0;
    if (a > 0) {
      r = p[0] / 255.0 / a;
      g = p[1] / 255.0 / a;
      b = p[2] / 255.0 / a;
    }
    double r2 = clampUnit(m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4]);
    double g2 = clampUnit(m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9]);
    double b2 = clampUnit(m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14]);
    double a2 = clampUnit(m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19]);
    p[0] = clampByte(r2 * a2 * 255);
    p[1] = clampByte(g2 * a2 * 255);
    p[2] = clampByte(b2 * a2 * 255);
    p[3] = clampByte(a2 * 255);
  }
}

/// One box blur along each row (or each column), each output the mean of
/// the `lo` bytes before it, itself and the `hi` after; transparent past the
/// edges.
static void boxPass(const uint8_t *src, uint8_t *dst, size_t width, size_t height, size_t lo,
                    size_t hi, BOOL horizontal) {
  size_t lines = horizontal ? height : width;
  size_t length = horizontal ? width : height;
  size_t step = horizontal ? 4 : width * 4;
  size_t lineStride = horizontal ? width * 4 : 4;
  size_t size = lo + hi + 1;
  for (size_t line = 0; line < lines; line++) {
    const uint8_t *in = src + line * lineStride;
    uint8_t *out = dst + line * lineStride;
    for (size_t channel = 0; channel < 4; channel++) {
      size_t sum = 0;
      for (size_t i = 0; i <= hi && i < length; i++) sum += in[i * step + channel];
      for (size_t x = 0; x < length; x++) {
        out[x * step + channel] = (uint8_t)((sum * 2 + size) / (size * 2));
        if (x + hi + 1 < length) sum += in[(x + hi + 1) * step + channel];
        if (x >= lo) sum -= in[(x - lo) * step + channel];
      }
    }
  }
}

/// One pass of a Gaussian kernel along each row (or each column).
static void kernelPass(const uint8_t *src, uint8_t *dst, size_t width, size_t height,
                       const double *weights, size_t radius, BOOL horizontal) {
  size_t lines = horizontal ? height : width;
  size_t length = horizontal ? width : height;
  size_t step = horizontal ? 4 : width * 4;
  size_t lineStride = horizontal ? width * 4 : 4;
  for (size_t line = 0; line < lines; line++) {
    const uint8_t *in = src + line * lineStride;
    uint8_t *out = dst + line * lineStride;
    for (size_t x = 0; x < length; x++) {
      double sum[4] = {0, 0, 0, 0};
      size_t from = x >= radius ? x - radius : 0;
      size_t to = MIN(length - 1, x + radius);
      for (size_t i = from; i <= to; i++) {
        double weight = weights[(i + radius) - x];
        const uint8_t *p = in + i * step;
        for (int channel = 0; channel < 4; channel++) sum[channel] += p[channel] * weight;
      }
      for (int channel = 0; channel < 4; channel++) out[x * step + channel] = clampByte(sum[channel]);
    }
  }
}

/// A Gaussian blur of deviation `sigma`, as feGaussianBlur draws it: from a
/// deviation of 2, three box blurs, which the spec gives as within 3% of
/// the Gaussian (and which cost the same whatever the deviation); below it,
/// the Gaussian's own kernel, which is small there.
static void gaussianBlur(uint8_t *bytes, size_t width, size_t height, double sigma) {
  if (!(sigma > 0) || width == 0 || height == 0) return;
  uint8_t *scratch = malloc(width * height * 4);
  if (!scratch) return;
  for (int pass = 0; pass < 2; pass++) {
    BOOL horizontal = pass == 0;
    if (sigma >= 2) {
      size_t d = (size_t)floor(sigma * 3 * sqrt(2 * M_PI) / 4 + 0.5);
      if (d % 2 == 1) {
        boxPass(bytes, scratch, width, height, d / 2, d / 2, horizontal);
        boxPass(scratch, bytes, width, height, d / 2, d / 2, horizontal);
        boxPass(bytes, scratch, width, height, d / 2, d / 2, horizontal);
      } else {
        // An even box is centered between two pixels: one leans left, one
        // right, and the third is a pixel wider and centered.
        boxPass(bytes, scratch, width, height, d / 2, d / 2 - 1, horizontal);
        boxPass(scratch, bytes, width, height, d / 2 - 1, d / 2, horizontal);
        boxPass(bytes, scratch, width, height, d / 2, d / 2, horizontal);
      }
      memcpy(bytes, scratch, width * height * 4);
    } else {
      size_t radius = (size_t)ceil(sigma * 3);
      double weights[2 * 6 + 1];
      double total = 0;
      for (size_t i = 0; i <= 2 * radius; i++) {
        double k = (double)i - (double)radius;
        weights[i] = exp(-(k * k) / (2 * sigma * sigma));
        total += weights[i];
      }
      for (size_t i = 0; i <= 2 * radius; i++) weights[i] /= total;
      kernelPass(bytes, scratch, width, height, weights, radius, horizontal);
      memcpy(bytes, scratch, width * height * 4);
    }
  }
  free(scratch);
}

/// The shadow of what's in `bytes`: its alpha, moved by the offset (to the
/// nearest pixel), blurred by the deviation and in the color (red, green and
/// blue 0 to 255, alpha 0 to 1), as new premultiplied bytes the caller
/// frees, or NULL if they can't be made.
static uint8_t *newShadowBytes(const uint8_t *bytes, size_t width, size_t height, double dx,
                               double dy, double sigma, double r, double g, double b,
                               double a) {
  size_t length = width * height * 4;
  uint8_t *shadow = calloc(length, 1);
  if (!shadow) return NULL;
  long offsetX = lround(dx), offsetY = lround(dy);
  for (size_t y = 0; y < height; y++) {
    long fromY = (long)y - offsetY;
    if (fromY < 0 || fromY >= (long)height) continue;
    for (size_t x = 0; x < width; x++) {
      long fromX = (long)x - offsetX;
      if (fromX < 0 || fromX >= (long)width) continue;
      shadow[(y * width + x) * 4 + 3] = bytes[((size_t)fromY * width + (size_t)fromX) * 4 + 3];
    }
  }
  gaussianBlur(shadow, width, height, sigma);
  for (size_t i = 0; i < length; i += 4) {
    double shadowAlpha = shadow[i + 3] / 255.0 * a;
    shadow[i] = clampByte(r * shadowAlpha);
    shadow[i + 1] = clampByte(g * shadowAlpha);
    shadow[i + 2] = clampByte(b * shadowAlpha);
    shadow[i + 3] = clampByte(255 * shadowAlpha);
  }
  return shadow;
}

/// `under` drawn under `bytes`, source-over, as drop-shadow() puts its
/// shadow under what's drawn. Both are premultiplied, `pixels` long.
static void drawUnder(uint8_t *bytes, const uint8_t *under, size_t pixels) {
  for (size_t i = 0; i < pixels * 4; i += 4) {
    double uncovered = 1 - bytes[i + 3] / 255.0;
    for (int channel = 0; channel < 4; channel++) {
      bytes[i + channel] = clampByte(bytes[i + channel] + under[i + channel] * uncovered);
    }
  }
}

/// globalAlpha on a layer's bytes, which are premultiplied, so every
/// channel scales.
static void scaleAlpha(uint8_t *bytes, size_t pixels, double alpha) {
  if (alpha >= 1) return;
  for (size_t i = 0; i < pixels * 4; i++) bytes[i] = clampByte(bytes[i] * alpha);
}

/// A step of the filter: its kind and its numbers, and, for a drop shadow,
/// whether it's cast from a layer of its own when the filter reaches past
/// the layers' cap (see lastFar): one of the filter's last
/// MAX_OWN_LAYERS drop shadows moved by an offset, which parsedFilter marks.
typedef struct {
  NSInteger kind;
  double values[20];
  BOOL castsAlone;
} ALFilterStep;

static BOOL isMovedShadow(const ALFilterStep *step);

/// The most drop shadows in one filter that can be cast from a layer of
/// their own (see lastFar): the last ones moved by an offset. Each works out
/// the steps before it twice, over the layer it goes under and over that
/// moved back by its offset, so the draws double with each one; past this,
/// the earlier ones are planned as any step is, within the layers' cap, as
/// before issue #824. Three keep a fill to eight draws.
static const NSUInteger MAX_OWN_LAYERS = 3;

/// The filter's steps, as the runtime sends them: ALFilterSteps, end to end.
static NSData *parsedFilter(NSArray<NSNumber *> *steps) {
  NSUInteger count = steps.count, i = 0;
  NSMutableData *parsed = [NSMutableData data];
  while (i < count) {
    NSInteger kind = steps[i++].integerValue;
    NSUInteger arity = kind == ALFilterBlur ? 1 : kind == ALFilterMatrix ? 20 : kind == ALFilterDropShadow ? 7 : 0;
    // A step it doesn't know, or one cut short, ends the list: what's after
    // it would be read as the wrong numbers.
    if (arity == 0 || i + arity > count) break;
    ALFilterStep step = {kind, {0}, NO};
    for (NSUInteger k = 0; k < arity; k++) step.values[k] = steps[i + k].doubleValue;
    [parsed appendBytes:&step length:sizeof(step)];
    i += arity;
  }
  ALFilterStep *parsedSteps = parsed.mutableBytes;
  NSUInteger marked = 0;
  for (NSUInteger k = parsed.length / sizeof(ALFilterStep); k > 0 && marked < MAX_OWN_LAYERS; k--) {
    if (!isMovedShadow(&parsedSteps[k - 1])) continue;
    parsedSteps[k - 1].castsAlone = YES;
    marked++;
  }
  return parsed;
}

/// A step's deviation, for a blur or a drop shadow; 0 for a color matrix.
static double stepSigma(const ALFilterStep *step) {
  return step->kind == ALFilterBlur ? step->values[0] : step->kind == ALFilterDropShadow ? step->values[2] : 0;
}

/// How far a step can move what's drawn, in the canvas's pixels: three
/// deviations, and a drop shadow's offset. Uncapped: -planFor:... caps the
/// layer it sizes (MAX_REACH).
static double stepReach(const ALFilterStep *step) {
  if (step->kind == ALFilterBlur) return ceil(step->values[0] * 3);
  if (step->kind == ALFilterDropShadow) {
    return ceil(step->values[2] * 3) + ceil(MAX(fabs(step->values[0]), fabs(step->values[1])));
  }
  return 0;
}

/// Whether a step is a drop shadow moved by an offset.
static BOOL isMovedShadow(const ALFilterStep *step) {
  return step->kind == ALFilterDropShadow && (step->values[0] != 0 || step->values[1] != 0);
}

/// One step on a layer's bytes, in a layer `scale` of whose pixels make a
/// canvas pixel: its lengths (a deviation, an offset) are in the canvas's
/// pixels, so they're scaled to the layer's.
static void applyStep(uint8_t *bytes, size_t width, size_t height, const ALFilterStep *step,
                      double scale) {
  const double *v = step->values;
  switch (step->kind) {
    case ALFilterBlur:
      gaussianBlur(bytes, width, height, v[0] * scale);
      break;
    case ALFilterMatrix:
      applyColorMatrix(bytes, width * height, v);
      break;
    default: {
      uint8_t *shadow = newShadowBytes(bytes, width, height, v[0] * scale, v[1] * scale,
                                       v[2] * scale, v[3], v[4], v[5], v[6]);
      if (!shadow) return;
      drawUnder(bytes, shadow, width * height);
      free(shadow);
    }
  }
}

/// A layer a draw goes into, over part of the canvas's pixels: from (left,
/// top), `width` by `height` of its pixels, `scale` of them to a canvas
/// pixel; `exists` is NO for none. A layer at the canvas's resolution
/// (scale 1) lies on whole pixels, so its pixels line up with the canvas's.
typedef struct {
  BOOL exists;
  CGFloat left, top;
  size_t width, height;
  CGFloat scale;
} ALLayer;

static const ALLayer NO_LAYER = {NO, 0, 0, 0, 0, 0};

static ALLayer layerOfRect(CGRect rect) {
  return (ALLayer){YES, rect.origin.x, rect.origin.y, (size_t)rect.size.width,
                   (size_t)rect.size.height, 1};
}

/// Where a layer lies in the canvas's pixels.
static CGRect layerBounds(ALLayer layer) {
  return CGRectMake(layer.left, layer.top, layer.width / layer.scale, layer.height / layer.scale);
}

/// A layer grown by `pixels` of its own on each side, which stay where they
/// were.
static ALLayer grownLayer(ALLayer layer, size_t pixels) {
  return (ALLayer){YES,
                   layer.left - pixels / layer.scale,
                   layer.top - pixels / layer.scale,
                   layer.width + 2 * pixels,
                   layer.height + 2 * pixels,
                   layer.scale};
}

/// A layer moved by (dx, dy) canvas pixels.
static ALLayer movedLayer(ALLayer layer, double dx, double dy) {
  layer.left += dx;
  layer.top += dy;
  return layer;
}

/// The bytes of layer `from` resampled onto layer `to`, moved by (shiftX,
/// shiftY) canvas pixels: read with bilinear filtering at the center of each
/// of `to`'s pixels, transparent past `from`'s edges, as new bytes the
/// caller frees (NULL if they can't be made). It's how a blur worked out in
/// a smaller layer is scaled up, and how a drop shadow's offset lands
/// between two pixels, which a blur that wide has no edge to show.
static uint8_t *newResampled(const uint8_t *src, ALLayer from, ALLayer to, double shiftX,
                             double shiftY) {
  uint8_t *dst = calloc(to.width * to.height * 4, 1);
  long *xs = malloc(sizeof(long) * (to.width + 1));
  double *fx = malloc(sizeof(double) * (to.width + 1));
  if (!dst || !xs || !fx) {
    free(dst);
    free(xs);
    free(fx);
    return NULL;
  }
  // Where each column's center falls in `from`, as the pixel before it and
  // how far past that pixel's center it is. Clamped, so a far shift stays a
  // long (and reads nothing).
  for (size_t i = 0; i < to.width; i++) {
    double u = (to.left + (i + 0.5) / to.scale - shiftX - from.left) * from.scale - 0.5;
    u = MIN(MAX(u, -2.0), (double)from.width + 1);
    xs[i] = (long)floor(u);
    fx[i] = u - floor(u);
  }
  long w = (long)from.width, h = (long)from.height;
  for (size_t j = 0; j < to.height; j++) {
    double v = (to.top + (j + 0.5) / to.scale - shiftY - from.top) * from.scale - 0.5;
    v = MIN(MAX(v, -2.0), (double)from.height + 1);
    long y = (long)floor(v);
    double wy = v - floor(v);
    if (y < -1 || y >= h) continue;
    for (size_t i = 0; i < to.width; i++) {
      long x = xs[i];
      if (x < -1 || x >= w) continue;
      double wx = fx[i];
      uint8_t *out = dst + (j * to.width + i) * 4;
      for (int channel = 0; channel < 4; channel++) {
        double corners[4] = {0, 0, 0, 0};
        for (int k = 0; k < 4; k++) {
          long cx = x + (k & 1), cy = y + (k >> 1);
          if (cx >= 0 && cy >= 0 && cx < w && cy < h) corners[k] = src[(cy * w + cx) * 4 + channel];
        }
        double top = corners[0] * (1 - wx) + corners[1] * wx;
        double bottom = corners[2] * (1 - wx) + corners[3] * wx;
        out[channel] = clampByte(top * (1 - wy) + bottom * wy);
      }
    }
  }
  free(xs);
  free(fx);
  return dst;
}

#pragma mark - The context

static const CGBlendMode BLEND_MODES[] = {
    kCGBlendModeNormal,          kCGBlendModeSourceIn,        kCGBlendModeSourceOut,
    kCGBlendModeSourceAtop,      kCGBlendModeDestinationOver, kCGBlendModeDestinationIn,
    kCGBlendModeDestinationOut,  kCGBlendModeDestinationAtop, kCGBlendModePlusLighter,
    kCGBlendModeCopy,            kCGBlendModeXOR,             kCGBlendModeMultiply,
    kCGBlendModeScreen,          kCGBlendModeOverlay,         kCGBlendModeDarken,
    kCGBlendModeLighten,         kCGBlendModeColorDodge,      kCGBlendModeColorBurn,
    kCGBlendModeHardLight,       kCGBlendModeSoftLight,       kCGBlendModeDifference,
    kCGBlendModeExclusion,       kCGBlendModeHue,             kCGBlendModeSaturation,
    kCGBlendModeColor,           kCGBlendModeLuminosity,
};
static const NSInteger BLEND_MODE_COUNT = sizeof(BLEND_MODES) / sizeof(BLEND_MODES[0]);

/// The operations that clear what the shape doesn't cover: source-in,
/// source-out, destination-in, destination-atop and copy.
static BOOL isUnbounded(NSInteger composite) {
  return composite == 1 || composite == 2 || composite == 5 || composite == 7 || composite == 9;
}

/// The operations that can leave a pixel less opaque than it was: those,
/// and destination-out and xor.
static BOOL reducesAlpha(NSInteger composite) {
  return isUnbounded(composite) || composite == 6 || composite == 10;
}

@implementation AngularLynxCanvas2DContext {
  BOOL _alpha;
  size_t _width;
  size_t _height;
  /// The bitmap's bytes: RGBA, premultiplied, rows top to bottom.
  NSMutableData *_data;
  CGContextRef _cg;
  /// A 1 by 1 context for working out stroke outlines.
  CGContextRef _scratch;
  ALCanvas2DState *_state;
  NSMutableArray<ALCanvas2DState *> *_stack;
  /// The gradients and patterns of every 2D context in the LynxView, by the
  /// runtime's ids, so one context's can paint in another. The module holds
  /// it.
  NSMutableDictionary<NSNumber *, id> *_objects;
  AngularLynxCanvasTarget *_target;
  /// The bitmap was drawn on and not shown yet, waiting for a view.
  BOOL _framePending;
}

- (instancetype)initWithCanvasId:(NSString *)canvasId
                      attributes:(NSDictionary *)attributes
                         objects:(NSMutableDictionary<NSNumber *, id> *)objects
                           error:(NSString **)error {
  if (!(self = [super init])) return nil;
  _canvasId = [canvasId copy];
  _alpha = ![attributes[@"alpha"] isEqual:@NO];
  _objects = objects;
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  _scratch = CGBitmapContextCreate(NULL, 1, 1, 8, 4, space,
                                   kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  NSNumber *width = attributes[@"width"];
  NSNumber *height = attributes[@"height"];
  if (![self allocateWidth:[width isKindOfClass:NSNumber.class] ? width.unsignedIntegerValue : 300
                    height:[height isKindOfClass:NSNumber.class] ? height.unsignedIntegerValue
                                                                 : 150]) {
    *error = @"Could not allocate the canvas's bitmap";
    return nil;
  }
  return self;
}

- (void)dealloc {
  if (_cg) CGContextRelease(_cg);
  if (_scratch) CGContextRelease(_scratch);
}

/// A new bitmap, cleared, with the state reset, as a canvas has when it's
/// resized or reset.
- (BOOL)allocateWidth:(size_t)width height:(size_t)height {
  if (_cg) CGContextRelease(_cg);
  _cg = NULL;
  _width = width;
  _height = height;
  _state = [[ALCanvas2DState alloc] init];
  _stack = [NSMutableArray array];
  if (width == 0 || height == 0) {
    _data = [NSMutableData data];
    return YES;
  }
  _data = [NSMutableData dataWithLength:width * height * 4];
  if (!_data) return NO;
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  _cg = CGBitmapContextCreate(_data.mutableBytes, width, height, 8, width * 4, space,
                              kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!_cg) return NO;
  // The canvas's top-left origin, y down: Core Graphics' is bottom-left.
  CGContextTranslateCTM(_cg, 0, height);
  CGContextScaleCTM(_cg, 1, -1);
  // A canvas with alpha: false is opaque black until drawn on.
  if (!_alpha) [self fillOpaqueBlack:CGRectMake(0, 0, width, height) path:NULL];
  return YES;
}

/// What clearRect leaves on a canvas without alpha: black.
- (void)fillOpaqueBlack:(CGRect)rect path:(CGPathRef)path {
  CGContextSaveGState(_cg);
  CGContextSetBlendMode(_cg, kCGBlendModeCopy);
  CGContextSetRGBFillColor(_cg, 0, 0, 0, 1);
  if (path) {
    CGContextAddPath(_cg, path);
    CGContextFillPath(_cg);
  } else {
    CGContextFillRect(_cg, rect);
  }
  CGContextRestoreGState(_cg);
}

#pragma mark Showing the bitmap

- (void)attachTarget:(AngularLynxCanvasTarget *)target {
  if (_target == target) return;
  _target = target;
  if (target) [self present];
}

- (void)targetDidLayOut:(AngularLynxCanvasTarget *)target {
  if (target == _target && _framePending) [self present];
}

/// A copy of the bitmap goes to the view: drawing on goes on in the bitmap
/// while the UI thread shows the copy.
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

/// A copy of the bitmap as an image, or NULL when it has no pixels.
- (CGImageRef)newImage {
  if (!_cg) return NULL;
  NSData *copy = [_data copy];
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)copy);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGImageRef image = CGImageCreate(
      _width, _height, 8, 32, _width * 4, space,
      (_alpha ? kCGImageAlphaPremultipliedLast : kCGImageAlphaNoneSkipLast) |
          kCGBitmapByteOrder32Big,
      provider, NULL, false, kCGRenderingIntentDefault);
  CGColorSpaceRelease(space);
  CGDataProviderRelease(provider);
  return image;
}

- (AngularLynxDecodedImage *)snapshot {
  if (!_cg) return nil;
  return [[AngularLynxDecodedImage alloc] initWithPixels:[_data copy]
                                                   width:_width
                                                  height:_height
                                           premultiplied:YES];
}

/// After transferToImageBitmap() took the bitmap: a new one, transparent
/// black, or opaque black without alpha (premultiplied black is all zeros
/// but its alpha). Cleared byte by byte, so the clip and the state stay.
- (void)clearForTransfer {
  if (!_cg) return;
  uint8_t *bytes = _data.mutableBytes;
  NSUInteger length = _data.length;
  memset(bytes, 0, length);
  if (!_alpha) {
    for (NSUInteger i = 3; i < length; i += 4) bytes[i] = 255;
  }
  if (_target) [self present];
}

- (NSDictionary *)encodeImageOfType:(NSString *)type quality:(double)quality {
  if (!_cg) return @{@"error" : @"The canvas has no pixels"};
  BOOL jpeg = [type isEqualToString:@"image/jpeg"];
  // A JPEG has no transparency: its transparent pixels come out black, as in
  // browsers, which premultiplied colors already are.
  CGBitmapInfo alphaInfo = (CGBitmapInfo)(jpeg || !_alpha ? kCGImageAlphaNoneSkipLast
                                                          : kCGImageAlphaPremultipliedLast);
  return AngularLynxEncodeImage([_data copy], _width, _height, alphaInfo, type, quality);
}

#pragma mark Running a batch

- (NSArray *)run:(NSArray *)commands {
  NSUInteger count = commands.count;
  __unsafe_unretained id *items = (__unsafe_unretained id *)malloc(sizeof(id) * MAX(count, 1));
  [commands getObjects:items range:NSMakeRange(0, count)];
  ALReader reader = {items, count, 0};
  ALReader *r = &reader;
  NSMutableArray *results = [NSMutableArray array];
  while (r->index < r->count) {
    NSInteger op = readInt(r);
    if (op >= 200) {
      id result = [self query:op reader:r];
      [results addObject:result ?: [NSNull null]];
    } else {
      [self command:op reader:r];
    }
  }
  free(items);
  return results;
}

- (ALStyle)styleOfKind:(ALStyleKind)kind reader:(ALReader *)r {
  ALStyle style = {kind, {0, 0, 0, 1}, 0, CGAffineTransformIdentity};
  if (kind == ALStyleColor) {
    for (int i = 0; i < 4; i++) style.rgba[i] = readNumber(r);
  } else if (kind == ALStylePattern) {
    style.objectId = readInt(r);
    CGFloat a = readNumber(r), b = readNumber(r), c = readNumber(r), d = readNumber(r),
            e = readNumber(r), f = readNumber(r);
    style.transform = CGAffineTransformMake(a, b, c, d, e, f);
  }
  return style;
}

/// A gradient as the runtime sends it with a style: its type, six numbers,
/// and its stops as offset, red, green, blue, alpha.
- (ALCanvas2DGradient *)gradientFrom:(ALReader *)r {
  ALCanvas2DGradient *gradient = [[ALCanvas2DGradient alloc] init];
  gradient.type = readInt(r);
  gradient.p0 = readNumber(r);
  gradient.p1 = readNumber(r);
  gradient.p2 = readNumber(r);
  gradient.p3 = readNumber(r);
  gradient.p4 = readNumber(r);
  gradient.p5 = readNumber(r);
  NSArray *stops = readArray(r);
  for (NSUInteger i = 0; i + 4 < stops.count; i += 5) {
    [gradient addStop:[stops[i] doubleValue]
                    r:[stops[i + 1] doubleValue]
                    g:[stops[i + 2] doubleValue]
                    b:[stops[i + 3] doubleValue]
                    a:[stops[i + 4] doubleValue]];
  }
  return gradient;
}

- (void)command:(NSInteger)op reader:(ALReader *)r {
  ALCanvas2DState *s = _state;
  switch ((ALCanvas2DOp)op) {
    case ALCanvas2DOpSave:
      [_stack addObject:[s copy]];
      if (_cg) CGContextSaveGState(_cg);
      break;
    case ALCanvas2DOpRestore:
      if (_stack.count == 0) break;
      _state = _stack.lastObject;
      [_stack removeLastObject];
      if (_cg) CGContextRestoreGState(_cg);
      break;
    case ALCanvas2DOpReset:
      [self allocateWidth:_width height:_height];
      break;
    case ALCanvas2DOpResize: {
      size_t width = (size_t)MAX(0, readInt(r));
      size_t height = (size_t)MAX(0, readInt(r));
      [self allocateWidth:width height:height];
      break;
    }
    case ALCanvas2DOpPresent:
      [self present];
      break;
    case ALCanvas2DOpSetTransform: {
      CGFloat a = readNumber(r), b = readNumber(r), c = readNumber(r), d = readNumber(r),
              e = readNumber(r), f = readNumber(r);
      s.transform = CGAffineTransformMake(a, b, c, d, e, f);
      break;
    }
    case ALCanvas2DOpSetGlobalAlpha:
      s.globalAlpha = readNumber(r);
      break;
    case ALCanvas2DOpSetCompositeOperation: {
      NSInteger composite = readInt(r);
      s.composite = composite >= 0 && composite < BLEND_MODE_COUNT ? composite : 0;
      break;
    }
    case ALCanvas2DOpSetFillColor:
      s.fill = [self styleOfKind:ALStyleColor reader:r];
      break;
    case ALCanvas2DOpSetFillGradient:
      s.fill = [self styleOfKind:ALStyleGradient reader:r];
      s.fillGradient = [self gradientFrom:r];
      break;
    case ALCanvas2DOpSetFillPattern:
      s.fill = [self styleOfKind:ALStylePattern reader:r];
      break;
    case ALCanvas2DOpSetStrokeColor:
      s.stroke = [self styleOfKind:ALStyleColor reader:r];
      break;
    case ALCanvas2DOpSetStrokeGradient:
      s.stroke = [self styleOfKind:ALStyleGradient reader:r];
      s.strokeGradient = [self gradientFrom:r];
      break;
    case ALCanvas2DOpSetStrokePattern:
      s.stroke = [self styleOfKind:ALStylePattern reader:r];
      break;
    case ALCanvas2DOpSetLineWidth:
      s.lineWidth = readNumber(r);
      break;
    case ALCanvas2DOpSetLineCap: {
      NSInteger cap = readInt(r);
      s.lineCap = cap == 1 ? kCGLineCapRound : cap == 2 ? kCGLineCapSquare : kCGLineCapButt;
      break;
    }
    case ALCanvas2DOpSetLineJoin: {
      NSInteger join = readInt(r);
      s.lineJoin = join == 1 ? kCGLineJoinRound : join == 2 ? kCGLineJoinBevel : kCGLineJoinMiter;
      break;
    }
    case ALCanvas2DOpSetMiterLimit:
      s.miterLimit = readNumber(r);
      break;
    case ALCanvas2DOpSetLineDash:
      s.lineDash = readArray(r);
      s.lineDashOffset = readNumber(r);
      break;
    case ALCanvas2DOpSetShadow:
      s.shadowBlur = readNumber(r);
      s.shadowR = readNumber(r);
      s.shadowG = readNumber(r);
      s.shadowB = readNumber(r);
      s.shadowA = readNumber(r);
      s.shadowOffsetX = readNumber(r);
      s.shadowOffsetY = readNumber(r);
      break;
    case ALCanvas2DOpSetFont: {
      BOOL italic = readInt(r) != 0;
      NSInteger weight = readInt(r);
      CGFloat size = readNumber(r);
      NSString *families = readString(r);
      s.font = fontFor(families, weight, italic, MAX(size, 0.01));
      break;
    }
    case ALCanvas2DOpSetTextAlign:
      s.textAlign = readInt(r);
      break;
    case ALCanvas2DOpSetTextBaseline:
      s.textBaseline = readInt(r);
      break;
    case ALCanvas2DOpSetDirection:
      s.rtl = readInt(r) == 1;
      break;
    case ALCanvas2DOpSetLetterSpacing:
      s.letterSpacing = readNumber(r);
      break;
    case ALCanvas2DOpSetImageSmoothing:
      s.smoothing = readInt(r) != 0;
      s.smoothingQuality = readInt(r);
      break;
    case ALCanvas2DOpSetFilter:
      // Only the steps: the layers are planned from their own reach (see
      // -planFor:...).
      s.filterSteps = readArray(r);
      break;
    case ALCanvas2DOpCreatePattern: {
      NSInteger objectId = readInt(r);
      NSDictionary *source = readMap(r);
      NSInteger repetition = readInt(r);
      CGImageRef image = [self newImageFrom:source];
      if (!image) break;
      ALCanvas2DPattern *pattern = [[ALCanvas2DPattern alloc] init];
      pattern.image = image;
      pattern.repetition = repetition;
      _objects[@(objectId)] = pattern;
      break;
    }
    case ALCanvas2DOpReleaseObject:
      [_objects removeObjectForKey:@(readInt(r))];
      break;
    case ALCanvas2DOpClearPath: {
      CGMutablePathRef path = pathFromSegments(readArray(r));
      [self clearPath:path];
      CGPathRelease(path);
      break;
    }
    case ALCanvas2DOpFill: {
      CGMutablePathRef path = pathFromSegments(readArray(r));
      BOOL evenOdd = readInt(r) == 1;
      [self fillDevicePath:path evenOdd:evenOdd style:s.fill gradient:s.fillGradient];
      CGPathRelease(path);
      break;
    }
    case ALCanvas2DOpStroke: {
      CGMutablePathRef path = pathFromSegments(readArray(r));
      [self strokeDevicePath:path];
      CGPathRelease(path);
      break;
    }
    case ALCanvas2DOpClip: {
      CGMutablePathRef path = pathFromSegments(readArray(r));
      BOOL evenOdd = readInt(r) == 1;
      if (_cg) {
        CGContextBeginPath(_cg);
        CGContextAddPath(_cg, path);
        // An empty path clips everything away.
        if (CGPathIsEmpty(path)) {
          CGContextClipToRect(_cg, CGRectZero);
        } else if (evenOdd) {
          CGContextEOClip(_cg);
        } else {
          CGContextClip(_cg);
        }
      }
      CGPathRelease(path);
      break;
    }
    case ALCanvas2DOpFillText:
    case ALCanvas2DOpStrokeText: {
      NSString *text = readString(r);
      CGFloat x = readNumber(r), y = readNumber(r), maxWidth = readNumber(r);
      [self drawText:text x:x y:y maxWidth:maxWidth stroke:op == ALCanvas2DOpStrokeText];
      break;
    }
    case ALCanvas2DOpDrawImage: {
      NSDictionary *source = readMap(r);
      CGFloat sx = readNumber(r), sy = readNumber(r), sw = readNumber(r), sh = readNumber(r);
      CGFloat dx = readNumber(r), dy = readNumber(r), dw = readNumber(r), dh = readNumber(r);
      CGImageRef image = [self newImageFrom:source];
      if (image) {
        [self drawImage:image
                 source:CGRectMake(sx, sy, sw, sh)
            destination:CGRectMake(dx, dy, dw, dh)];
        CGImageRelease(image);
      }
      break;
    }
    case ALCanvas2DOpPutImageData: {
      NSData *bytes = AngularLynxBytesFromWords(readArray(r));
      NSInteger width = readInt(r), height = readInt(r), x = readInt(r), y = readInt(r);
      [self putPixels:bytes width:width height:height x:x y:y];
      break;
    }
    default:
      // An unknown command can't be skipped past: the rest of the batch
      // would be read as the wrong arguments.
      r->index = r->count;
  }
}

- (id)query:(NSInteger)op reader:(ALReader *)r {
  switch ((ALCanvas2DOp)op) {
    case ALCanvas2DOpMeasureText:
      return [self measureText:readString(r)];
    case ALCanvas2DOpGetImageData: {
      NSInteger x = readInt(r), y = readInt(r), width = readInt(r), height = readInt(r);
      return [self pixelsAtX:x y:y width:width height:height];
    }
    case ALCanvas2DOpIsPointInPath: {
      CGMutablePathRef path = pathFromSegments(readArray(r));
      BOOL evenOdd = readInt(r) == 1;
      CGFloat x = readNumber(r), y = readNumber(r);
      BOOL inside = CGPathContainsPoint(path, NULL, CGPointMake(x, y), evenOdd);
      CGPathRelease(path);
      return @(inside);
    }
    case ALCanvas2DOpIsPointInStroke: {
      CGMutablePathRef path = pathFromSegments(readArray(r));
      CGFloat x = readNumber(r), y = readNumber(r);
      CGPathRef outline = [self strokeOutlineOf:path];
      BOOL inside = outline && CGPathContainsPoint(outline, NULL, CGPointMake(x, y), NO);
      if (outline) CGPathRelease(outline);
      CGPathRelease(path);
      return @(inside);
    }
    default:
      r->index = r->count;
      return nil;
  }
}

#pragma mark Compositing

- (BOOL)shadowVisible {
  ALCanvas2DState *s = _state;
  return s.shadowA > 0 && (s.shadowBlur > 0 || s.shadowOffsetX != 0 || s.shadowOffsetY != 0);
}

/// The most a layer at the canvas's resolution reaches past the part of the
/// canvas it's for, so a huge blur makes no huge layer. A blur or shadow
/// that reaches farther goes through a smaller layer too (see
/// -layers:count:), which this keeps about the capped layer's size.
static const CGFloat MAX_REACH = 256;

/// The deviation, in a smaller layer's pixels, from which a blur is worked
/// out there and scaled up (see isWide): a blur that wide has no detail a
/// pixel of that layer would lose.
static const CGFloat WIDE_SIGMA = 4;

/// Whether a step blurs widely enough, in a layer at `scale`, to be worked
/// out there and scaled up: its deviation there is at least WIDE_SIGMA of
/// the layer's pixels, so the detail the smaller layer loses is blurred
/// away. Skia scales a wide blur down the same way.
static BOOL isWide(const ALFilterStep *step, CGFloat scale) {
  return stepSigma(step) * scale >= WIDE_SIGMA;
}

/// How far off the canvas a far drop shadow's layer can lie: 2^24 pixels,
/// past which a float, as the canvas's pixels are on Android, no longer
/// holds every whole pixel. Kept the same on both shells.
static const double MAX_LAYER_OFFSET = 16777216;

static double reachOf(const ALFilterStep *steps, NSUInteger count) {
  double reach = 0;
  for (NSUInteger i = 0; i < count; i++) reach += stepReach(&steps[i]);
  return reach;
}

/// The index of the last far drop shadow in the steps, or -1. When the
/// steps reach past MAX_REACH, a drop shadow moved by an offset is far (up
/// to the filter's last few, castsAlone, as each doubles the draws): it's
/// cast from a layer of its own (-newFarShadow:...), so its offset
/// doesn't count toward the reach the layers are planned for. Counted, an
/// offset past the cap would leave out a shape that far off the canvas
/// (issue #824), as the capped layer doesn't reach it, and it would lower
/// the scale of the smaller layer a wide blur goes through, enough to keep a
/// blur beside it at the canvas's resolution, cut short by the cap.
static NSInteger lastFar(const ALFilterStep *steps, NSUInteger count) {
  if (!(reachOf(steps, count) > MAX_REACH)) return -1;
  for (NSUInteger i = count; i > 0; i--) {
    if (steps[i - 1].castsAlone) return (NSInteger)(i - 1);
  }
  return -1;
}

/// How far the steps the layers are planned for reach: those after the last
/// far drop shadow (lastFar).
static double plannedReach(const ALFilterStep *steps, NSUInteger count) {
  NSUInteger first = (NSUInteger)(lastFar(steps, count) + 1);
  return reachOf(steps + first, count - first);
}

/// A layer over `base` grown by `reach`, at `scale`, which keeps it about
/// the size `base` grown by MAX_REACH is.
static ALLayer lowLayer(ALLayer base, double reach, double scale) {
  // (side + 2 * reach) * scale, without multiplying a huge reach out.
  return (ALLayer){YES,
                   base.left - reach,
                   base.top - reach,
                   (size_t)ceil(base.width / base.scale * scale + 2 * reach * scale),
                   (size_t)ceil(base.height / base.scale * scale + 2 * reach * scale),
                   scale};
}

/// The layers one filtered draw (or the shadow cast from it) goes into:
/// `full`, at the canvas's resolution, and `low`, a smaller one that reaches
/// as far as the filter's wide blurs do (see -newRendered:...), or either
/// alone. The shape's plan always has `full`.
typedef struct {
  ALLayer full;
  ALLayer low;
} ALPlan;

static const ALPlan NO_PLAN = {{NO, 0, 0, 0, 0, 0}, {NO, 0, 0, 0, 0, 0}};

/// The plan the shape is drawn into, and the one the shadow is cast from,
/// or NO_PLAN, when it's cast from the shape's.
typedef struct {
  ALPlan shape;
  ALPlan shadow;
} ALLayers;

static CGFloat area(CGRect rect) {
  return rect.size.width * rect.size.height;
}

/// The plan for a filtered draw that needs `base` (the canvas, the canvas
/// moved back by the shadow's offset, or a layer a far drop shadow is worked
/// out over) and the filter's reach round it, and `extra` more for the full
/// layer (a shadow's blur, when the shadow is cast from it).
///
/// The full layer is at `base`'s resolution, grown by the reach, capped at
/// MAX_REACH of its pixels, so a huge blur makes no huge layer. Past the
/// cap, when a step blurs widely (isWide), a low layer, scaled down by
/// MAX_REACH over the reach, takes in the whole reach at about the size the
/// capped layer was (issue #814), and the full layer needs to reach only as
/// far as the steps after the last wide blur do.
///
/// The reach is the steps' own, from those after the last far drop shadow
/// (lastFar), which casts from a layer of its own. That's why the runtime
/// sends only the steps: the whole filter's reach, which it once sent too,
/// is too much for part of the filter and too little for a layer at another
/// resolution.
- (ALPlan)planFor:(ALLayer)base
            steps:(const ALFilterStep *)allSteps
            count:(NSUInteger)allCount
            extra:(CGFloat)extra {
  NSUInteger first = (NSUInteger)(lastFar(allSteps, allCount) + 1);
  const ALFilterStep *steps = allSteps + first;
  NSUInteger count = allCount - first;
  double reach = reachOf(steps, count);
  double margin = reach + extra;
  ALLayer low = NO_LAYER;
  if (reach * base.scale > MAX_REACH && isfinite(reach)) {
    double scale = MAX_REACH / reach;
    NSInteger lastWideBlur = -1;
    BOOL anyWide = NO;
    for (NSUInteger i = 0; i < count; i++) {
      if (!isWide(&steps[i], scale)) continue;
      anyWide = YES;
      if (steps[i].kind == ALFilterBlur) lastWideBlur = (NSInteger)i;
    }
    if (anyWide) {
      double after = 0;
      for (NSUInteger i = (NSUInteger)(lastWideBlur + 1); i < count; i++) {
        if (!isWide(&steps[i], scale)) after += stepReach(&steps[i]);
      }
      margin = after + extra;
      low = lowLayer(base, reach, scale);
    }
  }
  return (ALPlan){grownLayer(base, (size_t)ceil(MIN(margin * base.scale, MAX_REACH))), low};
}

/// Where, in the canvas's pixels, the layers a draw goes into lie (see
/// composite:). The shape's is the canvas grown by the filter's reach, so a
/// shape just off the canvas still blurs onto it (see -planFor:...). With a
/// shadow, the shadow needs the part of the shape that casts onto the
/// canvas: the canvas moved back by the shadow's offset, grown by its blur
/// (three of its deviations, which are half the blur) and the filter's
/// reach.
///
/// Within MAX_REACH of that, when one rectangle round both is no bigger than
/// the two, the shape's layer grows to take that part in, and the shadow's
/// plan is NO_PLAN. Otherwise it's a second layer: one rectangle round both
/// would grow with the offset, and a shadow cast from far off the canvas
/// (shadowOffsetX = 10000 and a shape at x = -10000) would make a huge
/// layer, or, capped, cut the shape away.
///
/// Past MAX_REACH, the shadow's layer is a smaller one that takes in the
/// whole reach (issue #814): a 1000 px shadowBlur reaches 1500 px, and a
/// layer that far round the canvas would be thousands of pixels a side.
/// When the shadow's blur is wide at that layer's scale (WIDE_SIGMA), the
/// shape is drawn, filtered and cast from in it, and the shadow is scaled up
/// as it's drawn, as Skia scales a wide blur down: the detail the layer
/// loses is blurred away. Otherwise the reach is the filter's, and the
/// shadow's layer is planned as the shape's is, grown by the shadow's blur
/// too.
- (ALLayers)layers:(const ALFilterStep *)steps count:(NSUInteger)count {
  ALCanvas2DState *s = _state;
  CGRect canvas = CGRectMake(0, 0, _width, _height);
  ALPlan shape = [self planFor:layerOfRect(canvas) steps:steps count:count extra:0];
  if (![self shadowVisible]) return (ALLayers){shape, NO_PLAN};
  CGFloat blurReach = ceil(s.shadowBlur * 1.5);
  // A far drop shadow casts from a layer of its own (see -planFor:...).
  double fullReach = plannedReach(steps, count) + blurReach;
  CGRect moved = CGRectOffset(canvas, -s.shadowOffsetX, -s.shadowOffsetY);
  if (fullReach > MAX_REACH) {
    // Whole pixels, so a full layer's pixels line up with the canvas's.
    CGRect base = CGRectIntegral(moved);
    double scale = MAX_REACH / fullReach;
    if (isfinite(fullReach) && s.shadowBlur / 2 * scale >= WIDE_SIGMA) {
      return (ALLayers){shape, {NO_LAYER, lowLayer(layerOfRect(base), fullReach, scale)}};
    }
    return (ALLayers){shape, [self planFor:layerOfRect(base) steps:steps count:count extra:blurReach]};
  }
  // Within MAX_REACH, so is the filter's reach: the shape's plan is a layer
  // at the canvas's resolution alone.
  CGRect source = CGRectIntegral(CGRectInset(moved, -fullReach, -fullReach));
  CGRect shapeRect = layerBounds(shape.full);
  CGRect both = CGRectUnion(shapeRect, source);
  if (area(both) > area(shapeRect) + area(source)) {
    return (ALLayers){shape, {layerOfRect(source), NO_LAYER}};
  }
  return (ALLayers){{layerOfRect(both), NO_LAYER}, NO_PLAN};
}

/// What `draw` draws into `layer`, as new bytes the caller frees (NULL if
/// they can't be made): premultiplied RGBA, rows top to bottom, and, with a
/// filter, through globalAlpha.
///
/// The canvas spec takes what's drawn through globalAlpha first, then the
/// filter, then casts the shadow and composites, outside the clip until then
/// (since whatwg/html#10674): so a drop-shadow() shows through a see-through
/// shape. Without a filter, the alpha goes on as the layer's drawn, which
/// comes to the same.
- (uint8_t *)newDrawn:(ALLayer)layer draw:(void (^)(CGContextRef c))draw {
  size_t width = layer.width, height = layer.height;
  if (width == 0 || height == 0) return NULL;
  uint8_t *bytes = calloc(width * height * 4, 1);
  if (!bytes) return NULL;
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef c = CGBitmapContextCreate(bytes, width, height, 8, width * 4, space,
                                         kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!c) {
    free(bytes);
    return NULL;
  }
  // The canvas's flip, and the layer's place in its pixels, worked out
  // first in doubles: a small layer's left can be far off the canvas.
  CGContextTranslateCTM(c, 0, height);
  CGContextScaleCTM(c, 1, -1);
  CGContextTranslateCTM(c, -layer.left * layer.scale, -layer.top * layer.scale);
  if (layer.scale != 1) CGContextScaleCTM(c, layer.scale, layer.scale);
  draw(c);
  CGContextRelease(c);
  if (_state.filterSteps.count > 0) scaleAlpha(bytes, width * height, _state.globalAlpha);
  return bytes;
}

/// What `draw` draws through the filter's steps, as `plan` has it: new
/// bytes (which the caller frees, NULL if they can't be made) over its
/// `full` layer, or over its `low` one when it has only that.
///
/// With both, the low layer is drawn too, and the steps whose deviation is
/// wide enough there (isWide) are worked out in it and scaled up onto the
/// full one (newResampled): a wide blur replaces the full layer (so the
/// steps before it are worked out only in the low one), and a wide drop
/// shadow's shadow goes under it. The other steps are applied in both. So
/// whatever the wide steps bring onto the canvas from past the full layer's
/// reach comes from the low one, which reaches as far as the steps do, and
/// the rest keeps the full layer's resolution.
///
/// A far drop shadow (lastFar) is cast from a layer of its own (see
/// -newFarShadow:...), so the plan is for the steps after the last one, and
/// the steps up to it are worked out over each of the plan's layers in
/// place of what `draw` draws there.
- (uint8_t *)newRendered:(ALPlan)plan
                   steps:(const ALFilterStep *)allSteps
                   count:(NSUInteger)allCount
                    draw:(void (^)(CGContextRef c))draw {
  NSInteger far = lastFar(allSteps, allCount);
  const ALFilterStep *steps = allSteps + (far + 1);
  NSUInteger count = allCount - (NSUInteger)(far + 1);
  uint8_t * (^source)(ALLayer) = ^uint8_t *(ALLayer layer) {
    if (far < 0) return [self newDrawn:layer draw:draw];
    return [self newFarShadow:layer steps:allSteps count:(NSUInteger)far + 1 draw:draw];
  };
  ALLayer full = plan.full, low = plan.low;
  if (!full.exists || !low.exists) {
    ALLayer only = full.exists ? full : low;
    if (!only.exists) return NULL;
    uint8_t *bytes = source(only);
    if (!bytes) return NULL;
    for (NSUInteger i = 0; i < count; i++) {
      applyStep(bytes, only.width, only.height, &steps[i], only.scale);
    }
    return bytes;
  }
  NSInteger lastWide = -1, lastWideBlur = -1;
  for (NSUInteger i = 0; i < count; i++) {
    if (!isWide(&steps[i], low.scale)) continue;
    lastWide = (NSInteger)i;
    if (steps[i].kind == ALFilterBlur) lastWideBlur = (NSInteger)i;
  }
  uint8_t *lowBytes = source(low);
  if (!lowBytes) return NULL;
  uint8_t *fullBytes = NULL;
  if (lastWideBlur < 0) {
    fullBytes = source(full);
    if (!fullBytes) {
      free(lowBytes);
      return NULL;
    }
  }
  BOOL failed = NO;
  for (NSUInteger i = 0; i < count && !failed; i++) {
    const ALFilterStep *step = &steps[i];
    if (!isWide(step, low.scale)) {
      // The low layer is read only up to the last wide step.
      if ((NSInteger)i < lastWide) applyStep(lowBytes, low.width, low.height, step, low.scale);
      if (fullBytes) applyStep(fullBytes, full.width, full.height, step, full.scale);
    } else if (step->kind == ALFilterBlur) {
      applyStep(lowBytes, low.width, low.height, step, low.scale);
      if ((NSInteger)i == lastWideBlur) {
        fullBytes = newResampled(lowBytes, low, full, 0, 0);
        failed = !fullBytes;
      }
    } else {
      // The shadow is cast unmoved, then moved as it's resampled onto each
      // layer, so its offset needn't be whole pixels of the low one.
      const double *v = step->values;
      uint8_t *cast = newShadowBytes(lowBytes, low.width, low.height, 0, 0, v[2] * low.scale,
                                     v[3], v[4], v[5], v[6]);
      if (!cast) {
        failed = YES;
        break;
      }
      if (fullBytes) {
        uint8_t *moved = newResampled(cast, low, full, v[0], v[1]);
        if (moved) drawUnder(fullBytes, moved, full.width * full.height);
        failed = !moved;
        free(moved);
      }
      if (!failed && (NSInteger)i < lastWide) {
        uint8_t *moved = newResampled(cast, low, low, v[0], v[1]);
        if (moved) drawUnder(lowBytes, moved, low.width * low.height);
        failed = !moved;
        free(moved);
      }
      free(cast);
    }
  }
  free(lowBytes);
  if (failed) {
    free(fullBytes);
    return NULL;
  }
  return fullBytes;
}

/// What `draw` draws through the alpha and the steps, which end with a far
/// drop shadow (lastFar), over `layer`, as new bytes the caller frees (NULL
/// if they can't be made): the steps before it, worked out over the layer,
/// with the shadow under them, cast from those steps worked out over the
/// layer moved back by the shadow's offset. That layer takes in the shape
/// the shadow is cast from however far off the canvas it lies, and it's the
/// size `layer` is, as the canvas shadow casts from a layer of its own (see
/// -layers:count:).
///
/// The shadow's own blur goes on there as a blur step after the others, so
/// a wide one is worked out in a smaller layer as any blur is (see
/// -planFor:...), and the shadow is the alpha that leaves, in its color: a
/// blur blurs each channel alike, so that's the alpha blurred, as
/// newShadowBytes casts it. The offset isn't rounded: the moved layer
/// needn't lie on whole pixels, as only its bytes are used, each landing on
/// the pixel of `layer` it's moved onto, so a fractional offset draws the
/// shape between pixels there, as it lands on the canvas. A wide shadow's
/// offset, resampled from the smaller layer, kept its fraction before this
/// too.
- (uint8_t *)newFarShadow:(ALLayer)layer
                    steps:(const ALFilterStep *)steps
                    count:(NSUInteger)count
                     draw:(void (^)(CGContextRef c))draw {
  NSUInteger before = count - 1;
  const double *v = steps[before].values;
  uint8_t *shape = [self newOver:layer steps:steps count:before draw:draw];
  if (!shape) return NULL;
  // Past where a shadow's layer can lie, the canvas's pixels place no shape
  // the shadow could be cast from.
  if (fabs(v[0]) > MAX_LAYER_OFFSET || fabs(v[1]) > MAX_LAYER_OFFSET) return shape;
  // The steps before the shadow, then its blur.
  ALFilterStep *blurred = malloc(sizeof(ALFilterStep) * count);
  if (!blurred) {
    free(shape);
    return NULL;
  }
  memcpy(blurred, steps, sizeof(ALFilterStep) * before);
  blurred[before] = (ALFilterStep){ALFilterBlur, {v[2]}, NO};
  uint8_t *cast = [self newOver:movedLayer(layer, -v[0], -v[1]) steps:blurred count:count draw:draw];
  free(blurred);
  uint8_t *shadow = cast ? newShadowBytes(cast, layer.width, layer.height, 0, 0, 0, v[3], v[4],
                                          v[5], v[6])
                         : NULL;
  free(cast);
  if (!shadow) {
    free(shape);
    return NULL;
  }
  drawUnder(shape, shadow, layer.width * layer.height);
  free(shadow);
  return shape;
}

/// What `draw` draws through the alpha and the steps over `layer`, as new
/// bytes the caller frees (NULL if they can't be made): planned round it as
/// any filtered draw is (-planFor:...), and resampled down to it. The plan's
/// full layer lies on its pixels, so that copies them.
- (uint8_t *)newOver:(ALLayer)layer
               steps:(const ALFilterStep *)steps
               count:(NSUInteger)count
                draw:(void (^)(CGContextRef c))draw {
  if (count == 0) return [self newDrawn:layer draw:draw];
  ALPlan plan = [self planFor:layer steps:steps count:count extra:0];
  uint8_t *bytes = [self newRendered:plan steps:steps count:count draw:draw];
  if (!bytes) return NULL;
  if (plan.full.width == layer.width && plan.full.height == layer.height) return bytes;
  uint8_t *cut = newResampled(bytes, plan.full, layer, 0, 0);
  free(bytes);
  return cut;
}

/// Premultiplied RGBA bytes, rows top to bottom, as an image.
static CGImageRef newImageOfBytes(const uint8_t *bytes, size_t width,
                                  size_t height) CF_RETURNS_RETAINED {
  CFDataRef data = CFDataCreate(NULL, bytes, (CFIndex)(width * height * 4));
  if (!data) return NULL;
  CGDataProviderRef provider = CGDataProviderCreateWithCFData(data);
  CFRelease(data);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGImageRef image =
      CGImageCreate(width, height, 8, 32, width * 4, space,
                    kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big, provider, NULL,
                    false, kCGRenderingIntentDefault);
  CGColorSpaceRelease(space);
  CGDataProviderRelease(provider);
  return image;
}

/// What `draw` draws through the plan's layer at the canvas's resolution,
/// as an image over that layer. NULL if the layer can't be made.
- (CGImageRef)newLayerImage:(ALPlan)plan
                      steps:(const ALFilterStep *)steps
                      count:(NSUInteger)count
                       draw:(void (^)(CGContextRef c))draw CF_RETURNS_RETAINED {
  uint8_t *bytes = [self newRendered:plan steps:steps count:count draw:draw];
  if (!bytes) return NULL;
  CGImageRef image = newImageOfBytes(bytes, plan.full.width, plan.full.height);
  free(bytes);
  return image;
}

static CGRect bitmapRect(CGRect rect, size_t height);

/// The shadow a plan with only a smaller layer casts, as an image the
/// canvas's size: cast in that layer, blurred by the shadow's deviation at
/// its scale (newShadowBytes, as drop-shadow() is), and scaled up onto the
/// canvas, moved by the shadow's offset. Core Graphics' own shadow would
/// blur the layer scaled up, at the canvas's resolution. NULL if a layer
/// can't be made.
- (CGImageRef)newScaledShadowOf:(ALPlan)plan
                          steps:(const ALFilterStep *)steps
                          count:(NSUInteger)count
                           draw:(void (^)(CGContextRef c))draw CF_RETURNS_RETAINED {
  ALCanvas2DState *s = _state;
  ALLayer low = plan.low;
  uint8_t *bytes = [self newRendered:plan steps:steps count:count draw:draw];
  if (!bytes) return NULL;
  uint8_t *shadow = newShadowBytes(bytes, low.width, low.height, 0, 0,
                                   s.shadowBlur / 2 * low.scale, s.shadowR, s.shadowG,
                                   s.shadowB, s.shadowA);
  free(bytes);
  if (!shadow) return NULL;
  CGImageRef image = newImageOfBytes(shadow, low.width, low.height);
  free(shadow);
  if (!image) return NULL;
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef bitmap =
      CGBitmapContextCreate(NULL, _width, _height, 8, _width * 4, space,
                            kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!bitmap) {
    CGImageRelease(image);
    return NULL;
  }
  CGContextSetInterpolationQuality(bitmap, kCGInterpolationHigh);
  CGRect bounds = CGRectOffset(layerBounds(low), s.shadowOffsetX, s.shadowOffsetY);
  CGContextDrawImage(bitmap, bitmapRect(bounds, _height), image);
  CGImageRelease(image);
  CGImageRef cast = CGBitmapContextCreateImage(bitmap);
  CGContextRelease(bitmap);
  return cast;
}

/// The part of the canvas's pixels a context draws on: the canvas, or a
/// layer's area, from the context's own size and transform.
static CGRect drawableRect(CGContextRef c) {
  CGRect device =
      CGRectMake(0, 0, CGBitmapContextGetWidth(c), CGBitmapContextGetHeight(c));
  return CGRectApplyAffineTransform(device, CGAffineTransformInvert(CGContextGetCTM(c)));
}

/// A rectangle of the canvas's pixels (y down) in the bitmap's own space
/// (y up), for a canvas `height` pixels tall.
static CGRect bitmapRect(CGRect rect, size_t height) {
  return CGRectMake(rect.origin.x, (CGFloat)height - CGRectGetMaxY(rect), rect.size.width,
                    rect.size.height);
}

/// Draws with the state's alpha, compositing and shadow. `draw` draws in a
/// context whose space is the canvas's pixels, with nothing else set.
///
/// Core Graphics draws an operation like source-in only where the shape
/// covers, and a shadow for each thing drawn; the canvas spec composites
/// the whole canvas, and the shadow of the shape as a whole. So for those,
/// the shape is drawn into a transparent layer over the canvas (see
/// -layers), which is drawn over it with the operation and the shadow. A
/// filter works on pixels, so it needs the layer too: it's applied to the
/// layer first.
- (void)composite:(void (^)(CGContextRef c))draw {
  if (!_cg) return;
  ALCanvas2DState *s = _state;
  CGContextRef c = _cg;
  BOOL shadow = [self shadowVisible];
  BOOL filtered = s.filterSteps.count > 0;
  if (!shadow && !filtered && !isUnbounded(s.composite)) {
    CGContextSaveGState(c);
    CGContextSetAlpha(c, s.globalAlpha);
    CGContextSetBlendMode(c, BLEND_MODES[s.composite]);
    draw(c);
    CGContextRestoreGState(c);
    [self keepOpaque];
    return;
  }
  NSData *parsed = parsedFilter(s.filterSteps);
  const ALFilterStep *steps = parsed.bytes;
  NSUInteger count = parsed.length / sizeof(ALFilterStep);
  ALLayers layers = [self layers:steps count:count];
  CGImageRef image = [self newLayerImage:layers.shape steps:steps count:count draw:draw];
  if (!image) return;
  CGRect shapeRect = layerBounds(layers.shape.full);
  // The shadow's own layer at the canvas's resolution, or a smaller one
  // alone, whose shadow is scaled up (see -layers:count:).
  BOOL scaledShadow = !layers.shadow.full.exists && layers.shadow.low.exists;
  CGImageRef shadowImage = NULL;
  CGRect shadowRect = CGRectNull;
  if (layers.shadow.full.exists) {
    shadowRect = layerBounds(layers.shadow.full);
    shadowImage = [self newLayerImage:layers.shadow steps:steps count:count draw:draw];
    if (!shadowImage) {
      CGImageRelease(image);
      return;
    }
  }
  // The spec composites the shadow, then the shape, each over the whole
  // clip with the operation (its drawing model's steps 6 and 7). With an
  // operation like source-in, Core Graphics composites only the shape, and
  // drops the shadow's step, so for those the shadow is cast alone into an
  // image of its own, and the two are drawn one after the other. So is one
  // scaled up from a smaller layer, which Core Graphics doesn't cast.
  CGImageRef cast = NULL;
  if (shadow && (isUnbounded(s.composite) || scaledShadow)) {
    if (scaledShadow) {
      cast = [self newScaledShadowOf:layers.shadow steps:steps count:count draw:draw];
    } else {
      cast = shadowImage ? [self newShadowOf:shadowImage rect:shadowRect]
                         : [self newShadowOf:image rect:shapeRect];
    }
    // A layer that can't be made drops the draw, as the shape's does.
    if (!cast) {
      CGImageRelease(shadowImage);
      CGImageRelease(image);
      return;
    }
  }
  CGContextSaveGState(c);
  CGContextSetAlpha(c, filtered ? 1 : s.globalAlpha);
  CGContextSetBlendMode(c, BLEND_MODES[s.composite]);
  // Otherwise Core Graphics casts the shadow as the layer's drawn.
  if (shadow && !cast) [self setShadow:c movedBy:0];
  // The layers' images are drawn in the bitmap's own space, where their rows
  // already lie top to bottom.
  CGContextScaleCTM(c, 1, -1);
  CGContextTranslateCTM(c, 0, -(CGFloat)_height);
  if (cast) {
    CGContextDrawImage(c, CGRectMake(0, 0, _width, _height), cast);
  } else if (shadowImage) {
    // Only the shadow's layer's shadow is drawn: the layer is moved left off
    // the bitmap, and the shadow's offset right by as much, which Core
    // Graphics casts to the same pixels (it casts the shadow of what's drawn
    // off the bitmap). Then the shape's layer is drawn without one, as the
    // spec composites the shadow, then the shape.
    CGFloat away = MAX(0, CGRectGetMaxX(shadowRect));
    [self setShadow:c movedBy:away];
    CGContextDrawImage(c, CGRectOffset(bitmapRect(shadowRect, _height), -away, 0), shadowImage);
    CGContextSetShadowWithColor(c, CGSizeZero, 0, NULL);
  }
  CGContextDrawImage(c, bitmapRect(shapeRect, _height), image);
  CGContextRestoreGState(c);
  CGImageRelease(cast);
  CGImageRelease(shadowImage);
  CGImageRelease(image);
  [self keepOpaque];
}

/// Sets the state's shadow on `c`, a context whose own space is the
/// canvas's pixels (or a layer's), y up, moved `dx` pixels further right.
- (void)setShadow:(CGContextRef)c movedBy:(CGFloat)dx {
  ALCanvas2DState *s = _state;
  CGColorRef color = CGColorCreateSRGB(s.shadowR / 255, s.shadowG / 255, s.shadowB / 255,
                                       s.shadowA);
  // A shadow's offset is in the bitmap's own space, y up, whatever the
  // transform, as the canvas's is in its pixels, y down. Its blur is twice
  // the Gaussian's deviation, as the canvas's is.
  CGContextSetShadowWithColor(c, CGSizeMake(s.shadowOffsetX + dx, -s.shadowOffsetY),
                              s.shadowBlur, color);
  CGColorRelease(color);
}

/// The shadow `image`, a layer over `rect` of the canvas's pixels, casts,
/// alone, as an image the canvas's size. The layer is moved left off the
/// bitmap, and its shadow right by as much, so only the shadow lands, with
/// Core Graphics' blur, as an operation like source-over casts it. NULL if
/// the bitmap can't be made.
- (CGImageRef)newShadowOf:(CGImageRef)image rect:(CGRect)rect CF_RETURNS_RETAINED {
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef bitmap =
      CGBitmapContextCreate(NULL, _width, _height, 8, _width * 4, space,
                            kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!bitmap) return NULL;
  CGFloat away = MAX(0, CGRectGetMaxX(rect));
  [self setShadow:bitmap movedBy:away];
  CGContextDrawImage(bitmap, CGRectOffset(bitmapRect(rect, _height), -away, 0), image);
  CGImageRef shadow = CGBitmapContextCreateImage(bitmap);
  CGContextRelease(bitmap);
  return shadow;
}

/// An opaque canvas stays opaque: what an operation like copy or
/// destination-out left see-through is put over black, as a browser keeps a
/// canvas made with alpha: false. It's done on the bytes, as premultiplied
/// colors are already over black: drawing black under them would be
/// antialiased at the clip's edge, and leave those pixels see-through.
- (void)keepOpaque {
  if (_alpha || !reducesAlpha(_state.composite) || !_cg) return;
  uint8_t *bytes = _data.mutableBytes;
  NSUInteger length = _data.length;
  for (NSUInteger i = 3; i < length; i += 4) bytes[i] = 255;
}

#pragma mark Shapes

/// Fills a path in the canvas's pixels with a style, which is in the space
/// of the current transform.
- (void)fillDevicePath:(CGPathRef)path
               evenOdd:(BOOL)evenOdd
                 style:(ALStyle)style
              gradient:(ALCanvas2DGradient *)styleGradient {
  if (CGPathIsEmpty(path)) return;
  CGAffineTransform transform = _state.transform;
  if (style.kind == ALStyleColor) {
    CGFloat r = style.rgba[0] / 255, g = style.rgba[1] / 255, b = style.rgba[2] / 255,
            a = style.rgba[3];
    [self composite:^(CGContextRef c) {
      CGContextSetRGBFillColor(c, r, g, b, a);
      CGContextAddPath(c, path);
      if (evenOdd) {
        CGContextEOFillPath(c);
      } else {
        CGContextFillPath(c);
      }
    }];
    return;
  }
  id object = style.kind == ALStyleGradient ? styleGradient : _objects[@(style.objectId)];
  if ([object isKindOfClass:ALCanvas2DGradient.class]) {
    ALCanvas2DGradient *gradient = object;
    if (gradient.stops.count == 0) return;
    __weak typeof(self) weakSelf = self;
    [self composite:^(CGContextRef c) {
      CGContextAddPath(c, path);
      if (evenOdd) {
        CGContextEOClip(c);
      } else {
        CGContextClip(c);
      }
      [weakSelf paintGradient:gradient in:c transform:transform];
    }];
    return;
  }
  if ([object isKindOfClass:ALCanvas2DPattern.class]) {
    ALCanvas2DPattern *pattern = object;
    pattern.quality = [self interpolationQuality];
    CGFloat width = CGImageGetWidth(pattern.image);
    CGFloat height = CGImageGetHeight(pattern.image);
    NSInteger repetition = pattern.repetition;
    CGAffineTransform patternTransform = CGAffineTransformConcat(style.transform, transform);
    [self composite:^(CGContextRef c) {
      // Pattern space maps to the bitmap's own space (y up), past the
      // canvas's flip: the pattern's transform, then the canvas's, then the
      // context's own, which is the canvas's flip, or the flip of a layer
      // (for a filter or a shadow) and its place in the canvas's pixels.
      CGAffineTransform matrix = CGAffineTransformConcat(patternTransform, CGContextGetCTM(c));
      // A step longer than the bitmap reaches in pattern space repeats
      // nothing: no-repeat, and the other axis of repeat-x or repeat-y. The
      // bitmap's corners are taken back into pattern space to find how far
      // that is.
      CGFloat once = 1;
      if (invertible(matrix)) {
        CGAffineTransform back = CGAffineTransformInvert(matrix);
        CGRect reach = CGRectApplyAffineTransform(
            CGRectMake(0, 0, CGBitmapContextGetWidth(c), CGBitmapContextGetHeight(c)), back);
        once = 2 * MAX(MAX(fabs(CGRectGetMinX(reach)), fabs(CGRectGetMaxX(reach))),
                       MAX(fabs(CGRectGetMinY(reach)), fabs(CGRectGetMaxY(reach)))) +
               width + height + 1;
      }
      CGFloat xStep = repetition == 0 || repetition == 1 ? width : once;
      CGFloat yStep = repetition == 0 || repetition == 2 ? height : once;
      CGPatternCallbacks callbacks = {0, drawPatternCell, NULL};
      CGPatternRef cg = CGPatternCreate((__bridge void *)pattern, CGRectMake(0, 0, width, height),
                                        matrix, xStep, yStep, kCGPatternTilingConstantSpacing,
                                        true, &callbacks);
      CGColorSpaceRef space = CGColorSpaceCreatePattern(NULL);
      CGContextSetFillColorSpace(c, space);
      CGColorSpaceRelease(space);
      CGFloat alpha = 1;
      CGContextSetFillPattern(c, cg, &alpha);
      CGContextAddPath(c, path);
      if (evenOdd) {
        CGContextEOFillPath(c);
      } else {
        CGContextFillPath(c);
      }
      CGPatternRelease(cg);
    }];
  }
}

- (void)paintGradient:(ALCanvas2DGradient *)gradient
                   in:(CGContextRef)c
            transform:(CGAffineTransform)transform {
  CGGradientRef cg = gradient.gradient;
  if (!cg) return;
  CGGradientDrawingOptions extend =
      kCGGradientDrawsBeforeStartLocation | kCGGradientDrawsAfterEndLocation;
  switch (gradient.type) {
    case 0: {
      // A gradient of no length paints nothing.
      if (gradient.p0 == gradient.p2 && gradient.p1 == gradient.p3) return;
      CGContextConcatCTM(c, transform);
      CGContextDrawLinearGradient(c, cg, CGPointMake(gradient.p0, gradient.p1),
                                  CGPointMake(gradient.p2, gradient.p3), extend);
      break;
    }
    case 1: {
      if (gradient.p0 == gradient.p3 && gradient.p1 == gradient.p4 &&
          gradient.p2 == gradient.p5) {
        return;
      }
      CGContextConcatCTM(c, transform);
      CGContextDrawRadialGradient(c, cg, CGPointMake(gradient.p0, gradient.p1), gradient.p2,
                                  CGPointMake(gradient.p3, gradient.p4), gradient.p5, extend);
      break;
    }
    default:
      [self paintConicGradient:gradient in:c transform:transform];
  }
}

/// A conic gradient, a pixel at a time over what the clip leaves: the color
/// at each pixel's angle around the center, clockwise from the start angle,
/// in the gradient's space.
- (void)paintConicGradient:(ALCanvas2DGradient *)gradient
                        in:(CGContextRef)c
                 transform:(CGAffineTransform)transform {
  if (!invertible(transform)) return;
  CGAffineTransform inverse = CGAffineTransformInvert(transform);
  // What the context draws on: the canvas, or the bigger layer of a filter
  // or a shadow, whose pixels past the canvas can still reach it.
  CGRect bounds =
      CGRectIntegral(CGRectIntersection(CGContextGetClipBoundingBox(c), drawableRect(c)));
  if (CGRectIsEmpty(bounds)) return;
  // A pixel of the context's own, which in the smaller layer of a wide blur
  // or shadow (issue #814) is several of the canvas's: the gradient is
  // worked out at that density, not over every canvas pixel the layer
  // reaches.
  CGAffineTransform ctm = CGContextGetCTM(c);
  CGFloat density = MIN(1, sqrt(ctm.a * ctm.a + ctm.b * ctm.b));
  if (!(density > 0)) return;
  size_t width = (size_t)ceil(bounds.size.width * density);
  size_t height = (size_t)ceil(bounds.size.height * density);
  if (width == 0 || height == 0) return;
  // The image is drawn over `bounds`, so each of its pixels covers this much
  // of the canvas: sampled at those pixels' centers, not at 1 / density,
  // which rounding the size up would leave apart from where they're drawn.
  // At density 1 the bounds are whole pixels, and a step is one.
  CGFloat stepX = bounds.size.width / width, stepY = bounds.size.height / height;
  NSMutableData *pixels = [NSMutableData dataWithLength:width * height * 4];
  uint8_t *p = pixels.mutableBytes;
  // 256 colors around the circle, as the stops give them.
  uint8_t table[256][4];
  for (int i = 0; i < 256; i++) {
    CGFloat rgba[4];
    [gradient colorAt:i / 255.0 into:rgba];
    table[i][3] = (uint8_t)lround(rgba[3] * 255);
    for (int k = 0; k < 3; k++) table[i][k] = (uint8_t)lround(rgba[k] * rgba[3] * 255);
  }
  CGFloat start = gradient.p0, cx = gradient.p1, cy = gradient.p2;
  for (size_t y = 0; y < height; y++) {
    for (size_t x = 0; x < width; x++) {
      CGPoint point = CGPointApplyAffineTransform(
          CGPointMake(bounds.origin.x + (x + 0.5) * stepX, bounds.origin.y + (y + 0.5) * stepY),
          inverse);
      CGFloat angle = atan2(point.y - cy, point.x - cx) - start;
      CGFloat t = fmod(angle / (2 * M_PI), 1);
      if (t < 0) t += 1;
      const uint8_t *color = table[(int)lround(t * 255)];
      memcpy(p + (y * width + x) * 4, color, 4);
    }
  }
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)pixels);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGImageRef image =
      CGImageCreate(width, height, 8, 32, width * 4, space,
                    kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big, provider, NULL,
                    false, kCGRenderingIntentDefault);
  CGColorSpaceRelease(space);
  CGDataProviderRelease(provider);
  // Drawn upright in the canvas's flipped space.
  CGContextTranslateCTM(c, bounds.origin.x, bounds.origin.y + bounds.size.height);
  CGContextScaleCTM(c, 1, -1);
  CGContextDrawImage(c, CGRectMake(0, 0, bounds.size.width, bounds.size.height), image);
  CGImageRelease(image);
}

/// The outline a stroke of the path (in the canvas's pixels) fills, in the
/// canvas's pixels. The line's width, dashes and joins are in the space of
/// the current transform, so the path is taken back into it to be stroked.
- (CGPathRef)strokeOutlineOf:(CGPathRef)devicePath {
  ALCanvas2DState *s = _state;
  CGAffineTransform transform = s.transform;
  if (!invertible(transform) || CGPathIsEmpty(devicePath)) return NULL;
  CGAffineTransform inverse = CGAffineTransformInvert(transform);
  CGPathRef userPath = CGPathCreateCopyByTransformingPath(devicePath, &inverse);
  CGContextRef c = _scratch;
  CGContextSaveGState(c);
  CGContextSetLineWidth(c, s.lineWidth);
  CGContextSetLineCap(c, s.lineCap);
  CGContextSetLineJoin(c, s.lineJoin);
  CGContextSetMiterLimit(c, s.miterLimit);
  NSUInteger dashCount = s.lineDash.count;
  if (dashCount > 0) {
    CGFloat *lengths = malloc(sizeof(CGFloat) * dashCount);
    for (NSUInteger i = 0; i < dashCount; i++) lengths[i] = s.lineDash[i].doubleValue;
    CGContextSetLineDash(c, s.lineDashOffset, lengths, dashCount);
    free(lengths);
  }
  CGContextBeginPath(c);
  CGContextAddPath(c, userPath);
  CGContextReplacePathWithStrokedPath(c);
  CGPathRef outline = CGContextIsPathEmpty(c) ? NULL : CGContextCopyPath(c);
  CGContextBeginPath(c);
  CGContextRestoreGState(c);
  CGPathRelease(userPath);
  if (!outline) return NULL;
  CGPathRef device = CGPathCreateCopyByTransformingPath(outline, &transform);
  CGPathRelease(outline);
  return device;
}

- (void)strokeDevicePath:(CGPathRef)path {
  CGPathRef outline = [self strokeOutlineOf:path];
  if (!outline) return;
  [self fillDevicePath:outline evenOdd:NO style:_state.stroke gradient:_state.strokeGradient];
  CGPathRelease(outline);
}

- (void)clearPath:(CGPathRef)path {
  if (!_cg || CGPathIsEmpty(path)) return;
  if (!_alpha) {
    [self fillOpaqueBlack:CGRectZero path:path];
    return;
  }
  // Not touched by alpha, compositing or shadows, as the spec has it; the
  // clip still applies.
  CGContextSaveGState(_cg);
  CGContextSetBlendMode(_cg, kCGBlendModeClear);
  CGContextAddPath(_cg, path);
  CGContextFillPath(_cg);
  CGContextRestoreGState(_cg);
}

#pragma mark Images

- (CGInterpolationQuality)interpolationQuality {
  if (!_state.smoothing) return kCGInterpolationNone;
  switch (_state.smoothingQuality) {
    case 2:
      return kCGInterpolationHigh;
    case 1:
      return kCGInterpolationMedium;
    default:
      return kCGInterpolationLow;
  }
}

/// An image source (see #imageSource in canvas-2d-context.ts): a decoded
/// image by id, or a canvas by its id, as it is now.
- (CGImageRef)newImageFrom:(NSDictionary *)source {
  if (source[@"blank"]) {
    // A canvas without a context: a transparent image of its size.
    NSInteger width = [source[@"width"] integerValue];
    NSInteger height = [source[@"height"] integerValue];
    if (width < 1 || height < 1) return NULL;
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef blank = CGBitmapContextCreate(NULL, width, height, 8, width * 4, space,
                                               kCGImageAlphaPremultipliedLast |
                                                   kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(space);
    if (!blank) return NULL;
    CGImageRef image = CGBitmapContextCreateImage(blank);
    CGContextRelease(blank);
    return image;
  }
  AngularLynxDecodedImage *decoded = nil;
  NSString *canvasId = source[@"canvas"];
  if ([canvasId isKindOfClass:NSString.class]) {
    decoded = [canvasId isEqualToString:_canvasId]
                  ? [self snapshot]
                  : [[AngularLynxCanvasRegistry contextForCanvasId:canvasId] snapshot];
  } else if ([source[@"image"] isKindOfClass:NSNumber.class]) {
    decoded = [AngularLynxDecodedImage imageWithId:[source[@"image"] integerValue]];
  }
  if (!decoded || decoded.width < 1 || decoded.height < 1) return NULL;
  CGDataProviderRef provider =
      CGDataProviderCreateWithCFData((__bridge CFDataRef)decoded.pixels);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGImageRef image = CGImageCreate(
      decoded.width, decoded.height, 8, 32, decoded.width * 4, space,
      (decoded.premultiplied ? kCGImageAlphaPremultipliedLast : kCGImageAlphaLast) |
          kCGBitmapByteOrder32Big,
      provider, NULL, false, kCGRenderingIntentDefault);
  CGColorSpaceRelease(space);
  CGDataProviderRelease(provider);
  return image;
}

/// drawImage: the source rectangle of the image drawn in the destination
/// rectangle, in the space of the current transform. The whole image is
/// drawn, placed so the source lands on the destination, and clipped to the
/// destination, so a source between pixels is drawn where it falls.
- (void)drawImage:(CGImageRef)image source:(CGRect)src destination:(CGRect)dst {
  CGAffineTransform transform = _state.transform;
  CGFloat scaleX = dst.size.width / src.size.width;
  CGFloat scaleY = dst.size.height / src.size.height;
  CGRect whole = CGRectMake(dst.origin.x - src.origin.x * scaleX,
                            dst.origin.y - src.origin.y * scaleY,
                            CGImageGetWidth(image) * scaleX, CGImageGetHeight(image) * scaleY);
  CGInterpolationQuality quality = [self interpolationQuality];
  CGImageRetain(image);
  [self composite:^(CGContextRef c) {
    CGContextConcatCTM(c, transform);
    CGContextClipToRect(c, dst);
    CGContextSetInterpolationQuality(c, quality);
    // Drawn upright in the canvas's flipped space.
    CGContextTranslateCTM(c, whole.origin.x, whole.origin.y + whole.size.height);
    CGContextScaleCTM(c, 1, -1);
    CGContextDrawImage(c, CGRectMake(0, 0, whole.size.width, whole.size.height), image);
  }];
  CGImageRelease(image);
}

#pragma mark Pixels

/// getImageData: the rectangle's pixels, not premultiplied, rows top to
/// bottom; transparent black outside the canvas.
- (NSArray *)pixelsAtX:(NSInteger)x y:(NSInteger)y width:(NSInteger)width height:(NSInteger)height {
  if (width <= 0 || height <= 0) return wordsFrom(NULL, 0);
  NSMutableData *out = [NSMutableData dataWithLength:(NSUInteger)(width * height * 4)];
  if (!out) return wordsFrom(NULL, 0);
  uint8_t *o = out.mutableBytes;
  const uint8_t *bitmap = _data.bytes;
  for (NSInteger row = 0; row < height; row++) {
    NSInteger sy = y + row;
    if (sy < 0 || sy >= (NSInteger)_height || !_cg) continue;
    for (NSInteger column = 0; column < width; column++) {
      NSInteger sx = x + column;
      if (sx < 0 || sx >= (NSInteger)_width) continue;
      const uint8_t *p = bitmap + (sy * _width + sx) * 4;
      uint8_t *q = o + (row * width + column) * 4;
      uint8_t alpha = _alpha ? p[3] : 255;
      q[3] = alpha;
      if (alpha == 0) continue;
      for (int c = 0; c < 3; c++) {
        q[c] = alpha == 255 ? p[c] : (uint8_t)MIN(255, (p[c] * 255 + alpha / 2) / alpha);
      }
    }
  }
  return wordsFrom(o, out.length);
}

/// putImageData: straight RGBA written into the bitmap as it is, whatever
/// the transform, clip and compositing.
- (void)putPixels:(NSData *)bytes
            width:(NSInteger)width
           height:(NSInteger)height
                x:(NSInteger)x
                y:(NSInteger)y {
  if (!_cg || (NSInteger)bytes.length < width * height * 4) return;
  const uint8_t *in = bytes.bytes;
  uint8_t *bitmap = _data.mutableBytes;
  for (NSInteger row = 0; row < height; row++) {
    NSInteger dy = y + row;
    if (dy < 0 || dy >= (NSInteger)_height) continue;
    for (NSInteger column = 0; column < width; column++) {
      NSInteger dx = x + column;
      if (dx < 0 || dx >= (NSInteger)_width) continue;
      const uint8_t *p = in + (row * width + column) * 4;
      uint8_t *q = bitmap + (dy * _width + dx) * 4;
      uint8_t alpha = _alpha ? p[3] : 255;
      for (int c = 0; c < 3; c++) q[c] = (uint8_t)((p[c] * alpha + 127) / 255);
      q[3] = alpha;
    }
  }
}

#pragma mark Text

/// The text laid out as one line in the current font.
- (CTLineRef)newLineFor:(NSString *)text {
  ALCanvas2DState *s = _state;
  NSMutableDictionary *attributes = [@{
    (__bridge NSString *)kCTFontAttributeName : s.font,
    (__bridge NSString *)kCTForegroundColorFromContextAttributeName : @YES,
  } mutableCopy];
  if (s.letterSpacing != 0) {
    attributes[(__bridge NSString *)kCTKernAttributeName] = @(s.letterSpacing);
  }
  CTWritingDirection direction =
      s.rtl ? kCTWritingDirectionRightToLeft : kCTWritingDirectionLeftToRight;
  CTParagraphStyleSetting setting = {kCTParagraphStyleSpecifierBaseWritingDirection,
                                     sizeof(direction), &direction};
  CTParagraphStyleRef paragraph = CTParagraphStyleCreate(&setting, 1);
  attributes[(__bridge NSString *)kCTParagraphStyleAttributeName] = (__bridge id)paragraph;
  CFRelease(paragraph);
  NSAttributedString *string = [[NSAttributedString alloc] initWithString:text
                                                               attributes:attributes];
  return CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)string);
}

/// Where the line starts from the anchor, for textAlign, as a multiple of
/// its width.
- (CGFloat)alignmentOffsetForWidth:(CGFloat)width {
  BOOL rtl = _state.rtl;
  switch (_state.textAlign) {
    case 1:  // end
      return rtl ? 0 : -width;
    case 2:  // left
      return 0;
    case 3:  // right
      return -width;
    case 4:  // center
      return -width / 2;
    default:  // start
      return rtl ? -width : 0;
  }
}

/// How far above the alphabetic baseline the anchor is, for textBaseline,
/// from the font's metrics, as Chrome works it out.
- (CGFloat)baselineHeight {
  CTFontRef font = (__bridge CTFontRef)_state.font;
  CGFloat ascent = CTFontGetAscent(font);
  CGFloat descent = CTFontGetDescent(font);
  switch (_state.textBaseline) {
    case 0:  // top
      return ascent;
    case 1:  // hanging
      return ascent * 0.8;
    case 2:  // middle
      return (ascent - descent) / 2;
    case 4:  // ideographic
    case 5:  // bottom
      return -descent;
    default:  // alphabetic
      return 0;
  }
}

- (void)drawText:(NSString *)text
               x:(CGFloat)x
               y:(CGFloat)y
        maxWidth:(CGFloat)maxWidth
          stroke:(BOOL)stroke {
  if (!_cg || text.length == 0 || _state.font.pointSize <= 0.01) return;
  CTLineRef line = [self newLineFor:text];
  CGFloat width = CTLineGetTypographicBounds(line, NULL, NULL, NULL);
  // Text wider than maxWidth is squeezed to fit, as the spec allows.
  CGFloat scaleX = maxWidth > 0 && width > maxWidth ? maxWidth / width : 1;
  CGFloat originX = x + [self alignmentOffsetForWidth:width] * scaleX;
  CGFloat baseline = y + [self baselineHeight];
  ALStyle style = stroke ? _state.stroke : _state.fill;
  CGAffineTransform transform = _state.transform;
  if (!stroke && style.kind == ALStyleColor) {
    // Drawn as glyphs, so color glyphs (emoji) draw too.
    CGFloat r = style.rgba[0] / 255, g = style.rgba[1] / 255, b = style.rgba[2] / 255,
            a = style.rgba[3];
    [self composite:^(CGContextRef c) {
      CGContextConcatCTM(c, transform);
      CGContextTranslateCTM(c, originX, baseline);
      // Core Text draws y up.
      CGContextScaleCTM(c, scaleX, -1);
      CGContextSetTextMatrix(c, CGAffineTransformIdentity);
      CGContextSetTextPosition(c, 0, 0);
      CGContextSetRGBFillColor(c, r, g, b, a);
      CTLineDraw(line, c);
    }];
    CFRelease(line);
    return;
  }
  // The glyphs' outlines, in the canvas's pixels, filled or stroked as a
  // path is.
  CGMutablePathRef glyphs = CGPathCreateMutable();
  CFArrayRef runs = CTLineGetGlyphRuns(line);
  for (CFIndex i = 0; i < CFArrayGetCount(runs); i++) {
    CTRunRef run = CFArrayGetValueAtIndex(runs, i);
    CTFontRef font = CFDictionaryGetValue(CTRunGetAttributes(run), kCTFontAttributeName);
    CFIndex count = CTRunGetGlyphCount(run);
    CGGlyph *glyphIds = malloc(sizeof(CGGlyph) * MAX(count, 1));
    CGPoint *positions = malloc(sizeof(CGPoint) * MAX(count, 1));
    CTRunGetGlyphs(run, CFRangeMake(0, count), glyphIds);
    CTRunGetPositions(run, CFRangeMake(0, count), positions);
    for (CFIndex g = 0; g < count; g++) {
      CGAffineTransform place = CGAffineTransformMake(
          scaleX, 0, 0, -1, originX + positions[g].x * scaleX, baseline - positions[g].y);
      CGPathRef outline = CTFontCreatePathForGlyph(font, glyphIds[g], &place);
      if (outline) {
        CGPathAddPath(glyphs, NULL, outline);
        CGPathRelease(outline);
      }
    }
    free(glyphIds);
    free(positions);
  }
  CFRelease(line);
  CGPathRef device = CGPathCreateCopyByTransformingPath(glyphs, &transform);
  CGPathRelease(glyphs);
  if (stroke) {
    [self strokeDevicePath:device];
  } else {
    [self fillDevicePath:device evenOdd:NO style:style gradient:_state.fillGradient];
  }
  CGPathRelease(device);
}

/// measureText: TextMetrics' numbers, in order (see LynxTextMetrics),
/// measured from the anchor textAlign and textBaseline put it at.
- (NSArray *)measureText:(NSString *)text {
  CTLineRef line = [self newLineFor:text];
  CGFloat width = CTLineGetTypographicBounds(line, NULL, NULL, NULL);
  CGRect glyphs = text.length > 0 ? CTLineGetBoundsWithOptions(line, kCTLineBoundsUseGlyphPathBounds)
                                  : CGRectZero;
  CFRelease(line);
  CTFontRef font = (__bridge CTFontRef)_state.font;
  CGFloat ascent = CTFontGetAscent(font);
  CGFloat descent = CTFontGetDescent(font);
  CGFloat offset = [self alignmentOffsetForWidth:width];
  CGFloat anchor = [self baselineHeight];
  return @[
    @(width),
    @(-(offset + CGRectGetMinX(glyphs))),
    @(offset + CGRectGetMaxX(glyphs)),
    @(ascent - anchor),
    @(descent + anchor),
    @(CGRectGetMaxY(glyphs) - anchor),
    @(-CGRectGetMinY(glyphs) + anchor),
    @(ascent - anchor),
    @(descent + anchor),
    @(ascent * 0.8 - anchor),
    @(-anchor),
    @(-descent - anchor),
  ];
}

@end
