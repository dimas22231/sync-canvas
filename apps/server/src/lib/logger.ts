/**
 * Logger terstruktur (JSON per baris) tanpa dependensi eksternal.
 *
 * Output JSON memudahkan agregasi di Docker/Kubernetes (Loki, CloudWatch, dsb.)
 * tanpa harus mem-parsing teks bebas. Untuk produksi skala besar, logger ini
 * bisa diganti dengan pino/winston tanpa mengubah pemanggil (interface stabil).
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

type Meta = Record<string, unknown>;

export interface Logger {
  debug(message: string, meta?: Meta): void;
  info(message: string, meta?: Meta): void;
  warn(message: string, meta?: Meta): void;
  error(message: string, meta?: Meta): void;
  /** Membuat logger turunan yang selalu membawa field kontekstual. */
  child(bindings: Meta): Logger;
}

function serializeError(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function normalizeMeta(meta?: Meta): Meta {
  if (!meta) return {};
  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => [
      key,
      key === 'error' || value instanceof Error ? serializeError(value) : value,
    ]),
  );
}

export function createLogger(level: LogLevel, bindings: Meta = {}): Logger {
  const threshold = SEVERITY[level];

  const write = (entryLevel: LogLevel, message: string, meta?: Meta): void => {
    if (SEVERITY[entryLevel] < threshold) return;

    const entry = {
      level: entryLevel,
      time: new Date().toISOString(),
      message,
      ...bindings,
      ...normalizeMeta(meta),
    };
    const line = JSON.stringify(entry);

    if (entryLevel === 'error') console.error(line);
    else if (entryLevel === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
  };
}
