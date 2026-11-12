// AUTHORED-BY Codex GPT-6.1-Sol
/** Synthetic in-memory seams. No signature verification, persistence, credentials or provider I/O. */
import type { Approval } from "@jeswr/agent-mandate";
import type { ControlStatement } from "@jeswr/agent-model";
import type {
  ApprovalStore,
  AuditRecord,
  AuditSink,
  Clock,
  ControlStore,
  Disposition,
  OutboxEntry,
  ProposalStore,
  TransmissionRecord,
  TransmissionSettlement,
  TransmissionStore,
} from "./types.js";

export function createMemoryStores(at = "2026-10-31T12:00:00.000Z") {
  const entries = new Map<string, OutboxEntry>();
  const dispositions = new Map<string, Disposition>();
  const settlements = new Map<string, TransmissionSettlement>();
  const records = new Map<string, TransmissionRecord>();
  const approvals: Approval[] = [];
  const statements: ControlStatement[] = [];
  const auditRecords: AuditRecord[] = [];
  const ledger: TransmissionRecord[] = [];
  const state = { at, haltFile: false };
  let queue = Promise.resolve<unknown>(undefined);
  const transmissions: TransmissionStore = {
    exclusive<T>(work: () => Promise<T>): Promise<T> {
      const next = queue.then(work, work);
      queue = next;
      return next;
    },
    get: async (id) => structuredClone(records.get(id)),
    list: async () => structuredClone([...records.values()]),
    put: async (record) => {
      records.set(record.proposal, structuredClone(record));
    },
  };
  const proposals: ProposalStore = {
    get: async (id) => entries.get(id),
    // Refusals remain visible for fresh control/mandate evaluation; settlements own deduplication.
    queued: async () =>
      [...entries.keys()].filter(
        (id) => !["sent", "not-sent"].includes(dispositions.get(id)?.status ?? ""),
      ),
    writeDisposition: async (id, result) => {
      dispositions.set(id, structuredClone(result));
    },
    emitTransmission: async (settlement) => {
      settlements.set(`${settlement.proposal}:${settlement.status}`, structuredClone(settlement));
    },
  };
  const approvalStore: ApprovalStore = { findVerified: async () => structuredClone(approvals) };
  const controls: ControlStore = {
    listVerified: async () => structuredClone(statements),
    haltFileExists: async () => state.haltFile,
    assertNotHalted: () => {
      if (state.haltFile) throw new Error("Local stop active");
    },
  };
  const audit: AuditSink = {
    append: async (record) => {
      auditRecords.push(structuredClone(record));
      if (record.transmission) ledger.push(structuredClone(record.transmission));
    },
    listCommitted: async () => structuredClone(ledger),
  };
  const clock: Clock = { now: () => new Date(state.at) };
  return {
    entries,
    dispositions,
    settlements,
    records,
    approvals,
    statements,
    auditRecords,
    ledger,
    state,
    transmissions,
    proposals,
    approvalStore,
    controls,
    audit,
    clock,
  };
}
