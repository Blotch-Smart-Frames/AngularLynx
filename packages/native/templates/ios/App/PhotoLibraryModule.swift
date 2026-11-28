import Foundation
import Lynx
import Photos

/// The native module behind the runtime's `LynxPhotoLibrary`, which calls it
/// as `NativeModules.AngularLynxPhotoLibrary` (from the background thread,
/// where NativeModules lives).
///
/// Only an app with `permissions.savePhotos` in angular.json has this file:
/// the generator deletes it from the others. LynxViewController registers it
/// by its Objective-C name, so the shell builds either way.
///
/// It asks for add-only access (`.addOnly`), the access the share sheet's
/// Save Image uses: the app can add photos and videos but not see the
/// library, so iOS asks with NSPhotoLibraryAddUsageDescription, and the app
/// needs no NSPhotoLibraryUsageDescription. A photo goes to Photos as its
/// bytes; a video, which can only be added from a file, is written to a
/// temporary file of its own name first, whose extension tells Photos the
/// format. Each method calls back once with
/// `{ permission }`, `{ id, permission }` or `{ error, message, permission }`,
/// where `error` is one of the runtime's PhotoLibraryErrorCode values.
@objc(AngularLynxPhotoLibraryModule)
final class PhotoLibraryModule: NSObject, LynxModule {
  static var name: String { "AngularLynxPhotoLibrary" }

  static var methodLookup: [String: String] {
    [
      "permission": NSStringFromSelector(#selector(permission(_:))),
      "save": NSStringFromSelector(#selector(save(_:callback:))),
    ]
  }

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  /// `{ permission }`: whether the app may add to the library, without asking.
  @objc func permission(_ callback: @escaping LynxCallbackBlock) {
    callback(["permission": Self.permissionName(PHPhotoLibrary.authorizationStatus(for: .addOnly))])
  }

  /// Adds `request`'s file (`{ base64, name, type }`) to the library, asking
  /// for add-only access first if the app hasn't yet, and calls back with
  /// the new asset's local identifier.
  @objc func save(_ request: [String: Any], callback: @escaping LynxCallbackBlock) {
    guard let base64 = request["base64"] as? String,
      let data = Data(base64Encoded: base64)
    else {
      callback(Self.failure("failed", "The file's bytes couldn't be read."))
      return
    }
    let type = request["type"] as? String ?? ""
    let isVideo = type.hasPrefix("video/")
    let name = Self.fileName(request["name"] as? String, isVideo: isVideo)
    // The prompt shows the first time only; after that iOS answers at once.
    // Its handler runs on a queue of Photos' own, which is where the work
    // carries on: writing a video can take a moment.
    PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
      let permission = Self.permissionName(status)
      guard status == .authorized || status == .limited else {
        callback([
          "error": "permission-denied",
          "message": "The app isn't allowed to add to the photo library. The person can allow it in Settings.",
          "permission": permission,
        ])
        return
      }
      // A photo goes to Photos as its bytes. A video can only be added from
      // a file, which Photos copies: having it move the file instead hands
      // the daemon a sandbox extension for it, and on GitHub's iOS 27.2
      // Simulator an add that moved a file was taken and never answered.
      var directory: URL?
      if isVideo {
        let folder = FileManager.default.temporaryDirectory
          .appendingPathComponent("AngularLynxPhotoLibrary", isDirectory: true)
          .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
          try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
          try data.write(to: folder.appendingPathComponent(name))
        } catch {
          // Photos' completion, which removes the folder otherwise, never
          // runs for a file that wasn't written.
          try? FileManager.default.removeItem(at: folder)
          callback(Self.failure("failed", "The file couldn't be written to save: \(error.localizedDescription)", permission))
          return
        }
        directory = folder
      }
      var id: String?
      PHPhotoLibrary.shared().performChanges({
        let creation = PHAssetCreationRequest.forAsset()
        let options = PHAssetResourceCreationOptions()
        // The name Photos keeps, and shows when the photo is exported.
        options.originalFilename = name
        if let directory {
          creation.addResource(
            with: .video, fileURL: directory.appendingPathComponent(name), options: options)
        } else {
          creation.addResource(with: .photo, data: data, options: options)
        }
        id = creation.placeholderForCreatedAsset?.localIdentifier
      }) { success, error in
        if let directory { try? FileManager.default.removeItem(at: directory) }
        if success, let id {
          callback(["id": id, "permission": permission])
          return
        }
        callback(Self.failure(Self.errorCode(error), Self.message(error), permission))
      }
    }
  }

  /// A file name that keeps the app's extension, which is how Photos tells
  /// the format, without anything that would reach outside the directory.
  private static func fileName(_ given: String?, isVideo: Bool) -> String {
    let base = (given ?? "").replacingOccurrences(of: "/", with: "_")
    if !base.isEmpty && base != "." && base != ".." { return base }
    return isVideo ? "Video.mov" : "Photo.jpg"
  }

  private static func permissionName(_ status: PHAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "granted"
    case .limited: return "limited"
    case .denied, .restricted: return "denied"
    case .notDetermined: return "undetermined"
    @unknown default: return "denied"
    }
  }

  /// Photos' errors as the runtime's codes: a format it can't read is the
  /// file's fault, and access errors are the person's answer.
  private static func errorCode(_ error: Error?) -> String {
    guard let error = error as NSError?, error.domain == PHPhotosErrorDomain else {
      return "failed"
    }
    switch error.code {
    case PHPhotosError.Code.invalidResource.rawValue:
      return "unsupported-type"
    case PHPhotosError.Code.accessUserDenied.rawValue,
      PHPhotosError.Code.accessRestricted.rawValue:
      return "permission-denied"
    default:
      return "failed"
    }
  }

  private static func message(_ error: Error?) -> String {
    if let error {
      return "The file couldn't be saved to the photo library: \(error.localizedDescription)"
    }
    return "The file couldn't be saved to the photo library."
  }

  private static func failure(_ code: String, _ message: String, _ permission: String? = nil)
    -> [String: Any]
  {
    var result: [String: Any] = ["error": code, "message": message]
    if let permission { result["permission"] = permission }
    return result
  }
}
