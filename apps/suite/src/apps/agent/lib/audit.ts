// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  type LedgerEntry as AuditEntry,
  type AuditHead,
  parseAuditEntry,
  parseAuditHead,
  writeEntryGraph,
  writeHeadGraph,
} from "@jeswr/agent-audit/verify";
import { parseRdf } from "@jeswr/fetch-rdf";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { type AgentClient, AgentReadError, type Row } from "./client";
import { AGENT, PROV, RDF, resourceSlug } from "./paths";

export {
  AUDIT_SCOPE,
  type AuditHead,
  type AuditRecord,
  ENTRY_KINDS as AUDIT_KINDS,
  GENESIS,
  HEAD_MISSING,
  type LedgerEntry as AuditEntry,
  type RangeCheck,
  seal as sealAudit,
  verifyLatestRange,
  verifyRange,
} from "@jeswr/agent-audit/verify";

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
  setIri(predicate: string, value: string) {
    this.values(predicate).add(DataFactory.namedNode(value));
  }
  setText(predicate: string, value: string, datatype = "http://www.w3.org/2001/XMLSchema#string") {
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
  const entry = parseAuditEntry({
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
/** Use the daemon's exact projection, including the generated entry entity. */
function entryGraph(url: string, entry: AuditEntry): Store {
  const store = new Store();
  writeEntryGraph(node(store, url), node(store, new URL("#entry", url).href), entry);
  return store;
}
export function auditToTurtle(url: string, entry: AuditEntry): Promise<string> {
  return write(entryGraph(url, entry));
}
function headGraph(url: string, head: AuditHead): Store {
  const store = new Store();
  writeHeadGraph(node(store, url), head.seq, head.hash);
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
  const head = parseAuditHead(seq, n.text(`${AGENT}ledgerHash`));
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
              entry.record.modelCall,
            ]
              .filter((id) => id !== undefined)
              .map((id) => ({ "@id": id })),
          }),
    })),
  };
}
