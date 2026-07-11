// AUTHORED-BY Claude Opus 4.8
/**
 * PUBLIC API CONTRACT GUARD — a committed, diffable snapshot of the package's entire public surface.
 *
 * This is the reviewability cornerstone for a maintainer who asks "what is the API?": the answer is
 * the literal arrays below, and any add / remove / rename of a public symbol shows up as a one-file
 * diff to THIS file (plus a red test) rather than as a code-reading exercise across the package. It
 * deliberately replaces an @microsoft/api-extractor dependency with a stdlib + vitest guard, keeping
 * the audit surface lean (no new dep to vet under the supply-chain rules).
 *
 * Two entry points are pinned, matching the package.json `exports` map:
 *   - `.`         (the runtime auth surface): src/index.ts
 *   - `./testing` (test-only headless OIDC driver): src/testing.ts
 *
 * VALUE exports are asserted against the SHIPPED artifacts — what a `github:`-installed consumer
 * actually imports — for BOTH conditional-export conditions:
 *   - the ESM `dist/esm/index.js` / `dist/esm/testing.js` (the `import` condition); and
 *   - the CJS `dist/cjs/index.js` / `dist/cjs/testing.js` (the `require` condition).
 * Both must expose exactly the pinned set, so dist↔source drift or an ESM/CJS surface mismatch
 * fails. The ESM namespace is checked verbatim (so an ACCIDENTAL `default` export would fail); the
 * CJS namespace is checked after stripping only the synthetic `__esModule` interop flag (a real
 * `default` would still surface and fail). TYPE-only exports have no runtime presence, so they are
 * pinned TWO ways, which together catch additions, removals, AND renames without any new dependency:
 *   1. each pinned type is imported as a type below — a removal/rename breaks `typecheck`; and
 *   2. the FULL exported-type set is parsed out of the committed `.d.ts` declaration files for BOTH
 *      the ESM (`dist/esm/*.d.ts`, the `import` types) AND the CJS (`dist/cjs/*.d.ts`, the `require`
 *      types) conditions (the authoritative emitted contract, rebuilt + committed with every src
 *      change) and asserted equal to the pinned list — so a NEWLY ADDED `export type`, or an
 *      ESM-vs-CJS declaration divergence, also fails here.
 * There is NO semver gate at install time (consumers `github:`-install `main`), so a deliberate
 * surface change must edit these arrays in the same commit and be reviewed against the downstream
 * consumers; an ACCIDENTAL change is caught here.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// The SHIPPED artifacts a github:-installed consumer imports (ESM `import` + CJS `require`).
import * as distEsmRoot from "../dist/esm/index.js";
import * as distEsmTesting from "../dist/esm/testing.js";
// Import every public TYPE so a removal/rename breaks `typecheck` (types are invisible at runtime).
import type {
  AuthCodeSession,
  AuthUrlParams,
  ClientCredentials,
  ClientRegistration,
  CliLoginOptions,
  DpopKeyPair,
  DpopProofParams,
  FetchLike,
  LoopbackListener,
  OidcProviderMetadata,
  OnTokensRefreshed,
  PkcePair,
  SolidSessionState,
  StoredSession,
} from "../src/index.js";
import type { HeadlessOidcContext } from "../src/testing.js";

const here = dirname(fileURLToPath(import.meta.url));
const DIST_ESM = join(here, "..", "dist", "esm");
const DIST_CJS = join(here, "..", "dist", "cjs");
const requireDist = createRequire(import.meta.url);
const distCjsRoot = requireDist("../dist/cjs/index.js") as Record<string, unknown>;
const distCjsTesting = requireDist("../dist/cjs/testing.js") as Record<string, unknown>;

/**
 * Runtime export names of a SHIPPED ESM namespace — verbatim, so an accidental real `default`
 * (or any other unintended key) would surface and fail the contract.
 */
function esmExports(ns: Record<string, unknown>): string[] {
  return Object.keys(ns).sort();
}

/**
 * Runtime export names of a SHIPPED CJS namespace, stripping ONLY the synthetic `__esModule` interop
 * flag tsc emits. A real `default` is NOT stripped, so an accidental default export still fails.
 */
function cjsExports(ns: Record<string, unknown>): string[] {
  return Object.keys(ns)
    .filter((k) => k !== "__esModule")
    .sort();
}

/**
 * Extract the exported VALUE and TYPE names from a committed `.d.ts` declaration file. Handles the
 * two shapes tsc emits here: re-exports (`export { … } from "…"` / `export type { … } from "…"`) and
 * inline declarations (`export interface X`, `export type X =`, `export declare function/const X`).
 * This is the authoritative emitted contract, so it catches ADDITIONS as well as removals/renames.
 *
 * @param distDir which build's declarations to read (ESM `import` types vs CJS `require` types).
 */
function exportsOf(distDir: string, dtsFile: string): { values: string[]; types: string[] } {
  const txt = readFileSync(join(distDir, dtsFile), "utf8");
  const values = new Set<string>();
  const types = new Set<string>();
  // The PUBLIC name of a specifier: for `Internal as Public` it is `Public`, else the bare name.
  const publicName = (spec: string): string => {
    const parts = spec.split(/\s+as\s+/);
    return (parts.length > 1 ? parts[parts.length - 1] : parts[0])?.trim() ?? "";
  };
  // Block re-exports: `export type { … }` (all types) and `export { … }` (values, with inline `type`).
  for (const m of txt.matchAll(/^export type \{([^}]*)\}/gm)) {
    for (const raw of (m[1] ?? "").split(",")) {
      const n = publicName(raw);
      if (n) types.add(n);
    }
  }
  for (const m of txt.matchAll(/^export \{([^}]*)\}/gm)) {
    for (const raw of (m[1] ?? "").split(",")) {
      const spec = raw.trim();
      if (!spec) continue;
      // An inline `type Foo` (optionally `type Foo as Bar`) inside a value block is a type export.
      if (spec.startsWith("type ")) types.add(publicName(spec.slice(5)));
      else values.add(publicName(spec));
    }
  }
  // Inline declarations.
  for (const m of txt.matchAll(/^export (?:interface|type) ([A-Za-z0-9_]+)/gm)) {
    if (m[1]) types.add(m[1]);
  }
  for (const m of txt.matchAll(/^export declare (?:function|const|class) ([A-Za-z0-9_]+)/gm)) {
    if (m[1]) values.add(m[1]);
  }
  return { values: [...values].sort(), types: [...types].sort() };
}

/** The exact set of RUNTIME (value) exports from the `.` entry point. */
const ROOT_VALUE_EXPORTS = [
  "DEFAULT_SCOPE",
  "DPOP_ALG",
  "accessTokenHash",
  "acquireToken",
  "assertEndpointTransport",
  "assertIssuerTransport",
  "authedFetch",
  "buildAuthorizationUrl",
  "canonicalHtu",
  "cliLogin",
  "createDpopProof",
  "createSession",
  "deserializeSession",
  "discoverProvider",
  "discoveryUrl",
  "exchangeCode",
  "exportDpopKeyPairJwk",
  "generateDpopKeyPair",
  "generatePkce",
  "generateSessionKeyPair",
  "importDpopKeyPairJwk",
  "isLoopbackHost",
  "loadSession",
  "pkceChallengeS256",
  "rdfFetchFor",
  "refreshSession",
  "registerClient",
  "saveSession",
  "serializeSession",
  "startLoopbackListener",
  "staticClient",
  "toDpopKeyPair",
] as const;

/** The exact set of TYPE-only exports from the `.` entry point (enforced via the type import above). */
const ROOT_TYPE_EXPORTS = [
  "AuthCodeSession",
  "AuthUrlParams",
  "CliLoginOptions",
  "ClientCredentials",
  "ClientRegistration",
  "DpopKeyPair",
  "DpopProofParams",
  "FetchLike",
  "LoopbackListener",
  "OidcProviderMetadata",
  "OnTokensRefreshed",
  "PkcePair",
  "SolidSessionState",
  "StoredSession",
] as const;

/** The exact set of RUNTIME (value) exports from the `./testing` entry point. */
const TESTING_VALUE_EXPORTS = ["driveHeadlessOidc", "headlessLogin"] as const;

/** The exact set of TYPE-only exports from `./testing`. */
const TESTING_TYPE_EXPORTS = ["HeadlessOidcContext"] as const;

// Reference each imported type once (a no-op assignment) so `verbatimModuleSyntax` keeps the type
// imports and a removed/renamed export becomes a typecheck error, not silently-dead import.
type _PinnedRootTypes = [
  AuthCodeSession,
  AuthUrlParams,
  CliLoginOptions,
  ClientCredentials,
  ClientRegistration,
  DpopKeyPair,
  DpopProofParams,
  FetchLike,
  LoopbackListener,
  OidcProviderMetadata,
  OnTokensRefreshed,
  PkcePair,
  SolidSessionState,
  StoredSession,
];
type _PinnedTestingTypes = [HeadlessOidcContext];

describe("public API contract — `.` entry point", () => {
  const expectedValues = [...ROOT_VALUE_EXPORTS].sort();
  const expectedTypes = [...ROOT_TYPE_EXPORTS].sort();

  it("the shipped ESM artifact exports EXACTLY the pinned runtime value set (no default)", () => {
    expect(esmExports(distEsmRoot)).toEqual(expectedValues);
  });

  it("the shipped CJS artifact exports EXACTLY the same runtime value set (ESM/CJS parity)", () => {
    expect(cjsExports(distCjsRoot)).toEqual(expectedValues);
  });

  it("the committed ESM .d.ts value + type exports match the pinned sets", () => {
    const { values, types } = exportsOf(DIST_ESM, "index.d.ts");
    expect(values).toEqual(expectedValues);
    expect(types).toEqual(expectedTypes);
  });

  it("the committed CJS .d.ts value + type exports match the pinned sets (require-condition parity)", () => {
    const { values, types } = exportsOf(DIST_CJS, "index.d.ts");
    expect(values).toEqual(expectedValues);
    expect(types).toEqual(expectedTypes);
  });
});

describe("public API contract — `./testing` entry point", () => {
  const expectedValues = [...TESTING_VALUE_EXPORTS].sort();
  const expectedTypes = [...TESTING_TYPE_EXPORTS].sort();

  it("the shipped ESM artifact exports EXACTLY the pinned runtime value set (test-only driver)", () => {
    expect(esmExports(distEsmTesting)).toEqual(expectedValues);
  });

  it("the shipped CJS artifact exports EXACTLY the same runtime value set (ESM/CJS parity)", () => {
    expect(cjsExports(distCjsTesting)).toEqual(expectedValues);
  });

  it("the committed ESM .d.ts value + type exports match the pinned sets", () => {
    const { values, types } = exportsOf(DIST_ESM, "testing.d.ts");
    expect(values).toEqual(expectedValues);
    expect(types).toEqual(expectedTypes);
  });

  it("the committed CJS .d.ts value + type exports match the pinned sets (require-condition parity)", () => {
    const { values, types } = exportsOf(DIST_CJS, "testing.d.ts");
    expect(values).toEqual(expectedValues);
    expect(types).toEqual(expectedTypes);
  });
});
