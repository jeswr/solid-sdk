/**
 * Reference enterprise data service with a purpose-aware ENFORCEMENT POINT (framework A5,
 * profile C1): data received under an agreement is stored with the grant derived from the
 * agreed terms; every internal access (read/use/distribute) is decided at this point from
 *   (1) the internal role registry — which of the organisation's agents may act for which
 *       purposes (institutional delegation inside the organisation), AND
 *   (2) the data-use grant — the ODRL policy derived from the terms the data subject agreed.
 * A purpose label on the request is necessary but never sufficient: the requesting agent
 * must be internally authorised for that purpose AND the grant must permit it.
 *
 * Decisions are written to the store's OWN hash-chained ledger; requesting agents get
 * results, never a handle on the log. Boundary: this controls access through this
 * service only. Copies taken outside it (or by a compromised host) are out of scope. The store
 * trusts its CALLER to name the requesting agent: the mortgage lender's `internal_access` is a
 * trusted-operator role selector (a simulated internal role, not an authenticated identity);
 * NordWerk's internal dataset read (`domains/industrial.ts`) passes the VERIFIED signer of the
 * internal message.
 *
 * Durable mode (single host, single writer — the owning runtime's lock):
 *  - COMMIT ORDER: the item file is replaced atomically (write temp, rename) and THEN the
 *    payload-free `data-stored` evidence is appended. An interruption between the two leaves
 *    a committed item without evidence; opening the store REPAIRS that by appending the
 *    evidence (marked `recovered`) before the item can be used. A failed item write rolls the
 *    in-memory state back, so an uncommitted item is never usable. Atomic rename is not a
 *    durability claim across power loss (no fsync of file and directory).
 *  - Persisted items are validated on open (shape, ISO instants); anything else fails closed.
 *  - RETENTION: `purgeExpired` erases the payloads of items whose grant has expired, keeps a
 *    payload-free tombstone (id, claim type, source, grant id + policy digest, dates) so the
 *    same item under the same grant is never stored again, and logs `data-erased`. It erases
 *    only this store's copy (see the governance register for copies elsewhere).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { z } from "zod";
import { digestOf, newUrn } from "../core/canonical.js";
import type { Iri, Json } from "../core/types.js";
import { evaluateGrantPolicy } from "../mechanisms/mandate.js";
import type { PolicyEngine } from "../mechanisms/policy-engine.js";
import { AWP } from "../profile/vocabulary.js";
import type { DisclosureCheck } from "../runtime/operations.js";
import { type EvidenceLedger, FileLedger, MemoryLedger } from "../store/ledger.js";

export interface InternalRole {
  readonly agent: Iri;
  readonly label: string;
  readonly purposes: readonly Iri[];
  readonly actions: readonly string[];
}

export interface StoredItem {
  readonly id: Iri;
  readonly claimType: string;
  readonly subject?: Iri;
  readonly source: Iri;
  readonly data: Json;
  readonly grant: {
    readonly id: Iri;
    readonly target: Iri;
    readonly policy: OdrlPolicy;
    readonly assignee: Iri;
    readonly validUntil: string;
  };
  readonly derivedFrom?: readonly Iri[];
  readonly storedAt: string;
  /**
   * The storage REVISION: a fresh identifier minted for each committed storage of an item.
   * Data identity (`id`), the grant (`grant.id` + policy digest) and evidence events
   * (`data-stored`/`data-erased`, keyed by revision) stay distinguishable. Absent only on items
   * written before phase 8 (their evidence is matched by item id + grant id).
   */
  readonly revision?: Iri;
}

/** Payload-free remainder of an erased item (prevents re-storing it under the same grant). */
export interface Tombstone {
  readonly id: Iri;
  readonly claimType: string;
  readonly source: Iri;
  readonly grant: Iri;
  readonly grantPolicyDigest: string;
  readonly validUntil: string;
  readonly storedAt: string;
  readonly erasedAt: string;
  /** The storage revision that was erased (absent for pre-phase-8 tombstones). */
  readonly revision?: Iri;
}

/** What one retention purge established (committed erasure vs its evidence). */
export interface PurgeReport {
  /** Revisions whose payload erasure was COMMITTED to the store file by this call. */
  readonly erased: readonly Tombstone[];
  /** Of those, the ones whose `data-erased` evidence could not be appended yet (repaired later). */
  readonly evidencePending: readonly Iri[];
  /** Evidence (stored or erased) for EARLIER commits that this call repaired first. */
  readonly repairedEvidence: readonly { type: string; item: Iri; revision: string }[];
  readonly remainingExpired: number;
}

export interface AccessRequest {
  readonly agent: Iri;
  readonly action: "read" | "use" | "distribute";
  readonly items: readonly Iri[];
  readonly purpose: Iri;
  readonly recipient?: Iri;
}

export interface AccessDecision {
  readonly decision: "permit" | "deny" | "indeterminate";
  readonly reason: string;
  readonly items?: readonly StoredItem[];
}

/** Fault-injection points at the commit boundaries (tests only). */
export type StoreFaultPoint =
  | "item-write"
  | "after-item-commit"
  | "after-erasure-commit"
  | "erasure-evidence";

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const instant = z
  .string()
  .max(64)
  .refine((s) => ISO_INSTANT.test(s) && !Number.isNaN(Date.parse(s)), "ISO instant");
const iri = z.string().min(3).max(2048);
const itemSchema = z.strictObject({
  id: iri,
  claimType: z.string().min(1).max(256),
  subject: iri.optional(),
  source: iri,
  data: z.record(z.string(), z.unknown()),
  grant: z.strictObject({
    id: iri,
    target: iri,
    // Structural check here; ODRL semantics are checked by the policy module at every decision
    // (an ill-formed policy never yields a permit).
    policy: z.looseObject({ id: iri }),
    assignee: iri,
    validUntil: instant,
  }),
  derivedFrom: z.array(iri).max(64).optional(),
  storedAt: instant,
  revision: iri.optional(),
});
const tombstoneSchema = z.strictObject({
  id: iri,
  claimType: z.string().min(1).max(256),
  source: iri,
  grant: iri,
  grantPolicyDigest: z.string().min(8).max(128),
  validUntil: instant,
  storedAt: instant,
  erasedAt: instant,
  revision: iri.optional(),
});

/** Evidence key of one storage revision (pre-phase-8 records: item id + grant id). */
function revisionKey(value: object): string {
  const r = value as { revision?: unknown; id?: unknown; item?: unknown; grant?: unknown };
  if (typeof r.revision === "string") return r.revision;
  const grant =
    typeof r.grant === "string" ? r.grant : (r.grant as { id?: unknown } | undefined)?.id;
  return `legacy:${String(r.id ?? r.item)}|${String(grant)}`;
}
const fileSchema = z.strictObject({
  version: z.literal(1),
  items: z.array(itemSchema).max(10_000),
  tombstones: z.array(tombstoneSchema).max(100_000).optional(),
});

/** Largest number of items one `purgeExpired` call erases. */
export const MAX_PURGE_PER_CALL = 100;

export class PurposeBoundStore {
  /** The enforcement point's own audit log (not writable by requesting agents). */
  readonly #ledger: EvidenceLedger;
  readonly #items = new Map<Iri, StoredItem>();
  /** Every erased revision, in order (history: several per item id if it was re-granted). */
  readonly #tombstones: Tombstone[] = [];
  /** Revisions whose `data-stored` evidence is in the ledger. */
  readonly #stored = new Set<string>();
  /** Revisions whose `data-erased` evidence is in the ledger. */
  readonly #erased = new Set<string>();

  constructor(
    readonly organisation: Iri,
    private readonly roles: readonly InternalRole[],
    private readonly now: () => Date,
    /** Policy module deciding data-use grants (default solid-odrl; never a fallback). */
    private readonly engine?: PolicyEngine,
    /**
     * Durable storage for a persistent service: items (with their grants) in `path` (0600) and
     * the enforcement point's own hash-chained ledger in `ledgerPath`. Omitted = in memory.
     */
    private readonly persist?: {
      readonly path: string;
      readonly ledgerPath: string;
      /** Tests only: throw at a commit boundary to simulate a crash or a failed write. */
      readonly fault?: (point: StoreFaultPoint) => void;
    },
  ) {
    this.#ledger = persist ? new FileLedger(persist.ledgerPath) : new MemoryLedger();
    if (persist && existsSync(persist.path)) {
      // Fail closed: anything but a well-formed file is refused (the agent does not open).
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(persist.path, "utf8")));
      if (!parsed.success)
        throw new Error(
          `purpose store ${persist.path} is malformed; refusing to open: ${parsed.error.issues[0]?.message ?? "invalid"}`,
        );
      // The policy passed the structural check above; its ODRL content is evaluated per decision.
      for (const i of parsed.data.items) this.#items.set(i.id, i as unknown as StoredItem);
      this.#tombstones.push(...(parsed.data.tombstones ?? []));
      for (const e of this.#ledger.entries()) {
        if (e.record.type === "data-stored") this.#stored.add(revisionKey(e.record));
        if (e.record.type === "data-erased") this.#erased.add(revisionKey(e.record));
      }
      // Repair before use: every committed storage / erasure gets its evidence now.
      this.#repairEvidence();
    }
  }

  /**
   * Append the evidence missing for COMMITTED revisions: `data-stored` for stored items and for
   * erased revisions stored before an interruption, then `data-erased` for committed erasures.
   * Idempotent (keyed by revision). Returns what it appended.
   */
  #repairEvidence(): { type: string; item: Iri; revision: string }[] {
    const repaired: { type: string; item: Iri; revision: string }[] = [];
    for (const item of this.#items.values())
      if (!this.#stored.has(revisionKey(item))) {
        this.#appendStored(item, true);
        repaired.push({ type: "data-stored", item: item.id, revision: revisionKey(item) });
      }
    for (const t of this.#tombstones) {
      const key = revisionKey(t);
      if (!this.#stored.has(key)) {
        this.#appendStoredOfTombstone(t);
        repaired.push({ type: "data-stored", item: t.id, revision: key });
      }
      if (!this.#erased.has(key)) {
        this.#appendErased(t, true);
        repaired.push({ type: "data-erased", item: t.id, revision: key });
      }
    }
    return repaired;
  }

  #appendStored(item: StoredItem, recovered: boolean): void {
    this.#ledger.append(
      {
        type: "data-stored",
        item: item.id,
        ...(item.revision ? { revision: item.revision } : {}),
        claimType: item.claimType,
        source: item.source,
        grant: item.grant.id,
        grantPolicyDigest: digestOf(item.grant.policy as never),
        validUntil: item.grant.validUntil,
        derivedFrom: item.derivedFrom ?? [],
        storedAt: item.storedAt,
        ...(recovered
          ? {
              recovered: true,
              note: "evidence appended on recovery for an item committed before an interruption",
            }
          : {}),
      },
      recovered ? this.now().toISOString() : item.storedAt,
    );
    this.#stored.add(revisionKey(item));
  }

  /** Storage evidence for a revision that was erased before its storage evidence existed. */
  #appendStoredOfTombstone(t: Tombstone): void {
    this.#ledger.append(
      {
        type: "data-stored",
        item: t.id,
        ...(t.revision ? { revision: t.revision } : {}),
        claimType: t.claimType,
        source: t.source,
        grant: t.grant,
        grantPolicyDigest: t.grantPolicyDigest,
        validUntil: t.validUntil,
        storedAt: t.storedAt,
        recovered: true,
        note: "storage evidence appended on recovery; this revision has since been erased",
      },
      this.now().toISOString(),
    );
    this.#stored.add(revisionKey(t));
  }

  #appendErased(t: Tombstone, recovered: boolean): void {
    this.#ledger.append(
      {
        type: "data-erased",
        item: t.id,
        ...(t.revision ? { revision: t.revision } : {}),
        claimType: t.claimType,
        grant: t.grant,
        grantPolicyDigest: t.grantPolicyDigest,
        validUntil: t.validUntil,
        erasedAt: t.erasedAt,
        reason: "retention: the data-use grant expired",
        scope:
          "this enforcement point's stored copy only; runtime transcripts, the sender's wallet, peers and backups are not reached",
        ...(recovered
          ? {
              recovered: true,
              note: "evidence appended on recovery for an erasure committed before an interruption",
            }
          : {}),
      },
      recovered ? this.now().toISOString() : t.erasedAt,
    );
    this.#erased.add(revisionKey(t));
  }

  private save(): void {
    if (!this.persist) return;
    const tmp = `${this.persist.path}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({
        version: 1,
        items: [...this.#items.values()],
        tombstones: this.#tombstones,
      }),
      { mode: 0o600 },
    );
    this.persist.fault?.("item-write");
    renameSync(tmp, this.persist.path);
  }

  /**
   * Store one item under its grant. IDENTIFIER REUSE SEMANTICS:
   *  - while an item is stored, its id is unique: the same content under the same grant is
   *    idempotent (no second write or evidence; missing evidence is repaired); different content
   *    or grant is refused (no overwrite, no silent grant change);
   *  - after the item was erased under retention, the id may be stored again ONLY under a
   *    grant id that none of its earlier revisions had (a new agreement). Every storage is a
   *    new revision with its own `data-stored` / `data-erased` evidence; the tombstone history
   *    of earlier revisions is kept, and a grant id that was erased once is refused for good.
   */
  put(item: Omit<StoredItem, "storedAt" | "revision">): StoredItem {
    const candidate = itemSchema.omit({ storedAt: true, revision: true }).safeParse(item);
    if (!candidate.success)
      throw new Error(`refusing to store a malformed item: ${candidate.error.issues[0]?.message}`);
    const existing = this.#items.get(item.id);
    if (existing) {
      const { storedAt: _at, revision: _rev, ...prior } = existing;
      if (digestOf(prior as never) !== digestOf(item as never))
        throw new Error(`item ${item.id} is already stored with different content or grant`);
      if (!this.#stored.has(revisionKey(existing))) this.#appendStored(existing, true);
      return existing;
    }
    const erased = this.#tombstones.find((t) => t.id === item.id && t.grant === item.grant.id);
    if (erased)
      throw new Error(
        `item ${item.id} was erased under retention (grant ${erased.grant}); it is not stored again under that grant`,
      );
    const stored: StoredItem = {
      ...item,
      storedAt: this.now().toISOString(),
      revision: newUrn(),
    };
    this.#items.set(item.id, stored);
    try {
      this.save();
    } catch (error) {
      // Not committed: never usable.
      this.#items.delete(item.id);
      throw error;
    }
    this.persist?.fault?.("after-item-commit");
    this.#appendStored(stored, false);
    return stored;
  }

  /** Payload-free metadata of stored items: id, claim type, source, grant id + policy digest. */
  inventory(): Array<{
    id: Iri;
    claimType: string;
    source: Iri;
    grant: Iri;
    grantPolicyDigest: string;
    validUntil: string;
    derivedFrom: readonly Iri[];
  }> {
    return [...this.#items.values()].map((i) => ({
      id: i.id,
      claimType: i.claimType,
      source: i.source,
      grant: i.grant.id,
      grantPolicyDigest: digestOf(i.grant.policy as never),
      validUntil: i.grant.validUntil,
      derivedFrom: i.derivedFrom ?? [],
    }));
  }

  /** Payload-free tombstones of erased revisions (history, in erasure order). */
  tombstones(): readonly Tombstone[] {
    return [...this.#tombstones];
  }

  has(id: Iri): boolean {
    return this.#items.has(id);
  }

  /** The current storage revision of an item (a release's durable reference), if stored. */
  revisionOf(id: Iri): string | undefined {
    const item = this.#items.get(id);
    return item ? revisionKey(item) : undefined;
  }

  ids(): Iri[] {
    return [...this.#items.keys()];
  }

  /**
   * RETENTION: erase the payloads of (at most `limit`) items whose grant expired at or before
   * now. Each becomes a payload-free tombstone; the store file is rewritten, then one
   * payload-free `data-erased` record per item is appended. Erases THIS store's copy only.
   */
  purgeExpired(limit = MAX_PURGE_PER_CALL): PurgeReport {
    // Evidence of earlier interrupted commits first (reported separately).
    const repairedEvidence = this.#repairEvidence();
    const at = this.now().toISOString();
    const expired = [...this.#items.values()].filter(
      (i) => !(Date.parse(i.grant.validUntil) > Date.parse(at)),
    );
    const batch = expired.slice(0, Math.max(0, Math.min(limit, MAX_PURGE_PER_CALL)));
    if (batch.length === 0)
      return { erased: [], evidencePending: [], repairedEvidence, remainingExpired: 0 };
    const tombs = batch.map(
      (i): Tombstone => ({
        id: i.id,
        claimType: i.claimType,
        source: i.source,
        grant: i.grant.id,
        grantPolicyDigest: digestOf(i.grant.policy as never),
        validUntil: i.grant.validUntil,
        storedAt: i.storedAt,
        erasedAt: at,
        ...(i.revision ? { revision: i.revision } : {}),
      }),
    );
    const historyBefore = this.#tombstones.length;
    for (const t of tombs) this.#items.delete(t.id);
    this.#tombstones.push(...tombs);
    try {
      this.save();
    } catch (error) {
      // Not committed: restore the items and drop ONLY this call's tombstones (history intact).
      for (const i of batch) this.#items.set(i.id, i);
      this.#tombstones.length = historyBefore;
      throw error;
    }
    // Committed. A crash here is repaired on the next open; an append failure is reported.
    this.persist?.fault?.("after-erasure-commit");
    const evidencePending: Iri[] = [];
    for (const t of tombs) {
      try {
        this.persist?.fault?.("erasure-evidence");
        this.#appendErased(t, false);
      } catch {
        evidencePending.push(t.id);
      }
    }
    return {
      erased: tombs,
      evidencePending,
      repairedEvidence,
      remainingExpired: expired.length - batch.length,
    };
  }

  /** Decide one internal access. Never returns data unless every check permits. */
  request(req: AccessRequest): AccessDecision {
    return this.#decide(req, "access-decision");
  }

  /**
   * RE-decide a release that is about to be transmitted (a disclosure condition), with the same
   * rules and policy module as `request`, recorded as `access-recheck`. Returns no data. With
   * `revisions`, each item must still be at the revision that was released.
   */
  recheck(req: AccessRequest, revisions?: Readonly<Record<Iri, string>>): AccessDecision {
    if (revisions)
      for (const [id, rev] of Object.entries(revisions)) {
        const item = this.#items.get(id);
        if (item && revisionKey(item) !== rev)
          return this.#decide(req, "access-recheck", `item ${id} was re-stored since its release`);
      }
    const { items: _data, ...decision } = this.#decide(req, "access-recheck");
    return decision;
  }

  #decide(
    req: AccessRequest,
    type: "access-decision" | "access-recheck",
    forcedDeny?: string,
  ): AccessDecision {
    const at = this.now().toISOString();
    const decide = (d: AccessDecision): AccessDecision => {
      this.#ledger.append(
        {
          type,
          agent: req.agent,
          action: req.action,
          items: [...req.items],
          purpose: req.purpose,
          ...(req.recipient ? { recipient: req.recipient } : {}),
          decision: d.decision,
          reason: d.reason,
          note: "payloads are not copied into this log",
        },
        at,
      );
      return d;
    };
    if (forcedDeny) return decide({ decision: "deny", reason: forcedDeny });
    const role = this.roles.find((r) => r.agent === req.agent);
    if (!role)
      return decide({
        decision: "deny",
        reason: "agent is not registered with this organisation's enforcement point",
      });
    if (!role.purposes.includes(req.purpose) || !role.actions.includes(req.action)) {
      return decide({
        decision: "deny",
        reason: `internal delegation: ${role.label} is not authorised to ${req.action} for this purpose`,
      });
    }
    if (req.items.length === 0) return decide({ decision: "deny", reason: "no items requested" });
    const out: StoredItem[] = [];
    for (const id of req.items) {
      const item = this.#items.get(id);
      if (!item)
        return decide({
          decision: "deny",
          reason: this.#tombstones.some((t) => t.id === id)
            ? `item ${id} was erased under retention`
            : `unknown item ${id}`,
        });
      // Evidence must name THIS revision (item + grant), not an earlier one under the same id.
      if (!this.#stored.has(revisionKey(item)))
        return decide({
          decision: "deny",
          reason: `item ${id} has no storage evidence for its current revision`,
        });
      const until = Date.parse(item.grant.validUntil);
      // Fail closed: an unparseable date is never "not yet expired".
      if (!(until > Date.parse(at)))
        return decide({
          decision: "deny",
          reason: Number.isNaN(until)
            ? `grant ${item.grant.id} has an invalid validity date`
            : `grant ${item.grant.id} expired (retention/use period over)`,
        });
      const r = evaluateGrantPolicy(
        item.grant.policy,
        {
          assignee: item.grant.assignee,
          action: req.action,
          target: item.grant.target,
          purpose: req.purpose,
          ...(req.recipient ? { recipient: req.recipient } : {}),
        },
        at,
        ...(this.engine ? [this.engine] : []),
      );
      if (r.outcome !== "permit")
        return decide({ decision: r.outcome, reason: `grant ${item.grant.id}: ${r.reason}` });
      out.push(item);
    }
    return decide({
      decision: "permit",
      reason: "internal delegation and data-use grant both permit",
      items: out,
    });
  }

  /** Read-only view of the enforcement log (for evidence reports). */
  audit(): ReadonlyArray<{
    seq: number;
    hash: string;
    record: { type: string; [k: string]: unknown };
  }> {
    return this.#ledger.entries().map((e) => ({ seq: e.seq, hash: e.hash, record: e.record }));
  }

  auditEntries() {
    return this.#ledger.entries();
  }
}

/** Disclosure-condition kind: released store items may leave only while the release holds. */
export const PURPOSE_STORE_RELEASE_CONDITION = `${AWP}condition/purpose-store-release`;

/**
 * Send-time check for {@link PURPOSE_STORE_RELEASE_CONDITION}: the SAME enforcement point
 * re-decides the release (internal delegation, grant validity, the data-use policy through its
 * policy module — SPARQ when selected) and the released revisions must still be current. It
 * records an `access-recheck` decision and returns no data.
 */
export function purposeStoreReleaseCheck(store: PurposeBoundStore): DisclosureCheck {
  return (ref) => {
    const r = ref as {
      agent?: unknown;
      action?: unknown;
      items?: unknown;
      purpose?: unknown;
      recipient?: unknown;
      revisions?: unknown;
    };
    if (
      typeof r.agent !== "string" ||
      (r.action !== "read" && r.action !== "use" && r.action !== "distribute") ||
      !Array.isArray(r.items) ||
      !r.items.every((i) => typeof i === "string") ||
      typeof r.purpose !== "string"
    )
      return { ok: false, reason: "malformed purpose-store release reference" };
    const d = store.recheck(
      {
        agent: r.agent,
        action: r.action,
        items: r.items as string[],
        purpose: r.purpose,
        ...(typeof r.recipient === "string" ? { recipient: r.recipient } : {}),
      },
      (r.revisions ?? undefined) as Record<string, string> | undefined,
    );
    return d.decision === "permit"
      ? { ok: true }
      : { ok: false, reason: `${d.decision}: ${d.reason}` };
  };
}
