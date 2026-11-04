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
// OpenGL ES is deprecated on iOS but still in the SDK, and its shading
// language, GLSL ES 3.00, is WebGL2's, so three.js's shaders compile as they
// are. GLES_SILENCE_DEPRECATION keeps each GL call from warning.

#define GLES_SILENCE_DEPRECATION 1

#import <Foundation/Foundation.h>
#import <Lynx/LynxModule.h>
#import <Lynx/LynxUI.h>
#import <OpenGLES/EAGL.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class AngularLynxCanvasView;

/// The drawing surface: a view backed by a CAEAGLLayer, which the context
/// copies each finished frame into.
@interface AngularLynxCanvasView : UIView
@property(nonatomic, copy, nullable) NSString *canvasId;
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
+ (nullable AngularLynxDecodedImage *)imageWithId:(NSInteger)imageId;
@end

/// One WebGL context: an EAGLContext with an offscreen default framebuffer
/// the size of the canvas's `width` and `height`.
@interface AngularLynxWebGLContext : NSObject
@property(nonatomic, readonly, copy) NSString *canvasId;
- (nullable instancetype)initWithCanvasId:(NSString *)canvasId
                               attributes:(NSDictionary *)attributes
                                    error:(NSString *_Nullable *_Nonnull)error;
/// Runs the commands in order; returns one result per query.
- (NSArray *)run:(NSArray *)commands;
/// Shows frames in this view, or nowhere while it's nil.
- (void)attachView:(nullable AngularLynxCanvasView *)view;
/// The view's size changed: the next frame reallocates its layer's storage.
- (void)viewDidResize;
- (void)destroy;
@end

/// Pairs canvases with contexts by canvas id: either can come first, as the
/// runtime may make the context before Lynx has made the element's view.
@interface AngularLynxCanvasRegistry : NSObject
+ (void)setView:(nullable AngularLynxCanvasView *)view forCanvasId:(NSString *)canvasId;
+ (nullable AngularLynxCanvasView *)viewForCanvasId:(NSString *)canvasId;
+ (void)setContext:(nullable AngularLynxWebGLContext *)context forCanvasId:(NSString *)canvasId;
+ (nullable AngularLynxWebGLContext *)contextForCanvasId:(NSString *)canvasId;
@end

/// The `AngularLynxWebGL` module. Registered on the LynxView's config, and
/// called from the main thread.
@interface AngularLynxWebGLModule : NSObject <LynxModule>
@end

NS_ASSUME_NONNULL_END
