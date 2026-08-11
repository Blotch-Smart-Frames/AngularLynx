import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LynxTextMeasure } from './text-measure';

describe('LynxTextMeasure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('when lynx is unavailable', () => {
    it('measure() throws', () => {
      const service = new LynxTextMeasure();
      expect(() => service.measure('hello', { fontSize: '14px' })).toThrow(
        'lynx.getTextInfo is not available',
      );
    });
  });

  describe('when lynx is available', () => {
    let getTextInfoMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      getTextInfoMock = vi.fn();
      vi.stubGlobal('lynx', { getTextInfo: getTextInfoMock });
    });

    it('returns { width: 0 } for empty text without calling native', () => {
      const service = new LynxTextMeasure();
      const result = service.measure('', { fontSize: '14px' });

      expect(result).toEqual({ width: 0 });
      expect(getTextInfoMock).not.toHaveBeenCalled();
    });

    it('passes options directly to lynx.getTextInfo', () => {
      getTextInfoMock.mockReturnValue({ width: 42 });
      const service = new LynxTextMeasure();

      service.measure('hello', { fontSize: '16px' });

      expect(getTextInfoMock).toHaveBeenCalledWith('hello', {
        fontSize: '16px',
      });
    });

    it('returns the native result as-is', () => {
      getTextInfoMock.mockReturnValue({ width: 85.5 });
      const service = new LynxTextMeasure();

      const result = service.measure('test', { fontSize: '14px' });

      expect(result.width).toBe(85.5);
    });

    it('passes all options including fontFamily', () => {
      getTextInfoMock.mockReturnValue({ width: 50 });
      const service = new LynxTextMeasure();

      service.measure('text', { fontSize: '14px', fontFamily: 'PingFang SC' });

      expect(getTextInfoMock).toHaveBeenCalledWith('text', {
        fontSize: '14px',
        fontFamily: 'PingFang SC',
      });
    });

    it('passes maxWidth and maxLine', () => {
      getTextInfoMock.mockReturnValue({
        width: 100,
        content: ['hello', 'world'],
      });
      const service = new LynxTextMeasure();

      service.measure('hello world', {
        fontSize: '14px',
        maxWidth: '60px',
        maxLine: 2,
      });

      expect(getTextInfoMock).toHaveBeenCalledWith('hello world', {
        fontSize: '14px',
        maxWidth: '60px',
        maxLine: 2,
      });
    });

    it('returns content array from native result', () => {
      getTextInfoMock.mockReturnValue({
        width: 120,
        content: ['line one', 'line two', 'line three'],
      });
      const service = new LynxTextMeasure();

      const result = service.measure('long text', {
        fontSize: '14px',
        maxWidth: '80px',
        maxLine: 3,
      });

      expect(result.content).toEqual(['line one', 'line two', 'line three']);
    });

    it('omits content when native returns none', () => {
      getTextInfoMock.mockReturnValue({ width: 42 });
      const service = new LynxTextMeasure();

      const result = service.measure('short', { fontSize: '14px' });

      expect(result.content).toBeUndefined();
    });
  });
});
