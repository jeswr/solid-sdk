<!-- AUTHORED-BY Claude Fable 5 -->

# Recipe: link your WebID to your Agent Card

How to make the agent that represents you **discoverable from your WebID** — the exact
resources to host, the exact triples to add, and the exact call a counterparty makes. This is
the worked, end-to-end version of the M1 flow; every step below is proven by
[`test/webid-e2e.test.ts`](../test/webid-e2e.test.ts), which models the real
`https://jeswr.org/#me` profile shape.

The flow has three artifacts and one link:

```
your WebID document                       your pod
┌───────────────────────────┐             ┌──────────────────────────────────┐
│ <#me> interop:hasAuthoriz-─┼───────────▶│ /public/agent                    │
│       ationAgent <agent>  │             │   an ad:AgentDescription (RDF)   │
│ <#me> schema:agent <agent>│             │   ad:owner ──back-link──▶ <#me>  │
└───────────────────────────┘             │ /public/agent-card.json          │
                                          │   the A2A Agent Card (JSON)      │
                                          └──────────────────────────────────┘
```

## Step 1 — emit the two descriptors

One `AgentDescriptor` in, both encodings out (they cannot drift):

```ts
import { describeAgent } from "@jeswr/solid-agent-card";

const WEBID = "https://jeswr.org/#me";
const AGENT = "https://solid-test.jeswr.org/jeswr/public/agent";

const { agentCard, agentDescription } = describeAgent({
  id: AGENT,                    // the agent's stable IRI = where the RDF description is served
  name: "Jesse's Agent",
  owner: WEBID,                 // ⚠ the OWNER BACK-LINK — must be the WebID, spelled EXACTLY
  skills: [{ id: "negotiate-data-sharing", name: "Negotiate data sharing", tags: ["odrl"] }],
  securitySchemes: [{ type: "solid-oidc", issuer: "https://idp.solid-test.jeswr.org" }],
  // protocolSources: [...]    // M2 SHACL protocol documents, when you have them
});

const turtle = await agentDescription.toTurtle(); // → host at AGENT
const cardJson = JSON.stringify(agentCard);       // → host at …/public/agent-card.json
```

`ad:owner` must equal the WebID **exactly** — IRI equality, no normalisation. If your profile
document serves several `#me` subjects (e.g. `https://jeswr.org/#me` *and*
`https://www.jeswr.org/#me`), the owner is the **canonical** spelling, and the pointer triples
in Step 3 must sit on that same subject.

## Step 2 — host them on your pod, publicly readable

Discovery starts unauthenticated, so both resources need a public-read ACL (in WAC terms,
`acl:agentClass foaf:Agent; acl:mode acl:Read` on the container or resources). For example:

- `PUT https://solid-test.jeswr.org/jeswr/public/agent` — `Content-Type: text/turtle`, the
  Turtle from Step 1.
- `PUT https://solid-test.jeswr.org/jeswr/public/agent-card.json` —
  `Content-Type: application/json`, the card.

The A2A ecosystem's conventional location is `/.well-known/agent-card.json` on the agent's
origin (`agentCardUrl(origin)` computes it). A pod owner usually cannot write `/.well-known/*`
— serving it takes server support, so treat the well-known path as an optional server-side
alias of the pod resource, and rely on the WebID pointer (Step 3) as the primary, always
available discovery route.

## Step 3 — add the pointer triples to your WebID document

This is the only change to your profile. Generate the exact triples:

```ts
import { buildAgentPointer } from "@jeswr/solid-agent-card";

const ptr = buildAgentPointer(WEBID, AGENT, [
  "interop:hasAuthorizationAgent", // the SAI "agent that represents you" (primary)
  "schema:agent",                  // the schema.org link (industry reach)
]);
console.log(await ptr.toString());
```

which is this Turtle — copy-paste into the WebID document (attached to the **exact** WebID
subject):

```turtle
@prefix interop: <http://www.w3.org/ns/solid/interop#> .
@prefix schema: <https://schema.org/> .

<https://jeswr.org/#me>
    interop:hasAuthorizationAgent <https://solid-test.jeswr.org/jeswr/public/agent> ;
    schema:agent <https://solid-test.jeswr.org/jeswr/public/agent> .
```

If the WebID document lives on a pod, `PATCH` the triples in (`text/n3` insert). If it is a
personal website (as `https://jeswr.org/` is — the homepage *is* the WebID document, RDFa +
Turtle by content negotiation), add the equivalent statements to both representations: the
pointer must appear in whichever serialisation a client negotiates.

## Step 4 — a counterparty discovers and verifies

```ts
import { discoverAgent } from "@jeswr/solid-agent-card";

const r = await discoverAgent("https://jeswr.org/#me", {
  fetch: guardedFetch,          // SSRF boundary — see README "Security"
  requireOwnerMatch: true,      // enforce the owner back-link
});

r.pointers[0]?.agent;           // "https://solid-test.jeswr.org/jeswr/public/agent"
r.verification?.valid;          // true — well-formed, subject-bound, owner back-linked
r.ownerMatchesWebId;            // true — ad:owner === the WebID we started from
r.descriptor?.securitySchemes;  // [{ type: "solid-oidc", issuer: "https://idp…" }]
r.descriptor?.protocolSources;  // the M2 protocol documents, if advertised
```

Three verifications happen, all fail-closed:

1. **Well-formedness** — exactly one `ad:AgentDescription`, a name, a valid `ad:url`, known
   security-scheme types.
2. **Subject binding** (spoofing guard) — the description's subject must equal the agent IRI
   the profile pointed at; a document served at URL A cannot describe a different agent B.
3. **Owner back-link** (`requireOwnerMatch`) — the description's `ad:owner` must point back to
   the WebID discovery started from. Without this, a profile could point at any third party's
   well-formed description; with it, the profile *and* the descriptor each name the other —
   the bidirectional binding the accountability chain builds on.

What this recipe does **not** give you (deliberately — later milestones): a *live* A2A
endpoint answering at the agent IRI (the descriptor is the discovery layer; the runtime is
M5), delegated `act`-chain tokens, and server-side ODRL enforcement. The descriptor's
`securitySchemes` + `protocolSources` are the hooks those layers attach to.
