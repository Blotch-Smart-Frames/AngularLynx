import AVFoundation
import Lynx
import UIKit
import Vision
import VisionKit

/// The native module behind the runtime's `LynxBarcodeScanner`, which calls it
/// as `NativeModules.AngularLynxBarcodeScanner` (from the background thread,
/// where NativeModules lives).
///
/// It opens VisionKit's DataScannerViewController, the system's own live
/// scanner, over the app, and closes it at the first code it reads. VisionKit
/// has it from iOS 16 on phones with an A12 chip or later; anywhere else,
/// including the Simulator, a scan reports `unavailable`.
///
/// Only an app whose angular.json sets `permissions.camera` has this file: App
/// Store Connect flags an app whose code uses the camera without
/// NSCameraUsageDescription (ITMS-90683), which only that permission writes.
/// So LynxViewController registers it by its Objective-C name, which builds
/// whether the generator kept it or not, and nothing else may name the class.
@objc(AngularLynxBarcodeScannerModule)
final class BarcodeScannerModule: NSObject, LynxModule {
  static var name: String { "AngularLynxBarcodeScanner" }

  static var methodLookup: [String: String] {
    ["scan": NSStringFromSelector(#selector(scan(_:callback:)))]
  }

  /// The open scanner, which ends the scan, as an `AnyObject` because its
  /// type exists only from iOS 16.
  private var open: AnyObject?

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  /// Opens the scanner and calls back once with `{ format, value }`, or
  /// `{ error, message }`, where `error` is `canceled`, `unavailable`,
  /// `denied` or `failed`.
  @objc func scan(_ request: [String: Any], callback: @escaping LynxCallbackBlock) {
    let formats = (request["formats"] as? [String]) ?? []
    // Lynx calls modules off the main thread, and the scanner is UI.
    DispatchQueue.main.async {
      self.start(formats, callback)
    }
  }

  private func start(_ formats: [String], _ callback: @escaping LynxCallbackBlock) {
    guard #available(iOS 16, *) else {
      callback(Self.error("unavailable", "The barcode scanner needs iOS 16 or later."))
      return
    }
    guard open == nil else {
      callback(Self.error("failed", "A scan is already open."))
      return
    }
    // isSupported is the hardware and the OS; isAvailable also says no when
    // the camera's restricted or the person declined it, which is told
    // apart below, after asking.
    guard DataScannerViewController.isSupported else {
      callback(
        Self.error("unavailable", "This device has no barcode scanner. It needs an A12 chip or later."))
      return
    }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      present(formats, callback)
    case .notDetermined:
      // The prompt shows NSCameraUsageDescription, angular.json's
      // permissions.camera.
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
          if granted {
            self.present(formats, callback)
          } else {
            callback(Self.error("denied", "The app isn't allowed to use the camera."))
          }
        }
      }
    default:
      callback(Self.error("denied", "The app isn't allowed to use the camera."))
    }
  }

  @available(iOS 16, *)
  private func present(_ formats: [String], _ callback: @escaping LynxCallbackBlock) {
    guard open == nil else {
      callback(Self.error("failed", "A scan is already open."))
      return
    }
    guard DataScannerViewController.isAvailable else {
      callback(Self.error("unavailable", "The camera isn't available right now."))
      return
    }
    guard let presenter = topViewController() else {
      callback(Self.error("failed", "There's no screen to open the scanner over."))
      return
    }
    let symbologies = Self.symbologies(formats)
    // Called once the sheet has gone (ScanSession.finish), so a scan that
    // comes in while it animates away finds this one still open and fails,
    // rather than presenting over it.
    let session = ScanSession(formats: Set(formats)) { [weak self] result in
      self?.open = nil
      callback(result)
    }
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: symbologies)],
      qualityLevel: .balanced,
      recognizesMultipleItems: false,
      isHighFrameRateTrackingEnabled: false,
      isHighlightingEnabled: true)
    scanner.delegate = session
    session.scanner = scanner
    // A navigation bar for the Cancel button, since the scanner has none of
    // its own, in a sheet the person can also swipe down to close.
    scanner.navigationItem.leftBarButtonItem = UIBarButtonItem(
      systemItem: .cancel,
      primaryAction: UIAction { [weak session] _ in session?.cancel() })
    let navigation = UINavigationController(rootViewController: scanner)
    navigation.presentationController?.delegate = session
    open = session
    presenter.present(navigation, animated: true) {
      do {
        try scanner.startScanning()
      } catch {
        session.finish(Self.error("failed", error.localizedDescription))
      }
    }
  }

  /// The runtime's BarcodeFormat names as Vision's symbologies. VisionKit
  /// reads a UPC-A as an EAN-13 with a leading 0, so `upcA` asks for EAN-13
  /// and ScanSession gives the 12 digits back. ITF covers ITF-14 and
  /// interleaved 2 of 5, as Android's `itf` does.
  @available(iOS 16, *)
  private static func symbologies(_ formats: [String]) -> [VNBarcodeSymbology] {
    let all: [String: [VNBarcodeSymbology]] = [
      "qr": [.qr, .microQR],
      "aztec": [.aztec],
      "dataMatrix": [.dataMatrix],
      "pdf417": [.pdf417, .microPDF417],
      "ean13": [.ean13],
      "ean8": [.ean8],
      "upcA": [.ean13],
      "upcE": [.upce],
      "code39": [.code39, .code39Checksum, .code39FullASCII, .code39FullASCIIChecksum],
      "code93": [.code93, .code93i],
      "code128": [.code128],
      "itf": [.itf14, .i2of5, .i2of5Checksum],
      "codabar": [.codabar],
    ]
    var symbologies: [VNBarcodeSymbology] = []
    for format in formats {
      for symbology in all[format] ?? [] where !symbologies.contains(symbology) {
        symbologies.append(symbology)
      }
    }
    return symbologies
  }

  static func error(_ code: String, _ message: String) -> [String: Any] {
    ["error": code, "message": message]
  }

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

/// One open scanner: it reports the first code read, a cancel or a failure,
/// once, and closes the sheet.
@available(iOS 16, *)
private final class ScanSession: NSObject, DataScannerViewControllerDelegate,
  UIAdaptivePresentationControllerDelegate
{
  weak var scanner: DataScannerViewController?
  private let formats: Set<String>
  private var done: (([String: Any]) -> Void)?

  init(formats: Set<String>, done: @escaping ([String: Any]) -> Void) {
    self.formats = formats
    self.done = done
  }

  /// Reports `result` once the sheet is gone, which is also when the module
  /// lets the next scan open: UIKit can drop a presentation over a sheet
  /// that's still animating away, without calling its completion, which
  /// would leave that scan open and unanswered for good.
  func finish(_ result: [String: Any], alreadyDismissed: Bool = false) {
    guard let done else { return }
    self.done = nil
    scanner?.stopScanning()
    guard !alreadyDismissed, let sheet = scanner?.navigationController,
      sheet.presentingViewController != nil
    else {
      done(result)
      return
    }
    sheet.dismiss(animated: true) { done(result) }
  }

  func cancel() {
    finish(BarcodeScannerModule.error("canceled", "The scan was canceled."))
  }

  func dataScanner(
    _ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem],
    allItems: [RecognizedItem]
  ) {
    for item in addedItems {
      guard case .barcode(let barcode) = item, let value = barcode.payloadStringValue,
        let format = format(of: barcode.observation.symbology, value: value)
      else { continue }
      finish(["format": format.name, "value": format.value])
      return
    }
  }

  func dataScanner(
    _ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable
  ) {
    switch error {
    case .cameraRestricted:
      finish(BarcodeScannerModule.error("denied", "The app isn't allowed to use the camera."))
    default:
      finish(BarcodeScannerModule.error("unavailable", "The camera stopped being available."))
    }
  }

  /// Swiping the sheet down closes it without the Cancel button.
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finish(
      BarcodeScannerModule.error("canceled", "The scan was canceled."), alreadyDismissed: true)
  }

  /// The runtime's name for what Vision read, or nil for a kind the app
  /// didn't ask for (an EAN-13 when it only asked for UPC-A, say).
  private func format(of symbology: VNBarcodeSymbology, value: String) -> (name: String, value: String)? {
    let name: String
    switch symbology {
    case .qr, .microQR: name = "qr"
    case .aztec: name = "aztec"
    case .dataMatrix: name = "dataMatrix"
    case .pdf417, .microPDF417: name = "pdf417"
    case .ean13:
      // A UPC-A is an EAN-13 whose first digit is 0.
      if formats.contains("upcA"), value.count == 13, value.hasPrefix("0") {
        return ("upcA", String(value.dropFirst()))
      }
      name = "ean13"
    case .ean8: name = "ean8"
    case .upce: name = "upcE"
    case .code39, .code39Checksum, .code39FullASCII, .code39FullASCIIChecksum: name = "code39"
    case .code93, .code93i: name = "code93"
    case .code128: name = "code128"
    case .itf14, .i2of5, .i2of5Checksum: name = "itf"
    case .codabar: name = "codabar"
    default: return nil
    }
    return formats.contains(name) ? (name, value) : nil
  }
}
