<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

> **Experimental — AI-agent-generated.** Security-critical WAC/ACP translation extracted from Pod Migrator and notification delivery. Sharing/grant APIs remain unimplemented.

Pure, offline access-control readers, writers, a neutral policy model, conservative translation,
inheritance composition, and bounded symbolic access proofs. Pod Migrator consumes this package;
HTTP, group fetching, planning, decisions, conditional writes, and execution remain in the app.

Private at version 0.1.0. Requires Node.js >=24 and the root pnpm workspace tooling.
The broader sharing client in SDK core `ADR-003-storage-client.md` §9 remains unimplemented.

Readers can return resource, member, and combined rules. `translatePolicy` and `assertNotWider`
require every grant and denial to be normalized to resource scope; they throw otherwise.
Use `scopePolicy` to select and normalize each scope, then translate and prove the two separately.
`policiesEqual` likewise requires normalized policies and returns false for invalid scopes.

## Notification delivery

Notification delivery lives at `@jeswr/pod-access/notify`:

```ts
import { assignmentAnnounce, createNotify } from '@jeswr/pod-access/notify';

const notify = createNotify({ fetch: auth.fetch });
const result = await notify(assigneeWebId, {
  ...assignmentAnnounce(task, tracker, assignerName, title),
  actor: senderWebId,
});
// { delivered: boolean, inbox: string | null,
//   reason?: 'no-inbox' | 'forbidden' | 'lws-no-ldn' | 'network' }
```

Activities support `Announce`, `Offer`, `Accept`, `Reject`, and `Create`; `object` and `actor`
are required, with optional `target` and `summary`. The POST body is ActivityStreams JSON-LD
(`application/ld+json`). Delivery failures resolve as values. An inbox's 401/403 is `forbidden`;
other transport, parsing, policy or HTTP failures are `network`. No unambiguous inbox is `no-inbox`.

Builders return templates without actor: `shareNotification(resource, role)` announces a share
with summary `Shared with you as {role}`; `assignmentAnnounce(task, tracker, assignerName, title)`
announces the task with tracker target and summary `{name} assigned you '{title}'`;
`mentionNotification(annotation, document)` creates an annotation with the document target;
`roomInvitation(room)` offers a room. These helpers do not modify grants or resource data.

Each notifier caches positive and missing-inbox discovery for ten minutes, sharing concurrent
profile reads. Transient failures are retried. Caches hold at most 256 exact WebIDs and belong
to one caller/session: recreate the notifier on account changes. `clock` is injectable for tests.

Known LWS recipients should be identified by `recipientProtocol: webId => 'lws'`; this returns
`lws-no-ldn` without network requests. An `application/lws+json` profile response also returns
`lws-no-ldn`. Unknown recipients are treated as WebIDs; the sender's protocol is irrelevant.

Profile and inbox destinations must be public HTTPS without URL credentials; inbox fragments
and ambiguous inbox assertions are refused. The caller transport must honor `redirect: 'manual'`.
All redirects are refused, bodies are capped at 256 KiB, and requests have an eight-second deadline.
Node hostname targets require an authenticated `pinningFetch` explicitly asserted to pin DNS,
in addition to `fetch`; ordinary pod-auth fetch is not silently treated as pinned. Browsers cannot
pin DNS and use guarded-fetch's browser policy. Activity IRIs currently require HTTPS.

React applications can use `useNotify()` from `@jeswr/suite-sdk` under `PodAuthProvider`; it
supplies the current actor/fetch and resets the cache on identity changes.

## Offline policy translation

```ts
import {
  assertNotWider, readWac, scopePolicy, translatePolicy, unionPolicies, writeAcp,
} from "@jeswr/pod-access";

// Parse RDF with @jeswr/fetch-rdf using the access document URL as baseIRI.
const source = readWac(dataset, sourceResource, sourceAclUrl, "css");
const context = {
  resourceUrl: sourceResource,
  sourceOwner,
  targetOwner,
  targetImplementation: "css",
  groups: new Map(),
} as const;
const sourceResourcePolicy = scopePolicy(source, "resource");
const sourceMemberPolicy = scopePolicy(source, "members");
const resource = translatePolicy(sourceResourcePolicy, "acp", context);
const members = translatePolicy(sourceMemberPolicy, "acp", {
  ...context,
  scopeId: "members:",
});
// Review resource.report and members.report; prove each translated component in its own scope.
assertNotWider(sourceResourcePolicy, resource.policy, context);
assertNotWider(sourceMemberPolicy, members.policy, context);
// Translation returns resource-normalized rules. Restore member scope before serialization.
const policy = unionPolicies(resource.policy, {
  grants: members.policy.grants.map((rule) => ({ ...rule, appliesTo: "members" })),
  denials: members.policy.denials.map((rule) => ({ ...rule, appliesTo: "members" })),
});
const turtle = await writeAcp(policy, targetResource, targetAcrUrl, "css");
// Before persistence, also prove the complete effective target resource and member policies,
// including owner access, retained target rules, and ancestor controls, against their source scopes.
```

The root entry point exports:

- `readWac` / `writeWac`, `readAcp` / `writeAcp`, `AcpDialect`, and `PolicyTooComplex`.
- `translatePolicy`, `TranslationContext`, `reportItem`, and `optionDescriptions`. Report IDs,
  explanations, options, and default decisions retain Pod Migrator's behavior. Translation scopes
  output to the resource and requires normalized input; callers select scopes and restore member
  scope explicitly.
- `emptyPolicy`, `scopePolicy`, `unionPolicies`, `ownerPolicy`, `effectivePolicy`,
  `effectiveMembers`, `assertNotWider`, `policiesEqual`, `ProofContext`, and `subjectKey`.
- The extracted policy/report types and shared RDF helpers (`ACL`, `ACP`, `RDF`, `FOAF`,
  `modes`, `modeIri`, `readModes`, `safeIri`, `RdfNode`, `serialize`, `parent`).

`@jeswr/pod-access/testing` remains reserved and exports nothing.

Server dialects are trusted caller assertions, never inferred from editable RDF. Source readers
retain conservative permissions; target readers use the widest established interpretation and refuse
unsupported restrictions. Non-CSS ACP targets must fit the closed target allowlist. Unsupported
conditions and denials retain the migrator's narrowing decisions; group expansion needs an explicitly
supplied, publicly readable membership snapshot. Writer output alone does not prove migration safety:
callers must retain owner access, validate decisions, prove effective resource and ancestor policies,
and protect persistence with scope checks and reviewed validators.

Run from the workspace root:

```sh
pnpm --filter @jeswr/pod-access run lint
pnpm --filter @jeswr/pod-access... run build
pnpm --filter @jeswr/pod-access run typecheck
pnpm --filter @jeswr/pod-access run test
```

Package tests require 100% branches, functions, lines, and statements, including adversarial target
shapes, malformed RDF, dialect-specific denials, symbolic proof limits, and writer failures.
The migrator retains its end-to-end engine regression and dialect matrix tests.
Tests also cover the reserved testing entry point, notification builders and a byte-snapshotted
assignment delivered through the real notifier and a fixture fetch.
