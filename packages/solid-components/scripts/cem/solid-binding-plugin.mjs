// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// solidBindingPlugin — a Custom Elements Manifest analyzer plugin that lifts the
// suite-specific JSDoc binding tags off each element class and emits them into
// the generated `custom-elements.json`, so the RDF-class → custom-element binding
// (codegen-framework #11 §5) lives in ONE generated artifact and an LLM codegen
// tool can discover "which element renders/edits this RDF class" without a
// separate runtime registry.
//
// THE FOUR SUITE TAGS (all OPTIONAL — the plugin no-ops cleanly when absent, so a
// chrome element with no data model carries no `solid` block):
//   @solid-class       <IRI>            the RDF class the element binds to
//   @solid-shape       <IRI>            the SHACL/shape IRI describing its data
//   @solid-mode        view | edit      whether it renders or edits that data
//   @solid-cardinality one  | container one resource, or a container of them
//
// Emitted onto the element's classDoc as:
//   "solid": { "class": "...", "shape": "...", "mode": "...", "cardinality": "..." }
// Only the keys that were present are written (so a partial annotation is faithful).
//
// IT ALSO drops Lit `state: true` reactive properties from the manifest. The
// upstream lit framework plugin's `isAlsoAttribute` only excludes `attribute:
// false` — it does NOT recognise `state: true`, so an element's INTERNAL reactive
// state (`_open`, `_category`, …) would otherwise be advertised as a PUBLIC
// attribute + member. That is wrong: Lit state never reflects to an attribute and
// is not public API. We collect the `state: true` property names during analysis
// and strip them in the link phase, so the manifest advertises only the real
// public surface. (Manifest accuracy only — no runtime is touched.)
//
// IT ALSO drops TYPE-ONLY re-exports from a module's `exports` list. The barrel
// (`src/index.ts`) re-exports interfaces / type aliases with TypeScript's inline
// `export { type LoginDetail }` (or a whole `export type { … }`) form. These have
// NO runtime existence — `tsc` erases them, so they are ABSENT from the emitted
// `dist/*.js` — yet the core analyzer emits each as a `"kind": "js"` export,
// indistinguishable from a real value export. A codegen tool reading the manifest
// would then emit an invalid VALUE import (`import { LoginDetail } from …`) for a
// type-only symbol (roborev Medium). We read the SAME `isTypeOnly` flags the TS
// compiler uses to erase them (`ExportDeclaration.isTypeOnly` for
// `export type { … }`, and each `ExportSpecifier.isTypeOnly` for the inline
// `export { type X }` form), collect those names during analysis, and strip the
// matching `kind: js` exports in the link phase — so a symbol survives as
// `kind: js` ONLY when it is a real runtime export in `dist/`. (Manifest accuracy
// only — no runtime is touched.)
//
// HOW IT HOOKS IN: the analyzer's core FEATURES + framework plugins create the
// classDoc during the ANALYZE phase BEFORE any user plugin runs (create.js merges
// `[...FEATURES, ...frameworkPlugins, ...userPlugins]`), so by the time THIS
// plugin's `analyzePhase` sees the class node, the matching classDoc already
// exists in `moduleDoc.declarations` — we just enrich it. We read the SAME
// `node.jsDoc` blocks + comment-parser the core uses (so `@slot`/`@csspart`/
// `@cssprop`/`@fires` are handled by the core's class-jsdoc; this plugin only adds
// the `@solid-*` tags the core doesn't know about), keeping a single, consistent
// JSDoc source of truth.

import { parse } from "comment-parser";

/** The recognised suite tags → the `solid` block key they populate. */
const TAG_TO_KEY = {
  "solid-class": "class",
  "solid-shape": "shape",
  "solid-mode": "mode",
  "solid-cardinality": "cardinality",
};

/** Keys whose value must be an http(s) IRI. */
const IRI_KEYS = new Set(["class", "shape"]);

/** Keys constrained to an enum, and their allowed values. */
const ALLOWED = {
  mode: new Set(["view", "edit"]),
  cardinality: new Set(["one", "container"]),
};

/** http(s)-only IRI guard for `@solid-class` / `@solid-shape` (fail-closed). */
function isHttpIri(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Validate one suite tag's value against its key's rules, throwing on a bad value.
 * @param {string} key the `solid` block key (class/shape/mode/cardinality)
 * @param {string} tagName the original `solid-*` tag, for the diagnostic
 * @param {string} value the trimmed value
 * @param {string} className for diagnostics
 */
function validateTagValue(key, tagName, value, className) {
  const where = `[solidBindingPlugin] ${className}: @${tagName}`;
  if (!value) {
    throw new Error(`${where} has no value (expected @${tagName} <value>).`);
  }
  if (IRI_KEYS.has(key) && !isHttpIri(value)) {
    throw new Error(`${where} value "${value}" is not an http(s) IRI.`);
  }
  const allowed = ALLOWED[key];
  if (allowed && !allowed.has(value)) {
    throw new Error(`${where} value "${value}" must be one of ${[...allowed].join(" | ")}.`);
  }
}

/** Yield each `{ key, tagName, value }` suite tag found across a class's JSDoc blocks. */
function* iterateSuiteTags(jsDocBlocks) {
  for (const block of jsDocBlocks) {
    // Use the SAME extraction the core uses: the raw JSDoc text → comment-parser.
    for (const doc of parse(block.getFullText())) {
      for (const tag of doc.tags ?? []) {
        const key = TAG_TO_KEY[tag.tag];
        if (key) yield { key, tagName: tag.tag, value: (tag.name ?? "").trim() };
      }
    }
  }
}

/**
 * Parse the `@solid-*` tags out of a class node's JSDoc blocks. Returns a partial
 * `solid` object (only the keys present + valid), or `null` when the class carries
 * none of the suite tags (the no-op case).
 *
 * @param {any} node a ClassDeclaration / ClassExpression AST node
 * @param {string} className for diagnostics
 */
function readSolidTags(node, className) {
  const jsDocBlocks = node.jsDoc;
  if (!Array.isArray(jsDocBlocks) || jsDocBlocks.length === 0) return null;

  const solid = {};
  for (const { key, tagName, value } of iterateSuiteTags(jsDocBlocks)) {
    validateTagValue(key, tagName, value, className);
    if (key in solid && solid[key] !== value) {
      throw new Error(
        `[solidBindingPlugin] ${className}: conflicting @${tagName} values ("${solid[key]}" vs "${value}").`,
      );
    }
    solid[key] = value;
  }
  return Object.keys(solid).length > 0 ? solid : null;
}

/** True when a `static properties` member declares this property with `state: true`. */
function isStateProperty(ts, config) {
  if (!config || !ts.isObjectLiteralExpression(config)) return false;
  return config.properties.some(
    (p) =>
      ts.isPropertyAssignment(p) &&
      p.name?.getText() === "state" &&
      p.initializer?.kind === ts.SyntaxKind.TrueKeyword,
  );
}

/** Find the `static properties = { … }` object literal on a class, or null. */
function findStaticPropertiesObject(ts, classNode) {
  for (const member of classNode.members ?? []) {
    const isStaticProps =
      member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) &&
      member.name?.getText() === "properties" &&
      ts.isPropertyDeclaration(member);
    if (!isStaticProps) continue;
    const obj = member.initializer;
    if (obj && ts.isObjectLiteralExpression(obj)) return obj;
  }
  return null;
}

/**
 * Collect the names of `state: true` reactive properties declared in a class's
 * `static properties` block. These are internal Lit state, never public
 * attributes/members, so they must be stripped from the manifest.
 *
 * @param {import('typescript')} ts
 * @param {any} classNode
 * @returns {Set<string>}
 */
function collectStatePropertyNames(ts, classNode) {
  const names = new Set();
  const obj = findStaticPropertiesObject(ts, classNode);
  if (!obj) return names;
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && isStateProperty(ts, prop.initializer)) {
      names.add(prop.name.getText());
    }
  }
  return names;
}

/**
 * Strip the internal Lit state names from BOTH a classDoc's public attributes and
 * its public members — they are never part of the element's public surface.
 * @param {{ attributes?: { name: string }[], members?: { name: string }[] }} decl
 * @param {Set<string>} stateNames
 */
function stripStateFromDeclaration(decl, stateNames) {
  if (Array.isArray(decl.attributes)) {
    decl.attributes = decl.attributes.filter((a) => !stateNames.has(a.name));
  }
  if (Array.isArray(decl.members)) {
    decl.members = decl.members.filter((m) => !stateNames.has(m.name));
  }
}

/**
 * Collect the LOCAL exported names that an `export … from "…"` / `export { … }`
 * declaration introduces as TYPE-ONLY (so they are erased by `tsc` and absent
 * from the emitted JS). Two shapes are recognised, exactly as the compiler does:
 *   - a whole type-only declaration: `export type { A, B } from "…"` /
 *     `export type { A }` — `node.isTypeOnly === true`, so EVERY specifier is
 *     type-only; and
 *   - an inline type-only specifier inside a value declaration:
 *     `export { value, type A } from "…"` — `specifier.isTypeOnly === true`.
 * The local exported name is the specifier's `name` (the alias after `as`, or the
 * sole identifier), which is what lands in `moduleDoc.exports[].name`.
 *
 * @param {import('typescript')} ts
 * @param {any} node an ExportDeclaration AST node
 * @returns {string[]} the type-only export names this declaration contributes
 */
function collectTypeOnlyExportNames(ts, node) {
  if (!ts.isExportDeclaration(node)) return [];
  // `export * from "…"` (no named clause) carries no individual type-only names.
  const clause = node.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return [];
  const declTypeOnly = node.isTypeOnly === true;
  const names = [];
  for (const spec of clause.elements) {
    if (declTypeOnly || spec.isTypeOnly === true) {
      names.push(spec.name.getText());
    }
  }
  return names;
}

/**
 * The plugin. Registered AFTER the framework (lit) plugin in the analyzer config,
 * so it runs once the classDoc exists. Stable, deterministic, side-effect-free
 * apart from enriching/cleaning the classDoc it owns.
 */
export function solidBindingPlugin() {
  // Per-module map: className → Set of `state: true` property names to strip in
  // the link phase. Keyed by module path so concurrent modules don't collide.
  const stateNamesByModule = new Map();

  // Per-module Set of TYPE-ONLY exported names (erased by `tsc`, absent from the
  // emitted JS) to strip from `moduleDoc.exports` in the link phase. Keyed by
  // module path for the same reason.
  const typeOnlyExportsByModule = new Map();

  /** Record this class's `state: true` props for the link-phase cleanup. */
  const recordStateNames = (ts, node, moduleDoc, className) => {
    const stateNames = collectStatePropertyNames(ts, node);
    if (stateNames.size === 0) return;
    let perModule = stateNamesByModule.get(moduleDoc.path);
    if (!perModule) {
      perModule = new Map();
      stateNamesByModule.set(moduleDoc.path, perModule);
    }
    perModule.set(className, stateNames);
  };

  /** Record this declaration's type-only export names for the link-phase cleanup. */
  const recordTypeOnlyExports = (ts, node, moduleDoc) => {
    const names = collectTypeOnlyExportNames(ts, node);
    if (names.length === 0) return;
    let set = typeOnlyExportsByModule.get(moduleDoc.path);
    if (!set) {
      set = new Set();
      typeOnlyExportsByModule.set(moduleDoc.path, set);
    }
    for (const name of names) set.add(name);
  };

  return {
    name: "jeswr-solid-binding",

    analyzePhase({ ts, node, moduleDoc }) {
      // Type-only re-exports never reach `dist/*.js` — record them for the link
      // phase so they are not advertised as runtime (`kind: js`) exports.
      recordTypeOnlyExports(ts, node, moduleDoc);

      // Only class declarations/expressions carry element bindings.
      if (!ts.isClassDeclaration(node) && !ts.isClassExpression(node)) return;
      const className = node.name?.getText() ?? "";
      if (!className) return;

      // 1) Record state-only props for link-phase cleanup.
      recordStateNames(ts, node, moduleDoc, className);

      // 2) Attach the suite `@solid-*` binding block, when present.
      const solid = readSolidTags(node, className);
      if (!solid) return; // no suite tags → no-op (the chrome-element case)
      const classDoc = (moduleDoc.declarations ?? []).find(
        (d) => d.kind === "class" && d.name === className,
      );
      if (classDoc) classDoc.solid = solid;
    },

    moduleLinkPhase({ moduleDoc }) {
      // Strip type-only re-exports from the runtime (`kind: js`) export list, so
      // the manifest advertises a symbol as `kind: js` ONLY when it is a real
      // runtime export in `dist/`.
      const typeOnly = typeOnlyExportsByModule.get(moduleDoc.path);
      if (typeOnly && typeOnly.size > 0 && Array.isArray(moduleDoc.exports)) {
        moduleDoc.exports = moduleDoc.exports.filter(
          (e) => !(e.kind === "js" && typeOnly.has(e.name)),
        );
      }

      const perModule = stateNamesByModule.get(moduleDoc.path);
      if (!perModule) return;
      for (const decl of moduleDoc.declarations ?? []) {
        if (decl.kind !== "class") continue;
        const stateNames = perModule.get(decl.name);
        if (stateNames && stateNames.size > 0) stripStateFromDeclaration(decl, stateNames);
      }
    },
  };
}
