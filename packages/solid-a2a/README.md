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

New intents, shapes, protocol metadata and handshakes use `https://jeswr.org/ns/a2a#`.
Readers and `validateIntent` also accept `https://w3id.org/jeswr/a2a#`, including mixed graphs.
Validation resolves vocabulary aliases in a temporary view, including nested property paths,
comparison operands and vocabulary-valued constraint lists; it never rewrites the supplied
graph. Lists and named shapes shared between vocabulary and resource constraints are
projected separately. Instance subjects and resource values keep their exact IRIs, and
named shapes remain distinct, so validation and parsing follow the same action and
parameter nodes. Class targets and inheritance also resolve vocabulary aliases without
renaming class-axiom subjects.

Existing protocol bodies and their hashes remain unchanged: `hashQuads` and
`verifyProtocolDocument` hash the supplied IRIs exactly. Newly built canonical protocol
bodies have new hashes. Caller-supplied shape bodies and protocol/shape identifiers are
preserved, including legacy shapes already pinned by a hash. The published
`https://w3id.org/jeswr/a2a-rdf/v1` specification URLs remain unchanged.

## Links

- [Source](https://github.com/jeswr/solid-a2a)
- [Issues](https://github.com/jeswr/solid-a2a/issues)
- [SHACL](https://www.w3.org/TR/shacl/)
- [RDF Dataset Canonicalization](https://www.w3.org/TR/rdf-canon/)

## License

[MIT](./LICENSE) © Jesse Wright
