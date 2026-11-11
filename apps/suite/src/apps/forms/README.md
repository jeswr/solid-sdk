<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# Forms from SHACL

Forms replaces the `/forms` placeholder with a designer, live preview, fill route
(`/forms/f?form=<encoded shape IRI>`), response table and detail, CSV export and share-link dialog.
The app remains registered as `backlog`.

`lib/runtime.ts` is the API from the sst-ild.4.4 runtime brief. Its graph type parameters
allow the demo double to operate on plain JSON without claiming to implement RDF.
There is no new domain model or generated package in this change: the parallel
`@jeswr/shacl-forms` package owns runtime interpretation of `sh:NodeShape`,
`sh:PropertyShape`, `sh:PropertyGroup`, their constraints and response RDF.

Designer questions have stable predicate IRIs under
`https://jeswr.org/ns/forms/answer/<id>` (each authored question is a new property).
The initial response class is `https://schema.org/Answer`. Built-in datatypes use
`http://www.w3.org/2001/XMLSchema#`. Editing a question's label never changes its predicate.

The runtime is injected into `createPodFormsStore` as a `FormRuntime` object.
It alone compiles shapes, validates answers, builds and parses responses, and
serialises RDF. The store accepts a prepared `StorageClient`, author forms and
respondent responses containers, plus an explicit shapes reader. It uses
`storage.listAll` for pagination and `parseRdf` for response reads, preserves
server-assigned identifiers, and uses conditional writes. Form URLs use `#form`
and responses use `#response`. New resources are reserved empty before building
RDF so LWS-assigned identifiers are known. An interrupted allocation can leave an
empty document; no unconditional cleanup is attempted.

To connect the real package when it lands, install its namespace as
`formRuntime.current` in `lib/runtime.ts` and set `formRuntime.openStore` to the host's
factory for those account-scoped dependencies. That is the single integration
file; the designer, fill view, response view and state controller remain unchanged. Until then real
sessions show an unavailable state. The JSON fake is never a fallback for them.
Container discovery/registration belongs to the host's shared storage layer.

In demo mode `demo/sample.ts` supplies two fictional forms and three fictional
received responses. `lib/data/demo-store.ts` seeds and conditionally updates
`forms/demo.json` in the existing browser demo pod, using the in-memory store and
JSON-only runtime double. This snapshot is a simulation, clearly labelled in the
UI; it is not SHACL or a production response representation. Reopening restores
saved changes. A competing tab causes a safe conflict, requiring reload.

The response flow is **respondent saves in their own pod under `forms/responses/`,
then the author receives a notification containing its link**. This first cut
implements the save through the store. `@jeswr/pod-notifications` currently offers
subscriptions, not an LDN send helper, so sending, receiving and authenticating
inbox links are deferred. Real author response lists therefore remain empty;
sample received links demonstrate the table. Response read permission is also
required before the author can read a linked answer. The UI never claims delivery
or changes permissions when copying a link.

Form saves update the list optimistically and persist serially. Failed saves
restore the confirmed list without discarding the open designer draft; subsequent
edits stay available for retry. Responses show pending confirmation immediately,
and failed writes keep the filled answers. Offline views preserve mounted drafts
and explain that saving requires a connection; there is no private app outbox.

CSV exports use CRLF records, quote every field, double embedded quotes and prefix
an apostrophe for formula-leading cells (including after whitespace), for headers
as well as answers.

Deferred for the lead's tracker:
- Connect the parallel SHACL runtime and shared container discovery/registration.
- Integrate public form read permissions and respondent-controlled response sharing.
- Send and verify LDN inbox links, then load received responses for authors.
- Add shared durable offline drafts/outbox support; keep current drafts mounted offline.
- Add nested/repeated answer controls; this first cut explicitly refuses them.

No generator or model-runtime changes were made, and no generator admission gaps
were encountered. No code was copied from another app. The shell/session APIs and
existing demo pod are reused directly.
