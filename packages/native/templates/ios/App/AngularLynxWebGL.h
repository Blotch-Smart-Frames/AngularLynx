// `<canvas>` with WebGL2 for the AngularLynx runtime: the `canvas` element
// (AngularLynxCanvas), the `AngularLynxWebGL` main-thread module the runtime's
// WebGL2RenderingContext sends its GL calls to (AngularLynxWebGLModule), and
// the OpenGL ES 3.0 context that runs them (AngularLynxWebGLContext).
//
// Lynx has no canvas, and runs Angular on its main thread, where WebGL's
// synchronous answers (a program's link status, a uniform's location) can
// only come from a main-thread module: LynxViewController turns those on
// (`enableMTSModule`). The runtime batches the calls into one `run` per frame;
// see packages/runtime/src/lib/canvas/webgl-bridge.ts for the protocol.
//
// Lynx's main thread is its engine thread, which the shell runs off the UI
// thread (LynxViewController's thread strategy), and the module's calls
// arrive there. So every GL call is made there: an EGL context is current on
// one thread at a time, and the context keeps it current between batches.
// The canvas's view lives on the UI thread, and hands the context what it
// draws into (AngularLynxCanvasTarget) through Lynx's runOnTasmThread:, so
// the registry and the contexts are the engine thread's alone.
//
// The OpenGL ES 3.0 is ANGLE's, on Metal (libEGL and libGLESv2, prebuilt
// with Lynx's frameworks by scripts/build-angle-ios-frameworks.sh), rather
// than iOS's own OpenGL ES. Apple deprecated that in iOS 12, and the
// Simulator runs it on the CPU, where a lit three.js scene took seconds a
// frame; Metal draws on the GPU on a phone and in the Simulator alike.
// ANGLE is also what Safari draws WebGL with. Its shading language, GLSL ES
// 3.00, is WebGL2's, so three.js's shaders compile as they are.

#import <Foundation/Foundation.h>
#import <Lynx/LynxContext.h>
#import <Lynx/LynxModule.h>
#import <Lynx/LynxUI.h>
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class AngularLynxCanvasView;

/// What a canvas's view gives its context to show frames in: the view's
/// CAMetalLayer, which the context makes its window surface on, and the
/// layer's size in pixels. The context reads it on the engine thread, where
/// a UIView mustn't be touched, nor released for the last time.
@interface AngularLynxCanvasTarget : NSObject
@property(nonatomic, readonly) CAMetalLayer *layer;
/// The layer's size in pixels as the view was last laid out: written on the
/// UI thread, read on the engine thread.
@property(atomic) CGSize pixelSize;
/// The view, for the UI thread alone (the context sets its opacity there).
@property(nonatomic, weak, readonly, nullable) AngularLynxCanvasView *view;
@end

/// The drawing surface: a view backed by a CAMetalLayer, which the context
/// copies each finished frame into (an EGL window surface on the layer).
@interface AngularLynxCanvasView : UIView
@property(nonatomic, copy, nullable) NSString *canvasId;
/// The LynxView's context, whose engine thread the view hands its target to
/// (runOnTasmThread:). The canvas element sets it before the canvas id.
@property(nonatomic, weak, nullable) LynxContext *lynxContext;
@property(nonatomic, readonly) AngularLynxCanvasTarget *target;
/// Shows a 2D context's bitmap, scaled to the view (nil shows nothing). UI
/// thread only.
/// Shows nothing for a frame of another canvas than the view's now.
- (void)showImage:(nullable CGImageRef)image
           opaque:(BOOL)opaque
         canvasId:(NSString *)canvasId;
@end

/// The `canvas` element. Its `canvas-id` attribute, which the runtime sets,
/// pairs it with the context the runtime made for it.
@interface AngularLynxCanvas : LynxUI <AngularLynxCanvasView *>
@end

/// Pixels the module decoded (`decodeImage`), which texture uploads read by
/// id. RGBA, 8 bits a channel, rows top to bottom.
@interface AngularLynxDecodedImage : NSObject
@property(nonatomic, readonly) NSData *pixels;
@property(nonatomic, readonly) NSInteger width;
@property(nonatomic, readonly) NSInteger height;
/// Whether the pixels are premultiplied by alpha.
@property(nonatomic, readonly) BOOL premultiplied;
- (instancetype)initWithPixels:(NSData *)pixels
                         width:(NSInteger)width
                        height:(NSInteger)height
                 premultiplied:(BOOL)premultiplied;
+ (nullable AngularLynxDecodedImage *)imageWithId:(NSInteger)imageId;
@end

/// A canvas's context, of either kind: what the registry pairs with the
/// canvas's view, and what another context reads the canvas through (as a
/// texture, or drawn on a 2D canvas). Engine thread only.
@protocol AngularLynxCanvasContext <NSObject>
@property(nonatomic, readonly, copy) NSString *canvasId;
/// Shows frames in this canvas's target, or nowhere while it's nil.
- (void)attachTarget:(nullable AngularLynxCanvasTarget *)target;
/// The view was laid out: a frame that waited for it to have a size is shown.
- (void)targetDidLayOut:(AngularLynxCanvasTarget *)target;
/// The canvas's pixels now, rows top to bottom, or nil when it has none.
- (nullable AngularLynxDecodedImage *)snapshot;
/// After `OffscreenCanvas.transferToImageBitmap()` took the pixels: a 2D
/// bitmap is cleared to transparent black (opaque black without alpha), and
/// a WebGL drawing buffer too, even with preserveDrawingBuffer, which the HTML
/// spec says has no effect on a transfer. The context's state stays.
- (void)clearForTransfer;
@end

/// One WebGL context: an EGL context on ANGLE's Metal display, with an
/// offscreen default framebuffer the size of the canvas's `width` and
/// `height`.
@interface AngularLynxWebGLContext : NSObject <AngularLynxCanvasContext>
@property(nonatomic, readonly, copy) NSString *canvasId;
- (nullable instancetype)initWithCanvasId:(NSString *)canvasId
                               attributes:(NSDictionary *)attributes
                                    error:(NSString *_Nullable *_Nonnull)error;
/// Runs the commands in order; returns one result per query.
- (NSArray *)run:(NSArray *)commands;
/// The drawing buffer as a PNG or JPEG file, in base64: `{ base64, type }`,
/// or `{ error }`. For the runtime's canvas.toBlob() and toDataURL().
- (NSDictionary *)encodeImageOfType:(NSString *)type
                            quality:(double)quality
                      premultiplied:(BOOL)premultiplied;
- (void)destroy;
@end

/// One 2D context: a Core Graphics bitmap the size of the canvas's `width`
/// and `height`, which the runtime's CanvasRenderingContext2D draws on (see
/// AngularLynxCanvas2DContext.m).
@interface AngularLynxCanvas2DContext : NSObject <AngularLynxCanvasContext>
@property(nonatomic, readonly, copy) NSString *canvasId;
/// `objects` holds the gradients and patterns of every 2D context in the
/// LynxView, which any of them can paint with.
- (nullable instancetype)initWithCanvasId:(NSString *)canvasId
                               attributes:(NSDictionary *)attributes
                                  objects:(NSMutableDictionary<NSNumber *, id> *)objects
                                    error:(NSString *_Nullable *_Nonnull)error;
/// Runs the commands in order; returns one result per query.
- (NSArray *)run:(NSArray *)commands;
/// The bitmap as a PNG or JPEG file: `{ base64, type }`, or `{ error }`.
- (NSDictionary *)encodeImageOfType:(NSString *)type quality:(double)quality;
@end

/// Pairs canvases with contexts by canvas id: either can come first, as the
/// runtime may make the context before Lynx has made the element's view.
/// Engine thread only, as the contexts are.
@interface AngularLynxCanvasRegistry : NSObject
+ (void)setTarget:(nullable AngularLynxCanvasTarget *)target forCanvasId:(NSString *)canvasId;
+ (nullable AngularLynxCanvasTarget *)targetForCanvasId:(NSString *)canvasId;
+ (void)setContext:(nullable id<AngularLynxCanvasContext>)context
       forCanvasId:(NSString *)canvasId;
+ (nullable id<AngularLynxCanvasContext>)contextForCanvasId:(NSString *)canvasId;
@end

/// The `AngularLynxWebGL` module. Registered on the LynxView's config, and
/// called from Lynx's main thread, on its engine thread.
@interface AngularLynxWebGLModule : NSObject <LynxModule>
@end

NS_ASSUME_NONNULL_END
