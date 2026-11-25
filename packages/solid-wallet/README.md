<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
# @jeswr/solid-wallet

Generated document-vault metadata and a private Solid repository for Suite Wallet.
Experimental and security-critical. Tests require 100% coverage of every handwritten module. Run on Node 24 or a secure browser with WebCrypto.

`codegen/wallet.ttl`, `codegen/wallet.shacl.ttl` and `codegen.config.json` generate
all six files in `src/generated/`. `src/model.ts` is a thin facade over
`entities.WalletItem`; it exports vocabulary constants and permits `undefined`
to clear optional fields. No RDF accessors are handwritten. Generate with
`pnpm run codegen`; `test/codegen.test.ts` verifies every artifact byte for byte.

The entity is `https://schema.org/DigitalDocument`, with `schema:name`,
`schema:identifier`, `schema:validFrom`, `schema:expires`, `schema:description`,
`schema:keywords`, `schema:associatedMedia`, `dct:created`, and `dct:modified`.
The only extension terms are `https://jeswr.org/ns/wallet#itemKind`, `issuerName`,
`holderName`, `credential`, and `favourite`. Kind is an eleven-member literal enum.
Dates are `xsd:date`; timestamps are `xsd:dateTime`. The identity-sector profile
models people and asserted attributes rather than documents. This package does
not claim identity-sector conformance; all omissions and projections are recorded
in the SHACL header. Issuer and holder labels are display strings, never verified
identity assertions.

`expiryStatus(item, today, days = 30)` uses UTC calendar days. The expiry day and
30-day boundary are included in `expiring-soon`; documents expire the following
day. Missing expiry is `no-expiry`. `sortItems`, `groupItems`, `filterItems`, and
`inputDate` are pure helpers and do not mutate their arguments.

`summariseCredential` is display-only. `parseCredential` structurally validates
through solid-vc and compares canonical RDF against the supported public
verification projection, refusing lossy contexts or claims. `checkCredential`
checks signatures and returns an explicit explanation for verified, invalid,
expired, not-yet-valid, suspended, revoked and unknown results. Authentication failures
take precedence over dates and status supplied by an untrusted credential. A proof-purpose
or related-resource mismatch is invalid ("not valid for this use"), never "could not check". Callers must supply issuer key control and
status resolution; Suite does so with solid-vc's WebID and Bitstring Status List
resolvers on its credential-free public transport. Verification is not an
endorsement of the issuing authority. Unsupported DID resolvers, proofs and
JSON-LD projections remain unverified. The original VC source is never rewritten.

`createWalletRepository({ storage, fetch, webId })` provisions `wallet/`,
`wallet/files/` and `wallet/credentials/` using storage-client. Each item is its own
Turtle resource. Credentials (`storeCredential(source, name?)`; a stable `.json` name is create-only) are byte-exact `application/ld+json` resources capped
at 256 KiB, preserving any UTF-8 BOM; invalid UTF-8 is refused. JPEG/PNG/WebP/PDF uploads and streamed previews are capped at 10 MiB.
New items use server-returned URLs; edits and deletes use observed ETags. Preview
links and credential links are restricted to their respective wallet containers.
The list is limited to 500 candidate records and fails rather than truncating.
`list(onInvalidRecord?)` skips invalid, non-RDF and vanished records and reports
each skipped URL to its caller; access and transport errors still fail the list.
A failed first metadata write conditionally removes only its observed empty version.
`save(data, existing?, name?)` accepts a stable `.ttl` filename for create-only
seeds; existing records still require a matching version. Missing PUT validators
are recovered through HEAD and a matching metadata read, preserving conflict checks.

The repository uses pod-access's fail-closed `checkOwnerOnly` to check owner-only access,
including inherited resource and member rules, before listing or writing.
New empty containers receive owner-only access; existing shared or unsupported
permissions block further use and are never silently replaced. Refusals that are
entirely about the access model (`unsupported-model`, `unrepresentable`,
`not-storage-root`) throw `WalletUnsupportedError`; sharing and unknown access throw
`WalletPrivacyError`. `initialise` checks support at the storage root before creating
any folder on non-WAC storage, where ACP evaluation always reaches the root. Type Index
registration is private and delegated to pod-type-index. Settings, linked
preferences and custom private indexes must also have owner-only access.
WAC is supported. ACP requires the optional `acpDialect` from independently trusted
deployment configuration. Suite supplies none and fails closed on ACP deployments. Access checks and writes are separate requests, so server-side access
changes between them remain possible. The demo pod does not enforce permissions;
its ACL documents exercise this same code path without providing real isolation.

The app retains loaded data in memory while offline, requires a connection for
writes, and rolls back failed optimistic changes. There is no durable document
cache or outbox. Deletion has an eight-second undo window before its conditional
pod delete. Attachments and original credentials remain for undo and recovery;
permanent orphan cleanup is deferred. Closing the view flushes pending deletes immediately and lets in-flight saves finish
against their original session. Failures still reach the failure callback; detached
views receive no state updates.

Deferred: expiry notifications/Calendar integration; credential presentation
(OID4VP/share links); QR codes; Apple/Google pass import; encryption at rest;
orphan cleanup; a durable encrypted cache/outbox; LWS and ESS ACP provisioning.

The generator supports this profile without schema changes. Singleton trim is
not a supported config guard, so forms trim names and SHACL requires nonblank
names. solid-vc has no public arbitrary RDF-to-verification-object converter;
unsupported JSON-LD projections therefore report why they cannot be checked.
