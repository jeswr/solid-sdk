// AUTHORED-BY Codex GPT-6.1-Sol
import { entryGraph, headGraph, turtle } from "./rdf.js";
import { loadChain, readEntry, readHead } from "./reader.js";
import {
  checkedRecord,
  GENESIS,
  type LedgerEntry,
  type LedgerRecord,
  MAX_AUDIT_SEQ,
  seal,
} from "./records.js";
import { type AuditFetch, request, storageRoot } from "./transport.js";

export { loadChain } from "./reader.js";

const INTEGRITY = "Audit chain integrity failure";
const FAILED = "Audit chain append failed";

/** Pod-owned sequence allocation, with immutable entries and help-along head commits. */
export class PodChain {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly base: string;
  constructor(
    private readonly io: AuditFetch,
    base: string,
  ) {
    try {
      if (!base.endsWith("/")) throw new Error("Invalid audit storage root");
      this.base = storageRoot(base);
    } catch {
      throw new Error("Invalid audit storage root");
    }
  }

  append(record: LedgerRecord, at: string): Promise<LedgerEntry> {
    let snapshot: LedgerRecord;
    try {
      snapshot = checkedRecord(record);
    } catch {
      return Promise.reject(new Error("Invalid audit record"));
    }
    const next = this.pending.then(() => this.write(snapshot, at));
    this.pending = next.catch(() => {});
    return next;
  }

  private async write(record: LedgerRecord, at: string): Promise<LedgerEntry> {
    try {
      const headUrl = new URL("chain.ttl", this.base).href;
      let own: LedgerEntry | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        const head = await readHead(this.io, this.base);
        // Another writer may have helped publish our entry after our CAS lost.
        if (own && head && head.seq >= own.seq) {
          try {
            const chain = await loadChain(this.io, this.base);
            if (chain.entries[own.seq - 1]?.hash !== own.hash) throw new Error(INTEGRITY);
            return own;
          } catch {
            throw new Error(INTEGRITY);
          }
        }
        if (head && (!head.etag || !/^"[^"\r\n]*"$/.test(head.etag))) throw new Error(FAILED);
        const seq = (head?.seq ?? 0) + 1;
        if (seq > MAX_AUDIT_SEQ) throw new Error(FAILED);
        const prev = head?.hash ?? GENESIS;
        let entry = seal(seq, at, prev, record);
        const url = new URL(`${seq}.ttl`, this.base).href;
        const response = await request(this.io, url, {
          method: "PUT",
          headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
          body: await turtle(entryGraph(url, entry)),
        });
        if (response.status === 412) {
          try {
            entry = await readEntry(this.io, this.base, seq);
            if (entry.prev !== prev || seal(seq, entry.at, prev, entry.record).hash !== entry.hash)
              throw new Error(INTEGRITY);
          } catch {
            throw new Error(INTEGRITY);
          }
        } else if ([200, 201, 204].includes(response.status)) own = entry;
        else throw new Error(FAILED);
        const result = await request(this.io, headUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "text/turtle",
            ...(head ? { "If-Match": head.etag as string } : { "If-None-Match": "*" }),
          },
          body: await turtle(headGraph(headUrl, seq, entry.hash)),
        });
        if ([200, 201, 204, 205].includes(result.status)) {
          if (own?.hash === entry.hash) return own;
        } else if (result.status !== 412) throw new Error(FAILED);
      }
      throw new Error("Audit chain retry limit exceeded");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      throw new Error(
        [INTEGRITY, "Audit redirect refused", "Audit chain retry limit exceeded"].includes(message)
          ? message
          : FAILED,
      );
    }
  }
}
