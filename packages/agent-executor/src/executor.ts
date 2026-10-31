// AUTHORED-BY Codex GPT-6.1-Sol
import { AGENT, evaluateIntent } from "@jeswr/agent-mandate";
import type { ControlStatement } from "@jeswr/agent-model";
import {
  canonicalJson,
  derivedUrn,
  digestBytes,
  digestOf,
  podRecordSchema,
} from "@jeswr/agent-model";
import { checkLimits, transmissionRecords } from "./accounting.js";
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

  async function controls(): Promise<{ halted: boolean; statements: readonly ControlStatement[] }> {
    try {
      if (await o.controls.haltFileExists()) return { halted: true, statements: [] };
      const now = o.clock.now().getTime();
      if (!Number.isFinite(now)) return { halted: true, statements: [] };
      const statements = (await o.controls.listVerified(o.ownerWebId)).filter(
        (c) =>
          c.attributedTo === o.ownerWebId &&
          Date.parse(c.createdAt) <= now &&
          Date.parse(c.expires) > now,
      );
      const halts = statements.filter((c) => c.kind === "Halt").map((c) => Date.parse(c.createdAt));
      const resumes = statements
        .filter((c) => c.kind === "Resume")
        .map((c) => Date.parse(c.createdAt));
      return {
        halted: halts.length > 0 && Math.max(...halts) >= Math.max(-Infinity, ...resumes),
        statements,
      };
    } catch {
      return { halted: true, statements: [] };
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

  async function finish(record: TransmissionRecord): Promise<Disposition> {
    await o.transmissions.put(record);
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
    const result = {
      status: record.status as "sent" | "not-sent" | "uncertain",
      reason: record.status,
    };
    await o.proposals.writeDisposition(record.proposal, result);
    await o.proposals.emitReceipt({
      proposal: record.proposal,
      conversation: record.conversation,
      kind: "receipt",
      body: {
        ref: record.proposal,
        activity: derivedUrn("transmission", record.proposal),
        outcome:
          record.status === "sent"
            ? "completed"
            : record.status === "not-sent"
              ? "not-executed"
              : "uncertain",
        final: record.status !== "uncertain",
      },
    });
    return result;
  }

  async function prepare(
    id: string,
    execute: boolean,
  ): Promise<
    | TransmitResult
    | { entry: OutboxEntry; binding: SendBinding; record: TransmissionRecord; resend: boolean }
  > {
    const revision = state.revision;
    // DESIGN §4.1: no proposal, mandate, approval or credential work before the halt check.
    if (backgroundFailed)
      throw new Error("Audit or persistence failed during late settlement", {
        cause: backgroundError,
      });
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
    let approval: string | undefined;
    if (decision.decision === "confirm-required") {
      approval = current.find((a) => a.decision === "approve")?.id;
      if (!approval)
        return disposition(id, { status: "awaiting-approval", reason: "approval-required" });
    }
    // Limits and claims share a store-wide lock. Ledger failure never means zero usage.
    const records = [...(await o.transmissions.list()), ...(await o.audit.listCommitted())];
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
    if (previous?.status === "sent") {
      await finish(previous);
      return {
        status: "duplicate",
        ...(previous.providerRef ? { providerRef: previous.providerRef } : {}),
      };
    }
    const mandateId = mandate.id;
    async function authorityFailure(): Promise<Disposition | undefined> {
      const latest = await controls();
      if (latest.halted) return { status: "refused", reason: "halted" };
      if (latest.statements.some((c) => c.kind === "RevokeMandate" && c.target === mandateId))
        return { status: "refused", reason: "mandate-invalid" };
      if (revision !== state.revision) return { status: "refused", reason: "authority-changed" };
      return undefined;
    }
    if (!execute) {
      const ready = await disposition(id, { status: "ready", reason: "re-evaluated" });
      // Decision persistence can suspend too; ready is never sufficient authority by itself.
      const failure = await authorityFailure();
      return failure ? disposition(id, failure) : ready;
    }
    if (pending.has(id)) return { status: "uncertain", reason: "in-flight" };
    let unresolved = previous?.status === "attempting" || previous?.status === "uncertain";
    if (
      previous &&
      unresolved &&
      !(binding.id === "a2a" && binding.send.idempotentResend === true)
    ) {
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
      if (outcome !== "absent" || binding.send.finalAbsence !== true)
        return finish({
          ...previous,
          status: "uncertain",
          updatedAt: o.clock.now().toISOString(),
        });
      // Persist authoritative absence even when the attempt bound prevents a new request.
      await finish({ ...previous, status: "not-sent", updatedAt: o.clock.now().toISOString() });
      unresolved = false;
    }
    if ((previous?.attempts ?? 0) >= MAX_TRANSMISSION_ATTEMPTS)
      return disposition(id, { status: "refused", reason: "attempt-limit" });
    // Provider lookup / approval / disk I/O can suspend: re-check controls immediately before claiming.
    const failure = await authorityFailure();
    if (failure) return disposition(id, failure);
    const record: TransmissionRecord = {
      proposal: id,
      binding: binding.id,
      account: entry.account.id,
      wireDigest: entry.wireDigest,
      termsDigest: intent.termsDigest,
      status: "attempting",
      attempts: (previous?.attempts ?? 0) + 1,
      startedAt: previous?.startedAt ?? now.toISOString(),
      committedAt: unresolved && previous ? previous.committedAt : now.toISOString(),
      updatedAt: o.clock.now().toISOString(),
      underMandate: mandate.id,
      ...(approval ? { underApproval: approval } : {}),
      conversation: intent.conversation,
      recipientHash: intent.recipientHash,
      amount: intent.amount,
    };
    await o.transmissions.put(record); // The adapter MUST fsync before returning.
    await o.audit.append({
      type: "decision",
      proposal: id,
      at: record.updatedAt,
      outcome: "permit",
      wireDigest: record.wireDigest,
      underMandate: mandate.id,
      ...(approval ? { underApproval: approval } : {}),
    });
    await o.audit.append({
      type: "transmission",
      proposal: id,
      at: record.updatedAt,
      outcome: "attempting",
      transmission: record,
      wireDigest: record.wireDigest,
      underMandate: mandate.id,
      ...(approval ? { underApproval: approval } : {}),
    });
    pending.add(id);
    return { entry, binding, record, resend: unresolved };
  }

  async function transmit(id: string): Promise<TransmitResult> {
    const revision = state.revision;
    const prepared = await o.transmissions.exclusive(() => prepare(id, true));
    if (!("record" in prepared)) return prepared;
    const { entry, binding, record, resend } = prepared;
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
        if (
          grant.access !== "send" ||
          typeof grant.accessToken !== "string" ||
          !grant.accessToken ||
          !(await recheck()) ||
          revision !== state.revision
        )
          throw new Error("Send grant unavailable");
        checkExecutorFailure();
        credentialsReleased = true;
        return grant;
      },
    };
    async function recheck(): Promise<boolean> {
      try {
        const result = await o.transmissions.exclusive(() => prepare(id, false));
        return "status" in result && result.status === "ready" && revision === state.revision;
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
            ...record,
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
        // The provider call has settled, even if a lock, durable write, audit or receipt failed.
        pending.delete(id);
      }
    }
    // Executor I/O before dispatch is not a provider operation or an ambiguous provider failure.
    let ready: boolean;
    try {
      ready = await recheck();
    } catch {
      return settle(undefined);
    }
    if (!ready || revision !== state.revision)
      return settle({ outcome: "rejected", detail: "gate-closed" });
    async function dispatch() {
      return binding.send.transmit(entry.wire, {
        account: entry.account,
        tokens,
        dryRun: o.dryRun !== false,
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
        return finish({ ...record, status: "uncertain", updatedAt: o.clock.now().toISOString() });
      });
    }
    return settle(value);
  }
  async function runOutboxOnce(execute = true): Promise<Readonly<Record<string, TransmitResult>>> {
    const results: Record<string, TransmitResult> = {};
    for (const id of await o.proposals.queued())
      results[id] = execute
        ? await transmit(id)
        : ((await o.transmissions.exclusive(() => prepare(id, false))) as TransmitResult);
    return results;
  }
  return {
    transmit,
    runOutboxOnce,
    /** Daemon notifications/polling MUST call this for every control or mandate change. */
    onControlOrMandateChange: () => {
      // Invalidate in-flight decisions before waiting for the store lock or queue enumeration.
      state.revision++;
      return runOutboxOnce(false);
    },
    /** Await late writes during orderly shutdown. Crash recovery uses the durable records. */
    drain: async () => {
      await Promise.all(background);
      if (backgroundFailed) throw backgroundError;
    },
  };
}
type TokenProviderProjection = ExecutorOptions["tokens"];
