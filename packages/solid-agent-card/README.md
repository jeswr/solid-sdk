<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/solid-agent-card

Build and discover machine-readable agent descriptors anchored to a Solid WebID.

One descriptor produces an A2A Agent Card and an RDF Agent Description, while WebID pointers make
the agent discoverable from its owner.

> Experimental. Without an injected `fetch`, discovery and verification use
> `@jeswr/guarded-fetch`'s DNS-pinned Node fetch, which refuses private, loopback and
> link-local targets (including via redirects). An injected `fetch` replaces that boundary,
> so it must enforce its own SSRF policy for untrusted URLs.

## Install

```sh
npm install github:jeswr/solid-agent-card#main
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { buildAgentPointer, describeAgent, discoverAgent } from "@jeswr/solid-agent-card";

const descriptor = describeAgent({
  id: "https://alice.example/agent",
  name: "Alice's Agent",
  owner: "https://alice.example/profile/card#me",
  skills: [{ id: "schedule", name: "Scheduling", tags: ["calendar"] }],
});

const agentDescriptionTurtle = await descriptor.agentDescription.toTurtle();
const profilePointer = buildAgentPointer(
  "https://alice.example/profile/card#me",
  "https://alice.example/agent",
);

const found = await discoverAgent("https://alice.example/profile/card#me", {
  fetch: guardedFetch,
  requireOwnerMatch: true,
});
```

## Key API

- Emit: `describeAgent`, `buildAgentPointer`, `agentCardUrl`, `agentDescriptionsUrl`.
- Discover: `discoverAgent` reads profile pointers and optionally resolves the descriptor.
- Verify: `verifyDescriptor` fetches and validates a descriptor; `verifyDataset` validates RDF
  already in hand without network access.
- Results include structured validation issues and an owner-to-WebID binding check.

## Channel bindings

`AgentDescriptor.bindings` accepts `ChannelCapability` records from `@jeswr/agent-model`.
Published artifacts inline the model's implementation and capability type; consumers do not
need to install the private model package. The shipped renderer uses the same bundled code.
`describeAgent` validates and copies the records, rejects duplicate ids, and projects them into:

- A2A `capabilities.extensions[]`: `{ uri: "https://jeswr.org/ns/agent#bindings", required: false,
  params: { bindings: [...] } }`.
- ANP `agent:supportsBinding` links plus the complete capability RDF graphs, in Turtle and
  self-contained JSON-LD. `verifyDescriptor` validates and recovers the linked records locally.

Omitted or empty bindings produce no extension. Credential state and send support describe
the channel; they grant no permission to act. Only capability fields are accepted, so account
handles, tokens, and credential references cannot be attached as extra record properties.

## Render from the daemon's descriptors container

Build the package and its workspace dependencies, then run from this workspace:

```sh
pnpm exec turbo run build --filter=@jeswr/solid-agent-card...
pnpm --filter @jeswr/solid-agent-card render:card "$PWD/descriptor.json" \
  https://alice.example/agent/descriptors/ "$PWD/rendered-card"
```

`descriptor.json` supplies the ordinary `AgentDescriptor` fields (`id`, `name`, optional
`owner`, skills, security schemes, and protocol sources). Bindings are replaced with the
daemon's `descriptors/<binding>.ttl` records. The script reads the container and its scoped
non-container members, sorts by document URL, requires one capability per document, and
verifies the result before writing `agent-card.json`, `agent-description.ttl`, and
`agent-description.jsonld` locally. Missing or invalid records fail the render. Reads refuse
redirects and cap each response at 256 KiB and the container at 100 descriptors.

The CLI uses anonymous fetch and takes a trusted operator-selected container URL. For a
private container, import `renderCard(descriptor, containerUrl, fetch)` from
`scripts/render-card.mjs` and inject an authenticated fetch scoped to that container. For
untrusted URLs in a server, that fetch must also enforce SSRF protection.

The script performs GETs and local file writes only. Review the generated capabilities
before sharing them: connection state and ingest times are included. Publishing an updated
card on jeswr.org remains a separate manual action requiring Jesse's go (P9).

## Links

- [Source](https://github.com/jeswr/solid-agent-card)
- [Issues](https://github.com/jeswr/solid-agent-card/issues)
- [WebID discovery guide](./docs/WEBID-DISCOVERY.md)
- [A2A Agent Card specification](https://a2a-protocol.org/latest/specification/)

## License

[MIT](./LICENSE) © Jesse Wright
