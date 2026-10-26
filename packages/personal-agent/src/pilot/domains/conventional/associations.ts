/**
 * Remembered contact → service associations (UC-02, R25).
 *
 * An association is a CLAIM extracted from a message ("this contact can be booked through
 * this service"), recorded with provenance (message digest, sender as observed, time,
 * forwarding signals). Email text alone never makes it usable:
 *   candidate ──owner-signed confirmation over the association digest──▶ accepted
 * Accepted associations are time-bounded (`validUntil`) and must be re-checked against the
 * service after `recheckAfter`; a changed fee/duration/required fields blocks use until the
 * owner re-confirms. Conflicts:
 *  - a different endpoint claimed by the SAME sender address (not forwarded) marks the
 *    accepted association `disputed` (blocked until the owner decides);
 *  - a claim from another sender, or in a forwarded message, is only a `candidate` with
 *    `conflictsWith` — it can neither replace nor block the accepted one.
 * Bounded: at most `maxTotal` associations and `maxPerContact` candidates per contact;
 * rejected/superseded/expired entries are dropped after `closedRetentionMs`.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { digestOf } from "../../core/canonical.js";
import type { SupportedService } from "./registry.js";

export type AssociationStatus =
  | "candidate"
  | "accepted"
  | "rejected"
  | "disputed"
  | "superseded"
  | "expired"
  | "changed";

export interface Association {
  readonly id: string;
  readonly contact: string;
  readonly serviceId: string;
  readonly adapterVersion: string;
  readonly identifiers: { readonly user: string; readonly event: string };
  readonly observedUrl: string;
  readonly source: {
    readonly rawSha256: string;
    readonly emailMessageId?: string;
    readonly observedFrom: string;
    readonly subject?: string;
    readonly receivedAt: string;
    readonly forwarded: boolean;
  };
  readonly status: AssociationStatus;
  readonly conflictsWith?: string;
  readonly acceptedBy?: { readonly approval: string; readonly at: string };
  readonly validUntil?: string;
  readonly recheckAfter?: string;
  readonly lastVerifiedAt?: string;
  readonly verifiedTerms?: {
    readonly durationMinutes: number;
    readonly feeAmount: number;
    readonly requiredFields: readonly string[];
  };
  readonly history: ReadonlyArray<{
    readonly status: AssociationStatus;
    readonly at: string;
    readonly reason: string;
  }>;
  readonly createdAt: string;
}

export interface AssociationPolicy {
  readonly validityMs: number;
  readonly recheckMs: number;
  readonly maxTotal: number;
  readonly maxPerContact: number;
  readonly closedRetentionMs: number;
}

const DAY = 86_400_000;
export const DEFAULT_ASSOCIATION_POLICY: AssociationPolicy = {
  validityMs: 90 * DAY,
  recheckMs: 30 * DAY,
  maxTotal: 500,
  maxPerContact: 5,
  closedRetentionMs: 90 * DAY,
};

/** The digest an owner confirmation binds to (content identity of the claim). */
export function associationDigest(a: Association): string {
  return digestOf({
    type: "remembered-service-association",
    id: a.id,
    contact: a.contact,
    serviceId: a.serviceId,
    adapterVersion: a.adapterVersion,
    identifiers: a.identifiers,
    observedUrl: a.observedUrl,
    source: a.source.rawSha256,
  });
}

export class AssociationStore {
  private items: Association[];

  constructor(
    private readonly path?: string,
    readonly policy: AssociationPolicy = DEFAULT_ASSOCIATION_POLICY,
  ) {
    this.items =
      path && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Association[]) : [];
  }

  /**
   * A read-only view of the stored associations: nothing it does is written back (for lookups
   * that must not change agent state, e.g. while the agent's runtime owns it).
   */
  static snapshot(
    path: string,
    policy: AssociationPolicy = DEFAULT_ASSOCIATION_POLICY,
  ): AssociationStore {
    const view = new AssociationStore(undefined, policy);
    view.items = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Association[]) : [];
    return view;
  }

  private save(): void {
    if (!this.path) return;
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.items, null, 2), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }

  list(): readonly Association[] {
    return this.items;
  }

  get(id: string): Association | undefined {
    return this.items.find((a) => a.id === id);
  }

  private put(a: Association): void {
    this.items = [...this.items.filter((x) => x.id !== a.id), a];
  }

  private transition(
    a: Association,
    status: AssociationStatus,
    at: string,
    reason: string,
    extra: Partial<Association> = {},
  ): Association {
    const next = {
      ...a,
      ...extra,
      status,
      history: [...a.history, { status, at, reason }].slice(-20),
    };
    this.put(next);
    return next;
  }

  /** Record one supported link from a message as a candidate (idempotent per claim). */
  recordCandidate(input: {
    contact: string;
    service: SupportedService;
    identifiers: { user: string; event: string };
    observedUrl: string;
    source: Association["source"];
    at: string;
  }): { association: Association; disputed?: Association; refused?: string } {
    const contact = input.contact.toLowerCase();
    const id = `urn:awp:association:${digestOf({ contact, serviceId: input.service.id, identifiers: input.identifiers }).slice(9, 33)}`;
    const existing = this.get(id);
    if (existing) return { association: existing };
    if (this.items.length >= this.policy.maxTotal) this.prune(input.at);
    const perContact = this.items.filter(
      (a) => a.contact === contact && a.status === "candidate",
    ).length;
    if (this.items.length >= this.policy.maxTotal || perContact >= this.policy.maxPerContact) {
      return {
        association: { id, contact } as Association,
        refused: "association capacity reached; candidate not recorded",
      };
    }
    const accepted = this.items.find(
      (a) => a.contact === contact && (a.status === "accepted" || a.status === "disputed"),
    );
    const candidate: Association = {
      id,
      contact,
      serviceId: input.service.id,
      adapterVersion: input.service.adapterVersion,
      identifiers: input.identifiers,
      observedUrl: input.observedUrl,
      source: input.source,
      status: "candidate",
      ...(accepted ? { conflictsWith: accepted.id } : {}),
      history: [
        {
          status: "candidate",
          at: input.at,
          reason: "extracted from a message; not yet confirmed by the owner",
        },
      ],
      createdAt: input.at,
    };
    this.put(candidate);
    let disputed: Association | undefined;
    const sameSender =
      input.source.observedFrom.toLowerCase() === contact && !input.source.forwarded;
    if (accepted?.status === "accepted" && sameSender) {
      disputed = this.transition(
        accepted,
        "disputed",
        input.at,
        `same sender now claims a different endpoint (${id})`,
      );
    }
    this.save();
    return { association: candidate, ...(disputed ? { disputed } : {}) };
  }

  /** Owner decision (the caller has verified the owner-signed approval over the digest). */
  decide(id: string, decision: "approve" | "deny", approvalId: string, at: string): Association {
    const a = this.get(id);
    if (!a) throw new Error("unknown association");
    if (decision === "deny") {
      const r = this.transition(a, "rejected", at, "owner declined");
      this.save();
      return r;
    }
    for (const other of this.items.filter(
      (x) =>
        x.contact === a.contact &&
        x.id !== a.id &&
        (x.status === "accepted" || x.status === "disputed" || x.status === "changed"),
    )) {
      this.transition(other, "superseded", at, `owner confirmed ${a.id}`);
    }
    for (const other of this.items.filter(
      (x) =>
        x.contact === a.contact &&
        x.id !== a.id &&
        x.status === "candidate" &&
        x.conflictsWith === a.id,
    )) {
      this.transition(other, "rejected", at, `owner re-confirmed ${a.id}`);
    }
    const t = Date.parse(at);
    const r = this.transition(a, "accepted", at, "owner confirmed", {
      acceptedBy: { approval: approvalId, at },
      validUntil: new Date(t + this.policy.validityMs).toISOString(),
      recheckAfter: new Date(t).toISOString(), // check the service once before first use
    });
    this.save();
    return r;
  }

  /** The usable association for a contact, or why none can be used now. */
  usable(
    contact: string,
    at: string,
  ):
    | { association: Association; needsRecheck: boolean }
    | { blocked: string; association?: Association } {
    const c = contact.toLowerCase();
    const t = Date.parse(at);
    const current = this.items.find(
      (a) => a.contact === c && ["accepted", "disputed", "changed"].includes(a.status),
    );
    if (!current) {
      const cand = this.items.find((a) => a.contact === c && a.status === "candidate");
      return {
        blocked: cand
          ? "only an unconfirmed candidate exists (owner confirmation required)"
          : "no remembered service for this contact",
        ...(cand ? { association: cand } : {}),
      };
    }
    if (current.status === "disputed")
      return {
        blocked: "association disputed by a conflicting claim; owner must re-confirm",
        association: current,
      };
    if (current.status === "changed")
      return {
        blocked: "service terms changed since confirmation; owner must re-confirm",
        association: current,
      };
    if (current.validUntil && t >= Date.parse(current.validUntil)) {
      const e = this.transition(current, "expired", at, "validity period ended");
      this.save();
      return { blocked: "association expired; owner must re-confirm", association: e };
    }
    return {
      association: current,
      needsRecheck: !current.recheckAfter || t >= Date.parse(current.recheckAfter),
    };
  }

  markVerified(
    id: string,
    terms: NonNullable<Association["verifiedTerms"]>,
    at: string,
  ): Association {
    const a = this.get(id) as Association;
    if (a.verifiedTerms && digestOf(a.verifiedTerms) !== digestOf(terms)) {
      const r = this.transition(a, "changed", at, "service terms differ from those last verified");
      this.save();
      return r;
    }
    const next = {
      ...a,
      verifiedTerms: terms,
      lastVerifiedAt: at,
      recheckAfter: new Date(Date.parse(at) + this.policy.recheckMs).toISOString(),
    };
    this.put(next);
    this.save();
    return next;
  }

  markChanged(id: string, reason: string, at: string): Association {
    const r = this.transition(this.get(id) as Association, "changed", at, reason);
    this.save();
    return r;
  }

  /** Drop closed associations after the retention period (never candidates or usable ones). */
  prune(at: string): number {
    const t = Date.parse(at);
    const before = this.items.length;
    this.items = this.items.filter((a) => {
      if (!["rejected", "superseded", "expired"].includes(a.status)) return true;
      const last = Date.parse(a.history.at(-1)?.at ?? a.createdAt);
      return t - last <= this.policy.closedRetentionMs;
    });
    if (this.items.length !== before) this.save();
    return before - this.items.length;
  }
}
