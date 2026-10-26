/**
 * Read-only import of a SANITISED communications-inventory snapshot (a JSON export of the
 * owner's registry, without credential references) into the dashboard settings.
 *
 * The import never contacts a provider and never treats registry presence as a connection:
 *  - registry fields are kept as "what the inventory said", with its observation time;
 *  - historic connector checks elsewhere (e.g. Codex) come ONLY from explicit structured
 *    `evidence` records (channel, provider, exact identifier, method, date). A record is attached
 *    only to accounts of the SAME channel holding that exact identifier: a shared address does not
 *    establish connector scope (a checked mailbox says nothing about a chat account using the same
 *    address). It is history, not current health, and not usable by this agent. A record whose
 *    provider differs from the account's recorded provider adds an unresolved conflict; a record
 *    matching no account is kept, unattached, for display;
 *  - free-text notes are kept for display and never become evidence; notes describing
 *    contradictory identities are attached as unresolved conflicts (never merged);
 *  - placeholders such as `to_confirm` are shown as "not recorded", not as identifiers.
 * Owner restrictions start as deny-all; a re-import keeps the owner's restrictions and notes.
 * No personal identifier is hard-coded here: everything comes from the file the owner names.
 */
import { z } from "zod";
import {
  type Connection,
  DENY_ALL,
  recordId,
  type Settings,
  type WorkflowPolicy,
} from "./model.js";

const s = (max: number) => z.string().max(max);
const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  source: s(500),
  observedAt: s(64),
  registryUpdated: s(40),
  accounts: z
    .array(
      z.object({
        id: s(64),
        channel: s(40),
        provider: s(60),
        label: s(120),
        identifiers: z.record(z.string().max(40), z.union([s(200), z.array(s(200)).max(10)])),
        organization: s(120),
        connector: z.object({
          target: s(80),
          setup_status: s(80),
          last_tested: s(40).optional(),
          last_test_result: s(120).optional(),
          available_in_mcp: z.boolean().optional(),
        }),
      }),
    )
    .max(200),
  communicationRules: z
    .object({
      last_updated: s(40),
      decision_policy: z.object({ ask_when_uncertain_about: z.array(s(80)).max(20) }),
      capability_policy: z.object({
        default_allowed: z.array(s(80)).max(20),
        requires_current_instruction_or_narrow_active_authorization_rule: z.array(s(80)).max(20),
        always_requires_fresh_explicit_instruction: z.array(s(80)).max(20),
      }),
      triage_taxonomy: z.record(z.string().max(40), s(300)),
    })
    .optional(),
  notes: z.array(s(500)).max(20).optional(),
  /** Explicit historic observations (optional). Never inferred from notes. */
  evidence: z
    .array(
      z.object({
        channel: z.string().regex(/^[a-z0-9_]{1,40}$/),
        provider: s(60),
        identifier: z.string().min(3).max(200),
        method: s(80),
        source: s(200),
        observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .max(50)
    .optional(),
});
export type InventorySnapshot = z.infer<typeof snapshotSchema>;

export interface ImportReport {
  imported: number;
  updated: number;
  skipped: string[];
  /** Structured evidence records that match no account of their channel (kept, unattached). */
  evidenceForUnknownAddresses: number;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const humanise = (v: string) => v.replaceAll("_", " ").replaceAll("-", " ");
const capitalise = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

/** Registry placeholder values ("to_confirm", "to_record_privately", …) are not identifiers. */
export function isPlaceholder(v: string): boolean {
  return v.startsWith("to_") || v.trim() === "";
}

function identifiersOf(ids: Record<string, string | string[]>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(ids)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (isPlaceholder(v)) continue;
      out.push(key === "primary" || key === "aliases" ? v : `${key}: ${v}`);
    }
  }
  return [...new Set(out)].slice(0, 10);
}

export function parseSnapshot(raw: unknown): InventorySnapshot {
  return snapshotSchema.parse(raw);
}

/** Merge a snapshot into `draft` (inside a store update). Returns what happened. */
export function applySnapshot(draft: Settings, snap: InventorySnapshot, now: string): ImportReport {
  const report: ImportReport = {
    imported: 0,
    updated: 0,
    skipped: [],
    evidenceForUnknownAddresses: 0,
  };
  const notes = snap.notes ?? [];
  const byId = new Map(draft.connections.map((c) => [c.id, c]));
  for (const a of snap.accounts) {
    if (!recordId.safeParse(a.id).success || !/^[a-z0-9_]{1,40}$/.test(a.channel)) {
      report.skipped.push(a.id.slice(0, 64));
      continue;
    }
    const existing = byId.get(a.id);
    const record: Connection = {
      id: a.id,
      label: a.label.trim() || a.id,
      channel: a.channel,
      provider: isPlaceholder(a.provider) ? "not confirmed" : a.provider,
      organisation: a.organization,
      identifiers: identifiersOf(a.identifiers),
      origin: "inventory",
      inventory: {
        observedAt: snap.observedAt,
        registryUpdated: snap.registryUpdated,
        connectorTarget: a.connector.target,
        setupStatus: a.connector.setup_status,
        ...(a.connector.last_tested ? { lastTested: a.connector.last_tested } : {}),
        ...(a.connector.last_test_result ? { lastTestResult: a.connector.last_test_result } : {}),
        ...(a.connector.available_in_mcp !== undefined
          ? { availableInMcp: a.connector.available_in_mcp }
          : {}),
      },
      evidence: [],
      conflicts: [],
      localConnector: existing?.localConnector ?? { state: "none" },
      restrictions: existing?.restrictions ?? { ...DENY_ALL },
      notes: existing?.notes ?? "",
      updatedAt: now,
      updatedBy: "inventory import",
    };
    if (existing) {
      report.updated++;
      draft.connections[draft.connections.indexOf(existing)] = record;
    } else {
      report.imported++;
      draft.connections.push(record);
    }
    byId.set(record.id, record);
  }
  const holds = (c: Connection, identifier: string) =>
    c.identifiers.some((i) => i.toLowerCase() === identifier.toLowerCase());
  // Structured evidence: same channel AND exact identifier only.
  const unmatched: NonNullable<Settings["inventory"]>["unmatchedEvidence"] = [];
  for (const e of snap.evidence ?? []) {
    const matches = [...byId.values()].filter(
      (c) => c.origin === "inventory" && c.channel === e.channel && holds(c, e.identifier),
    );
    if (matches.length === 0) {
      report.evidenceForUnknownAddresses++;
      unmatched.push({
        channel: e.channel,
        provider: e.provider,
        identifier: e.identifier,
        method: e.method,
        observedOn: e.observedOn,
      });
      continue;
    }
    for (const c of matches) {
      if (c.evidence.length >= 10) continue;
      c.evidence.push({
        kind: "codex-connector",
        observedOn: e.observedOn,
        identifier: e.identifier,
        method: e.method,
        summary:
          `${capitalise(humanise(e.method))} for this ${humanise(e.channel)} address through a ${humanise(e.provider)} connector (${e.source}). Historic only: not current health, not usable by this agent, and says nothing about other channels using the same address.`.slice(
            0,
            300,
          ),
      });
      const recorded = c.provider;
      if (recorded !== "not confirmed" && recorded.toLowerCase() !== e.provider.toLowerCase()) {
        const conflict = `The inventory records the provider as “${humanise(recorded)}”, but this address was observed through a ${humanise(e.provider)} connector on ${e.observedOn}. Unresolved.`;
        if (c.conflicts.length < 10 && !c.conflicts.includes(conflict)) c.conflicts.push(conflict);
      }
    }
  }
  // Notes: kept for display. Only identity-conflict notes are attached (never as evidence).
  for (const note of notes) {
    const addresses = [...new Set(note.match(EMAIL) ?? [])];
    if (addresses.length === 0 || !/versus|contradict|conflict/i.test(note)) continue;
    for (const address of addresses)
      for (const c of byId.values())
        if (holds(c, address) && c.conflicts.length < 10 && !c.conflicts.includes(note))
          c.conflicts.push(note);
  }
  draft.inventory = {
    source: "sanitised registry snapshot (read-only import)",
    observedAt: snap.observedAt,
    registryUpdated: snap.registryUpdated,
    notes: notes.slice(0, 20),
    unmatchedEvidence: unmatched,
  };
  if (snap.communicationRules) draft.workflowPolicy = policyFrom(snap.communicationRules);
  return report;
}

function policyFrom(r: NonNullable<InventorySnapshot["communicationRules"]>): WorkflowPolicy {
  return {
    source: "communication rules in the imported snapshot",
    lastUpdated: r.last_updated,
    askWhenUncertain: r.decision_policy.ask_when_uncertain_about,
    defaultAllowed: r.capability_policy.default_allowed,
    requiresCurrentInstruction:
      r.capability_policy.requires_current_instruction_or_narrow_active_authorization_rule,
    requiresFreshExplicitInstruction:
      r.capability_policy.always_requires_fresh_explicit_instruction,
    taxonomy: r.triage_taxonomy,
  };
}
