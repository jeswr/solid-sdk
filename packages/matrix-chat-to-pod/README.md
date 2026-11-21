<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/matrix-chat-to-pod

Import Matrix room history into owner-private Solid LongChat resources.

The package separates a pure Matrix-event transform from the network orchestration, and preserves
edits, replies, redactions, timestamps, and source provenance.

> Import-only and experimental. Write the owner-only ACL before content and keep Matrix tokens out
> of logs and pod data.

## Install

```sh
npm install github:jeswr/matrix-chat-to-pod#main @rdfjs/types
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { importRoom } from "@jeswr/matrix-chat-to-pod";

const report = await importRoom({
  homeserverUrl: "https://matrix.example.org",
  accessToken: process.env.MATRIX_ACCESS_TOKEN!,
  roomId: "!abc:example.org",
  container: "https://alice.example/chat/matrix/",
  ownerWebId: "https://alice.example/profile/card#me",
  writeFetch: authenticatedSolidFetch,
  webIdFor: (matrixUserId) => knownWebIds[matrixUserId],
});
```

For network-free mapping, import `matrixEventToCanonical` from
`@jeswr/matrix-chat-to-pod/transform`.

## Key API

- `importRoom`: guarded Matrix pagination, transformation, ACL-first pod writes, and an import report.
- `matrixEventToCanonical`: pure event mapping with `message`, `replace`, `redaction`, and `skip`
  outcomes.
- `buildOwnerOnlyAclTurtle`: owner-only WAC document builder.
- Types: Matrix wire events, transform contexts/results, and import options/results.

## Links

- [Source](https://github.com/jeswr/matrix-chat-to-pod)
- [Issues](https://github.com/jeswr/matrix-chat-to-pod/issues)
- [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/)
- [SolidOS chat](https://solid.github.io/chat/)

## License

MIT © Jesse Wright

## Owner-only access changes (sst-9ku5)

Online owner-only writes now delegate to `@jeswr/pod-access/roles` `makeOwnerOnly`.
They discover the server's ACL/ACR Link, support WAC and CSS/ESS ACP, and refuse missing
or ambiguous Links, unknown/mixed models, malformed/unsupported policies, unsafe URLs
and foreign resource bindings. Targets must exist and support HEAD discovery; an
`acl`-only Link requires model evidence in readable own or ancestor RDF. Credentialed
URLs, resource queries/fragments and ambiguous encoded paths now refuse. The wrappers
use the default trusted CSS dialect; pass `implementation: "ess"` for ESS, including
server-advertised `?ext=acr` endpoints (only that exact query is accepted).
Creation uses `If-None-Match: *`; replacement requires a strong ETag and `If-Match`.
An existing document naming other principals now refuses instead of silently removing
their access; explicit removal requires `replace: true`.
Foreign inherited ACP member grants always refuse. No error is swallowed and 412 is
never retried. Access transport now refuses redirects and disables caching; failures
use pod-access's typed role errors (parser errors propagate).

The owner receives Read/Write/Append and management; explicit Append is redundant with
Write. Containers retain member defaults; resource writes omit defaults. Descendants'
own policies are not rewritten. Private access is still installed before imported content.
The exported offline WAC builders keep their signatures and graph meaning (Read/Write/
Control and their historical defaults) but now use pod-access's policy serializer, so
Turtle prefix spelling and authorization subject names can change. They do not perform
server discovery or prove that a resource is private. Any `aclUrlFor` export remains a
deprecated offline convention, and is never used to choose an online write URL.

`importRoom(options)` accepts `root`, `implementation` and `replace` alongside its existing options.
Set `root` to the pod's storage root (for example `https://host/alice/`) when the pod
lives at a sub-path; discovery stops there, so ancestors above `root` are not checked. Pass the
real storage root, never a deeper folder. Without it, discovery uses the origin root.
An already owner-only document with the required direct/member permissions sends no PUT,
so repeated imports also work with weak or absent ETags. Containers inherit by default;
removing existing owner member grants through the helper requires explicit `inherit: false`.
If the user has since shared the container, re-sync refuses unless `replace: true` explicitly
approves removing those own-document grants. A write that changes a policy still needs a
strong ETag; foreign additive ACP ancestor grants remain a refusal.
