/**
 * Runs `callback` while holding a Web Lock.
 *
 * Web Locks coordinate every tab and worker of an origin's storage partition, which is what makes
 * rotating refresh tokens safe to share through persistent storage. They do not coordinate separate
 * browsers, devices or server processes.
 */
export async function withLock<T>(name: string, callback: () => Promise<T>, options: {mode?: LockMode, signal?: AbortSignal} = {}): Promise<T> {
    const locks = globalThis.navigator?.locks
    if (locks === undefined) {
        throw new Error("The Web Locks API is required (browsers, workers, Node.js >= 24.5)")
    }

    const lockOptions: LockOptions = {mode: options.mode ?? "exclusive"}
    if (options.signal !== undefined) lockOptions.signal = options.signal
    return await locks.request(name, lockOptions, async () => await callback())
}

/**
 * A stable, secret-free key for caches and lock names, derived from the parts of a credential context.
 *
 * Parts are length-prefixed before hashing so `["a:b", "c"]` and `["a", "b:c"]` differ.
 */
export async function contextKey(kind: string, parts: readonly (string | undefined)[]): Promise<string> {
    const text = parts.map(p => p === undefined ? "-" : `${p.length}:${p}`).join("|")
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")
    return `${kind}:${hex}`
}
