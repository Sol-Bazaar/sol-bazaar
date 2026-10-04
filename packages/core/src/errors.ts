/**
 * Typed application errors. Every error carries an HTTP status and a stable
 * machine-readable code so the REST layer never has to guess a response shape.
 */
export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'out_of_stock'
  | 'payment_required'
  | 'payment_expired'
  | 'underpaid'
  | 'rate_limited'
  | 'unprocessable'
  | 'provider_error'
  | 'chain_error'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  out_of_stock: 409,
  payment_required: 402,
  payment_expired: 410,
  underpaid: 402,
  rate_limited: 429,
  unprocessable: 422,
  provider_error: 502,
  chain_error: 502,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError('bad_request', m, d);
export const validationFailed = (m: string, d?: unknown) => new AppError('validation_failed', m, d);
export const unauthorized = (m = 'Missing or invalid credentials') => new AppError('unauthorized', m);
export const forbidden = (m = 'Not allowed') => new AppError('forbidden', m);
export const notFound = (m = 'Not found') => new AppError('not_found', m);
export const conflict = (m: string, d?: unknown) => new AppError('conflict', m, d);
export const outOfStock = (m: string, d?: unknown) => new AppError('out_of_stock', m, d);
export const rateLimited = (m = 'Too many requests', retryAfter?: number) => {
  const e = new AppError('rate_limited', m);
  if (retryAfter) (e as AppError & { retryAfter?: number }).retryAfter = retryAfter;
  return e;
};
export const providerError = (m: string, d?: unknown) => new AppError('provider_error', m, d);
export const chainError = (m: string, d?: unknown) => new AppError('chain_error', m, d);
export const internal = (m = 'Internal error') => new AppError('internal', m);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Normalise any thrown value into a loggable + client-safe pair. */
export function normaliseError(e: unknown): { code: ErrorCode; message: string; status: number; details?: unknown } {
  if (isAppError(e)) {
    return { code: e.code, message: e.message, status: e.status, details: e.details };
  }
  if (e instanceof Error) {
    return { code: 'internal', message: e.message, status: 500 };
  }
  return { code: 'internal', message: 'Unknown error', status: 500 };
}