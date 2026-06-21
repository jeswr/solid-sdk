// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// CEM-accuracy tests. The committed `custom-elements.json` is the CODEGEN CONTRACT, so
// it must be ACCURATE:
//   1. Every per-class element's `@solid-class` edge in the manifest equals the bound
//      class IRI in the committed `resolveComponent` static map (the manifest and the
//      runtime map cannot silently diverge — they are derived from the same tags).
//   2. The manifest's `kind: js` exports for the barrel equal the REAL runtime exports
//      of the built `dist/index.js` (the Phase-0 type-only-export-exclusion guarantee:
//      a symbol is advertised `kind: js` ONLY when it is a real value export in dist).
//
// The manifest itself is regenerated + drift-checked by `npm run check:manifest`; this
// test asserts its CONTENT is consistent with the code, not just non-drifting.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ComponentEntry } from "../src/resolver.js";

// We read RESOLVER_ENTRIES + the dist export names from the COMMITTED dist/index.js (a
// single import), NOT from `../src/index.js`. Importing both src AND dist in one file
// double-loads the inlined <shacl-form> element (dist carries its own copy), which
// throws "already registered". The dist is the artifact the manifest must agree with
// anyway, so reading from it is the right source.
//
// GATE-INTEGRITY (roborev HIGH, round 2): this test reads the COMMITTED `dist/` +
// `custom-elements.json` AS-IS — it does NOT rebuild `dist/`. An earlier version ran
// `scripts/build-dist.mjs` (no out-dir arg ⇒ it writes the repo's `dist/`) in a
// `beforeAll`. Because `npm run gate` runs `test` BEFORE `check:dist`, that rebuild
// silently refreshed a stale/missing committed `dist/` before the drift guard ran, so
// `check:dist` could never catch committed-dist drift. The committed artifact is the
// thing under test here, and `npm run check:dist` independently proves it equals a
// fresh build — so reading it as-is loses nothing and stops the masking. No test in
// the suite may mutate the committed `dist/` / `custom-elements.json` (the gate must
// leave the tree clean).
const root = process.cwd();
const manifestPath = join(root, "custom-elements.json");
const distIndexUrl = pathToFileURL(join(root, "dist", "index.js")).href;

let RESOLVER_ENTRIES: readonly ComponentEntry[];
let distExportNames: Set<string>;

interface CemDeclaration {
  kind: string;
  name: string;
  tagName?: string;
  solid?: { class?: string; mode?: string; cardinality?: string };
}
interface CemExport {
  kind: string;
  name: string;
}
interface CemModule {
  path: string;
  declarations?: CemDeclaration[];
  exports?: CemExport[];
}
interface Cem {
  modules: CemModule[];
}

let cem: Cem;

beforeAll(async () => {
  // Read the COMMITTED manifest + import the COMMITTED dist AS-IS — no rebuild (see
  // the GATE-INTEGRITY note above). `check:dist` separately guarantees the committed
  // dist matches a fresh build, so the runtime exports + RESOLVER_ENTRIES we read here
  // are the real committed pipeline's, with no mutation of the working tree.
  cem = JSON.parse(readFileSync(manifestPath, "utf8")) as Cem;
  const mod = await import(distIndexUrl);
  RESOLVER_ENTRIES = mod.RESOLVER_ENTRIES as readonly ComponentEntry[];
  distExportNames = new Set(Object.keys(mod));
});

/** Every class declaration across the manifest. */
function classDecls(): CemDeclaration[] {
  return cem.modules.flatMap((m) => (m.declarations ?? []).filter((d) => d.kind === "class"));
}

describe("custom-elements.json — CEM accuracy", () => {
  it("the manifest exists + parses", () => {
    expect(cem.modules.length).toBeGreaterThan(0);
  });

  it("every per-class element carries the @solid-* binding block", () => {
    const byName = new Map(classDecls().map((d) => [d.name, d]));
    for (const name of [
      "JeswrTaskList",
      "JeswrContactList",
      "JeswrBookmarkList",
      "JeswrCollection",
    ]) {
      const d = byName.get(name);
      expect(d, `${name} present in manifest`).toBeDefined();
      expect(d?.solid?.class, `${name} carries @solid-class`).toBeTruthy();
      expect(d?.solid?.mode).toBe("view");
    }
    // The profile card binds by IRI, not rdf:type, so it has NO @solid-class (but
    // does carry mode/cardinality).
    const profile = byName.get("JeswrProfileCard");
    expect(profile?.solid?.class).toBeUndefined();
    expect(profile?.solid?.mode).toBe("view");
    expect(profile?.solid?.cardinality).toBe("one");
  });

  it("each @solid-class edge in the manifest has a matching resolver-map entry", () => {
    const mapClasses = new Set(RESOLVER_ENTRIES.map((e) => e.targetClass));
    for (const d of classDecls()) {
      const cls = d.solid?.class;
      if (!cls) continue;
      expect(
        mapClasses.has(cls),
        `@solid-class ${cls} (on ${d.name}) must be in the resolver map`,
      ).toBe(true);
    }
  });

  it("each per-class resolver entry's class is advertised by exactly one element's @solid-class", () => {
    const tagByClass = new Map<string, string>();
    for (const d of classDecls()) {
      if (d.solid?.class && d.tagName) tagByClass.set(d.solid.class, d.tagName);
    }
    // A resolver class that an element ADVERTISES via @solid-class must route to that
    // same element's tag. The map ALSO carries a few ALIAS entries that no single
    // element advertises (a Lit element's @solid-class JSDoc tag holds ONE value, but
    // an element legitimately renders SEVERAL classes): vcard:AddressBook routes to
    // <jeswr-contact-list> (which advertises vcard:Individual), and ldp:BasicContainer
    // routes to <jeswr-collection> (which advertises ldp:Container). These are the
    // KNOWN, justified map-only aliases.
    const ALLOWED_MAP_ONLY: Record<string, string> = {
      "http://www.w3.org/2006/vcard/ns#AddressBook": "jeswr-contact-list",
      "http://www.w3.org/ns/ldp#BasicContainer": "jeswr-collection",
    };
    for (const entry of RESOLVER_ENTRIES) {
      const manifestTag = tagByClass.get(entry.targetClass);
      if (manifestTag === undefined) {
        expect(
          ALLOWED_MAP_ONLY[entry.targetClass],
          `resolver class ${entry.targetClass} is map-only — it must be a KNOWN alias`,
        ).toBe(entry.tagName);
        continue;
      }
      expect(manifestTag, `resolver class ${entry.targetClass}`).toBe(entry.tagName);
    }
  });
});

describe("custom-elements.json — kind:js exports match the dist runtime", () => {
  it("every barrel `kind: js` export is a REAL value export in dist/index.js", () => {
    const barrel = cem.modules.find((m) => m.path === "src/index.ts");
    expect(barrel, "the barrel module is in the manifest").toBeDefined();
    const jsExports = (barrel?.exports ?? []).filter((e) => e.kind === "js");
    // There IS at least one js export (the element classes / resolver functions).
    expect(jsExports.length).toBeGreaterThan(0);
    for (const e of jsExports) {
      // A `kind: js` export must exist as a real runtime value in the built dist —
      // i.e. it was NOT a type-only re-export (those are stripped by the plugin).
      expect(
        distExportNames.has(e.name),
        `manifest advertises kind:js export "${e.name}" but it is not a runtime export of dist/index.js`,
      ).toBe(true);
    }
  });

  it("a type-only export (e.g. ReadOptions) is NOT advertised as kind:js", () => {
    const barrel = cem.modules.find((m) => m.path === "src/index.ts");
    const jsNames = new Set(
      (barrel?.exports ?? []).filter((e) => e.kind === "js").map((e) => e.name),
    );
    // These are `export type` / inline `type` re-exports — erased by tsc, absent from
    // dist runtime, so the plugin must have excluded them from the kind:js list.
    for (const typeOnly of ["ReadOptions", "ReadResult", "ComponentEntry", "ComponentMode"]) {
      expect(jsNames.has(typeOnly), `${typeOnly} must NOT be a kind:js export`).toBe(false);
      expect(distExportNames.has(typeOnly), `${typeOnly} is not a dist runtime export`).toBe(false);
    }
  });
});
