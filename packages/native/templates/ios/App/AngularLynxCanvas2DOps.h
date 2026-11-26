// Generated from packages/runtime/src/lib/canvas/canvas-2d-ops.ts by
// packages/native/scripts/webgl-ops.ts: run `npm run generate:webgl-ops -w
// packages/native` rather than editing it.

#import <Foundation/Foundation.h>

/// The commands of the 2D context's bridge, as `<canvas>`'s 2D context in
/// the runtime records them: below 200 they return nothing, from 200 each
/// answers one query.
typedef NS_ENUM(NSInteger, ALCanvas2DOp) {
  ALCanvas2DOpSave = 1,
  ALCanvas2DOpRestore = 2,
  ALCanvas2DOpReset = 3,
  ALCanvas2DOpResize = 4,
  ALCanvas2DOpPresent = 5,
  ALCanvas2DOpSetTransform = 10,
  ALCanvas2DOpSetGlobalAlpha = 11,
  ALCanvas2DOpSetCompositeOperation = 12,
  ALCanvas2DOpSetFillColor = 13,
  ALCanvas2DOpSetFillGradient = 14,
  ALCanvas2DOpSetFillPattern = 15,
  ALCanvas2DOpSetStrokeColor = 16,
  ALCanvas2DOpSetStrokeGradient = 17,
  ALCanvas2DOpSetStrokePattern = 18,
  ALCanvas2DOpSetLineWidth = 19,
  ALCanvas2DOpSetLineCap = 20,
  ALCanvas2DOpSetLineJoin = 21,
  ALCanvas2DOpSetMiterLimit = 22,
  ALCanvas2DOpSetLineDash = 23,
  ALCanvas2DOpSetShadow = 24,
  ALCanvas2DOpSetFont = 25,
  ALCanvas2DOpSetTextAlign = 26,
  ALCanvas2DOpSetTextBaseline = 27,
  ALCanvas2DOpSetDirection = 28,
  ALCanvas2DOpSetLetterSpacing = 29,
  ALCanvas2DOpSetImageSmoothing = 30,
  ALCanvas2DOpCreateLinearGradient = 40,
  ALCanvas2DOpCreateRadialGradient = 41,
  ALCanvas2DOpCreateConicGradient = 42,
  ALCanvas2DOpAddColorStop = 43,
  ALCanvas2DOpCreatePattern = 44,
  ALCanvas2DOpSetPatternTransform = 45,
  ALCanvas2DOpReleaseObject = 46,
  ALCanvas2DOpClearPath = 50,
  ALCanvas2DOpFill = 51,
  ALCanvas2DOpStroke = 52,
  ALCanvas2DOpClip = 53,
  ALCanvas2DOpFillText = 54,
  ALCanvas2DOpStrokeText = 55,
  ALCanvas2DOpDrawImage = 56,
  ALCanvas2DOpPutImageData = 57,
  ALCanvas2DOpMeasureText = 200,
  ALCanvas2DOpGetImageData = 201,
  ALCanvas2DOpIsPointInPath = 202,
  ALCanvas2DOpIsPointInStroke = 203,
};

/// The segments of a path, each followed by its points.
typedef NS_ENUM(NSInteger, ALCanvas2DPathOp) {
  ALCanvas2DPathOpMoveTo = 0,
  ALCanvas2DPathOpLineTo = 1,
  ALCanvas2DPathOpQuadTo = 2,
  ALCanvas2DPathOpCubicTo = 3,
  ALCanvas2DPathOpClose = 4,
};
