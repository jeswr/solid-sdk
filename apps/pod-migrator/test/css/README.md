<!-- AUTHORED-BY Codex GPT-6 -->

# Real Community Solid Server integration tests

From the workspace root, with Node 24 on PATH:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm --filter @jeswr/app-pod-migrator run test:css
```

This starts the **installed CSS 7.2.0** twice, on dynamically allocated IPv4
loopback ports. Configs are composed from its shipped `file.json` and
`file-acp.json`, replacing the backend and resource locker with the shipped
memory variants. Registration, password login, pod creation, OIDC, authorization,
and the corresponding ACL/ACR auxiliary strategies remain enabled. CSS 7.2's
initializer uses `listen(port)`; the isolated child launcher supplies the missing
loopback bind address. Processes and temporary config directories are cleaned up
on success and failure, with a bounded shutdown and forced termination fallback.
Component discovery is explicitly scoped to CSS 7.2's components and the local
Components.js context. Automatic discovery would walk into the pnpm workspace,
mix unrelated installed versions, and attempt remote context downloads. Both
composed configurations have been instantiated offline without starting a listener.

The suite creates accounts through `/.account/`, follows its returned controls,
uses the returned pod/WebID, and discovers the OIDC token endpoint. Client
credentials are exchanged using ES256 DPoP proofs made with `node:crypto`.
Resource proofs include `ath`; nonce retries are bounded, proofs are fresh on
retry, expiring tokens are renewed, and credentials cannot follow redirects or
leave the explicitly allowed test server origins. No credentials are logged.

Source fixtures live in a container within each source owner's pod; each
migration gets a fresh destination pod. This keeps CSS's generated WebID profile
usable while giving the migrator a controlled source tree. Both servers also
have a stranger account. The same two strangers are probed against both sides,
so named-agent comparisons use the same WebID, including across issuers.

The scenarios cover WAC → ACP (skip and expand), ACP → WAC, WAC → WAC, and
ACP → ACP. They exercise every resolution option type: skip, expand, owner-only,
per-resource, overwrite, merge, drop-overlapping, acknowledge, and abort. Every
offered abort decision is exercised for both cross-model directions; the write
counter must remain zero and the target snapshot must remain identical. The
suite logs each scenario, decisions, copied files, writes, and intermediate
permission comparison counts. Assertion failures and startup failures exit
nonzero; live scenarios are never silently skipped.

Data includes nested containers, Turtle, JSON, all byte values in a binary file,
and a filename containing spaces and Unicode. The full scenarios explicitly enable
IRI rewriting: Unicode RDF with ambiguous length framing can establish graph
completeness through CSS conversion, but cannot prove the original lexical bytes.
A separate scenario requires the default byte-verbatim migration to refuse those
resources before any writes. Final checks compare exact non-RDF bytes and exact
reserialized/re-written RDF bytes, container membership, effective permissions, owner access to each access
document, and owner ability to conditionally replace it. Grants to the named
stranger must preserve Read and Append, including a successful insertion PATCH
whose bytes are then restored by the owner. The stranger must also be refused
an access-document edit. Permission equality is required for
faithful resources; reviewed losses must remain subsets of the source.

The engine's `onProgress` callback is synchronous and does not cover each
individual PUT. The harness therefore fences **every target transport write**
with an awaited `onProgress` observer and also records the engine's own progress
events. The observer probes the changed resource after every write, including
empty placeholders, initial locks, content copies, and final grants. A container
write also probes every existing descendant, since parent controls can widen them.
Unknown write URLs trigger a full audit. Previously checked unrelated resources
need no repeated probes; final verification still covers the entire migrated tree.
It checks anonymous access and both stranger identities before the executor can
issue its next write. Observer errors fail execution and are rethrown by the
test even if the engine returns them in its result.

WAC permissions come from CSS's HTTP `WAC-Allow` evidence. The shipped ACP config
does not install the WAC-Allow metadata writer. For ACP, or when a read is denied,
the probe also sends conditional PUT/PATCH requests with a random nonmatching
`If-Match`. Authorization precedes conditional checks in CSS 7.2, so HTTP 412
proves the requested permission without a mutation. An existing-container PUT
returns 409 after authorization in CSS; only that specific context accepts 409.
PATCH has a nonempty insert serialized with `n3.Writer`, so append-only grants
cannot hide behind a denied GET. Unexpected errors, missing resources, malformed
headers, and successful conditional mutations fail the probe.

CSS 7.2's WAC access-checker configuration does not enforce `acl:origin`. The
fixture still carries that condition, requires its omission decision for ACP,
and verifies that migration does not widen actual server permissions. This does
not certify origin enforcement on CSS. CSS's `OwnerPermissionReader` grants pod
owners recovery access to their access documents regardless of ACL contents.
The WAC source therefore uses a delegated migration session with Control on the
tree and body access without Control on the unreadable-ACL fixture. This exercises
a real HTTP 403 and both skip and owner-only resolutions. The actual pod owner
keeps recovery access; the target owner must retain Control everywhere.
CSS client-credential IDs are opaque labels, whereas RDF IRI-valued `acp:client` matchers
resolve relative values against the ACR URL. The `client.ttl` fixture explicitly uses that
absolute IRI; these harness tokens carry the bare label and must have no Read there. Removing
the client condition would expose Read and fail the comparison. Offline tests prove both
positive matching with the resolved IRI and negative matching with the actual label, and
check exact issuer matching (including trailing slashes). This harness does not claim a live
positive client-IRI grant for CSS's opaque client-credential tokens. Named WebIDs remain the
same identities across both servers; target issuers and target owners are never substituted.
ESS/PodSpaces and its UMA behavior are outside this local CSS suite.

CSS fixtures use resource `acl:Control`, without ESS-style ACR-self/`acp:access` grants.
The earlier mixed-dialect fixtures triggered the engine's intentional refusal, hiding ACP
translation decisions and disabling target merge/owner-only choices. A dedicated live
regression keeps that mixed document: the plan offers only skip/abort for its target paths,
execution makes zero writes, and real ACR GET (200) and nonmatching conditional PUT (412)
requests prove both the owner and a separate delegate retain Control. The engine reports the
actual parse refusal instead of incorrectly reporting owner lock-out. Legitimate CSS fixtures
exercise merge, overwrite, group expansion, source owner-only, denial narrowing and every other
option; unsafe target documents still never offer owner-only or merge.

The live file uses `.integration.ts`, excluded by the default app test glob.
Offline helpers use `.test.ts` and also run in the default app tests. They can be
run independently without opening any listening sockets:

```sh
pnpm --filter @jeswr/app-pod-migrator run test:css helpers.test.ts
```

The full command has been run against both local servers with loopback sockets.
Offline checks additionally validate crypto, HTTP request construction, probes,
observation ordering, shipped config imports, and independent fixtures against CSS's
own ACP evaluator.

`content-length.integration.ts` reproduces CSS 7.2.0's memory-backend length bug
independently: PUT a Unicode Turtle document, GET it intact, insert an ASCII triple
with PATCH, then compare a raw loopback HTTP response with HEAD and Fetch GET.
The server sends 133 UTF-8 bytes but advertises 128 (the JavaScript string length);
Fetch exposes only 128 bytes and the RDF parser rejects that prefix. The test logs
the exact bodies, statuses and raw response headers, and drives the engine against
the damaged source to require a failed-resource report and no destination file.
`@jeswr/fetch-rdf` also rejects the streamed response without a package change.
The count originates at CSS `dist/storage/accessors/InMemoryDataAccessor.js:53`
(`chunk.length`) and is emitted by
`dist/http/output/metadata/RangeMetadataWriter.js:27`.

An access-read regression also obtains its alternate N-Quads representation from
real CSS, requiring conversion to omit Content-Length. A wrapper removes the first
Turtle response's length, both with the intact body and with a valid-triple prefix.
The intact access graph passes; the prefix is refused against the full conversion.
This exercises conversion evidence rather than trusting a missing header alone.

`shared.ttl` retains Unicode in the full migration scenarios. Following a successful
stranger append, the suite requires the engine body reader to reject the truncated
Turtle. It negotiates N-Triples only to inspect the inserted triple, then restores
the original Turtle with the original Turtle representation's ETag. No server code
is patched and no truncated body is used as migration input successfully.
