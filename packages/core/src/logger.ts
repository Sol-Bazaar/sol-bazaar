/**
 * Structured JSON logger with per-request child scoping and secret redaction.
 * Keeps stdout machine-parsable so log shippers (Datadog/Loki/CloudWatch) work
 * without extra config.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE = /^(password|secret|token|apikey|api_key|authorization|cookie|mnemonic|seed|privatekey|private_key|codes?|code_cipher|signature|cookie|codesCipher)$/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 512 ? `${value.slice(0, 512)}…` : value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.split('\n').slice(0, 5).join('\n') };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(bindings: Record<string, unknown> = {}, minLevel?: Level): Logger {
  const threshold = LEVELS[minLevel ?? (process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;
  const name = bindings.service ?? 'app';

  const emit = (level: Level, msg: string, meta?: Record<string, unknown>) => {
    if (LEVELS[level] < threshold) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      service: name,
      msg,
      ...bindings,
      ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
    };
    const s = JSON.stringify(line);
    if (level === 'error') process.stderr.write(`${s}\n`);
    else process.stdout.write(`${s}\n`);
  };

  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
    child: (b) => createLogger({ ...bindings, ...b }, minLevel),
  };
}

export const logger = createLogger({ service: process.env.SERVICE_NAME ?? 'sol-bazaar' });