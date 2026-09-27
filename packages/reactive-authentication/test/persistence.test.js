import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import "fake-indexeddb/auto"
import { createBrowserCaches } from "../dist/mod.js"
import { startOpenIdProvider, startSolidStorage } from "./helpers/openid.js"
import { solidClient } from "./helpers/solid.js"
import { withMockedDate } from "./helpers/clock.js"

let op, rs
before(async () => {
    op = await startOpenIdProvider({expiresIn: 20})
    rs = await startSolidStorage(op)
})
after(async () => {
    await rs.close()
    await op.close()
})

/** A "page load": fresh providers over the same IndexedDB namespace; records what reaches the session store. */
function load(namespace) {
    const caches = createBrowserCaches(namespace, {persistSessions: true})
    const written = []
    const setItem = caches.sessions.setItem.bind(caches.sessions)
    caches.sessions.setItem = async (key, value) => { written.push(value); await setItem(key, value) }
    return {caches, written, ...solidClient(op, rs, {fence: caches.fence, provider: {namespace, sessionStore: caches.sessions, fence: caches.fence}})}
}

test("IndexedDB refresh-only records restore a session after reload with the non-extractable DPoP key", async () => {
    const namespace = `app-${crypto.randomUUID()}`
    const first = load(namespace)
    assert.equal((await first.manager.fetch(`${rs.url}/alice/1`)).status, 200)
    const [record] = first.written
    assert.equal(record.dpopKey.privateKey.extractable, false)
    assert.equal(JSON.stringify(record).includes("access_token"), false)
    assert.equal(record.tokenResult, undefined)

    const second = load(namespace)
    const refreshes = op.stats.refresh
    assert.equal((await second.manager.fetch(`${rs.url}/alice/2`)).status, 200)
    assert.equal(second.code.calls, 0, "restored without a window")
    assert.equal(op.stats.refresh, refreshes + 1)
    assert.equal(op.stats.reuse, 0)
    first.caches.fence.close(); second.caches.fence.close()
})

test("a failing delete before refresh prevents consuming the refresh token", async () => {
    const namespace = `app-${crypto.randomUUID()}`
    const first = load(namespace)
    assert.equal((await first.manager.fetch(`${rs.url}/alice/d`)).status, 200)

    const second = load(namespace)
    second.caches.sessions.removeItem = async () => { throw new Error("denied") }
    const refreshes = op.stats.refresh
    await assert.rejects(second.manager.fetch(`${rs.url}/alice/d`), /denied/)
    assert.equal(op.stats.refresh, refreshes, "refresh token not consumed")
    first.caches.fence.close(); second.caches.fence.close()
})

test("invalid_grant falls back to a new authorization; other refresh errors propagate and leave nothing usable", () => withMockedDate(async advance => {
    const namespace = `app-${crypto.randomUUID()}`
    const first = load(namespace)
    assert.equal((await first.manager.fetch(`${rs.url}/alice/g`)).status, 200)

    op.failRefresh("invalid_grant")
    try {
        advance(21_000) // expired: the next request must refresh
        assert.equal((await first.manager.fetch(`${rs.url}/alice/g`)).status, 200)
        assert.equal(first.code.calls, 2, "re-authorized after invalid_grant")

        op.failRefresh("temporarily_unavailable")
        advance(21_000)
        await assert.rejects(first.manager.fetch(`${rs.url}/alice/g`), e => e.error === "temporarily_unavailable")
        op.failRefresh(undefined)
        assert.equal((await first.manager.fetch(`${rs.url}/alice/g`)).status, 200)
        assert.equal(first.code.calls, 3, "the consumed record was not kept after the failed refresh")
    } finally {
        op.failRefresh(undefined)
        first.caches.fence.close()
    }
}))

test("logout through the persistent fence clears IndexedDB records for later loads", async () => {
    const namespace = `app-${crypto.randomUUID()}`
    const first = load(namespace)
    assert.equal((await first.manager.fetch(`${rs.url}/alice/l`)).status, 200)
    await first.manager.logout()

    const second = load(namespace)
    assert.equal(await second.provider.restore(new Request(`${rs.url}/alice/l`)), undefined)
    first.caches.fence.close(); second.caches.fence.close()
})
