<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

> **Experimental — AI-agent-generated.** Security-critical WAC/ACP policy utilities.

Pure access-control reading, translation and serialization extracted from Pod Migrator.
Callers supply RDF datasets and independently established server implementations; pod I/O,
crawling, group discovery and migration execution remain in the application.

The contract is **never widen access**: translate effective policies, preserve every
established restriction, and omit, narrow or refuse unsupported rules with report items.
`assertNotWider(source, target, context)` performs a bounded symbolic subset proof and throws
on widening or excessive complexity. A supplied `targetOwner` is explicitly exempted; the
caller must establish that this identity already controls the target.

```ts
import { assertNotWider, ownerPolicy, translatePolicy, unionPolicies, writeAcp }
  from "@jeswr/pod-access";

const context = { resourceUrl, sourceOwner, targetOwner, groups: new Map(),
  targetImplementation: "css" as const };
const { policy: translated, report } = translatePolicy(sourceEffective, "acp", context);
const policy = unionPolicies(ownerPolicy(targetOwner, resourceUrl.endsWith("/")), translated);
assertNotWider(sourceEffective, policy, context);
const turtle = await writeAcp(policy, resourceUrl, acrUrl, "css");
```

`sourceEffective` must already include source inheritance. Before any PUT, the caller reviews
reports, preserves owner Control, and proves the complete target state including ancestors.

Public API:

- Model: `Mode`, `Subject`, `Grant`, `Denial`, `EffectivePolicy`, `AccessDocument`,
  `AccessSystem`, `PodImplementation`, reports/resolutions and `AcpDialect`.
- Composition/proof: `effectivePolicy`, `effectiveMembers`, `scopePolicy`, `unionPolicies`,
  `emptyPolicy`, `ownerPolicy`, `assertNotWider`, `policiesEqual`, `ProofContext`.
- Readers/writers: `readWac`, `writeWac`, `readAcp`, `writeAcp`, and
  `isPolicyTooComplex(error)` to identify bounded-representation refusals.
- Translation/reports: `translatePolicy`, `TranslationContext`, `reportItem`.
- `./testing` exports `emptyPolicy` and `ownerPolicy` fixtures.

In-process callers are trusted code; JavaScript cannot prevent same-realm code from patching
prototypes or built-ins such as `Set.prototype.has` or `Array.prototype`.
The package therefore does not defend against deliberate prototype patching and keeps internal
mutable state, RDF helpers and helper classes out of its public exports.
Frozen mode lists guard against accidental mutation; returned policies and reports remain caller-owned.

Source reads use the **strictest plausible** implementation semantics. For ESS,
`effectivePolicy` suppresses ancestor grants when the resource attaches an explicit policy;
ancestor denials remain. CSS sources and all target proofs use additive ACP composition.
Existing-target reads (`target: true`) use the **widest plausible** permissions or refuse
unsupported shapes. Pass the implementation to `effectivePolicy` only for source reads.

ESS targets require the closed allowlist: one exclusive ACR root, simple controls/policies,
agent/public/authenticated matchers with `allOf` and optional `noneOf`, known `acp:*` modes,
and paired Read+Write for ACR access. Client/issuer/VC, owner/creator roles, `anyOf`, foreign
modes and extra graph constructs are refused. ESS/NSS are offline fixture contracts; CSS 7.2
has an independent installed-server oracle. Full access semantics and the matrix remain in
[DESIGN §3–6](../../apps/pod-migrator/docs/DESIGN.md#3-neutral-model).

Requires Node >=24. Run `pnpm --filter @jeswr/pod-access run {lint,build,typecheck,test}`
individually from the workspace root. Tests enforce 100% lines/branches/functions/statements.
The moved regression suites retain test-only imports of the app's migration harness and are
also included in the app's coverage run. No application code is shipped by this package.
