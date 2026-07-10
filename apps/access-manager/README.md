<!-- AUTHORED-BY Claude Fable 5 -->

# Solid Access Manager

See, review, grant and revoke access to your Solid pod — in plain, human terms
(data classes + purposes), not raw ACL triples. The standalone owner console of
the suite's access-management design
([`full-solid-ecosystem/docs/design/access-management-proposal.md` @ `8a069f4`](https://github.com/jeswr/full-solid-ecosystem/blob/main/docs/design/access-management-proposal.md)),
Phase 1 (the proposal's P2): it works **entirely against existing pod surfaces**
(WAC `.acl` documents, type indexes, an `ldp:inbox`) — no new server API.

> Status: under active development. It AUTHORS ACLs — security-critical; read
> "Security notes" before pointing it at data you care about.

## What it does (Phase 1)

- **Grant dashboard** — walks your storage (bounded depth, progressive
  loading), reads each governing `.acl`, and shows BOTH views: **by resource**
  (what is shared, with whom, which modes) and **by agent** (who can see
  what). Direct (`acl:accessTo`) vs inherited (`acl:default`) access is
  labelled; public access (`foaf:Agent`) is prominently flagged.
- **Revoke / edit** — remove an agent, downgrade modes (splitting the agent
  out of a shared authorization so nobody else's access changes), remove
  public access. Every ACL write is `If-Match`-guarded: on 412 the app
  re-reads and re-applies, surfacing a conflict after bounded retries. Edits
  are optimistic with revert-on-failure and a Saving…/Saved indicator.
- **Data-class view** — groups resources by your type-index registrations
  (`solid:publicTypeIndex` / `solid:privateTypeIndex` → `solid:forClass`), so
  you see "Contacts / Tasks / Bookmarks" instead of raw paths, with a
  per-class aggregate access summary.
- **Access-request inbox** — reads your pod's `ldp:inbox` for ODRL-shaped
  access requests (the proposal §3.2 shape: `odrl:permission` with
  `odrl:assignee` / `odrl:action` / `odrl:target`, an `odrl:purpose`
  constraint carrying a DPV purpose, and an `odrl:dateTime` expiry).
  Parsing is lenient — inbox contents are untrusted RDF; a malformed message
  drops fields or is listed as unparseable, never breaking the inbox.
- **Approve / deny** — the proposal's §3.5 CAS-pinned pipeline, client-side:
  approval first resolves the request's data class to the **concrete target
  set** and shows it ("approving shares exactly these N resources"); the
  `Pending → Approving` transition is an `If-Match` compare-and-set that
  persists the resolved snapshot + a deterministic
  `grantId = sha256(requestId ∥ resolvedTargetSet ∥ ownerWebID ∥ schemaVersion)`
  into the request; then the grant record and DPV consent receipt are written
  **create-only** (`If-None-Match: *`), then the WAC is materialised, then a
  CAS to `Approved`. Retries are idempotent from the stored snapshot — an
  interrupted approval offers a user-confirmed "finish approving exactly
  these" that never re-resolves. Concurrent approvals: the second CAS loses
  with a 412 and observes the winner — never two grants. Deny is a CAS to
  `Denied` plus a `dpv:ConsentRefused` receipt.
- **History / receipts** — DPV 2.2 consent records
  (`dpv:hasConsentStatus` ∈ ConsentGiven / ConsentRefused / ConsentWithdrawn,
  purpose, recipient, targets, timestamps) as the audit trail, plus one-click
  revocation of active grants (retracts the pinned WAC, flips the records).

## Dev quickstart

```sh
npm ci            # keyless — the lockfile pins git+https transports (ignore-scripts=true)
npm test          # vitest suite against an in-memory pod stub — no server needed
npm run gate      # lint (biome) + typecheck (tsc) + test (vitest) + build (vite)
npm run dev       # vite dev server
```

Login uses the suite stack: `<jeswr-login-panel>` (`@jeswr/solid-elements`)
over `@solid/reactive-authentication` (authorization-code + PKCE + DPoP popup;
`public/callback.html` is the popup contract) with silent session restore via
`@jeswr/solid-session-restore`. Set `VITE_CLIENT_ID` to a Client Identifier
Document URL for a stable client identity; without it, dynamic registration is
used (dev fallback). All data access flows through an injectable
authenticated-fetch seam, so every view is unit-testable with a stubbed fetch.

## Demo mode (`?demo`) + the GitHub Pages build

A login-free, read-only demo renders the REAL four views over an inert
in-browser fixture pod (the Ada-&-Bex sample scenario — `src/demo/`), so the
app can be embedded in walkthrough iframes with no auth and no network:

- `?demo` (or `?demo=dashboard`) — the grant dashboard
- `?demo=inbox` — the access-request inbox (one pending Clinic App request)
- `?demo=history` — consent receipts + active grants
- `?demo=dataclass` — the data-class view

Demo mode is gated STRICTLY on the `?demo` query param (`src/demo/gate.ts`);
without it the entry point builds the real `LoginController`, unchanged. The
demo fetch (`src/demo/pod.ts`) serves fixtures on GET/HEAD only and THROWS on
every mutating method, so Approve / Deny / Revoke are visibly present but
provably inert — the refusal surfaces in the saving indicator. Tests in
`test/demo/` cover the gate, the read-only pod, each view's fixtures, and the
no-write guarantee.

`npm run build:pages` produces the GitHub Pages bundle in `dist-pages/` with
`base=/solid-access-manager/` (for `https://jeswr.github.io/solid-access-manager/`);
the plain `npm run build` (Vercel) is unchanged.

## RDF discipline

Parsing via `@jeswr/fetch-rdf` (`fetchRdf` keeps the ETag for conditional
writes); `.acl` documents are read AND edited exclusively through
`@solid/object`'s typed `AclResource` / `Authorization` accessors (live
write-through wrapper sets) plus `@rdfjs/wrapper` mapping helpers; request /
grant policies go through `@jeswr/solid-odrl` (`policyFromRdf` /
`policyToRdf`); serialisation via `n3.Writer`. No hand-built triples anywhere.

## Security notes

- **Self-lockout guard**: an edit that would strip the owner's last
  `acl:Control` on a governing document is refused.
- **Materialise-on-grant**: granting on a resource that only has inherited
  access first creates its own ACL (create-only, race-safe) copying the
  applicable inherited entries — always including the owner's Control.
- **Targets are confined to your storage**: a request naming an off-pod IRI
  can never reach the ACL-write path, and a resumed approval re-validates the
  stored snapshot (in-storage targets + grantId recomputes) before any write.
- **Resume is user-confirmed**, showing the pinned targets — never an
  automatic sweep (see `docs/DECISIONS.md` D9 for the inbox-integrity residual).
- **Revocation is eventually-consistent** (proposal §6.1): retracting the WAC
  policy does not invalidate already-issued tokens until they expire. The app
  retracts policy + records; it does not claim instant revocation.

## What Phase 2 / 3 add (per the proposal)

- **Phase 2 (proposal P2/P1 follow-ups)**: write-by-class grants (target-pinned),
  the `@jeswr/solid-components` `AccessDeniedError` → "request access" hook,
  SHACL validation at resolution (trust the shape, not the label), and
  extraction of the reusable resolver into `@jeswr/solid-access-model`.
- **Phase 3 (P3)**: the browser extension widens its per-origin gate to
  per-(origin, data-class, modes, purpose, expiry) consent, enforced in the
  service worker.
- **Phase 4 (P4, CORE-PSS, maintainer-gated)**: the server-native
  Authorization Agent (`/.access/requests` + `/.access/grants`), storage-
  description discovery, and delegation chains with status-list revocation.

## License

MIT
