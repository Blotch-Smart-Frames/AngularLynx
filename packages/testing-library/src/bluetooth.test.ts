/**
 * LynxBluetooth under the testing library: the setup gives the environment's
 * background thread an AngularLynxBluetooth module whose devices are the ones
 * addBluetoothDevice() adds, so a spec can scan, connect and talk to a device
 * through the runtime's own code.
 */

import { Component, inject } from '@angular/core';
import {
  type BluetoothDevice,
  LYNX_ELEMENTS,
  LynxBluetooth,
} from '@blotch/angular-lynx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addBluetoothDevice,
  render,
  screen,
  setBluetoothState,
  waitForUpdate,
} from './index.js';

const SETUP = '0000fff0-0000-1000-8000-00805f9b34fb';
const STATUS = '0000fff1-0000-1000-8000-00805f9b34fb';
const CREDENTIALS = '0000fff2-0000-1000-8000-00805f9b34fb';

/**
 * Waits until the relay's promises have settled and the view has caught up.
 */
const settle = async () => {
  for (let i = 0; i < 5; i++) await waitForUpdate();
};

let bluetooth: LynxBluetooth;

@Component({
  selector: 'set-up-frame',
  imports: [LYNX_ELEMENTS],
  template: `<text>Bluetooth is {{ bluetooth.state() }}</text>`,
})
class SetUpFrame {
  readonly bluetooth = inject(LynxBluetooth);

  constructor() {
    bluetooth = this.bluetooth;
  }
}

const frame = () =>
  addBluetoothDevice({
    id: 'frame',
    name: 'Blotch - XyZ1',
    serviceData: { fff0: new Uint8Array([1]) },
    manufacturerData: { 741: new Uint8Array([2]) },
    services: {
      fff0: {
        fff1: { properties: ['read', 'notify'], value: new Uint8Array([5]) },
        fff2: {
          properties: ['write'],
          onWrite: (_value, device) =>
            device.notify('fff0', 'fff1', new Uint8Array([9])),
        },
      },
    },
  });

/**
 * Scans until the spec stops it, keeping what it saw.
 */
const scanFor = async (services?: string[]) => {
  const seen: BluetoothDevice[] = [];
  const scan = await bluetooth.scan({ services }, (device) =>
    seen.push(device),
  );
  await settle();
  return { scan, seen };
};

beforeEach(async () => {
  await render(SetUpFrame);
  await settle();
});

describe('LynxBluetooth under the testing library', () => {
  it('starts with the radio on', () => {
    expect(screen.getByText('Bluetooth is poweredOn')).toBeInTheDocument();
  });

  describe('scanning', () => {
    it('sees a device added before the scan, as it advertises', async () => {
      frame();
      addBluetoothDevice({ id: 'headphones', advertisedServices: ['110b'] });

      const { seen } = await scanFor([SETUP]);

      expect(seen).toEqual([
        {
          id: 'frame',
          name: 'Blotch - XyZ1',
          rssi: -50,
          services: [SETUP],
          serviceData: new Map([[SETUP, new Uint8Array([1])]]),
          manufacturerData: new Map([[741, new Uint8Array([2])]]),
        },
      ]);
    });

    it('sees a device added while it runs, and only those with its services', async () => {
      const { seen } = await scanFor(['fff0']);

      frame();
      addBluetoothDevice({ id: 'headphones', advertisedServices: ['110b'] });
      await settle();

      expect(seen.map((device) => device.id)).toEqual(['frame']);
    });

    it('sees every device without services, named or not', async () => {
      addBluetoothDevice({ id: 'beacon', rssi: -80 });
      addBluetoothDevice({
        id: 'sensor',
        advertisedServices: ['0000180f'],
      });

      const { seen } = await scanFor();

      expect(seen).toEqual([
        expect.objectContaining({
          id: 'beacon',
          name: null,
          rssi: -80,
          services: [],
        }),
        expect.objectContaining({
          id: 'sensor',
          services: ['0000180f-0000-1000-8000-00805f9b34fb'],
        }),
      ]);
    });

    it('sees nothing new once stopped', async () => {
      const { scan, seen } = await scanFor();

      await scan.stop();
      frame();
      await settle();

      expect(seen).toEqual([]);
    });
  });

  describe('a connection', () => {
    it('lists the services and characteristics', async () => {
      frame();
      addBluetoothDevice({ id: 'plain', services: { fff0: { fff1: {} } } });

      const connection = await bluetooth.connect('frame');
      const plain = await bluetooth.connect('plain');

      expect(connection).toMatchObject({
        id: 'frame',
        name: 'Blotch - XyZ1',
        maxWriteLength: 182,
        services: [
          {
            uuid: SETUP,
            characteristics: [
              { uuid: STATUS, properties: ['read', 'notify'] },
              { uuid: CREDENTIALS, properties: ['write'] },
            ],
          },
        ],
      });
      expect(plain.name).toBeNull();
      expect(plain.services[0]?.characteristics[0]?.properties).toEqual([
        'read',
        'write',
        'notify',
      ]);
    });

    it('connects to a device with no services, which has nothing to read', async () => {
      addBluetoothDevice({ id: 'beacon' });

      const connection = await bluetooth.connect('beacon');

      expect(connection.services).toEqual([]);
      await expect(connection.read(SETUP, STATUS)).rejects.toMatchObject({
        code: 'notFound',
      });
    });

    it('refuses a second device with the same id', () => {
      frame();

      expect(() => frame()).toThrow(
        'addBluetoothDevice() already added a device with the id frame.',
      );
    });

    it('rejects a device that is not in range', async () => {
      await expect(bluetooth.connect('nowhere')).rejects.toMatchObject({
        code: 'notFound',
      });
    });

    it('reads what the characteristic holds, or nothing', async () => {
      frame();
      addBluetoothDevice({
        id: 'empty',
        services: { [SETUP]: { [STATUS]: {} } },
      });

      const connection = await bluetooth.connect('frame');
      const empty = await bluetooth.connect('empty');

      await expect(connection.read(SETUP, STATUS)).resolves.toEqual(
        new Uint8Array([5]),
      );
      await expect(empty.read(SETUP, STATUS)).resolves.toEqual(
        new Uint8Array(),
      );
    });

    it('refuses what the characteristic does not allow, or does not have', async () => {
      frame();
      const connection = await bluetooth.connect('frame');

      await expect(connection.read(SETUP, CREDENTIALS)).rejects.toMatchObject({
        code: 'failed',
      });
      await expect(
        connection.write(SETUP, CREDENTIALS, new Uint8Array(), {
          withResponse: false,
        }),
      ).rejects.toMatchObject({ code: 'failed' });
      await expect(
        connection.subscribe(SETUP, CREDENTIALS, () => {}),
      ).rejects.toMatchObject({ code: 'failed' });
      await expect(connection.read(SETUP, 'fff9')).rejects.toMatchObject({
        code: 'notFound',
      });
      await expect(connection.read('fff9', STATUS)).rejects.toMatchObject({
        code: 'notFound',
      });
    });

    it('refuses a write longer than the device takes, as the shells do', async () => {
      const writable = {
        fff0: { fff2: { properties: ['write', 'writeWithoutResponse'] } },
      } as const;
      const small = addBluetoothDevice({
        id: 'small',
        maxWriteLength: 20,
        services: writable,
      });
      addBluetoothDevice({ id: 'plain', services: writable });
      const connection = await bluetooth.connect('small');
      const plain = await bluetooth.connect('plain');
      const withoutResponse = { withResponse: false };

      await connection.write(
        SETUP,
        CREDENTIALS,
        new Uint8Array(20),
        withoutResponse,
      );
      await connection.write(SETUP, CREDENTIALS, new Uint8Array(512));

      await expect(
        connection.write(
          SETUP,
          CREDENTIALS,
          new Uint8Array(21),
          withoutResponse,
        ),
      ).rejects.toMatchObject({
        code: 'failed',
        message: 'The value is 21 bytes, and this write takes at most 20.',
      });
      await expect(
        connection.write(SETUP, CREDENTIALS, new Uint8Array(513)),
      ).rejects.toMatchObject({ code: 'failed' });
      await expect(
        plain.write(SETUP, CREDENTIALS, new Uint8Array(183), withoutResponse),
      ).rejects.toMatchObject({ code: 'failed' });
      expect(small.writes.map(({ value }) => value.length)).toEqual([20, 512]);
    });

    it('caps a write without response at an attribute, as the shells do', async () => {
      addBluetoothDevice({
        id: 'large',
        maxWriteLength: 600,
        services: { fff0: { fff2: { properties: ['writeWithoutResponse'] } } },
      });
      const connection = await bluetooth.connect('large');

      expect(connection.maxWriteLength).toBe(512);
      await expect(
        connection.write(SETUP, CREDENTIALS, new Uint8Array(513), {
          withResponse: false,
        }),
      ).rejects.toMatchObject({
        message: 'The value is 513 bytes, and this write takes at most 512.',
      });
    });

    it('records writes, and delivers what the device answers', async () => {
      const device = frame();
      const connection = await bluetooth.connect('frame');
      const statuses: Uint8Array[] = [];
      await connection.subscribe(SETUP, STATUS, (value) =>
        statuses.push(value),
      );

      await connection.write(SETUP, CREDENTIALS, new Uint8Array([1, 2]));
      await settle();

      expect(device.writes).toEqual([
        {
          service: SETUP,
          characteristic: CREDENTIALS,
          value: new Uint8Array([1, 2]),
          withResponse: true,
        },
      ]);
      expect(statuses).toEqual([new Uint8Array([9])]);
    });

    it("sends notifications only while they're subscribed", async () => {
      const device = frame();
      const connection = await bluetooth.connect('frame');
      const statuses: Uint8Array[] = [];

      device.notify('fff0', 'fff1', new Uint8Array([1]));
      const stop = await connection.subscribe(SETUP, STATUS, (value) =>
        statuses.push(value),
      );
      device.notify('fff0', 'fff1', new Uint8Array([2]));
      await settle();
      await stop();
      device.notify('fff0', 'fff1', new Uint8Array([3]));
      await settle();

      expect(statuses).toEqual([new Uint8Array([2])]);
    });

    it('ends when the device goes', async () => {
      const device = frame();
      const connection = await bluetooth.connect('frame');
      expect(device.connected).toBe(true);

      device.disconnect();
      device.disconnect();
      await settle();

      expect(device.connected).toBe(false);
      expect(connection.connected()).toBe(false);
      await expect(connection.read(SETUP, STATUS)).rejects.toMatchObject({
        code: 'notConnected',
      });
    });

    it('ends when the app disconnects, and the device then refuses calls', async () => {
      const device = frame();
      const connection = await bluetooth.connect('frame');

      await connection.disconnect();
      // The shell answers a device that's gone as a device that's done.
      const shell = (globalThis as any).lynxTestingEnv.backgroundThread
        .globalThis.NativeModules.AngularLynxBluetooth;
      const answers: object[] = [];
      shell.disconnect('nowhere', (result: object) => answers.push(result));
      shell.read('frame', SETUP, STATUS, (result: object) =>
        answers.push(result),
      );

      expect(device.connected).toBe(false);
      expect(answers).toEqual([
        {},
        { error: 'notConnected', message: "frame isn't connected." },
      ]);
    });
  });

  describe('setBluetoothState', () => {
    it('shows the state, ends the scan, and drops every connection', async () => {
      const device = frame();
      const { scan } = await scanFor();
      const connection = await bluetooth.connect('frame');

      setBluetoothState('poweredOff');
      await settle();

      expect(screen.getByText('Bluetooth is poweredOff')).toBeInTheDocument();
      expect(scan.scanning()).toBe(false);
      expect(scan.error()).toMatchObject({ code: 'poweredOff' });
      expect(connection.connected()).toBe(false);
      expect(device.connected).toBe(false);
      await expect(bluetooth.scan({}, () => {})).rejects.toMatchObject({
        code: 'poweredOff',
      });
      await expect(bluetooth.connect('frame')).rejects.toMatchObject({
        code: 'poweredOff',
      });
    });

    it('turns the radio back on', async () => {
      setBluetoothState('unauthorized');
      setBluetoothState('poweredOn');
      await settle();

      expect(screen.getByText('Bluetooth is poweredOn')).toBeInTheDocument();
    });

    it('reads a state the platform has no error for as a failure', async () => {
      setBluetoothState('resetting');

      await expect(bluetooth.scan({}, () => {})).rejects.toMatchObject({
        code: 'failed',
        message: 'Bluetooth is resetting.',
      });
    });

    it('stands for not asked yet with unknown, which asking allows', async () => {
      setBluetoothState('unknown');

      await expect(bluetooth.requestPermission()).resolves.toBe('poweredOn');
      await expect(bluetooth.requestPermission()).resolves.toBe('poweredOn');
    });

    it('asks as a scan or a connection starts, as the shells do', async () => {
      frame();
      setBluetoothState('unknown');

      const { seen } = await scanFor();
      expect(seen.map(({ id }) => id)).toEqual(['frame']);
      expect(screen.getByText('Bluetooth is poweredOn')).toBeInTheDocument();

      setBluetoothState('unknown');
      await expect(bluetooth.connect('frame')).resolves.toMatchObject({
        id: 'frame',
      });
    });
  });

  describe('outside the environment', () => {
    let env: unknown;

    beforeEach(() => {
      env = (globalThis as any).lynxTestingEnv;
      (globalThis as any).lynxTestingEnv = undefined;
    });

    afterEach(() => {
      (globalThis as any).lynxTestingEnv = env;
    });

    it('says what the helpers need', () => {
      expect(() => addBluetoothDevice({ id: 'frame' })).toThrow(
        "addBluetoothDevice() needs the testing library's environment",
      );
      expect(() => setBluetoothState('poweredOff')).toThrow(
        "setBluetoothState() needs the testing library's environment",
      );
    });
  });
});
