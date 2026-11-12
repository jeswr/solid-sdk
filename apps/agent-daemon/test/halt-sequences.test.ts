// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import {
  createExecutor,
  type OutboxEntry,
  proposalTermsDigest,
  type SendBinding,
} from "@jeswr/agent-executor";
import { createMemoryStores } from "@jeswr/agent-executor/testing";
import { AGENT, solidOdrlEngine } from "@jeswr/agent-mandate";
import { canonicalJson, digestBytes } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { expect, it, vi } from "vitest";
import { createLocalState } from "../src/local.js";

it("property: all 256 Halt/Resume/file sequences fence the executor using real daemon local state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "awp-halt-sequences-"));
  try {
    const local = createLocalState(directory);
    const at = "2026-11-01T12:00:00.000Z";
    const until = "2026-12-01T12:00:00.000Z";
    const owner = "https://owner.example/#me";
    const agent = "https://agent.example/#me";
    for (let sequence = 0; sequence < 256; sequence++) {
      // The verifier seam supplies synthetic verified controls; HALT and its
      // synchronous dispatch fence use the actual filesystem adapter.
      await local.resume(async () => true);
      const stores = createMemoryStores(at);
      const renderable: OutboxEntry["renderable"] = {
        compactJws: "synthetic.signed.carrier",
        message: {
          id: "urn:message:fixture",
          profile: "urn:profile:fixture",
          configuration: "urn:config:fixture",
          conversation: "urn:conversation:fixture",
          kind: "invoke",
          from: { actor: agent },
          createdAt: at,
          expiresAt: until,
          body: {
            operation: { id: "urn:operation:send", version: "1" },
            input: {},
            basis: { kind: "public" },
          },
        },
      };
      const bytes = canonicalJson(renderable);
      const wire = { bytes, mediaType: "application/json", digest: digestBytes(bytes) };
      const transmit = vi.fn<SendBinding["send"]["transmit"]>(async (_wire, io) => {
        io.assertAuthority();
        return { outcome: "accepted" as const, providerRef: "fixture" };
      });
      const executor = createExecutor({
        ownerWebId: owner,
        agentWebId: agent,
        proposals: stores.proposals,
        approvals: stores.approvalStore,
        controls: {
          ...stores.controls,
          haltFileExists: local.halted,
          assertNotHalted: local.assertNotHalted,
        },
        transmissions: stores.transmissions,
        audit: stores.audit,
        clock: stores.clock,
        policy: solidOdrlEngine,
        dryRun: false,
        tokens: { send: async () => ({ access: "send", accessToken: "synthetic" }) },
        bindings: {
          direct: {
            id: "direct",
            carriage: { id: "fixture", structured: "native", footer: "none", maxBytes: 65536 },
            send: { render: async () => wire, validate: async () => ({ ok: true }), transmit },
          },
        },
        mandates: {
          load: async () => ({
            id: "urn:mandate:fixture",
            issuer: owner,
            subject: agent,
            validFrom: at,
            validUntil: until,
            autonomous: {
              id: "urn:autonomous",
              permissions: [{ type: "permission", action: `${AGENT}SendMessage` }],
            },
            withApproval: { id: "urn:approval", permissions: [] },
            prohibitions: [],
            limits: [],
          }),
        },
      });
      let halted = false;
      let file = false;
      let bits = sequence;
      for (let index = 0; index < 4; index++) {
        const action = bits % 4;
        bits = Math.floor(bits / 4);
        if (action < 2) {
          halted = action === 0;
          stores.statements.push({
            type: "control-statement",
            id: `urn:control:${index}`,
            kind: halted ? "Halt" : "Resume",
            attributedTo: owner,
            createdAt: new Date(Date.parse(at) + index).toISOString(),
            expires: until,
          });
        } else {
          file = action === 2;
          if (file) await local.halt();
          else await local.resume(async () => true);
        }
        stores.state.at = new Date(Date.parse(at) + index).toISOString();
        const entry: OutboxEntry = {
          renderable,
          wire,
          wireDigest: wire.digest,
          account: { id: "fixture" },
          proposal: {
            ...exampleRecords["action-proposal"],
            id: `urn:proposal:${index}`,
            createdAt: at,
            validUntil: until,
            intent: {
              ...exampleRecords["action-proposal"].intent,
              binding: "direct",
              action: `${AGENT}SendMessage`,
              amount: { value: 0, currency: "GBP" },
            },
          },
        };
        (entry.proposal.intent as { termsDigest: string }).termsDigest = proposalTermsDigest(entry);
        stores.entries.set(entry.proposal.id, entry);
        const before = transmit.mock.calls.length;
        await executor.transmit(entry.proposal.id);
        expect(transmit.mock.calls.length - before).toBe(halted || file ? 0 : 1);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
