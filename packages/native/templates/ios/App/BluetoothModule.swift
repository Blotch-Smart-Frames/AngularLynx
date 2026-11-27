import CoreBluetooth
import Foundation
import Lynx

// cspell:words CBUUID

/// The native module behind the runtime's `LynxBluetooth`, which calls it as
/// `NativeModules.AngularLynxBluetooth` (from the background thread, where
/// NativeModules lives): a Bluetooth LE central that scans, connects, reads,
/// writes and subscribes while the app is in the foreground.
///
/// Only an app whose angular.json sets `permissions.bluetooth` has this file.
/// App Store Connect flags an app whose code uses CoreBluetooth without
/// `NSBluetoothAlwaysUsageDescription`, which the generator writes only then,
/// so it leaves the file out otherwise, and the shell registers the class by
/// its Objective-C name instead of naming it.
///
/// Every method calls back once, with its result or `{ error, message }`.
/// What the app didn't ask for at that moment (a scan's sightings,
/// notifications, the radio turning off, a device going out of range) arrives
/// as the `angularLynxBluetooth` global event, an object with a `type`. A
/// scan's `device` and `scanStopped` events carry the `scan` id its
/// `startScan` was given.
///
/// CoreBluetooth's objects belong to the queue their manager was made with, so
/// everything here, the methods Lynx calls on its JavaScript thread and
/// CoreBluetooth's delegate callbacks alike, runs on `queue`, and the state
/// needs no lock.
@objc(AngularLynxBluetoothModule)
final class BluetoothModule: NSObject, LynxContextModule, CBCentralManagerDelegate,
  CBPeripheralDelegate
{
  static var name: String { "AngularLynxBluetooth" }

  static var methodLookup: [String: String] {
    [
      "getState": NSStringFromSelector(#selector(getState(_:))),
      "requestPermission": NSStringFromSelector(#selector(requestPermission(_:))),
      "startScan": NSStringFromSelector(#selector(startScan(_:callback:))),
      "stopScan": NSStringFromSelector(#selector(stopScan(_:))),
      "connect": NSStringFromSelector(#selector(connect(_:options:callback:))),
      "disconnect": NSStringFromSelector(#selector(disconnect(_:callback:))),
      "read": NSStringFromSelector(#selector(read(_:service:characteristic:callback:))),
      "write": NSStringFromSelector(
        #selector(write(_:service:characteristic:value:withResponse:callback:))),
      "setNotifications": NSStringFromSelector(
        #selector(setNotifications(_:service:characteristic:enabled:callback:))),
    ]
  }

  private static let eventName = "angularLynxBluetooth"

  /// The shortest time between two reports of a peripheral a scan keeps
  /// seeing. CoreBluetooth reports every advertisement it hears when asked
  /// for duplicates, many a second per peripheral, which is how a scan
  /// follows the signal strength, but far more events than an app can use.
  private static let sightingInterval: TimeInterval = 1
  /// The longest attribute value ATT allows, which caps a write without
  /// response however large the MTU.
  private static let maxAttributeLength = 512

  /// What CoreBluetooth leaves off a UUID built on the Bluetooth base UUID,
  /// which it names by its 16- or 32-bit short form.
  private static let baseUUIDSuffix = "-0000-1000-8000-00805f9b34fb"

  private weak var context: LynxContext?
  private let queue = DispatchQueue(label: "dev.angularlynx.bluetooth")

  /// Made on first use: making it is what shows iOS's Bluetooth prompt, so
  /// `getState` alone never makes it.
  private var central: CBCentralManager?
  private var destroyed = false

  /// Calls that wait for the manager's first answer: while the prompt is up,
  /// it doesn't know whether it may use the radio.
  private var stateWaiters: [() -> Void] = []

  private var scanning = false
  /// The id the runtime gave the running scan, which its `device` and
  /// `scanStopped` events carry, so it can tell them from those of the scan
  /// it replaced.
  private var scanID = 0
  /// Counts `stopScan` calls, so a `startScan` still waiting for the prompt
  /// doesn't start a scan the app stopped meanwhile.
  private var stopCount = 0
  private var lastSighting: [String: TimeInterval] = [:]

  /// Every peripheral a scan saw. CoreBluetooth connects only to a
  /// `CBPeripheral` it handed out, and frees one nothing keeps.
  private var peripherals: [String: CBPeripheral] = [:]
  /// The names peripherals advertised. A name often comes in the scan
  /// response, a separate report from the advertisement, and CoreBluetooth
  /// knows a peripheral's own name only once it has connected to it.
  private var advertisedNames: [String: String] = [:]
  private var connections: [String: Connection] = [:]

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

  /// Stops the scan and ends every connection, since the radio would
  /// otherwise keep them for a page that's gone. The calls still waiting
  /// aren't answered: there's no page left to answer.
  func destroy() {
    queue.async {
      self.destroyed = true
      self.stateWaiters.removeAll()
      guard let central = self.central else { return }
      if self.scanning {
        central.stopScan()
      }
      for connection in self.connections.values {
        connection.timeout?.cancel()
        central.cancelPeripheralConnection(connection.peripheral)
      }
      self.scanning = false
      self.connections.removeAll()
      central.delegate = nil
      self.central = nil
    }
  }

  // MARK: - Methods

  /// `{ state }`, without asking the person: before anything has made the
  /// manager, iOS tells only whether they refused, so a radio's power reads as
  /// `unknown` until then.
  @objc func getState(_ callback: @escaping LynxCallbackBlock) {
    queue.async {
      callback(["state": self.state()])
    }
  }

  /// `{ state }` once the person has answered iOS's prompt, which making the
  /// manager shows if they haven't been asked.
  @objc func requestPermission(_ callback: @escaping LynxCallbackBlock) {
    queue.async {
      self.whenSettled(callback) { _ in
        callback(["state": self.state()])
      }
    }
  }

  /// Starts a scan for peripherals advertising any of `options.services`, or
  /// every peripheral when it's empty, replacing the scan already running.
  @objc func startScan(_ options: [String: Any]?, callback: @escaping LynxCallbackBlock) {
    let names = options?["services"] as? [String] ?? []
    let id = (options?["scan"] as? NSNumber)?.intValue ?? 0
    queue.async {
      var services: [CBUUID] = []
      for name in names {
        guard let uuid = Self.coreBluetoothUUID(name) else {
          callback(Failure(code: "failed", message: "\(name) isn't a Bluetooth UUID.").result)
          return
        }
        services.append(uuid)
      }
      let stops = self.stopCount
      self.whenPoweredOn(callback) { central in
        guard stops == self.stopCount else {
          callback(
            Failure(code: "failed", message: "stopScan() was called before the scan started.")
              .result)
          return
        }
        // A new scan reports each peripheral as soon as it sees it again.
        self.lastSighting.removeAll()
        self.scanning = true
        self.scanID = id
        central.scanForPeripherals(
          withServices: services.isEmpty ? nil : services,
          options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        callback([:])
      }
    }
  }

  @objc func stopScan(_ callback: @escaping LynxCallbackBlock) {
    queue.async {
      self.stopCount += 1
      if self.scanning {
        self.scanning = false
        self.central?.stopScan()
      }
      callback([:])
    }
  }

  /// Connects to the peripheral, discovers all its services and their
  /// characteristics, and calls back with them, or with `timeout` when that
  /// takes longer than `options.timeout` milliseconds. CoreBluetooth's own
  /// connection attempts never time out, so without one (or with `0`) this
  /// waits until the peripheral is in range.
  @objc func connect(_ id: String, options: [String: Any]?, callback: @escaping LynxCallbackBlock)
  {
    let timeout = options?["timeout"] as? Double ?? 0
    queue.async {
      self.connect(id, timeout: timeout, callback)
    }
  }

  @objc func disconnect(_ id: String, callback: @escaping LynxCallbackBlock) {
    queue.async {
      guard let connection = self.connections[id] else {
        callback([:])
        return
      }
      connection.disconnectWaiters.append(callback)
      if connection.phase != .closing {
        self.abandon(
          connection,
          Failure(code: "failed", message: "disconnect() was called before the device connected."))
      }
    }
  }

  @objc func read(
    _ id: String, service: String, characteristic: String,
    callback: @escaping LynxCallbackBlock
  ) {
    queue.async {
      guard let target = self.target(id, service, characteristic, orFail: callback) else { return }
      guard target.characteristic.properties.contains(.read) else {
        callback(
          Failure(code: "failed", message: "The characteristic \(characteristic) can't be read.")
            .result)
        return
      }
      target.connection.reads[ObjectIdentifier(target.characteristic), default: []].append(
        callback)
      target.connection.peripheral.readValue(for: target.characteristic)
    }
  }

  /// Writes `value` (base64). With a response, it calls back once the
  /// peripheral confirms; without, once CoreBluetooth has taken the write,
  /// which it can only while its buffer has room.
  @objc func write(
    _ id: String, service: String, characteristic: String, value: String, withResponse: Bool,
    callback: @escaping LynxCallbackBlock
  ) {
    queue.async {
      guard let target = self.target(id, service, characteristic, orFail: callback) else { return }
      guard let data = Data(base64Encoded: value) else {
        callback(Failure(code: "failed", message: "The value isn't base64.").result)
        return
      }
      let connection = target.connection
      let properties = target.characteristic.properties
      // CoreBluetooth ignores a write the characteristic doesn't declare,
      // without calling back, so it's refused here.
      if withResponse {
        guard properties.contains(.write) else {
          callback(
            Failure(
              code: "failed",
              message: "The characteristic \(characteristic) can't be written with a response."
            ).result)
          return
        }
        connection.writes[ObjectIdentifier(target.characteristic), default: []].append(callback)
        connection.peripheral.writeValue(data, for: target.characteristic, type: .withResponse)
        return
      }
      guard properties.contains(.writeWithoutResponse) else {
        callback(
          Failure(
            code: "failed",
            message: "The characteristic \(characteristic) can't be written without a response."
          ).result)
        return
      }
      let limit = Self.maxWriteLength(connection.peripheral)
      guard data.count <= limit else {
        callback(
          Failure(
            code: "failed",
            message:
              "A write without response carries at most \(limit) bytes to this device, and this one has \(data.count)."
          ).result)
        return
      }
      connection.unsent.append(
        PendingWrite(characteristic: target.characteristic, data: data, callback: callback))
      self.flushWrites(connection)
    }
  }

  /// Turns notifications on or off, and calls back once the peripheral has
  /// taken the change. CoreBluetooth uses notifications when the
  /// characteristic has them, and indications otherwise.
  @objc func setNotifications(
    _ id: String, service: String, characteristic: String, enabled: Bool,
    callback: @escaping LynxCallbackBlock
  ) {
    queue.async {
      guard let target = self.target(id, service, characteristic, orFail: callback) else { return }
      let connection = target.connection
      let key = ObjectIdentifier(target.characteristic)
      // CoreBluetooth needn't call back for a change that changes nothing.
      if connection.subscriptions[key] == nil, target.characteristic.isNotifying == enabled {
        callback([:])
        return
      }
      let properties = target.characteristic.properties
      guard properties.contains(.notify) || properties.contains(.indicate) else {
        callback(
          Failure(
            code: "failed",
            message: "The characteristic \(characteristic) has no notifications or indications."
          ).result)
        return
      }
      connection.subscriptions[key, default: []].append(callback)
      connection.peripheral.setNotifyValue(enabled, for: target.characteristic)
    }
  }

  // MARK: - The manager

  private func manager() -> CBCentralManager? {
    if let central {
      return central
    }
    guard !destroyed else { return nil }
    let made = CBCentralManager(delegate: self, queue: queue)
    central = made
    return made
  }

  /// Whether the manager knows if it may use the radio. iOS may report it
  /// unauthorized while its prompt still waits for the person, and reports
  /// again once they answer.
  private func isSettled(_ central: CBCentralManager) -> Bool {
    switch central.state {
    case .unknown:
      return false
    case .unauthorized:
      return CBManager.authorization != .notDetermined
    default:
      return true
    }
  }

  /// Runs `action` once the manager knows whether it may use the radio,
  /// making it first, which shows iOS's prompt if the person hasn't been asked.
  private func whenSettled(
    _ callback: @escaping LynxCallbackBlock, _ action: @escaping (CBCentralManager) -> Void
  ) {
    guard let central = manager() else {
      callback(Failure(code: "failed", message: "The page has closed.").result)
      return
    }
    guard isSettled(central) else {
      stateWaiters.append { [self] in
        whenSettled(callback, action)
      }
      return
    }
    action(central)
  }

  /// Runs `action` once the radio is on, or calls back with why it can't be.
  private func whenPoweredOn(
    _ callback: @escaping LynxCallbackBlock, _ action: @escaping (CBCentralManager) -> Void
  ) {
    whenSettled(callback) { central in
      guard central.state == .poweredOn else {
        callback(Self.failure(for: central.state).result)
        return
      }
      action(central)
    }
  }

  private func state() -> String {
    guard let central else {
      switch CBManager.authorization {
      case .denied, .restricted:
        return "unauthorized"
      default:
        return "unknown"
      }
    }
    guard isSettled(central) else { return "unknown" }
    switch central.state {
    case .unknown:
      return "unknown"
    case .resetting:
      return "resetting"
    case .unsupported:
      return "unsupported"
    case .unauthorized:
      return "unauthorized"
    case .poweredOff:
      return "poweredOff"
    case .poweredOn:
      return "poweredOn"
    @unknown default:
      return "unknown"
    }
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    send(["type": "state", "state": state()])
    // CoreBluetooth ends every connection and the scan when the radio stops,
    // without reporting each one, and doesn't resume them when it's back.
    if central.state != .poweredOn {
      lose(Self.failure(for: central.state))
    }
    // Below poweredOff, every CBPeripheral the manager handed out is invalid:
    // the next connect retrieves or rediscovers its peripheral.
    if central.state.rawValue < CBManagerState.poweredOff.rawValue {
      peripherals.removeAll()
    }
    if isSettled(central) {
      let waiting = stateWaiters
      stateWaiters.removeAll()
      waiting.forEach { $0() }
    }
  }

  /// Ends the scan and every connection after the radio stopped, telling the
  /// app about each one it was using.
  private func lose(_ failure: Failure) {
    if scanning {
      scanning = false
      send([
        "type": "scanStopped", "scan": scanID, "error": failure.code, "message": failure.message,
      ])
    }
    for connection in Array(connections.values) {
      let event: [String: Any]? =
        connection.phase == .ready && !connection.askedToClose
        ? [
          "type": "disconnected", "id": connection.id, "error": failure.code,
          "message": failure.message,
        ] : nil
      end(connection, failure, event: event)
    }
  }

  // MARK: - Scanning

  func centralManager(
    _ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any], rssi RSSI: NSNumber
  ) {
    // Sightings already queued when the scan stopped.
    guard scanning else { return }
    let id = Self.id(of: peripheral)
    peripherals[id] = peripheral
    if let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String {
      advertisedNames[id] = name
    }
    let now = ProcessInfo.processInfo.systemUptime
    if let last = lastSighting[id], now - last < Self.sightingInterval {
      return
    }
    lastSighting[id] = now

    // The overflow list holds the services of an iPhone advertising in the
    // background, which iOS moves out of the advertisement itself.
    let uuids =
      (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
      + (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? [])
    var services: [String] = []
    for uuid in uuids.map(Self.string) where !services.contains(uuid) {
      services.append(uuid)
    }
    var serviceData: [String: String] = [:]
    for (uuid, data) in advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data]
      ?? [:]
    {
      serviceData[Self.string(uuid)] = data.base64EncodedString()
    }
    // CoreBluetooth hands over the manufacturer data whole: its first two
    // bytes are the company's Bluetooth SIG identifier, little-endian.
    var manufacturerData: [String: String] = [:]
    if let raw = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data, raw.count >= 2
    {
      let company = Int(raw[raw.startIndex]) | Int(raw[raw.startIndex + 1]) << 8
      manufacturerData[String(company)] = raw.dropFirst(2).base64EncodedString()
    }
    let device: [String: Any] = [
      "id": id,
      "name": (advertisedNames[id] ?? peripheral.name).map { $0 as Any } ?? NSNull(),
      "rssi": RSSI.intValue,
      "services": services,
      "serviceData": serviceData,
      "manufacturerData": manufacturerData,
    ]
    send(["type": "device", "scan": scanID, "device": device])
  }

  // MARK: - Connections

  private func connect(_ id: String, timeout: Double, _ callback: @escaping LynxCallbackBlock) {
    whenPoweredOn(callback) { central in
      if let connection = self.connections[id] {
        self.join(connection, timeout: timeout, callback)
      } else if let peripheral = self.peripheral(id, central) {
        self.open(peripheral, id: id, timeout: timeout, central: central, callback)
      } else {
        callback(Failure(code: "notFound", message: "No Bluetooth device has the id \(id).").result)
      }
    }
  }

  /// A `connect` for a peripheral that already has a connection, which it
  /// shares rather than starting a second.
  private func join(
    _ connection: Connection, timeout: Double, _ callback: @escaping LynxCallbackBlock
  ) {
    switch connection.phase {
    case .ready:
      callback(describe(connection))
    case .connecting, .discovering:
      connection.connectWaiters.append(callback)
    case .closing:
      // The old connection is still going: connect again once it has.
      let id = connection.id
      connection.afterClose.append { [self] in
        connect(id, timeout: timeout, callback)
      }
    }
  }

  /// The peripheral a scan saw, or else one iOS knows from before (it keeps
  /// the ones this app has connected to).
  private func peripheral(_ id: String, _ central: CBCentralManager) -> CBPeripheral? {
    if let seen = peripherals[id] {
      return seen
    }
    guard let uuid = UUID(uuidString: id),
      let known = central.retrievePeripherals(withIdentifiers: [uuid]).first
    else { return nil }
    peripherals[id] = known
    return known
  }

  private func open(
    _ peripheral: CBPeripheral, id: String, timeout: Double, central: CBCentralManager,
    _ callback: @escaping LynxCallbackBlock
  ) {
    let connection = Connection(id: id, peripheral: peripheral)
    connection.connectWaiters.append(callback)
    connections[id] = connection
    peripheral.delegate = self
    central.connect(peripheral, options: nil)
    guard timeout > 0 else { return }
    let expiry = DispatchWorkItem { [weak self, weak connection] in
      guard let self, let connection, self.connections[connection.id] === connection,
        connection.phase == .connecting || connection.phase == .discovering
      else { return }
      self.abandon(
        connection,
        Failure(code: "timeout", message: "The device didn't connect in time."))
    }
    connection.timeout = expiry
    queue.asyncAfter(deadline: .now() + timeout / 1000, execute: expiry)
  }

  /// Gives up on a connection the module wants to end: fails the `connect`
  /// calls still waiting with `failure`, and cancels it.
  private func abandon(_ connection: Connection, _ failure: Failure) {
    connection.timeout?.cancel()
    connection.askedToClose = true
    let waiting = connection.connectWaiters
    connection.connectWaiters.removeAll()
    waiting.forEach { $0(failure.result) }
    central?.cancelPeripheralConnection(connection.peripheral)
    if connection.phase == .connecting {
      // An attempt that never connected ends here: whether CoreBluetooth
      // reports its cancellation isn't something to wait on.
      end(
        connection,
        Failure(code: "notConnected", message: "The connection was closed."))
    } else {
      // A connected peripheral is always reported disconnected, and until
      // then a new connect would race the old link.
      connection.phase = .closing
    }
  }

  /// Forgets the connection and answers everything still waiting on it:
  /// `connect` and the operations with `failure`, `disconnect` with `{}`.
  private func end(_ connection: Connection, _ failure: Failure, event: [String: Any]? = nil) {
    guard connections[connection.id] === connection else { return }
    connections[connection.id] = nil
    connection.timeout?.cancel()
    let connecting = connection.connectWaiters
    let disconnecting = connection.disconnectWaiters
    let next = connection.afterClose
    connection.connectWaiters.removeAll()
    connection.disconnectWaiters.removeAll()
    connection.afterClose.removeAll()
    connecting.forEach { $0(failure.result) }
    connection.failOperations(failure)
    disconnecting.forEach { $0([:]) }
    if let event {
      send(event)
    }
    next.forEach { $0() }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard let connection = connections[Self.id(of: peripheral)], connection.phase == .connecting
    else { return }
    connection.phase = .discovering
    peripheral.discoverServices(nil)
  }

  func centralManager(
    _ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?
  ) {
    guard let connection = connections[Self.id(of: peripheral)], connection.phase == .connecting
    else { return }
    end(
      connection,
      error.map(Self.failure(for:))
        ?? Failure(code: "failed", message: "The device couldn't be connected."))
  }

  func centralManager(
    _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?
  ) {
    // A connection still connecting hasn't connected, so this reports an
    // earlier attempt the module canceled.
    guard let connection = connections[Self.id(of: peripheral)], connection.phase != .connecting
    else { return }
    if connection.askedToClose {
      end(connection, Failure(code: "notConnected", message: "The connection was closed."))
      return
    }
    let reason = error.map(Self.failure(for:))
    var event: [String: Any]?
    if connection.phase == .ready {
      var disconnected: [String: Any] = ["type": "disconnected", "id": connection.id]
      if let reason {
        disconnected["error"] = reason.code
        disconnected["message"] = reason.message
      }
      event = disconnected
    }
    end(
      connection, reason ?? Failure(code: "notConnected", message: "The device disconnected."),
      event: event)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let connection = connections[Self.id(of: peripheral)],
      connection.phase == .discovering
    else { return }
    if let error {
      abandon(connection, Self.failure(for: error))
      return
    }
    let services = peripheral.services ?? []
    connection.servicesLeft = services.count
    if services.isEmpty {
      ready(connection)
      return
    }
    services.forEach { peripheral.discoverCharacteristics(nil, for: $0) }
  }

  func peripheral(
    _ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?
  ) {
    guard let connection = connections[Self.id(of: peripheral)],
      connection.phase == .discovering
    else { return }
    if let error {
      abandon(connection, Self.failure(for: error))
      return
    }
    connection.servicesLeft -= 1
    if connection.servicesLeft == 0 {
      ready(connection)
    }
  }

  /// The peripheral changed its services (a firmware update, say). The
  /// app's copy of them, and its subscriptions, are of the old ones, so the
  /// connection ends: connecting again discovers the new ones.
  func peripheral(_ peripheral: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
    guard let connection = connections[Self.id(of: peripheral)], connection.phase == .ready,
      !invalidatedServices.isEmpty
    else { return }
    let failure = Failure(code: "failed", message: "The device changed its services.")
    send([
      "type": "disconnected", "id": connection.id, "error": failure.code,
      "message": failure.message,
    ])
    abandon(connection, failure)
  }

  private func ready(_ connection: Connection) {
    connection.phase = .ready
    connection.timeout?.cancel()
    connection.timeout = nil
    let result = describe(connection)
    let waiting = connection.connectWaiters
    connection.connectWaiters.removeAll()
    waiting.forEach { $0(result) }
  }

  private func describe(_ connection: Connection) -> [String: Any] {
    let peripheral = connection.peripheral
    let services = (peripheral.services ?? []).map { service -> [String: Any] in
      [
        "uuid": Self.string(service.uuid),
        "characteristics": (service.characteristics ?? []).map { characteristic -> [String: Any] in
          ["uuid": Self.string(characteristic.uuid), "properties": Self.names(characteristic.properties)]
        },
      ]
    }
    return [
      "id": connection.id,
      "name": (peripheral.name ?? advertisedNames[connection.id]).map { $0 as Any } ?? NSNull(),
      "maxWriteLength": Self.maxWriteLength(peripheral),
      "services": services,
    ]
  }

  // MARK: - Reads, writes and notifications

  private struct Target {
    let connection: Connection
    let characteristic: CBCharacteristic
  }

  /// The connected peripheral's characteristic, or `nil` after calling back
  /// with why there's none.
  private func target(
    _ id: String, _ service: String, _ characteristic: String, orFail callback: LynxCallbackBlock
  ) -> Target? {
    guard let connection = connections[id], connection.phase == .ready else {
      callback(Failure(code: "notConnected", message: "The device \(id) isn't connected.").result)
      return nil
    }
    let serviceUUID = Self.normalize(service)
    let characteristicUUID = Self.normalize(characteristic)
    guard
      let found = connection.peripheral.services?.first(where: {
        Self.string($0.uuid) == serviceUUID
      })
    else {
      callback(Failure(code: "notFound", message: "The device has no service \(service).").result)
      return nil
    }
    guard
      let match = found.characteristics?.first(where: {
        Self.string($0.uuid) == characteristicUUID
      })
    else {
      callback(
        Failure(
          code: "notFound",
          message: "The service \(service) has no characteristic \(characteristic)."
        ).result)
      return nil
    }
    return Target(connection: connection, characteristic: match)
  }

  /// Hands CoreBluetooth the writes without response it has room for, in the
  /// order the app made them.
  private func flushWrites(_ connection: Connection) {
    let peripheral = connection.peripheral
    while !connection.unsent.isEmpty, peripheral.canSendWriteWithoutResponse {
      let write = connection.unsent.removeFirst()
      peripheral.writeValue(write.data, for: write.characteristic, type: .withoutResponse)
      write.callback([:])
    }
  }

  func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
    // A connection that's closing keeps its writes: they fail as it ends,
    // rather than reach a peripheral the app let go of.
    guard let connection = connections[Self.id(of: peripheral)], connection.phase == .ready
    else { return }
    flushWrites(connection)
  }

  /// A read's answer or a notification: CoreBluetooth reports both here. A
  /// value for a characteristic with a read waiting answers the oldest read,
  /// since CoreBluetooth answers a characteristic's reads in order.
  func peripheral(
    _ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?
  ) {
    guard let connection = connections[Self.id(of: peripheral)] else { return }
    if let callback = Self.next(&connection.reads, characteristic) {
      callback(
        Self.outcome(error) {
          ["value": (characteristic.value ?? Data()).base64EncodedString()]
        })
      // CoreBluetooth can't tell a read's answer from a notification, so
      // while the app is subscribed the value reaches its listeners too: a
      // notification the read took isn't lost, and the listeners also hear
      // what was read, as Web Bluetooth's do.
      guard characteristic.isNotifying else { return }
    }
    guard error == nil, connection.phase == .ready, let value = characteristic.value,
      let service = characteristic.service
    else { return }
    send([
      "type": "value",
      "id": connection.id,
      "service": Self.string(service.uuid),
      "characteristic": Self.string(characteristic.uuid),
      "value": value.base64EncodedString(),
    ])
  }

  func peripheral(
    _ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?
  ) {
    guard let connection = connections[Self.id(of: peripheral)],
      let callback = Self.next(&connection.writes, characteristic)
    else { return }
    callback(Self.outcome(error) { [:] })
  }

  func peripheral(
    _ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard let connection = connections[Self.id(of: peripheral)],
      let callback = Self.next(&connection.subscriptions, characteristic)
    else { return }
    callback(Self.outcome(error) { [:] })
  }

  // MARK: - Helpers

  private func send(_ payload: [String: Any]) {
    context?.sendGlobalEvent(Self.eventName, withParams: [payload])
  }

  /// Takes the oldest callback waiting on `characteristic`.
  private static func next(
    _ table: inout [ObjectIdentifier: [LynxCallbackBlock]], _ characteristic: CBCharacteristic
  ) -> LynxCallbackBlock? {
    let key = ObjectIdentifier(characteristic)
    guard var waiting = table[key], !waiting.isEmpty else { return nil }
    let first = waiting.removeFirst()
    table[key] = waiting.isEmpty ? nil : waiting
    return first
  }

  private static func outcome(_ error: Error?, _ success: () -> [String: Any]) -> [String: Any] {
    guard let error else { return success() }
    return failure(for: error).result
  }

  private static func id(of peripheral: CBPeripheral) -> String {
    peripheral.identifier.uuidString.lowercased()
  }

  private static func failure(for error: Error) -> Failure {
    var code = "failed"
    if let error = error as? CBError {
      switch error.code {
      case .connectionTimeout:
        code = "timeout"
      case .notConnected, .peripheralDisconnected:
        code = "notConnected"
      default:
        break
      }
    }
    return Failure(code: code, message: error.localizedDescription)
  }

  private static func failure(for state: CBManagerState) -> Failure {
    switch state {
    case .unsupported:
      return Failure(code: "unsupported", message: "This device doesn't have Bluetooth LE.")
    case .unauthorized:
      return Failure(
        code: "unauthorized",
        message: "The app isn't allowed to use Bluetooth. It can be allowed in Settings.")
    case .poweredOff:
      return Failure(code: "poweredOff", message: "Bluetooth is turned off.")
    case .resetting:
      return Failure(code: "failed", message: "Bluetooth is restarting. Try again in a moment.")
    default:
      return Failure(code: "failed", message: "Bluetooth isn't ready.")
    }
  }

  /// The most bytes a write without response carries: what the MTU allows,
  /// but never more than an attribute holds.
  private static func maxWriteLength(_ peripheral: CBPeripheral) -> Int {
    min(peripheral.maximumWriteValueLength(for: .withoutResponse), maxAttributeLength)
  }

  private static func names(_ properties: CBCharacteristicProperties) -> [String] {
    let known: [(CBCharacteristicProperties, String)] = [
      (.read, "read"),
      (.write, "write"),
      (.writeWithoutResponse, "writeWithoutResponse"),
      (.notify, "notify"),
      (.indicate, "indicate"),
    ]
    return known.filter { properties.contains($0.0) }.map { $0.1 }
  }

  /// A UUID as the runtime writes them: 128 bits, lowercase, hyphenated.
  /// CoreBluetooth gives one built on the Bluetooth base UUID by its 4 or 8
  /// hex digits.
  private static func string(_ uuid: CBUUID) -> String {
    normalize(uuid.uuidString) ?? uuid.uuidString.lowercased()
  }

  /// `text` as a full lowercase UUID, with a short form expanded onto the
  /// Bluetooth base UUID, or `nil` when it isn't one.
  private static func normalize(_ text: String) -> String? {
    let lower = text.lowercased()
    let hex = !lower.isEmpty && lower.allSatisfy { $0.isASCII && $0.isHexDigit }
    if hex && lower.count == 4 {
      return "0000\(lower)\(baseUUIDSuffix)"
    }
    if hex && lower.count == 8 {
      return "\(lower)\(baseUUIDSuffix)"
    }
    return UUID(uuidString: lower) == nil ? nil : lower
  }

  /// The `CBUUID` for a UUID string, or `nil` when it isn't one: CBUUID
  /// raises an Objective-C exception, which ends the app, for anything else.
  /// One built on the base UUID gets its short form, the form CoreBluetooth
  /// reports advertised services in.
  private static func coreBluetoothUUID(_ text: String) -> CBUUID? {
    guard let full = normalize(text) else { return nil }
    guard full.hasSuffix(baseUUIDSuffix) else { return CBUUID(string: full) }
    let head = String(full.prefix(8))
    return CBUUID(string: head.hasPrefix("0000") ? String(head.dropFirst(4)) : head)
  }
}

private struct Failure {
  let code: String
  let message: String

  var result: [String: Any] { ["error": code, "message": message] }
}

private struct PendingWrite {
  let characteristic: CBCharacteristic
  let data: Data
  let callback: LynxCallbackBlock
}

/// One peripheral's connection, from `connect` until CoreBluetooth reports it
/// ended, with the callbacks waiting on it. Operations wait per
/// characteristic: CoreBluetooth queues them itself and answers each
/// characteristic's in order, so different characteristics can be read at
/// once.
private final class Connection {
  enum Phase {
    /// Waiting for CoreBluetooth to connect.
    case connecting
    /// Connected, finding the services and their characteristics.
    case discovering
    /// What `connect` answered with: reads, writes and notifications work.
    case ready
    /// Canceled, waiting for CoreBluetooth to report the link ended.
    case closing
  }

  let id: String
  let peripheral: CBPeripheral
  var phase = Phase.connecting
  /// Whether the module ended it (`disconnect`, a timeout, a failed
  /// discovery), which the app doesn't hear about as a `disconnected` event.
  var askedToClose = false
  var servicesLeft = 0
  var timeout: DispatchWorkItem?
  var connectWaiters: [LynxCallbackBlock] = []
  var disconnectWaiters: [LynxCallbackBlock] = []
  /// `connect` calls that came while it was closing.
  var afterClose: [() -> Void] = []
  var reads: [ObjectIdentifier: [LynxCallbackBlock]] = [:]
  var writes: [ObjectIdentifier: [LynxCallbackBlock]] = [:]
  var subscriptions: [ObjectIdentifier: [LynxCallbackBlock]] = [:]
  /// Writes without response waiting for room in CoreBluetooth's buffer.
  var unsent: [PendingWrite] = []

  init(id: String, peripheral: CBPeripheral) {
    self.id = id
    self.peripheral = peripheral
  }

  func failOperations(_ failure: Failure) {
    let waiting =
      reads.values.flatMap { $0 } + writes.values.flatMap { $0 }
      + subscriptions.values.flatMap { $0 } + unsent.map(\.callback)
    reads.removeAll()
    writes.removeAll()
    subscriptions.removeAll()
    unsent.removeAll()
    waiting.forEach { $0(failure.result) }
  }

}
