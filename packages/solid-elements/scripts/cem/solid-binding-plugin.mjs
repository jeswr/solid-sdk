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
 * The plugin. Registered AFTER the framework (lit) plugin in the analyzer config,
 * so it runs once the classDoc exists. Stable, deterministic, side-effect-free
 * apart from enriching/cleaning the classDoc it owns.
 */
export function solidBindingPlugin() {
  // Per-module map: className → Set of `state: true` property names to strip in
  // the link phase. Keyed by module path so concurrent modules don't collide.
  const stateNamesByModule = new Map();

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

  return {
    name: "jeswr-solid-binding",

    analyzePhase({ ts, node, moduleDoc }) {
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
