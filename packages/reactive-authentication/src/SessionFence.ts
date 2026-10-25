import type { KeyValueStore } from "@key-value-kit/core"
import { createMemoryStore } from "@key-value-kit/storage/memory"
import { withLock } from "./locks.js"
import { SessionSupersededError } from "./SessionSupersededError.js"

export interface SessionFenceOptions {
    /**
     * Where the session generation is kept. Use the same persistent store (e.g. IndexedDB) as persisted
     * credentials so every tab and worker observes logout; the in-memory default fences only this realm.
     */
    readonly store?: KeyValueStore<number>

    /** Notify other tabs/workers immediately. Defaults to a `BroadcastChannel` when available. */
    readonly broadcast?: boolean
}

type FenceMessage = {type: "superseded", generation: number}

/**
 * Orders credential writes against logout.
 *
 * - Every upgrade captures {@link generation} before it starts and commits credentials with
 *   {@link commit}, which holds a *shared* Web Lock and re-reads the generation.
 * - {@link supersede} takes the same lock *exclusively*, so it waits for commits in progress, then
 *   increments the generation and clears stores. A commit that starts afterwards sees the new
 *   generation and fails closed with {@link SessionSupersededError}.
 * - {@link signal} aborts in-flight flows in this realm, and in other realms through `BroadcastChannel`.
 *
 * The Web Lock and the generation store must be shared by the realms to be fenced: with the default
 * memory store, other tabs are only fenced by the broadcast and their own storage.
 */
export class SessionFence {
    readonly #namespace: string
    readonly #store: KeyValueStore<number>
    readonly #channel: BroadcastChannel | undefined
    #controller = new AbortController()

    constructor(namespace: string, options: SessionFenceOptions = {}) {
        if (namespace.length === 0) throw new TypeError("A session namespace is required")
        this.#namespace = namespace
        this.#store = options.store ?? createMemoryStore()

        if (options.broadcast !== false && typeof BroadcastChannel === "function") {
            this.#channel = new BroadcastChannel(`reactive-authentication:${namespace}:fence`)
            this.#channel.onmessage = (event: MessageEvent<FenceMessage>) => {
                if (event.data?.type === "superseded") this.#abortLocal()
            }
            // Do not keep Node.js processes alive just to listen for logout.
            ;(this.#channel as {unref?: () => void}).unref?.()
        }
    }

    get namespace(): string {
        return this.#namespace
    }

    /** Aborted when the current session is superseded. Replaced by a fresh signal afterwards. */
    get signal(): AbortSignal {
        return this.#controller.signal
    }

    async generation(): Promise<number> {
        return await this.#store.getItem("generation") ?? 0
    }

    /** Throws {@link SessionSupersededError} if the generation moved on since `expected` was read. */
    async assertCurrent(expected: number): Promise<void> {
        if (await this.generation() !== expected) throw new SessionSupersededError()
    }

    /** Runs a credential write only if no supersession happened since `expected` was read. */
    async commit<T>(expected: number, write: () => Promise<T>): Promise<T> {
        return await withLock(this.#lockName, async () => {
            await this.assertCurrent(expected)
            return await write()
        }, {mode: "shared"})
    }

    /**
     * Ends the current session: waits for in-progress commits, increments the generation, runs `clear`,
     * aborts local in-flight work and notifies other realms.
     */
    async supersede(clear: () => Promise<void> = async () => {}): Promise<void> {
        await withLock(this.#lockName, async () => {
            const next = await this.generation() + 1
            await this.#store.setItem("generation", next)
            this.#abortLocal()
            this.#channel?.postMessage({type: "superseded", generation: next} satisfies FenceMessage)
            await clear()
        })
    }

    close(): void {
        this.#channel?.close()
    }

    get #lockName() {
        return `reactive-authentication:${this.#namespace}:fence`
    }

    #abortLocal() {
        this.#controller.abort(new SessionSupersededError())
        this.#controller = new AbortController()
    }
}
