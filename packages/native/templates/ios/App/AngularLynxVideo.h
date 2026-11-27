// `<video>` as an image for the canvas contexts: XElement's video element,
// whose frames a 2D canvas can draw (`drawImage()`, `createPattern()`) and a
// WebGL canvas can upload (`texImage2D()`, three.js's VideoTexture), as a
// browser's HTMLVideoElement's can. See
// packages/runtime/src/lib/canvas/video-element.ts.
//
// XElement's player shows its frames in an AVPlayerLayer, which can't be
// read. So the element adds an AVPlayerItemVideoOutput to the player's item,
// which hands over the frame showing now as a pixel buffer, and registers
// what reads it (AngularLynxVideoFrames) in the canvas registry under the
// video's `video-id`, which the runtime sets. The contexts then read a video
// as they read another canvas, by its id (`{ canvas: id }`), so the pixels
// never travel through JavaScript.

#import <Foundation/Foundation.h>
#import <XElement/LynxUIVideo.h>

#import "AngularLynxWebGL.h"

NS_ASSUME_NONNULL_BEGIN

/// A video's frames, as the canvas registry holds a canvas's context: its
/// snapshot is the frame the player shows now. Its view's video element
/// keeps it; the registry holds it weakly. Its frames are read on Lynx's
/// engine thread, and its output set on the UI thread.
@interface AngularLynxVideoFrames : NSObject <AngularLynxCanvasContext>
/// The size of the latest frame, in pixels, or zero before the first: the
/// runtime's `videoWidth` and `videoHeight` (the module's `videoSize`).
- (CGSize)frameSize;
@end

/// The `video` element: XElement's, and its `video-id` attribute, which
/// registers its frames under the id.
@interface AngularLynxVideo : LynxUIVideo
@end

NS_ASSUME_NONNULL_END
