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

## Links

- [Source](https://github.com/jeswr/solid-a2a)
- [Issues](https://github.com/jeswr/solid-a2a/issues)
- [SHACL](https://www.w3.org/TR/shacl/)
- [RDF Dataset Canonicalization](https://www.w3.org/TR/rdf-canon/)

## License

[MIT](./LICENSE) © Jesse Wright
