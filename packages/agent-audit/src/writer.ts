// AUTHORED-BY Codex GPT-6.1-Sol
// Resource-sink/PROV writer ported from accountable-agent-runtime/src/trace/writer.ts.
import { canonicalJson } from "@jeswr/agent-model";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHmac } from "crypto";
import type { EvidenceLedger } from "./ledger.js";
import { assertSameGraph, entryGraph, headGraph, parseTurtle, turtle } from "./rdf.js";
import { readHead } from "./reader.js";
import { checkedRecord, type LedgerEntry, type LedgerRecord, MAX_AUDIT_SEQ } from "./records.js";
import { type AuditFetch, auditBase, readDocument, request } from "./transport.js";
import { verifyLedger } from "./verify.js";

/** Keep this random per-owner salt in the private runtime store, never in pod records. */
export function hashRecipient(recipient: string, accountId: string, salt: Uint8Array): string {
  if (salt.byteLength < 32 || recipient.length === 0 || recipient.length > 4096)
    throw new Error("Invalid recipient hashing input");
  return `sha256:${createHmac("sha256", salt).update(canonicalJson({ accountId, recipient })).digest("hex")}`;
}
/** Immutable entry PUTs, then a conditional head commit. Retrying a partial write is safe. */
export class PodMirror {
  private pending: Promise<void> = Promise.resolve();
  private readonly base: string;
  constructor(
    private readonly io: AuditFetch,
    root: string,
  ) {
    this.base = auditBase(root);
  }
  sync(entries: readonly LedgerEntry[]): Promise<void> {
    const snapshot = structuredClone(entries);
    const next = this.pending.then(() => this.write(snapshot));
    this.pending = next.catch(() => {});
    return next;
  }
  private async write(entries: readonly LedgerEntry[]): Promise<void> {
    if (!verifyLedger(entries).ok) throw new Error("Ledger integrity failure");
    if (entries.some((entry) => entry.seq > MAX_AUDIT_SEQ))
      throw new Error("Audit range exceeds bound");
    const headUrl = new URL("chain.ttl", this.base).href;
    let head = await readHead(this.io, this.base);
    if (head && entries.length > 0 && (entries.at(-1) as LedgerEntry).seq < head.seq)
      throw new Error("Audit head is ahead of the local ledger");
    for (const entry of entries) {
      if (head && entry.seq <= head.seq) {
        if (entry.seq === head.seq && entry.hash !== head.hash)
          throw new Error("Audit head divergence");
        continue;
      }
      if (entry.seq !== (head?.seq ?? 0) + 1 || entry.prev !== (head?.hash ?? "sha-256:genesis"))
        throw new Error("Audit mirror requires a contiguous prefix");
      const url = new URL(`${entry.seq}.ttl`, this.base).href;
      const graph = entryGraph(url, entry);
      const response = await request(this.io, url, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
        body: await turtle(graph),
      });
      if (response.status === 412) {
        const existing = await readDocument(this.io, url);
        if (!existing) throw new Error("Audit entry conflict");
        assertSameGraph(await parseTurtle(existing.body, url), graph);
      } else if (![200, 201, 204].includes(response.status))
        throw new Error("Audit entry write failed");
      if (head && !head.etag) throw new Error("Audit head lacks an ETag");
      const result = await request(this.io, headUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "text/turtle",
          ...(head ? { "If-Match": head.etag as string } : { "If-None-Match": "*" }),
        },
        body: await turtle(headGraph(headUrl, entry.seq, entry.hash)),
      });
      if (![200, 201, 204, 205].includes(result.status))
        throw new Error("Audit head commit failed");
      head = { seq: entry.seq, hash: entry.hash, etag: result.headers.get("etag") };
      if (!head.etag) {
        // PUT may omit validators; only reuse a GET ETag for the exact committed head.
        head = await readHead(this.io, this.base);
        if (!head || head.seq !== entry.seq || head.hash !== entry.hash)
          throw new Error("Audit head changed after commit");
        if (!head.etag) throw new Error("Audit head lacks an ETag");
      }
    }
  }
}
/** Runtime-owned write path. A failed mirror never rolls back durable local evidence. */
export class AuditWriter {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly ledger: EvidenceLedger,
    private readonly mirror: PodMirror,
  ) {}
  append(record: LedgerRecord, at: string): Promise<LedgerEntry> {
    const snapshot = checkedRecord(record);
    const next = this.pending.then(async () => {
      const entry = this.ledger.append(snapshot, at);
      await this.mirror.sync(this.ledger.entries());
      return entry;
    });
    this.pending = next.catch(() => {});
    return next;
  }
}
