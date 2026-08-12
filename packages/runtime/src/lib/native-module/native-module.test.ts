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
});
