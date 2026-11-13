// AUTHORED-BY Codex GPT-6.1-Sol
// Learn filter-selected writes as resolve/read + write, without extending the contract.
import {
  type Flow,
  isSelectionFilter,
  type Operation,
  type Parameter,
  SCHEMA,
  SELECTION_IDENTITIES,
} from "@jeswr/site-model";
import { operationId } from "./operations.js";

export interface LearnedSelection {
  flow: Flow;
  read: Operation;
  witness: string;
  property: string;
  /** write input -> read input */
  filters: Record<string, string>;
}

function dispatch(op: Operation): string | undefined {
  const url = new URL(op.request.urlTemplate.replace(/\{[^}]*\}/g, ""));
  const body = new URLSearchParams(op.request.bodyTemplate);
  for (const key of ["namespace", "resource", "collection", "dataset"]) {
    const value = url.searchParams.get(key) ?? body.get(key);
    if (value && !value.includes("{")) return `${key}=${value}`;
  }
  return undefined;
}
function sameFamily(write: Operation, read: Operation): boolean {
  const wd = dispatch(write),
    rd = dispatch(read);
  if (wd || rd) return wd !== undefined && wd === rd;
  const family = (op: Operation) =>
    new URL(op.request.urlTemplate.replace(/\{[^}]*\}/g, "")).pathname
      .split("/")
      .filter(Boolean)
      .filter(
        (word) =>
          !/^(search|find|list|index|grid|render|massdelete|delete|remove|update|save)$/i.test(
            word,
          ),
      )
      .join("/");
  return family(write) === family(read);
}
const key = (p: Parameter) =>
  decodeURIComponent(p.name)
    .replace(/\[([^\]]+)\]/g, ".$1")
    .toLowerCase();

/** Mutates only newly learned operations; an unresolved write remains flow-only (fail closed). */
export function learnFilterSelections(
  operations: Operation[],
  modelId: string,
  usedIds: Set<string>,
): { selections: Map<string, LearnedSelection>; warnings: string[] } {
  const selections = new Map<string, LearnedSelection>();
  const warnings: string[] = [];
  for (const write of operations) {
    const filters = write.inputs.filter((p) => isSelectionFilter(p.name));
    const explicitIds = write.inputs.some(
      (p) =>
        /^(?:selected|ids?|identifiers?|sku|product_?id|item_?id)(?:\[\d*\])?$/i.test(
          decodeURIComponent(p.name),
        ) ||
        p.path.some((property) => SELECTION_IDENTITIES.includes(property)) ||
        (p.location === "path" && p.path.includes(`${SCHEMA}object`)),
    );
    if (write.effect === "read" || !filters.length || explicitIds) continue;
    // This input is required and cannot be supplied by an ActionRequest. The explicit
    // template deliberately leaves it off the wire; the Flow supplies trusted evidence.
    let witness = "resolvedIdentity";
    while (write.inputs.some((p) => p.name === witness)) witness += "_";
    write.inputs.push({
      name: witness,
      path: [],
      range: "http://www.w3.org/2001/XMLSchema#string",
      required: true,
      location: "body",
    });
    if (write.request.bodyTemplate === undefined) {
      // Flat forms have an implicit template. Make it explicit before adding evidence.
      if (write.request.contentType === "application/json")
        write.request.bodyTemplate = JSON.stringify(
          Object.fromEntries(
            write.inputs
              .filter((p) => p.name !== witness && (p.location === "body" || p.location === "form"))
              .map((p) => [p.name, `{${p.name}}`]),
          ),
        );
      else
        write.request.bodyTemplate = new URLSearchParams(
          write.inputs
            .filter((p) => p.name !== witness && (p.location === "body" || p.location === "form"))
            .map((p) => [decodeURIComponent(p.name), `{${p.name}}`]),
        ).toString();
    }
    const candidates = operations.filter(
      (read) =>
        read.effect === "read" &&
        read.request.method === "GET" &&
        read.extraction?.itemPath !== undefined &&
        sameFamily(write, read) &&
        filters.every((p) => read.inputs.some((r) => key(r) === key(p))),
    );
    // Prefer the search variant to its ViewAction twin, without arbitrary tie-breaking.
    const search = candidates.filter((read) => read.actionType === `${SCHEMA}SearchAction`);
    const choices = search.length ? search : candidates;
    const read = choices.length === 1 ? choices[0] : undefined;
    const property = SELECTION_IDENTITIES.find((iri) =>
      read?.extraction?.fields.some((f) => f.property === iri && !f.untrusted),
    );
    if (!read || !property) {
      warnings.push(
        `filter-selected write ${write.label}: no unique matching identity read; left flow-only`,
      );
      continue;
    }
    const inputs = read.inputs.map((p) => ({ ...p, path: [...p.path] }));
    const readBind: Record<string, string> = {};
    const writeBind: Record<string, string> = { [witness]: `$step0.${property}` };
    const mapping: Record<string, string> = {};
    for (const p of inputs) {
      readBind[p.name] = `$input.${p.name}`;
    }
    for (const filter of filters) {
      const p = inputs.find((p) => key(p) === key(filter)) as Parameter;
      p.path = [...filter.path];
      p.required = true;
      delete p.default;
      mapping[filter.name] = p.name;
      writeBind[filter.name] = `$input.${p.name}`;
    }
    for (const p of write.inputs) {
      if (p.name === witness || mapping[p.name]) continue;
      let name = p.name;
      while (inputs.some((i) => i.name === name)) name += "_write";
      inputs.push({ ...p, name, path: [...p.path] });
      writeBind[p.name] = `$input.${name}`;
    }
    const flow: Flow = {
      id: operationId(modelId, `${write.label} resolved selection`, usedIds),
      actionType: write.actionType,
      label: write.label,
      effect: write.effect,
      inputs,
      steps: [
        { operation: read.id, bind: readBind },
        { operation: write.id, bind: writeBind },
      ],
      provenance: { ...write.provenance },
    };
    selections.set(write.id, { flow, read, witness, property, filters: mapping });
  }
  return { selections, warnings };
}
