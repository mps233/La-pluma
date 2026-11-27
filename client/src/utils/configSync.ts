/**
 * Draft-then-sync protocol shared by the task pages.
 *
 * A page writes the local draft first, marks a pending token, and enqueues a
 * save. The save only commits when its token is still the pending one, so a
 * slow request cannot overwrite a newer edit. Keeping the token, queue, and
 * localStorage key handling here means the three pages cannot drift apart.
 */
export interface ConfigSyncGate {
  /** A fresh, monotonically increasing token for one draft generation. */
  nextToken(): string
  /** Serializes saves: each operation starts after the previous one settles. */
  enqueue<T>(operation: () => Promise<T>): Promise<T>
  /** The pending token, or null when no draft is unsynced. */
  pendingToken(key: string): string | null
  markPending(key: string, token: string): void
  clearPending(key: string): void
  /** True while the token is still the one the page should commit. */
  isCurrent(key: string, token: string): boolean
}

export function createConfigSyncGate(): ConfigSyncGate {
  let sequence = 0
  let queue: Promise<void> = Promise.resolve()

  return {
    nextToken: () => `${Date.now()}-${++sequence}`,
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const result = queue.then(operation, operation)
      queue = result.then(() => undefined, () => undefined)
      return result
    },
    pendingToken: key => localStorage.getItem(key),
    markPending: (key, token) => localStorage.setItem(key, token),
    clearPending: key => localStorage.removeItem(key),
    isCurrent: (key, token) => localStorage.getItem(key) === token,
  }
}
