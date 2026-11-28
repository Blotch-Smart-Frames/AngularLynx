import CoreNFC
import Lynx

/// The native module behind the runtime's `LynxNfc`, which calls it as
/// `NativeModules.AngularLynxNfc` (from the background thread, where
/// NativeModules lives). Android's shell has one of the same name.
///
/// A session is Core NFC's `NFCNDEFReaderSession`, which shows the system's
/// scan sheet while it's open. The runtime opens one with `start`, takes
/// each tag with `next`, and closes it with `stop`:
///
/// - `state` calls back `{ state }`: `ready` on an iPhone that reads tags,
///   `unsupported` on one that doesn't (an iPad, the Simulator).
/// - `start` takes `{ alertMessage?, multiple, write? }` and calls back `{}`
///   once the sheet is up, or `{ error, message }`. With `write`, a list of
///   records, each tag found is written to rather than read.
/// - `next` calls back once with the next tag, `{ tag }`, or
///   `{ error, message }`: a tag that couldn't be read or written (only when
///   `multiple` is false: a scan skips it and says so on the sheet), or why
///   the session ended, `stopped` when the runtime ended it.
/// - `stop` takes `{ message?, errorMessage? }`, what the sheet says as it
///   closes, and calls back `{}`.
///
/// Records cross as `{ tnf, type, id, payload }`, the last three base64: the
/// runtime builds and reads them, so both shells treat records the same way.
///
/// The session needs `NFCReaderUsageDescription` and the NFC Tag Reading
/// entitlement, which a free Personal Team can't sign, so the generator
/// writes them and keeps this file only in an app whose angular.json sets
/// `permissions.nfc`. LynxViewController registers the module by its
/// Objective-C name only when it's there, hence the `@objc` name.
@objc(AngularLynxNfcModule)
final class NfcModule: NSObject, LynxModule, NFCNDEFReaderSessionDelegate {
  static var name: String { "AngularLynxNfc" }

  static var methodLookup: [String: String] {
    [
      "state": NSStringFromSelector(#selector(state(_:))),
      "start": NSStringFromSelector(#selector(start(_:callback:))),
      "next": NSStringFromSelector(#selector(next(_:))),
      "stop": NSStringFromSelector(#selector(stop(_:callback:))),
    ]
  }

  /// Every field below is read and written on this queue, which is also the
  /// session's delegate queue: Lynx calls the module's methods on a thread
  /// of its own.
  private let queue = DispatchQueue(label: "dev.angularlynx.nfc")

  private var session: NFCNDEFReaderSession?
  /// `start`'s callback, until the sheet is up or the session fails.
  private var starting: LynxCallbackBlock?
  /// `next`'s callback, until a tag or the session's end answers it.
  private var waiting: LynxCallbackBlock?
  /// The tags found while nobody was waiting, oldest first.
  private var answers: [[String: Any]] = []
  /// Why the last session ended, for a `next` after it.
  private var ended: [String: Any] = ["error": "stopped"]
  private var multiple = false
  private var message: NFCNDEFMessage?
  private var alertMessage = ""

  override init() {
    super.init()
  }

  // Swift can't import an optional initializer as optional, so Lynx's
  // initWithParam: is required here. Registered without a param, the module
  // ignores it.
  init(param: Any) {
    super.init()
  }

  @objc func state(_ callback: @escaping LynxCallbackBlock) {
    callback(["state": NFCNDEFReaderSession.readingAvailable ? "ready" : "unsupported"])
  }

  @objc func start(_ options: [String: Any], callback: @escaping LynxCallbackBlock) {
    queue.async {
      guard NFCNDEFReaderSession.readingAvailable else {
        callback(["error": "unsupported", "message": "This iPhone can't read NFC tags."])
        return
      }
      guard self.session == nil else {
        callback(["error": "busy", "message": "Another NFC read or write is still open."])
        return
      }
      self.message = nil
      if let records = options["write"] as? [[String: Any]] {
        guard let payloads = Self.payloads(records) else {
          callback(["error": "failed", "message": "The records to write aren't valid NDEF records."])
          return
        }
        self.message = NFCNDEFMessage(records: payloads)
      }
      self.multiple = options["multiple"] as? Bool ?? false
      self.alertMessage = options["alertMessage"] as? String ?? "Hold your iPhone near the tag."
      self.answers = []
      // invalidateAfterFirstRead is ignored once the delegate takes tags
      // (didDetect tags:), which it does to write and to say why a tag
      // failed: the module ends the session itself.
      let session = NFCNDEFReaderSession(delegate: self, queue: self.queue, invalidateAfterFirstRead: false)
      session.alertMessage = self.alertMessage
      self.session = session
      self.starting = callback
      session.begin()
    }
  }

  @objc func next(_ callback: @escaping LynxCallbackBlock) {
    queue.async {
      if !self.answers.isEmpty {
        callback(self.answers.removeFirst())
      } else if self.session == nil {
        callback(self.ended)
      } else if self.waiting != nil {
        callback(["error": "busy", "message": "The module is already waiting for a tag."])
      } else {
        self.waiting = callback
      }
    }
  }

  @objc func stop(_ options: [String: Any], callback: @escaping LynxCallbackBlock) {
    queue.async {
      if let session = self.session {
        // Forgotten first, so the delegate's call for this session, which
        // comes later, finds it isn't the current one.
        self.session = nil
        if let errorMessage = options["errorMessage"] as? String {
          session.invalidate(errorMessage: errorMessage)
        } else {
          if let message = options["message"] as? String {
            session.alertMessage = message
          }
          session.invalidate()
        }
        self.end(["error": "stopped"])
      }
      callback([:])
    }
  }

  /// Answers whoever waits with why the session ended, and keeps it for a
  /// later `next`.
  private func end(_ result: [String: Any]) {
    ended = result
    if let starting {
      self.starting = nil
      starting(result)
    }
    if let waiting {
      self.waiting = nil
      waiting(result)
    }
  }

  private func deliver(_ answer: [String: Any]) {
    if let waiting {
      self.waiting = nil
      waiting(answer)
    } else {
      answers.append(answer)
    }
  }

  // MARK: NFCNDEFReaderSessionDelegate

  func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {
    guard session === self.session, let starting else { return }
    self.starting = nil
    starting([:])
  }

  func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
    // A session the runtime stopped has already been answered.
    guard session === self.session else { return }
    self.session = nil
    end(Self.endResult(error))
  }

  /// Required, but iOS calls `didDetect tags:` instead once the delegate has
  /// it.
  func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {}

  func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [any NFCNDEFTag]) {
    guard session === self.session else { return }
    guard tags.count == 1, let tag = tags.first else {
      session.alertMessage = "More than one tag is near the iPhone. Hold just one near it."
      restartPolling(session)
      return
    }
    session.connect(to: tag) { error in
      self.queue.async {
        guard session === self.session else { return }
        if let error {
          self.tagFailed(session, "failed", "The tag moved away before it could be read: \(error.localizedDescription)")
          return
        }
        tag.queryNDEFStatus { status, capacity, error in
          self.queue.async {
            guard session === self.session else { return }
            if let error {
              self.tagFailed(session, "failed", "The tag couldn't be read: \(error.localizedDescription)")
            } else if status == .notSupported {
              self.tagFailed(session, "tagNotNdef", "This tag doesn't hold NDEF records.")
            } else if let message = self.message {
              self.write(message, to: tag, status: status, capacity: capacity, session: session)
            } else {
              self.read(tag, status: status, capacity: capacity, session: session)
            }
          }
        }
      }
    }
  }

  private func read(
    _ tag: any NFCNDEFTag, status: NFCNDEFStatus, capacity: Int, session: NFCNDEFReaderSession
  ) {
    tag.readNDEF { message, error in
      self.queue.async {
        guard session === self.session else { return }
        // An empty tag answers with this error rather than an empty message.
        if let error = error as? NFCReaderError, error.code == .ndefReaderSessionErrorZeroLengthMessage {
          self.tagRead(session, Self.tag([], writable: status == .readWrite, capacity: capacity))
        } else if let message {
          self.tagRead(session, Self.tag(message.records, writable: status == .readWrite, capacity: capacity))
        } else {
          self.tagFailed(
            session, "failed", "The tag couldn't be read: \(error?.localizedDescription ?? "no message")")
        }
      }
    }
  }

  private func write(
    _ message: NFCNDEFMessage, to tag: any NFCNDEFTag, status: NFCNDEFStatus, capacity: Int,
    session: NFCNDEFReaderSession
  ) {
    guard status == .readWrite else {
      tagFailed(session, "readOnly", "This tag is locked, so it can't be written to.")
      return
    }
    guard message.length <= capacity else {
      tagFailed(session, "tooLarge", "The records take \(message.length) bytes, and this tag holds \(capacity).")
      return
    }
    tag.writeNDEF(message) { error in
      self.queue.async {
        guard session === self.session else { return }
        if let error {
          self.tagFailed(session, "failed", "The tag couldn't be written: \(error.localizedDescription)")
        } else {
          self.tagRead(session, Self.tag(message.records, writable: true, capacity: capacity))
        }
      }
    }
  }

  /// A tag read or written: the runtime takes it, and a scan listens for the
  /// next one.
  private func tagRead(_ session: NFCNDEFReaderSession, _ tag: [String: Any]) {
    deliver(["tag": tag])
    if multiple {
      session.alertMessage = alertMessage
      restartPolling(session)
    }
  }

  /// A tag that couldn't be read or written. A scan says so on the sheet and
  /// listens for the next; a single read or write rejects with it, and the
  /// runtime closes the sheet with the message.
  private func tagFailed(_ session: NFCNDEFReaderSession, _ code: String, _ message: String) {
    if multiple {
      session.alertMessage = message
      restartPolling(session)
    } else {
      deliver(["error": code, "message": message])
    }
  }

  /// Listens again after a moment, so the tag just handled, or the ones that
  /// were too many, can be taken away first.
  private func restartPolling(_ session: NFCNDEFReaderSession) {
    queue.asyncAfter(deadline: .now() + 0.5) {
      guard session === self.session else { return }
      session.restartPolling()
    }
  }

  // MARK: Converting

  private static func endResult(_ error: Error) -> [String: Any] {
    let message = error.localizedDescription
    guard let error = error as? NFCReaderError else {
      return ["error": "failed", "message": message]
    }
    switch error.code {
    case .readerSessionInvalidationErrorUserCanceled:
      return ["error": "canceled", "message": "The NFC session was canceled."]
    case .readerSessionInvalidationErrorSessionTimeout:
      return ["error": "timeout", "message": "No tag came near the iPhone in time."]
    case .readerSessionInvalidationErrorFirstNDEFTagRead:
      return ["error": "stopped"]
    case .readerErrorUnsupportedFeature:
      return ["error": "unsupported", "message": "This iPhone can't read NFC tags."]
    case .readerSessionInvalidationErrorSystemIsBusy:
      return ["error": "busy", "message": "iOS is busy with another NFC session."]
    default:
      return ["error": "failed", "message": "\(message) (\(error.code.rawValue))"]
    }
  }

  private static func tag(_ records: [NFCNDEFPayload], writable: Bool, capacity: Int) -> [String: Any] {
    [
      "records": records.map { record in
        [
          "tnf": Int(record.typeNameFormat.rawValue),
          "type": record.type.base64EncodedString(),
          "id": record.identifier.base64EncodedString(),
          "payload": record.payload.base64EncodedString(),
        ] as [String: Any]
      },
      "writable": writable,
      "capacity": capacity,
    ]
  }

  /// The runtime's records as payloads, or nil for one that isn't valid.
  private static func payloads(_ records: [[String: Any]]) -> [NFCNDEFPayload]? {
    var payloads: [NFCNDEFPayload] = []
    for record in records {
      guard
        let tnf = (record["tnf"] as? NSNumber).flatMap({ NFCTypeNameFormat(rawValue: $0.uint8Value) }),
        let type = (record["type"] as? String).flatMap({ Data(base64Encoded: $0) }),
        let payload = (record["payload"] as? String).flatMap({ Data(base64Encoded: $0) })
      else {
        return nil
      }
      let identifier = (record["id"] as? String).flatMap { Data(base64Encoded: $0) } ?? Data()
      payloads.append(NFCNDEFPayload(format: tnf, type: type, identifier: identifier, payload: payload))
    }
    return payloads
  }
}
