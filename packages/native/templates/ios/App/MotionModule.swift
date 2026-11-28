import CoreLocation
import CoreMotion
import Lynx
import UIKit

/// The native module behind the runtime's `LynxMotion`, which calls it as
/// `NativeModules.AngularLynxMotion` (from the background thread, where
/// NativeModules lives).
///
/// `start(sensor, interval)` runs a sensor, sampling every `interval`
/// milliseconds, or changes how often; `stop(sensor)` stops it; and
/// `availability` calls back with which sensors the phone has. The sensors
/// are `acceleration` (the accelerometer, in m/s² with gravity), `rotation`
/// (Core Motion's device motion rotation rate, in rad/s), `orientation`
/// (device motion's attitude, as a rotation matrix), `heading`
/// (`CLLocationManager`'s heading, which asks for no location permission)
/// and `shake`, which this module hears from the accelerometer itself, so a
/// shake costs the runtime one event rather than 50 samples a second.
///
/// The samples go to the runtime in the `angularLynxMotion` global event,
/// one object with a flat array of numbers for each sensor that sampled
/// (see `MotionBatch` in the runtime's motion.ts), at most once every 16 ms:
/// each event is work for Lynx's engine thread, where Angular runs. The
/// sensors stop while the app is in the background, and start again when it
/// comes back.
///
/// The generator leaves this file out of an app whose angular.json doesn't
/// set `motion`, and LynxViewController registers the module by its
/// Objective-C name only when it's there, hence the `@objc` name.
@objc(AngularLynxMotionModule)
final class MotionModule: NSObject, LynxContextModule, CLLocationManagerDelegate {
  static var name: String { "AngularLynxMotion" }

  static var methodLookup: [String: String] {
    [
      "start": NSStringFromSelector(#selector(start(_:interval:))),
      "stop": NSStringFromSelector(#selector(stop(_:))),
      "availability": NSStringFromSelector(#selector(availability(_:))),
    ]
  }

  static let event = "angularLynxMotion"
  /// The least time between events, about a frame.
  private static let flushInterval = 0.016
  /// How often the accelerometer samples for shakes: the runtime's
  /// `SHAKE.intervalMs`.
  private static let shakeInterval = 0.02

  private weak var context: LynxContext?
  /// Everything below belongs to this queue, and the sensors' handlers run
  /// on it. Lynx calls modules on threads of its own.
  private let queue = DispatchQueue(label: "dev.angularlynx.motion")
  private lazy var handlers: OperationQueue = {
    let operations = OperationQueue()
    operations.underlyingQueue = queue
    operations.maxConcurrentOperationCount = 1
    return operations
  }()
  private let manager = CMMotionManager()
  /// Made, started and stopped on the main thread, which its delegate
  /// methods are called on.
  private var locationManager: CLLocationManager?
  /// The interval each running sensor was started at, in seconds.
  private var requested: [String: TimeInterval] = [:]
  /// The intervals the hardware runs at now, to restart it only on a change.
  private var accelerometerInterval: TimeInterval?
  private var deviceMotionInterval: TimeInterval?
  private var headingOn = false
  /// When each sensor's last sample was kept, in milliseconds.
  private var lastSample: [String: Double] = [:]
  private var batch: [String: [Double]] = [:]
  private var flushScheduled = false
  private var lastFlush: TimeInterval = 0
  private var inBackground = false
  private var shakes = ShakeDetector()
  private var observers: [NSObjectProtocol] = []

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
    observeAppState()
  }

  init(lynxContext context: LynxContext, withParam param: Any) {
    self.context = context
    super.init()
    observeAppState()
  }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
  }

  /// The LynxView is going: nothing should keep the sensors on for it.
  func destroy() {
    queue.async {
      self.requested.removeAll()
      self.apply()
    }
  }

  @objc func start(_ sensor: String, interval: Double) {
    queue.async {
      // At least 5 ms, as the runtime asks: Core Motion's rates top out
      // near 100 Hz on most iPhones anyway.
      self.requested[sensor] = max(interval, 5) / 1000
      self.apply()
    }
  }

  @objc func stop(_ sensor: String) {
    queue.async {
      self.requested.removeValue(forKey: sensor)
      self.lastSample.removeValue(forKey: sensor)
      self.apply()
    }
  }

  /// Calls back with which sensors the phone has. The Simulator has none.
  @objc func availability(_ callback: @escaping LynxCallbackBlock) {
    callback([
      "acceleration": manager.isAccelerometerAvailable,
      "rotation": manager.isGyroAvailable && manager.isDeviceMotionAvailable,
      "orientation": manager.isDeviceMotionAvailable,
      "heading": CLLocationManager.headingAvailable(),
    ])
  }

  /// Stops the sensors while the app is in the background, where Lynx
  /// pauses the runtime and nobody sees what they'd measure.
  private func observeAppState() {
    let center = NotificationCenter.default
    observers = [
      center.addObserver(
        forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil
      ) { [weak self] _ in
        self?.queue.async {
          self?.inBackground = true
          self?.apply()
        }
      },
      center.addObserver(
        forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil
      ) { [weak self] _ in
        self?.queue.async {
          self?.inBackground = false
          self?.apply()
        }
      },
    ]
  }

  /// Runs each piece of hardware at the shortest interval anything asks of
  /// it, or stops it. On the queue.
  private func apply() {
    let wanted = inBackground ? [:] : requested

    // The accelerometer serves the acceleration and the shakes.
    var accelerometer = wanted["acceleration"]
    if wanted["shake"] != nil {
      accelerometer = min(accelerometer ?? Self.shakeInterval, Self.shakeInterval)
    }
    if accelerometer != accelerometerInterval {
      manager.stopAccelerometerUpdates()
      accelerometerInterval = accelerometer
      if let interval = accelerometer, manager.isAccelerometerAvailable {
        manager.accelerometerUpdateInterval = interval
        manager.startAccelerometerUpdates(to: handlers) { [weak self] data, _ in
          if let data { self?.accelerometer(data) }
        }
      }
    }

    // Device motion, which fuses the accelerometer and the gyroscope, serves
    // the rotation rate (without the gyroscope's drift) and the attitude.
    // Its yaw counts from where the phone faced when it started, without the
    // magnetometer, as Android's game rotation vector does.
    let motion = [wanted["rotation"], wanted["orientation"]].compactMap { $0 }.min()
    if motion != deviceMotionInterval {
      manager.stopDeviceMotionUpdates()
      deviceMotionInterval = motion
      if let interval = motion, manager.isDeviceMotionAvailable {
        manager.deviceMotionUpdateInterval = interval
        manager.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: handlers) {
          [weak self] data, _ in
          if let data { self?.deviceMotion(data) }
        }
      }
    }

    let heading = wanted["heading"] != nil
    if heading != headingOn {
      headingOn = heading
      DispatchQueue.main.async { self.setHeading(on: heading) }
    }
  }

  /// On the main thread, where CLLocationManager wants to be made and calls
  /// its delegate.
  private func setHeading(on: Bool) {
    guard CLLocationManager.headingAvailable() else { return }
    if on {
      let manager = locationManager ?? CLLocationManager()
      manager.delegate = self
      // A new heading for each degree it turns: the runtime throttles to the
      // watch's interval, and a phone held still reports nothing.
      manager.headingFilter = 1
      locationManager = manager
      manager.startUpdatingHeading()
    } else {
      locationManager?.stopUpdatingHeading()
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
    let t = newHeading.timestamp.timeIntervalSince1970 * 1000
    let magnetic = newHeading.magneticHeading
    // Negative when iOS doesn't know: true north needs the location, which
    // the app may not have access to, and the accuracy a calibrated compass.
    let trueHeading = newHeading.trueHeading >= 0 ? newHeading.trueHeading : -1
    let accuracy = newHeading.headingAccuracy >= 0 ? newHeading.headingAccuracy : -1
    queue.async {
      guard self.keep("heading", at: t) else { return }
      self.add("heading", [t, magnetic, trueHeading, accuracy])
    }
  }

  private func accelerometer(_ data: CMAccelerometerData) {
    let t = Self.milliseconds(data.timestamp)
    // Core Motion measures in g, and as the force on the phone: a phone
    // lying face up reads z = -1. The web and Android give the acceleration
    // in m/s² the other way round, z = 9.81, so the runtime gets the same on
    // both.
    let g = -9.80665
    let (x, y, z) = (data.acceleration.x * g, data.acceleration.y * g, data.acceleration.z * g)
    if requested["acceleration"] != nil, keep("acceleration", at: t) {
      add("acceleration", [t, x, y, z])
    }
    if requested["shake"] != nil, shakes.add(t, x, y, z) {
      add("shake", [t])
    }
  }

  private func deviceMotion(_ data: CMDeviceMotion) {
    let t = Self.milliseconds(data.timestamp)
    if requested["rotation"] != nil, keep("rotation", at: t) {
      let rate = data.rotationRate
      add("rotation", [t, rate.x, rate.y, rate.z])
    }
    if requested["orientation"] != nil, keep("orientation", at: t) {
      add("orientation", [t] + Self.deviceToEarth(data))
    }
  }

  /// The attitude as the matrix the runtime reads: the one that turns a
  /// vector in the phone's frame into the earth's, row by row, as Android's
  /// `getRotationMatrixFromVector` makes it. Its last row is the earth's up
  /// in the phone's frame, which is gravity turned around.
  ///
  /// Apple doesn't say which way `CMRotationMatrix` turns, so the matrix is
  /// taken as it is or transposed, whichever's last row points up as gravity
  /// says it should.
  private static func deviceToEarth(_ data: CMDeviceMotion) -> [Double] {
    let m = data.attitude.rotationMatrix
    let up = (-data.gravity.x, -data.gravity.y, -data.gravity.z)
    let asIs = [m.m11, m.m12, m.m13, m.m21, m.m22, m.m23, m.m31, m.m32, m.m33]
    let transposed = [m.m11, m.m21, m.m31, m.m12, m.m22, m.m32, m.m13, m.m23, m.m33]
    let dot = { (r: [Double]) in r[6] * up.0 + r[7] * up.1 + r[8] * up.2 }
    return dot(transposed) >= dot(asIs) ? transposed : asIs
  }

  /// Whether a sensor's sample at `t` is due, by the interval it was started
  /// at, allowing a little early for the sensor's jitter. Marks it kept.
  private func keep(_ sensor: String, at t: Double) -> Bool {
    guard let interval = requested[sensor] else { return false }
    if let last = lastSample[sensor], t - last < interval * 1000 * 0.75 { return false }
    lastSample[sensor] = t
    return true
  }

  /// Adds a sample to the next event, which goes at most every 16 ms.
  private func add(_ sensor: String, _ values: [Double]) {
    batch[sensor, default: []].append(contentsOf: values)
    guard !flushScheduled else { return }
    flushScheduled = true
    let wait = max(0, lastFlush + Self.flushInterval - ProcessInfo.processInfo.systemUptime)
    queue.asyncAfter(deadline: .now() + wait) { self.flush() }
  }

  private func flush() {
    flushScheduled = false
    lastFlush = ProcessInfo.processInfo.systemUptime
    guard !batch.isEmpty else { return }
    let sent = batch
    batch = [:]
    context?.sendGlobalEvent(Self.event, withParams: [sent])
  }

  /// A Core Motion timestamp (seconds since the phone started) in
  /// milliseconds since the epoch, as the runtime's `Date.now()` counts.
  private static func milliseconds(_ uptime: TimeInterval) -> Double {
    (Date().timeIntervalSince1970 - ProcessInfo.processInfo.systemUptime + uptime) * 1000
  }
}

/// Hears a shake in accelerometer samples: the runtime's `ShakeDetector`
/// (`motion/motion-math.ts`), after Square's Seismic. A sample accelerates
/// past 13 m/s², and the phone is shaking when three quarters of the samples
/// of the last half second do, over a quarter of a second or more.
private struct ShakeDetector {
  private var samples: [(t: Double, accelerating: Bool)] = []
  private var accelerating = 0
  private var quietUntil = -Double.infinity

  mutating func add(_ t: Double, _ x: Double, _ y: Double, _ z: Double) -> Bool {
    let fast = x * x + y * y + z * z > 13 * 13
    samples.append((t, fast))
    if fast { accelerating += 1 }
    while let first = samples.first, first.t < t - 500 {
      if samples.removeFirst().accelerating { accelerating -= 1 }
    }
    if t < quietUntil { return false }
    guard let first = samples.first, samples.count >= 4, t - first.t >= 250,
      accelerating * 4 >= samples.count * 3
    else { return false }
    samples.removeAll()
    accelerating = 0
    quietUntil = t + 750
    return true
  }
}
