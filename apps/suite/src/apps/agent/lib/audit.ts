// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { canonicalJson, digestOf, isIri } from "@jeswr/agent-model";
import { parseRdf } from "@jeswr/fetch-rdf";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { z } from "zod";
import { type AgentClient, AgentReadError, type Row } from "./client";
import { AGENT, PROV, RDF, resourceSlug } from "./paths";

export const AUDIT_KINDS = [
  "ingest",
  "proposal",
  "decision",
  "approval-seen",
  "transmission",
  "receipt",
  "control",
  "mandate-change",
  "model-call",
  "tamper-suspected",
] as const;
export const AUDIT_SCOPE =
  "Checks the records shown here. It can't detect records that were never written.";
export const GENESIS = "sha-256:genesis";
const digest = z.string().regex(/^sha-256:[a-f0-9]{64}$/);
const iri = z
  .string()
  .max(2048)
  .refine(isIri)
  .refine((v) => !/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(v));
const label = z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const recipient = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const terms = z.strictObject({
  action: iri,
  target: iri,
  binding: label,
  accountId: label,
  recipientHashes: z.array(recipient).min(1).max(100),
  messageDigest: digest,
  purpose: iri.optional(),
});
const recordSchema = z.strictObject({
  type: z.enum(AUDIT_KINDS),
  id: iri,
  agent: iri,
  owner: iri,
  proposal: iri.optional(),
  mandate: iri.optional(),
  approval: iri.optional(),
  decisionRecord: iri.optional(),
  transmission: iri.optional(),
  receipt: iri.optional(),
  terms: terms.optional(),
  termsDigest: digest.optional(),
  messageDigest: digest.optional(),
  decision: z.enum(["permit", "confirm-required", "prohibited", "refuse-all"]).optional(),
  status: z.enum(["attempting", "sent", "not-sent", "uncertain", "refused"]).optional(),
  reason: label.optional(),
  accountId: label.optional(),
  recipientHashes: z.array(recipient).max(100).optional(),
  context: z.enum(["reader", "proposer"]).optional(),
  provider: z.enum(["openai", "anthropic"]).optional(),
  model: label.optional(),
  tokens: count.optional(),
  toolCalls: count.optional(),
  latencyMs: count.optional(),
  retries: count.optional(),
});
const ledgerRecord = z.union([
  recordSchema,
  z.strictObject({
    type: z.literal("ledger-checkpoint"),
    lastPrunedSeq: count.min(1),
    lastPrunedHash: digest,
  }),
]);
const entrySchema = z.object({
  seq: count.min(1),
  at: z.iso.datetime({ precision: 3 }),
  prev: z.union([digest, z.literal(GENESIS)]),
  record: ledgerRecord,
  hash: digest,
});
export type AuditRecord = z.infer<typeof recordSchema>;
export type AuditEntry = z.infer<typeof entrySchema>;
export interface AuditHead {
  seq: number;
  hash: string;
}
export interface RangeCheck {
  ok: boolean;
  firstBadSeq?: number | undefined;
  problem?: string;
  scope: string;
}

/** The input order is meaningful: callers pass oldest first, never sort away tampering. */
export function verifyRange(
  entries: readonly AuditEntry[],
  head?: AuditHead,
  through = head?.seq,
): RangeCheck {
  const fail = (problem: string, firstBadSeq?: number): RangeCheck => ({
    ok: false,
    problem,
    firstBadSeq,
    scope: AUDIT_SCOPE,
  });
  let previous = entries[0]?.prev;
  const first = entries[0]?.seq;
  for (const [i, entry] of entries.entries()) {
    if (!entrySchema.safeParse(entry).success) return fail("Malformed record", entry?.seq);
    if (entry.seq !== (first as number) + i) return fail("Sequence gap", entry.seq);
    if ((entry.seq === 1 && entry.prev !== GENESIS) || entry.prev !== previous)
      return fail("Broken link", entry.seq);
    const { seq, at, prev, record } = entry;
    if (digestOf({ seq, at, prev, record }) !== entry.hash) return fail("Hash mismatch", entry.seq);
    previous = entry.hash;
  }
  const last = entries.at(-1);
  // A supplied head means the latest range, unless a historical endpoint is explicit.
  if (through !== undefined && (!last || last.seq < through))
    return fail(`Record ${through} is missing`, through);
  if (head && last && (last.seq > head.seq || (last.seq === head.seq && last.hash !== head.hash)))
    return fail("Head mismatch", last.seq);
  return { ok: true, scope: AUDIT_SCOPE };
}

/** Single-valued, kind-checked wrapper accessors for the daemon's PROV projection. */
class AuditNode extends TermWrapper {
  values(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself);
  }
  text(predicate: string, datatype?: string): string {
    const values = [...this.values(predicate)];
    const value = values[0];
    if (
      values.length !== 1 ||
      value?.termType !== "Literal" ||
      (datatype && value.datatype.value !== datatype)
    )
      throw new Error("Invalid audit field");
    return value.value;
  }
  iri(predicate: string, value: string) {
    this.values(predicate).add(DataFactory.namedNode(value));
  }
  literal(predicate: string, value: string, datatype = "http://www.w3.org/2001/XMLSchema#string") {
    this.values(predicate).add(DataFactory.literal(value, DataFactory.namedNode(datatype)));
  }
}
const node = (store: Store, url: string) => new AuditNode(url, store, DataFactory);
const write = (store: Store): Promise<string> =>
  new Promise((resolve, reject) => {
    const writer = new Writer({ format: "Turtle", prefixes: { agent: AGENT, prov: PROV } });
    writer.addQuads([...store]);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
export async function auditFromTurtle(body: string, url: string): Promise<AuditEntry> {
  const store = new Store([...(await parseRdf(body, "text/turtle", { baseIRI: url }))]);
  const n = node(store, url);
  if (
    ![...n.values(`${RDF}type`)].some(
      (t) => t.termType === "NamedNode" && t.value === `${PROV}Activity`,
    )
  )
    throw new Error("Invalid audit activity");
  const seq = n.text(`${AGENT}seq`);
  if (!/^[1-9]\d*$/.test(seq)) throw new Error("Invalid audit sequence");
  const entry = entrySchema.parse({
    seq: Number(seq),
    at: n.text(`${PROV}startedAtTime`),
    prev: n.text(`${AGENT}prevHash`),
    hash: n.text(`${AGENT}ledgerHash`),
    record: JSON.parse(n.text(`${AGENT}record`, `${RDF}JSON`)),
  });
  if (!isomorphic([...store], [...entryGraph(url, entry)]))
    throw new Error("Audit projection disagrees with the record");
  return entry;
}
export function sealAudit(
  seq: number,
  at: string,
  prev: string,
  record: AuditEntry["record"],
): AuditEntry {
  const checked = ledgerRecord.parse(JSON.parse(canonicalJson(record)));
  return entrySchema.parse({
    seq,
    at,
    prev,
    record: checked,
    hash: digestOf({ seq, at, prev, record: checked }),
  });
}
/** Mirrors the daemon's entryGraph: the entire projection is covered, including #entry. */
function entryGraph(url: string, entry: AuditEntry): Store {
  const store = new Store();
  const n = node(store, url);
  const entity = node(store, new URL("#entry", url).href);
  n.iri(`${RDF}type`, `${PROV}Activity`);
  entity.iri(`${RDF}type`, `${PROV}Entity`);
  n.iri(`${PROV}generated`, entity.value);
  n.literal(`${AGENT}seq`, String(entry.seq), "http://www.w3.org/2001/XMLSchema#integer");
  n.literal(`${PROV}startedAtTime`, entry.at, "http://www.w3.org/2001/XMLSchema#dateTime");
  n.literal(`${AGENT}ledgerHash`, entry.hash);
  n.literal(`${AGENT}prevHash`, entry.prev);
  n.literal(`${AGENT}record`, canonicalJson(entry.record), `${RDF}JSON`);
  if (entry.record.type !== "ledger-checkpoint") {
    const r = entry.record;
    n.iri(`${PROV}wasAssociatedWith`, r.agent);
    entity.iri(`${PROV}wasAttributedTo`, r.owner);
    n.iri(`${PROV}generated`, r.id);
    for (const id of [
      r.proposal,
      r.mandate,
      r.approval,
      r.decisionRecord,
      r.transmission,
      r.receipt,
    ])
      if (id !== undefined) n.iri(`${PROV}used`, id);
    if (r.type === "decision") writeDecisionRecord(n, r, entry.at);
  }
  return store;
}
// Daemon agent-audit/decision-record.ts (local history 9a43f587), also called by entryGraph.
function writeDecisionRecord(n: AuditNode, record: AuditRecord, at: string): void {
  n.iri(`${RDF}type`, `${AGENT}DecisionRecord`);
  n.literal(`${AGENT}evaluatedAt`, at, "http://www.w3.org/2001/XMLSchema#dateTime");
  n.iri(`${AGENT}rootPrincipal`, record.owner);
  n.iri(`${AGENT}leafAssignee`, record.agent);
  if (record.decision !== undefined) n.literal(`${AGENT}decision`, record.decision);
  if (record.reason !== undefined) n.literal(`${AGENT}reason`, record.reason);
  if (record.termsDigest !== undefined) n.literal(`${AGENT}termsDigest`, record.termsDigest);
  if (record.mandate !== undefined) n.iri(`${AGENT}chainPolicy`, record.mandate);
  if (record.terms !== undefined) {
    n.iri(`${AGENT}requestAction`, record.terms.action);
    n.iri(`${AGENT}requestTarget`, record.terms.target);
    if (record.terms.purpose !== undefined) n.iri(`${AGENT}requestPurpose`, record.terms.purpose);
  }
}
export function auditToTurtle(url: string, entry: AuditEntry): Promise<string> {
  return write(entryGraph(url, entry));
}
export const HEAD_MISSING = "The audit head is missing";
/** The latest range is only trustworthy against a published head: no head, no green check. */
export function verifyLatestRange(
  entries: readonly AuditEntry[],
  head: AuditHead | undefined,
  through = head?.seq,
): RangeCheck {
  if (!head && entries.length)
    return {
      ok: false,
      problem: HEAD_MISSING,
      scope: AUDIT_SCOPE,
    };
  return verifyRange(entries, head, through);
}
function headGraph(url: string, head: AuditHead): Store {
  const store = new Store();
  const n = node(store, url);
  n.iri(`${RDF}type`, `${AGENT}AuditChain`);
  n.iri(`${RDF}type`, `${PROV}Collection`);
  n.literal(`${AGENT}seq`, String(head.seq), "http://www.w3.org/2001/XMLSchema#integer");
  n.literal(`${AGENT}ledgerHash`, head.hash);
  n.iri(`${PROV}hadMember`, new URL(`${head.seq}.ttl#entry`, url).href);
  return store;
}
export function auditHeadToTurtle(url: string, head: AuditHead): Promise<string> {
  return write(headGraph(url, head));
}
export async function readAuditHead(client: AgentClient): Promise<AuditHead | undefined> {
  let doc: Awaited<ReturnType<AgentClient["graph"]>>;
  try {
    doc = await client.graph(client.paths.auditChain);
  } catch (error) {
    if (error instanceof AgentReadError && error.status === 404) return undefined;
    throw error;
  }
  const store = new Store([...doc.dataset]);
  const n = node(store, client.paths.auditChain);
  const seq = n.text(`${AGENT}seq`);
  if (!/^[1-9]\d*$/.test(seq)) throw new Error("Invalid audit head");
  const head = {
    seq: count.min(1).max(200000).parse(Number(seq)),
    hash: digest.parse(n.text(`${AGENT}ledgerHash`)),
  };
  // Like the daemon's reader, accept only the exact head projection: no extra claims.
  if (!isomorphic([...store], [...headGraph(client.paths.auditChain, head)]))
    throw new Error("Invalid audit head");
  return head;
}
/** Select the newest sequence IRIs before fetching, with at most six bounded reads in flight. */
export async function readAudit(
  client: AgentClient,
  options: { limit?: number; before?: number } = {},
): Promise<Row<AuditEntry>[]> {
  const limit = options.limit ?? 500;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 5000)
    throw new Error("Invalid audit limit");
  if (limit === 0 || (options.before !== undefined && options.before <= 1)) return [];
  const members = (await client.list(client.paths.audit))
    .filter((m) => !m.container && m.url !== client.paths.auditChain)
    .map((member) => {
      const slug = resourceSlug(member.url);
      const seq = slug && /^[1-9]\d*$/.test(slug) ? Number(slug) : NaN;
      return { ...member, seq: Number.isSafeInteger(seq) ? seq : -1 };
    })
    .filter((m) => options.before === undefined || m.seq < options.before)
    .sort((a, b) => b.seq - a.seq || a.url.localeCompare(b.url))
    .slice(0, limit);
  const rows: Row<AuditEntry>[] = [];
  const work = members.entries();
  await Promise.all(
    Array.from({ length: Math.min(6, members.length) }, async () => {
      for (const [index, member] of work) {
        const { url, seq } = member;
        try {
          if (seq < 0) throw new Error("Invalid audit sequence");
          const doc = await client.graph(url);
          const record = await auditFromTurtle(doc.text, url);
          if (record.seq !== seq) throw new Error("Audit sequence differs from its resource");
          rows[index] = { url, record, etag: doc.etag, verified: "unchecked" };
        } catch (error) {
          rows[index] = { url, error };
        }
      }
    }),
  );
  return rows;
}
export function auditJsonLd(entries: readonly AuditEntry[], base: string) {
  return {
    "@context": { agent: AGENT, prov: PROV },
    "@graph": entries.map((entry) => ({
      "@id": `${base}${entry.seq}.ttl`,
      "@type": "prov:Activity",
      "prov:generated": [
        {
          "@id": `${base}${entry.seq}.ttl#entry`,
          "@type": "prov:Entity",
          ...(entry.record.type === "ledger-checkpoint"
            ? {}
            : { "prov:wasAttributedTo": { "@id": entry.record.owner } }),
        },
        ...(entry.record.type === "ledger-checkpoint" ? [] : [{ "@id": entry.record.id }]),
      ],
      "agent:seq": entry.seq,
      "prov:startedAtTime": {
        "@value": entry.at,
        "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
      },
      "agent:ledgerHash": entry.hash,
      "agent:prevHash": entry.prev,
      "agent:record": { "@value": entry.record, "@type": "@json" },
      ...(entry.record.type === "ledger-checkpoint"
        ? {}
        : {
            "prov:wasAssociatedWith": { "@id": entry.record.agent },
            "prov:used": [
              entry.record.proposal,
              entry.record.mandate,
              entry.record.approval,
              entry.record.decisionRecord,
              entry.record.transmission,
              entry.record.receipt,
            ]
              .filter((id) => id !== undefined)
              .map((id) => ({ "@id": id })),
          }),
    })),
  };
}
