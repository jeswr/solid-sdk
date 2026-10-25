---
name: solid-offline
description: Use when a Solid app flashes a loading screen on reopen, needs a durable WebID-scoped snapshot with background revalidation, leaks cached data across account switches, or must round-trip Date/Set/Map values safely. The package skill governs the solid-offline service-worker API; this skill supplies app caching patterns.
---

## Quick reference

Cached pod data is never authoritative: paint a matching WebID-scoped snapshot, then revalidate.
Put the authenticated WebID in both cache key and envelope; clear on logout and account switch.
Use explicit per-key codecs for durable snapshots; unregistered keys stay memory-only.
Use the [package skill](../../packages/solid-offline/SKILL.md) for `createOfflineClient`, worker wiring, status hooks, and logout purge. Its API and security rules take precedence over this pattern guide.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

<!-- AUTHORED-BY Claude Opus 4.8 -->

# Offline / instant-load — stale-while-revalidate from a WebID-scoped cache

Read the companion [`AGENTS.md`](../../AGENTS.md)
first; this skill assumes that stack (`@solid/reactive-authentication` patches `globalThis.fetch`,
reads go through `@jeswr/fetch-rdf`, live-sync via the `solid-notifications` skill).

A Solid app that re-reads every resource from the pod on each open shows a blank "Loading…"
screen for the round-trip — even when the data was already known a moment ago. The fix is
**stale-while-revalidate**: on mount, hydrate the UI **synchronously** from a durable client cache
so the app paints **instantly**, then fetch from the pod in the background and reconcile. Never
show a blank/loading state when a cache exists. The **write** side of the same "instant" goal —
optimistic, non-blocking mutations — is the
[`solid-app-shell`](../solid-app-shell/SKILL.md)
skill.

This is an **app-level snapshot pattern** (`localStorage`/`IndexedDB` render-shaped data).
The service-worker read-through cache now lives in [the workspace package](../../packages/solid-offline/README.md),
with `WebSocketChannel2023` invalidation (the `solid-notifications` skill).
Until that layer is wired into an app, hold the snapshot cache yourself as below.
For APIs, use [packages/solid-offline/SKILL.md](../../packages/solid-offline/SKILL.md);
its current API and security guidance wins over the [historical availability note](references/source-availability-note.md).

## The pattern

1. **Seed React state from the cache during the initial render** — not in an effect. A synchronous
   cache (`localStorage`, or an in-memory mirror you populated earlier) lets you pass an initializer
   to `useState` so the first paint already has data:
   ```ts
   const [snapshot, setSnapshot] = useState(() => hydrate(webId, resourceUrl));
   ```
   An effect runs *after* paint, so hydrating there reintroduces the blank flash. (`IndexedDB` is
   async — for it, accept one async hydrate but still gate the loading state, below.)
2. **Distinguish "nothing yet" from "have cached/loaded data".** Keep an `initialLoading` flag that
   is true **only** when you have neither a cache hydrate nor a completed fetch — so a
   cache-hydrated view is never treated as "loading". A background revalidation must not flip the UI
   back to a spinner.
3. **Revalidate in the background and reconcile.** Fetch from the pod after mount (and on
   live-sync), then replace the snapshot. Write the fresh result back to the cache so the next
   reopen paints from it.
4. **Guard against out-of-order fetches.** A slow older read (e.g. a live-sync refresh that started
   before a mutation) must never clobber a newer result — gate writes behind a monotonic sequence
   number (`++seq; … if (seq !== current) return;`).

## Security — the cache MUST be scoped to the authenticated WebID

This is the load-bearing part, and the easy thing to get wrong. **A real HIGH was caught in
review**: an un-scoped cache let one signed-in user's private pod data paint for a *different* user
on the same browser (shared device, account switch, or just signing out and a colleague signing
in) before authorization could revalidate. Issue data can differ per viewer (private resources,
per-agent ACLs), so a snapshot one identity cached must **never** be shown to another.

The scoping rule has four parts — apply **all** of them:

- **Put the WebID in BOTH the storage key AND the stored envelope.** The key keeps two users from
  sharing a slot; the in-envelope WebID is checked on read as defence-in-depth (a key collision or
  a copied entry can't leak). Use a separator that cannot appear in a URL (e.g. a NUL byte) so a
  crafted WebID/resource can't forge another pair's key:
  ```ts
  const keyFor = (webId: string, resourceUrl: string) => `${PREFIX}${webId}\u0000${resourceUrl}`;
  ```
- **Hydrate ONLY when the envelope's WebID matches the current authenticated identity.** A missing
  WebID (not signed in yet) or a mismatch is a cache **MISS** — never a hydrate, never a "show it
  while we check". Read the WebID from your authenticated session, not from the cache.
- **Clear the cache on account switch AS WELL AS logout.** Logout-only clearing leaves the previous
  user's snapshots on a switched device. Clear everything on both transitions.
- **VERSION the envelope.** Bump a schema version on any shape change — including the moment you
  *introduce* WebID scoping — so legacy un-scoped entries become unreadable and cannot be
  resurrected. A version mismatch is a MISS.

```ts
interface CacheEnvelope {
  v: number;          // schema version — bump to invalidate all entries (incl. legacy un-scoped)
  at: number;         // epoch ms — for a max-age bound on first-paint freshness
  webId: string;      // the identity that fetched this — only this WebID may paint it
  resource: string;   // the resource it belongs to — defence-in-depth vs key collisions
  data: unknown;      // render-shaped snapshot
}

// MISS on: no storage, no resource, no authenticated WebID, version mismatch,
// WebID mismatch, resource mismatch, too old, or unparseable.
function read(webId: string | null, resourceUrl: string, now = Date.now()): unknown | null {
  if (!webId || !resourceUrl) return null;           // no identity ⇒ never hydrate
  const raw = storage.getItem(keyFor(webId, resourceUrl));
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as CacheEnvelope;
    if (env.v !== VERSION || env.webId !== webId || env.resource !== resourceUrl) return null;
    if (now - env.at > MAX_AGE_MS) return null;       // bound first-paint staleness; still revalidates
    return env.data;
  } catch {
    return null;                                       // corrupt entry is never a blocker
  }
}
```

Mirror the same WebID scoping in the **live in-memory layer**, not just the durable cache: tag the
in-memory snapshot with the WebID that fetched it, and derive the rendered view only when BOTH the
resource AND the WebID match the active identity — so a view fetched by a previous user is neither
rendered nor preserved when the identity changes (even if the resource URL is unchanged), no matter
when a slow fetch lands.

## Best-effort, never load-bearing

The cache is an optimisation. Any read/parse/quota error must degrade to "no cache" (a normal
network fetch), never throw and block the app. Swallow `localStorage` quota errors on write; treat
a corrupt entry as a MISS. The pod remains the source of truth — the cache only changes *when* the
user first sees data, never *what* is authoritative.

`localStorage` is synchronous and size-capped: fine for small render snapshots (a list of
records), and its synchronous read is exactly what enables the first-paint hydrate. A larger
payload moves to `IndexedDB` at the cost of an async hydrate (then gate `initialLoading` until that
hydrate settles, rather than seeding state synchronously).

## In-memory cache ≠ cold open — and the value must round-trip

Two distinct layers, often conflated:

- An **in-memory** stale-while-revalidate cache (e.g. an SWR map) survives *in-tab navigation* (home→away→home serves cached, no refetch) — but it is **lost on a full page reload**, so it does **nothing** for the cold-open loading screen. If a view bypasses the in-memory cache entirely (a raw `useEffect`+`fetch` per mount), it refetches even on in-tab navigation.
- The **durable** snapshot (this skill) is what kills the *cold-open* spinner: persisted, WebID-scoped, hydrated **synchronously** on mount. You usually want both — route every cached read through the in-memory layer, and mirror it to durable.

**Serialization must round-trip — guard the durable boundary with codecs.** A durable cache that does blanket `JSON.stringify`/`JSON.parse` of a generic `T` silently corrupts any value that isn't JSON-plain: a `Date` hydrates back as a **string**, a `Set`/`Map`/`URL`/class instance loses its type — while TypeScript still hands it back typed as `T`, so cold-open rendering breaks or shows wrong data with no error. Make durable persistence **opt-in per cache key with an explicit codec** (`encode → JsonValue`, `decode → T`): a key with **no registered codec is memory-only** (the safe default — it can never silently persist a non-round-trippable shape), and a model with `Date` fields registers a codec that revives them. **Field-scope the reviver — never a generic "revive every ISO-looking string" walker.** A user-controlled string field can legitimately *be* an ISO-date string (a task titled `"2026-01-01"`); a blanket deep reviver turns it into a `Date`, and the next `title.trim()` throws on cold hydration. Revive only the **known** date fields (`created`, `endedAt`, …) by path, leaving every other field its parsed type. Test the round-trip through the **real** persisted path (an actual/in-memory `Storage`), not a fake double — a fake bypasses exactly the serialization boundary that bites — and assert a date-shaped *title* stays a string.

## Gotchas

| Gotcha | Detail |
|---|---|
| Blank flash returns | Hydrating in a `useEffect` paints empty first — seed `useState` with an initializer (sync cache) instead |
| In-memory cache "fixes" nothing on reload | In-memory survives navigation, NOT cold open — add a durable snapshot for first-paint; route raw-fetch views through the cache so navigation stops refetching |
| `Date`/`Set`/`Map` hydrate as the wrong type | Blanket `JSON.parse` of generic `T` drifts types silently — opt-in per-key codecs; unregistered key = memory-only; test the real Storage round-trip |
| Generic date-reviver crashes on a date-shaped title | A deep "revive every ISO string" reviver turns a user `title`/`description` that looks like a date into a `Date` → `title.trim()` throws — field-scope the reviver to KNOWN date paths only |
| `.ts` test file committed as binary | Tests for WebID-scoped keys often embed the `\u0000` separator as a **literal NUL** → git treats the file as binary (unreviewable, breaks tooling) — write it as the escape `"\u0000"`, not a raw NUL byte |
| One user's data shown to another | The HIGH this skill exists for — WebID in key **and** envelope, hydrate only on identity match, clear on switch+logout, version the envelope |
| Stale data after logout on a shared device | Logout-only clearing isn't enough — clear on **account switch** too |
| Legacy entries resurrect after a shape change | Un-versioned envelopes — bump `VERSION` (including when you introduce WebID scoping) so old entries are a MISS |
| Slow refresh clobbers newer data | Background/live-sync fetches race — gate the apply behind a monotonic fetch sequence |
| Spinner during background revalidation | `loading` conflated with `initialLoading` — `initialLoading` is true only with no cache **and** no completed fetch |

---

*Learned building [`jeswr/solid-issues`](../../apps/issues/README.md): the WebID-scoped
durable cache in [`src/lib/issue-cache.ts`](../../apps/issues/src/lib/issue-cache.ts)
(`readIssueCache`/`writeIssueCache`/`clearAllIssueCaches`, versioned `CacheEnvelope`) and the
WebID-scoped in-memory snapshot in [`src/lib/use-issues.ts`](../../apps/issues/src/lib/use-issues.ts)
(`hydrate`, the `TrackerSnapshot` tagged with `creator`), commit `ca0c687`. The cross-user-leak HIGH
was a roborev finding fixed in that change.*
