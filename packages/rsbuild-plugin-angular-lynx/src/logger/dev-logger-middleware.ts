import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Connect-style middleware that receives log batches from on-device and
 * writes them to a log file. Rspeedy's TUI uses the alternate screen buffer,
 * so stdout writes are hidden — a file + `tail -f` is more reliable.
 */

/** The dev server path the app posts its log entries to. */
export const DEV_LOGS_PATH = '/__dev_logs';

/**
 * ANSI color codes (for the log file when viewed with `tail -f` in a terminal)
 */
const RESET = '\x1b[0m';
const GRAY = '\x1b[90m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BOLD = '\x1b[1m';

const LEVEL_COLORS: Record<string, string> = {
  log: WHITE,
  warn: `${BOLD}${YELLOW}`,
  error: `${BOLD}${RED}`,
  info: CYAN,
  debug: GRAY,
};

const LEVEL_LABELS: Record<string, string> = {
  log: 'LOG',
  warn: 'WRN',
  error: 'ERR',
  info: 'INF',
  debug: 'DBG',
};

const formatTimestamp = (ts: number): string => {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
};

// Exported for direct unit testing: the circular-reference fallback below is
// unreachable through the middleware (args always come from JSON.parse, which
// can't produce circular structures), so it's covered by calling formatArg with
// a genuinely circular object rather than by faking a request payload.
export const formatArg = (arg: unknown): string => {
  if (arg === null || arg === undefined) return String(arg);
  if (typeof arg === 'string') return arg;
  // Error objects don't survive JSON.stringify (the message/stack are
  // non-enumerable, so they'd serialize to `{}`). `LynxLogger` in
  // `runtime/src/lib/lynx-logger` reshapes Errors into a plain object with a
  // `__type: 'Error'` marker so we can reconstruct a readable representation
  // here — preferring the full stack trace when available.
  if (
    typeof arg === 'object' &&
    (arg as Record<string, unknown>).__type === 'Error'
  ) {
    const err = arg as { name: string; message: string; stack?: string };
    const header = err.message ? `${err.name}: ${err.message}` : err.name;
    if (!err.stack) return header;
    // V8's stack (the web preview) starts with the name and message, but
    // PrimJS's (the main thread on a device) holds only the frames.
    return err.stack.startsWith(header) ? err.stack : `${header}\n${err.stack}`;
  }
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    // JSON.stringify throws on circular references — fall back to String()
    // which produces something like "[object Object]" rather than crashing
    // the log handler and losing the rest of the batch.
    return String(arg);
  }
};

type LogEntry = {
  level: string;
  timestamp: number;
  args: unknown[];
};

const writeLog = (stream: fs.WriteStream, entry: LogEntry): void => {
  const color = LEVEL_COLORS[entry.level] || WHITE;
  const label = LEVEL_LABELS[entry.level] || entry.level.toUpperCase();
  const time = formatTimestamp(entry.timestamp);
  const args = entry.args.map(formatArg).join(' ');

  stream.write(`${GRAY}${time}${RESET} ${color}${label}${RESET} ${args}\n`);
};

/**
 * Creates a connect-style middleware that handles POST /__dev_logs and writes
 * the entries to `logFilePath`. Other requests are passed through to the next
 * middleware.
 *
 * The file is created, or emptied, right away: each dev server start begins a
 * fresh log, and `tail -f` can follow it before the first entry arrives.
 */
export const createDevLoggerMiddleware = (
  logFilePath: string,
): ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) => {
  const logFile = fs.createWriteStream(logFilePath, { flags: 'w' });
  return (req, res, next) => {
    // CORS preflight: the on-device Lynx runtime makes cross-origin POST
    // requests to the dev server (it runs at a different origin than the
    // bundled JS). Browsers/WebViews send an OPTIONS preflight first; without
    // a 204 response with these headers, the actual POST gets blocked and we
    // lose all on-device logs.
    if (req.method === 'OPTIONS' && req.url === DEV_LOGS_PATH) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== DEV_LOGS_PATH) {
      next();
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      // Reply 204 before parsing so the device doesn't wait on us — the log
      // relay batches entries and the client doesn't care about the response
      // body, only that the request didn't error.
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();

      try {
        const { logs } = JSON.parse(body) as { logs: LogEntry[] };
        for (const entry of logs) {
          writeLog(logFile, entry);
        }
      } catch {
        // Malformed payload — silently ignore. Throwing here would crash the
        // connect middleware chain and break the dev server for unrelated
        // requests.
      }
    });
  };
};
