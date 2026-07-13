<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-agent-card

Build and discover machine-readable agent descriptors anchored to a Solid WebID.

One descriptor produces an A2A Agent Card and an RDF Agent Description, while WebID pointers make
the agent discoverable from its owner.

> Experimental. Server-side discovery of untrusted URLs requires an SSRF-guarded fetch.

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

## Links

- [Source](https://github.com/jeswr/solid-agent-card)
- [Issues](https://github.com/jeswr/solid-agent-card/issues)
- [WebID discovery guide](./docs/WEBID-DISCOVERY.md)
- [A2A Agent Card specification](https://a2a-protocol.org/latest/specification/)

## License

[MIT](./LICENSE) © Jesse Wright
