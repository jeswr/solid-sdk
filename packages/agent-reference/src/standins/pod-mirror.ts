// AUTHORED-BY Codex GPT-6
/** Principal-owned storage copy of the real ledger. No manufactured record entries. */
import { digestBytes } from "../core/canonical.js";
import { type SigningKey, signCompact } from "../mechanisms/jws.js";
import type { EvidenceLedger } from "../store/ledger.js";
import type { FictionalSolidStorage } from "./storage.js";

export class PodRecordMirror {
  private mirrored = 0;
  private readonly bytes = new Map<number, string>();
  private flushing: Promise<boolean> = Promise.resolve(true);
  readonly root: string;
  constructor(
    readonly storage: FictionalSolidStorage,
    readonly actor: string,
    readonly principal: string,
    private readonly actorKey: SigningKey,
    private readonly principalKey: SigningKey,
    private readonly ledger: () => EvidenceLedger,
  ) {
    this.root = `${storage.origin}/record/`;
  }
  async setup(): Promise<void> {
    this.storage.introduce(this.actor, this.actorKey);
    this.storage.introduce(this.principal, this.principalKey);
    await this.storage.provision(`${this.storage.origin}/`, this.principal, { container: true });
    await this.storage.provision(this.root, this.principal, {
      container: true,
      rules: [{ resource: this.root, agent: this.actor, modes: ["Read", "Write"], defaults: true }],
    });
  }
  flush(): Promise<boolean> {
    // Concurrent gate releases must not advance the shared cursor twice for one entry.
    const next = this.flushing.then(
      () => this.flushEntries(),
      () => this.flushEntries(),
    );
    this.flushing = next;
    return next;
  }
  private async flushEntries(): Promise<boolean> {
    const client = this.storage.client(this.actor, this.actorKey);
    for (const entry of this.ledger().entries().slice(this.mirrored)) {
      let body = this.bytes.get(entry.seq);
      if (!body) {
        body = await signCompact(this.actorKey, "awp-pod-record-entry+jws", entry);
        this.bytes.set(entry.seq, body);
      }
      const target = `${this.root}${String(entry.seq).padStart(8, "0")}`;
      try {
        const response = await client(target, {
          method: "PUT",
          headers: { "content-type": "application/jose", "if-none-match": "*" },
          body,
        });
        if (response.status === 412) {
          const existing = await client(target);
          if (!existing.ok || digestBytes(await existing.text()) !== digestBytes(body))
            return false;
        } else if (response.status !== 201) return false;
        this.mirrored++;
      } catch {
        return false;
      }
    }
    return true;
  }
  get count(): number {
    return this.mirrored;
  }
  async principalRead(sequence: number): Promise<Response> {
    return this.storage.client(
      this.principal,
      this.principalKey,
    )(`${this.root}${String(sequence).padStart(8, "0")}`);
  }
}
