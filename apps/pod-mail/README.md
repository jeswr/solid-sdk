# Pod Mail

> ⚠️ Experimental — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active development, not production-hardened.

A **Solid-native mail data layer**. Pod Mail models email-shaped messages, threads
and folders as RDF in a user's [Solid](https://solidproject.org) pod, so a person's
mail is **their own data** — portable, app-independent, and discoverable by other
apps through the Solid Type Index. This package is the **non-throwaway core**: the
typed data model and pod-shaped read/write/list. The UI and the IMAP/SMTP bridge are
deliberate follow-ups built on top of it.

Part of the [jeswr Solid app suite](https://github.com/jeswr) (per ADR-0013, the
suite's apps are built in parallel on a shared data-federation substrate).

## What's in this package

| Module | Role |
|---|---|
| `model/vocab` | Vocabulary constants (`schema:EmailMessage`, SIOC, DCTERMS, `solid:`). |
| `model/message` | Typed accessor over a single message — subject, body, sender, To/Cc/Bcc, dates, read flag, reply/thread links. |
| `model/thread` | Conversation/thread (`schema:Conversation` + `sioc:Thread`) with member messages. |
| `model/folder` | Mailbox folder (`schema:Collection`) with the well-known folders (Inbox/Sent/Drafts/Trash/Archive). |
| `model/mailbox` | `MailboxDataset` — enumerates message/thread/folder *sibling subjects* in a document; mints new ones. |
| `model/serialise` | Turtle serialisation via `n3.Writer` (prefix-complete, round-trips). |
| `model/store` | Pod-shaped read / write / list with WAC-aware errors and conditional (ETag) writes. |
| `model/typeIndex` | Solid Type Index read + write; registers the app's primary class (`schema:EmailMessage`) for cross-app discovery. |
| `model/paths` | Pod-shaped path conventions (containers end in `/`). |

## Design invariants

This package follows the suite RDF house rules:

- **Never a bespoke RDF parser.** Reads go through [`@jeswr/fetch-rdf`](https://www.npmjs.com/package/@jeswr/fetch-rdf)
  (one GET, content-type-dispatched parse). Extraction is through
  [`@solid/object`](https://www.npmjs.com/package/@solid/object) /
  [`@rdfjs/wrapper`](https://www.npmjs.com/package/@rdfjs/wrapper) typed accessors.
  Serialisation is `n3.Writer`. **Triples are never hand-built or string-concatenated.**
- **Pod-shaped.** Resources live in containers; the primary class is registered in the
  Type Index so other apps can find the user's mail. Discovery is a *hint*, not a grant —
  the store still attempts the GET to learn actual access.
- **WAC-aware.** The store distinguishes "not found" (`MailNotFoundError`) from "no access"
  (`MailAccessError`), and conditional-PUTs (`If-Match` / `If-None-Match: *`) so a write
  never silently clobbers a concurrent change (`MailConflictError` on 412).
- **Supply-chain hardened.** `ignore-scripts=true` — no npm lifecycle hook runs on install.

## Usage

```ts
import { MailStore, mailRoot, folderDocument, WellKnownFolders } from "@jeswr/pod-mail";

const store = new MailStore(); // uses the ambient (authenticated) globalThis.fetch
const inboxUrl = folderDocument(podRoot, WellKnownFolders.inbox);

// Load (or start empty), add a message reference, write back conditionally.
const loaded = await store.loadOrEmpty(inboxUrl);
const inbox =
  loaded.mailbox.findFolder(`${inboxUrl}#it`) ?? loaded.mailbox.createFolder(`${inboxUrl}#it`);
inbox.title = "Inbox";
inbox.addMessage("https://pod.example/mail/messages/m1.ttl#it");
// save() picks the precondition from loaded.exists + loaded.etag:
// create-only on a new resource, If-Match on an existing one with an ETag, and
// it refuses to blind-overwrite an existing ETag-less resource by default.
await store.save(loaded);
```

Auth is the caller's concern: the suite default is
[`@solid/reactive-authentication`](https://www.npmjs.com/package/@solid/reactive-authentication),
which patches `globalThis.fetch`, so `new MailStore()` is authenticated automatically. Pass
`{ fetch }` to inject a specific fetch.

## Federation

`public/clientid.jsonld` is a Solid Client Identifier Document carrying an interim
`fedapp:` block (sectors / consumes / produces / access) so the app is
federation-registry-ready. The `fedapp:` namespace (`https://w3id.org/jeswr/fed`) is
**O1-gated** and does not yet resolve; the IRIs are the intended targets and will be
confirmed once the namespace is frozen and the registry engine ships.

## Gate

```bash
npm run lint        # biome
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run coverage    # vitest --coverage (100% on the data layer)
npm run build       # tsc -> dist/
npm run gate        # all of the above
```

The data layer is held to **100% coverage** (lines / statements / functions / branches),
with one genuinely-unreachable defensive guard explicitly excluded.

## Tracked follow-ups

These are deliberate next steps, tracked outside this repo (no markdown TODO lists here):

- **Next.js UI** via `create-solid-app` once that scaffold lands — the throwaway-UI shell is
  *not* hand-rolled here on purpose.
- **IMAP/SMTP bridge** — ingest external mail into the pod model and send out; this package is
  the archive/data layer the bridge writes through.
- **Cross-server E2E matrix** — including prod-solid-server (PSS) with both **passkey** and
  **username/password** login, plus CSS (WAC + ACP) and ESS, driven by the suite's
  `solid-test-infrastructure` harness.
- **Coverage-ratchet gate** that runs the data layer against every well-known server in the
  suite matrix (not just an in-memory store), ratcheting coverage so it never regresses.
- **Sector-vocab ADR** — confirm/replace the interim `fedapp:` IRIs once the
  `https://w3id.org/jeswr/fed` namespace is frozen (O1 gate).

## Licence

MIT.
