// Keyed async write-lock: serializes write transactions per key so concurrent
// API writes never contend on SQLite's single-writer lock (the POS "Complete
// Sale" 500 came from two overlapping interactive transactions timing out on
// the same database). Single-process friendly; a no-op when traffic is low.

const locks = new Map<string, Promise<unknown>>();

/**
 * Run `fn` while holding the write lock for `key`.
 * Callers with the same key are queued in arrival order; a failure of any
 * queued caller never breaks the chain for later callers.
 */
export function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  // Run regardless of whether the previous holder succeeded or failed.
  const result = prev.then(fn, fn);
  // Chain-safe tail: swallows the outcome so the queue never rejects.
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  locks.set(key, tail);
  void tail.finally(() => {
    // Free the map entry only if no newer caller has chained onto us.
    if (locks.get(key) === tail) locks.delete(key);
  });
  return result;
}
