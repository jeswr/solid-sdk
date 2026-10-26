// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// AUTHORED-BY Codex GPT-6
/**
 * The GOLDEN-MASTER end-to-end flow over doubled I/O (an in-memory pod + a mock Gmail):
 * untrusted email → Reader → owner-private pod → deterministic Actor proposal → ODRL-mandate-
 * enforcing outbox executor. It proves the load-bearing security invariants:
 *  - the whole deterministic flow runs with ZERO LLM tokens (no interpreter/model configured);
 *  - AUTONOMOUS send only under an owner-signed permit; DENY-BY-DEFAULT otherwise;
 *  - a TAMPERED / wrong-issuer mandate ⇒ the executor refuses ALL actions (fail-closed);
 *  - an intent that LOOKS permitted but misses a constraint is denied autonomy;
 *  - an explicit PROHIBITION is never sent (even confirmed);
 *  - every container is owner-only ACL-first;
 *  - at-most-once send (a re-run never double-sends).
 */
import { vocab } from "@jeswr/agentic-legacy-bridge";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { runActorOnce } from "./actor/run.js";
import { defaultAutonomyPolicy, withAutonomousScheduling } from "./mandate/default-mandate.js";
import type { LoadedMandate, MandateVerifier } from "./mandate/types.js";
import { confirmProposal } from "./outbox/confirm.js";
import { ReceiptPersistenceError, runOutboxOnce } from "./outbox/executor.js";
import { RecordingSender } from "./outbox/sender.js";
import { writeConfirmation } from "./pod/confirmation-store.js";
import { createProposal, listProposals } from "./pod/proposal-store.js";
import { type ActionProposal, proposalUrl, serializeProposal } from "./pod/proposals.js";
import { putResource } from "./pod/write.js";
import { GmailChannelAdapter } from "./reader/gmail.js";
import { runReader } from "./reader/run.js";
import { AGENTIC_PURPOSE_GENERAL, AGENTIC_PURPOSE_SCHEDULING } from "./vocab.js";

const { namedNode, quad } = DataFactory;

const OWNER = "https://jeswr.org/#me";
const AGENT = "https://jeswr.org/agent#it";
const POD = "https://pod.example/agent/";
const INBOX = `${POD}inbox/`;
const PROPOSALS = `${POD}proposals/`;
const CONFIRMATIONS = `${POD}confirmations/`;
const OUTBOX = `${POD}outbox/`;
const MANDATE_ID = `${POD}mandate#it`;
const FIXED = new Date("2026-07-06T10:00:00Z");

const EVENT_EMAIL = [
  "From: Alice <alice@example.com>",
  "To: me@example.com",
  "Subject: Meeting time?",
  "Date: Mon, 06 Jul 2026 09:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<html><body><p>Can we meet?</p><script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Call: Jesse / Alice","startTime":"2026-07-07T14:00:00Z","endTime":"2026-07-07T14:30:00Z"}</script></body></html>',
  "",
].join("\r\n");

// --- doubled I/O: an in-memory Solid pod --------------------------------------------------

class MemoryPod {
  readonly store = new Map<string, { body: string; contentType: string; etag: string }>();
  readonly writeOrder: string[] = [];
  private etagN = 0;

  readonly fetch = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
    if (method === "GET") {
      if (url.endsWith("/")) return this.containerListing(url);
      const rec = this.store.get(url);
      if (!rec) return new Response(null, { status: 404 });
      return new Response(rec.body, {
        status: 200,
        headers: { "content-type": rec.contentType, etag: rec.etag },
      });
    }
    if (method === "PUT") {
      const ifNoneMatch = headers.get("if-none-match");
      const ifMatch = headers.get("if-match");
      const existing = this.store.get(url);
      if (ifNoneMatch === "*" && existing) return new Response(null, { status: 412 });
      if (ifMatch && (!existing || existing.etag !== ifMatch)) {
        return new Response(null, { status: 412 });
      }
      const body = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      const contentType = headers.get("content-type") ?? "text/turtle";
      const etag = `"e${++this.etagN}"`;
      this.store.set(url, { body, contentType, etag });
      this.writeOrder.push(url);
      return new Response(null, { status: existing ? 204 : 201, headers: { etag } });
    }
    return new Response(null, { status: 405 });
  }) as typeof fetch;

  private async containerListing(container: string): Promise<Response> {
    const writer = new Writer({ format: "text/turtle" });
    const node = namedNode(container);
    writer.addQuad(quad(node, namedNode(vocab.RDF_TYPE), namedNode(`${vocab.LDP}Container`)));
    writer.addQuad(quad(node, namedNode(vocab.RDF_TYPE), namedNode(`${vocab.LDP}BasicContainer`)));
    for (const key of this.store.keys()) {
      if (!key.startsWith(container) || key === container) continue;
      const rest = key.slice(container.length);
      if (rest.length === 0 || rest.includes("/") || rest.endsWith(".acl")) continue;
      writer.addQuad(quad(node, namedNode(vocab.LDP_CONTAINS), namedNode(key)));
    }
    const body = await new Promise<string>((resolve, reject) => {
      writer.end((err, result) => (err ? reject(err) : resolve(result)));
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/turtle" } });
  }
}

function mockGmailFetch(rawEmail: string): typeof fetch {
  return (async (input: string | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/messages?")) {
      return new Response(JSON.stringify({ messages: [{ id: "m1" }] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ raw: Buffer.from(rawEmail, "utf8").toString("base64url") }),
      { status: 200 },
    );
  }) as typeof fetch;
}

function scriptedVerifier(policy: OdrlPolicy, issuer: string = OWNER): MandateVerifier {
  return {
    load: async (): Promise<LoadedMandate> => ({ policy, issuer, credentialId: MANDATE_ID }),
  };
}

const REFUSING_VERIFIER: MandateVerifier = { load: async () => undefined };

async function seededPod(calibration?: string): Promise<{
  pod: MemoryPod;
  written: number;
  interpretations: number;
  proposalsCreated: number;
}> {
  const pod = new MemoryPod();
  const adapter = new GmailChannelAdapter({
    token: () => "read-token",
    fetch: mockGmailFetch(EVENT_EMAIL),
  });
  const reader = await runReader({
    adapter,
    writeFetch: pod.fetch,
    inbox: INBOX,
    ownerWebId: OWNER,
    interpretingAgentWebId: AGENT,
    now: FIXED,
  });
  if (calibration) {
    for (const [url, resource] of pod.store) {
      if (url.startsWith(INBOX) && url.endsWith(".ttl")) {
        const dataset = await parseRdf(resource.body, "text/turtle", { baseIRI: url });
        const writer = new Writer({ format: "text/turtle" });
        writer.addQuads(
          [...dataset].map((q) =>
            q.object.value === vocab.AGENTIC_CALIBRATED
              ? quad(q.subject, q.predicate, namedNode(calibration), q.graph)
              : q,
          ),
        );
        resource.body = await new Promise<string>((resolve, reject) => {
          writer.end((error, body) => (error ? reject(error) : resolve(body)));
        });
      }
    }
  }
  const actor = await runActorOnce({
    readFetch: pod.fetch,
    writeFetch: pod.fetch,
    inbox: INBOX,
    proposals: PROPOSALS,
    ownerWebId: OWNER,
    now: () => FIXED,
  });
  return {
    pod,
    written: reader.written,
    interpretations: reader.interpretations,
    proposalsCreated: actor.proposalsCreated,
  };
}

function outboxConfig(pod: MemoryPod, verifier: MandateVerifier, recorder: RecordingSender) {
  return {
    readFetch: pod.fetch,
    writeFetch: pod.fetch,
    proposals: PROPOSALS,
    confirmations: CONFIRMATIONS,
    inbox: INBOX,
    outbox: OUTBOX,
    ownerWebId: OWNER,
    verifier,
    senders: { email: recorder.send },
    agentWebId: AGENT,
    now: () => FIXED,
  };
}

function receiptBody(pod: MemoryPod): string | undefined {
  const key = [...pod.store.keys()].find(
    (k) => k.startsWith(OUTBOX) && k.endsWith(".ttl") && !k.endsWith(".acl"),
  );
  return key ? pod.store.get(key)?.body : undefined;
}

async function rewriteReader(pod: MemoryPod, change: (store: Store) => void) {
  for (const [url, resource] of pod.store) {
    if (!url.startsWith(INBOX) || !url.endsWith(".ttl") || url.endsWith(".chat.ttl")) continue;
    const store = new Store([...(await parseRdf(resource.body, "text/turtle", { baseIRI: url }))]);
    change(store);
    const writer = new Writer({ format: "text/turtle" });
    writer.addQuads([...store]);
    resource.body = await new Promise<string>((resolve, reject) => {
      writer.end((error, body) => (error ? reject(error) : resolve(body)));
    });
  }
}

async function replaceProposal(pod: MemoryPod, proposal: ActionProposal) {
  const url = proposalUrl(PROPOSALS, proposal.id) as string;
  await putResource(pod.fetch, url, await serializeProposal(proposal, { resourceUrl: url }), {
    contentType: "text/turtle",
    base: PROPOSALS,
  });
}

const loosePolicy = withAutonomousScheduling(
  defaultAutonomyPolicy({ ownerWebId: OWNER, agentWebId: AGENT }),
);
const defaultPolicy = defaultAutonomyPolicy({ ownerWebId: OWNER, agentWebId: AGENT });

describe("personal-agent end-to-end (Reader → Actor → ODRL-enforced outbox)", () => {
  it.each([
    false,
    undefined,
  ])("cannot erase Reader confirmation requirements with Actor flag %s", async (confirmationRequired) => {
    const { pod } = await seededPod(vocab.AGENTIC_SELF_REPORTED);
    const loaded = (await listProposals(pod.fetch, PROPOSALS))[0];
    if (!loaded) throw new Error("missing proposal");
    await replaceProposal(pod, {
      ...loaded.proposal,
      confirmationRequired,
      status: "confirmed",
      friction: "low",
    });
    const recorder = new RecordingSender(() => FIXED);
    const result = await runOutboxOnce(outboxConfig(pod, scriptedVerifier(loosePolicy), recorder));
    expect(result.queuedForConfirmation).toBe(1);
    expect(recorder.sent).toHaveLength(0);
  });

  it.each([
    "self-reported",
    "security-bearing",
    "missing-calibration",
    "missing-confidence",
    "missing-link",
    "ambiguous-calibration",
    "missing-records",
    "duplicate-security-bearing",
    "duplicate-low-confidence",
    "ambiguous-object",
  ])("rechecks %s Reader provenance changed after Actor derivation", async (change) => {
    const { pod } = await seededPod();
    await rewriteReader(pod, (store) => {
      const records = [
        ...store.match(null, namedNode(vocab.RDF_TYPE), namedNode(vocab.AGENTIC_INTERPRETATION)),
      ].map((q) => q.subject);
      for (const subject of records) {
        const node = namedNode(subject.value);
        if (change === "duplicate-security-bearing" || change === "duplicate-low-confidence") {
          const duplicate = namedNode(`${node.value}-second-assessment`);
          for (const q of store.match(node, null, null))
            store.addQuad(duplicate, q.predicate, q.object);
          if (change === "duplicate-security-bearing")
            store.addQuad(
              duplicate,
              namedNode(vocab.AGENTIC_SECURITY_BEARING),
              DataFactory.literal("true", namedNode(`${vocab.XSD}boolean`)),
            );
          else {
            store.removeQuads([
              ...store.match(duplicate, namedNode(vocab.AGENTIC_CONFIDENCE), null),
            ]);
            store.addQuad(
              duplicate,
              namedNode(vocab.AGENTIC_CONFIDENCE),
              DataFactory.literal("0.1"),
            );
          }
          continue;
        }
        if (change === "ambiguous-object") {
          store.addQuad(
            node,
            namedNode(vocab.AGENTIC_ASSERTS_OBJECT_IRI),
            namedNode("urn:ambiguous"),
          );
          continue;
        }
        if (change === "security-bearing")
          store.addQuad(
            node,
            namedNode(vocab.AGENTIC_SECURITY_BEARING),
            DataFactory.literal("true", namedNode(`${vocab.XSD}boolean`)),
          );
        else if (change === "missing-records")
          store.removeQuads([...store.match(node, null, null)]);
        else {
          const predicate =
            change === "missing-confidence"
              ? vocab.AGENTIC_CONFIDENCE
              : change === "missing-link"
                ? vocab.PROV_WAS_DERIVED_FROM
                : vocab.AGENTIC_CALIBRATION;
          if (change !== "ambiguous-calibration")
            store.removeQuads([...store.match(node, namedNode(predicate), null)]);
          if (change === "self-reported" || change === "ambiguous-calibration")
            store.addQuad(
              node,
              namedNode(vocab.AGENTIC_CALIBRATION),
              namedNode(vocab.AGENTIC_SELF_REPORTED),
            );
        }
      }
    });
    const recorder = new RecordingSender(() => FIXED);
    const config = outboxConfig(pod, scriptedVerifier(loosePolicy), recorder);
    expect((await runOutboxOnce(config)).queuedForConfirmation).toBe(1);
    expect(recorder.sent).toHaveLength(0);
    const loaded = (await listProposals(pod.fetch, PROPOSALS))[0];
    if (!loaded) throw new Error("missing proposal");
    await writeConfirmation(
      pod.fetch,
      CONFIRMATIONS,
      OWNER,
      confirmProposal(loaded.proposal, {
        typedAcknowledgement: loaded.proposal.recipient,
        confirmedAt: FIXED.toISOString(),
      }),
    );
    expect((await runOutboxOnce(config)).sent).toBe(1);
  });

  it.each([
    ["2026-07-07T14:00:00.000Z", true],
    ["2026-07-07T16:00:00+02:00", true],
    ["2026-07-07T09:00:00-05:00", true],
    ["2026-07-07T14:00:00.001Z", false],
    ["invalid", false],
  ] as const)("rechecks duplicate assessment time %s using persistence normalization", async (time, requiresConfirmation) => {
    const { pod } = await seededPod();
    await rewriteReader(pod, (store) => {
      const assertion = [
        ...store.match(
          null,
          namedNode(vocab.AGENTIC_ASSERTS_PREDICATE),
          namedNode(vocab.SCHEMA_START_TIME),
        ),
      ][0];
      if (!assertion) throw new Error("missing start-time assessment");
      const node = namedNode(assertion.subject.value);
      const duplicate = namedNode(`${node.value}-second-assessment`);
      for (const q of store.match(node, null, null)) {
        const value =
          q.predicate.value === vocab.AGENTIC_CONFIDENCE
            ? DataFactory.literal("0.1")
            : q.predicate.value === vocab.AGENTIC_ASSERTS_OBJECT
              ? DataFactory.literal(time)
              : q.object;
        store.addQuad(duplicate, q.predicate, value);
      }
    });
    const recorder = new RecordingSender(() => FIXED);
    const result = await runOutboxOnce(outboxConfig(pod, scriptedVerifier(loosePolicy), recorder));
    expect(result.queuedForConfirmation).toBe(requiresConfirmation ? 1 : 0);
    expect(recorder.sent).toHaveLength(requiresConfirmation ? 0 : 1);
  });

  it.each([
    "absent-inbox",
    "overlapping-inbox",
    "missing-graph",
    "redirect",
    "unavailable",
    "wrong-format",
    "duplicate-anchor",
  ])("requires confirmation for %s provenance", async (failure) => {
    const { pod } = await seededPod();
    const recorder = new RecordingSender(() => FIXED);
    const config = outboxConfig(pod, scriptedVerifier(loosePolicy), recorder);
    if (failure === "missing-graph")
      for (const url of pod.store.keys()) {
        if (url.startsWith(INBOX)) pod.store.delete(url);
      }
    if (failure === "duplicate-anchor") {
      const graph = [...pod.store].find(
        ([url]) => url.startsWith(INBOX) && url.endsWith(".ttl") && !url.endsWith(".chat.ttl"),
      );
      if (!graph) throw new Error("missing graph");
      pod.store.set(`${INBOX}duplicate.ttl`, { ...graph[1] });
    }
    const readFetch = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).startsWith(INBOX)) {
        if (failure === "redirect")
          return new Response(null, { status: 302, headers: { location: `${PROPOSALS}fake.ttl` } });
        if (failure === "unavailable") throw new Error("offline");
        if (failure === "wrong-format")
          return new Response("{}", { headers: { "content-type": "application/ld+json" } });
      }
      return pod.fetch(input, init);
    });
    const result = await runOutboxOnce({
      ...config,
      readFetch,
      inbox:
        failure === "absent-inbox"
          ? undefined
          : failure === "overlapping-inbox"
            ? PROPOSALS
            : INBOX,
    });
    expect(result.queuedForConfirmation).toBe(1);
    expect(recorder.sent).toHaveLength(0);
    expect(readFetch.mock.calls.every(([, init]) => init?.redirect !== "follow")).toBe(true);
  });

  it.each([
    { recipient: "mallory@example.com" },
    { bodyText: "invented content" },
    { offeredTimes: [{ startTime: "2026-07-09T14:00:00Z" }] },
    { inReplyTo: "urn:agentic:raw:forged" },
    { derivedFrom: `${PROPOSALS}fake.ttl` },
    { derivedFrom: "https://evil.example/fake.ttl", inReplyTo: "https://evil.example/fake.ttl" },
    { derivedFrom: undefined },
    { purpose: AGENTIC_PURPOSE_GENERAL },
    { spend: 1 },
  ])("cannot bless Actor-controlled send fields with unrelated calibrated provenance: %j", async (change) => {
    const { pod } = await seededPod();
    const loaded = (await listProposals(pod.fetch, PROPOSALS))[0];
    if (!loaded) throw new Error("missing proposal");
    await replaceProposal(pod, { ...loaded.proposal, ...change });
    const recorder = new RecordingSender(() => FIXED);
    // Broad permission proves provenance validation, rather than a mandate constraint, blocks this.
    const broad: OdrlPolicy = {
      ...defaultPolicy,
      permissions: [{ type: "permission", action: "distribute", assignee: AGENT }],
    };
    const readFetch = vi.fn(pod.fetch);
    expect(
      (await runOutboxOnce({ ...outboxConfig(pod, scriptedVerifier(broad), recorder), readFetch }))
        .queuedForConfirmation,
    ).toBe(1);
    expect(recorder.sent).toHaveLength(0);
    expect(readFetch.mock.calls.every(([url]) => String(url).startsWith(POD))).toBe(true);
  });

  it("allows the Actor flag only to add confirmation to calibrated Reader provenance", async () => {
    const { pod } = await seededPod();
    const loaded = (await listProposals(pod.fetch, PROPOSALS))[0];
    if (!loaded) throw new Error("missing proposal");
    await replaceProposal(pod, { ...loaded.proposal, confirmationRequired: true });
    const recorder = new RecordingSender(() => FIXED);
    expect(
      (await runOutboxOnce(outboxConfig(pod, scriptedVerifier(loosePolicy), recorder)))
        .queuedForConfirmation,
    ).toBe(1);
    expect(recorder.sent).toHaveLength(0);
  });

  it("preserves self-reported calibration through storage and refuses autonomous execution", async () => {
    const { pod, proposalsCreated } = await seededPod(vocab.AGENTIC_SELF_REPORTED);
    expect(proposalsCreated).toBe(1);
    const loaded = (await listProposals(pod.fetch, PROPOSALS))[0];
    expect(loaded?.proposal.confirmationRequired).toBe(true);
    if (!loaded) throw new Error("missing proposal");
    const recorder = new RecordingSender(() => FIXED);
    const config = outboxConfig(pod, scriptedVerifier(loosePolicy), recorder);
    const first = await runOutboxOnce(config);
    expect(first.sent).toBe(0);
    expect(first.queuedForConfirmation).toBe(1);
    expect(recorder.sent).toHaveLength(0);
    await writeConfirmation(
      pod.fetch,
      CONFIRMATIONS,
      OWNER,
      confirmProposal(loaded.proposal, {
        typedAcknowledgement: loaded.proposal.recipient,
        confirmedAt: FIXED.toISOString(),
      }),
    );
    const second = await runOutboxOnce(config);
    expect(second.sent).toBe(1);
    expect(receiptBody(pod)).toContain("authorizedByConfirmation");
    expect(receiptBody(pod)).not.toContain("authorizedByPermit");
  });

  it("rejects and audits a mislabelled send even after owner confirmation", async () => {
    const { pod } = await seededPod();
    const loaded = (await listProposals(pod.fetch, PROPOSALS))[0];
    expect(loaded).toBeDefined();
    if (!loaded) throw new Error("missing seeded proposal");
    const mislabelled = { ...loaded.proposal, odrlAction: "read" as const };
    await putResource(
      pod.fetch,
      loaded.url,
      await serializeProposal(mislabelled, {
        resourceUrl: loaded.url,
      }),
      { contentType: "text/turtle", base: PROPOSALS },
    );
    await writeConfirmation(
      pod.fetch,
      CONFIRMATIONS,
      OWNER,
      confirmProposal(mislabelled, {
        typedAcknowledgement: mislabelled.recipient,
        confirmedAt: FIXED.toISOString(),
      }),
    );
    const recorder = new RecordingSender(() => FIXED);
    const readOnly: OdrlPolicy = {
      ...defaultPolicy,
      permissions: [{ type: "permission", action: "read", assigner: OWNER, assignee: AGENT }],
    };
    const result = await runOutboxOnce(outboxConfig(pod, scriptedVerifier(readOnly), recorder));
    expect(result.prohibited).toBe(1);
    expect(result.sent).toBe(0);
    expect(recorder.sent).toHaveLength(0);
    expect(receiptBody(pod)).toContain('"rejected"');
    expect(receiptBody(pod)).toContain("action mismatch");
    expect(receiptBody(pod)).toContain("requires distribute");
  });

  it("Reader lands the email owner-private and the deterministic Actor proposes a scheduling reply", async () => {
    const { pod, written, interpretations, proposalsCreated } = await seededPod();
    expect(written).toBe(1);
    expect(interpretations).toBeGreaterThan(0);
    expect(proposalsCreated).toBe(1);

    const proposals = await listProposals(pod.fetch, PROPOSALS);
    expect(proposals.length).toBe(1);
    const proposal = proposals[0]?.proposal;
    expect(proposal?.recipient).toBe("alice@example.com");
    expect(proposal?.odrlAction).toBe("distribute");
    expect(proposal?.purpose).toBe(AGENTIC_PURPOSE_SCHEDULING);
    expect(proposal?.status).toBe("pending");
    expect(proposal?.offeredTimes?.some((t) => t.startTime.includes("2026-07-07T14:00:00"))).toBe(
      true,
    );
  });

  it("AUTONOMOUS: under the loosened mandate the executor sends and audits it with PROV", async () => {
    const { pod } = await seededPod();
    const recorder = new RecordingSender(() => FIXED);
    const result = await runOutboxOnce(outboxConfig(pod, scriptedVerifier(loosePolicy), recorder));
    expect(result.mandateLoaded).toBe(true);
    expect(result.sent).toBe(1);
    expect(recorder.sent.length).toBe(1);
    expect(recorder.sent[0]?.to).toBe("alice@example.com");
    expect(recorder.sent[0]?.textBody).toContain("2026-07-07T14:00:00");

    // The outcome lives in the Actor-UNwritable outbox receipt (not the proposal status).
    const receipt = receiptBody(pod);
    expect(receipt).toBeDefined();
    expect(receipt).toContain("underMandate");
    expect(receipt).toContain("authorizedByPermit");
    expect(receipt).toContain('"sent"');

    // At-most-once: a re-run never double-sends (the receipt already exists).
    const rerun = await runOutboxOnce(outboxConfig(pod, scriptedVerifier(loosePolicy), recorder));
    expect(rerun.sent).toBe(0);
    expect(recorder.sent.length).toBe(1);
  });

  it.each([
    "http",
    "network",
  ])("reports %s receipt persistence failure without losing the send result", async (failure) => {
    const { pod } = await seededPod();
    const recorder = new RecordingSender(() => FIXED);
    const config = outboxConfig(pod, scriptedVerifier(loosePolicy), recorder);
    const finalizations: string[] = [];
    const writeFetch: typeof fetch = async (input, init) => {
      if (
        String(input).startsWith(OUTBOX) &&
        String(input).endsWith(".ttl") &&
        init?.method === "PUT" &&
        !new Headers(init.headers).has("if-none-match")
      ) {
        finalizations.push(String(init.body));
        if (failure === "network") throw new Error("synthetic write failure");
        return new Response(null, { status: 503 });
      }
      return pod.fetch(input, init);
    };
    const error = await runOutboxOnce({ ...config, writeFetch }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ReceiptPersistenceError);
    expect(error).toMatchObject({
      proposalId: (await listProposals(pod.fetch, PROPOSALS))[0]?.proposal.id,
      receipt: { channelMessageId: "recorded-1", sentAt: FIXED.toISOString() },
      cause: expect.any(Error),
    });
    expect(recorder.sent).toHaveLength(1);
    expect(finalizations).toHaveLength(1);
    expect(finalizations[0]).toContain('"sent"');
    expect(finalizations[0]).toContain("recorded-1");
    expect(receiptBody(pod)).toContain('"claimed"');
    expect(receiptBody(pod)).not.toContain('"failed"');
    expect(await runOutboxOnce(config)).toMatchObject({ sent: 0, failed: 0, skipped: 1 });
    expect(recorder.sent).toHaveLength(1);
  });

  it("records a transmission failure as failed after the claim", async () => {
    const { pod } = await seededPod();
    const config = outboxConfig(
      pod,
      scriptedVerifier(loosePolicy),
      new RecordingSender(() => FIXED),
    );
    const send = vi.fn(async () => {
      throw new Error("synthetic transport failure");
    });
    expect(await runOutboxOnce({ ...config, senders: { email: send } })).toMatchObject({
      sent: 0,
      failed: 1,
    });
    expect(receiptBody(pod)).toContain('"failed"');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("FAIL-CLOSED: a tampered / unverifiable mandate makes the executor refuse ALL actions", async () => {
    const { pod } = await seededPod();
    const recorder = new RecordingSender(() => FIXED);
    const result = await runOutboxOnce(outboxConfig(pod, REFUSING_VERIFIER, recorder));
    expect(result.mandateLoaded).toBe(false);
    expect(result.sent).toBe(0);
    expect(recorder.sent.length).toBe(0);
    expect((await listProposals(pod.fetch, PROPOSALS))[0]?.proposal.status).toBe("pending");
  });

  it("FAIL-CLOSED: a mandate not issued by the owner is refused", async () => {
    const { pod } = await seededPod();
    const recorder = new RecordingSender(() => FIXED);
    const wrongIssuer = scriptedVerifier(loosePolicy, "https://attacker.example/#me");
    const result = await runOutboxOnce(outboxConfig(pod, wrongIssuer, recorder));
    expect(result.mandateLoaded).toBe(false);
    expect(recorder.sent.length).toBe(0);
  });

  it("DENY-BY-DEFAULT: the safe default mandate queues the send until the owner confirms", async () => {
    const { pod } = await seededPod();
    const recorder = new RecordingSender(() => FIXED);
    const verifier = scriptedVerifier(defaultPolicy);

    const first = await runOutboxOnce(outboxConfig(pod, verifier, recorder));
    expect(first.sent).toBe(0);
    expect(first.queuedForConfirmation).toBe(1);
    expect(recorder.sent.length).toBe(0);

    // The owner confirms — writing a content-locked confirmation into the OWNER-ONLY
    // confirmations container (NOT touching the Actor-writable proposal).
    const loaded = (await listProposals(pod.fetch, PROPOSALS))[0];
    expect(loaded).toBeDefined();
    if (!loaded) throw new Error("missing proposal");
    const confirmation = confirmProposal(loaded.proposal, {
      typedAcknowledgement: loaded.proposal.recipient,
      confirmedAt: FIXED.toISOString(),
    });
    await writeConfirmation(pod.fetch, CONFIRMATIONS, OWNER, confirmation);

    const second = await runOutboxOnce(outboxConfig(pod, verifier, recorder));
    expect(second.sent).toBe(1);
    expect(recorder.sent.length).toBe(1);
    expect(receiptBody(pod)).toContain("authorizedByConfirmation");
  });

  it("A FORGED confirmed-status proposal is NOT sent — the confirmation must be unforgeable", async () => {
    const { pod } = await seededPod();
    const recorder = new RecordingSender(() => FIXED);
    // Simulate a deceived Actor writing a proposal ALREADY marked "confirmed" into the
    // Actor-writable proposals container. Under the default (act-nothing) mandate this must
    // NOT be sent — the executor never trusts the proposal's own status, only a confirmation
    // in the owner-only confirmations container.
    const forged: ActionProposal = {
      id: "forged",
      channel: "email",
      recipient: "mallory@example.com",
      odrlAction: "distribute",
      purpose: AGENTIC_PURPOSE_GENERAL,
      spend: 0,
      status: "confirmed",
      friction: "low",
      bodyText: "forged send",
      inReplyTo: "urn:agentic:raw:forged",
      confirmedAt: FIXED.toISOString(),
      proposedAt: FIXED.toISOString(),
    };
    await createProposal(pod.fetch, PROPOSALS, OWNER, forged);
    const result = await runOutboxOnce(
      outboxConfig(pod, scriptedVerifier(defaultPolicy), recorder),
    );
    expect(result.sent).toBe(0);
    expect(recorder.sent.every((m) => m.to !== "mallory@example.com")).toBe(true);
  });

  it("A confirmation cannot be reused after the Actor swaps the proposal body (content-lock)", async () => {
    const { pod } = await seededPod();
    const recorder = new RecordingSender(() => FIXED);
    const loaded = (await listProposals(pod.fetch, PROPOSALS))[0];
    const original = loaded?.proposal as ActionProposal;
    // Owner confirms the ORIGINAL content.
    await writeConfirmation(
      pod.fetch,
      CONFIRMATIONS,
      OWNER,
      confirmProposal(original, {
        typedAcknowledgement: original.recipient,
        confirmedAt: FIXED.toISOString(),
      }),
    );
    // A deceived Actor then swaps the recipient (OVERWRITES the proposal resource — the MCP
    // write tool is a PUT, so it can rewrite an existing proposal).
    const swapped: ActionProposal = { ...original, recipient: "attacker@example.com" };
    const url = proposalUrl(PROPOSALS, original.id) as string;
    await putResource(pod.fetch, url, await serializeProposal(swapped, { resourceUrl: url }), {
      contentType: "text/turtle",
      base: PROPOSALS,
    });
    // The digest no longer matches → the swapped content is NOT sent under the default mandate.
    const result = await runOutboxOnce(
      outboxConfig(pod, scriptedVerifier(defaultPolicy), recorder),
    );
    expect(result.sent).toBe(0);
    expect(recorder.sent.every((m) => m.to !== "attacker@example.com")).toBe(true);
  });

  it("cannot reuse confirmation after the Actor swaps the provenance/mandate target", async () => {
    const { pod } = await seededPod();
    const loaded = (await listProposals(pod.fetch, PROPOSALS))[0];
    if (!loaded) throw new Error("missing proposal");
    const proposal = { ...loaded.proposal, inReplyTo: undefined };
    await writeConfirmation(
      pod.fetch,
      CONFIRMATIONS,
      OWNER,
      confirmProposal(proposal, {
        typedAcknowledgement: proposal.recipient,
        confirmedAt: FIXED.toISOString(),
      }),
    );
    await replaceProposal(pod, { ...proposal, derivedFrom: "urn:agentic:raw:substituted" });
    const recorder = new RecordingSender(() => FIXED);
    const result = await runOutboxOnce(
      outboxConfig(pod, scriptedVerifier(defaultPolicy), recorder),
    );
    expect(result.queuedForConfirmation).toBe(1);
    expect(recorder.sent).toHaveLength(0);
  });

  it("PROHIBITED: an explicit ODRL prohibition is never sent (marked rejected)", async () => {
    const { pod } = await seededPod();
    const recorder = new RecordingSender(() => FIXED);
    const prohibiting: OdrlPolicy = {
      ...defaultPolicy,
      prohibitions: [
        { type: "prohibition", action: "distribute", assigner: OWNER, assignee: AGENT },
      ],
    };
    const result = await runOutboxOnce(outboxConfig(pod, scriptedVerifier(prohibiting), recorder));
    expect(result.prohibited).toBe(1);
    expect(result.sent).toBe(0);
    expect(recorder.sent.length).toBe(0);
    // The prohibition is recorded as a terminal "rejected" receipt in the owner-only outbox.
    expect(receiptBody(pod)).toContain('"rejected"');
  });

  it("A LLM-crafted intent that LOOKS permitted but misses a constraint is denied autonomy", async () => {
    const { pod } = await seededPod();
    // A second proposal with the permitted ACTION (distribute) but a NON-permitted purpose.
    const crafted: ActionProposal = {
      id: "crafted-general",
      channel: "email",
      recipient: "bob@example.com",
      odrlAction: "distribute",
      purpose: AGENTIC_PURPOSE_GENERAL,
      spend: 0,
      status: "pending",
      friction: "low",
      bodyText: "unrelated send",
      inReplyTo: "urn:agentic:raw:crafted",
      proposedAt: FIXED.toISOString(),
    };
    await createProposal(pod.fetch, PROPOSALS, OWNER, crafted);

    const recorder = new RecordingSender(() => FIXED);
    const result = await runOutboxOnce(outboxConfig(pod, scriptedVerifier(loosePolicy), recorder));
    // The scheduling proposal is permitted and sent; the crafted one is queued, not sent.
    expect(result.sent).toBe(1);
    expect(result.queuedForConfirmation).toBe(1);
    expect(recorder.sent.every((m) => m.to !== "bob@example.com")).toBe(true);
  });

  it("ACL-FIRST INVARIANT: every container is owner-only ACL'd BEFORE its first content", async () => {
    const { pod } = await seededPod();
    await runOutboxOnce(
      outboxConfig(pod, scriptedVerifier(loosePolicy), new RecordingSender(() => FIXED)),
    );
    for (const container of [INBOX, PROPOSALS, OUTBOX]) {
      const aclIndex = pod.writeOrder.indexOf(`${container}.acl`);
      const firstChildIndex = pod.writeOrder.findIndex(
        (u) => u.startsWith(container) && u !== `${container}.acl` && !u.endsWith(".acl"),
      );
      expect(aclIndex).toBeGreaterThanOrEqual(0);
      expect(firstChildIndex).toBeGreaterThan(aclIndex);
    }
  });
});
