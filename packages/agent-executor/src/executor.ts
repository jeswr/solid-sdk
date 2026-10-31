// AUTHORED-BY Codex GPT-6.1-Sol
import { AGENT, evaluateIntent, type Mandate, type Policy } from "@jeswr/agent-mandate";
import type { ControlStatement } from "@jeswr/agent-model";
import {
  canonicalJson,
  derivedUrn,
  digestBytes,
  digestOf,
  podRecordSchema,
} from "@jeswr/agent-model";
import { checkLimits, nextAccountingTransition, transmissionRecords } from "./accounting.js";
import { bounded, MAX_TRANSMISSION_ATTEMPTS, providerResult } from "./transmission.js";
import type {
  AccountingMandate,
  Disposition,
  ExecutorOptions,
  OutboxEntry,
  SendBinding,
  SendResult,
  TransmissionRecord,
  TransmitResult,
} from "./types.js";

/** Approval identity includes every action term, exact carrier, destination and expiry. */
export function proposalTermsDigest(entry: OutboxEntry): string {
  const { termsDigest: _digest, ...intent } = entry.proposal.intent;
  return digestOf({
    id: entry.proposal.id,
    intent,
    preview: entry.proposal.renderedPreview,
    validUntil: entry.proposal.validUntil,
    renderable: entry.renderable,
    account: entry.account,
    wireDigest: entry.wireDigest,
    wireMediaType: entry.wire.mediaType,
  });
}

const stateByStore = new WeakMap<
  ExecutorOptions["transmissions"],
  { pending: Set<string>; revision: number }
>();

interface AuthorityDeadlines {
  proposal: number;
  mandate: number;
  approval?: number;
  controls: number;
  policy: number;
  accounting: number;
}
interface ReadyEvaluation {
  status: "ready";
  reason: string;
  deadlines: AuthorityDeadlines;
}

/** Bound every policy set, including duties, without duplicating the engine's decisions. */
function nextPolicyTransition(mandate: Mandate, at: number): number {
  const policies: readonly Policy[] = [
    mandate.autonomous,
    mandate.withApproval,
    { id: mandate.id, prohibitions: mandate.prohibitions },
  ];
  const constraints = policies.flatMap((policy) => [
    ...(policy.obligations ?? []).flatMap((duty) => duty.constraints ?? []),
    ...[...(policy.permissions ?? []), ...(policy.prohibitions ?? [])].flatMap((rule) => [
      ...(rule.constraints ?? []),
      ...(rule.duties ?? []).flatMap((duty) => duty.constraints ?? []),
    ]),
  ]);
  return Math.min(
    ...constraints
      .filter((constraint) => constraint.leftOperand === "dateTime")
      .flatMap((constraint) => [constraint.rightOperand].flat())
      .flatMap((value) => {
        const boundary = Date.parse(String(value));
        // Equality, inclusive bounds and set membership can also change just after a boundary.
        return [boundary, boundary + 1];
      })
      .filter((transition) => transition > at),
  );
}

/** This instance holds send scopes; no model or Actor capability enters the effect path. */
export function createExecutor(options: ExecutorOptions) {
  const o = options;
  const timeout = o.timeoutMs ?? 30000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("Invalid provider timeout");
  const state = stateByStore.get(o.transmissions) ?? { pending: new Set<string>(), revision: 0 };
  stateByStore.set(o.transmissions, state);
  const { pending } = state;
  const background = new Set<Promise<unknown>>();
  let backgroundError: unknown;
  let backgroundFailed = false;

  function checkBackgroundFailure() {
    if (backgroundFailed)
      throw new Error("Audit or persistence failed during late settlement", {
        cause: backgroundError,
      });
  }

  function temporalFailure(deadlines: AuthorityDeadlines): Disposition | undefined {
    const now = o.clock.now().getTime();
    if (!(deadlines.proposal >= now)) return { status: "refused", reason: "expired" };
    if (!(deadlines.mandate > now)) return { status: "refused", reason: "mandate-invalid" };
    if (deadlines.approval !== undefined && !(deadlines.approval > now))
      return { status: "awaiting-approval", reason: "approval-required" };
    if (!(deadlines.controls > now)) return { status: "refused", reason: "halted" };
    if (!(deadlines.policy > now)) return { status: "refused", reason: "authority-changed" };
    if (!(deadlines.accounting > now)) return { status: "refused", reason: "authority-changed" };
    return undefined;
  }

  async function controls(): Promise<{
    halted: boolean;
    statements: readonly ControlStatement[];
    nextTransition: number;
  }> {
    try {
      if (await o.controls.haltFileExists())
        return { halted: true, statements: [], nextTransition: -Infinity };
      const verified = await o.controls.listVerified(o.ownerWebId);
      // A local HALT can arrive while verified controls are being read.
      if (await o.controls.haltFileExists())
        return { halted: true, statements: [], nextTransition: -Infinity };
      const now = o.clock.now().getTime();
      if (!Number.isFinite(now)) return { halted: true, statements: [], nextTransition: -Infinity };
      const unexpired = verified.filter(
        (c) => c.attributedTo === o.ownerWebId && Date.parse(c.expires) > now,
      );
      const statements = unexpired.filter((c) => Date.parse(c.createdAt) <= now);
      const halts = statements.filter((c) => c.kind === "Halt").map((c) => Date.parse(c.createdAt));
      const resumes = statements
        .filter((c) => c.kind === "Resume")
        .map((c) => Date.parse(c.createdAt));
      return {
        halted: halts.length > 0 && Math.max(...halts) >= Math.max(-Infinity, ...resumes),
        statements,
        nextTransition: Math.min(
          ...unexpired
            .flatMap((c) => [Date.parse(c.createdAt), Date.parse(c.expires)])
            .filter((transition) => transition > now),
        ),
      };
    } catch {
      return { halted: true, statements: [], nextTransition: -Infinity };
    }
  }
  async function disposition(id: string, result: Disposition): Promise<Disposition> {
    await o.audit.append({
      type: "decision",
      proposal: id,
      at: o.clock.now().toISOString(),
      outcome: result.reason,
    });
    await o.proposals.writeDisposition(id, result);
    return result;
  }
  async function tamper(id: string): Promise<Disposition> {
    await o.audit.append({
      type: "tamper-suspected",
      proposal: id,
      at: o.clock.now().toISOString(),
      outcome: "wire-mismatch",
    });
    return disposition(id, { status: "refused", reason: "wire-mismatch" });
  }

  async function persist(record: TransmissionRecord): Promise<TransmissionRecord> {
    const current = await o.transmissions.get(record.proposal);
    const sequence = Math.max(record.sequence ?? 0, current?.sequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence)) throw new Error("Transmission sequence exhausted");
    const next = { ...record, sequence };
    await o.transmissions.put(next); // The adapter MUST fsync before returning.
    return next;
  }

  async function recordTransmission(record: TransmissionRecord): Promise<TransmissionRecord> {
    record = await persist(record);
    await o.audit.append({
      type: "transmission",
      proposal: record.proposal,
      at: record.updatedAt,
      outcome: record.status,
      transmission: record,
      wireDigest: record.wireDigest,
      underMandate: record.underMandate,
      ...(record.underApproval ? { underApproval: record.underApproval } : {}),
    });
    return record;
  }

  async function finish(record: TransmissionRecord): Promise<Disposition> {
    record = await recordTransmission(record);
    const result = {
      status: record.status as "sent" | "not-sent" | "uncertain",
      reason: record.status,
    };
    // Keep incomplete settlements queued until the idempotent local event write succeeds.
    await o.proposals.emitTransmission({
      type: "transmission-settled",
      proposal: record.proposal,
      conversation: record.conversation,
      activity: derivedUrn("transmission", record.proposal),
      status: result.status,
      // Finality concerns delivery only; a successful send never proves agreement performance.
      final:
        record.status === "sent" ||
        (record.status === "not-sent" && record.attempts >= MAX_TRANSMISSION_ATTEMPTS),
      sequence: record.sequence,
      at: record.updatedAt,
    });
    await o.proposals.writeDisposition(record.proposal, result);
    return result;
  }

  async function duplicate(record: TransmissionRecord): Promise<TransmitResult> {
    await finish(record);
    return {
      status: "duplicate",
      ...(record.providerRef ? { providerRef: record.providerRef } : {}),
    };
  }

  async function recoverSettlement(id: string): Promise<TransmitResult | undefined> {
    return o.transmissions.exclusive(async () => {
      checkBackgroundFailure();
      const records = [...(await o.transmissions.list()), ...(await o.audit.listCommitted())];
      const record = transmissionRecords(records).find((r) => r.proposal === id);
      // Repair durable settlements independently of authority or an explicitly requested retry.
      if (record?.status === "sent") return duplicate(record);
      return record?.status === "not-sent" ? finish(record) : undefined;
    });
  }

  async function prepare(
    id: string,
    execute: boolean,
    reservation?: { record: TransmissionRecord },
  ): Promise<
    | TransmitResult
    | ReadyEvaluation
    | { entry: OutboxEntry; binding: SendBinding; record: TransmissionRecord; resend: boolean }
  > {
    const revision = state.revision;
    // DESIGN §4.1: no proposal, mandate, approval or credential work before the halt check.
    checkBackgroundFailure();
    const control = await controls();
    if (control.halted) return disposition(id, { status: "refused", reason: "halted" });
    const loaded = await o.proposals.get(id);
    if (!loaded) return disposition(id, { status: "refused", reason: "unknown-proposal" });
    // Canonical data snapshot rejects getters, hidden fields and cyclic hostile proposals.
    let entry: OutboxEntry;
    let binding: SendBinding;
    try {
      entry = JSON.parse(canonicalJson(loaded)) as OutboxEntry;
      const candidate = o.bindings[entry.proposal.intent.binding];
      if (!candidate || candidate.id !== entry.proposal.intent.binding)
        throw new Error("Invalid binding");
      binding = candidate;
      const rendered = await binding.send.render(entry.renderable, binding.carriage);
      if (
        !podRecordSchema.safeParse(entry.proposal).success ||
        entry.proposal.id !== id ||
        rendered.bytes !== entry.wire.bytes ||
        rendered.mediaType !== entry.wire.mediaType ||
        digestBytes(rendered.bytes) !== entry.wireDigest ||
        entry.wire.digest !== entry.wireDigest ||
        rendered.digest !== entry.wireDigest ||
        proposalTermsDigest(entry) !== entry.proposal.intent.termsDigest ||
        (
          await binding.send.validate(entry.wire, {
            renderable: entry.renderable,
            intent: entry.proposal.intent,
            account: entry.account,
          })
        ).ok !== true
      )
        throw new Error("Invalid wire");
    } catch {
      return tamper(id);
    }
    const now = o.clock.now();
    if (!(Date.parse(entry.proposal.validUntil) >= now.getTime()))
      return disposition(id, { status: "refused", reason: "expired" });
    let mandate: AccountingMandate | undefined;
    try {
      mandate = await o.mandates.load();
    } catch {
      /* absent/unverifiable is refuse-all */
    }
    if (
      !mandate ||
      mandate.issuer !== o.ownerWebId ||
      control.statements.some((c) => c.kind === "RevokeMandate" && c.target === mandate.id)
    )
      return disposition(id, { status: "refused", reason: "mandate-invalid" });
    const intent = entry.proposal.intent;
    const decision = await evaluateIntent(
      mandate,
      {
        agent: o.agentWebId,
        action: intent.action,
        target: intent.target,
        at: now.toISOString(),
        attributes: {
          [`${AGENT}binding`]: intent.binding,
          [`${AGENT}recipientSet`]: intent.recipientHash,
          [`${AGENT}costExceeds`]: intent.amount.value,
          purpose: intent.purpose,
          operation: intent.operation,
          amount: intent.amount.value,
          currency: intent.amount.currency,
        },
      },
      o.policy,
    );
    if (decision.decision === "refuse-all")
      return disposition(id, { status: "refused", reason: "mandate-invalid" });
    if (decision.decision === "prohibited")
      return disposition(id, { status: "prohibited", reason: "prohibition" });
    let approvals: Awaited<ReturnType<typeof o.approvals.findVerified>>;
    try {
      approvals = await o.approvals.findVerified({
        proposal: id,
        termsDigest: intent.termsDigest,
        ownerWebId: o.ownerWebId,
        now,
      });
    } catch {
      // An unreadable denial store cannot establish permission, even for autonomous actions.
      return disposition(id, { status: "awaiting-approval", reason: "approval-unavailable" });
    }
    const current = approvals.filter(
      (a) =>
        a.approves === id &&
        a.termsDigest === intent.termsDigest &&
        Date.parse(a.expires) > o.clock.now().getTime(),
    );
    if (current.some((a) => a.decision === "deny"))
      return disposition(id, { status: "refused", reason: "approval-denied" });
    let approval: (typeof current)[number] | undefined;
    if (decision.decision === "confirm-required") {
      approval = current.find((a) => a.decision === "approve");
      if (!approval?.id)
        return disposition(id, { status: "awaiting-approval", reason: "approval-required" });
    }
    const deadlines: AuthorityDeadlines = {
      proposal: Date.parse(entry.proposal.validUntil),
      mandate: Date.parse(mandate.validUntil),
      ...(approval ? { approval: Date.parse(approval.expires) } : {}),
      controls: Infinity,
      policy: nextPolicyTransition(mandate, now.getTime()),
      accounting: nextAccountingTransition(mandate, now),
    };
    // Limits and claims share a store-wide lock. Ledger failure never means zero usage.
    const records = [...(await o.transmissions.list()), ...(await o.audit.listCommitted())];
    if (reservation && reservation.record.committedAt !== now.toISOString()) {
      // Only this live, undispatched claim can move windows; unresolved provider effects cannot.
      reservation.record = await recordTransmission({
        ...reservation.record,
        committedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      records.push(reservation.record);
    }
    const limit = checkLimits(mandate, entry, records, now);
    if (limit) return disposition(id, limit);
    const previous = transmissionRecords(records).find((r) => r.proposal === id);
    if (
      previous &&
      (previous.binding !== binding.id ||
        previous.account !== entry.account.id ||
        previous.wireDigest !== entry.wireDigest ||
        previous.termsDigest !== intent.termsDigest)
    )
      return tamper(id);
    if (previous?.status === "sent") return duplicate(previous);
    const mandateId = mandate.id;
    async function authorityFailure(): Promise<Disposition | undefined> {
      const latest = await controls();
      if (latest.halted) return { status: "refused", reason: "halted" };
      if (latest.statements.some((c) => c.kind === "RevokeMandate" && c.target === mandateId))
        return { status: "refused", reason: "mandate-invalid" };
      if (revision !== state.revision) return { status: "refused", reason: "authority-changed" };
      // Expiry may expose an older Halt; a future Halt or revocation may activate after the await.
      deadlines.controls = latest.nextTransition;
      return temporalFailure(deadlines);
    }
    if (!execute || o.dryRun !== false) {
      const ready = {
        status: "ready" as const,
        reason: execute ? "dry-run" : "re-evaluated",
      };
      await disposition(id, ready);
      // Decision persistence can suspend too; ready is never sufficient authority by itself.
      const failure = await authorityFailure();
      return failure ? disposition(id, failure) : { ...ready, deadlines };
    }
    if (pending.has(id)) return { status: "uncertain", reason: "in-flight" };
    let unresolved = previous?.status === "attempting" || previous?.status === "uncertain";
    if (previous && unresolved) {
      let found: unknown;
      try {
        if (binding.send.lookup) found = await bounded(binding.send.lookup(entry.wire), timeout);
      } catch {
        /* unknown */
      }
      const outcome = providerResult(found, true);
      if (outcome === "found")
        return finish({
          ...previous,
          status: "sent",
          providerRef: (found as { providerRef: string }).providerRef,
          updatedAt: o.clock.now().toISOString(),
        });
      if (outcome === "absent" && binding.send.finalAbsence === true) {
        const absent = {
          ...previous,
          status: "not-sent" as const,
          updatedAt: o.clock.now().toISOString(),
        };
        // Absence settles the old attempt, not the proposal while another attempt may follow.
        if (previous.attempts >= MAX_TRANSMISSION_ATTEMPTS) await finish(absent);
        else await recordTransmission(absent);
        unresolved = false;
      } else if (!(binding.id === "a2a" && binding.send.idempotentResend === true))
        return finish({
          ...previous,
          status: "uncertain",
          updatedAt: o.clock.now().toISOString(),
        });
    }
    if ((previous?.attempts ?? 0) >= MAX_TRANSMISSION_ATTEMPTS)
      return disposition(id, { status: "refused", reason: "attempt-limit" });
    // Provider lookup / approval / disk I/O can suspend: re-check controls immediately before claiming.
    const failure = await authorityFailure();
    if (failure) return disposition(id, failure);
    const record = await persist({
      proposal: id,
      binding: binding.id,
      account: entry.account.id,
      wireDigest: entry.wireDigest,
      termsDigest: intent.termsDigest,
      status: "attempting",
      attempts: (previous?.attempts ?? 0) + 1,
      sequence: previous?.sequence ?? 0,
      startedAt: previous?.startedAt ?? now.toISOString(),
      committedAt: unresolved && previous ? previous.committedAt : now.toISOString(),
      updatedAt: o.clock.now().toISOString(),
      underMandate: mandate.id,
      ...(approval ? { underApproval: approval.id } : {}),
      conversation: intent.conversation,
      recipientHash: intent.recipientHash,
      amount: intent.amount,
    });
    await o.audit.append({
      type: "decision",
      proposal: id,
      at: record.updatedAt,
      outcome: "permit",
      wireDigest: record.wireDigest,
      underMandate: mandate.id,
      ...(approval ? { underApproval: approval.id } : {}),
    });
    await o.audit.append({
      type: "transmission",
      proposal: id,
      at: record.updatedAt,
      outcome: "attempting",
      transmission: record,
      wireDigest: record.wireDigest,
      underMandate: mandate.id,
      ...(approval ? { underApproval: approval.id } : {}),
    });
    pending.add(id);
    return { entry, binding, record, resend: unresolved };
  }

  async function transmit(id: string): Promise<TransmitResult> {
    const revision = state.revision;
    const prepared = await o.transmissions.exclusive(() => prepare(id, true));
    if (!("record" in prepared))
      return "deadlines" in prepared
        ? { status: prepared.status, reason: prepared.reason }
        : prepared;
    const { entry, binding, resend } = prepared;
    const reservation = { record: prepared.record };
    let executorFailure: { error: unknown } | undefined;
    let credentialsReleased = false;
    function checkExecutorFailure() {
      if (executorFailure) throw executorFailure.error;
    }
    // Token acquisition is delayed until the binding actually calls send; no read grant exists.
    const tokens: TokenProviderProjection = {
      send: async (account) => {
        checkExecutorFailure();
        if (account.id !== entry.account.id || (await controls()).halted)
          throw new Error("Send gate closed");
        const grant = await o.tokens.send({ id: account.id });
        if (grant.access !== "send" || typeof grant.accessToken !== "string" || !grant.accessToken)
          throw new Error("Send grant unavailable");
        const authority = await recheck();
        // No asynchronous work may separate this clock check from releasing the grant.
        if (!authority || temporalFailure(authority) || revision !== state.revision)
          throw new Error("Send grant unavailable");
        checkExecutorFailure();
        credentialsReleased = true;
        return grant;
      },
    };
    async function recheck(): Promise<AuthorityDeadlines | undefined> {
      try {
        const result = await o.transmissions.exclusive(() =>
          prepare(id, false, !resend && !credentialsReleased ? reservation : undefined),
        );
        return "deadlines" in result && revision === state.revision ? result.deadlines : undefined;
      } catch (error) {
        executorFailure = { error };
        throw error;
      }
    }
    async function settle(value: unknown): Promise<Disposition> {
      try {
        const result = await o.transmissions.exclusive(async () => {
          const current = await o.transmissions.get(id);
          if (current?.status === "sent") return finish(current);
          const reported = providerResult(value, false);
          const outcome =
            reported === "unknown" && executorFailure && !credentialsReleased
              ? "rejected"
              : reported;
          const status =
            outcome === "accepted"
              ? "sent"
              : outcome === "rejected" && !resend
                ? "not-sent"
                : "uncertain";
          return finish({
            ...reservation.record,
            status,
            updatedAt: o.clock.now().toISOString(),
            ...(outcome === "accepted"
              ? { providerRef: (value as SendResult & { providerRef: string }).providerRef }
              : {}),
          });
        });
        if (executorFailure) throw executorFailure.error;
        return result;
      } finally {
        // The provider call has settled, even if a lock, durable write, audit or event failed.
        pending.delete(id);
      }
    }
    // Executor I/O before dispatch is not a provider operation or an ambiguous provider failure.
    let ready: AuthorityDeadlines | undefined;
    try {
      ready = await recheck();
    } catch {
      return settle(undefined);
    }
    if (!ready || temporalFailure(ready) || revision !== state.revision)
      return settle({ outcome: "rejected", detail: "gate-closed" });
    async function dispatch() {
      return binding.send.transmit(entry.wire, {
        account: entry.account,
        tokens,
        dryRun: false,
      });
    }
    const call = dispatch().catch(() => undefined); // Provider exceptions establish no delivery outcome.
    let value: unknown;
    try {
      value = await bounded(call, timeout);
    } catch {
      // Keep observing the original request: timeouts do not cancel provider effects.
      const late = call.then(settle).catch((error: unknown) => {
        backgroundError = error;
        backgroundFailed = true;
      });
      background.add(late);
      void late.finally(() => background.delete(late));
      return o.transmissions.exclusive(async () => {
        const current = await o.transmissions.get(id);
        if (current?.status === "sent" || current?.status === "not-sent")
          return { status: current.status, reason: current.status };
        reservation.record = {
          ...reservation.record,
          status: "uncertain",
          updatedAt: o.clock.now().toISOString(),
        };
        return finish(reservation.record);
      });
    }
    return settle(value);
  }
  async function runOutboxOnce(execute = true): Promise<Readonly<Record<string, TransmitResult>>> {
    const results: Record<string, TransmitResult> = {};
    for (const id of await o.proposals.queued()) {
      const recovered = await recoverSettlement(id);
      if (recovered) results[id] = recovered;
      else if (execute) results[id] = await transmit(id);
      else {
        const result = await o.transmissions.exclusive(() => prepare(id, false));
        results[id] =
          "deadlines" in result
            ? { status: result.status, reason: result.reason }
            : (result as TransmitResult);
      }
    }
    return results;
  }
  function onAuthorityChange() {
    // Invalidate in-flight decisions before waiting for the store lock or queue enumeration.
    state.revision++;
    return runOutboxOnce(false);
  }
  return {
    transmit,
    runOutboxOnce,
    /** Daemon notifications/polling MUST call this for every control or mandate change. */
    onControlOrMandateChange: onAuthorityChange,
    /** Daemon MUST call this for every approval change, including denials or removal. */
    onApprovalChange: onAuthorityChange,
    /** Await late writes during orderly shutdown. Crash recovery uses the durable records. */
    drain: async () => {
      await Promise.all(background);
      if (backgroundFailed) throw backgroundError;
    },
  };
}
type TokenProviderProjection = ExecutorOptions["tokens"];
