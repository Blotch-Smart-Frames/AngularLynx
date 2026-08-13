import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxResourcePrefetch } from './resource-prefetch';

describe('LynxResourcePrefetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('when lynx is unavailable', () => {
    it('request() rejects', async () => {
      const service = new LynxResourcePrefetch();
      await expect(
        service.request([{ uri: 'https://x.com/a.jpg', type: 'image' }]),
      ).rejects.toThrow('lynx.requestResourcePrefetch is not available');
    });

    it('cancel() rejects', async () => {
      const service = new LynxResourcePrefetch();
      await expect(
        service.cancel([{ uri: 'https://x.com/a.jpg', type: 'image' }]),
      ).rejects.toThrow('lynx.cancelResourcePrefetch is not available');
    });
  });

  describe('when lynx is available', () => {
    let requestMock: ReturnType<typeof vi.fn>;
    let cancelMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      requestMock = vi.fn();
      cancelMock = vi.fn();
      vi.stubGlobal('lynx', {
        requestResourcePrefetch: requestMock,
        cancelResourcePrefetch: cancelMock,
      });
    });

    it('request() passes resources to native and resolves with result', async () => {
      const mockResult = {
        code: 0,
        msg: 'ok',
        details: [
          {
            code: 0,
            msg: 'ok',
            uri: 'https://x.com/a.jpg',
            type: 'image' as const,
          },
        ],
      };
      requestMock.mockImplementation((_data, cb) => cb(mockResult));

      const service = new LynxResourcePrefetch();
      const result = await service.request([
        { uri: 'https://x.com/a.jpg', type: 'image' },
      ]);

      expect(result).toEqual(mockResult);
      expect(requestMock).toHaveBeenCalledWith(
        { data: [{ uri: 'https://x.com/a.jpg', type: 'image' }] },
        expect.any(Function),
      );
    });

    it('request() includes param when priority is set', async () => {
      requestMock.mockImplementation((_data, cb) =>
        cb({ code: 0, msg: 'ok', details: [] }),
      );

      const service = new LynxResourcePrefetch();
      await service.request([
        { uri: 'https://x.com/a.jpg', type: 'image', priority: 'high' },
      ]);

      expect(requestMock).toHaveBeenCalledWith(
        {
          data: [
            {
              uri: 'https://x.com/a.jpg',
              type: 'image',
              param: { size: 0, priority: 'high' },
            },
          ],
        },
        expect.any(Function),
      );
    });

    it('request() includes all param fields', async () => {
      requestMock.mockImplementation((_data, cb) =>
        cb({ code: 0, msg: 'ok', details: [] }),
      );

      const service = new LynxResourcePrefetch();
      await service.request([
        {
          uri: 'https://x.com/a.jpg',
          type: 'image',
          priority: 'medium',
          cacheTarget: 'bitmap',
          preloadKey: 'hero',
          size: 524288,
        },
      ]);

      expect(requestMock).toHaveBeenCalledWith(
        {
          data: [
            {
              uri: 'https://x.com/a.jpg',
              type: 'image',
              param: {
                priority: 'medium',
                cacheTarget: 'bitmap',
                preloadKey: 'hero',
                size: 524288,
              },
            },
          ],
        },
        expect.any(Function),
      );
    });

    it('request() handles multiple resources', async () => {
      requestMock.mockImplementation((_data, cb) =>
        cb({ code: 0, msg: 'ok', details: [] }),
      );

      const service = new LynxResourcePrefetch();
      await service.request([
        { uri: 'https://x.com/a.jpg', type: 'image' },
        { uri: 'https://x.com/b.mp4', type: 'video', priority: 'low' },
      ]);

      expect(requestMock).toHaveBeenCalledWith(
        {
          data: [
            { uri: 'https://x.com/a.jpg', type: 'image' },
            {
              uri: 'https://x.com/b.mp4',
              type: 'video',
              param: { size: 0, priority: 'low' },
            },
          ],
        },
        expect.any(Function),
      );
    });

    it('cancel() passes resources to native cancel API', async () => {
      const mockResult = {
        code: 0,
        msg: 'canceled',
        details: [
          {
            code: 0,
            msg: 'canceled',
            uri: 'https://x.com/a.jpg',
            type: 'image' as const,
          },
        ],
      };
      cancelMock.mockImplementation((_data, cb) => cb(mockResult));

      const service = new LynxResourcePrefetch();
      const result = await service.cancel([
        { uri: 'https://x.com/a.jpg', type: 'image' },
      ]);

      expect(result).toEqual(mockResult);
      expect(cancelMock).toHaveBeenCalledWith(
        { data: [{ uri: 'https://x.com/a.jpg', type: 'image' }] },
        expect.any(Function),
      );
    });

    it('request() rejects when requestResourcePrefetch is missing', async () => {
      vi.stubGlobal('lynx', { cancelResourcePrefetch: cancelMock });

      const service = new LynxResourcePrefetch();
      await expect(
        service.request([{ uri: 'https://x.com/a.jpg', type: 'image' }]),
      ).rejects.toThrow('lynx.requestResourcePrefetch is not available');
    });

    it('cancel() rejects when cancelResourcePrefetch is missing', async () => {
      vi.stubGlobal('lynx', { requestResourcePrefetch: requestMock });

      const service = new LynxResourcePrefetch();
      await expect(
        service.cancel([{ uri: 'https://x.com/a.jpg', type: 'image' }]),
      ).rejects.toThrow('lynx.cancelResourcePrefetch is not available');
    });
  });
});
