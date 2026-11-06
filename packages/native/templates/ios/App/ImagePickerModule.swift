import ImageIO
import Lynx
import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// The native module behind the runtime's `LynxImagePicker`, which calls it as
/// `NativeModules.AngularLynxImagePicker` (from the background thread, where
/// NativeModules lives).
///
/// Lynx has no `<input type="file">`. PHPickerViewController lets the person
/// pick a photo instead: it runs outside the app and hands over only the photo
/// picked, so the app needs no photo library permission (no
/// NSPhotoLibraryUsageDescription).
///
/// The image goes back as base64, since the module's callback and the
/// runtime's relay to the main thread carry only what JSON can. Scaling it
/// down here first, with `maxDimension`, keeps that small: a 12-megapixel
/// photo is several megabytes, a 1024-pixel one a few hundred kilobytes.
final class ImagePickerModule: NSObject, LynxModule, PHPickerViewControllerDelegate,
  UIAdaptivePresentationControllerDelegate
{
  static var name: String { "AngularLynxImagePicker" }

  static var methodLookup: [String: String] {
    ["pick": NSStringFromSelector(#selector(pick(_:callback:)))]
  }

  /// What a re-encoded image gets when the app doesn't choose a quality.
  private static let defaultQuality = 0.9

  /// The formats other platforms can show, which go back as they were picked
  /// unless the app asks for a smaller or re-compressed image. Anything else,
  /// such as an iPhone's HEIC photos, is re-encoded as a JPEG.
  private static let portableTypes: Set<String> = [
    "image/jpeg", "image/png", "image/gif", "image/webp",
  ]

  /// The open picker's request and who to tell, until it closes.
  private struct Request {
    let maxDimension: Int?
    let quality: Double?
    let callback: LynxCallbackBlock
  }
  private var open: Request?

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  /// Opens the picker and calls back once with `{ base64, name, type }`,
  /// `{ canceled: true }` when the person closes it, or
  /// `{ error: "failed", message }`.
  @objc func pick(_ options: [String: Any], callback: @escaping LynxCallbackBlock) {
    // Lynx calls modules off the main thread, and the picker is UI.
    DispatchQueue.main.async {
      self.present(options, callback)
    }
  }

  private func present(_ options: [String: Any], _ callback: @escaping LynxCallbackBlock) {
    guard open == nil else {
      callback(["error": "failed", "message": "A picker is already open."])
      return
    }
    guard let presenter = topViewController() else {
      callback(["error": "failed", "message": "There's no screen to open the picker over."])
      return
    }
    var configuration = PHPickerConfiguration()
    configuration.filter = .images
    configuration.selectionLimit = 1
    // The photo as it's stored, rather than one the system converts first:
    // this module converts only what it must, once.
    configuration.preferredAssetRepresentationMode = .current
    let picker = PHPickerViewController(configuration: configuration)
    picker.delegate = self
    open = Request(
      maxDimension: (options["maxDimension"] as? NSNumber)?.intValue,
      quality: (options["quality"] as? NSNumber)?.doubleValue,
      callback: callback)
    presenter.present(picker, animated: true)
    // Swiping the sheet down closes it without didFinishPicking.
    picker.presentationController?.delegate = self
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let request = open else { return }
    open = nil
    guard let provider = results.first?.itemProvider else {
      request.callback(["canceled": true])
      return
    }
    // The first of the photo's representations that's an image, which is
    // the one it's stored in: public.heic for most iPhone photos.
    guard
      let identifier = provider.registeredTypeIdentifiers.first(where: {
        UTType($0)?.conforms(to: .image) == true
      })
    else {
      request.callback(["error": "failed", "message": "The picked item isn't an image."])
      return
    }
    let name = provider.suggestedName ?? "image"
    provider.loadDataRepresentation(forTypeIdentifier: identifier) { data, error in
      // Called on a background queue, which is where the image work belongs.
      guard let data else {
        request.callback([
          "error": "failed",
          "message": error?.localizedDescription ?? "The picked image couldn't be read.",
        ])
        return
      }
request.callback(
        Self.prepare(data, type: UTType(identifier), name: name, request: request))
    }
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    guard let request = open else { return }
    open = nil
    request.callback(["canceled": true])
  }

  /// The callback's answer for the picked image: as it was picked, or
  /// re-encoded as a JPEG.
  private static func prepare(_ data: Data, type: UTType?, name: String, request: Request)
    -> [String: Any]
  {
    let mime = type?.preferredMIMEType ?? "application/octet-stream"
    if request.maxDimension == nil, request.quality == nil, portableTypes.contains(mime) {
      return [
        "base64": data.base64EncodedString(),
        "name": "\(name).\(type?.preferredFilenameExtension ?? "jpg")",
        "type": mime,
      ]
    }
    guard
      let jpeg = toJpeg(
        data, maxDimension: request.maxDimension,
        quality: request.quality ?? defaultQuality)
    else {
      return ["error": "failed", "message": "The picked image couldn't be decoded."]
    }
    return ["base64": jpeg.base64EncodedString(), "name": "\(name).jpg", "type": "image/jpeg"]
  }

  /// The image as a JPEG: upright, whichever way the camera stored it, no
  /// larger than `maxDimension` on its longest side, and without the
  /// original's metadata, such as where it was taken. ImageIO decodes it
  /// straight to the target size, so a 12-megapixel photo is never held in
  /// memory at full size when it's scaled down.
  private static func toJpeg(_ data: Data, maxDimension: Int?, quality: Double) -> Data? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { return nil }
    // Never larger than the image: ImageIO would scale it up.
    let longest = max(width, height)
    let size = min(maxDimension ?? longest, longest)
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: size,
      kCGImageSourceShouldCacheImmediately: true,
    ]
    guard var image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    else { return nil }
    if let opaque = flattened(image) {
      image = opaque
    }
    let output = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        output, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(
      destination, image,
      [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    return CGImageDestinationFinalize(destination) ? output as Data : nil
  }

  /// The image drawn over white, when it has transparency: a JPEG has none,
  /// and would show it black. Nil for an image that's already opaque.
  private static func flattened(_ image: CGImage) -> CGImage? {
    switch image.alphaInfo {
    case .none, .noneSkipFirst, .noneSkipLast: return nil
    default: break
    }
    // The image's own color space keeps a Display P3 photo's colors.
    let space =
      image.colorSpace.flatMap { $0.model == .rgb ? $0 : nil }
      ?? CGColorSpace(name: CGColorSpace.sRGB)!
    guard
      let context = CGContext(
        data: nil, width: image.width, height: image.height, bitsPerComponent: 8,
        bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { return nil }
    let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(bounds)
    context.draw(image, in: bounds)
    return context.makeImage()
  }

  /// The view controller on top, which the picker opens over.
  private func topViewController() -> UIViewController? {
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)
    var top = window?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
}
