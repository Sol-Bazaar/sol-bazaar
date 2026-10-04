/**
 * Minimal Result type for fallible operations that are expected and handled
 * inline (no exceptions). Keeps provider/HTTP plumbing readable.
 */
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E = string> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const map = <T, U>(r: Result<T, any>, f: (v: T) => U): Result<U, any> =>
  r.ok ? ok(f(r.value)) : r;

export const flatMap = <T, U, E>(r: Result<T, E>, f: (v: T) => Result<U, E>): Result<U, E> =>
  r.ok ? f(r.value) : r;

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function attemptWith<T, E>(fn: () => Promise<T>, onError: (e: unknown) => E): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(onError(e));
  }
}

/** Collect async work with bounded concurrency, preserving input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}