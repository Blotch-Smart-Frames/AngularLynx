import '@angular/compiler';
import {
  createEnvironmentInjector,
  type EnvironmentInjector,
  ErrorHandler,
  Injector,
  runInInjectionContext,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxNativeModule } from '../native-module/native-module';
import { bytesToBase64 } from '../network/base64';
import {
  BluetoothError,
  canonicalBluetoothUUID,
  LynxBluetooth,
  type BluetoothDevice,
} from './bluetooth';

type Done = (result?: object) => void;
type Listener = (event: object) => void;

const SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
const STATUS = '0000fff1-0000-1000-8000-00805f9b34fb';
const CREDENTIALS = '0000fff2-0000-1000-8000-00805f9b34fb';

const NATIVE_CONNECTION = {
  id: 'frame',
  name: 'Blotch - XyZ1',
  maxWriteLength: 182,
  services: [
    {
      uuid: 'FFF0',
      characteristics: [
        { uuid: 'FFF1', properties: ['read', 'notify'] },
        { uuid: 'fff2', properties: ['write'] },
      ],
    },
  ],
};

let listener: Listener | undefined;
let errors: unknown[];
/** The id the runtime gave the scan it started last, which events name. */
let scanId: number | undefined;

/**
 * Stands in for the shells' AngularLynxBluetooth module, as the background
 * thread sees it: each method calls back once, with what `answers` holds for
 * it, or `{}`. Unit tests run as the background thread, so the service calls
 * it directly.
 */
const stubModule = (answers: Record<string, object | undefined> = {}) => {
  const answer =
    (method: string) =>
    (...args: unknown[]) =>
      (args.at(-1) as Done)(
        method in answers ? answers[method] : { state: 'poweredOn' },
      );
  const module = {
    getState: vi.fn(answer('getState')),
    requestPermission: vi.fn(answer('requestPermission')),
    startScan: vi.fn((options: { scan: number }, done: Done) => {
      scanId = options.scan;
      answer('startScan')(options, done);
    }),
    stopScan: vi.fn(answer('stopScan')),
    connect: vi.fn((...args: unknown[]) =>
      (args.at(-1) as Done)(answers['connect'] ?? NATIVE_CONNECTION),
    ),
    disconnect: vi.fn(answer('disconnect')),
    read: vi.fn(answer('read')),
    write: vi.fn(answer('write')),
    setNotifications: vi.fn(answer('setNotifications')),
  };
  vi.stubGlobal('NativeModules', { AngularLynxBluetooth: module });
  return module;
};

/**
 * The shells' global events, which the service hears through Lynx.
 */
const stubEmitter = (emitter?: object | null) => {
  vi.stubGlobal('lynx', {
    getJSModule: (name: string) =>
      name === 'GlobalEventEmitter' && emitter !== null
        ? (emitter ?? {
            addListener: (event: string, fn: Listener) => {
              if (event === 'angularLynxBluetooth') listener = fn;
            },
          })
        : undefined,
  });
};

const send = (event: object) => listener?.(event);

const createInjector = () =>
  Injector.create({
    providers: [
      LynxBluetooth,
      LynxNativeModule,
      {
        provide: ErrorHandler,
        useValue: { handleError: (error: unknown) => errors.push(error) },
      },
    ],
  });

/**
 * Lets the calls to the background thread, and what follows them, settle.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const createBluetooth = async () => {
  const bluetooth = createInjector().get(LynxBluetooth);
  await settle();
  return bluetooth;
};

const sighting = (device: object = {}, scan = scanId) => ({
  type: 'device',
  scan,
  device: {
    id: 'frame',
    name: 'Blotch - XyZ1',
    rssi: -48,
    services: ['FFF0'],
    serviceData: { fff0: bytesToBase64(new Uint8Array([1, 2])) },
    manufacturerData: { '741': bytesToBase64(new Uint8Array([9])) },
    ...device,
  },
});

beforeEach(() => {
  listener = undefined;
  errors = [];
  scanId = undefined;
  stubEmitter();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('canonicalBluetoothUUID', () => {
  it('reads a 16-bit UUID on the Bluetooth base UUID', () => {
    expect(canonicalBluetoothUUID('180F')).toBe(
      '0000180f-0000-1000-8000-00805f9b34fb',
    );
  });

  it('reads a 32-bit UUID on the Bluetooth base UUID', () => {
    expect(canonicalBluetoothUUID('0000180f')).toBe(
      '0000180f-0000-1000-8000-00805f9b34fb',
    );
  });

  it('lowercases a 128-bit UUID', () => {
    expect(canonicalBluetoothUUID('6E400001-B5A3-F393-E0A9-E50E24DCCA9E')).toBe(
      '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    );
  });

  it('rejects anything else', () => {
    expect(() => canonicalBluetoothUUID('battery')).toThrow(TypeError);
  });
});

describe('LynxBluetooth', () => {
  describe('state', () => {
    it('starts unknown, then reads the state without asking', async () => {
      const module = stubModule({ getState: { state: 'poweredOff' } });
      const bluetooth = createInjector().get(LynxBluetooth);
      expect(bluetooth.state()).toBe('unknown');

      await settle();

      expect(bluetooth.state()).toBe('poweredOff');
      expect(module.requestPermission).not.toHaveBeenCalled();
    });

    it('follows the state the shell sends', async () => {
      stubModule();
      const bluetooth = await createBluetooth();

      send({ type: 'state', state: 'unauthorized' });

      expect(bluetooth.state()).toBe('unauthorized');
    });

    it('reads a state it does not know as unknown', async () => {
      stubModule({ getState: { state: 'sleeping' } });
      expect((await createBluetooth()).state()).toBe('unknown');
    });

    it('is unsupported where the host has no Bluetooth', async () => {
      vi.stubGlobal('NativeModules', {});
      expect((await createBluetooth()).state()).toBe('unsupported');
    });

    it('reads the state without global events to hear', async () => {
      stubModule();
      stubEmitter(null);
      expect((await createBluetooth()).state()).toBe('poweredOn');
    });

    it('reads the state when listening fails', async () => {
      stubModule();
      stubEmitter({
        addListener: () => {
          throw new Error('no background thread');
        },
      });
      expect((await createBluetooth()).state()).toBe('poweredOn');
    });
  });

  describe('requestPermission', () => {
    it('resolves with the state after the person answers', async () => {
      stubModule({ requestPermission: { state: 'unauthorized' } });
      const bluetooth = await createBluetooth();

      await expect(bluetooth.requestPermission()).resolves.toBe('unauthorized');
      expect(bluetooth.state()).toBe('unauthorized');
    });

    it("rejects with the shell's error", async () => {
      stubModule({
        requestPermission: { error: 'unsupported', message: 'No radio.' },
      });
      const bluetooth = await createBluetooth();

      const error = await bluetooth.requestPermission().catch((e) => e);

      expect(error).toBeInstanceOf(BluetoothError);
      expect(error).toMatchObject({
        code: 'unsupported',
        message: 'No radio.',
        name: 'BluetoothError',
      });
    });

    it('reads a code it does not know as failed, with a message of its own', async () => {
      stubModule({ requestPermission: { error: 'exploded' } });
      const bluetooth = await createBluetooth();

      await expect(bluetooth.requestPermission()).rejects.toMatchObject({
        code: 'failed',
        message: 'Bluetooth failed.',
      });
    });

    it('rejects as unavailable where the host has no Bluetooth', async () => {
      vi.stubGlobal('NativeModules', {});
      const bluetooth = await createBluetooth();

      await expect(bluetooth.requestPermission()).rejects.toMatchObject({
        code: 'unavailable',
      });
    });
  });

  describe('scan', () => {
    it('asks for the services, spelled canonically', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();

      const scan = await bluetooth.scan({ services: ['FFF0'] }, () => {});

      expect(module.startScan).toHaveBeenCalledWith(
        { services: [SERVICE], scan: 1 },
        expect.any(Function),
      );
      expect(scan.scanning()).toBe(true);
      expect(scan.error()).toBeUndefined();
    });

    it('scans for every device without services', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();

      await bluetooth.scan({}, () => {});

      expect(module.startScan).toHaveBeenCalledWith(
        { services: [], scan: 1 },
        expect.any(Function),
      );
    });

    it('hands over each sighting, with its data decoded', async () => {
      stubModule();
      const bluetooth = await createBluetooth();
      const seen: BluetoothDevice[] = [];
      await bluetooth.scan({}, (device) => seen.push(device));

      send(sighting());
      send(sighting({ name: null, rssi: -70 }));

      expect(seen).toEqual([
        {
          id: 'frame',
          name: 'Blotch - XyZ1',
          rssi: -48,
          services: [SERVICE],
          serviceData: new Map([[SERVICE, new Uint8Array([1, 2])]]),
          manufacturerData: new Map([[741, new Uint8Array([9])]]),
        },
        expect.objectContaining({ name: null, rssi: -70 }),
      ]);
    });

    it('hands over only the devices whose name starts with the prefix', async () => {
      stubModule();
      const bluetooth = await createBluetooth();
      const seen: (string | null)[] = [];
      await bluetooth.scan({ namePrefix: 'Blotch' }, (device) =>
        seen.push(device.name),
      );

      send(sighting({ name: 'Blotch - XyZ1' }));
      send(sighting({ name: 'Headphones' }));
      send(sighting({ name: undefined }));

      expect(seen).toEqual(['Blotch - XyZ1']);
    });

    it('ignores sightings while no scan runs', async () => {
      stubModule();
      await createBluetooth();

      expect(() => send(sighting())).not.toThrow();
    });

    it("passes a listener's error to the ErrorHandler", async () => {
      stubModule();
      const bluetooth = await createBluetooth();
      const failure = new Error('listener failed');
      await bluetooth.scan({}, () => {
        throw failure;
      });

      send(sighting());

      expect(errors).toEqual([failure]);
    });

    it('stops the scan once', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();
      const seen = vi.fn();
      const scan = await bluetooth.scan({}, seen);

      await scan.stop();
      await scan.stop();
      send(sighting());

      expect(module.stopScan).toHaveBeenCalledTimes(1);
      expect(scan.scanning()).toBe(false);
      expect(scan.error()).toBeUndefined();
      expect(seen).not.toHaveBeenCalled();
    });

    it('takes a shell that calls back with nothing as done', async () => {
      stubModule({ stopScan: undefined });
      const bluetooth = await createBluetooth();
      const scan = await bluetooth.scan({}, () => {});

      await expect(scan.stop()).resolves.toBeUndefined();
    });

    it('ends the running scan when another starts', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();
      const first = vi.fn();
      const second = vi.fn();
      const firstScan = await bluetooth.scan({}, first);

      await bluetooth.scan({}, second);
      await firstScan.stop();
      send(sighting());

      expect(firstScan.scanning()).toBe(false);
      // The shell replaced it with the second one itself.
      expect(module.stopScan).not.toHaveBeenCalled();
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('rejects when the scan cannot start', async () => {
      stubModule({
        startScan: { error: 'poweredOff', message: 'Bluetooth is off.' },
      });
      const bluetooth = await createBluetooth();
      const seen = vi.fn();

      await expect(bluetooth.scan({}, seen)).rejects.toMatchObject({
        code: 'poweredOff',
      });
      send(sighting());

      expect(seen).not.toHaveBeenCalled();
    });

    it('rejects a service that is not a UUID', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();

      await expect(
        bluetooth.scan({ services: ['battery'] }, () => {}),
      ).rejects.toBeInstanceOf(TypeError);
      expect(module.startScan).not.toHaveBeenCalled();
    });

    it('keeps why the scan ended on its own', async () => {
      stubModule();
      const bluetooth = await createBluetooth();
      const scan = await bluetooth.scan({}, () => {});

      send({
        type: 'scanStopped',
        scan: scanId,
        error: 'poweredOff',
        message: 'Bluetooth is off.',
      });

      expect(scan.scanning()).toBe(false);
      expect(scan.error()).toMatchObject({
        code: 'poweredOff',
        message: 'Bluetooth is off.',
      });
    });

    it('ends without an error when the shell gives none', async () => {
      stubModule();
      const bluetooth = await createBluetooth();
      const scan = await bluetooth.scan({}, () => {});

      send({ type: 'scanStopped', scan: scanId });

      expect(scan.scanning()).toBe(false);
      expect(scan.error()).toBeUndefined();
    });

    it('ignores the sightings and the end of the scan it replaced', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();
      await bluetooth.scan({ services: ['180f'] }, () => {});
      const replaced = scanId;
      const seen = vi.fn();
      const scan = await bluetooth.scan({ services: ['180d'] }, seen);

      // Sent as the shell was still running the first scan.
      send(sighting({}, replaced));
      send({ type: 'scanStopped', scan: replaced, error: 'failed' });
      send(sighting());

      expect(module.startScan).toHaveBeenLastCalledWith(
        expect.objectContaining({ scan: 2 }),
        expect.any(Function),
      );
      expect(scan.scanning()).toBe(true);
      expect(seen).toHaveBeenCalledTimes(1);
    });

    it('ignores a stop while no scan runs', async () => {
      stubModule();
      await createBluetooth();

      expect(() => send({ type: 'scanStopped' })).not.toThrow();
    });

    it('stops when the injection context it started in is destroyed', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();
      const parent = Injector.create({ providers: [] }) as EnvironmentInjector;
      const context = createEnvironmentInjector([], parent);

      const scan = await runInInjectionContext(context, () =>
        bluetooth.scan({}, () => {}),
      );
      context.destroy();
      await settle();

      expect(scan.scanning()).toBe(false);
      expect(module.stopScan).toHaveBeenCalledTimes(1);
    });

    it('stops once it has started when its owner goes while it starts', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();
      const parent = Injector.create({ providers: [] }) as EnvironmentInjector;
      const context = createEnvironmentInjector([], parent);
      let start: Done | undefined;
      module.startScan.mockImplementationOnce((_options, done) => {
        start = done;
      });

      const starting = runInInjectionContext(context, () =>
        bluetooth.scan({}, () => {}),
      );
      await settle();
      // As while the permission prompt is open.
      context.destroy();
      expect(module.stopScan).not.toHaveBeenCalled();
      start?.({});
      const scan = await starting;

      expect(scan.scanning()).toBe(false);
      expect(module.stopScan).toHaveBeenCalledTimes(1);
    });

    it('leaves the scan that replaced it when its owner goes while it starts', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();
      const parent = Injector.create({ providers: [] }) as EnvironmentInjector;
      const context = createEnvironmentInjector([], parent);
      let start: Done | undefined;
      module.startScan.mockImplementationOnce((_options, done) => {
        start = done;
      });

      const starting = runInInjectionContext(context, () =>
        bluetooth.scan({}, () => {}),
      );
      await settle();
      context.destroy();
      const replacement = await bluetooth.scan({}, () => {});
      start?.({});
      await starting;

      expect(replacement.scanning()).toBe(true);
      expect(module.stopScan).not.toHaveBeenCalled();
    });

    it("stops when the injector it's given is destroyed, and leaves it when stopped first", async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();
      const parent = Injector.create({ providers: [] }) as EnvironmentInjector;
      const first = createEnvironmentInjector([], parent);
      const second = createEnvironmentInjector([], parent);

      const stopped = await bluetooth.scan({}, () => {}, { injector: first });
      await stopped.stop();
      first.destroy();
      const scan = await bluetooth.scan({}, () => {}, { injector: second });
      second.destroy();
      await settle();

      expect(scan.scanning()).toBe(false);
      expect(module.stopScan).toHaveBeenCalledTimes(2);
    });
  });

  describe('connect', () => {
    it('connects with the default timeout and hands over what it found', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();

      const connection = await bluetooth.connect('frame');

      expect(module.connect).toHaveBeenCalledWith(
        'frame',
        { timeout: 10_000 },
        expect.any(Function),
      );
      expect(connection).toMatchObject({
        id: 'frame',
        name: 'Blotch - XyZ1',
        maxWriteLength: 182,
        services: [
          {
            uuid: SERVICE,
            characteristics: [
              { uuid: STATUS, properties: ['read', 'notify'] },
              { uuid: CREDENTIALS, properties: ['write'] },
            ],
          },
        ],
      });
      expect(connection.connected()).toBe(true);
    });

    it('takes a timeout, and a device without a name', async () => {
      const module = stubModule({
        connect: { ...NATIVE_CONNECTION, name: undefined },
      });
      const bluetooth = await createBluetooth();

      const connection = await bluetooth.connect('frame', { timeout: 3000 });

      expect(module.connect).toHaveBeenCalledWith(
        'frame',
        { timeout: 3000 },
        expect.any(Function),
      );
      expect(connection.name).toBeNull();
    });

    it('rejects a timeout that is not a positive number of milliseconds', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();

      for (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(
          bluetooth.connect('frame', { timeout }),
        ).rejects.toBeInstanceOf(RangeError);
      }
      expect(module.connect).not.toHaveBeenCalled();
    });

    it('connects once for calls made together, and hands over the open one after', async () => {
      const module = stubModule();
      const bluetooth = await createBluetooth();

      const [first, second] = await Promise.all([
        bluetooth.connect('frame'),
        bluetooth.connect('frame'),
      ]);
      const third = await bluetooth.connect('frame');

      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(module.connect).toHaveBeenCalledTimes(1);
    });

    it('rejects when it cannot connect, and tries again next time', async () => {
      const module = stubModule({
        connect: { error: 'timeout', message: 'No answer.' },
      });
      const bluetooth = await createBluetooth();

      await expect(bluetooth.connect('frame')).rejects.toMatchObject({
        code: 'timeout',
      });
      await expect(bluetooth.connect('frame')).rejects.toMatchObject({
        code: 'timeout',
      });
      expect(module.connect).toHaveBeenCalledTimes(2);
    });
  });

  describe('a connection', () => {
    const connect = async (answers?: Record<string, object | undefined>) => {
      const module = stubModule(answers);
      const bluetooth = await createBluetooth();
      return {
        module,
        bluetooth,
        connection: await bluetooth.connect('frame'),
      };
    };

    it('reads a value', async () => {
      const { module, connection } = await connect({
        read: { value: bytesToBase64(new Uint8Array([7, 8])) },
      });

      await expect(connection.read('fff0', 'fff1')).resolves.toEqual(
        new Uint8Array([7, 8]),
      );
      expect(module.read).toHaveBeenCalledWith(
        'frame',
        SERVICE,
        STATUS,
        expect.any(Function),
      );
    });

    it('writes with a response unless told not to', async () => {
      const { module, connection } = await connect();
      const value = new Uint8Array([1, 2, 3]);

      await connection.write('fff0', 'fff2', value);
      await connection.write('fff0', 'fff2', value, { withResponse: false });

      expect(module.write.mock.calls.map((call) => call.slice(0, 5))).toEqual([
        ['frame', SERVICE, CREDENTIALS, bytesToBase64(value), true],
        ['frame', SERVICE, CREDENTIALS, bytesToBase64(value), false],
      ]);
    });

    it("rejects with the shell's error", async () => {
      const { connection } = await connect({
        write: { error: 'notFound', message: 'No such characteristic.' },
      });

      await expect(
        connection.write('fff0', 'fff9', new Uint8Array()),
      ).rejects.toMatchObject({ code: 'notFound' });
    });

    it("hands each characteristic's values to its listeners", async () => {
      const { module, connection } = await connect();
      const first = vi.fn();
      const second = vi.fn();

      await connection.subscribe('fff0', 'fff1', first);
      await connection.subscribe(SERVICE, STATUS, second);
      send({
        type: 'value',
        id: 'frame',
        service: 'FFF0',
        characteristic: 'FFF1',
        value: 'AQ==',
      });
      // Another characteristic, and another device: neither is listened to.
      send({
        type: 'value',
        id: 'frame',
        service: 'fff0',
        characteristic: 'fff2',
        value: 'AQ==',
      });
      send({
        type: 'value',
        id: 'other',
        service: 'fff0',
        characteristic: 'fff1',
        value: 'AQ==',
      });

      expect(first).toHaveBeenCalledExactlyOnceWith(new Uint8Array([1]));
      expect(second).toHaveBeenCalledExactlyOnceWith(new Uint8Array([1]));
      // The device starts sending once, for both.
      expect(module.setNotifications).toHaveBeenCalledExactlyOnceWith(
        'frame',
        SERVICE,
        STATUS,
        true,
        expect.any(Function),
      );
    });

    it('lets a second listener wait for the first one to start the values', async () => {
      const { module, connection } = await connect();
      let start: Done | undefined;
      module.setNotifications.mockImplementationOnce(
        (...args: unknown[]) => (start = args.at(-1) as Done),
      );
      const second = vi.fn();

      const subscribing = connection.subscribe('fff0', 'fff1', () => {});
      const waiting = connection.subscribe('fff0', 'fff1', second);
      await settle();
      let settled = false;
      void waiting.then(() => (settled = true));
      await settle();
      expect(settled).toBe(false);

      start?.({});
      await Promise.all([subscribing, waiting]);
      send({
        type: 'value',
        id: 'frame',
        service: 'fff0',
        characteristic: 'fff1',
        value: 'AQ==',
      });

      expect(second).toHaveBeenCalledTimes(1);
    });

    it("passes a listener's error to the ErrorHandler and goes on", async () => {
      const { connection } = await connect();
      const failure = new Error('listener failed');
      const after = vi.fn();
      await connection.subscribe('fff0', 'fff1', () => {
        throw failure;
      });
      await connection.subscribe('fff0', 'fff1', after);

      send({
        type: 'value',
        id: 'frame',
        service: 'fff0',
        characteristic: 'fff1',
        value: 'AQ==',
      });

      expect(errors).toEqual([failure]);
      expect(after).toHaveBeenCalledTimes(1);
    });

    it('stops the values once the last listener stops', async () => {
      const { module, connection } = await connect();
      const listener = vi.fn();
      const stopFirst = await connection.subscribe('fff0', 'fff1', listener);
      const stopSecond = await connection.subscribe('fff0', 'fff1', listener);

      await stopFirst();
      await stopFirst();
      expect(module.setNotifications).toHaveBeenCalledTimes(1);

      await stopSecond();
      send({
        type: 'value',
        id: 'frame',
        service: 'fff0',
        characteristic: 'fff1',
        value: 'AQ==',
      });

      expect(listener).not.toHaveBeenCalled();
      expect(module.setNotifications).toHaveBeenLastCalledWith(
        'frame',
        SERVICE,
        STATUS,
        false,
        expect.any(Function),
      );
    });

    it('asks again after the values could not start', async () => {
      const { module, connection } = await connect();
      module.setNotifications.mockImplementationOnce((...args: unknown[]) =>
        (args.at(-1) as Done)({ error: 'failed', message: 'Refused.' }),
      );

      await expect(
        connection.subscribe('fff0', 'fff1', () => {}),
      ).rejects.toMatchObject({ code: 'failed' });
      await connection.subscribe('fff0', 'fff1', () => {});

      expect(module.setNotifications).toHaveBeenCalledTimes(2);
    });

    it('rejects a subscription whose start fails after the device went', async () => {
      const { module, connection } = await connect();
      let start: Done | undefined;
      module.setNotifications.mockImplementationOnce(
        (...args: unknown[]) => (start = args.at(-1) as Done),
      );

      const subscribing = connection.subscribe('fff0', 'fff1', () => {});
      await settle();
      send({ type: 'disconnected', id: 'frame' });
      start?.({ error: 'notConnected', message: 'Gone.' });

      await expect(subscribing).rejects.toMatchObject({ code: 'notConnected' });
    });

    it('ends when the device goes, and fails without asking the shell after', async () => {
      const { module, bluetooth, connection } = await connect();
      const listener = vi.fn();
      const stop = await connection.subscribe('fff0', 'fff1', listener);

      send({ type: 'disconnected', id: 'frame', error: 'failed' });
      // A device it has no connection to.
      send({ type: 'disconnected', id: 'other' });

      expect(connection.connected()).toBe(false);
      await expect(connection.read('fff0', 'fff1')).rejects.toMatchObject({
        code: 'notConnected',
      });
      await stop();
      await connection.disconnect();
      expect(module.read).not.toHaveBeenCalled();
      expect(module.disconnect).not.toHaveBeenCalled();
      expect(module.setNotifications).toHaveBeenCalledTimes(1);

      // The next connect opens a new connection.
      const again = await bluetooth.connect('frame');
      expect(again).not.toBe(connection);
      expect(again.connected()).toBe(true);
    });

    it('disconnects once', async () => {
      const { module, bluetooth, connection } = await connect();

      await connection.disconnect();
      await connection.disconnect();

      expect(connection.connected()).toBe(false);
      expect(module.disconnect).toHaveBeenCalledExactlyOnceWith(
        'frame',
        expect.any(Function),
      );
      expect(await bluetooth.connect('frame')).not.toBe(connection);
    });
  });
});
