<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/suite-vocab

> Experimental — AI-agent-generated.

The single JavaScript home for canonical Solid suite namespace constants. No RDF is built here.
Suite vocabularies use `https://jeswr.org/ns/`; standard vocabularies retain their published bases.
`FEDCON` remains `https://jeswr.org/fedcon#` per DECISIONS V1.

```ts
import { NS, canonicalize, isLegacy, termsEqual } from "@jeswr/suite-vocab";
const documentClass = `${NS.POD_DOCS}Document`;
canonicalize("https://w3id.org/jeswr/pod-docs#Document") === documentClass;
isLegacy("http://schema.org/Event"); // true
termsEqual("http://schema.org/Event", "https://schema.org/Event"); // true
```

`LEGACY_NAMESPACES` maps known legacy namespace bases to canonical bases. Unknown IRIs pass
through unchanged; local names are preserved, and comparison is case-sensitive. Both schema.org
schemes are accepted on reads, with HTTPS as the canonical result (DECISIONS V7). This helper
does not change the task model's HTTP write convention or rename retired classes.

Run `pnpm --filter @jeswr/suite-vocab run test`; coverage uses the workspace's existing V8 provider
(`pnpm --filter @jeswr/app-pod-docs exec vitest run --root ../../packages/suite-vocab --coverage`).
The package is private until the first conformance gate, per ADR-001 D5; no mirror is configured.
