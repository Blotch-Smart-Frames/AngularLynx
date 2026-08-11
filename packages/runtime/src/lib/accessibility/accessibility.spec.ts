import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxAccessibility } from './accessibility';

describe('LynxAccessibility', () => {
  afterEach(() => {
    delete (globalThis as any).lynx;
  });

  describe('when lynx is not defined', () => {
    it('does not throw when constructing', () => {
      expect(() => new LynxAccessibility()).not.toThrow();
    });

    it('announce rejects with error', async () => {
      const service = new LynxAccessibility();

      await expect(service.announce('hello')).rejects.toThrow(
        'lynx.accessibilityAnnounce is not available in this environment',
      );
    });

    it('requestFocus rejects with error', async () => {
      const service = new LynxAccessibility();

      await expect(service.requestFocus('#el')).rejects.toThrow(
        'lynx.createSelectorQuery is not available in this environment',
      );
    });
  });

  describe('when lynx exists but accessibilityAnnounce is missing', () => {
    let execMock: ReturnType<typeof vi.fn>;
    let invokeMock: ReturnType<typeof vi.fn>;
    let selectMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      execMock = vi.fn();
      invokeMock = vi.fn().mockImplementation((options) => {
        options.success?.();
        return { exec: execMock };
      });
      selectMock = vi.fn().mockReturnValue({ invoke: invokeMock });

      (globalThis as any).lynx = {
        createSelectorQuery: vi.fn().mockReturnValue({ select: selectMock }),
      };
    });

    it('announce rejects', async () => {
      const service = new LynxAccessibility();

      await expect(service.announce('hello')).rejects.toThrow(
        'lynx.accessibilityAnnounce is not available',
      );
    });

    it('requestFocus still works', async () => {
      const service = new LynxAccessibility();

      await expect(service.requestFocus('#el')).resolves.toBeUndefined();
    });
  });

  describe('announce', () => {
    let announceMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      announceMock = vi.fn();
      (globalThis as any).lynx = {
        accessibilityAnnounce: announceMock,
      };
    });

    it('calls lynx.accessibilityAnnounce with { content }', async () => {
      announceMock.mockImplementation((_opts: unknown, cb: () => void) => cb());
      const service = new LynxAccessibility();

      await service.announce('Item added');

      expect(announceMock).toHaveBeenCalledWith(
        { content: 'Item added' },
        expect.any(Function),
      );
    });

    it('resolves when callback fires', async () => {
      announceMock.mockImplementation((_opts: unknown, cb: () => void) => cb());
      const service = new LynxAccessibility();

      await expect(service.announce('hello')).resolves.toBeUndefined();
    });
  });

  describe('requestFocus', () => {
    let execMock: ReturnType<typeof vi.fn>;
    let invokeMock: ReturnType<typeof vi.fn>;
    let selectMock: ReturnType<typeof vi.fn>;
    let createSelectorQueryMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      execMock = vi.fn();
      invokeMock = vi.fn().mockImplementation((_options) => {
        return { exec: execMock };
      });
      selectMock = vi.fn().mockReturnValue({ invoke: invokeMock });
      createSelectorQueryMock = vi.fn().mockReturnValue({ select: selectMock });

      (globalThis as any).lynx = {
        createSelectorQuery: createSelectorQueryMock,
      };
    });

    it('calls createSelectorQuery().select(selector)', async () => {
      invokeMock.mockImplementation((options) => {
        options.success?.();
        return { exec: execMock };
      });
      const service = new LynxAccessibility();

      await service.requestFocus('#myElement');

      expect(createSelectorQueryMock).toHaveBeenCalled();
      expect(selectMock).toHaveBeenCalledWith('#myElement');
    });

    it('invokes requestAccessibilityFocus method', async () => {
      invokeMock.mockImplementation((options) => {
        options.success?.();
        return { exec: execMock };
      });
      const service = new LynxAccessibility();

      await service.requestFocus('#el');

      expect(invokeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'requestAccessibilityFocus',
          params: {},
        }),
      );
    });

    it('calls exec()', async () => {
      invokeMock.mockImplementation((options) => {
        options.success?.();
        return { exec: execMock };
      });
      const service = new LynxAccessibility();

      await service.requestFocus('#el');

      expect(execMock).toHaveBeenCalled();
    });

    it('resolves on success', async () => {
      invokeMock.mockImplementation((options) => {
        options.success?.();
        return { exec: execMock };
      });
      const service = new LynxAccessibility();

      await expect(service.requestFocus('#el')).resolves.toBeUndefined();
    });

    it('rejects on fail with error code', async () => {
      invokeMock.mockImplementation((options) => {
        options.fail?.({ code: 2 });
        return { exec: execMock };
      });
      const service = new LynxAccessibility();

      await expect(service.requestFocus('#missing')).rejects.toThrow(
        'requestAccessibilityFocus failed (code 2)',
      );
    });

    it('includes data in error message when present', async () => {
      invokeMock.mockImplementation((options) => {
        options.fail?.({ code: 3, data: 'method not found' });
        return { exec: execMock };
      });
      const service = new LynxAccessibility();

      await expect(service.requestFocus('#el')).rejects.toThrow(
        'requestAccessibilityFocus failed (code 3): "method not found"',
      );
    });
  });
});
