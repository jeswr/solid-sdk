// AUTHORED-BY Codex GPT-6.1-Sol
// Read-only port of apps/access-manager/src/lib/records.ts (AccmRecord / ConsentReceipt).
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Term } from "@rdfjs/types";
import { Store } from "n3";
import { dpvPurposeLabel } from "@/shell/lib/dpv-labels";
import { readResource, subjectOf } from "../model/rdf";
import type { GrantRecord, GrantRecordIndex, ModeId } from "./types";
import { ACL, DPV, ODRL } from "./vocab";

function date(value: string | undefined): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}
export function mergeRecord(a: GrantRecord, b: GrantRecord): GrantRecord {
  const result = { ...a, ...b };
  const created = [a.created, b.created].filter((v) => v !== undefined).sort()[0];
  const modified = [a.modified, b.modified]
    .filter((v) => v !== undefined)
    .sort()
    .at(-1);
  const expiresAt = [a.expiresAt, b.expiresAt].filter((v) => v !== undefined).sort()[0];
  if (created) result.created = created;
  if (modified) result.modified = modified;
  if (expiresAt) result.expiresAt = expiresAt;
  for (const field of ["agents", "targets", "grantRefs"] as const) {
    const values = [...new Set([...(a[field] ?? []), ...(b[field] ?? [])])];
    if (values.length) result[field] = values;
  }
  const modes = new Set([...(a.modes ?? []), ...(b.modes ?? [])]);
  if (modes.has("write")) modes.add("append");
  if (modes.size) result.modes = [...modes];
  if (a.purpose && a.purposeSource === "receipt" && b.purposeSource !== "receipt")
    result.purpose = a.purpose;
  return result;
}
/** Existing approval records lack ACL node refs: match only one complete snapshot. */
export function recordForGrant(
  records: GrantRecordIndex | undefined,
  node: string,
  agent: string,
  resource: string,
  modes: ReadonlySet<ModeId>,
): GrantRecord {
  if (!records) return {};
  const direct = records.get(node);
  if (direct) return direct;
  const matches = [...new Set(records.values())].filter((record) => {
    const availableModes = record.modes ?? [];
    return (
      record.agents?.length === 1 &&
      record.agents[0] === agent &&
      record.grantRefs?.length === 1 &&
      record.targets?.includes(resource) &&
      availableModes.length > 0 &&
      [...modes].every((mode) => availableModes.includes(mode))
    );
  });
  return matches.length === 1 ? (matches[0] as GrantRecord) : {};
}
/** Linked grant refs join a consent receipt to an authorization across documents. */
export function recordsFrom(
  dataset: DatasetCore,
  linked: GrantRecordIndex = new Map(),
): GrantRecordIndex {
  const terms = new Map<string, Term>();
  for (const q of dataset) terms.set(q.subject.value, q.subject);
  const result = new Map<string, GrantRecord>(linked);
  const edges: [string, string][] = [];
  for (const [id, term] of terms) {
    const node = subjectOf(dataset, term);
    const record: GrantRecord = {};
    const created = date(node.texts(`${NS.DCT}created`)[0]);
    const modified = date(node.texts(`${NS.DCT}modified`)[0]);
    if (created) record.created = created;
    if (modified) record.modified = modified;
    const agents = [
      ...node.iris(`${NS.ACCESS_MANAGER}agent`),
      ...node.iris(`${ODRL}assignee`),
      ...node.iris(`${DPV}hasRecipient`),
    ];
    const targets = [...node.iris(`${NS.ACCESS_MANAGER}resolvesTo`), ...node.iris(`${ODRL}target`)];
    const modes: ModeId[] = ["read", "append", "write", "control"];
    const recordedModes = node.iris(`${NS.ACCESS_MANAGER}mode`);
    record.modes = modes.filter((mode) =>
      recordedModes.includes(ACL + mode.charAt(0).toUpperCase() + mode.slice(1)),
    );
    record.agents = agents;
    record.targets = targets;
    const refs = node.iris(`${NS.ACCESS_MANAGER}grantRef`);
    record.grantRefs = node.types.includes(`${ODRL}Agreement`) ? [id] : refs;
    const expiry = [
      ...node.texts(`${NS.ACCESS_MANAGER}expiresAt`),
      ...node.texts(`${NS.ACCESS_MANAGER}expiry`),
      ...node.texts(`${ODRL}dateTime`),
      ...node.texts(`${ODRL}endTime`),
    ];
    const receiptPurpose = node.objects(`${DPV}hasPurpose`)[0];
    let purpose = receiptPurpose ?? node.objects(`${ODRL}purpose`)[0];
    for (const constraint of node.objects(`${ODRL}constraint`)) {
      const condition = subjectOf(dataset, constraint);
      if (
        condition.iris(`${ODRL}leftOperand`).includes(`${ODRL}dateTime`) &&
        condition
          .iris(`${ODRL}operator`)
          .some((op) => ["lt", "lteq"].includes(op.slice(ODRL.length)))
      )
        expiry.push(...condition.texts(`${ODRL}rightOperand`));
      if (
        condition.iris(`${ODRL}leftOperand`).includes(`${ODRL}purpose`) &&
        condition.iris(`${ODRL}operator`).includes(`${ODRL}eq`)
      )
        purpose ??= condition.objects(`${ODRL}rightOperand`)[0];
    }
    const expiresAt = expiry
      .map(date)
      .filter((v) => v !== undefined)
      .sort()[0];
    if (expiresAt) record.expiresAt = expiresAt;
    if (purpose?.termType === "Literal") record.purpose = { label: purpose.value };
    if (purpose?.termType === "NamedNode") {
      const labels = subjectOf(dataset, purpose);
      const label =
        labels.texts(`${NS.RDFS}label`)[0] ??
        labels.texts("http://www.w3.org/2004/02/skos/core#prefLabel")[0] ??
        dpvPurposeLabel(purpose.value);
      if (label) record.purpose = { iri: purpose.value, label };
    }
    if (record.purpose && receiptPurpose) record.purposeSource = "receipt";
    for (const field of ["agents", "targets", "modes", "grantRefs"] as const)
      if (!record[field]?.length) delete record[field];
    result.set(id, mergeRecord(result.get(id) ?? {}, record));
    for (const ref of [...refs, ...node.objects(`${ODRL}permission`).map((term) => term.value)])
      edges.push([id, ref]);
  }
  // Join connected components once, including permission blank nodes. All aliases
  // share one value, so a receipt cannot be mistaken for a second matching grant.
  const graph = new Map<string, Set<string>>();
  const neighbors = (id: string) => {
    let values = graph.get(id);
    if (!values) {
      values = new Set();
      graph.set(id, values);
    }
    return values;
  };
  for (const [id, record] of result) {
    neighbors(id);
    for (const ref of record.grantRefs ?? []) edges.push([id, ref]);
  }
  for (const [a, b] of edges) {
    neighbors(a).add(b);
    neighbors(b).add(a);
  }
  const seen = new Set<string>();
  for (const id of graph.keys()) {
    if (seen.has(id)) continue;
    const component = [id];
    let merged: GrantRecord = {};
    for (const current of component) {
      if (seen.has(current)) continue;
      seen.add(current);
      merged = mergeRecord(merged, result.get(current) ?? {});
      component.push(...neighbors(current));
    }
    for (const current of component) result.set(current, merged);
  }
  return result;
}
export async function readGrantRecords(
  fetch: typeof globalThis.fetch,
  storage: string,
): Promise<GrantRecordIndex> {
  const scoped: typeof fetch = (input, init) =>
    fetch(assertWithinPodScope(storage, String(input)), { ...init, redirect: "error" });
  const url = new URL("settings/access-records/", storage).href;
  let listing: Awaited<ReturnType<typeof readResource>>;
  try {
    listing = await readResource(scoped, url);
  } catch (error) {
    if (error instanceof RdfFetchError && error.status === 404) return new Map();
    throw error;
  }
  const dataset = new Store([...listing.dataset]);
  for (const child of new Set(subjectOf(listing.dataset, url).contains)) {
    // Child folders and auxiliary documents are not grant records.
    if (child.endsWith("/") || new URL(child).pathname.endsWith(".acl")) continue;
    const resource = await readResource(scoped, child);
    dataset.addQuads([...resource.dataset]);
  }
  return recordsFrom(dataset);
}
