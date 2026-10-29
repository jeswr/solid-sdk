<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-a2a

Translate natural-language agent requests into RDF intents and validate them against hash-pinned
SHACL protocol documents.

The library is transport- and model-independent: common intents use deterministic parsing, while
unmatched text can be passed to an injected translator.

> Experimental. Security-bearing exchanges must not silently downgrade from validated RDF back to
> natural language.

## Install

```sh
npm install github:jeswr/solid-a2a#main
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import {
  buildProtocolDocument,
  buildResponseShape,
  buildShapeForIntent,
  parseIntent,
  validateIntent,
} from "@jeswr/solid-a2a";

const parsed = await parseIntent(
  "share read access to https://alice.example/notes.ttl with https://bob.example/profile#me",
);
if (!parsed.resolved || !parsed.intent) throw new Error(parsed.reason);

const requestShape = buildShapeForIntent("grant");
const report = await validateIntent(parsed.intent, requestShape);
if (!report.conforms) throw new Error("Intent does not conform to the protocol shape");

const protocol = await buildProtocolDocument({
  requestShape,
  responseShape: buildResponseShape("https://schema.org/AuthorizeAction"),
  meta: { id: "https://alice.example/protocols/grant#v1", name: "Grant access", version: "1" },
});
```

## Key API

- Intent translation: `parseIntent` and the optional `TranslateFn` seam.
- RDF: `intentToTurtle`, `intentToJsonLd`, `parseIntentGraph`, `intentFromRdf`.
- SHACL: `buildShapeForIntent`, `buildResponseShape`, `validateIntent`.
- Protocol documents: `buildProtocolDocument`, `verifyProtocolDocument`, `hashQuads`.
- Handshake: `encodeUpgradeOffer`, `decodeUpgradeOffer`, `encodeUpgradeResponse`,
  `decodeUpgradeResponse`, `mayDowngradeToNl`, and RDF codecs.

## Vocabulary compatibility

Phase-1 writers keep emitting `https://w3id.org/jeswr/a2a#` intents, shapes, protocol
metadata and handshakes, preserving existing wire bytes and protocol hashes. Canonical
emission is deferred to phase 2 because pinned peers would reject it. Readers and
`validateIntent` accept `https://jeswr.org/ns/a2a#`, legacy and mixed vocabulary.

Validation uniformly renames every legacy A2A IRI in both data and shapes in a temporary
view, including subjects, graph names, resource values and SHACL expressions. It fails
closed if distinct legacy/canonical identity terms would collapse: subjects and objects
outside `rdf:type` are checked together. Pure predicate and class alias mixing is accepted.
Intent parsing reads that same normalized graph and returns `undefined` on identity
collisions; returned A2A instance/resource IRIs therefore use the canonical spelling.

`hashQuads` and `verifyProtocolDocument` still hash the original supplied IRIs exactly.
Caller-supplied shape bodies, response classes and protocol/shape identifiers remain
unchanged, including shapes already pinned by a hash. The published
`https://w3id.org/jeswr/a2a-rdf/v1` specification URLs remain unchanged.

## Links

- [Source](https://github.com/jeswr/solid-a2a)
- [Issues](https://github.com/jeswr/solid-a2a/issues)
- [SHACL](https://www.w3.org/TR/shacl/)
- [RDF Dataset Canonicalization](https://www.w3.org/TR/rdf-canon/)

## License

[MIT](./LICENSE) © Jesse Wright
