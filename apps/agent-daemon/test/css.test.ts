// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { AuditWriter, MemoryLedger, PodMirror } from "@jeswr/agent-audit";
import { createInMemoryDirectBinding, RecordingTokenProvider } from "@jeswr/agent-channels/testing";
import {
  createExecutor,
  type ExecutorOptions,
  type OutboxEntry,
  proposalTermsDigest,
  type SendBinding,
} from "@jeswr/agent-executor";
import { createMemoryStores } from "@jeswr/agent-executor/testing";
import { AGENT, issueApproval, solidOdrlEngine, verifyApproval } from "@jeswr/agent-mandate";
import {
  type AnyMessage,
  type ControlStatement,
  canonicalJson,
  newUrn,
  recordFromTurtle,
  recordToTurtle,
  toRdf,
} from "@jeswr/agent-model";
import { createGateway } from "@jeswr/agent-model-gateway";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { type DataIntegrityProof, DataIntegritySuite, type KeyPair } from "@jeswr/solid-vc";
import { type ChildProcess, fork } from "child_process";
import { once } from "events";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { expect, it, vi } from "vitest";
import { createDaemon } from "../src/daemon.js";
import { createMemoryState } from "../src/testing.js";
import type { DaemonOptions } from "../src/types.js";
import { PodWorkspace } from "../src/workspace.js";

it("composes an in-memory CSS pod and direct binding: inbound, proposal, signed approval, transmission, audit and signed halt", async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const root = `http://localhost:${port}/`;
  const owner = `${root}profile/card#me`;
  const actor = `${root}profile/agent#me`;
  const at = "2026-11-01T12:00:00.000Z";
  const until = "2026-12-31T12:00:00.000Z";
  const directory = await mkdtemp(join(tmpdir(), "awp-css-"));
  let child: ChildProcess | undefined;
  const transport = createNodeGuardedFetch({ allowLoopback: true, maxRedirects: 0 });
  try {
    const css = dirname(fileURLToPath(import.meta.resolve("@solid/community-server/package.json")));
    const config = JSON.parse(await readFile(join(css, "config/file-root.json"), "utf8"));
    config.import = config.import.map((s: string) =>
      s
        .replace("storage/backend/file.json", "storage/backend/memory.json")
        .replace("util/resource-locker/file.json", "util/resource-locker/memory.json")
        // Synthetic identity only: fixture retains real WAC checks, anonymous reads must fail.
        .replace(
          "ldp/authentication/dpop-bearer.json",
          "ldp/authentication/debug-auth-header.json",
        ),
    );
    const configPath = join(directory, "memory.json");
    await writeFile(configPath, JSON.stringify(config));
    child = fork(
      fileURLToPath(new URL("./css-process.mjs", import.meta.url)),
      [configPath, String(port)],
      {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        execArgv: [],
        env: { ...process.env, NODE_ENV: "production" },
      },
    );
    await new Promise<void>((resolve, reject) => {
      child?.once("message", () => resolve());
      child?.once("exit", () => reject(new Error("CSS fixture startup failed")));
      child?.once("error", reject);
    });
    const io: PodWorkspace["io"] = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `WebID ${owner}`);
      return transport(input, { ...init, headers });
    };
    const workspace = new PodWorkspace({
      io,
      root,
      ownerWebId: owner,
      privateTypeIndex: `${root}settings/privateTypeIndex.ttl`,
    });
    const tokens = new RecordingTokenProvider();
    const message: AnyMessage = {
      profile: "urn:test:profile",
      configuration: "urn:test:config",
      id: "urn:message:fixture",
      conversation: "urn:conversation:fixture",
      kind: "invoke",
      from: { actor },
      createdAt: at,
      expiresAt: until,
      body: {
        operation: { id: "urn:operation:send", version: "1" },
        input: {},
        basis: { kind: "public" },
      },
    };
    const direct = createInMemoryDirectBinding({
      tokens,
      verify: async (carrier) =>
        carrier.startsWith("seed.") ? { ...message, id: "urn:message:seed" } : message,
      now: () => Date.parse(at),
    });
    const renderable = { message, compactJws: "fixture.signed.message" };
    const wire = await direct.send.render(renderable, direct.carriage);
    // Seed one local inbound carrier without a provider or real credential.
    const seed = await direct.send.render(
      { message: { ...message, id: "urn:message:seed" }, compactJws: "seed.signed.message" },
      direct.carriage,
    );
    await direct.send.transmit(seed, { account: { id: "fixture" }, tokens, dryRun: false });
    const stores = createMemoryStores(at);
    const key: KeyPair = {
      ...(await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
        "sign",
        "verify",
      ])),
      verificationMethod: `${owner}/approval`,
    };
    const resolver = {
      isControlledBy: async (method: string, controller: string) =>
        method === key.verificationMethod && controller === owner,
      resolveKey: async () => key.publicKey,
    };
    const proposal: OutboxEntry["proposal"] = {
      type: "action-proposal",
      id: `${root}agent/proposals/fixture.ttl`,
      intent: {
        operation: "urn:operation:send",
        operationVersion: "1",
        action: `${AGENT}SendMessage`,
        target: "urn:target:fixture",
        binding: "direct",
        recipientHash: `sha256:${"a".repeat(64)}`,
        amount: { value: 0, currency: "GBP" },
        purpose: "urn:purpose:reply",
        termsDigest: "placeholder",
        parameters: {},
        conversation: message.conversation,
      },
      renderedPreview: "Synthetic reply",
      wasGeneratedBy: actor,
      createdAt: at,
      validUntil: until,
      state: "proposed",
    };
    const entry: OutboxEntry = {
      proposal,
      renderable,
      account: { id: "fixture" },
      wire,
      wireDigest: wire.digest,
    };
    (proposal.intent as { termsDigest: string }).termsDigest = proposalTermsDigest(entry);
    const ledger = new MemoryLedger();
    const writer = new AuditWriter(ledger, new PodMirror(io, root));
    const controlUrl = `${root}agent/control/halt.ttl`;
    const approvalUrl = `${root}agent/approvals/fixture.ttl`;
    const transmit = vi.fn(async () => ({
      outcome: "accepted" as const,
      providerRef: "direct:fixture",
    }));
    const binding: SendBinding = {
      id: "direct",
      carriage: direct.carriage,
      send: {
        render: direct.send.render,
        validate: async (w, context) => direct.send.validate(w, context.renderable),
        // Separate reply mailbox/id is unnecessary here; use the direct transport and record the effect.
        transmit: async (w, context) => {
          const result = await direct.send.transmit(w, context);
          await transmit();
          return result;
        },
      },
    };
    const options: ExecutorOptions = {
      ownerWebId: owner,
      agentWebId: actor,
      proposals: stores.proposals,
      clock: stores.clock,
      transmissions: stores.transmissions,
      tokens,
      bindings: { direct: binding },
      dryRun: false,
      policy: solidOdrlEngine,
      mandates: {
        load: async () => ({
          id: `${root}agent/mandates/fixture`,
          issuer: owner,
          subject: actor,
          validFrom: at,
          validUntil: until,
          autonomous: { id: "urn:autonomous", permissions: [] },
          withApproval: {
            id: "urn:approval",
            permissions: [{ type: "permission", action: `${AGENT}SendMessage` }],
          },
          prohibitions: [],
          limits: [],
        }),
      },
      controls: {
        haltFileExists: async () => false,
        async listVerified() {
          const response = await io(controlUrl);
          if (response.status === 404) return [];
          if (!response.ok) throw new Error("Unreadable controls");
          const record = await recordFromTurtle(await response.text(), controlUrl);
          if (record.type !== "control-statement") throw new Error("Invalid control");
          const { proof, ...claims } = record;
          const signature = proof as unknown as DataIntegrityProof;
          if (
            signature?.verificationMethod !== key.verificationMethod ||
            signature.proofPurpose !== "assertionMethod" ||
            !(await new DataIntegritySuite("ecdsa-rdfc-2019").verify(
              [...toRdf(claims)],
              signature,
              { resolveKey: () => key.publicKey },
            ))
          )
            throw new Error("Unverified control");
          return [record];
        },
      },
      approvals: {
        async findVerified(context) {
          const response = await io(approvalUrl);
          if (response.status === 404) return [];
          if (!response.ok) throw new Error("Unreadable approvals");
          const result = await verifyApproval(await response.text(), {
            id: approvalUrl,
            ownerWebId: owner,
            proposal: context.proposal,
            termsDigest: context.termsDigest,
            webIdKeyResolver: resolver,
            now: () => context.now,
          });
          return result.valid ? [result.approval] : [];
        },
      },
      audit: {
        listCommitted: stores.audit.listCommitted,
        async append(record) {
          await stores.audit.append(record);
          await writer.append(
            {
              type: record.type,
              id: newUrn(),
              owner,
              agent: actor,
              proposal: record.proposal,
              ...(record.wireDigest ? { messageDigest: record.wireDigest } : {}),
              ...(record.transmission ? { status: record.transmission.status } : {}),
            },
            record.at,
          );
        },
      },
    };
    const executor = createExecutor(options);
    const state = createMemoryState();
    const gateway = createGateway({
      provider: "openai",
      model: "fixture",
      maxTokens: 100,
      tokens: {
        read: async () => {
          throw new Error("No model network in fixtures");
        },
      },
      account: "fixture",
    });
    let proposed = false;
    const daemonOptions: DaemonOptions = {
      workspace,
      accounts: [{ id: "fixture", binding: direct, category: "chat", enabled: true }],
      notifications: {
        subscribe: async () => {
          throw new Error("Fixture uses polling");
        },
        plan: () => ({ channel: "poll", reason: "fixture" }),
      },
      executor,
      lease: state.lease,
      checkpoints: state.checkpoints,
      gateway: {
        reader: gateway.reader,
        proposer: {
          propose: async () => {
            const proposals = proposed ? [] : [proposal];
            proposed = true;
            return { proposals, calls: [] };
          },
        },
      },
      ownerWebId: owner,
      agentWebId: actor,
      audit: writer,
      now: () => Date.parse(at),
      isFlagged: async () => false,
      proposalWritten: async () => {
        stores.entries.set(proposal.id, entry);
      },
      proposerContext: {
        instructions: "Synthetic test",
        memoryRecall: async () => [],
        pod: { root, webId: owner, read: vi.fn(), list: vi.fn(), write: vi.fn(), delete: vi.fn() },
      },
    };
    await createDaemon(daemonOptions).once();
    expect(stores.dispositions.get(proposal.id)?.status).toBe("awaiting-approval");
    const inbox = `${root}agent/inbox/direct/fixture/alb-${Buffer.from("urn:message:seed").toString("base64url")}.ttl`;
    expect((await io(inbox)).status).toBe(200);
    expect([401, 403]).toContain((await transport(inbox)).status);
    const approval = await issueApproval(
      {
        id: approvalUrl,
        approves: proposal.id,
        termsDigest: proposal.intent.termsDigest,
        expires: until,
        decision: "approve",
      },
      key,
      new Date(at),
    );
    expect(
      (
        await io(approvalUrl, {
          method: "PUT",
          headers: { "content-type": "application/trig" },
          body: approval,
        })
      ).ok,
    ).toBe(true);
    await createDaemon(daemonOptions).once();
    expect(transmit).toHaveBeenCalledOnce();
    expect(stores.records.get(proposal.id)?.status).toBe("sent");
    expect(ledger.entries().some((e) => e.record.type === "transmission")).toBe(true);
    expect((await io(`${root}agent/audit/chain.ttl`)).ok).toBe(true);
    const claims: ControlStatement = {
      type: "control-statement",
      id: controlUrl,
      kind: "Halt",
      attributedTo: owner,
      createdAt: at,
      expires: until,
    };
    const proof = await new DataIntegritySuite("ecdsa-rdfc-2019").sign([...toRdf(claims)], {
      key,
      proofPurpose: "assertionMethod",
      created: new Date(at),
    });
    const signed = { ...claims, proof: JSON.parse(canonicalJson(proof)) };
    await io(controlUrl, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await recordToTurtle(signed),
    });
    stores.dispositions.clear();
    stores.records.clear();
    stores.ledger.splice(0);
    await createDaemon(daemonOptions).once();
    expect(stores.dispositions.get(proposal.id)).toEqual({ status: "refused", reason: "halted" });
    expect(transmit).toHaveBeenCalledOnce();
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
