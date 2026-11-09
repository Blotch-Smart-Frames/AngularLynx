#import "AngularLynxWebGL.h"

#import <EGL/egl.h>
#import <EGL/eglext.h>
#import <EGL/eglext_angle.h>
#import <GLES3/gl3.h>
#import <ImageIO/ImageIO.h>
#import <QuartzCore/QuartzCore.h>

#import "AngularLynxWebGLOps.h"

// UIKit's module brings Apple's OpenGL ES headers into every file, and their
// declarations, marked deprecated, merge with ANGLE's of the same names. The
// calls still go to ANGLE: the app links libGLESv2 explicitly, ahead of the
// OpenGLES framework UIKit links automatically.
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

NSData *AngularLynxBytesFromWords(NSArray *words);

// WebGL's names for the default framebuffer's buffers, which GLES gives to
// window surfaces only. The default framebuffer here is an ordinary one.
#define WEBGL_BACK 0x0405
#define WEBGL_COLOR 0x1800
#define WEBGL_DEPTH 0x1801
#define WEBGL_STENCIL 0x1802
#define WEBGL_UNMASKED_VENDOR 0x9245
#define WEBGL_UNMASKED_RENDERER 0x9246
#define GL_TEXTURE_MAX_ANISOTROPY 0x84FE
#define GL_MAX_TEXTURE_MAX_ANISOTROPY 0x84FF

/// Reads a batch: the commands' arguments, in order.
typedef struct {
  __unsafe_unretained id *items;
  NSUInteger count;
  NSUInteger index;
} Reader;

static inline id nextItem(Reader *r) {
  return r->index < r->count ? r->items[r->index++] : nil;
}

static inline double nextNumber(Reader *r) {
  id value = nextItem(r);
  return [value isKindOfClass:NSNumber.class] ? [(NSNumber *)value doubleValue] : 0;
}

static inline GLint nextInt(Reader *r) { return (GLint)(int64_t)nextNumber(r); }
static inline GLuint nextUInt(Reader *r) { return (GLuint)(int64_t)nextNumber(r); }
static inline GLenum nextEnum(Reader *r) { return (GLenum)(int64_t)nextNumber(r); }
static inline GLfloat nextFloat(Reader *r) { return (GLfloat)nextNumber(r); }
static inline GLintptr nextOffset(Reader *r) { return (GLintptr)(int64_t)nextNumber(r); }

static inline NSString *nextString(Reader *r) {
  id value = nextItem(r);
  return [value isKindOfClass:NSString.class] ? value : @"";
}

static inline NSArray *nextArray(Reader *r) {
  id value = nextItem(r);
  return [value isKindOfClass:NSArray.class] ? value : @[];
}

static NSMutableData *floatsFrom(NSArray *values) {
  NSMutableData *data = [NSMutableData dataWithLength:values.count * sizeof(GLfloat)];
  GLfloat *out = data.mutableBytes;
  NSUInteger i = 0;
  for (NSNumber *value in values) out[i++] = value.floatValue;
  return data;
}

static NSMutableData *intsFrom(NSArray *values) {
  NSMutableData *data = [NSMutableData dataWithLength:values.count * sizeof(GLint)];
  GLint *out = data.mutableBytes;
  NSUInteger i = 0;
  for (NSNumber *value in values) out[i++] = (GLint)value.longLongValue;
  return data;
}

static NSMutableData *uintsFrom(NSArray *values) {
  NSMutableData *data = [NSMutableData dataWithLength:values.count * sizeof(GLuint)];
  GLuint *out = data.mutableBytes;
  NSUInteger i = 0;
  for (NSNumber *value in values) out[i++] = (GLuint)value.longLongValue;
  return data;
}

static NSArray *numbersFromFloats(const GLfloat *values, NSUInteger count) {
  NSMutableArray *result = [NSMutableArray arrayWithCapacity:count];
  for (NSUInteger i = 0; i < count; i++) [result addObject:@(values[i])];
  return result;
}

static NSArray *numbersFromInts(const GLint *values, NSUInteger count) {
  NSMutableArray *result = [NSMutableArray arrayWithCapacity:count];
  for (NSUInteger i = 0; i < count; i++) [result addObject:@(values[i])];
  return result;
}

/// Bytes as words for the trip back, the byte count last (see fromWords in
/// webgl2-context.ts).
static NSArray *wordsFromBytes(const void *bytes, NSUInteger length) {
  NSUInteger wordCount = (length + 3) / 4;
  NSMutableArray *words = [NSMutableArray arrayWithCapacity:wordCount + 1];
  uint32_t word;
  const uint8_t *p = bytes;
  for (NSUInteger i = 0; i < wordCount; i++) {
    word = 0;
    memcpy(&word, p + i * 4, MIN(4, length - i * 4));
    [words addObject:@(word)];
  }
  [words addObject:@(length)];
  return words;
}

/// ANGLE's display on Metal, made once and shared by every context. Nothing
/// else in the app draws with ANGLE, so it's never terminated.
static EGLDisplay metalDisplay(void) {
  static EGLDisplay display = EGL_NO_DISPLAY;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    const EGLAttrib attributes[] = {EGL_PLATFORM_ANGLE_TYPE_ANGLE,
                                    EGL_PLATFORM_ANGLE_TYPE_METAL_ANGLE, EGL_NONE};
    EGLDisplay candidate =
        eglGetPlatformDisplay(EGL_PLATFORM_ANGLE_ANGLE, (void *)EGL_DEFAULT_DISPLAY, attributes);
    if (candidate != EGL_NO_DISPLAY && eglInitialize(candidate, NULL, NULL)) {
      display = candidate;
    }
  });
  return display;
}

static NSString *glString(GLenum name) {
  const GLubyte *value = glGetString(name);
  return value ? [NSString stringWithUTF8String:(const char *)value] : @"";
}

/// Half floats for HALF_FLOAT uploads of decoded images.
static uint16_t halfFromFloat(float value) {
  uint32_t bits;
  memcpy(&bits, &value, 4);
  uint32_t sign = (bits >> 16) & 0x8000;
  int32_t exponent = (int32_t)((bits >> 23) & 0xff) - 127 + 15;
  uint32_t mantissa = bits & 0x7fffff;
  if (exponent <= 0) return (uint16_t)sign;
  if (exponent >= 31) return (uint16_t)(sign | 0x7c00);
  return (uint16_t)(sign | (exponent << 10) | (mantissa >> 13));
}

static NSUInteger componentsOf(GLenum format) {
  switch (format) {
    case GL_RGBA:
    case GL_RGBA_INTEGER:
      return 4;
    case GL_RGB:
    case GL_RGB_INTEGER:
      return 3;
    case GL_RG:
    case GL_RG_INTEGER:
    case GL_LUMINANCE_ALPHA:
      return 2;
    default:
      return 1;
  }
}

@implementation AngularLynxWebGLContext {
  EGLDisplay _display;
  EGLConfig _config;
  EGLContext _context;
  BOOL _alpha;
  BOOL _depth;
  BOOL _stencil;
  BOOL _preserveDrawingBuffer;
  GLint _samples;

  // The default framebuffer, multisampled when antialias is on, and the
  // single-sampled framebuffer it resolves into before it's shown.
  GLuint _framebuffer;
  GLuint _colorBuffer;
  GLuint _depthStencilBuffer;
  GLuint _resolveFramebuffer;
  GLuint _resolveBuffer;
  GLsizei _width;
  GLsizei _height;

  // The view's layer, as a window surface each frame is copied into. Made
  // when a frame is first shown in the view, as the surface's framebuffer 0.
  __weak AngularLynxCanvasView *_view;
  EGLSurface _surface;
  /// A frame was finished before there was a view to show it in.
  BOOL _framePending;

  // The app's bindings, which drawing the frame changes and then restores.
  GLuint _drawFramebuffer;
  GLuint _readFramebuffer;
  GLuint _renderbuffer;

  // The runtime's object ids, to GL names (ids are never reused).
  GLuint *_names;
  NSUInteger _namesCapacity;
  NSMutableDictionary<NSNumber *, NSValue *> *_syncs;
}

- (instancetype)initWithCanvasId:(NSString *)canvasId
                      attributes:(NSDictionary *)attributes
                           error:(NSString **)error {
  if (!(self = [super init])) return nil;
  _canvasId = [canvasId copy];
  _display = metalDisplay();
  if (_display == EGL_NO_DISPLAY) {
    *error = @"ANGLE could not start on Metal";
    return nil;
  }
  // The window surface only receives finished frames: the default
  // framebuffer the app draws to, with its depth, stencil and samples, is
  // the offscreen one below. So the surface needs color and nothing else.
  const EGLint configAttributes[] = {
      EGL_RED_SIZE,        8,
      EGL_GREEN_SIZE,      8,
      EGL_BLUE_SIZE,       8,
      EGL_ALPHA_SIZE,      8,
      EGL_DEPTH_SIZE,      0,
      EGL_STENCIL_SIZE,    0,
      EGL_SAMPLES,         0,
      EGL_SURFACE_TYPE,    EGL_WINDOW_BIT,
      EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
      EGL_NONE,
  };
  EGLint configCount = 0;
  if (!eglChooseConfig(_display, configAttributes, &_config, 1, &configCount) ||
      configCount < 1) {
    *error = @"ANGLE has no RGBA8 window config";
    return nil;
  }
  // Robust resource initialization makes textures, renderbuffers and
  // buffers made without data read as zeros, as WebGL requires and as
  // browsers get it from ANGLE, rather than as whatever the memory held.
  const EGLint contextAttributes[] = {
      EGL_CONTEXT_MAJOR_VERSION,                3,
      EGL_CONTEXT_MINOR_VERSION,                0,
      EGL_ROBUST_RESOURCE_INITIALIZATION_ANGLE, EGL_TRUE,
      EGL_NONE,
  };
  _context = eglCreateContext(_display, _config, EGL_NO_CONTEXT, contextAttributes);
  if (_context == EGL_NO_CONTEXT) {
    *error = [NSString
        stringWithFormat:@"ANGLE could not make an OpenGL ES 3.0 context (EGL error 0x%x)",
                         eglGetError()];
    return nil;
  }
  _surface = EGL_NO_SURFACE;
  _alpha = ![attributes[@"alpha"] isEqual:@NO];
  _depth = ![attributes[@"depth"] isEqual:@NO];
  _stencil = [attributes[@"stencil"] isEqual:@YES];
  _preserveDrawingBuffer = [attributes[@"preserveDrawingBuffer"] isEqual:@YES];
  _syncs = [NSMutableDictionary dictionary];
  _namesCapacity = 256;
  _names = calloc(_namesCapacity, sizeof(GLuint));

  [self makeCurrent];
  if ([attributes[@"antialias"] isEqual:@NO]) {
    _samples = 0;
  } else {
    GLint maxSamples = 0;
    glGetIntegerv(GL_MAX_SAMPLES, &maxSamples);
    _samples = MIN(4, maxSamples);
  }
  glGenFramebuffers(1, &_framebuffer);
  glGenRenderbuffers(1, &_colorBuffer);
  if (_depth || _stencil) glGenRenderbuffers(1, &_depthStencilBuffer);
  if (_samples > 0) {
    glGenFramebuffers(1, &_resolveFramebuffer);
    glGenRenderbuffers(1, &_resolveBuffer);
  }
  _drawFramebuffer = _framebuffer;
  _readFramebuffer = _framebuffer;
  [self allocateDrawingBufferWidth:1 height:1];
  glBindFramebuffer(GL_FRAMEBUFFER, _framebuffer);
  return self;
}

- (void)dealloc {
  [self destroy];
  free(_names);
}

- (void)destroy {
  if (_context == EGL_NO_CONTEXT) return;
  [self makeCurrent];
  glDeleteFramebuffers(1, &_framebuffer);
  glDeleteRenderbuffers(1, &_colorBuffer);
  if (_depthStencilBuffer) glDeleteRenderbuffers(1, &_depthStencilBuffer);
  if (_resolveFramebuffer) glDeleteFramebuffers(1, &_resolveFramebuffer);
  if (_resolveBuffer) glDeleteRenderbuffers(1, &_resolveBuffer);
  for (NSValue *sync in _syncs.allValues) glDeleteSync(sync.pointerValue);
  [_syncs removeAllObjects];
  // The objects the app made go with the context.
  eglMakeCurrent(_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
  if (_surface != EGL_NO_SURFACE) eglDestroySurface(_display, _surface);
  _surface = EGL_NO_SURFACE;
  eglDestroyContext(_display, _context);
  _context = EGL_NO_CONTEXT;
}

/// Makes this the thread's context, drawing to the view's surface when there
/// is one (ANGLE has surfaceless contexts for the rest). Nothing else in the
/// app uses ANGLE, so the context stays current after a batch, and the next
/// batch for the same canvas skips the switch.
- (void)makeCurrent {
  if (eglGetCurrentContext() == _context && eglGetCurrentSurface(EGL_DRAW) == _surface) return;
  eglMakeCurrent(_display, _surface, _surface, _context);
}

/// Lets go of the view's surface, which holds its layer.
- (void)releaseSurface {
  if (_surface == EGL_NO_SURFACE) return;
  if (eglGetCurrentSurface(EGL_DRAW) == _surface) {
    eglMakeCurrent(_display, EGL_NO_SURFACE, EGL_NO_SURFACE, _context);
  }
  eglDestroySurface(_display, _surface);
  _surface = EGL_NO_SURFACE;
}

#pragma mark - Default framebuffer

- (GLenum)colorFormat {
  return _alpha ? GL_RGBA8 : GL_RGB8;
}

- (GLenum)depthStencilFormat {
  if (_depth && _stencil) return GL_DEPTH24_STENCIL8;
  return _depth ? GL_DEPTH_COMPONENT24 : GL_STENCIL_INDEX8;
}

/// (Re)allocates the default framebuffer at the canvas's size, cleared, as
/// WebGL's is when the canvas resizes.
- (void)allocateDrawingBufferWidth:(GLsizei)width height:(GLsizei)height {
  _width = MAX(1, width);
  _height = MAX(1, height);
  glBindRenderbuffer(GL_RENDERBUFFER, _colorBuffer);
  if (_samples > 0) {
    glRenderbufferStorageMultisample(GL_RENDERBUFFER, _samples, [self colorFormat], _width,
                                     _height);
  } else {
    glRenderbufferStorage(GL_RENDERBUFFER, [self colorFormat], _width, _height);
  }
  if (_depthStencilBuffer) {
    glBindRenderbuffer(GL_RENDERBUFFER, _depthStencilBuffer);
    if (_samples > 0) {
      glRenderbufferStorageMultisample(GL_RENDERBUFFER, _samples, [self depthStencilFormat],
                                       _width, _height);
    } else {
      glRenderbufferStorage(GL_RENDERBUFFER, [self depthStencilFormat], _width, _height);
    }
  }
  glBindFramebuffer(GL_FRAMEBUFFER, _framebuffer);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, _colorBuffer);
  if (_depthStencilBuffer) {
    if (_depth) {
      glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER,
                                _depthStencilBuffer);
    }
    if (_stencil) {
      glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_STENCIL_ATTACHMENT, GL_RENDERBUFFER,
                                _depthStencilBuffer);
    }
  }
  if (_samples > 0) {
    glBindRenderbuffer(GL_RENDERBUFFER, _resolveBuffer);
    glRenderbufferStorage(GL_RENDERBUFFER, [self colorFormat], _width, _height);
    glBindFramebuffer(GL_FRAMEBUFFER, _resolveFramebuffer);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER,
                              _resolveBuffer);
  }
  [self clearDrawingBuffer];
  glBindRenderbuffer(GL_RENDERBUFFER, _renderbuffer);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, _drawFramebuffer);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, _readFramebuffer);
}

/// Clears the default framebuffer whatever the app's clear values, masks and
/// scissor, and puts them back.
- (void)clearDrawingBuffer {
  GLfloat clearColor[4];
  GLfloat clearDepth;
  GLint clearStencil;
  GLboolean colorMask[4];
  GLboolean depthMask;
  GLint stencilMask, stencilBackMask;
  glGetFloatv(GL_COLOR_CLEAR_VALUE, clearColor);
  glGetFloatv(GL_DEPTH_CLEAR_VALUE, &clearDepth);
  glGetIntegerv(GL_STENCIL_CLEAR_VALUE, &clearStencil);
  glGetBooleanv(GL_COLOR_WRITEMASK, colorMask);
  glGetBooleanv(GL_DEPTH_WRITEMASK, &depthMask);
  glGetIntegerv(GL_STENCIL_WRITEMASK, &stencilMask);
  glGetIntegerv(GL_STENCIL_BACK_WRITEMASK, &stencilBackMask);
  GLboolean scissor = glIsEnabled(GL_SCISSOR_TEST);
  GLboolean discard = glIsEnabled(GL_RASTERIZER_DISCARD);

  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, _framebuffer);
  glDisable(GL_SCISSOR_TEST);
  glDisable(GL_RASTERIZER_DISCARD);
  glClearColor(0, 0, 0, 0);
  glClearDepthf(1);
  glClearStencil(0);
  glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
  glDepthMask(GL_TRUE);
  glStencilMask(0xffffffff);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);

  glClearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
  glClearDepthf(clearDepth);
  glClearStencil(clearStencil);
  glColorMask(colorMask[0], colorMask[1], colorMask[2], colorMask[3]);
  glDepthMask(depthMask);
  glStencilMaskSeparate(GL_FRONT, (GLuint)stencilMask);
  glStencilMaskSeparate(GL_BACK, (GLuint)stencilBackMask);
  if (scissor) glEnable(GL_SCISSOR_TEST);
  if (discard) glEnable(GL_RASTERIZER_DISCARD);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, _drawFramebuffer);
}

- (void)attachView:(AngularLynxCanvasView *)view {
  // A view that went away has already turned _view (weak) to nil, but its
  // layer lives on in the surface until the surface is let go of here.
  if (_view == view && (view || _surface == EGL_NO_SURFACE)) return;
  [self releaseSurface];
  _view = view;
  if (view) {
    view.layer.opaque = !_alpha;
    view.opaque = !_alpha;
    if (_framePending) [self present];
  }
}

- (void)viewDidLayOut:(AngularLynxCanvasView *)view {
  if (view == _view && _framePending) [self present];
}

/// Shows the finished frame: copies the default framebuffer (resolving it
/// when it's multisampled) into the view's layer, scaled to its size, and
/// presents it. Without a laid-out view, the frame waits for one.
- (void)present {
  AngularLynxCanvasView *view = _view;
  CGSize size = view.bounds.size;
  // ANGLE sizes the layer's next drawable from its bounds and scale, as
  // here, when the blit below first draws to it.
  CGFloat scale = view.layer.contentsScale;
  GLint layerWidth = (GLint)(size.width * scale);
  GLint layerHeight = (GLint)(size.height * scale);
  if (!view || layerWidth < 1 || layerHeight < 1) {
    _framePending = YES;
    return;
  }
  if (_surface == EGL_NO_SURFACE) {
    _surface = eglCreateWindowSurface(_display, _config, (__bridge EGLNativeWindowType)view.layer,
                                      NULL);
    if (_surface == EGL_NO_SURFACE) {
      NSLog(@"[AngularLynxWebGL] No window surface for the canvas (EGL error 0x%x)", eglGetError());
      _framePending = YES;
      return;
    }
  }
  [self makeCurrent];
  // A blit is clipped by the scissor test, and skipped with rasterizer
  // discard on, so both are off while the frame is copied.
  GLboolean scissor = glIsEnabled(GL_SCISSOR_TEST);
  GLboolean discard = glIsEnabled(GL_RASTERIZER_DISCARD);
  glDisable(GL_SCISSOR_TEST);
  glDisable(GL_RASTERIZER_DISCARD);
  GLuint source = _framebuffer;
  if (_samples > 0) {
    glBindFramebuffer(GL_READ_FRAMEBUFFER, _framebuffer);
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, _resolveFramebuffer);
    glBlitFramebuffer(0, 0, _width, _height, 0, 0, _width, _height, GL_COLOR_BUFFER_BIT,
                      GL_NEAREST);
    source = _resolveFramebuffer;
  }
  glBindFramebuffer(GL_READ_FRAMEBUFFER, source);
  glReadBuffer(GL_COLOR_ATTACHMENT0);
  // Framebuffer 0 is the window surface's.
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
  BOOL sameSize = layerWidth == _width && layerHeight == _height;
  glBlitFramebuffer(0, 0, _width, _height, 0, 0, layerWidth, layerHeight, GL_COLOR_BUFFER_BIT,
                    sameSize ? GL_NEAREST : GL_LINEAR);
  if (!eglSwapBuffers(_display, _surface)) {
    NSLog(@"[AngularLynxWebGL] Showing a frame failed (EGL error 0x%x)", eglGetError());
  }
  _framePending = NO;
  if (scissor) glEnable(GL_SCISSOR_TEST);
  if (discard) glEnable(GL_RASTERIZER_DISCARD);
  // WebGL clears the drawing buffer once it's been shown, unless the app
  // asked to keep it.
  if (!_preserveDrawingBuffer) [self clearDrawingBuffer];
  [self restoreBindings];
}

- (void)restoreBindings {
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, _drawFramebuffer);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, _readFramebuffer);
  glBindRenderbuffer(GL_RENDERBUFFER, _renderbuffer);
}

/// WebGL reads an antialiased default framebuffer as one image, its samples
/// resolved, but GLES can't read a multisampled framebuffer: readPixels and
/// copyTexImage2D on one are INVALID_OPERATION and read nothing. So a read of
/// the default framebuffer resolves it, as present does, and reads the
/// resolved copy. Returns whether it did, for endRead: to bind the app's read
/// framebuffer again.
- (BOOL)beginRead {
  if (_samples == 0 || ![self defaultFramebufferBoundTo:GL_READ_FRAMEBUFFER]) return NO;
  // A blit is clipped by the scissor test, and skipped with rasterizer
  // discard on, so both are off while the samples are resolved.
  GLboolean scissor = glIsEnabled(GL_SCISSOR_TEST);
  GLboolean discard = glIsEnabled(GL_RASTERIZER_DISCARD);
  glDisable(GL_SCISSOR_TEST);
  glDisable(GL_RASTERIZER_DISCARD);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, _resolveFramebuffer);
  glBlitFramebuffer(0, 0, _width, _height, 0, 0, _width, _height, GL_COLOR_BUFFER_BIT,
                    GL_NEAREST);
  if (scissor) glEnable(GL_SCISSOR_TEST);
  if (discard) glEnable(GL_RASTERIZER_DISCARD);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, _drawFramebuffer);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, _resolveFramebuffer);
  return YES;
}

- (void)endRead:(BOOL)resolved {
  if (resolved) glBindFramebuffer(GL_READ_FRAMEBUFFER, _readFramebuffer);
}

#pragma mark - Image files

/// The drawing buffer as an image file, for the runtime's canvas.toBlob() and
/// toDataURL(): `{ base64, type }`, or `{ error }`.
///
/// It reads what the drawing buffer holds now, as a browser does: what the
/// app has drawn since the last frame was shown, or, once a frame has been
/// shown without preserveDrawingBuffer, the cleared buffer. The pixels are
/// encoded here rather than sent to the runtime, which would have to carry
/// 11 MB of RGBA for a 2048 by 1365 photo across the bridge as numbers, and
/// encode it in JavaScript on PrimJS, which has no JIT. The file crosses as
/// base64: the bridge can't return bytes (see webgl-bridge.ts).
- (NSDictionary *)encodeImageOfType:(NSString *)type
                            quality:(double)quality
                      premultiplied:(BOOL)premultiplied {
  if (_context == EGL_NO_CONTEXT) return @{@"error" : @"The WebGL context is gone"};
  [self makeCurrent];
  size_t width = (size_t)_width;
  size_t height = (size_t)_height;
  size_t stride = width * 4;
  NSMutableData *pixels = [NSMutableData dataWithLength:stride * height];
  if (!pixels) return @{@"error" : @"Could not allocate the canvas's pixels"};

  // A plain read of the whole default framebuffer, whatever the app has
  // bound and set: its pixel pack buffer and pack parameters would move or
  // redirect the read. The app's state is put back after.
  GLint packBuffer = 0, alignment = 4, rowLength = 0, skipPixels = 0, skipRows = 0;
  glGetIntegerv(GL_PIXEL_PACK_BUFFER_BINDING, &packBuffer);
  glGetIntegerv(GL_PACK_ALIGNMENT, &alignment);
  glGetIntegerv(GL_PACK_ROW_LENGTH, &rowLength);
  glGetIntegerv(GL_PACK_SKIP_PIXELS, &skipPixels);
  glGetIntegerv(GL_PACK_SKIP_ROWS, &skipRows);
  glPixelStorei(GL_PACK_ALIGNMENT, 4);
  glPixelStorei(GL_PACK_ROW_LENGTH, 0);
  glPixelStorei(GL_PACK_SKIP_PIXELS, 0);
  glPixelStorei(GL_PACK_SKIP_ROWS, 0);
  GLuint source = _framebuffer;
  if (_samples > 0) {
    // GLES can't read a multisampled framebuffer: its samples are resolved
    // first, as present and beginRead do. A blit is clipped by the scissor
    // test, and skipped with rasterizer discard on, so both are off for it.
    GLboolean scissor = glIsEnabled(GL_SCISSOR_TEST);
    GLboolean discard = glIsEnabled(GL_RASTERIZER_DISCARD);
    glDisable(GL_SCISSOR_TEST);
    glDisable(GL_RASTERIZER_DISCARD);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, _framebuffer);
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, _resolveFramebuffer);
    glBlitFramebuffer(0, 0, _width, _height, 0, 0, _width, _height, GL_COLOR_BUFFER_BIT,
                      GL_NEAREST);
    if (scissor) glEnable(GL_SCISSOR_TEST);
    if (discard) glEnable(GL_RASTERIZER_DISCARD);
    source = _resolveFramebuffer;
  }
  glBindFramebuffer(GL_READ_FRAMEBUFFER, source);
  glReadBuffer(GL_COLOR_ATTACHMENT0);
  // Read into a pixel pack buffer and mapped, rather than straight into
  // memory: ANGLE on Metal reads a 2048 by 1365 canvas into memory in
  // about 145 ms on the Simulator, and into a buffer, mapped, in about 5.
  GLuint pack = 0;
  glGenBuffers(1, &pack);
  glBindBuffer(GL_PIXEL_PACK_BUFFER, pack);
  glBufferData(GL_PIXEL_PACK_BUFFER, (GLsizeiptr)(stride * height), NULL, GL_STREAM_READ);
  glReadPixels(0, 0, _width, _height, GL_RGBA, GL_UNSIGNED_BYTE, 0);
  const uint8_t *read =
      glMapBufferRange(GL_PIXEL_PACK_BUFFER, 0, (GLsizeiptr)(stride * height), GL_MAP_READ_BIT);
  uint8_t *bytes = pixels.mutableBytes;
  if (read) {
    // GL's first row is the bottom of the image; an image file's is the
    // top. So the rows are copied in the other order.
    for (size_t y = 0; y < height; y++) {
      memcpy(bytes + y * stride, read + (height - 1 - y) * stride, stride);
    }
    glUnmapBuffer(GL_PIXEL_PACK_BUFFER);
  }
  glDeleteBuffers(1, &pack);
  glBindBuffer(GL_PIXEL_PACK_BUFFER, (GLuint)packBuffer);
  glPixelStorei(GL_PACK_ALIGNMENT, alignment);
  glPixelStorei(GL_PACK_ROW_LENGTH, rowLength);
  glPixelStorei(GL_PACK_SKIP_PIXELS, skipPixels);
  glPixelStorei(GL_PACK_SKIP_ROWS, skipRows);
  [self restoreBindings];
  if (!read) return @{@"error" : @"Could not read the canvas's pixels"};

  BOOL jpeg = [type isEqualToString:@"image/jpeg"];
  CGBitmapInfo alphaInfo;
  if (!_alpha) {
    alphaInfo = (CGBitmapInfo)kCGImageAlphaNoneSkipLast;
  } else if (jpeg) {
    // A JPEG has no transparency. Browsers draw a canvas's transparent
    // pixels over black for one, which premultiplied colors already are:
    // straight ones are multiplied first.
    if (!premultiplied) {
      for (size_t i = 0; i < stride * height; i += 4) {
        uint8_t alpha = bytes[i + 3];
        if (alpha == 255) continue;
        bytes[i] = (uint8_t)((bytes[i] * alpha + 127) / 255);
        bytes[i + 1] = (uint8_t)((bytes[i + 1] * alpha + 127) / 255);
        bytes[i + 2] = (uint8_t)((bytes[i + 2] * alpha + 127) / 255);
      }
    }
    alphaInfo = (CGBitmapInfo)kCGImageAlphaNoneSkipLast;
  } else {
    // The drawing buffer's colors are premultiplied by alpha unless the app
    // asked for premultipliedAlpha: false. ImageIO writes the PNG's straight
    // colors from either.
    alphaInfo = (CGBitmapInfo)(premultiplied ? kCGImageAlphaPremultipliedLast : kCGImageAlphaLast);
  }
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

#pragma mark - Objects

- (GLuint)nameOf:(GLuint)objectId {
  return objectId < _namesCapacity ? _names[objectId] : 0;
}

- (void)setName:(GLuint)name forId:(GLuint)objectId {
  if (objectId >= _namesCapacity) {
    NSUInteger capacity = _namesCapacity;
    while (capacity <= objectId) capacity *= 2;
    _names = realloc(_names, capacity * sizeof(GLuint));
    memset(_names + _namesCapacity, 0, (capacity - _namesCapacity) * sizeof(GLuint));
    _namesCapacity = capacity;
  }
  _names[objectId] = name;
}

- (GLuint)takeName:(GLuint)objectId {
  GLuint name = [self nameOf:objectId];
  if (objectId < _namesCapacity) _names[objectId] = 0;
  return name;
}

- (GLsync)syncOf:(GLuint)objectId {
  return _syncs[@(objectId)].pointerValue;
}

/// The bound framebuffer for a target, as the default one or not.
- (BOOL)defaultFramebufferBoundTo:(GLenum)target {
  return (target == GL_READ_FRAMEBUFFER ? _readFramebuffer : _drawFramebuffer) == _framebuffer;
}

/// WebGL's BACK, COLOR, DEPTH and STENCIL name the default framebuffer's
/// buffers, which here are ordinary attachments.
- (GLenum)attachmentFor:(GLenum)attachment target:(GLenum)target {
  if (![self defaultFramebufferBoundTo:target]) return attachment;
  switch (attachment) {
    case WEBGL_BACK:
    case WEBGL_COLOR:
      return GL_COLOR_ATTACHMENT0;
    case WEBGL_DEPTH:
      return GL_DEPTH_ATTACHMENT;
    case WEBGL_STENCIL:
      return GL_STENCIL_ATTACHMENT;
    default:
      return attachment;
  }
}

#pragma mark - Pixels

/// An upload's pixels (see #pixels in webgl2-context.ts): NULL, an offset
/// into the bound PIXEL_UNPACK_BUFFER, bytes, or a decoded image converted to
/// the format and type. `holder` keeps converted bytes alive for the call.
- (const void *)pixels:(id)source
                format:(GLenum)format
                  type:(GLenum)type
                 width:(GLsizei)width
                height:(GLsizei)height
                holder:(NSData **)holder
               isImage:(BOOL *)isImage {
  *isImage = NO;
  if (!source || source == (id)kCFNull) return NULL;
  if ([source isKindOfClass:NSNumber.class]) {
    return (const void *)(intptr_t)[source longLongValue];
  }
  if ([source isKindOfClass:NSArray.class]) {
    *holder = AngularLynxBytesFromWords(source);
    return (*holder).bytes;
  }
  if (![source isKindOfClass:NSDictionary.class]) return NULL;
  AngularLynxDecodedImage *image =
      [AngularLynxDecodedImage imageWithId:[source[@"image"] integerValue]];
  if (!image) return NULL;
  *isImage = YES;
  *holder = [self convertImage:image
                        format:format
                          type:type
                         flipY:[source[@"flipY"] boolValue]
                   premultiply:[source[@"premultiply"] boolValue]];
  return (*holder).bytes;
}

/// A decoded image's RGBA bytes as the format and type an upload names,
/// tightly packed, flipped and premultiplied as asked.
- (NSData *)convertImage:(AngularLynxDecodedImage *)image
                  format:(GLenum)format
                    type:(GLenum)type
                   flipY:(BOOL)flipY
             premultiply:(BOOL)premultiply {
  NSInteger width = image.width;
  NSInteger height = image.height;
  const uint8_t *rgba = image.pixels.bytes;
  NSUInteger components = componentsOf(format);
  BOOL packed = type == GL_UNSIGNED_SHORT_5_6_5 || type == GL_UNSIGNED_SHORT_4_4_4_4 ||
                type == GL_UNSIGNED_SHORT_5_5_5_1;
  NSUInteger componentSize = type == GL_FLOAT ? 4 : (type == GL_HALF_FLOAT ? 2 : 1);
  NSUInteger pixelSize = packed ? 2 : components * componentSize;
  NSMutableData *out = [NSMutableData dataWithLength:width * height * pixelSize];
  uint8_t *bytes = out.mutableBytes;
  BOOL multiply = premultiply && !image.premultiplied;
  for (NSInteger y = 0; y < height; y++) {
    const uint8_t *row = rgba + (flipY ? height - 1 - y : y) * width * 4;
    uint8_t *outRow = bytes + y * width * pixelSize;
    for (NSInteger x = 0; x < width; x++) {
      float r = row[x * 4], g = row[x * 4 + 1], b = row[x * 4 + 2], a = row[x * 4 + 3];
      if (multiply) {
        r = r * a / 255;
        g = g * a / 255;
        b = b * a / 255;
      }
      float channels[4];
      switch (format) {
        case GL_LUMINANCE:
          channels[0] = r;
          break;
        case GL_ALPHA:
          channels[0] = a;
          break;
        case GL_LUMINANCE_ALPHA:
          channels[0] = r;
          channels[1] = a;
          break;
        default:
          channels[0] = r;
          channels[1] = g;
          channels[2] = b;
          channels[3] = a;
      }
      uint8_t *pixel = outRow + x * pixelSize;
      if (packed) {
        uint16_t value;
        if (type == GL_UNSIGNED_SHORT_5_6_5) {
          value = (uint16_t)(((int)(r / 255 * 31 + 0.5f) << 11) |
                             ((int)(g / 255 * 63 + 0.5f) << 5) | (int)(b / 255 * 31 + 0.5f));
        } else if (type == GL_UNSIGNED_SHORT_4_4_4_4) {
          value = (uint16_t)(((int)(r / 255 * 15 + 0.5f) << 12) |
                             ((int)(g / 255 * 15 + 0.5f) << 8) |
                             ((int)(b / 255 * 15 + 0.5f) << 4) | (int)(a / 255 * 15 + 0.5f));
        } else {
          value = (uint16_t)(((int)(r / 255 * 31 + 0.5f) << 11) |
                             ((int)(g / 255 * 31 + 0.5f) << 6) |
                             ((int)(b / 255 * 31 + 0.5f) << 1) | (a >= 128 ? 1 : 0));
        }
        memcpy(pixel, &value, 2);
        continue;
      }
      for (NSUInteger c = 0; c < components; c++) {
        if (type == GL_FLOAT) {
          float value = channels[c] / 255;
          memcpy(pixel + c * 4, &value, 4);
        } else if (type == GL_HALF_FLOAT) {
          uint16_t value = halfFromFloat(channels[c] / 255);
          memcpy(pixel + c * 2, &value, 2);
        } else {
          pixel[c] = (uint8_t)(channels[c] + 0.5f);
        }
      }
    }
  }
  return out;
}

/// Runs an upload of converted image bytes with tightly packed unpacking,
/// whatever the app set: the bytes were packed for it here.
- (void)withTightUnpacking:(BOOL)tight upload:(void (^)(void))upload {
  if (!tight) {
    upload();
    return;
  }
  GLint alignment, rowLength, imageHeight, skipPixels, skipRows, skipImages;
  glGetIntegerv(GL_UNPACK_ALIGNMENT, &alignment);
  glGetIntegerv(GL_UNPACK_ROW_LENGTH, &rowLength);
  glGetIntegerv(GL_UNPACK_IMAGE_HEIGHT, &imageHeight);
  glGetIntegerv(GL_UNPACK_SKIP_PIXELS, &skipPixels);
  glGetIntegerv(GL_UNPACK_SKIP_ROWS, &skipRows);
  glGetIntegerv(GL_UNPACK_SKIP_IMAGES, &skipImages);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
  glPixelStorei(GL_UNPACK_IMAGE_HEIGHT, 0);
  glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
  glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
  glPixelStorei(GL_UNPACK_SKIP_IMAGES, 0);
  upload();
  glPixelStorei(GL_UNPACK_ALIGNMENT, alignment);
  glPixelStorei(GL_UNPACK_ROW_LENGTH, rowLength);
  glPixelStorei(GL_UNPACK_IMAGE_HEIGHT, imageHeight);
  glPixelStorei(GL_UNPACK_SKIP_PIXELS, skipPixels);
  glPixelStorei(GL_UNPACK_SKIP_ROWS, skipRows);
  glPixelStorei(GL_UNPACK_SKIP_IMAGES, skipImages);
}

#pragma mark - Queries

- (id)parameter:(GLenum)pname {
  switch (pname) {
    case WEBGL_UNMASKED_VENDOR:
      return glString(GL_VENDOR);
    case WEBGL_UNMASKED_RENDERER:
      return glString(GL_RENDERER);
    case GL_VENDOR:
    case GL_RENDERER:
    case GL_VERSION:
    case GL_SHADING_LANGUAGE_VERSION:
      return glString(pname);
    case GL_ALIASED_LINE_WIDTH_RANGE:
    case GL_ALIASED_POINT_SIZE_RANGE:
    case GL_DEPTH_RANGE: {
      GLfloat values[2] = {0, 0};
      glGetFloatv(pname, values);
      return numbersFromFloats(values, 2);
    }
    case GL_COLOR_CLEAR_VALUE:
    case GL_BLEND_COLOR: {
      GLfloat values[4] = {0, 0, 0, 0};
      glGetFloatv(pname, values);
      return numbersFromFloats(values, 4);
    }
    case GL_MAX_VIEWPORT_DIMS: {
      GLint values[2] = {0, 0};
      glGetIntegerv(pname, values);
      return numbersFromInts(values, 2);
    }
    case GL_SCISSOR_BOX:
    case GL_VIEWPORT: {
      GLint values[4] = {0, 0, 0, 0};
      glGetIntegerv(pname, values);
      return numbersFromInts(values, 4);
    }
    case GL_COLOR_WRITEMASK: {
      GLboolean values[4] = {0, 0, 0, 0};
      glGetBooleanv(pname, values);
      return @[ @(values[0]), @(values[1]), @(values[2]), @(values[3]) ];
    }
    case GL_COMPRESSED_TEXTURE_FORMATS: {
      GLint count = 0;
      glGetIntegerv(GL_NUM_COMPRESSED_TEXTURE_FORMATS, &count);
      GLint *values = calloc(MAX(count, 1), sizeof(GLint));
      glGetIntegerv(pname, values);
      NSArray *result = numbersFromInts(values, count);
      free(values);
      return result;
    }
    case GL_DEPTH_CLEAR_VALUE:
    case GL_LINE_WIDTH:
    case GL_POLYGON_OFFSET_FACTOR:
    case GL_POLYGON_OFFSET_UNITS:
    case GL_SAMPLE_COVERAGE_VALUE:
    case GL_MAX_TEXTURE_LOD_BIAS:
    case GL_MAX_TEXTURE_MAX_ANISOTROPY: {
      GLfloat value = 0;
      glGetFloatv(pname, &value);
      return @(value);
    }
    case GL_MAX_ELEMENT_INDEX:
    case GL_MAX_SERVER_WAIT_TIMEOUT:
    case GL_MAX_UNIFORM_BLOCK_SIZE:
    case GL_MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS:
    case GL_MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS: {
      GLint64 value = 0;
      glGetInteger64v(pname, &value);
      return @(value);
    }
    case GL_BLEND:
    case GL_CULL_FACE:
    case GL_DEPTH_TEST:
    case GL_DITHER:
    case GL_POLYGON_OFFSET_FILL:
    case GL_RASTERIZER_DISCARD:
    case GL_SAMPLE_ALPHA_TO_COVERAGE:
    case GL_SAMPLE_COVERAGE:
    case GL_SCISSOR_TEST:
    case GL_STENCIL_TEST:
      return @(glIsEnabled(pname) == GL_TRUE);
    case GL_DEPTH_WRITEMASK:
    case GL_SAMPLE_COVERAGE_INVERT:
    case GL_TRANSFORM_FEEDBACK_ACTIVE:
    case GL_TRANSFORM_FEEDBACK_PAUSED: {
      GLboolean value = GL_FALSE;
      glGetBooleanv(pname, &value);
      return @(value == GL_TRUE);
    }
    case GL_STENCIL_VALUE_MASK:
    case GL_STENCIL_WRITEMASK:
    case GL_STENCIL_BACK_VALUE_MASK:
    case GL_STENCIL_BACK_WRITEMASK: {
      GLint value = 0;
      glGetIntegerv(pname, &value);
      return @((GLuint)value);
    }
    default: {
      GLint value = 0;
      glGetIntegerv(pname, &value);
      return @(value);
    }
  }
}

static NSString *programLog(GLuint program) {
  GLint length = 0;
  glGetProgramiv(program, GL_INFO_LOG_LENGTH, &length);
  if (length <= 1) return @"";
  char *log = malloc(length);
  glGetProgramInfoLog(program, length, NULL, log);
  NSString *result = [NSString stringWithUTF8String:log] ?: @"";
  free(log);
  return result;
}

static NSString *shaderLog(GLuint shader) {
  GLint length = 0;
  glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &length);
  if (length <= 1) return @"";
  char *log = malloc(length);
  glGetShaderInfoLog(shader, length, NULL, log);
  NSString *result = [NSString stringWithUTF8String:log] ?: @"";
  free(log);
  return result;
}

/// The link status, log and reflection three.js reads after each link, in
/// one answer. Built-ins (`gl_*`) are left out, as WebGL does.
- (NSDictionary *)programInfo:(GLuint)program {
  GLint linked = GL_FALSE;
  glGetProgramiv(program, GL_LINK_STATUS, &linked);
  NSMutableArray *uniforms = [NSMutableArray array];
  NSMutableArray *attributes = [NSMutableArray array];
  GLint blocks = 0;
  GLint varyings = 0;
  if (linked) {
    GLint count = 0, maxLength = 0;
    glGetProgramiv(program, GL_ACTIVE_UNIFORMS, &count);
    glGetProgramiv(program, GL_ACTIVE_UNIFORM_MAX_LENGTH, &maxLength);
    char *name = malloc(MAX(maxLength, 1) + 1);
    for (GLint i = 0; i < count; i++) {
      GLsizei length = 0;
      GLint size = 0;
      GLenum type = 0;
      glGetActiveUniform(program, i, maxLength + 1, &length, &size, &type, name);
      if (strncmp(name, "gl_", 3) == 0) continue;
      GLint location = glGetUniformLocation(program, name);
      [uniforms addObject:@[ @(name), @(size), @(type), @(location) ]];
    }
    free(name);
    glGetProgramiv(program, GL_ACTIVE_ATTRIBUTES, &count);
    glGetProgramiv(program, GL_ACTIVE_ATTRIBUTE_MAX_LENGTH, &maxLength);
    name = malloc(MAX(maxLength, 1) + 1);
    for (GLint i = 0; i < count; i++) {
      GLsizei length = 0;
      GLint size = 0;
      GLenum type = 0;
      glGetActiveAttrib(program, i, maxLength + 1, &length, &size, &type, name);
      if (strncmp(name, "gl_", 3) == 0) continue;
      GLint location = glGetAttribLocation(program, name);
      [attributes addObject:@[ @(name), @(size), @(type), @(location) ]];
    }
    free(name);
    glGetProgramiv(program, GL_ACTIVE_UNIFORM_BLOCKS, &blocks);
    glGetProgramiv(program, GL_TRANSFORM_FEEDBACK_VARYINGS, &varyings);
  }
  return @{
    @"linked" : @(linked == GL_TRUE),
    @"log" : programLog(program),
    @"uniforms" : uniforms,
    @"attributes" : attributes,
    @"uniformBlocks" : @(blocks),
    @"transformFeedbackVaryings" : @(varyings),
  };
}

/// How many values a uniform of a type holds.
static GLint uniformComponents(GLenum type) {
  switch (type) {
    case GL_FLOAT_VEC2:
    case GL_INT_VEC2:
    case GL_UNSIGNED_INT_VEC2:
    case GL_BOOL_VEC2:
      return 2;
    case GL_FLOAT_VEC3:
    case GL_INT_VEC3:
    case GL_UNSIGNED_INT_VEC3:
    case GL_BOOL_VEC3:
      return 3;
    case GL_FLOAT_VEC4:
    case GL_INT_VEC4:
    case GL_UNSIGNED_INT_VEC4:
    case GL_BOOL_VEC4:
    case GL_FLOAT_MAT2:
      return 4;
    case GL_FLOAT_MAT2x3:
    case GL_FLOAT_MAT3x2:
      return 6;
    case GL_FLOAT_MAT2x4:
    case GL_FLOAT_MAT4x2:
      return 8;
    case GL_FLOAT_MAT3:
      return 9;
    case GL_FLOAT_MAT3x4:
    case GL_FLOAT_MAT4x3:
      return 12;
    case GL_FLOAT_MAT4:
      return 16;
    default:
      return 1;
  }
}

static BOOL isFloatUniform(GLenum type) {
  switch (type) {
    case GL_FLOAT:
    case GL_FLOAT_VEC2:
    case GL_FLOAT_VEC3:
    case GL_FLOAT_VEC4:
    case GL_FLOAT_MAT2:
    case GL_FLOAT_MAT3:
    case GL_FLOAT_MAT4:
    case GL_FLOAT_MAT2x3:
    case GL_FLOAT_MAT3x2:
    case GL_FLOAT_MAT2x4:
    case GL_FLOAT_MAT4x2:
    case GL_FLOAT_MAT3x4:
    case GL_FLOAT_MAT4x3:
      return YES;
    default:
      return NO;
  }
}

static BOOL isUnsignedUniform(GLenum type) {
  return type == GL_UNSIGNED_INT || type == GL_UNSIGNED_INT_VEC2 ||
         type == GL_UNSIGNED_INT_VEC3 || type == GL_UNSIGNED_INT_VEC4;
}

#pragma mark - Running a batch

- (NSArray *)run:(NSArray *)commands {
  if (_context == EGL_NO_CONTEXT) return @[];
  [self makeCurrent];
  NSUInteger count = commands.count;
  __unsafe_unretained id *items = (__unsafe_unretained id *)malloc(sizeof(id) * MAX(count, 1));
  [commands getObjects:items range:NSMakeRange(0, count)];
  Reader reader = {items, count, 0};
  Reader *r = &reader;
  NSMutableArray *results = [NSMutableArray array];
  while (r->index < r->count) {
    NSInteger op = (NSInteger)nextNumber(r);
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

- (void)command:(NSInteger)op reader:(Reader *)r {
  switch ((ALWebGLOp)op) {
    case ALWebGLOpActiveTexture:
      glActiveTexture(nextEnum(r));
      break;
    case ALWebGLOpAttachShader: {
      GLuint program = [self nameOf:nextUInt(r)];
      glAttachShader(program, [self nameOf:nextUInt(r)]);
      break;
    }
    case ALWebGLOpBindAttribLocation: {
      GLuint program = [self nameOf:nextUInt(r)];
      GLuint index = nextUInt(r);
      glBindAttribLocation(program, index, nextString(r).UTF8String);
      break;
    }
    case ALWebGLOpBindBuffer: {
      GLenum target = nextEnum(r);
      glBindBuffer(target, [self nameOf:nextUInt(r)]);
      break;
    }
    case ALWebGLOpBindBufferBase: {
      GLenum target = nextEnum(r);
      GLuint index = nextUInt(r);
      glBindBufferBase(target, index, [self nameOf:nextUInt(r)]);
      break;
    }
    case ALWebGLOpBindBufferRange: {
      GLenum target = nextEnum(r);
      GLuint index = nextUInt(r);
      GLuint buffer = [self nameOf:nextUInt(r)];
      GLintptr offset = nextOffset(r);
      glBindBufferRange(target, index, buffer, offset, (GLsizeiptr)nextOffset(r));
      break;
    }
    case ALWebGLOpBindFramebuffer: {
      GLenum target = nextEnum(r);
      GLuint objectId = nextUInt(r);
      // null is the default framebuffer, which is one of ours.
      GLuint name = objectId ? [self nameOf:objectId] : _framebuffer;
      if (target == GL_FRAMEBUFFER || target == GL_DRAW_FRAMEBUFFER) _drawFramebuffer = name;
      if (target == GL_FRAMEBUFFER || target == GL_READ_FRAMEBUFFER) _readFramebuffer = name;
      glBindFramebuffer(target, name);
      break;
    }
    case ALWebGLOpBindRenderbuffer: {
      GLenum target = nextEnum(r);
      _renderbuffer = [self nameOf:nextUInt(r)];
      glBindRenderbuffer(target, _renderbuffer);
      break;
    }
    case ALWebGLOpBindSampler: {
      GLuint unit = nextUInt(r);
      glBindSampler(unit, [self nameOf:nextUInt(r)]);
      break;
    }
    case ALWebGLOpBindTexture: {
      GLenum target = nextEnum(r);
      glBindTexture(target, [self nameOf:nextUInt(r)]);
      break;
    }
    case ALWebGLOpBindTransformFeedback: {
      GLenum target = nextEnum(r);
      glBindTransformFeedback(target, [self nameOf:nextUInt(r)]);
      break;
    }
    case ALWebGLOpBindVertexArray:
      glBindVertexArray([self nameOf:nextUInt(r)]);
      break;
    case ALWebGLOpBeginQuery: {
      GLenum target = nextEnum(r);
      glBeginQuery(target, [self nameOf:nextUInt(r)]);
      break;
    }
    case ALWebGLOpBeginTransformFeedback:
      glBeginTransformFeedback(nextEnum(r));
      break;
    case ALWebGLOpBlendColor: {
      GLfloat red = nextFloat(r), green = nextFloat(r), blue = nextFloat(r);
      glBlendColor(red, green, blue, nextFloat(r));
      break;
    }
    case ALWebGLOpBlendEquation:
      glBlendEquation(nextEnum(r));
      break;
    case ALWebGLOpBlendEquationSeparate: {
      GLenum rgb = nextEnum(r);
      glBlendEquationSeparate(rgb, nextEnum(r));
      break;
    }
    case ALWebGLOpBlendFunc: {
      GLenum source = nextEnum(r);
      glBlendFunc(source, nextEnum(r));
      break;
    }
    case ALWebGLOpBlendFuncSeparate: {
      GLenum srcRGB = nextEnum(r), dstRGB = nextEnum(r), srcAlpha = nextEnum(r);
      glBlendFuncSeparate(srcRGB, dstRGB, srcAlpha, nextEnum(r));
      break;
    }
    case ALWebGLOpBlitFramebuffer: {
      GLint srcX0 = nextInt(r), srcY0 = nextInt(r), srcX1 = nextInt(r), srcY1 = nextInt(r);
      GLint dstX0 = nextInt(r), dstY0 = nextInt(r), dstX1 = nextInt(r), dstY1 = nextInt(r);
      GLbitfield mask = nextUInt(r);
      glBlitFramebuffer(srcX0, srcY0, srcX1, srcY1, dstX0, dstY0, dstX1, dstY1, mask,
                        nextEnum(r));
      break;
    }
    case ALWebGLOpBufferData: {
      GLenum target = nextEnum(r);
      id data = nextItem(r);
      GLenum usage = nextEnum(r);
      if ([data isKindOfClass:NSArray.class]) {
        NSData *bytes = AngularLynxBytesFromWords(data);
        glBufferData(target, (GLsizeiptr)bytes.length, bytes.bytes, usage);
      } else {
        glBufferData(target, (GLsizeiptr)[data longLongValue], NULL, usage);
      }
      break;
    }
    case ALWebGLOpBufferSubData: {
      GLenum target = nextEnum(r);
      GLintptr offset = nextOffset(r);
      NSData *bytes = AngularLynxBytesFromWords(nextArray(r));
      glBufferSubData(target, offset, (GLsizeiptr)bytes.length, bytes.bytes);
      break;
    }
    case ALWebGLOpClear:
      glClear(nextUInt(r));
      break;
    case ALWebGLOpClearBufferfv: {
      GLenum buffer = nextEnum(r);
      GLint drawbuffer = nextInt(r);
      NSMutableData *values = floatsFrom(nextArray(r));
      if (values.length < 4 * sizeof(GLfloat)) values.length = 4 * sizeof(GLfloat);
      glClearBufferfv(buffer, drawbuffer, values.bytes);
      break;
    }
    case ALWebGLOpClearBufferiv: {
      GLenum buffer = nextEnum(r);
      GLint drawbuffer = nextInt(r);
      NSMutableData *values = intsFrom(nextArray(r));
      if (values.length < 4 * sizeof(GLint)) values.length = 4 * sizeof(GLint);
      glClearBufferiv(buffer, drawbuffer, values.bytes);
      break;
    }
    case ALWebGLOpClearBufferuiv: {
      GLenum buffer = nextEnum(r);
      GLint drawbuffer = nextInt(r);
      NSMutableData *values = uintsFrom(nextArray(r));
      if (values.length < 4 * sizeof(GLuint)) values.length = 4 * sizeof(GLuint);
      glClearBufferuiv(buffer, drawbuffer, values.bytes);
      break;
    }
    case ALWebGLOpClearBufferfi: {
      GLenum buffer = nextEnum(r);
      GLint drawbuffer = nextInt(r);
      GLfloat depth = nextFloat(r);
      glClearBufferfi(buffer, drawbuffer, depth, nextInt(r));
      break;
    }
    case ALWebGLOpClearColor: {
      GLfloat red = nextFloat(r), green = nextFloat(r), blue = nextFloat(r);
      glClearColor(red, green, blue, nextFloat(r));
      break;
    }
    case ALWebGLOpClearDepth:
      glClearDepthf(nextFloat(r));
      break;
    case ALWebGLOpClearStencil:
      glClearStencil(nextInt(r));
      break;
    case ALWebGLOpColorMask: {
      GLboolean red = nextInt(r) != 0, green = nextInt(r) != 0, blue = nextInt(r) != 0;
      glColorMask(red, green, blue, nextInt(r) != 0);
      break;
    }
    case ALWebGLOpCompileShader:
      glCompileShader([self nameOf:nextUInt(r)]);
      break;
    case ALWebGLOpCompressedTexImage2D: {
      GLenum target = nextEnum(r);
      GLint level = nextInt(r);
      GLenum internalformat = nextEnum(r);
      GLsizei width = nextInt(r), height = nextInt(r);
      GLint border = nextInt(r);
      id data = nextItem(r);
      GLsizei size = nextInt(r);
      NSData *bytes = [data isKindOfClass:NSArray.class] ? AngularLynxBytesFromWords(data) : nil;
      glCompressedTexImage2D(target, level, internalformat, width, height, border, size,
                             bytes ? bytes.bytes : (const void *)(intptr_t)[data longLongValue]);
      break;
    }
    case ALWebGLOpCompressedTexImage3D: {
      GLenum target = nextEnum(r);
      GLint level = nextInt(r);
      GLenum internalformat = nextEnum(r);
      GLsizei width = nextInt(r), height = nextInt(r), depth = nextInt(r);
      GLint border = nextInt(r);
      id data = nextItem(r);
      GLsizei size = nextInt(r);
      NSData *bytes = [data isKindOfClass:NSArray.class] ? AngularLynxBytesFromWords(data) : nil;
      glCompressedTexImage3D(target, level, internalformat, width, height, depth, border, size,
                             bytes ? bytes.bytes : (const void *)(intptr_t)[data longLongValue]);
      break;
    }
    case ALWebGLOpCompressedTexSubImage2D: {
      GLenum target = nextEnum(r);
      GLint level = nextInt(r), x = nextInt(r), y = nextInt(r);
      GLsizei width = nextInt(r), height = nextInt(r);
      GLenum format = nextEnum(r);
      id data = nextItem(r);
      GLsizei size = nextInt(r);
      NSData *bytes = [data isKindOfClass:NSArray.class] ? AngularLynxBytesFromWords(data) : nil;
      glCompressedTexSubImage2D(target, level, x, y, width, height, format, size,
                                bytes ? bytes.bytes
                                      : (const void *)(intptr_t)[data longLongValue]);
      break;
    }
    case ALWebGLOpCompressedTexSubImage3D: {
      GLenum target = nextEnum(r);
      GLint level = nextInt(r), x = nextInt(r), y = nextInt(r), z = nextInt(r);
      GLsizei width = nextInt(r), height = nextInt(r), depth = nextInt(r);
      GLenum format = nextEnum(r);
      id data = nextItem(r);
      GLsizei size = nextInt(r);
      NSData *bytes = [data isKindOfClass:NSArray.class] ? AngularLynxBytesFromWords(data) : nil;
      glCompressedTexSubImage3D(target, level, x, y, z, width, height, depth, format, size,
                                bytes ? bytes.bytes
                                      : (const void *)(intptr_t)[data longLongValue]);
      break;
    }
    case ALWebGLOpCopyBufferSubData: {
      GLenum readTarget = nextEnum(r), writeTarget = nextEnum(r);
      GLintptr readOffset = nextOffset(r), writeOffset = nextOffset(r);
      glCopyBufferSubData(readTarget, writeTarget, readOffset, writeOffset,
                          (GLsizeiptr)nextOffset(r));
      break;
    }
    case ALWebGLOpCopyTexImage2D: {
      GLenum target = nextEnum(r);
      GLint level = nextInt(r);
      GLenum internalformat = nextEnum(r);
      GLint x = nextInt(r), y = nextInt(r);
      GLsizei width = nextInt(r), height = nextInt(r);
      GLint border = nextInt(r);
      BOOL resolved = [self beginRead];
      glCopyTexImage2D(target, level, internalformat, x, y, width, height, border);
      [self endRead:resolved];
      break;
    }
    case ALWebGLOpCopyTexSubImage2D: {
      GLenum target = nextEnum(r);
      GLint level = nextInt(r), xoffset = nextInt(r), yoffset = nextInt(r);
      GLint x = nextInt(r), y = nextInt(r);
      GLsizei width = nextInt(r);
      GLsizei height = nextInt(r);
      BOOL resolved = [self beginRead];
      glCopyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height);
      [self endRead:resolved];
      break;
    }
    case ALWebGLOpCopyTexSubImage3D: {
      GLenum target = nextEnum(r);
      GLint level = nextInt(r), xoffset = nextInt(r), yoffset = nextInt(r), zoffset = nextInt(r);
      GLint x = nextInt(r), y = nextInt(r);
      GLsizei width = nextInt(r);
      GLsizei height = nextInt(r);
      BOOL resolved = [self beginRead];
      glCopyTexSubImage3D(target, level, xoffset, yoffset, zoffset, x, y, width, height);
      [self endRead:resolved];
      break;
    }
    case ALWebGLOpCreateBuffer: {
      GLuint name = 0;
      glGenBuffers(1, &name);
      [self setName:name forId:nextUInt(r)];
      break;
    }
    case ALWebGLOpCreateFramebuffer: {
      GLuint name = 0;
      glGenFramebuffers(1, &name);
      [self setName:name forId:nextUInt(r)];
      break;
    }
    case ALWebGLOpCreateProgram:
      [self setName:glCreateProgram() forId:nextUInt(r)];
      break;
    case ALWebGLOpCreateQuery: {
      GLuint name = 0;
      glGenQueries(1, &name);
      [self setName:name forId:nextUInt(r)];
      break;
    }
    case ALWebGLOpCreateRenderbuffer: {
      GLuint name = 0;
      glGenRenderbuffers(1, &name);
      [self setName:name forId:nextUInt(r)];
      break;
    }
    case ALWebGLOpCreateSampler: {
      GLuint name = 0;
      glGenSamplers(1, &name);
      [self setName:name forId:nextUInt(r)];
      break;
    }
    case ALWebGLOpCreateShader: {
      GLuint objectId = nextUInt(r);
      [self setName:glCreateShader(nextEnum(r)) forId:objectId];
      break;
    }
    case ALWebGLOpCreateTexture: {
      GLuint name = 0;
      glGenTextures(1, &name);
      [self setName:name forId:nextUInt(r)];
      break;
    }
    case ALWebGLOpCreateTransformFeedback: {
      GLuint name = 0;
      glGenTransformFeedbacks(1, &name);
      [self setName:name forId:nextUInt(r)];
      break;
    }
    case ALWebGLOpCreateVertexArray: {
      GLuint name = 0;
      glGenVertexArrays(1, &name);
      [self setName:name forId:nextUInt(r)];
      break;
    }
    case ALWebGLOpCullFace:
      glCullFace(nextEnum(r));
      break;
    case ALWebGLOpDeleteBuffer: {
      GLuint name = [self takeName:nextUInt(r)];
      if (name) glDeleteBuffers(1, &name);
      break;
    }
    case ALWebGLOpDeleteFramebuffer: {
      GLuint name = [self takeName:nextUInt(r)];
      if (!name) break;
      // Deleting the bound framebuffer binds the default one, as in WebGL.
      if (_drawFramebuffer == name) _drawFramebuffer = _framebuffer;
      if (_readFramebuffer == name) _readFramebuffer = _framebuffer;
      glDeleteFramebuffers(1, &name);
      glBindFramebuffer(GL_DRAW_FRAMEBUFFER, _drawFramebuffer);
      glBindFramebuffer(GL_READ_FRAMEBUFFER, _readFramebuffer);
      break;
    }
    case ALWebGLOpDeleteProgram: {
      GLuint name = [self takeName:nextUInt(r)];
      if (name) glDeleteProgram(name);
      break;
    }
    case ALWebGLOpDeleteQuery: {
      GLuint name = [self takeName:nextUInt(r)];
      if (name) glDeleteQueries(1, &name);
      break;
    }
    case ALWebGLOpDeleteRenderbuffer: {
      GLuint name = [self takeName:nextUInt(r)];
      if (!name) break;
      if (_renderbuffer == name) _renderbuffer = 0;
      glDeleteRenderbuffers(1, &name);
      break;
    }
    case ALWebGLOpDeleteSampler: {
      GLuint name = [self takeName:nextUInt(r)];
      if (name) glDeleteSamplers(1, &name);
      break;
    }
    case ALWebGLOpDeleteShader: {
      GLuint name = [self takeName:nextUInt(r)];
      if (name) glDeleteShader(name);
      break;
    }
    case ALWebGLOpDeleteSync: {
      NSNumber *key = @(nextUInt(r));
      GLsync sync = _syncs[key].pointerValue;
      if (sync) glDeleteSync(sync);
      [_syncs removeObjectForKey:key];
      break;
    }
    case ALWebGLOpDeleteTexture: {
      GLuint name = [self takeName:nextUInt(r)];
      if (name) glDeleteTextures(1, &name);
      break;
    }
    case ALWebGLOpDeleteTransformFeedback: {
      GLuint name = [self takeName:nextUInt(r)];
      if (name) glDeleteTransformFeedbacks(1, &name);
      break;
    }
    case ALWebGLOpDeleteVertexArray: {
      GLuint name = [self takeName:nextUInt(r)];
      if (name) glDeleteVertexArrays(1, &name);
      break;
    }
    case ALWebGLOpDepthFunc:
      glDepthFunc(nextEnum(r));
      break;
    case ALWebGLOpDepthMask:
      glDepthMask(nextInt(r) != 0);
      break;
    case ALWebGLOpDepthRange: {
      GLfloat zNear = nextFloat(r);
      glDepthRangef(zNear, nextFloat(r));
      break;
    }
    case ALWebGLOpDetachShader: {
      GLuint program = [self nameOf:nextUInt(r)];
      glDetachShader(program, [self nameOf:nextUInt(r)]);
      break;
    }
    case ALWebGLOpDisable:
      glDisable(nextEnum(r));
      break;
    case ALWebGLOpDisableVertexAttribArray:
      glDisableVertexAttribArray(nextUInt(r));
      break;
    case ALWebGLOpDrawArrays: {
      GLenum mode = nextEnum(r);
      GLint first = nextInt(r);
      glDrawArrays(mode, first, nextInt(r));
      break;
    }
    case ALWebGLOpDrawArraysInstanced: {
      GLenum mode = nextEnum(r);
      GLint first = nextInt(r);
      GLsizei count = nextInt(r);
      glDrawArraysInstanced(mode, first, count, nextInt(r));
      break;
    }
    case ALWebGLOpDrawBuffers: {
      NSArray *buffers = nextArray(r);
      GLenum *values = calloc(MAX(buffers.count, 1), sizeof(GLenum));
      BOOL defaultBound = [self defaultFramebufferBoundTo:GL_DRAW_FRAMEBUFFER];
      for (NSUInteger i = 0; i < buffers.count; i++) {
        GLenum value = (GLenum)[buffers[i] longLongValue];
        values[i] = defaultBound && value == WEBGL_BACK ? GL_COLOR_ATTACHMENT0 : value;
      }
      glDrawBuffers((GLsizei)buffers.count, values);
      free(values);
      break;
    }
    case ALWebGLOpDrawElements: {
      GLenum mode = nextEnum(r);
      GLsizei count = nextInt(r);
      GLenum type = nextEnum(r);
      glDrawElements(mode, count, type, (const void *)nextOffset(r));
      break;
    }
    case ALWebGLOpDrawElementsInstanced: {
      GLenum mode = nextEnum(r);
      GLsizei count = nextInt(r);
      GLenum type = nextEnum(r);
      const void *offset = (const void *)nextOffset(r);
      glDrawElementsInstanced(mode, count, type, offset, nextInt(r));
      break;
    }
    case ALWebGLOpDrawRangeElements: {
      GLenum mode = nextEnum(r);
      GLuint start = nextUInt(r), end = nextUInt(r);
      GLsizei count = nextInt(r);
      GLenum type = nextEnum(r);
      glDrawRangeElements(mode, start, end, count, type, (const void *)nextOffset(r));
      break;
    }
    case ALWebGLOpEnable:
      glEnable(nextEnum(r));
      break;
    case ALWebGLOpEnableVertexAttribArray:
      glEnableVertexAttribArray(nextUInt(r));
      break;
    case ALWebGLOpEndQuery:
      glEndQuery(nextEnum(r));
      break;
    case ALWebGLOpEndTransformFeedback:
      glEndTransformFeedback();
      break;
    case ALWebGLOpFenceSync: {
      GLuint objectId = nextUInt(r);
      GLenum condition = nextEnum(r);
      GLsync sync = glFenceSync(condition, nextUInt(r));
      if (sync) _syncs[@(objectId)] = [NSValue valueWithPointer:sync];
      break;
    }
    case ALWebGLOpFinish:
      glFinish();
      break;
    case ALWebGLOpFlush:
      glFlush();
      break;
    case ALWebGLOpFramebufferRenderbuffer: {
      GLenum target = nextEnum(r), attachment = nextEnum(r), renderbuffertarget = nextEnum(r);
      glFramebufferRenderbuffer(target, attachment, renderbuffertarget,
                                [self nameOf:nextUInt(r)]);
      break;
    }
    case ALWebGLOpFramebufferTexture2D: {
      GLenum target = nextEnum(r), attachment = nextEnum(r), textarget = nextEnum(r);
      GLuint texture = [self nameOf:nextUInt(r)];
      glFramebufferTexture2D(target, attachment, textarget, texture, nextInt(r));
      break;
    }
    case ALWebGLOpFramebufferTextureLayer: {
      GLenum target = nextEnum(r), attachment = nextEnum(r);
      GLuint texture = [self nameOf:nextUInt(r)];
      GLint level = nextInt(r);
      glFramebufferTextureLayer(target, attachment, texture, level, nextInt(r));
      break;
    }
    case ALWebGLOpFrontFace:
      glFrontFace(nextEnum(r));
      break;
    case ALWebGLOpGenerateMipmap:
      glGenerateMipmap(nextEnum(r));
      break;
    case ALWebGLOpHint: {
      GLenum target = nextEnum(r);
      glHint(target, nextEnum(r));
      break;
    }
    case ALWebGLOpInvalidateFramebuffer:
    case ALWebGLOpInvalidateSubFramebuffer: {
      GLenum target = nextEnum(r);
      NSArray *attachments = nextArray(r);
      GLenum *values = calloc(MAX(attachments.count, 1), sizeof(GLenum));
      for (NSUInteger i = 0; i < attachments.count; i++) {
        values[i] = [self attachmentFor:(GLenum)[attachments[i] longLongValue] target:target];
      }
      if (op == ALWebGLOpInvalidateFramebuffer) {
        glInvalidateFramebuffer(target, (GLsizei)attachments.count, values);
      } else {
        GLint x = nextInt(r), y = nextInt(r);
        GLsizei width = nextInt(r);
        glInvalidateSubFramebuffer(target, (GLsizei)attachments.count, values, x, y, width,
                                   nextInt(r));
      }
      free(values);
      break;
    }
    case ALWebGLOpLineWidth:
      glLineWidth(nextFloat(r));
      break;
    case ALWebGLOpLinkProgram:
      glLinkProgram([self nameOf:nextUInt(r)]);
      break;
    case ALWebGLOpPauseTransformFeedback:
      glPauseTransformFeedback();
      break;
    case ALWebGLOpPixelStorei: {
      GLenum pname = nextEnum(r);
      glPixelStorei(pname, nextInt(r));
      break;
    }
    case ALWebGLOpPolygonOffset: {
      GLfloat factor = nextFloat(r);
      glPolygonOffset(factor, nextFloat(r));
      break;
    }
    case ALWebGLOpReadBuffer: {
      GLenum source = nextEnum(r);
      glReadBuffer([self defaultFramebufferBoundTo:GL_READ_FRAMEBUFFER] && source == WEBGL_BACK
                       ? GL_COLOR_ATTACHMENT0
                       : source);
      break;
    }
    case ALWebGLOpReadPixelsToBuffer: {
      GLint x = nextInt(r), y = nextInt(r);
      GLsizei width = nextInt(r), height = nextInt(r);
      GLenum format = nextEnum(r), type = nextEnum(r);
      void *offset = (void *)nextOffset(r);
      BOOL resolved = [self beginRead];
      glReadPixels(x, y, width, height, format, type, offset);
      [self endRead:resolved];
      break;
    }
    case ALWebGLOpRenderbufferStorage: {
      GLenum target = nextEnum(r), internalformat = nextEnum(r);
      GLsizei width = nextInt(r);
      glRenderbufferStorage(target, internalformat, width, nextInt(r));
      break;
    }
    case ALWebGLOpRenderbufferStorageMultisample: {
      GLenum target = nextEnum(r);
      GLsizei samples = nextInt(r);
      GLenum internalformat = nextEnum(r);
      GLsizei width = nextInt(r);
      glRenderbufferStorageMultisample(target, samples, internalformat, width, nextInt(r));
      break;
    }
    case ALWebGLOpResumeTransformFeedback:
      glResumeTransformFeedback();
      break;
    case ALWebGLOpSampleCoverage: {
      GLfloat value = nextFloat(r);
      glSampleCoverage(value, nextInt(r) != 0);
      break;
    }
    case ALWebGLOpSamplerParameterf: {
      GLuint sampler = [self nameOf:nextUInt(r)];
      GLenum pname = nextEnum(r);
      glSamplerParameterf(sampler, pname, nextFloat(r));
      break;
    }
    case ALWebGLOpSamplerParameteri: {
      GLuint sampler = [self nameOf:nextUInt(r)];
      GLenum pname = nextEnum(r);
      glSamplerParameteri(sampler, pname, nextInt(r));
      break;
    }
    case ALWebGLOpScissor: {
      GLint x = nextInt(r), y = nextInt(r);
      GLsizei width = nextInt(r);
      glScissor(x, y, width, nextInt(r));
      break;
    }
    case ALWebGLOpShaderSource: {
      GLuint shader = [self nameOf:nextUInt(r)];
      const char *source = nextString(r).UTF8String;
      glShaderSource(shader, 1, &source, NULL);
      break;
    }
    case ALWebGLOpStencilFunc: {
      GLenum func = nextEnum(r);
      GLint ref = nextInt(r);
      glStencilFunc(func, ref, nextUInt(r));
      break;
    }
    case ALWebGLOpStencilFuncSeparate: {
      GLenum face = nextEnum(r), func = nextEnum(r);
      GLint ref = nextInt(r);
      glStencilFuncSeparate(face, func, ref, nextUInt(r));
      break;
    }
    case ALWebGLOpStencilMask:
      glStencilMask(nextUInt(r));
      break;
    case ALWebGLOpStencilMaskSeparate: {
      GLenum face = nextEnum(r);
      glStencilMaskSeparate(face, nextUInt(r));
      break;
    }
    case ALWebGLOpStencilOp: {
      GLenum fail = nextEnum(r), zfail = nextEnum(r);
      glStencilOp(fail, zfail, nextEnum(r));
      break;
    }
    case ALWebGLOpStencilOpSeparate: {
      GLenum face = nextEnum(r), fail = nextEnum(r), zfail = nextEnum(r);
      glStencilOpSeparate(face, fail, zfail, nextEnum(r));
      break;
    }
    case ALWebGLOpTexImage2D: {
      GLenum target = nextEnum(r);
      GLint level = nextInt(r), internalformat = nextInt(r);
      GLsizei width = nextInt(r), height = nextInt(r);
      GLint border = nextInt(r);
      GLenum format = nextEnum(r), type = nextEnum(r);
      NSData *holder = nil;
      BOOL isImage = NO;
      const void *pixels = [self pixels:nextItem(r)
                                 format:format
                                   type:type
                                  width:width
                                 height:height
                                 holder:&holder
                                isImage:&isImage];
      [self withTightUnpacking:isImage
                        upload:^{
                          glTexImage2D(target, level, internalformat, width, height, border,
                                       format, type, pixels);
                        }];
      break;
    }
    case ALWebGLOpTexImage3D: {
      GLenum target = nextEnum(r);
      GLint level = nextInt(r), internalformat = nextInt(r);
      GLsizei width = nextInt(r), height = nextInt(r), depth = nextInt(r);
      GLint border = nextInt(r);
      GLenum format = nextEnum(r), type = nextEnum(r);
      NSData *holder = nil;
      BOOL isImage = NO;
      const void *pixels = [self pixels:nextItem(r)
                                 format:format
                                   type:type
                                  width:width
                                 height:height
                                 holder:&holder
                                isImage:&isImage];
      [self withTightUnpacking:isImage
                        upload:^{
                          glTexImage3D(target, level, internalformat, width, height, depth,
                                       border, format, type, pixels);
                        }];
      break;
    }
    case ALWebGLOpTexParameterf: {
      GLenum target = nextEnum(r), pname = nextEnum(r);
      glTexParameterf(target, pname, nextFloat(r));
      break;
    }
    case ALWebGLOpTexParameteri: {
      GLenum target = nextEnum(r), pname = nextEnum(r);
      glTexParameteri(target, pname, nextInt(r));
      break;
    }
    case ALWebGLOpTexStorage2D: {
      GLenum target = nextEnum(r);
      GLsizei levels = nextInt(r);
      GLenum internalformat = nextEnum(r);
      GLsizei width = nextInt(r);
      glTexStorage2D(target, levels, internalformat, width, nextInt(r));
      break;
    }
    case ALWebGLOpTexStorage3D: {
      GLenum target = nextEnum(r);
      GLsizei levels = nextInt(r);
      GLenum internalformat = nextEnum(r);
      GLsizei width = nextInt(r), height = nextInt(r);
      glTexStorage3D(target, levels, internalformat, width, height, nextInt(r));
      break;
    }
    case ALWebGLOpTexSubImage2D: {
      GLenum target = nextEnum(r);
      GLint level = nextInt(r), x = nextInt(r), y = nextInt(r);
      GLsizei width = nextInt(r), height = nextInt(r);
      GLenum format = nextEnum(r), type = nextEnum(r);
      NSData *holder = nil;
      BOOL isImage = NO;
      const void *pixels = [self pixels:nextItem(r)
                                 format:format
                                   type:type
                                  width:width
                                 height:height
                                 holder:&holder
                                isImage:&isImage];
      [self withTightUnpacking:isImage
                        upload:^{
                          glTexSubImage2D(target, level, x, y, width, height, format, type,
                                          pixels);
                        }];
      break;
    }
    case ALWebGLOpTexSubImage3D: {
      GLenum target = nextEnum(r);
      GLint level = nextInt(r), x = nextInt(r), y = nextInt(r), z = nextInt(r);
      GLsizei width = nextInt(r), height = nextInt(r), depth = nextInt(r);
      GLenum format = nextEnum(r), type = nextEnum(r);
      NSData *holder = nil;
      BOOL isImage = NO;
      const void *pixels = [self pixels:nextItem(r)
                                 format:format
                                   type:type
                                  width:width
                                 height:height
                                 holder:&holder
                                isImage:&isImage];
      [self withTightUnpacking:isImage
                        upload:^{
                          glTexSubImage3D(target, level, x, y, z, width, height, depth, format,
                                          type, pixels);
                        }];
      break;
    }
    case ALWebGLOpTransformFeedbackVaryings: {
      GLuint program = [self nameOf:nextUInt(r)];
      NSArray *varyings = nextArray(r);
      GLenum mode = nextEnum(r);
      const char **names = calloc(MAX(varyings.count, 1), sizeof(char *));
      for (NSUInteger i = 0; i < varyings.count; i++) {
        names[i] = [varyings[i] isKindOfClass:NSString.class] ? [varyings[i] UTF8String] : "";
      }
      glTransformFeedbackVaryings(program, (GLsizei)varyings.count, names, mode);
      free(names);
      break;
    }
    case ALWebGLOpUniform1f: {
      GLint location = nextInt(r);
      glUniform1f(location, nextFloat(r));
      break;
    }
    case ALWebGLOpUniform2f: {
      GLint location = nextInt(r);
      GLfloat x = nextFloat(r);
      glUniform2f(location, x, nextFloat(r));
      break;
    }
    case ALWebGLOpUniform3f: {
      GLint location = nextInt(r);
      GLfloat x = nextFloat(r), y = nextFloat(r);
      glUniform3f(location, x, y, nextFloat(r));
      break;
    }
    case ALWebGLOpUniform4f: {
      GLint location = nextInt(r);
      GLfloat x = nextFloat(r), y = nextFloat(r), z = nextFloat(r);
      glUniform4f(location, x, y, z, nextFloat(r));
      break;
    }
    case ALWebGLOpUniform1i: {
      GLint location = nextInt(r);
      glUniform1i(location, nextInt(r));
      break;
    }
    case ALWebGLOpUniform2i: {
      GLint location = nextInt(r);
      GLint x = nextInt(r);
      glUniform2i(location, x, nextInt(r));
      break;
    }
    case ALWebGLOpUniform3i: {
      GLint location = nextInt(r);
      GLint x = nextInt(r), y = nextInt(r);
      glUniform3i(location, x, y, nextInt(r));
      break;
    }
    case ALWebGLOpUniform4i: {
      GLint location = nextInt(r);
      GLint x = nextInt(r), y = nextInt(r), z = nextInt(r);
      glUniform4i(location, x, y, z, nextInt(r));
      break;
    }
    case ALWebGLOpUniform1ui: {
      GLint location = nextInt(r);
      glUniform1ui(location, nextUInt(r));
      break;
    }
    case ALWebGLOpUniform2ui: {
      GLint location = nextInt(r);
      GLuint x = nextUInt(r);
      glUniform2ui(location, x, nextUInt(r));
      break;
    }
    case ALWebGLOpUniform3ui: {
      GLint location = nextInt(r);
      GLuint x = nextUInt(r), y = nextUInt(r);
      glUniform3ui(location, x, y, nextUInt(r));
      break;
    }
    case ALWebGLOpUniform4ui: {
      GLint location = nextInt(r);
      GLuint x = nextUInt(r), y = nextUInt(r), z = nextUInt(r);
      glUniform4ui(location, x, y, z, nextUInt(r));
      break;
    }
    case ALWebGLOpUniform1fv:
    case ALWebGLOpUniform2fv:
    case ALWebGLOpUniform3fv:
    case ALWebGLOpUniform4fv: {
      GLint location = nextInt(r);
      NSArray *values = nextArray(r);
      GLsizei size = (GLsizei)(op - ALWebGLOpUniform1fv + 1);
      GLsizei count = (GLsizei)values.count / size;
      if (count == 0) break;
      NSData *data = floatsFrom(values);
      if (size == 1) glUniform1fv(location, count, data.bytes);
      else if (size == 2) glUniform2fv(location, count, data.bytes);
      else if (size == 3) glUniform3fv(location, count, data.bytes);
      else glUniform4fv(location, count, data.bytes);
      break;
    }
    case ALWebGLOpUniform1iv:
    case ALWebGLOpUniform2iv:
    case ALWebGLOpUniform3iv:
    case ALWebGLOpUniform4iv: {
      GLint location = nextInt(r);
      NSArray *values = nextArray(r);
      GLsizei size = (GLsizei)(op - ALWebGLOpUniform1iv + 1);
      GLsizei count = (GLsizei)values.count / size;
      if (count == 0) break;
      NSData *data = intsFrom(values);
      if (size == 1) glUniform1iv(location, count, data.bytes);
      else if (size == 2) glUniform2iv(location, count, data.bytes);
      else if (size == 3) glUniform3iv(location, count, data.bytes);
      else glUniform4iv(location, count, data.bytes);
      break;
    }
    case ALWebGLOpUniform1uiv:
    case ALWebGLOpUniform2uiv:
    case ALWebGLOpUniform3uiv:
    case ALWebGLOpUniform4uiv: {
      GLint location = nextInt(r);
      NSArray *values = nextArray(r);
      GLsizei size = (GLsizei)(op - ALWebGLOpUniform1uiv + 1);
      GLsizei count = (GLsizei)values.count / size;
      if (count == 0) break;
      NSData *data = uintsFrom(values);
      if (size == 1) glUniform1uiv(location, count, data.bytes);
      else if (size == 2) glUniform2uiv(location, count, data.bytes);
      else if (size == 3) glUniform3uiv(location, count, data.bytes);
      else glUniform4uiv(location, count, data.bytes);
      break;
    }
    case ALWebGLOpUniformMatrix2fv:
    case ALWebGLOpUniformMatrix3fv:
    case ALWebGLOpUniformMatrix4fv:
    case ALWebGLOpUniformMatrix2x3fv:
    case ALWebGLOpUniformMatrix3x2fv:
    case ALWebGLOpUniformMatrix2x4fv:
    case ALWebGLOpUniformMatrix4x2fv:
    case ALWebGLOpUniformMatrix3x4fv:
    case ALWebGLOpUniformMatrix4x3fv: {
      GLint location = nextInt(r);
      GLboolean transpose = nextInt(r) != 0;
      NSArray *values = nextArray(r);
      NSData *data = floatsFrom(values);
      const GLfloat *v = data.bytes;
      GLsizei n = (GLsizei)values.count;
      switch ((ALWebGLOp)op) {
        case ALWebGLOpUniformMatrix2fv:
          if (n / 4) glUniformMatrix2fv(location, n / 4, transpose, v);
          break;
        case ALWebGLOpUniformMatrix3fv:
          if (n / 9) glUniformMatrix3fv(location, n / 9, transpose, v);
          break;
        case ALWebGLOpUniformMatrix4fv:
          if (n / 16) glUniformMatrix4fv(location, n / 16, transpose, v);
          break;
        case ALWebGLOpUniformMatrix2x3fv:
          if (n / 6) glUniformMatrix2x3fv(location, n / 6, transpose, v);
          break;
        case ALWebGLOpUniformMatrix3x2fv:
          if (n / 6) glUniformMatrix3x2fv(location, n / 6, transpose, v);
          break;
        case ALWebGLOpUniformMatrix2x4fv:
          if (n / 8) glUniformMatrix2x4fv(location, n / 8, transpose, v);
          break;
        case ALWebGLOpUniformMatrix4x2fv:
          if (n / 8) glUniformMatrix4x2fv(location, n / 8, transpose, v);
          break;
        case ALWebGLOpUniformMatrix3x4fv:
          if (n / 12) glUniformMatrix3x4fv(location, n / 12, transpose, v);
          break;
        default:
          if (n / 12) glUniformMatrix4x3fv(location, n / 12, transpose, v);
          break;
      }
      break;
    }
    case ALWebGLOpUniformBlockBinding: {
      GLuint program = [self nameOf:nextUInt(r)];
      GLuint index = nextUInt(r);
      glUniformBlockBinding(program, index, nextUInt(r));
      break;
    }
    case ALWebGLOpUseProgram:
      glUseProgram([self nameOf:nextUInt(r)]);
      break;
    case ALWebGLOpValidateProgram:
      glValidateProgram([self nameOf:nextUInt(r)]);
      break;
    case ALWebGLOpVertexAttrib4f: {
      GLuint index = nextUInt(r);
      GLfloat x = nextFloat(r), y = nextFloat(r), z = nextFloat(r);
      glVertexAttrib4f(index, x, y, z, nextFloat(r));
      break;
    }
    case ALWebGLOpVertexAttribI4i: {
      GLuint index = nextUInt(r);
      GLint x = nextInt(r), y = nextInt(r), z = nextInt(r);
      glVertexAttribI4i(index, x, y, z, nextInt(r));
      break;
    }
    case ALWebGLOpVertexAttribI4ui: {
      GLuint index = nextUInt(r);
      GLuint x = nextUInt(r), y = nextUInt(r), z = nextUInt(r);
      glVertexAttribI4ui(index, x, y, z, nextUInt(r));
      break;
    }
    case ALWebGLOpVertexAttribDivisor: {
      GLuint index = nextUInt(r);
      glVertexAttribDivisor(index, nextUInt(r));
      break;
    }
    case ALWebGLOpVertexAttribIPointer: {
      GLuint index = nextUInt(r);
      GLint size = nextInt(r);
      GLenum type = nextEnum(r);
      GLsizei stride = nextInt(r);
      glVertexAttribIPointer(index, size, type, stride, (const void *)nextOffset(r));
      break;
    }
    case ALWebGLOpVertexAttribPointer: {
      GLuint index = nextUInt(r);
      GLint size = nextInt(r);
      GLenum type = nextEnum(r);
      GLboolean normalized = nextInt(r) != 0;
      GLsizei stride = nextInt(r);
      glVertexAttribPointer(index, size, type, normalized, stride, (const void *)nextOffset(r));
      break;
    }
    case ALWebGLOpViewport: {
      GLint x = nextInt(r), y = nextInt(r);
      GLsizei width = nextInt(r);
      glViewport(x, y, width, nextInt(r));
      break;
    }
    case ALWebGLOpWaitSync: {
      GLsync sync = [self syncOf:nextUInt(r)];
      GLbitfield flags = nextUInt(r);
      nextNumber(r);  // WebGL's timeout is always TIMEOUT_IGNORED (-1).
      if (sync) glWaitSync(sync, flags, GL_TIMEOUT_IGNORED);
      break;
    }
    case ALWebGLOpResize: {
      GLsizei width = nextInt(r);
      [self allocateDrawingBufferWidth:width height:nextInt(r)];
      break;
    }
    case ALWebGLOpPresent:
      [self present];
      break;
    default:
      NSLog(@"[AngularLynxWebGL] Unknown command %ld", (long)op);
      // The rest of the batch can't be read without this one's arguments.
      r->index = r->count;
      break;
  }
}

- (id)query:(NSInteger)op reader:(Reader *)r {
  switch ((ALWebGLOp)op) {
    case ALWebGLOpGetParameter:
      return [self parameter:nextEnum(r)];
    case ALWebGLOpGetError:
      return @(glGetError());
    case ALWebGLOpShaderInfo: {
      GLuint shader = [self nameOf:nextUInt(r)];
      GLint compiled = GL_FALSE;
      glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
      return @{@"compiled" : @(compiled == GL_TRUE), @"log" : shaderLog(shader)};
    }
    case ALWebGLOpProgramInfo:
      return [self programInfo:[self nameOf:nextUInt(r)]];
    case ALWebGLOpGetUniformLocation: {
      GLuint program = [self nameOf:nextUInt(r)];
      return @(glGetUniformLocation(program, nextString(r).UTF8String));
    }
    case ALWebGLOpGetAttribLocation: {
      GLuint program = [self nameOf:nextUInt(r)];
      return @(glGetAttribLocation(program, nextString(r).UTF8String));
    }
    case ALWebGLOpCheckFramebufferStatus:
      return @(glCheckFramebufferStatus(nextEnum(r)));
    case ALWebGLOpGetBufferParameter: {
      GLenum target = nextEnum(r), pname = nextEnum(r);
      if (pname == GL_BUFFER_SIZE) {
        GLint64 value = 0;
        glGetBufferParameteri64v(target, pname, &value);
        return @(value);
      }
      GLint value = 0;
      glGetBufferParameteriv(target, pname, &value);
      return @(value);
    }
    case ALWebGLOpGetFramebufferAttachmentParameter: {
      GLenum target = nextEnum(r);
      GLenum attachment = [self attachmentFor:nextEnum(r) target:target];
      GLint value = 0;
      glGetFramebufferAttachmentParameteriv(target, attachment, nextEnum(r), &value);
      return @(value);
    }
    case ALWebGLOpGetRenderbufferParameter: {
      GLenum target = nextEnum(r);
      GLint value = 0;
      glGetRenderbufferParameteriv(target, nextEnum(r), &value);
      return @(value);
    }
    case ALWebGLOpGetTexParameter: {
      GLenum target = nextEnum(r), pname = nextEnum(r);
      if (pname == GL_TEXTURE_MAX_LOD || pname == GL_TEXTURE_MIN_LOD ||
          pname == GL_TEXTURE_MAX_ANISOTROPY) {
        GLfloat value = 0;
        glGetTexParameterfv(target, pname, &value);
        return @(value);
      }
      GLint value = 0;
      glGetTexParameteriv(target, pname, &value);
      return @(value);
    }
    case ALWebGLOpGetSamplerParameter: {
      GLuint sampler = [self nameOf:nextUInt(r)];
      GLenum pname = nextEnum(r);
      if (pname == GL_TEXTURE_MAX_LOD || pname == GL_TEXTURE_MIN_LOD) {
        GLfloat value = 0;
        glGetSamplerParameterfv(sampler, pname, &value);
        return @(value);
      }
      GLint value = 0;
      glGetSamplerParameteriv(sampler, pname, &value);
      return @(value);
    }
    case ALWebGLOpGetVertexAttrib: {
      GLuint index = nextUInt(r);
      GLenum pname = nextEnum(r);
      if (pname == GL_CURRENT_VERTEX_ATTRIB) {
        GLfloat values[4] = {0, 0, 0, 1};
        glGetVertexAttribfv(index, pname, values);
        return numbersFromFloats(values, 4);
      }
      GLint value = 0;
      glGetVertexAttribiv(index, pname, &value);
      return @(value);
    }
    case ALWebGLOpGetVertexAttribOffset: {
      GLuint index = nextUInt(r);
      void *pointer = NULL;
      glGetVertexAttribPointerv(index, nextEnum(r), &pointer);
      return @((intptr_t)pointer);
    }
    case ALWebGLOpGetIndexedParameter: {
      GLenum target = nextEnum(r);
      GLuint index = nextUInt(r);
      if (target == GL_UNIFORM_BUFFER_START || target == GL_UNIFORM_BUFFER_SIZE ||
          target == GL_TRANSFORM_FEEDBACK_BUFFER_START ||
          target == GL_TRANSFORM_FEEDBACK_BUFFER_SIZE) {
        GLint64 value = 0;
        glGetInteger64i_v(target, index, &value);
        return @(value);
      }
      GLint value = 0;
      glGetIntegeri_v(target, index, &value);
      return @(value);
    }
    case ALWebGLOpGetInternalformatParameter: {
      GLenum target = nextEnum(r), internalformat = nextEnum(r), pname = nextEnum(r);
      GLint count = 0;
      glGetInternalformativ(target, internalformat, GL_NUM_SAMPLE_COUNTS, 1, &count);
      GLint *values = calloc(MAX(count, 1), sizeof(GLint));
      glGetInternalformativ(target, internalformat, pname, count, values);
      NSArray *result = numbersFromInts(values, count);
      free(values);
      return result;
    }
    case ALWebGLOpGetQueryParameter: {
      GLuint query = [self nameOf:nextUInt(r)];
      GLuint value = 0;
      glGetQueryObjectuiv(query, nextEnum(r), &value);
      return @(value);
    }
    case ALWebGLOpGetSyncParameter: {
      GLsync sync = [self syncOf:nextUInt(r)];
      GLenum pname = nextEnum(r);
      if (!sync) return nil;
      GLint value = 0;
      glGetSynciv(sync, pname, 1, NULL, &value);
      return @(value);
    }
    case ALWebGLOpClientWaitSync: {
      GLsync sync = [self syncOf:nextUInt(r)];
      GLbitfield flags = nextUInt(r);
      GLuint64 timeout = (GLuint64)MAX(0, nextNumber(r));
      if (!sync) return @(GL_WAIT_FAILED);
      return @(glClientWaitSync(sync, flags, timeout));
    }
    case ALWebGLOpGetUniform: {
      GLuint program = [self nameOf:nextUInt(r)];
      GLint location = nextInt(r);
      GLenum type = nextEnum(r);
      GLint count = uniformComponents(type);
      if (isFloatUniform(type)) {
        GLfloat values[16] = {0};
        glGetUniformfv(program, location, values);
        return numbersFromFloats(values, count);
      }
      if (isUnsignedUniform(type)) {
        GLuint values[4] = {0};
        glGetUniformuiv(program, location, values);
        NSMutableArray *result = [NSMutableArray array];
        for (GLint i = 0; i < count; i++) [result addObject:@(values[i])];
        return result;
      }
      GLint values[4] = {0};
      glGetUniformiv(program, location, values);
      return numbersFromInts(values, count);
    }
    case ALWebGLOpGetUniformBlockIndex: {
      GLuint program = [self nameOf:nextUInt(r)];
      return @(glGetUniformBlockIndex(program, nextString(r).UTF8String));
    }
    case ALWebGLOpGetActiveUniformBlockName: {
      GLuint program = [self nameOf:nextUInt(r)];
      GLuint index = nextUInt(r);
      GLint length = 0;
      glGetActiveUniformBlockiv(program, index, GL_UNIFORM_BLOCK_NAME_LENGTH, &length);
      char *name = calloc(MAX(length, 1) + 1, 1);
      glGetActiveUniformBlockName(program, index, length + 1, NULL, name);
      NSString *result = [NSString stringWithUTF8String:name] ?: @"";
      free(name);
      return result;
    }
    case ALWebGLOpGetActiveUniformBlockParameter: {
      GLuint program = [self nameOf:nextUInt(r)];
      GLuint index = nextUInt(r);
      GLenum pname = nextEnum(r);
      if (pname == GL_UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES) {
        GLint count = 0;
        glGetActiveUniformBlockiv(program, index, GL_UNIFORM_BLOCK_ACTIVE_UNIFORMS, &count);
        GLint *values = calloc(MAX(count, 1), sizeof(GLint));
        glGetActiveUniformBlockiv(program, index, pname, values);
        NSArray *result = numbersFromInts(values, count);
        free(values);
        return result;
      }
      GLint value = 0;
      glGetActiveUniformBlockiv(program, index, pname, &value);
      return @(value);
    }
    case ALWebGLOpGetActiveUniforms: {
      GLuint program = [self nameOf:nextUInt(r)];
      NSArray *indices = nextArray(r);
      GLenum pname = nextEnum(r);
      NSData *indexData = uintsFrom(indices);
      GLint *values = calloc(MAX(indices.count, 1), sizeof(GLint));
      glGetActiveUniformsiv(program, (GLsizei)indices.count, indexData.bytes, pname, values);
      NSArray *result = numbersFromInts(values, indices.count);
      free(values);
      return result;
    }
    case ALWebGLOpGetUniformIndices: {
      GLuint program = [self nameOf:nextUInt(r)];
      NSArray *names = nextArray(r);
      const char **cNames = calloc(MAX(names.count, 1), sizeof(char *));
      for (NSUInteger i = 0; i < names.count; i++) {
        cNames[i] = [names[i] isKindOfClass:NSString.class] ? [names[i] UTF8String] : "";
      }
      GLuint *indices = calloc(MAX(names.count, 1), sizeof(GLuint));
      glGetUniformIndices(program, (GLsizei)names.count, cNames, indices);
      NSMutableArray *result = [NSMutableArray array];
      for (NSUInteger i = 0; i < names.count; i++) [result addObject:@(indices[i])];
      free(cNames);
      free(indices);
      return result;
    }
    case ALWebGLOpGetFragDataLocation: {
      GLuint program = [self nameOf:nextUInt(r)];
      return @(glGetFragDataLocation(program, nextString(r).UTF8String));
    }
    case ALWebGLOpGetTransformFeedbackVarying: {
      GLuint program = [self nameOf:nextUInt(r)];
      GLuint index = nextUInt(r);
      GLint maxLength = 0;
      glGetProgramiv(program, GL_TRANSFORM_FEEDBACK_VARYING_MAX_LENGTH, &maxLength);
      char *name = calloc(MAX(maxLength, 1) + 1, 1);
      GLsizei length = 0, size = 0;
      GLenum type = 0;
      glGetTransformFeedbackVarying(program, index, maxLength + 1, &length, &size, &type, name);
      NSString *result = [NSString stringWithUTF8String:name] ?: @"";
      free(name);
      return @[ result, @(size), @(type) ];
    }
    case ALWebGLOpReadPixels: {
      GLint x = nextInt(r), y = nextInt(r);
      GLsizei width = nextInt(r), height = nextInt(r);
      GLenum format = nextEnum(r), type = nextEnum(r);
      NSUInteger length = (NSUInteger)MAX(0, nextNumber(r));
      NSMutableData *data = [NSMutableData dataWithLength:(length + 3) / 4 * 4];
      BOOL resolved = [self beginRead];
      glReadPixels(x, y, width, height, format, type, data.mutableBytes);
      [self endRead:resolved];
      return wordsFromBytes(data.bytes, length);
    }
    case ALWebGLOpGetBufferSubData: {
      GLenum target = nextEnum(r);
      GLintptr offset = nextOffset(r);
      GLsizeiptr length = (GLsizeiptr)nextOffset(r);
      if (length <= 0) return wordsFromBytes(NULL, 0);
      void *mapped = glMapBufferRange(target, offset, length, GL_MAP_READ_BIT);
      if (!mapped) return nil;
      NSArray *result = wordsFromBytes(mapped, (NSUInteger)length);
      glUnmapBuffer(target);
      return result;
    }
    case ALWebGLOpIsEnabled:
      return @(glIsEnabled(nextEnum(r)) == GL_TRUE);
    case ALWebGLOpGetShaderPrecisionFormat: {
      GLenum shaderType = nextEnum(r), precisionType = nextEnum(r);
      GLint range[2] = {0, 0};
      GLint precision = 0;
      glGetShaderPrecisionFormat(shaderType, precisionType, range, &precision);
      return @[ @(range[0]), @(range[1]), @(precision) ];
    }
    case ALWebGLOpGetSupportedExtensions: {
      GLint count = 0;
      glGetIntegerv(GL_NUM_EXTENSIONS, &count);
      NSMutableArray *extensions = [NSMutableArray arrayWithCapacity:count];
      for (GLint i = 0; i < count; i++) {
        const GLubyte *name = glGetStringi(GL_EXTENSIONS, i);
        if (name) [extensions addObject:@((const char *)name)];
      }
      return extensions;
    }
    case ALWebGLOpGetProgramParameter: {
      GLuint program = [self nameOf:nextUInt(r)];
      GLint value = 0;
      glGetProgramiv(program, nextEnum(r), &value);
      return @(value);
    }
    default:
      NSLog(@"[AngularLynxWebGL] Unknown query %ld", (long)op);
      r->index = r->count;
      return nil;
  }
}

@end
