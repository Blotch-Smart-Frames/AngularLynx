import {
  DestroyRef,
  ErrorHandler,
  inject,
  Injectable,
  type Injector,
  type Signal,
  signal,
} from '@angular/core';
import { callOnBackground } from '../background-call';
import { LynxNativeModule } from '../native-module/native-module';
import { base64ToBytes, bytesToBase64 } from '../network/base64';

/**
 * The native module of the apps `ng build --platform` makes
 * (`BluetoothModule.swift` and `BluetoothModule.kt` in
 * `packages/native/templates`), present only when angular.json's
 * `permissions` list `bluetooth`.
 */
const BLUETOOTH_MODULE = 'AngularLynxBluetooth';

/**
 * The global event those apps send for everything that happens on its own:
 * the radio's state, sightings, notifications and dropped connections. Its
 * one parameter is an object whose `type` says which.
 */
const BLUETOOTH_EVENT = 'angularLynxBluetooth';

/**
 * The Bluetooth base UUID's tail, which a 16- or 32-bit UUID is short for.
 */
const BASE_UUID_TAIL = '-0000-1000-8000-00805f9b34fb';

/**
 * How long {@link LynxBluetooth.connect} waits by default. A peripheral in
 * range answers within a second or two; one that's gone never does, and
 * neither platform gives up on its own (Android waits about 30 seconds, iOS
 * forever).
 */
const DEFAULT_CONNECT_TIMEOUT = 10_000;

const UNAVAILABLE_MESSAGE =
  "This host has no Bluetooth. Only the apps `ng build --platform` makes have it, and only when angular.json's `permissions` list `bluetooth`.";

/**
 * Where Bluetooth stands on this device:
 * - `unknown`: not known yet, including when the person hasn't been asked
 *   for permission ({@link LynxBluetooth.requestPermission} asks).
 * - `resetting`: the system's Bluetooth service is restarting.
 * - `unsupported`: the device has no Bluetooth LE radio, such as the iOS
 *   Simulator, or the host has no Bluetooth at all, such as Lynx Explorer.
 * - `unauthorized`: the person refused, or a policy forbids it.
 * - `poweredOff`: Bluetooth is turned off.
 * - `poweredOn`: ready to scan and connect.
 */
export type BluetoothState =
  | 'unknown'
  | 'resetting'
  | 'unsupported'
  | 'unauthorized'
  | 'poweredOff'
  | 'poweredOn';

/**
 * Why a Bluetooth call failed:
 * - `unavailable`: the host has no Bluetooth module (see
 *   {@link LynxBluetooth}).
 * - `unsupported`, `unauthorized`, `poweredOff`: as the
 *   {@link BluetoothState} of the same name.
 * - `notFound`: no device has that id, or the connected device has no such
 *   service or characteristic.
 * - `notConnected`: the connection has ended.
 * - `timeout`: the device didn't answer in time.
 * - `busy`: the platform is already doing something it does one at a time.
 * - `failed`: anything else; the message has the platform's reason.
 */
export type BluetoothErrorCode =
  | 'unavailable'
  | 'unsupported'
  | 'unauthorized'
  | 'poweredOff'
  | 'notFound'
  | 'notConnected'
  | 'timeout'
  | 'busy'
  | 'failed';

/**
 * The codes the shells send. A code a newer shell sends that this runtime
 * doesn't know reads as `failed`, so an app's `switch` on the code stays
 * complete.
 */
const NATIVE_ERROR_CODES: ReadonlySet<string> = new Set<BluetoothErrorCode>([
  'unsupported',
  'unauthorized',
  'poweredOff',
  'notFound',
  'notConnected',
  'timeout',
  'busy',
  'failed',
]);

/** The error {@link LynxBluetooth} and its connections reject with. */
export class BluetoothError extends Error {
  constructor(
    readonly code: BluetoothErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BluetoothError';
  }
}

/**
 * A UUID as every Bluetooth call takes and gives it: 128 bits, lowercase,
 * with hyphens. A 16- or 32-bit UUID, as the Bluetooth specifications give
 * the standard services (`180f` for Battery), stands for one on the
 * Bluetooth base UUID, as Web Bluetooth's `BluetoothUUID.canonicalUUID()`
 * reads it.
 *
 * Compare a UUID from a sighting or a connection with this, since the
 * platforms spell them differently.
 *
 * @throws TypeError - When `uuid` is none of those.
 */
export const canonicalBluetoothUUID = (uuid: string): string => {
  const text = String(uuid).toLowerCase();
  if (/^[0-9a-f]{4}$/.test(text)) return `0000${text}${BASE_UUID_TAIL}`;
  if (/^[0-9a-f]{8}$/.test(text)) return `${text}${BASE_UUID_TAIL}`;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text)
  ) {
    return text;
  }
  throw new TypeError(
    `"${uuid}" is not a Bluetooth UUID: give 4 or 8 hex digits, or a full 128-bit UUID.`,
  );
};

/** What {@link LynxBluetooth.scan} looks for. */
export type BluetoothScanOptions = {
  /**
   * Only devices advertising at least one of these services. Leave it out
   * to see every device advertising nearby, which on a busy street is a lot
   * of them.
   */
  readonly services?: readonly string[];
  /** Only devices whose advertised name starts with this. */
  readonly namePrefix?: string;
};

/** A device a scan saw, as of its latest advertisement. */
export type BluetoothDevice = {
  /**
   * What {@link LynxBluetooth.connect} takes. On iOS it's a UUID the system
   * makes up for this app, the same each time it sees the device; on Android
   * it's the device's Bluetooth address.
   */
  readonly id: string;
  /** The name it advertises, or null when it advertises none. */
  readonly name: string | null;
  /** Its signal strength, in dBm: closer to 0 is nearer. */
  readonly rssi: number;
  /** The services it advertises, as {@link canonicalBluetoothUUID} spells them. */
  readonly services: readonly string[];
  /** The data it advertises for a service, by the service's UUID. */
  readonly serviceData: ReadonlyMap<string, Uint8Array>;
  /**
   * The data it advertises for a manufacturer, by the company identifier the
   * Bluetooth SIG assigned it, without the identifier's two bytes.
   */
  readonly manufacturerData: ReadonlyMap<number, Uint8Array>;
};

/** A scan {@link LynxBluetooth.scan} started. */
export type BluetoothScan = {
  /** Whether it's still running. */
  readonly scanning: Signal<boolean>;
  /**
   * Why it ended on its own, such as Bluetooth being turned off, or
   * undefined while it runs or once {@link stop} ended it.
   */
  readonly error: Signal<BluetoothError | undefined>;
  /** Ends it. Ending one that has ended does nothing. */
  stop(): Promise<void>;
};

/** What a characteristic lets a connection do with it. */
export type BluetoothCharacteristicProperty =
  | 'read'
  | 'write'
  | 'writeWithoutResponse'
  | 'notify'
  | 'indicate';

/** A characteristic a connected device has. */
export type BluetoothCharacteristic = {
  readonly uuid: string;
  readonly properties: readonly BluetoothCharacteristicProperty[];
};

/** A service a connected device has, with its characteristics. */
export type BluetoothService = {
  readonly uuid: string;
  readonly characteristics: readonly BluetoothCharacteristic[];
};

/** How {@link BluetoothConnection.write} writes. */
export type BluetoothWriteOptions = {
  /**
   * Whether to wait for the device to confirm it (the default), which takes
   * up to 512 bytes. Without, the write is quicker but takes at most
   * {@link BluetoothConnection.maxWriteLength} bytes, and a lost one is
   * lost: use it only on a characteristic with `writeWithoutResponse`.
   */
  readonly withResponse?: boolean;
};

/** How {@link LynxBluetooth.connect} connects. */
export type BluetoothConnectOptions = {
  /** How long to wait for the device, in milliseconds. */
  readonly timeout?: number;
};

/**
 * A connection to a device, from {@link LynxBluetooth.connect}. Its
 * services and characteristics are all discovered before it's handed over.
 */
export type BluetoothConnection = {
  readonly id: string;
  readonly name: string | null;
  readonly services: readonly BluetoothService[];
  /**
   * The most bytes one write without response carries, which the two sides
   * agree as they connect.
   */
  readonly maxWriteLength: number;
  /**
   * Whether it's still connected: it turns false when the device goes out
   * of range or switches off, and after {@link disconnect}.
   */
  readonly connected: Signal<boolean>;
  /** Reads a characteristic's value. */
  read(service: string, characteristic: string): Promise<Uint8Array>;
  /** Writes a characteristic's value. */
  write(
    service: string,
    characteristic: string,
    value: Uint8Array,
    options?: BluetoothWriteOptions,
  ): Promise<void>;
  /**
   * Calls `listener` with each value the characteristic notifies or
   * indicates, from when the promise resolves. Resolves with a function
   * that stops it; the device stops sending once the last listener of the
   * characteristic stops.
   */
  subscribe(
    service: string,
    characteristic: string,
    listener: (value: Uint8Array) => void,
  ): Promise<() => Promise<void>>;
  /** Ends the connection. Ending one that has ended does nothing. */
  disconnect(): Promise<void>;
};

type NativeError = { readonly error?: string; readonly message?: string };

type NativeDevice = {
  readonly id: string;
  readonly name?: string | null;
  readonly rssi: number;
  readonly services: readonly string[];
  readonly serviceData: Readonly<Record<string, string>>;
  readonly manufacturerData: Readonly<Record<string, string>>;
};

type NativeConnection = {
  readonly id: string;
  readonly name?: string | null;
  readonly maxWriteLength: number;
  readonly services: readonly BluetoothService[];
};

type NativeEvent =
  | { readonly type: 'state'; readonly state: string }
  | { readonly type: 'device'; readonly device: NativeDevice }
  | ({ readonly type: 'scanStopped' } & NativeError)
  | ({ readonly type: 'disconnected'; readonly id: string } & NativeError)
  | {
      readonly type: 'value';
      readonly id: string;
      readonly service: string;
      readonly characteristic: string;
      readonly value: string;
    };

type GlobalEventEmitter = {
  addListener(name: string, listener: (event: NativeEvent) => void): unknown;
};

const toError = (code: string, message: string | undefined): BluetoothError =>
  new BluetoothError(
    NATIVE_ERROR_CODES.has(code) ? (code as BluetoothErrorCode) : 'failed',
    message ?? 'Bluetooth failed.',
  );

/**
 * Calls the shells' Bluetooth module, which answers through a callback on
 * the background thread, where `NativeModules` lives (see
 * callNativeModuleAsync in background-call.ts).
 */
const callModule = async <T extends object>(
  method: string,
  args: readonly unknown[],
): Promise<T> => {
  let result: (T & NativeError) | undefined;
  try {
    result = (await callOnBackground(
      'callNativeModuleAsync',
      BLUETOOTH_MODULE,
      method,
      [...args],
    )) as (T & NativeError) | undefined;
  } catch {
    throw new BluetoothError('unavailable', UNAVAILABLE_MESSAGE);
  }
  if (result?.error !== undefined) throw toError(result.error, result.message);
  return result as T;
};

const STATES: ReadonlySet<string> = new Set<BluetoothState>([
  'unknown',
  'resetting',
  'unsupported',
  'unauthorized',
  'poweredOff',
  'poweredOn',
]);

const toState = (state: string): BluetoothState =>
  STATES.has(state) ? (state as BluetoothState) : 'unknown';

const toDevice = (device: NativeDevice): BluetoothDevice => ({
  id: device.id,
  name: device.name ?? null,
  rssi: device.rssi,
  services: device.services.map(canonicalBluetoothUUID),
  serviceData: new Map(
    Object.entries(device.serviceData).map(([uuid, data]) => [
      canonicalBluetoothUUID(uuid),
      base64ToBytes(data),
    ]),
  ),
  manufacturerData: new Map(
    Object.entries(device.manufacturerData).map(([company, data]) => [
      Number(company),
      base64ToBytes(data),
    ]),
  ),
});

/**
 * The DestroyRef of whatever is being constructed, or null outside an
 * injection context. Angular has no public check for one, and `inject()`
 * throws outside it.
 */
const currentDestroyRef = (): DestroyRef | null => {
  try {
    return inject(DestroyRef);
  } catch {
    return null;
  }
};

/** One characteristic's listeners, and the call that started its values. */
type Subscription = {
  readonly listeners: Set<(value: Uint8Array) => void>;
  readonly started: Promise<void>;
};

class Connection implements BluetoothConnection {
  readonly id: string;
  readonly name: string | null;
  readonly services: readonly BluetoothService[];
  readonly maxWriteLength: number;
  readonly #connected = signal(true);
  readonly connected = this.#connected.asReadonly();
  readonly #subscriptions = new Map<string, Subscription>();
  readonly #errorHandler: ErrorHandler;
  readonly #ended: () => void;

  /**
   * @param ended - Called once, as it ends. It's the connection its service
   *   holds for the id until then, since only one is open per device.
   */
  constructor(
    native: NativeConnection,
    errorHandler: ErrorHandler,
    ended: () => void,
  ) {
    this.id = native.id;
    this.name = native.name ?? null;
    this.maxWriteLength = native.maxWriteLength;
    // Spelled the way callers' canonical UUIDs are, so they can find theirs.
    this.services = native.services.map((service) => ({
      uuid: canonicalBluetoothUUID(service.uuid),
      characteristics: service.characteristics.map((characteristic) => ({
        uuid: canonicalBluetoothUUID(characteristic.uuid),
        properties: characteristic.properties,
      })),
    }));
    this.#errorHandler = errorHandler;
    this.#ended = ended;
  }

  async read(service: string, characteristic: string): Promise<Uint8Array> {
    const { value } = await this.#call<{ value: string }>('read', [
      canonicalBluetoothUUID(service),
      canonicalBluetoothUUID(characteristic),
    ]);
    return base64ToBytes(value);
  }

  async write(
    service: string,
    characteristic: string,
    value: Uint8Array,
    options?: BluetoothWriteOptions,
  ): Promise<void> {
    await this.#call('write', [
      canonicalBluetoothUUID(service),
      canonicalBluetoothUUID(characteristic),
      bytesToBase64(value),
      options?.withResponse ?? true,
    ]);
  }

  async subscribe(
    service: string,
    characteristic: string,
    listener: (value: Uint8Array) => void,
  ): Promise<() => Promise<void>> {
    const serviceUUID = canonicalBluetoothUUID(service);
    const characteristicUUID = canonicalBluetoothUUID(characteristic);
    const key = `${serviceUUID} ${characteristicUUID}`;
    let subscription = this.#subscriptions.get(key);
    if (!subscription) {
      const started = this.#call('setNotifications', [
        serviceUUID,
        characteristicUUID,
        true,
      ]).then(() => undefined);
      const created: Subscription = { listeners: new Set(), started };
      subscription = created;
      this.#subscriptions.set(key, created);
      // A refused start leaves nothing behind, so the next subscribe asks
      // again.
      started.catch(() => {
        if (this.#subscriptions.get(key) === created) {
          this.#subscriptions.delete(key);
        }
      });
    }
    const { listeners, started } = subscription;
    await started;
    /**
     * An entry of its own, so the same listener subscribed twice gets two
     * that each stop separately.
     */
    const entry = (value: Uint8Array) => listener(value);
    listeners.add(entry);
    return async () => {
      if (!listeners.delete(entry) || listeners.size > 0) return;
      this.#subscriptions.delete(key);
      if (!this.connected()) return;
      await this.#call('setNotifications', [
        serviceUUID,
        characteristicUUID,
        false,
      ]);
    };
  }

  async disconnect(): Promise<void> {
    if (!this.connected()) return;
    this.end();
    await callModule('disconnect', [this.id]);
  }

  /**
   * Hands a value the device sent to the characteristic's listeners.
   */
  receive(service: string, characteristic: string, value: Uint8Array): void {
    const key = `${canonicalBluetoothUUID(service)} ${canonicalBluetoothUUID(characteristic)}`;
    // A listener may stop itself as it's called: a Set skips what was
    // removed and carries on.
    for (const listener of this.#subscriptions.get(key)?.listeners ?? []) {
      // One listener's error mustn't keep the value from the others.
      try {
        listener(value);
      } catch (error) {
        this.#errorHandler.handleError(error);
      }
    }
  }

  /**
   * Marks it ended, whether it was asked to end or the device went.
   */
  end(): void {
    this.#connected.set(false);
    this.#subscriptions.clear();
    this.#ended();
  }

  /**
   * Calls a method of the module that takes the connection's id first.
   * A connection known to have ended fails without asking the shell.
   */
  #call<T extends object>(method: string, args: readonly unknown[]) {
    if (!this.connected()) {
      return Promise.reject(
        new BluetoothError('notConnected', 'The connection has ended.'),
      );
    }
    return callModule<T>(method, [this.id, ...args]);
  }
}

class Scan implements BluetoothScan {
  readonly #scanning = signal(true);
  readonly scanning = this.#scanning.asReadonly();
  readonly #error = signal<BluetoothError | undefined>(undefined);
  readonly error = this.#error.asReadonly();
  readonly #ended: () => void;
  #unregister?: () => void;

  constructor(
    readonly options: BluetoothScanOptions & { readonly services: string[] },
    readonly onDevice: (device: BluetoothDevice) => void,
    ended: () => void,
  ) {
    this.#ended = ended;
  }

  /**
   * Ties it to a DestroyRef, which stops it.
   */
  stopOnDestroy(destroyRef: DestroyRef | null): void {
    this.#unregister = destroyRef?.onDestroy(() => void this.stop());
  }

  async stop(): Promise<void> {
    if (!this.end()) return;
    await callModule('stopScan', []);
  }

  /**
   * Marks it ended, with the reason when it ended on its own.
   *
   * @returns Whether it was running.
   */
  end(error?: BluetoothError): boolean {
    if (!this.scanning()) return false;
    this.#scanning.set(false);
    this.#error.set(error);
    // Stopped by hand, the scan also leaves the DestroyRef, which would
    // otherwise keep it, and what its listener holds, until a long-lived
    // injector goes.
    this.#unregister?.();
    this.#ended();
    return true;
  }
}

/**
 * Finds Bluetooth LE devices nearby and talks to them as a GATT client: the
 * part of Web Bluetooth an app needs to set up or control an accessory, such
 * as handing a smart device the Wi-Fi password.
 *
 * - **iOS:** Core Bluetooth. iOS asks the person the first time the app uses
 *   Bluetooth, with angular.json's `permissions.bluetooth` reason.
 * - **Android:** `android.bluetooth`. Android 12 and later ask for "Nearby
 *   devices"; earlier versions ask for location, which scanning needed then.
 * - **Testing library:** devices a spec adds with `addBluetoothDevice()`.
 *
 * Only the apps `ng build --platform` makes have it, and only when
 * angular.json's `permissions` list `bluetooth`: without it the app ships no
 * Bluetooth code, since App Store Connect rejects an app whose code uses
 * Bluetooth without saying why. Elsewhere, such as Lynx Explorer or the web
 * preview, the {@link state} is `unsupported` and every call rejects with a
 * {@link BluetoothError} whose code is `unavailable`.
 *
 * It's foreground only: a scan and its connections stop when the app goes.
 *
 * @usageNotes
 * ```typescript
 * const bluetooth = inject(LynxBluetooth);
 *
 * const scan = await bluetooth.scan({ services: [SETUP_SERVICE] }, (device) =>
 *   this.found.update((found) => new Map(found).set(device.id, device)),
 * );
 * // …the person picks one…
 * await scan.stop();
 * const frame = await bluetooth.connect(device.id);
 * await frame.write(SETUP_SERVICE, CREDENTIALS, bytes);
 * const stop = await frame.subscribe(SETUP_SERVICE, STATUS, (value) =>
 *   this.status.set(decode(value)),
 * );
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LynxBluetooth {
  readonly #errorHandler = inject(ErrorHandler);
  readonly #state = signal<BluetoothState>('unknown');
  /**
   * Where Bluetooth stands, kept up to date as the person turns it on or
   * off or answers the permission prompt. Reading it never asks for
   * permission.
   */
  readonly state = this.#state.asReadonly();
  readonly #connections = new Map<string, Connection>();
  readonly #connecting = new Map<string, Promise<BluetoothConnection>>();
  #scan?: Scan;

  constructor() {
    // On the main thread, where Angular runs, the emitter is a proxy whose
    // calls go through the background thread and return promises. Listening
    // first means a change between the two calls isn't missed.
    const emitter =
      inject(LynxNativeModule).getJSModule<GlobalEventEmitter>(
        'GlobalEventEmitter',
      );
    void Promise.resolve()
      .then(() =>
        emitter?.addListener(BLUETOOTH_EVENT, (event) => this.#receive(event)),
      )
      .catch(() => {
        // Without a background thread there are no global events to hear.
      })
      .then(() => callModule<{ state: string }>('getState', []))
      .then(
        ({ state }) => this.#state.set(toState(state)),
        () => this.#state.set('unsupported'),
      );
  }

  /**
   * Asks the person for permission to use Bluetooth, if they haven't been
   * asked, and resolves with the {@link state} after they answer. Once they've
   * refused, the system doesn't ask again: the state stays `unauthorized`
   * until they allow it in Settings.
   *
   * {@link scan} and {@link connect} ask by themselves. Call this first to
   * ask at a moment of the app's choosing, such as after a screen that says
   * what Bluetooth is for.
   */
  async requestPermission(): Promise<BluetoothState> {
    const { state } = await callModule<{ state: string }>(
      'requestPermission',
      [],
    );
    this.#state.set(toState(state));
    return this.state();
  }

  /**
   * Looks for devices advertising nearby, and calls `onDevice` with each one
   * the first time it's seen and then about once a second while it's in
   * range, as its signal strength changes. Resolves once the scan has
   * started.
   *
   * One scan runs at a time: starting another ends this one. Called from an
   * injection context, such as a constructor, the scan stops when the
   * component or service is destroyed; pass an `injector` to tie it to
   * another one.
   *
   * Scanning drains the battery: stop the scan once the device is found.
   */
  async scan(
    options: BluetoothScanOptions,
    onDevice: (device: BluetoothDevice) => void,
    config?: { readonly injector?: Injector },
  ): Promise<BluetoothScan> {
    // Read before anything waits: the injection context ends at the first
    // await.
    const destroyRef = config?.injector?.get(DestroyRef) ?? currentDestroyRef();
    const scan = new Scan(
      {
        ...options,
        services: (options.services ?? []).map(canonicalBluetoothUUID),
      },
      onDevice,
      // A scan ends before another takes its place, so the one ending is
      // always the one running.
      () => (this.#scan = undefined),
    );
    // The shells replace a running scan with the new one themselves.
    this.#scan?.end();
    // Before the call, so sightings that arrive before it answers are kept.
    this.#scan = scan;
    try {
      await callModule('startScan', [{ services: scan.options.services }]);
    } catch (error) {
      scan.end();
      throw error;
    }
    scan.stopOnDestroy(destroyRef);
    return scan;
  }

  /**
   * Connects to a device a scan saw, and discovers its services and
   * characteristics. Connecting to a device that's connected resolves with
   * the connection it has.
   */
  connect(
    id: string,
    options?: BluetoothConnectOptions,
  ): Promise<BluetoothConnection> {
    const open = this.#connections.get(id);
    if (open) return Promise.resolve(open);
    const connecting =
      this.#connecting.get(id) ??
      callModule<NativeConnection>('connect', [
        id,
        { timeout: options?.timeout ?? DEFAULT_CONNECT_TIMEOUT },
      ])
        .then((native) => {
          const connection = new Connection(native, this.#errorHandler, () =>
            this.#connections.delete(id),
          );
          this.#connections.set(id, connection);
          return connection;
        })
        .finally(() => this.#connecting.delete(id));
    this.#connecting.set(id, connecting);
    return connecting;
  }

  #receive(event: NativeEvent): void {
    switch (event.type) {
      case 'state':
        this.#state.set(toState(event.state));
        break;
      case 'device':
        this.#sighted(toDevice(event.device));
        break;
      case 'scanStopped':
        this.#scan?.end(
          event.error === undefined
            ? undefined
            : toError(event.error, event.message),
        );
        break;
      case 'disconnected':
        this.#connections.get(event.id)?.end();
        break;
      case 'value':
        this.#connections
          .get(event.id)
          ?.receive(
            event.service,
            event.characteristic,
            base64ToBytes(event.value),
          );
        break;
    }
  }

  #sighted(device: BluetoothDevice): void {
    const scan = this.#scan;
    if (!scan) return;
    const prefix = scan.options.namePrefix;
    // Neither platform's scan filter takes a prefix, so it's checked here.
    if (prefix !== undefined && !device.name?.startsWith(prefix)) return;
    try {
      scan.onDevice(device);
    } catch (error) {
      this.#errorHandler.handleError(error);
    }
  }
}
