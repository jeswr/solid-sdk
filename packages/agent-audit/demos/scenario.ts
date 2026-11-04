// AUTHORED-BY Codex GPT-6.1-Sol
// Development-only workspace composition. The demo script builds the executor first;
// importing its public dist exports here avoids an audit -> executor dependency cycle.

import {
  createVcMandateVerifier,
  defaultMandate,
  issueApproval,
  issueMandate,
  mandateToTurtle,
  parseMandateCredential,
  solidOdrlEngine,
  verifyApproval,
} from "@jeswr/agent-mandate";
import { canonicalJson, digestBytes, digestOf, recordToTurtle } from "@jeswr/agent-model";
import {
  buildBitstringStatusListCredential,
  createBitstringStatusResolver,
  createStatusBitstring,
  createWebIdKeyResolver,
  generateKeyPairForSuite,
  issue,
  publishVerificationMethod,
  setStatusBit,
} from "@jeswr/solid-vc";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { randomBytes } from "crypto";
import {
  createExecutor,
  type OutboxEntry,
  proposalApprovalTerms,
  proposalTermsDigest,
} from "../../agent-executor/dist/index.js";
import { createMemoryStores } from "../../agent-executor/dist/testing.js";
import {
  type AuditFetch,
  AuditWriter,
  hashRecipient,
  MemoryLedger,
  PodMirror,
} from "../dist/index.js";
import { container, grantRead, put } from "./rdf.ts";

export const CASES = [
  "approved",
  "forged-approval",
  "out-of-scope",
  "revoked-at-time",
  "missing-prov",
] as const;
export type Scenario = (typeof CASES)[number];

export async function seedWalkthrough(options: {
  pod: string;
  owner: string;
  io: AuditFetch;
  anonymous: AuditFetch;
  print: (line: string) => void;
}) {
  const { pod, owner, io, anonymous, print } = options;
  const at = new Date().toISOString();
  const until = new Date(Date.parse(at) + 3600000).toISOString();
  const base = new URL("demos/d3/", pod).href;
  const agent = new URL("profile/agent#me", pod).href;
  const ed = await generateKeyPairForSuite(`${owner}/mandate`);
  const p256 = await generateKeyPairForSuite(`${owner}/approval`, "P-256");
  const profile = new URL("profile/card", pod).href;
  const original = await io(profile);
  if (!original.ok) throw new Error("Owner profile unreadable");
  const methods = await Promise.all(
    [ed, p256].map((key) =>
      publishVerificationMethod({
        controller: owner,
        verificationMethod: key.verificationMethod,
        key,
      }),
    ),
  );
  await put(io, profile, [await original.text(), ...methods.map((m) => m.turtle)].join("\n"));
  await grantRead(io, profile, owner);
  const agentMethod = await publishVerificationMethod({
    controller: agent,
    verificationMethod: `${agent}/key`,
    key: await generateKeyPairForSuite(`${agent}/key`),
  });
  await put(io, new URL("profile/agent", pod).href, agentMethod.turtle);
  await grantRead(io, new URL("profile/agent", pod).href, owner);
  const recipientHash = hashRecipient("recipient@example.org", "demo-account", randomBytes(32));
  let sends = 0;
  print(`OWNER ${owner}`);
  print(`AGENT ${agent}`);
  for (const name of CASES) {
    const root = new URL(`${name}/`, base).href;
    await container(io, root, owner);
    await container(io, new URL("agent/", root).href, owner);
    for (const part of ["audit", "mandates", "approvals", "proposals", "inbox"])
      await container(io, new URL(`agent/${part}/`, root).href, owner);
    const mandateId = new URL("agent/mandates/default.trig", root).href;
    const statusId = new URL("agent/mandates/status.ttl", root).href;
    const mandate = defaultMandate({
      id: mandateId,
      ownerWebId: owner,
      agentWebId: agent,
      recipientHashes: [recipientHash],
      now: new Date(at),
    });
    const vc = await issueMandate(mandate, ed, {
      statusListCredential: statusId,
      statusListIndex: "1",
    });
    await put(io, mandateId, await mandateToTurtle(vc), "application/trig");
    async function status(revoked: boolean) {
      const bits = createStatusBitstring();
      if (revoked) setStatusBit(bits, 1, true);
      const credential = await issue({
        credential: buildBitstringStatusListCredential({
          id: statusId,
          issuer: owner,
          statusPurpose: "revocation",
          bits,
          validFrom: at,
          validUntil: until,
        }),
        key: ed,
        options: { created: new Date(at) },
      });
      await put(io, statusId, JSON.stringify(credential), "application/ld+json");
    }
    await status(false);
    const ledger = new MemoryLedger();
    const writer = new AuditWriter(ledger, new PodMirror(io, root));
    // The memory store and delivery sink are explicit synthetic seams, never providers.
    const stores = createMemoryStores(at);
    const keys = createWebIdKeyResolver({ fetch: io });
    const mandates = createVcMandateVerifier({
      read: async () => parseMandateCredential(await (await io(mandateId)).text()),
      ownerWebId: owner,
      agentWebId: agent,
      statusListCredential: statusId,
      webIdKeyResolver: keys,
      now: () => new Date(at),
      resolveStatus: createBitstringStatusResolver({
        fetch: io,
        resolveKey: keys.resolveKey.bind(keys),
        isControlledBy: keys.isControlledBy.bind(keys),
        now: new Date(at),
      }),
    });
    for (let number = 1; number <= (name === "approved" ? 2 : 1); number++) {
      const proposal = new URL(`agent/proposals/${number}.ttl`, root).href;
      const approvalId = new URL(`agent/approvals/${number}.trig`, root).href;
      const renderable: OutboxEntry["renderable"] = {
        compactJws: "synthetic.demo.carrier",
        message: {
          profile: "urn:demo:profile",
          configuration: "urn:demo:configuration",
          id: `urn:demo:message:${number}`,
          conversation: "urn:demo:conversation",
          kind: "invoke",
          from: { actor: agent },
          createdAt: at,
          expiresAt: until,
          body: {
            operation: { id: "urn:demo:send", version: "1" },
            input: { text: "Synthetic private body" },
            basis: { kind: "public" },
          },
        },
      };
      const bytes = canonicalJson(renderable);
      const wire = { bytes, mediaType: "application/json", digest: digestBytes(bytes) };
      const entry: OutboxEntry = {
        proposal: {
          type: "action-proposal",
          id: proposal,
          intent: {
            operation: "urn:demo:send",
            operationVersion: "1",
            action: "https://jeswr.org/ns/agent#SendMessage",
            target: proposal,
            binding: "gmail",
            recipientHash,
            amount: { value: 0, currency: "GBP" },
            purpose: "urn:demo:reply",
            termsDigest: "pending",
            parameters: {},
            conversation: "urn:demo:conversation",
          },
          renderedPreview: "Synthetic private body",
          wasGeneratedBy: "urn:demo:deterministic",
          createdAt: at,
          validUntil: until,
          state: "proposed",
        },
        renderable,
        account: { id: "demo-account" },
        wire,
        wireDigest: wire.digest,
      };
      entry.proposal.intent.termsDigest = proposalTermsDigest(entry);
      const terms = proposalApprovalTerms(entry);
      const common = {
        agent,
        owner,
        proposal,
        mandate: mandateId,
        terms,
        termsDigest: digestOf(terms),
      };
      const decisionRecord = `${proposal}#decision`;
      await put(io, proposal, await recordToTurtle(entry.proposal));
      await put(
        io,
        new URL(`agent/inbox/${number}.txt`, root).href,
        "Synthetic private body",
        "text/plain",
      );
      await writer.append({ ...common, type: "proposal", id: proposal }, at);
      await writer.append(
        { ...common, type: "decision", id: decisionRecord, decision: "confirm-required" },
        at,
      );
      const approval = {
        id: approvalId,
        approves: proposal,
        termsDigest: common.termsDigest,
        expires: until,
        decision: "approve" as const,
      };
      const signed = await issueApproval(approval, p256, new Date(at));
      await put(io, approvalId, signed, "application/trig");
      await writer.append(
        {
          type: "approval-seen",
          id: `${proposal}#approval-seen`,
          agent,
          owner,
          proposal,
          approval: approvalId,
        },
        at,
      );
      if (name === "approved") {
        stores.entries.set(proposal, entry);
        const executor = createExecutor({
          ownerWebId: owner,
          agentWebId: agent,
          proposals: stores.proposals,
          controls: stores.controls,
          clock: stores.clock,
          transmissions: stores.transmissions,
          audit: stores.audit,
          mandates,
          policy: solidOdrlEngine,
          approvals: {
            findVerified: async (context) => {
              const check = await verifyApproval(await (await io(approvalId)).text(), {
                id: approvalId,
                ownerWebId: owner,
                proposal: context.proposal,
                termsDigest: context.termsDigest,
                now: () => context.now,
                webIdKeyResolver: keys,
              });
              return check.valid ? [check.approval] : [];
            },
          },
          tokens: { send: async () => ({ access: "send", accessToken: "synthetic-demo-only" }) },
          bindings: {
            gmail: {
              id: "gmail",
              carriage: {
                id: "synthetic-demo",
                structured: "native",
                footer: "none",
                maxBytes: 65536,
              },
              send: {
                render: async () => wire,
                validate: async (candidate, context) =>
                  candidate.digest === wire.digest &&
                  context.account.id === entry.account.id &&
                  canonicalJson(context.intent) === canonicalJson(entry.proposal.intent)
                    ? { ok: true }
                    : { ok: false, reason: "synthetic-wire-mismatch" },
                transmit: async (_wire, context) => {
                  await context.tokens.send(context.account);
                  sends++;
                  return { outcome: "accepted", providerRef: `demo:${sends}` };
                },
              },
            },
          },
          dryRun: false,
        });
        const result = await executor.transmit(proposal);
        if (result.status !== "sent") throw new Error("Approved demo send refused");
        await executor.drain();
        print(`SEND ${number}: executor sent to in-memory sink under fresh signed approval`);
      }
      // The four counterexamples are synthetic historical evidence, not extra sends.
      await writer.append(
        {
          ...common,
          type: "transmission",
          id: `${proposal}#transmission`,
          decisionRecord,
          approval: approvalId,
          status: "sent",
        },
        at,
      );
      await writer.append(
        {
          type: "receipt",
          id: `${proposal}#receipt`,
          agent,
          owner,
          proposal,
          transmission: `${proposal}#transmission`,
        },
        at,
      );
      if (name === "forged-approval")
        await put(
          io,
          approvalId,
          signed.replace(approval.termsDigest, digestOf("forged demo terms")),
          "application/trig",
        );
    }
    if (name === "out-of-scope") {
      const narrowed = { ...mandate, withApproval: { ...mandate.withApproval, permissions: [] } };
      await put(
        io,
        mandateId,
        await mandateToTurtle(
          await issueMandate(narrowed, ed, {
            statusListCredential: statusId,
            statusListIndex: "1",
          }),
        ),
        "application/trig",
      );
    }
    if (name === "revoked-at-time") await status(true);
    if (name === "missing-prov") {
      const response = await io(new URL("agent/audit/3.ttl", root).href, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not arrange missing PROV counterexample");
    }
    for (const part of ["audit", "mandates", "approvals"]) {
      const target = new URL(`agent/${part}/`, root).href;
      const denied = await anonymous(target, { credentials: "omit", redirect: "manual" });
      if (![401, 403].includes(denied.status))
        throw new Error("Demo container was not private before grant");
      await grantRead(io, target, owner);
      print(`GRANT ${name} agent/${part}/: foaf:Agent acl:Read (inherited)`);
    }
    const privateBody = await anonymous(new URL("agent/inbox/1.txt", root).href, {
      credentials: "omit",
      redirect: "manual",
    });
    if (![401, 403].includes(privateBody.status)) throw new Error("Demo inbox unexpectedly public");
    const privateProposal = await anonymous(new URL("agent/proposals/1.ttl", root).href, {
      credentials: "omit",
      redirect: "manual",
    });
    if (![401, 403].includes(privateProposal.status))
      throw new Error("Demo proposal preview unexpectedly public");
    const publicWrite = await anonymous(new URL("agent/audit/anonymous-write.txt", root).href, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "denied",
      credentials: "omit",
      redirect: "manual",
    });
    if (![401, 403].includes(publicWrite.status))
      throw new Error("Demo auditor unexpectedly has write access");
  }
  if (sends !== 2) throw new Error("Expected exactly two synthetic sends");
  print(
    "PRIVATE inbox bodies and proposal previews remain owner-only; four counterexamples are isolated synthetic evidence",
  );
  return { base, sends };
}
