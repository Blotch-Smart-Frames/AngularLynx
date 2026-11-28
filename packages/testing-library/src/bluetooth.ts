import type {
  BluetoothCharacteristicProperty,
  BluetoothState,
} from '@blotch/angular-lynx';

/** What `LynxBluetooth` calls and hears, named as the shells name them. */
const MODULE = 'AngularLynxBluetooth';
const EVENT = 'angularLynxBluetooth';

/** A characteristic of a {@link FakeBluetoothDevice}. */
export type FakeBluetoothCharacteristic = {
  /** What it lets a connection do. By default it can be read, written and notified. */
  readonly properties?: readonly BluetoothCharacteristicProperty[];
  /** What a read gets. Change it to change what the next read gets. */
  value?: Uint8Array;
  /**
   * Called with each value the app writes, and the device, so a spec can
   * answer the way the real device does, such as notifying a status.
   */
  readonly onWrite?: (
    value: Uint8Array,
    device: FakeBluetoothDeviceRef,
  ) => void;
};

/** A device {@link addBluetoothDevice} puts in range of the app. */
export type FakeBluetoothDevice = {
  /** What `LynxBluetooth.connect()` takes. */
  readonly id: string;
  readonly name?: string | null;
  /** Its signal strength, in dBm. */
  readonly rssi?: number;
  /**
   * The services it advertises, which a scan matches against. By default,
   * every service in {@link services}.
   */
  readonly advertisedServices?: readonly string[];
  /** The data it advertises for a service, by the service's UUID. */
  readonly serviceData?: Readonly<Record<string, Uint8Array>>;
  /** The data it advertises for a manufacturer, by company identifier. */
  readonly manufacturerData?: Readonly<Record<number, Uint8Array>>;
  /** Its services: each service's characteristics, by UUID. */
  readonly services?: Readonly<
    Record<string, Readonly<Record<string, FakeBluetoothCharacteristic>>>
  >;
  /**
   * The most bytes one write without response carries. A longer one is
   * refused, as the shells refuse it, so a spec catches an app that doesn't
   * split what it writes.
   */
  readonly maxWriteLength?: number;
};

/** A value the app wrote to a {@link FakeBluetoothDevice}. */
export type FakeBluetoothWrite = {
  readonly service: string;
  readonly characteristic: string;
  readonly value: Uint8Array;
  readonly withResponse: boolean;
};

/** What {@link addBluetoothDevice} gives a spec to drive the device with. */
export type FakeBluetoothDeviceRef = {
  /** Whether the app is connected to it. */
  readonly connected: boolean;
  /** What the app wrote to it, oldest first. */
  readonly writes: readonly FakeBluetoothWrite[];
  /**
   * Sends a value from a characteristic, as a notification. It reaches the
   * app only while it's connected and subscribed to the characteristic.
   */
  notify(service: string, characteristic: string, value: Uint8Array): void;
  /** Ends the app's connection from the device's side, as going out of range does. */
  disconnect(): void;
};

type Done = (result: object) => void;

type Device = {
  readonly spec: FakeBluetoothDevice;
  readonly ref: FakeBluetoothDeviceRef;
  readonly writes: FakeBluetoothWrite[];
  readonly subscribed: Set<string>;
  connected: boolean;
};

type FakeBluetoothModule = {
  state: BluetoothState;
  readonly devices: Map<string, Device>;
  /**
   * The running scan, with the id the runtime tags it with and the services
   * it looks for, or null while none runs.
   */
  scanning: { readonly id: number; readonly services: string[] } | null;
  getState(done: Done): void;
  requestPermission(done: Done): void;
  startScan(options: { services: string[]; scan: number }, done: Done): void;
  stopScan(done: Done): void;
  connect(id: string, options: unknown, done: Done): void;
  disconnect(id: string, done: Done): void;
  read(id: string, service: string, characteristic: string, done: Done): void;
  write(
    id: string,
    service: string,
    characteristic: string,
    value: string,
    withResponse: boolean,
    done: Done,
  ): void;
  setNotifications(
    id: string,
    service: string,
    characteristic: string,
    enabled: boolean,
    done: Done,
  ): void;
};

type Emitter = { emit(name: string, args: unknown[]): void };

type BackgroundGlobals = {
  NativeModules?: Record<string, unknown>;
  lynx?: { getJSModule(name: string): Emitter | undefined };
};

/** The part of `@lynx-js/testing-environment`'s environment this uses. */
type TestingEnvironment = {
  readonly backgroundThread: { readonly globalThis: BackgroundGlobals };
  switchToBackgroundThread(): void;
  switchToMainThread(): void;
};

const DEFAULT_PROPERTIES: readonly BluetoothCharacteristicProperty[] = [
  'read',
  'write',
  'notify',
];

/** A device's write-without-response limit when the spec gives none. */
const DEFAULT_MAX_WRITE_LENGTH = 182;

/** The longest attribute value, and so write with a response, ATT allows. */
const MAX_ATTRIBUTE_LENGTH = 512;

const BASE_UUID_TAIL = '-0000-1000-8000-00805f9b34fb';

/**
 * A UUID as the runtime sends and expects them, so a spec can name a
 * service either way.
 */
const canonical = (uuid: string): string => {
  const text = uuid.toLowerCase();
  if (text.length === 4) return `0000${text}${BASE_UUID_TAIL}`;
  if (text.length === 8) return `${text}${BASE_UUID_TAIL}`;
  return text;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));

const failure = (error: string, message: string) => ({ error, message });

/**
 * Why the radio can't be used in `state`, as the error the shells give, or
 * undefined when it's on.
 */
const unusable = (state: BluetoothState) => {
  if (state === 'poweredOn') return undefined;
  const code =
    state === 'unsupported' ||
    state === 'unauthorized' ||
    state === 'poweredOff'
      ? state
      : 'failed';
  return failure(code, `Bluetooth is ${state}.`);
};

const environment = (): TestingEnvironment | undefined =>
  (globalThis as any).lynxTestingEnv;

/**
 * Sends one of the shells' global events. They arrive on the background
 * thread, whose listener calls the app's on the main thread, so the event is
 * sent from it. A fake method the runtime called is on that thread already;
 * a spec is on the main thread, which comes back afterwards.
 */
const emit = (payload: object): void => {
  const env = environment()!;
  const background = env.backgroundThread.globalThis;
  const onMainThread =
    (globalThis as BackgroundGlobals).lynx !== background.lynx;
  if (onMainThread) env.switchToBackgroundThread();
  try {
    background.lynx!.getJSModule('GlobalEventEmitter')!.emit(EVENT, [payload]);
  } finally {
    if (onMainThread) env.switchToMainThread();
  }
};

/**
 * The most bytes a write without response to `device` carries: never more
 * than an attribute holds, as the shells cap it however large the MTU.
 */
const maxWriteLength = (device: FakeBluetoothDevice): number =>
  Math.min(
    device.maxWriteLength ?? DEFAULT_MAX_WRITE_LENGTH,
    MAX_ATTRIBUTE_LENGTH,
  );

const sighting = (device: FakeBluetoothDevice, scan: number) => ({
  type: 'device',
  scan,
  device: {
    id: device.id,
    name: device.name ?? null,
    rssi: device.rssi ?? -50,
    services: advertised(device),
    serviceData: Object.fromEntries(
      Object.entries(device.serviceData ?? {}).map(([uuid, data]) => [
        canonical(uuid),
        toBase64(data),
      ]),
    ),
    manufacturerData: Object.fromEntries(
      Object.entries(device.manufacturerData ?? {}).map(([company, data]) => [
        company,
        toBase64(data),
      ]),
    ),
  },
});

const advertised = (device: FakeBluetoothDevice): string[] =>
  (device.advertisedServices ?? Object.keys(device.services ?? {})).map(
    canonical,
  );

const matches = (device: FakeBluetoothDevice, services: string[]): boolean =>
  services.length === 0 ||
  advertised(device).some((uuid) => services.includes(uuid));

/**
 * The characteristic a call names, by the runtime's canonical UUIDs.
 */
const characteristicOf = (
  device: FakeBluetoothDevice,
  service: string,
  characteristic: string,
): FakeBluetoothCharacteristic | undefined => {
  const services = Object.entries(device.services ?? {});
  const characteristics = services.find(
    ([uuid]) => canonical(uuid) === service,
  )?.[1];
  return Object.entries(characteristics ?? {}).find(
    ([uuid]) => canonical(uuid) === characteristic,
  )?.[1];
};

/**
 * Gives the environment's background thread an `AngularLynxBluetooth`
 * module, as the apps `ng build --platform` makes have when angular.json's
 * `permissions` list `bluetooth`. The devices in range are the ones
 * {@link addBluetoothDevice} adds, and the radio is on and allowed until
 * {@link setBluetoothState} says otherwise. `LynxBluetooth` reaches it
 * through the background thread, as it reaches the shells' module, so specs
 * see the runtime's own behavior.
 *
 * It runs each time the environment injects the background thread's
 * globals: when it's created, and on the reset after each test, so each test
 * starts with no devices and the radio on.
 */
export const installBluetoothModule = (threadGlobals: {
  NativeModules?: Record<string, unknown>;
}): void => {
  const devices = new Map<string, Device>();
  const connectedDevice = (id: string, done: Done) => {
    const device = devices.get(id);
    if (device?.connected) return device;
    done(failure('notConnected', `${id} isn't connected.`));
    return undefined;
  };
  /**
   * The characteristic of a connected device a call names, if it can do
   * `property`; otherwise calls back with why not.
   */
  const usable = (
    id: string,
    service: string,
    characteristic: string,
    properties: readonly BluetoothCharacteristicProperty[],
    done: Done,
  ) => {
    const device = connectedDevice(id, done);
    if (!device) return undefined;
    const found = characteristicOf(device.spec, service, characteristic);
    if (!found) {
      done(
        failure('notFound', `${id} has no characteristic ${characteristic}.`),
      );
      return undefined;
    }
    const allowed = found.properties ?? DEFAULT_PROPERTIES;
    if (!properties.some((property) => allowed.includes(property))) {
      done(
        failure(
          'failed',
          `${characteristic} can't ${properties.join(' or ')}.`,
        ),
      );
      return undefined;
    }
    return { device, characteristic: found };
  };
  /**
   * Asks the person for permission when they haven't been asked, as the
   * shells do before the first scan or connection: they allow it, unless a
   * spec said otherwise.
   */
  const ask = () => {
    if (module.state !== 'unknown') return;
    module.state = 'poweredOn';
    emit({ type: 'state', state: module.state });
  };
  const module: FakeBluetoothModule = {
    state: 'poweredOn',
    devices,
    scanning: null,
    getState: (done) => done({ state: module.state }),
    requestPermission: (done) => {
      ask();
      done({ state: module.state });
    },
    startScan: ({ services, scan }, done) => {
      ask();
      const error = unusable(module.state);
      if (error) return done(error);
      module.scanning = { id: scan, services };
      done({});
      for (const { spec } of devices.values()) {
        if (matches(spec, services)) emit(sighting(spec, scan));
      }
    },
    stopScan: (done) => {
      module.scanning = null;
      done({});
    },
    connect: (id, _options, done) => {
      ask();
      const error = unusable(module.state);
      if (error) return done(error);
      const device = devices.get(id);
      if (!device) return done(failure('notFound', `No device is ${id}.`));
      device.connected = true;
      const { spec } = device;
      done({
        id,
        name: spec.name ?? null,
        maxWriteLength: maxWriteLength(spec),
        services: Object.entries(spec.services ?? {}).map(
          ([uuid, characteristics]) => ({
            uuid: canonical(uuid),
            characteristics: Object.entries(characteristics).map(
              ([characteristic, { properties }]) => ({
                uuid: canonical(characteristic),
                properties: properties ?? DEFAULT_PROPERTIES,
              }),
            ),
          }),
        ),
      });
    },
    disconnect: (id, done) => {
      const device = devices.get(id);
      if (device) {
        device.connected = false;
        device.subscribed.clear();
      }
      done({});
    },
    read: (id, service, characteristic, done) => {
      const found = usable(id, service, characteristic, ['read'], done);
      if (!found) return;
      done({ value: toBase64(found.characteristic.value ?? new Uint8Array()) });
    },
    write: (id, service, characteristic, value, withResponse, done) => {
      const found = usable(
        id,
        service,
        characteristic,
        [withResponse ? 'write' : 'writeWithoutResponse'],
        done,
      );
      if (!found) return;
      const bytes = fromBase64(value);
      const limit = withResponse
        ? MAX_ATTRIBUTE_LENGTH
        : maxWriteLength(found.device.spec);
      if (bytes.length > limit) {
        return done(
          failure(
            'failed',
            `The value is ${bytes.length} bytes, and this write takes at most ${limit}.`,
          ),
        );
      }
      found.device.writes.push({
        service,
        characteristic,
        value: bytes,
        withResponse,
      });
      done({});
      found.characteristic.onWrite?.(bytes, found.device.ref);
    },
    setNotifications: (id, service, characteristic, enabled, done) => {
      const found = usable(
        id,
        service,
        characteristic,
        ['notify', 'indicate'],
        done,
      );
      if (!found) return;
      const key = `${service} ${characteristic}`;
      if (enabled) found.device.subscribed.add(key);
      else found.device.subscribed.delete(key);
      done({});
    },
  };
  threadGlobals.NativeModules = {
    ...threadGlobals.NativeModules,
    [MODULE]: module,
  };
};

/**
 * The fake module of this test's environment. Read through the environment
 * rather than kept here: under `ng test`, the setup file and the specs can
 * load different copies of this module.
 */
const fakeModule = (caller: string): FakeBluetoothModule => {
  const module = environment()?.backgroundThread.globalThis.NativeModules?.[
    MODULE
  ] as FakeBluetoothModule | undefined;
  if (!module) {
    throw new Error(
      `${caller}() needs the testing library's environment, which its setup file installs.`,
    );
  }
  return module;
};

/**
 * Puts a Bluetooth LE device in range of the app, for `LynxBluetooth` to
 * find, connect to and talk to as it would a real one. A scan that's running
 * sees it at once, and one that starts later sees it as it starts. Each test
 * starts with none, and adding an id a second time throws.
 *
 * @example
 * ```ts
 * const frame = addBluetoothDevice({
 *   id: 'frame',
 *   name: 'Blotch - XyZ1',
 *   services: {
 *     [SETUP_SERVICE]: {
 *       [CREDENTIALS]: {
 *         properties: ['write'],
 *         onWrite: (_value, device) =>
 *           device.notify(SETUP_SERVICE, STATUS, encode('connected')),
 *       },
 *       [STATUS]: { properties: ['notify'] },
 *     },
 *   },
 * });
 * await render(SetUpFrame);
 * fireEvent.tap(await screen.findByText('Blotch - XyZ1'));
 * // …
 * expect(frame.writes).toHaveLength(1);
 * ```
 */
export const addBluetoothDevice = (
  device: FakeBluetoothDevice,
): FakeBluetoothDeviceRef => {
  const module = fakeModule('addBluetoothDevice');
  // Replacing it would leave the app's connection to it looking open while
  // its calls fail.
  if (module.devices.has(device.id)) {
    throw new Error(
      `addBluetoothDevice() already added a device with the id ${device.id}.`,
    );
  }
  const writes: FakeBluetoothWrite[] = [];
  const subscribed = new Set<string>();
  const entry: Device = {
    spec: device,
    writes,
    subscribed,
    connected: false,
    ref: {
      get connected() {
        return entry.connected;
      },
      writes,
      notify: (service, characteristic, value) => {
        const key = `${canonical(service)} ${canonical(characteristic)}`;
        if (!entry.connected || !subscribed.has(key)) return;
        emit({
          type: 'value',
          id: device.id,
          service: canonical(service),
          characteristic: canonical(characteristic),
          value: toBase64(value),
        });
      },
      disconnect: () => {
        if (!entry.connected) return;
        entry.connected = false;
        subscribed.clear();
        emit({ type: 'disconnected', id: device.id });
      },
    },
  };
  module.devices.set(device.id, entry);
  if (module.scanning && matches(device, module.scanning.services)) {
    emit(sighting(device, module.scanning.id));
  }
  return entry.ref;
};

/**
 * Sets the state of the phone's Bluetooth, as the person turning it off or
 * refusing permission does, so a spec can check what the app shows then.
 * Anything but `poweredOn` ends a running scan and every connection, as it
 * does on a phone. `unknown` stands for not asked yet: the person allows it
 * when `LynxBluetooth` asks, as `requestPermission()`, `scan()` and
 * `connect()` do.
 *
 * @example
 * ```ts
 * setBluetoothState('poweredOff');
 * await render(SetUpFrame);
 * expect(await screen.findByText('Turn on Bluetooth')).toBeInTheDocument();
 * ```
 */
export const setBluetoothState = (state: BluetoothState): void => {
  const module = fakeModule('setBluetoothState');
  module.state = state;
  emit({ type: 'state', state });
  const error = unusable(state);
  if (!error) return;
  if (module.scanning) {
    emit({ type: 'scanStopped', scan: module.scanning.id, ...error });
    module.scanning = null;
  }
  for (const { ref } of module.devices.values()) ref.disconnect();
};
