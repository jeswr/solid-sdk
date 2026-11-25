// AUTHORED-BY Claude Opus 5.5
/**
 * renderCatalogue: the compact listing a planner LLM sees. One line per flow, then one per
 * operation, in model order. It names actions, effects and the action properties that
 * supply inputs; it never shows URLs, templates, CSRF rules or anything about sessions.
 */
import type { Flow, Operation, Parameter, SiteModel } from "./types.js";
import { SAB, SCHEMA } from "./types.js";
import { XSD } from "./vocab.js";

const CATALOGUE_PREFIXES: [string, string][] = [
  ["schema", SCHEMA],
  ["xsd", XSD],
  ["sab", SAB],
];

/**
 * Compact an IRI with the schema:, xsd: and sab: prefixes. Any other IRI is shown by its
 * short name, so no URL ever reaches the catalogue.
 */
export function compactIri(iri: string): string {
  for (const [prefix, namespace] of CATALOGUE_PREFIXES) {
    const local = iri.slice(namespace.length);
    if (iri.startsWith(namespace) && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(local)) {
      return `${prefix}:${local}`;
    }
  }
  return shortName(iri);
}

/** The short name of an action: its IRI fragment, else its last path segment. */
export function shortName(id: string): string {
  const hash = id.lastIndexOf("#");
  if (hash >= 0 && hash < id.length - 1) return id.slice(hash + 1);
  const segments = id
    .replace(/#$/, "")
    .split(/[/:]/)
    .filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? id;
}

/** A parameter's path: schema.org local names joined by '/', other predicates compacted. */
function pathLabel(path: string[]): string {
  return path
    .map((p) => (compactIri(p).startsWith("schema:") ? p.slice(SCHEMA.length) : compactIri(p)))
    .join("/");
}

function inputLabel(p: Parameter): string {
  const details = [compactIri(p.range)];
  if (p.required) details.push("required");
  if (p.options !== undefined)
    details.push(`one of ${p.options.map((o) => JSON.stringify(o)).join("|")}`);
  return `${pathLabel(p.path)}(${details.join(", ")})`;
}

function line(action: Operation | Flow): string {
  const type = compactIri(action.actionType);
  const columns = [
    shortName(action.id),
    type.startsWith("schema:") ? type.slice("schema:".length) : type,
    action.effect,
  ];
  // Inputs without a path are filled by flow bindings: the planner cannot set them.
  const inputs = action.inputs.filter((p) => p.path.length > 0).map(inputLabel);
  columns.push(inputs.length ? `inputs: ${inputs.join(" ")}` : "inputs: none");
  columns.push(JSON.stringify(action.label));
  return columns.join("  ");
}

export function renderCatalogue(model: SiteModel): string {
  return [...model.flows, ...model.operations].map(line).join("\n");
}
