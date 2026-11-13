// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type ActionRequest,
  type Flow,
  isSelectionFilter,
  type Operation,
  SAB,
  SCHEMA,
  SELECTION_IDENTITIES,
  selectionWitnesses,
} from "@jeswr/site-model";
import type { CompiledRequest } from "./compile.js";
import type { ExtractedItem, ExtractOutput } from "./extract.js";
import { canonicalJson } from "./gate.js";
import { BindingError, expandIri } from "./values.js";
import { effectiveWireFields } from "./wire.js";

/** Compare the actual selectors, including fixed fields and optional read defaults. */
export function assertSelectionFilters(
  read: CompiledRequest | undefined,
  write: CompiledRequest,
): void {
  if (!read) throw new SelectionRefusal("selection read has no concrete request");
  const filters = (compiled: CompiledRequest) =>
    effectiveWireFields(compiled)
      .flatMap((field) => {
        const name = field.name
          .replace(/^\//, "")
          .replaceAll("/", ".")
          .replace(/\[([^\]]+)\]/g, ".$1");
        return field.location !== "header" && isSelectionFilter(name) ? [[name, field.value]] : [];
      })
      .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  if (canonicalJson(filters(read)) !== canonicalJson(filters(write)))
    throw new SelectionRefusal("selection read and write wire filters differ");
}

export class SelectionRefusal extends Error {
  override name = "SelectionRefusal";
}
export interface SelectionSource {
  step: number;
  property: string;
  filters: Record<string, string>;
}
export interface SelectionEvidence {
  revalidate: number[];
  identities: string[];
  names: string[];
}

/** A witness must bind to an earlier trusted identity read. Filter bindings must be
 * identical, so the read resolves exactly the filter the write will send.
 */
export function selectionSources(
  flow: Flow,
  index: number,
  operations: Operation[],
): SelectionSource[] {
  const write = operations[index] as Operation;
  return selectionWitnesses(write).map((witness) => {
    const ref = /^\$step(\d+)\.(.+)$/.exec(flow.steps[index]?.bind[witness.name] ?? "");
    const n = Number(ref?.[1]);
    const property = expandIri(ref?.[2] ?? "");
    const read = operations[n];
    if (
      !ref ||
      n >= index ||
      read?.effect !== "read" ||
      read.request.method !== "GET" ||
      !SELECTION_IDENTITIES.includes(property) ||
      !read.extraction?.fields.some((f) => expandIri(f.property) === property && !f.untrusted)
    )
      throw new BindingError("selection witness needs an earlier trusted identity read");
    if (operations.slice(n + 1, index).some((op) => op.effect !== "read"))
      throw new BindingError("selection read must follow every preceding write");
    const filters: Record<string, string> = {};
    for (const p of write.inputs.filter((p) => isSelectionFilter(p.name))) {
      const spec = flow.steps[index]?.bind[p.name];
      const match = read.inputs.filter(
        (r) =>
          isSelectionFilter(r.name) &&
          spec?.startsWith("$") &&
          flow.steps[n]?.bind[r.name] === spec,
      );
      if (match.length !== 1)
        throw new BindingError("selection read and write must share every filter binding");
      filters[p.name] = (match[0] as { name: string }).name;
    }
    if (!Object.keys(filters).length)
      throw new BindingError("selection witness needs filter inputs");
    return { step: n, property, filters };
  });
}

/** All is an explicit planner value, never inferred from a broad object name. */
export function requestsAll(request: ActionRequest): boolean {
  const all = request.values([`${SAB}all`]);
  return request.values([`${SCHEMA}object`]).length === 0 && all.length === 1 && all[0] === "true";
}

export function itemName(item: ExtractedItem): string | undefined {
  return (
    item.values.get(`${SCHEMA}name`)?.[0] ??
    SELECTION_IDENTITIES.flatMap((property) => item.values.get(property) ?? [])[0] ??
    item.iri
  );
}

export function resolveSelection(
  sources: SelectionSource[],
  records: Array<{ output?: ExtractOutput; inputs?: Record<string, string> }>,
  items: ExtractedItem[][],
  request: ActionRequest,
): SelectionEvidence | undefined {
  if (!sources.length) return undefined;
  const identities: string[] = [],
    names: string[] = [];
  for (const source of sources) {
    const record = records[source.step];
    const selected = items[source.step] ?? [];
    if (!record?.output || record.output.truncation.items || record.output.truncation.values)
      throw new SelectionRefusal("selection read is partial or truncated");
    if (!selected.length) throw new SelectionRefusal("selection matched zero items");
    if (selected.length > 1 && !requestsAll(request))
      throw new SelectionRefusal(
        "selection matched more than one item; narrow the filter or explicitly request all",
      );
    for (const item of selected) {
      const id = item.values.get(source.property);
      if (id?.length !== 1 || !id[0])
        throw new SelectionRefusal("selection needs one trusted identity per item");
      // Bind every available typed identity; response ordering has no meaning.
      identities.push(
        canonicalJson({
          step: source.step,
          identities: Object.fromEntries(
            SELECTION_IDENTITIES.map((property) => [
              property,
              [...(item.values.get(property) ?? [])].sort(),
            ]),
          ),
        }),
      );
      const name = itemName(item) ?? id[0];
      names.push(name === id[0] ? name : `${name} [${id[0]}]`);
    }
  }
  return {
    revalidate: [...new Set(sources.map((source) => source.step))].sort((a, b) => a - b),
    identities: identities.sort(),
    names: names.sort(),
  };
}
