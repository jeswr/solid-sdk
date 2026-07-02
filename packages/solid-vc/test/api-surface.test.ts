// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// PUBLIC API SNAPSHOT — a committed, diffable contract guard over the full public
// surface of `@jeswr/solid-vc` AS PUBLISHED, so "what is the API?" is a one-file
// diff for a reviewer, and any accidental addition / removal / rename / retype of
// a public export fails this test.
//
// It validates the ACTUAL SHIPPED surface, not the source surface:
//  - the runtime value exports are read from the published `dist/index.js` (the
//    entrypoint `package.json` `exports`/`main` resolves a consumer to), so a
//    stale committed `dist` that disagrees with `src` is caught here (in addition
//    to `check:dist`).
//  - the value AND type export NAMES are parsed out of the published
//    `dist/index.d.ts` (the `types` entrypoint) and compared to the two frozen
//    lists below, so a removed / added / renamed VALUE or TYPE export — including
//    type-only exports, which erase at runtime and cannot be enumerated from the
//    module object — fails the test.
//
// Why a vitest contract guard ALONGSIDE api-extractor: `etc/solid-vc.api.md`
// (api-extractor / `api:check`) snapshots the full TYPE signatures from
// `dist/index.d.ts`, but it never LOADS the module. This test complements it by
// asserting against the RUNTIME `dist/index.js` a consumer actually imports — so a
// `.d.ts` ↔ `.js` disagreement (a stale committed `dist/` where the emitted JS and
// the declarations drift apart) is caught here even though api-extractor, reading
// only the `.d.ts`, would pass. The two guards are deliberately kept in lock-step.
//
// MAINTENANCE RULE: a change to either frozen list is a DELIBERATE, semver-aware
// contract change — update the list IN THE SAME COMMIT as the export change (and
// rebuild `dist/`), with a semver call in the message. Never edit a list to
// silence an unexpected diff: an unexpected surface change is stop-the-line.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Import the PUBLISHED entrypoint (what a consumer resolves to), not src/.
import * as api from "../dist/index.js";

const DTS_PATH = fileURLToPath(new URL("../dist/index.d.ts", import.meta.url));

// --- the frozen RUNTIME surface (value exports, name → JS typeof) ------------
// Every value a consumer can import at runtime, sorted by name.
const RUNTIME_SURFACE: ReadonlyArray<readonly [string, string]> = [
  ["CredentialNode", "function"],
  ["DataIntegritySuite", "function"],
  ["PresentationNode", "function"],
  ["ProofNode", "function"],
  ["SVC", "string"],
  ["SVC_AGENT_AUTHORIZATION", "string"],
  ["SuiteRegistry", "function"],
  ["VC", "string"],
  ["VC_V2_CONTEXT", "string"],
  ["VcDataset", "function"],
  ["agentAuthorizationFromRdf", "function"],
  ["base58btcDecode", "function"],
  ["base58btcEncode", "function"],
  ["buildAgentAuthorizationCredential", "function"],
  ["canonicalNQuads", "function"],
  ["credentialFromRdf", "function"],
  ["credentialMetaFromNode", "function"],
  ["credentialToJsonLd", "function"],
  ["credentialToRdf", "function"],
  ["credentialToTurtle", "function"],
  ["cryptosuiteForKeyType", "function"],
  ["dataIntegrityHash", "function"],
  ["defaultSuiteRegistry", "function"],
  ["exportPrivateJwk", "function"],
  ["exportPublicJwk", "function"],
  ["generateKeyPairForSuite", "function"],
  ["importKeyPair", "function"],
  ["importPublicKey", "function"],
  ["issue", "function"],
  ["issueAgentAuthorization", "function"],
  ["parseCredentialRdf", "function"],
  ["proofOptionsQuads", "function"],
  ["serialize", "function"],
  ["verifyCredential", "function"],
  ["wrapVc", "function"],
];

// --- the frozen NAME surfaces (sorted) ---------------------------------------
// Value export names (the runtime surface, names only).
const VALUE_NAMES: readonly string[] = RUNTIME_SURFACE.map(([n]) => n)
  .slice()
  .sort();

// Type-only export names (interfaces / type aliases — erase at runtime). Sorted.
const TYPE_NAMES: readonly string[] = [
  "AgentAuthorization",
  "Credential",
  "CredentialSubject",
  "DataIntegrityProof",
  "IssueInput",
  "IssueOptions",
  "JsonValue",
  "KeyPair",
  "Presentation",
  "ProofSignOptions",
  "ProofSuite",
  "ProofVerifyOptions",
  "SuiteKeyType",
  "VerifiableCredential",
  "VerifiablePresentation",
  "VerificationError",
  "VerificationErrorCode",
  "VerificationResult",
  "VerifyCredentialOptions",
  "VerifyOptions",
];

/**
 * Every line in `dist/index.d.ts` that begins an `export` STATEMENT (not inside a
 * JSDoc comment). Used to fail closed on any export form the parser below does not
 * understand. tsc may put a whole `export … from "…";` statement on one line, so
 * each is one logical statement here (declarations are emitted on their own line).
 */
function exportStatementLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^export\b/.test(l));
}

// The ONLY export forms this parser understands. A `dist/index.d.ts` that uses any
// other form (`export * from`, `export * as`, `export interface/type/const/class`,
// `export default`, a re-export with no `from`) is NOT covered by the name parser,
// so the parser fails closed rather than silently under-reporting the surface.
const SUPPORTED_EXPORT_STATEMENT = /^export\s+(type\s+)?\{[^}]*\}\s*from\s+["'][^"']+["'];?$/;

/**
 * Parse the export NAMES out of the published `dist/index.d.ts`, classified into
 * VALUE exports and TYPE-ONLY exports. Handles the forms tsc emits today:
 *   export { a, type B, c } from "...";   // mixed; `type B` is type-only
 *   export type { X, Y } from "...";       // whole block is type-only
 *   export { Z } from "...";               // all value
 * FAILS CLOSED (throws) if it encounters any OTHER `export` statement form, so a
 * future `export * from` / `export interface …` cannot leave a public export
 * silently unguarded. Pure string parsing over the committed artifact — no new
 * dependency, no compiler API.
 */
function parsedDtsExports(): { values: string[]; types: string[] } {
  const text = readFileSync(DTS_PATH, "utf8");

  // 1. Fail closed on any unsupported export form.
  const unsupported = exportStatementLines(text).filter(
    (line) => !SUPPORTED_EXPORT_STATEMENT.test(line),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `dist/index.d.ts uses export form(s) the API-surface parser does not handle ` +
        `(so the snapshot would silently miss them) — extend parsedDtsExports():\n` +
        unsupported.map((l) => `  ${l}`).join("\n"),
    );
  }

  // 2. Extract the names from the supported `export [type] { ... } from` forms.
  const values = new Set<string>();
  const types = new Set<string>();
  const stmt = /export\s+(type\s+)?\{([^}]*)\}\s*from/g;
  for (let m = stmt.exec(text); m !== null; m = stmt.exec(text)) {
    const wholeBlockIsType = m[1] !== undefined;
    const body = m[2] ?? "";
    for (const raw of body.split(",")) {
      const token = raw.trim();
      if (token.length === 0) continue;
      // A member may itself be `type Foo` (inline type export). Strip an alias
      // (`a as b`) to the EXPORTED name (`b`) — none today, but be robust.
      const isTypeMember = wholeBlockIsType || /^type\s+/.test(token);
      const name =
        token
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop()
          ?.trim() ?? token;
      (isTypeMember ? types : values).add(name);
    }
  }
  return { values: [...values].sort(), types: [...types].sort() };
}

describe("public API surface snapshot (the PUBLISHED dist/ contract)", () => {
  it("dist/index.js exports EXACTLY the frozen runtime value surface (name + typeof)", () => {
    const actual = Object.fromEntries(
      Object.keys(api).map((k) => [k, typeof (api as Record<string, unknown>)[k]]),
    );
    const frozen = Object.fromEntries(RUNTIME_SURFACE.map(([name, kind]) => [name, kind]));
    expect(actual).toEqual(frozen);
    expect(Object.keys(api).length).toBe(RUNTIME_SURFACE.length);
  });

  it("dist/index.d.ts declares EXACTLY the frozen VALUE export names", () => {
    expect(parsedDtsExports().values).toEqual(VALUE_NAMES);
  });

  it("dist/index.d.ts declares EXACTLY the frozen TYPE-ONLY export names", () => {
    expect(parsedDtsExports().types).toEqual(TYPE_NAMES);
  });

  it("the runtime module surface and the declared value surface agree", () => {
    // Cross-check: the value names tsc declares in dist/index.d.ts must match the
    // value names the dist/index.js module actually exports (no .d.ts ↔ .js drift).
    expect(parsedDtsExports().values).toEqual(Object.keys(api).slice().sort());
  });

  it("every export statement in dist/index.d.ts is a form the parser handles", () => {
    // Fail-closed coverage: the parser only understands `export [type] { … } from`.
    // If a future build emits `export * from` / `export interface …` / etc., this
    // (and parsedDtsExports) throws so a public export can never go unsnapshotted.
    const text = readFileSync(DTS_PATH, "utf8");
    const unsupported = exportStatementLines(text).filter(
      (line) => !SUPPORTED_EXPORT_STATEMENT.test(line),
    );
    expect(unsupported).toEqual([]);
    // And the parser itself does not throw on the current artifact.
    expect(() => parsedDtsExports()).not.toThrow();
  });
});
