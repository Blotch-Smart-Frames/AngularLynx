import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWrite } = vi.hoisted(() => ({ mockWrite: vi.fn() }));

vi.mock('node:fs', () => ({
  default: {
    createWriteStream: vi.fn(() => ({ write: mockWrite })),
  },
}));

vi.mock('node:path', () => ({
  default: {
    resolve: vi.fn((_cwd: string, filename: string) => `/mock-cwd/${filename}`),
  },
}));

import {
  createDevLoggerMiddleware,
  getLogFilePath,
} from './dev-logger-middleware.js';

type MockRes = {
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

const makeRequest = (method: string, url: string) => {
  const dataHandlers: ((chunk: Buffer) => void)[] = [];
  const endHandlers: (() => void)[] = [];

  const req = {
    method,
    url,
    on: vi.fn((event: string, handler: unknown) => {
      if (event === 'data')
        dataHandlers.push(handler as (chunk: Buffer) => void);
      if (event === 'end') endHandlers.push(handler as () => void);
    }),
  } as unknown as IncomingMessage;

  return {
    req,
    sendBody: (body: string) => {
      dataHandlers.forEach((h) => h(Buffer.from(body)));
      endHandlers.forEach((h) => h());
    },
  };
};

const makeRes = (): MockRes => ({ writeHead: vi.fn(), end: vi.fn() });

const postLogs = (logs: unknown[]) => {
  const middleware = createDevLoggerMiddleware();
  const res = makeRes();
  const { req, sendBody } = makeRequest('POST', '/__dev_logs');
  middleware(req, res as unknown as ServerResponse, vi.fn());
  sendBody(JSON.stringify({ logs }));
  return mockWrite.mock.calls[0]?.[0] as string | undefined;
};

describe('createDevLoggerMiddleware', () => {
  let middleware: (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => void;
  let res: MockRes;
  let next: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = createDevLoggerMiddleware();
    res = makeRes();
    next = vi.fn();
  });

  it('returns a function', () => {
    expect(typeof middleware).toBe('function');
  });

  describe('OPTIONS preflight for /__dev_logs', () => {
    it('responds 204 with CORS headers', () => {
      const { req } = makeRequest('OPTIONS', '/__dev_logs');
      middleware(req, res as unknown as ServerResponse, next);

      expect(res.writeHead).toHaveBeenCalledWith(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      expect(res.end).toHaveBeenCalled();
    });

    it('does not call next()', () => {
      const { req } = makeRequest('OPTIONS', '/__dev_logs');
      middleware(req, res as unknown as ServerResponse, next);

      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('non-matching requests', () => {
    it.each([
      ['GET', '/__dev_logs'],
      ['PUT', '/__dev_logs'],
      ['OPTIONS', '/other'],
      ['POST', '/other'],
      ['GET', '/'],
    ])('calls next() for %s %s', (method, url) => {
      const { req } = makeRequest(method, url);
      middleware(req, res as unknown as ServerResponse, next);

      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('POST /__dev_logs', () => {
    it('responds 204 with CORS header', () => {
      const { req, sendBody } = makeRequest('POST', '/__dev_logs');
      middleware(req, res as unknown as ServerResponse, next);
      sendBody(JSON.stringify({ logs: [] }));

      expect(res.writeHead).toHaveBeenCalledWith(204, {
        'Access-Control-Allow-Origin': '*',
      });
      expect(res.end).toHaveBeenCalled();
    });

    it('does not call next()', () => {
      const { req, sendBody } = makeRequest('POST', '/__dev_logs');
      middleware(req, res as unknown as ServerResponse, next);
      sendBody(JSON.stringify({ logs: [] }));

      expect(next).not.toHaveBeenCalled();
    });

    it('writes one line per log entry', () => {
      const { req, sendBody } = makeRequest('POST', '/__dev_logs');
      middleware(req, res as unknown as ServerResponse, next);
      const ts = Date.now();
      sendBody(
        JSON.stringify({
          logs: [
            { level: 'log', timestamp: ts, args: ['first'] },
            { level: 'error', timestamp: ts, args: ['second'] },
          ],
        }),
      );

      expect(mockWrite).toHaveBeenCalledTimes(2);
    });

    it('silently ignores malformed JSON and still responds 204', () => {
      const { req, sendBody } = makeRequest('POST', '/__dev_logs');
      middleware(req, res as unknown as ServerResponse, next);
      sendBody('{ not valid json');

      expect(res.writeHead).toHaveBeenCalledWith(204, {
        'Access-Control-Allow-Origin': '*',
      });
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('accumulates chunked body before parsing', () => {
      const dataHandlers: ((chunk: Buffer) => void)[] = [];
      const endHandlers: (() => void)[] = [];
      const req = {
        method: 'POST',
        url: '/__dev_logs',
        on: vi.fn((event: string, handler: unknown) => {
          if (event === 'data')
            dataHandlers.push(handler as (chunk: Buffer) => void);
          if (event === 'end') endHandlers.push(handler as () => void);
        }),
      } as unknown as IncomingMessage;

      middleware(req, res as unknown as ServerResponse, next);

      const payload = JSON.stringify({
        logs: [{ level: 'log', timestamp: Date.now(), args: ['chunked'] }],
      });
      const mid = Math.floor(payload.length / 2);
      dataHandlers.forEach((h) => h(Buffer.from(payload.slice(0, mid))));
      dataHandlers.forEach((h) => h(Buffer.from(payload.slice(mid))));
      endHandlers.forEach((h) => h());

      expect(mockWrite).toHaveBeenCalledTimes(1);
    });
  });
});

describe('log level labels', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['log', 'LOG'],
    ['warn', 'WRN'],
    ['error', 'ERR'],
    ['info', 'INF'],
    ['debug', 'DBG'],
  ])('formats level "%s" as label "%s"', (level, label) => {
    const written = postLogs([{ level, timestamp: Date.now(), args: ['msg'] }]);
    expect(written).toContain(label);
  });

  it('uppercases unknown levels', () => {
    const written = postLogs([
      { level: 'verbose', timestamp: Date.now(), args: ['msg'] },
    ]);
    expect(written).toContain('VERBOSE');
  });
});

describe('formatArg', () => {
  beforeEach(() => vi.clearAllMocks());

  const logArgs = (...args: unknown[]) => {
    return postLogs([{ level: 'log', timestamp: Date.now(), args }]) ?? '';
  };

  it('renders null as "null"', () => {
    expect(logArgs(null)).toContain('null');
  });

  it('renders strings directly without quoting', () => {
    expect(logArgs('hello world')).toContain('hello world');
  });

  it('renders Error objects with a stack using the stack', () => {
    const errArg = {
      __type: 'Error',
      name: 'TypeError',
      message: 'oops',
      stack: 'TypeError: oops\n  at foo:1',
    };
    expect(logArgs(errArg)).toContain('TypeError: oops\n  at foo:1');
  });

  it('renders Error objects without stack as "name: message"', () => {
    const errArg = {
      __type: 'Error',
      name: 'RangeError',
      message: 'out of bounds',
    };
    expect(logArgs(errArg)).toContain('RangeError: out of bounds');
  });

  it('renders plain objects as indented JSON', () => {
    const written = logArgs({ key: 'value' });
    expect(written).toContain('"key"');
    expect(written).toContain('"value"');
  });

  it('renders numbers as JSON', () => {
    expect(logArgs(42)).toContain('42');
  });

  it('joins multiple args with a space', () => {
    expect(logArgs('foo', 'bar', 'baz')).toContain('foo bar baz');
  });
});

describe('formatTimestamp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('formats timestamp as HH:MM:SS.mmm', () => {
    const written = postLogs([
      { level: 'log', timestamp: Date.now(), args: [] },
    ]);
    expect(written).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  });
});

describe('getLogFilePath', () => {
  it('returns the resolved log file path after first write', () => {
    vi.clearAllMocks();
    postLogs([{ level: 'log', timestamp: Date.now(), args: ['init'] }]);
    expect(getLogFilePath()).toBe('/mock-cwd/.dev-logs');
  });
});
