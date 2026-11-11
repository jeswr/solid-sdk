// AUTHORED-BY Codex GPT-6.1-Sol

import { evaluateIntent } from "@jeswr/agent-mandate";
import { type ActionProposal, digestOf, type PodRecord, recordToTurtle } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import type { Page } from "@playwright/test";
import { auditHeadToTurtle, auditToTurtle, sealAudit } from "../../src/apps/agent/lib/audit";
import { createAgentClient } from "../../src/apps/agent/lib/client";
import { nextTurnNumber } from "../../src/apps/agent/lib/conversation";
import { loadVerifiedMandate, proposalIntent } from "../../src/apps/agent/lib/mandates";
import {
  type DisplayApproval,
  loadedRecords,
  readApprovals,
  readAudit,
  readControl,
  readOutbox,
  readProposals,
  readTurns,
} from "../../src/apps/agent/lib/readers";
import { agentStatus } from "../../src/apps/agent/lib/status";
import { createAgentVerifier } from "../../src/apps/agent/lib/verify";
import { DEMO_ROOT, DEMO_WEBID } from "../../src/lib/demo-pod/constants";

/** Offline executor subset, using real signatures and profile resolution through the app's durable pod. */
export function daemonDouble(page: Page) {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const result = await page.evaluate(
      async (args) => {
        const pod = window.__suiteDemoPod;
        if (!pod) throw new Error("Demo fixtures are disabled");
        const response = await pod.fetch(args.url, {
          method: args.method,
          headers: args.headers,
          ...(args.body === null ? {} : { body: args.body }),
        });
        return {
          status: response.status,
          headers: [...response.headers],
          body: await response.text(),
        };
      },
      {
        url: request.url,
        method: request.method,
        headers: [...request.headers],
        body: request.body ? await request.text() : null,
      },
    );
    return new Response([204, 205, 304].includes(result.status) ? null : result.body, result);
  };
  const client = createAgentClient({ fetch, storage: DEMO_ROOT, workspace: `${DEMO_ROOT}agent/` });
  const verifier = createAgentVerifier({ fetch, webId: DEMO_WEBID });
  const write = async (record: PodRecord) => {
    const previous = await fetch(record.id);
    const body = await recordToTurtle(record);
    if (previous.status === 404) await client.create(record.id, body);
    else {
      const etag = previous.headers.get("etag");
      if (!etag) throw new Error("Missing validator");
      await client.replace(record.id, body, etag);
    }
  };
  const audit = async (proposal: ActionProposal, outcome: string, approval?: string) => {
    const entries = loadedRecords(await readAudit(client));
    const latest = entries[0];
    const seq = (latest?.seq ?? 0) + 1;
    const fields = {
      seq,
      prev: latest?.hash ?? "sha-256:genesis",
      at: new Date().toISOString(),
      record: {
        type: "transmission",
        id: `${client.paths.audit}${seq}.ttl#transmission`,
        agent: `${client.workspace}#agent`,
        owner: DEMO_WEBID,
        status: outcome === "sent" ? "sent" : "refused",
        proposal: proposal.id,
        termsDigest: proposal.intent.termsDigest,
        transmission: `${client.paths.outbox}${proposal.id.split("/").at(-1)}`,
        mandate: `${client.paths.mandates}demo-credential.trig`,
        ...(approval ? { approval } : {}),
      },
    };
    const entry = sealAudit(seq, fields.at, fields.prev, {
      ...fields.record,
      type: "transmission",
      status: outcome === "sent" ? "sent" : "refused",
    });
    await client.create(
      `${client.paths.audit}${seq}.ttl`,
      await auditToTurtle(`${client.paths.audit}${seq}.ttl`, entry),
    );
    const oldHead = await client.graph(client.paths.auditChain);
    await client.replace(
      client.paths.auditChain,
      await auditHeadToTurtle(client.paths.auditChain, entry),
      oldHead.etag as string,
    );
  };
  const outcome = async (
    proposal: ActionProposal,
    refusal?: string,
    approval?: DisplayApproval,
  ) => {
    const existing = loadedRecords(await readOutbox(client)).find(
      (t) => t.proposal === proposal.id && t.status === "sent",
    );
    // Never overwrite evidence of a completed send or send it twice.
    if (existing) return refusal ?? "sent";
    const status = refusal ? "refused" : "sent";
    const now = new Date().toISOString();
    await write({
      type: "transmission",
      id: `${client.paths.outbox}${proposal.id.split("/").at(-1)}`,
      proposal: proposal.id,
      status,
      wireDigest: digestOf(proposal.renderedPreview),
      underMandate: `${client.paths.mandates}demo-credential.trig`,
      ...(approval ? { underApproval: approval.id } : {}),
      ...(status === "sent" ? { externalId: `fake-${crypto.randomUUID()}` } : {}),
      startedAt: now,
      endedAt: now,
    });
    await audit(proposal, refusal ?? "sent", approval?.id);
    return refusal ?? status;
  };
  return {
    fetch,
    client,
    write,
    async propose(slug: string, overrides: Partial<ActionProposal> = {}) {
      const now = Date.now();
      const source =
        loadedRecords(await readProposals(client))[0] ?? exampleRecords["action-proposal"];
      const proposal: ActionProposal = {
        ...source,
        ...overrides,
        id: client.paths.resolveSlug("proposals", slug),
        state: "proposed",
        createdAt: new Date(now).toISOString(),
        validUntil: new Date(now + 86400000).toISOString(),
      };
      await write(proposal);
      return proposal;
    },
    async edit(proposal: ActionProposal) {
      const changed = {
        ...proposal,
        intent: {
          ...proposal.intent,
          termsDigest: digestOf({ old: proposal.intent.termsDigest, changed: true }),
        },
        renderedPreview: `${proposal.renderedPreview}\nChanged terms`,
      };
      await write(changed);
      return changed;
    },
    async answerOwnerTurn(id: string) {
      const conversation = client.paths.resolveSlug("conversations", id);
      const turns = loadedRecords(await readTurns(client, id));
      if (turns[0]?.role !== "owner") return false;
      const members = await client.list(conversation);
      const n = nextTurnNumber(
        members.filter((m) => !m.container).map((m) => m.url),
        conversation,
      );
      await client.create(
        `${conversation}${n}.ttl`,
        await recordToTurtle({
          type: "conversation-turn",
          id: `${conversation}${n}.ttl`,
          conversation,
          attributedTo: `${client.workspace}#agent`,
          role: "agent",
          text: "I have read your message. What would you like to do next?",
          createdAt: new Date().toISOString(),
          refersToProposal: [],
        }),
      );
      return true;
    },
    async tick(proposal: ActionProposal) {
      const controls = loadedRecords(await readControl(client, verifier));
      const halted =
        agentStatus({ controls, now: Date.now(), owner: DEMO_WEBID }).state === "stopped";
      if (halted) return outcome(proposal, "halted");
      const mandate = await loadVerifiedMandate(client, { fetch, webId: DEMO_WEBID });
      if (!mandate) return outcome(proposal, "mandate-invalid");
      const decision = await evaluateIntent(mandate, proposalIntent(proposal, mandate.subject));
      if (decision.decision === "prohibited" || decision.decision === "refuse-all")
        return outcome(proposal, decision.decision);
      const approvals = loadedRecords(await readApprovals(client, verifier)).filter(
        (a) => a.approves === proposal.id && a.verification === "verified",
      );
      const current = approvals.find((a) => a.termsDigest === proposal.intent.termsDigest);
      const refusal =
        proposal.intent.parameters.prohibited === true
          ? "prohibited"
          : Date.parse(proposal.validUntil) <= Date.now()
            ? "expired"
            : current?.decision === "deny"
              ? "denied"
              : !current && approvals.length
                ? "terms-digest-mismatch"
                : undefined;
      if (!refusal && !current && decision.decision !== "permit") return "awaiting-approval";
      return outcome(proposal, refusal, current);
    },
  };
}
