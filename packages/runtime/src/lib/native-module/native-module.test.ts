import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxNativeModule } from './native-module';

describe('LynxNativeModule', () => {
  afterEach(() => {
    delete (globalThis as any).lynx;
    delete (globalThis as any).NativeModules;
  });

  describe('when neither lynx nor NativeModules are defined', () => {
    it('does not throw when constructing', () => {
      expect(() => new LynxNativeModule()).not.toThrow();
    });

    it('call resolves with undefined', async () => {
      const service = new LynxNativeModule();

      await expect(service.call('test')).resolves.toBeUndefined();
    });

    it('on is a no-op', () => {
      const service = new LynxNativeModule();

      expect(() => service.on('test', vi.fn())).not.toThrow();
    });

    it('getNativeModule returns undefined', () => {
      const service = new LynxNativeModule();

      expect(service.getNativeModule('SomeModule')).toBeUndefined();
    });

    it('getJSModule returns undefined', () => {
      const service = new LynxNativeModule();

      expect(service.getJSModule('test')).toBeUndefined();
    });

    it('registerJSModule is a no-op', () => {
      const service = new LynxNativeModule();

      expect(() =>
        service.registerJSModule('test', { value: 1 }),
      ).not.toThrow();
    });
  });

  describe('NativeModules.bridge', () => {
    let callMock: ReturnType<typeof vi.fn>;
    let onMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      callMock = vi.fn();
      onMock = vi.fn();
      (globalThis as any).NativeModules = {
        bridge: { call: callMock, on: onMock },
      };
    });

    it('call invokes bridge.call and resolves with the first callback arg', async () => {
      callMock.mockImplementation(
        (
          _name: string,
          _params: Record<string, unknown>,
          cb: (...args: unknown[]) => void,
        ) => {
          cb('result-value');
        },
      );
      const service = new LynxNativeModule();

      const result = await service.call<string>('getDeviceId', { key: 'abc' });

      expect(callMock).toHaveBeenCalledWith(
        'getDeviceId',
        { key: 'abc' },
        expect.any(Function),
      );
      expect(result).toBe('result-value');
    });

    it('call defaults params to empty object', async () => {
      callMock.mockImplementation(
        (
          _name: string,
          _params: Record<string, unknown>,
          cb: (...args: unknown[]) => void,
        ) => {
          cb(null);
        },
      );
      const service = new LynxNativeModule();

      await service.call('test');

      expect(callMock).toHaveBeenCalledWith('test', {}, expect.any(Function));
    });

    it('on forwards to bridge.on', () => {
      const service = new LynxNativeModule();
      const callback = vi.fn();

      service.on('onDeepLink', callback);

      expect(onMock).toHaveBeenCalledWith('onDeepLink', callback);
    });
  });

  describe('getNativeModule', () => {
    it('returns the module from NativeModules global', () => {
      const mockModule = {
        setStorageItem: vi.fn(),
        getStorageItem: vi.fn(),
      };
      (globalThis as any).NativeModules = {
        bridge: { call: vi.fn(), on: vi.fn() },
        NativeLocalStorageModule: mockModule,
      };
      const service = new LynxNativeModule();

      const result = service.getNativeModule('NativeLocalStorageModule');

      expect(result).toBe(mockModule);
    });

    it('returns undefined for unregistered module', () => {
      (globalThis as any).NativeModules = {
        bridge: { call: vi.fn(), on: vi.fn() },
      };
      const service = new LynxNativeModule();

      expect(service.getNativeModule('NonExistent')).toBeUndefined();
    });
  });

  describe('lynx JS module APIs', () => {
    let getJSModuleMock: ReturnType<typeof vi.fn>;
    let registerModuleMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      getJSModuleMock = vi.fn();
      registerModuleMock = vi.fn();
      (globalThis as any).lynx = {
        getJSModule: getJSModuleMock,
        registerModule: registerModuleMock,
      };
    });

    it('getJSModule delegates to lynx.getJSModule', () => {
      const emitter = { addListener: vi.fn() };
      getJSModuleMock.mockReturnValue(emitter);
      const service = new LynxNativeModule();

      const result = service.getJSModule('GlobalEventEmitter');

      expect(getJSModuleMock).toHaveBeenCalledWith('GlobalEventEmitter');
      expect(result).toBe(emitter);
    });

    it('getJSModule returns undefined for unregistered module', () => {
      getJSModuleMock.mockReturnValue(undefined);
      const service = new LynxNativeModule();

      expect(service.getJSModule('unknown')).toBeUndefined();
    });

    it('registerJSModule delegates to lynx.registerModule', () => {
      const service = new LynxNativeModule();
      const module = { count: 0 };

      service.registerJSModule('myState', module);

      expect(registerModuleMock).toHaveBeenCalledWith('myState', module);
    });
  });

  // Angular runs on the main thread, which has neither NativeModules nor the
  // JS module registry, so every method goes through the background call relay
  // there (issue #81).
  describe('on the main thread', () => {
    const dispatched: Array<{ type: string; data: string }> = [];

    beforeEach(() => {
      dispatched.length = 0;
      vi.stubGlobal('__MAIN_THREAD__', true);
      (globalThis as any).lynx = {
        getJSContext: () => ({
          addEventListener: vi.fn(),
          dispatchEvent: (event: { type: string; data: string }) =>
            dispatched.push(event),
        }),
      };
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /**
     * The calls sent to the background thread.
     */
    const sent = () =>
      dispatched
        .filter((event) => event.type === 'AngularLynx.BackgroundCall')
        .map((event) => JSON.parse(event.data));

    it('relays call()', () => {
      void new LynxNativeModule().call('getDeviceId', { key: 'abc' });

      expect(sent()[0]).toMatchObject({
        name: 'nativeBridgeCall',
        args: ['getDeviceId', { key: 'abc' }],
      });
    });

    it('resolves call() undefined without a Lynx host to relay to', async () => {
      delete (globalThis as any).lynx;

      await expect(
        new LynxNativeModule().call('getDeviceId'),
      ).resolves.toBeUndefined();
    });

    it('relays on() with the callback as a marker', () => {
      new LynxNativeModule().on('onDeepLink', vi.fn());

      expect(sent()[0]).toMatchObject({
        name: 'nativeBridgeOn',
        args: ['onDeepLink', { __angularLynxCallback: expect.any(Number) }],
      });
    });

    it('swallows an on() the relay rejects', async () => {
      (globalThis as any).lynx = {
        getJSContext: () => {
          throw new Error('no background thread');
        },
      };

      expect(() => new LynxNativeModule().on('evt', vi.fn())).not.toThrow();
      await Promise.resolve();
    });

    it('returns a proxy from getNativeModule() whose methods relay', () => {
      const device = new LynxNativeModule().getNativeModule('DeviceModule') as {
        getBatteryLevel(done: () => void): Promise<unknown>;
      };

      void device.getBatteryLevel(() => {});

      expect(sent()[0]).toMatchObject({
        name: 'callModule',
        args: [
          'native',
          'DeviceModule',
          'getBatteryLevel',
          [expect.any(Object)],
        ],
      });
    });

    it('returns a proxy from getJSModule() whose methods relay', () => {
      const emitter = new LynxNativeModule().getJSModule<{
        emit(event: string, args: unknown[]): void;
      }>('GlobalEventEmitter');

      emitter!.emit('ping', ['pong']);

      expect(sent()[0]).toMatchObject({
        name: 'callModule',
        args: ['js', 'GlobalEventEmitter', 'emit', ['ping', ['pong']]],
      });
    });

    it('returns no module outside a Lynx host', () => {
      delete (globalThis as any).lynx;
      const service = new LynxNativeModule();

      expect(service.getNativeModule('DeviceModule')).toBeUndefined();
      expect(service.getJSModule('GlobalEventEmitter')).toBeUndefined();
    });

    it('relays registerJSModule() with its methods as markers', () => {
      new LynxNativeModule().registerJSModule('shared', {
        count: 1,
        ping: () => {},
      });

      expect(sent()[0]).toMatchObject({
        name: 'registerJSModule',
        args: [
          'shared',
          { count: 1, ping: { __angularLynxCallback: expect.any(Number) } },
        ],
      });
    });

    it('swallows a registerJSModule() the relay rejects', async () => {
      (globalThis as any).lynx = {
        getJSContext: () => {
          throw new Error('no background thread');
        },
      };

      expect(() =>
        new LynxNativeModule().registerJSModule('shared', {}),
      ).not.toThrow();
      await Promise.resolve();
    });
  });
});
