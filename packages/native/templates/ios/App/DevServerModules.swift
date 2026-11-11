// The two native modules rspeedy's live reload needs, in the development
// build only (see DevServer.swift). Lynx Explorer has them from Lynx DevTool,
// which the shell doesn't link: the dev server's client, which rspeedy puts
// in every development bundle, talks to the server over
// `NativeModules.LynxWebSocketModule` (through @lynx-js/websocket) and reloads
// the page with `NativeModules.LynxDevToolSetModule.invokeCdp`, a DevTool
// protocol `Page.reload`. These answer to the same names and calls, so the
// bundle runs here as it does in Lynx Explorer.
#if DEBUG
  import Foundation
  import Lynx

  /// `NativeModules.LynxWebSocketModule`, as Lynx DevTool's
  /// (LynxWebSocketModule.mm): `connect`, `send`, `ping` and `close`, each
  /// with the socket's ID, and the `websocketOpen`, `websocketMessage`,
  /// `websocketClosed` and `websocketFailed` global events @lynx-js/websocket
  /// listens for.
  final class DevWebSocketModule: NSObject, LynxContextModule, URLSessionWebSocketDelegate {
    static var name: String { "LynxWebSocketModule" }

    static var methodLookup: [String: String] {
      [
        "connect": NSStringFromSelector(#selector(connect(_:protocols:options:socketID:))),
        "send": NSStringFromSelector(#selector(send(_:socketID:))),
        "ping": NSStringFromSelector(#selector(ping(_:))),
        "close": NSStringFromSelector(#selector(close(_:reason:socketID:))),
      ]
    }

    private weak var context: LynxContext?
    private var sockets: [Int: URLSessionWebSocketTask] = [:]
    private let lock = NSLock()
    private lazy var session = URLSession(
      configuration: .default, delegate: self, delegateQueue: nil)

    override init() {
      super.init()
    }

    // Swift can't import an optional initializer as optional, so Lynx's
    // initWithParam: and initWithLynxContext:WithParam: are required here.
    init(param: Any) {
      super.init()
    }

    init(lynxContext context: LynxContext) {
      self.context = context
      super.init()
    }

    init(lynxContext context: LynxContext, withParam param: Any) {
      self.context = context
      super.init()
    }

    func destroy() {
      lock.lock()
      let open = Array(sockets.values)
      sockets.removeAll()
      lock.unlock()
      open.forEach { $0.cancel(with: .goingAway, reason: nil) }
      session.invalidateAndCancel()
    }

    @objc func connect(
      _ url: String, protocols: [String]?, options: [String: Any]?, socketID: Double
    ) {
      let id = Int(socketID)
      // The address the bundle was built with may not be the one this
      // device reaches the server at.
      let address = DevServer.shared.remoteURL(for: url.replacingOccurrences(
        of: "^ws", with: "http", options: .regularExpression))
        .map { $0.absoluteString.replacingOccurrences(
          of: "^http", with: "ws", options: .regularExpression) } ?? url
      guard let target = URL(string: address) else {
        send("websocketFailed", ["id": id, "message": "\(url) is not a valid URL."])
        return
      }
      // With an empty list, URLSession still sends an empty
      // Sec-WebSocket-Protocol header, which the dev server rejects.
      let names = (protocols ?? []).filter { !$0.isEmpty }
      let task =
        names.isEmpty
        ? session.webSocketTask(with: target)
        : session.webSocketTask(with: target, protocols: names)
      task.taskDescription = String(id)
      lock.lock()
      sockets[id] = task
      lock.unlock()
      task.resume()
      receive(task, id: id)
    }

    @objc func send(_ message: String, socketID: Double) {
      socket(socketID)?.send(.string(message)) { [weak self] error in
        if let error {
          self?.send("websocketFailed", ["id": Int(socketID), "message": error.localizedDescription])
        }
      }
    }

    @objc func ping(_ socketID: Double) {
      socket(socketID)?.sendPing { _ in }
    }

    @objc func close(_ code: Double, reason: String, socketID: Double) {
      let id = Int(socketID)
      lock.lock()
      let task = sockets.removeValue(forKey: id)
      lock.unlock()
      task?.cancel(
        with: URLSessionWebSocketTask.CloseCode(rawValue: Int(code)) ?? .normalClosure,
        reason: reason.data(using: .utf8))
    }

    private func socket(_ socketID: Double) -> URLSessionWebSocketTask? {
      lock.lock()
      defer { lock.unlock() }
      return sockets[Int(socketID)]
    }

    /// Reads one message, sends it on, and waits for the next, for as long as
    /// the socket is open.
    private func receive(_ task: URLSessionWebSocketTask, id: Int) {
      task.receive { [weak self] result in
        guard let self else { return }
        switch result {
        case .success(.string(let text)):
          self.send("websocketMessage", ["id": id, "type": "text", "data": text])
        case .success(.data(let data)):
          self.send(
            "websocketMessage", ["id": id, "type": "binary", "data": data.base64EncodedString()])
        case .success:
          break
        case .failure:
          // The delegate reports why the socket ended.
          return
        }
        self.receive(task, id: id)
      }
    }

    private func send(_ event: String, _ params: [String: Any]) {
      context?.sendGlobalEvent(event, withParams: [params])
    }

    func urlSession(
      _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
      didOpenWithProtocol protocolName: String?
    ) {
      guard let id = webSocketTask.taskDescription.flatMap(Int.init) else { return }
      send("websocketOpen", ["id": id, "protocol": protocolName ?? ""])
    }

    func urlSession(
      _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
      didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
    ) {
      guard let id = webSocketTask.taskDescription.flatMap(Int.init) else { return }
      lock.lock()
      sockets.removeValue(forKey: id)
      lock.unlock()
      send(
        "websocketClosed",
        [
          "id": id, "code": closeCode.rawValue,
          "reason": reason.flatMap { String(data: $0, encoding: .utf8) } ?? "",
        ])
    }

    /// The connection failed or dropped (the server stopped): the dev
    /// server's client then tries again, with a growing delay.
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?)
    {
      guard let error, let id = task.taskDescription.flatMap(Int.init) else { return }
      lock.lock()
      let known = sockets.removeValue(forKey: id) != nil
      lock.unlock()
      guard known else { return }
      send("websocketFailed", ["id": id, "message": error.localizedDescription])
      send("websocketClosed", ["id": id, "code": 1006, "reason": error.localizedDescription])
    }
  }

  /// `NativeModules.LynxDevToolSetModule`, as far as rspeedy's live reload
  /// uses Lynx DevTool's: `invokeCdp` with a `Page.reload`, which loads the
  /// bundle from the dev server again, as Lynx DevTool's LynxPageReloadHelper
  /// does. It answers any other DevTool method with an error.
  final class DevReloadModule: NSObject, LynxModule {
    static var name: String { "LynxDevToolSetModule" }

    static var methodLookup: [String: String] {
      ["invokeCdp": NSStringFromSelector(#selector(invokeCdp(_:callback:)))]
    }

    override init() {
      super.init()
    }

    init(param: Any) {
      super.init()
    }

    @objc func invokeCdp(_ message: String, callback: LynxCallbackBlock?) {
      let request =
        (try? JSONSerialization.jsonObject(with: Data(message.utf8))) as? [String: Any] ?? [:]
      let id = request["id"] ?? 0
      let method = request["method"] as? String ?? ""
      let reply: [String: Any]
      if method == "Page.reload" {
        DevServer.shared.reloadBundle()
        reply = ["id": id, "result": [String: Any]()]
      } else {
        reply = [
          "id": id,
          "error": ["code": -32601, "message": "\(method) needs Lynx DevTool, which this app doesn't have."],
        ]
      }
      let data = (try? JSONSerialization.data(withJSONObject: reply)) ?? Data()
      callback?(String(data: data, encoding: .utf8) ?? "{}")
    }
  }
#endif
