// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import type { Mandate, Rule } from "@jeswr/agent-mandate";
import { readApprovalClaims, verifyApproval } from "@jeswr/agent-mandate/approval";
import {
  defaultMandate,
  issueMandate,
  limitConstraint,
  mandateCredential,
  mandateToTurtle,
} from "@jeswr/agent-mandate/issue";
import * as mandateApi from "@jeswr/agent-mandate/verify";
import {
  AGENT,
  createVcMandateVerifier,
  evaluateIntent,
  parseMandateCredential,
} from "@jeswr/agent-mandate/verify";
import type { Account, ActionProposal, MandateReference } from "@jeswr/agent-model";
import { recordToTurtle } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import {
  type BitstringStatusListEntry,
  buildBitstringStatusListCredential,
  canonicalNQuads,
  createBitstringStatusResolver,
  createWebIdKeyResolver,
  credentialToRdf,
  DataIntegritySuite,
  digestQuads,
  issue,
  type KeyPair,
  parseStatusListCredential,
  readStatusBit,
  statusListCredentialToTurtle,
  type VerifiableCredential,
} from "@jeswr/solid-vc";
import { DataFactory, Store } from "n3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountSettingsQueue,
  persistAccountPatch,
  readAccountSettings,
} from "../src/apps/agent/lib/accounts";
import { type AgentClient, createAgentClient } from "../src/apps/agent/lib/client";
import {
  demoAccountHash,
  demoApprovalDocument,
  demoMandateFiles,
  withDemoAgentKey,
} from "../src/apps/agent/lib/demo-mandate";
import { revocationImpact } from "../src/apps/agent/lib/key-admin";
import { ApprovalKeyStore, setupApprovalKey } from "../src/apps/agent/lib/keys";
import {
  allowSimilar,
  buildEditorMandate,
  canAllowSimilar,
  DAY,
  describeMandate,
  type EditorValues,
  editorDefaults,
  editorSchema,
  mandateBoundaries,
  mandateNamesBinding,
  proposalBadge,
  proposalIntent,
  replyTemplate,
  testsTemplate,
} from "../src/apps/agent/lib/mandate-rules";
import {
  activateMandate,
  loadVerifiedMandate,
  mandateHistory,
  nextStatusIndex,
  PendingRevocation,
  previewMandate,
  readAgentIdentity,
  readMandateCredentials,
  revokeMandate,
  statusIndex,
} from "../src/apps/agent/lib/mandates";
import { metadataNode, RDF } from "../src/apps/agent/lib/paths";
import {
  loadedRecords,
  readControl,
  readDescriptors,
  readMandateCurrent,
} from "../src/apps/agent/lib/readers";
import { createAgentSigner } from "../src/apps/agent/lib/sign";
import { createAgentVerifier } from "../src/apps/agent/lib/verify";
import { createDemoPod, type DemoSeedFile } from "../src/lib/demo-pod/pod";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
const NOW = new Date("2026-11-01T12:00:00.000Z");
const ROOT = "https://alice.demo.pod/";
const OWNER = `${ROOT}profile/card#me`;
const BASE = `${ROOT}agent/`;
const AGENT_ID = `${BASE}card#agent`;
const HASH = `sha256:${"1".repeat(64)}`;
const OTHER_HASH = `sha256:${"2".repeat(64)}`;
const at = (path: string) => `${BASE}${path}`;
const options = (id = at("mandates/test.trig")) => ({
  id,
  ownerWebId: OWNER,
  agentWebId: AGENT_ID,
  recipientHashes: [HASH],
  now: NOW,
});
const mandate = (id?: string) => defaultMandate(options(id));
const values = (changes: Partial<EditorValues> = {}): EditorValues => ({
  ...editorDefaults(NOW),
  bindings: ["gmail"],
  recipients: [HASH],
  ...changes,
});
const proposal = (changes: Partial<ActionProposal["intent"]> = {}): ActionProposal => ({
  ...exampleRecords["action-proposal"],
  id: at("proposals/reply.ttl"),
  validUntil: new Date(NOW.getTime() + DAY).toISOString(),
  intent: {
    ...exampleRecords["action-proposal"].intent,
    action: `${AGENT}SendMessage`,
    binding: "gmail",
    recipientHash: HASH,
    amount: { value: 0, currency: "GBP" },
    ...changes,
  },
});
const account = (hash: string, label?: string): Account => ({
  ...exampleRecords.account,
  provider: "gmail",
  channelHandleHash: hash,
  label,
});
const permission = (action: string, constraints?: Rule["constraints"]): Rule => ({
  type: "permission",
  action: `${AGENT}${action}`,
  ...(constraints ? { constraints } : {}),
});

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());
  vi.stubGlobal("indexedDB", new IDBFactory());
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function introduction(
  path = "agent/descriptors/agent.ttl",
  identities: readonly string[] = [AGENT_ID],
): Promise<DemoSeedFile> {
  const store = new Store();
  const node = metadataNode(store, new URL(path, ROOT).href);
  node.setIri(`${RDF}type`, `${AGENT}ImplementationDescription`);
  for (const identity of identities) node.iris(`${AGENT}describes`).add(identity);
  return { path, body: await serialize([...store]), contentType: "text/turtle" };
}
async function profileFile(): Promise<DemoSeedFile> {
  const store = new Store();
  metadataNode(store, OWNER).setIri(`${RDF}type`, "http://xmlns.com/foaf/0.1/Person");
  return { path: "profile/card", body: await serialize([...store]), contentType: "text/turtle" };
}
const clientFor = (fetch: typeof globalThis.fetch): AgentClient =>
  createAgentClient({ fetch, storage: ROOT, workspace: BASE });
async function fixture(key = true, identity = true) {
  const pod = createDemoPod({
    root: ROOT,
    now: () => NOW.getTime(),
    seed: [await profileFile(), ...(identity ? [await introduction()] : [])],
  });
  const session = { fetch: pod.fetch, webId: OWNER };
  if (key) await setupApprovalKey(session);
  return { pod, session, client: clientFor(pod.fetch) };
}
async function getKey(): Promise<KeyPair> {
  const key = await new ApprovalKeyStore().get(localStorage.getItem("agent.approvalKey") ?? "");
  if (!key) throw new Error("Missing fixture key");
  return key;
}
async function replace(client: AgentClient, url: string, body: string, type = "text/turtle") {
  const { etag } = await client.graph(url);
  if (!etag) throw new Error("Missing fixture validator");
  return client.replace(url, body, etag, type);
}
async function signedCredential(m: Mandate, index = "0") {
  return issueMandate(
    m,
    await getKey(),
    { statusListCredential: at("mandates/status.ttl"), statusListIndex: index },
    { cryptosuite: "ecdsa-rdfc-2019" },
  );
}
async function expectSameMandate(actual: Mandate | undefined, expected: Mandate) {
  expect(actual).toBeDefined();
  if (!actual) throw new Error("Missing verified mandate");
  const status = { statusListCredential: at("mandates/status.ttl"), statusListIndex: "0" };
  expect(await canonicalNQuads(credentialToRdf(mandateCredential(actual, status)))).toBe(
    await canonicalNQuads(credentialToRdf(mandateCredential(expected, status))),
  );
}
async function pointer(client: AgentClient, vc: VerifiableCredential) {
  const record: MandateReference = {
    type: "mandate-reference",
    id: client.paths.mandatesCurrent,
    credential: vc.id as string,
    credentialStatus: client.paths.mandatesStatus,
    digest: await digestQuads(credentialToRdf(vc)),
    validFrom: vc.validFrom as string,
    validUntil: vc.validUntil as string,
  };
  return record;
}

describe("plain-language mandate rules", () => {
  it("reports only probed authority for actual own accounts", async () => {
    const lines = await describeMandate(mandate(), [account(HASH, "Personal email")], "GBP", NOW);
    expect(lines).toContain("Asks you first: send messages for Personal email on gmail");
    expect(lines).toContain("Never: move money for Personal email on gmail (at zero cost)");
    expect(lines).toContain("Never: sign documents for Personal email on gmail (at zero cost)");
    expect(lines).toContain("Valid until 01/12/2026");
    expect(lines.some((line) => line.startsWith("May"))).toBe(false);
    expect(lines.join(" ")).not.toContain(HASH);
    expect(lines.join(" ")).not.toContain(AGENT_ID);
  });
  it("describes accounting metadata, unknown actions and unprobed contexts conservatively", async () => {
    const m: Mandate = {
      ...mandate(),
      autonomous: { id: "urn:auto", permissions: [permission("Unfamiliar")] },
      limits: [
        limitConstraint(`${AGENT}spendPerDay`, 12.5, "hard"),
        limitConstraint(`${AGENT}sendsPerDay`, 10, "hard"),
        limitConstraint(`${AGENT}perRecipientPerDay`, 3, "hard"),
        limitConstraint(`${AGENT}spendPerWeek`, 20, "soft"),
      ],
      currency: "GBP",
    };
    const lines = await describeMandate(m, [], "USD", NOW);
    expect(lines).toContain("Asks you first: another action");
    expect(lines).toContain("Asks you first: send messages");
    expect(lines).toContain("Daily limit: £12.50");
    expect(lines).toContain("Daily send limit: 10");
    expect(lines).toContain("Contact the same person at most 3 times a day");
    expect(await describeMandate({ ...m, currency: "USD" }, [], "GBP", NOW)).toContain(
      "Daily limit: US$12.50",
    );
    // An unsigned currency is shown as unusable, because the executor refuses under it.
    const { currency: _signed, ...withoutCurrency } = m;
    const unsigned = await describeMandate(withoutCurrency, [], "GBP", NOW);
    expect(unsigned.some((line) => line.includes("no signed currency"))).toBe(true);
    expect(unsigned.some((line) => line.startsWith("Daily limit:"))).toBe(false);
  });
  it("keeps the tests-between-own-accounts template canonically equal to defaultMandate", async () => {
    const input = { ...options(), recipientHashes: [HASH, OTHER_HASH] };
    const status = { statusListCredential: at("mandates/status.ttl"), statusListIndex: "0" };
    expect(
      await canonicalNQuads(credentialToRdf(mandateCredential(testsTemplate(input), status))),
    ).toBe(
      await canonicalNQuads(credentialToRdf(mandateCredential(defaultMandate(input), status))),
    );
  });
});

describe("permission editor safety and policy evaluation", () => {
  it("defaults to 30 days, GBP, approval and zero spend", () => {
    expect(editorDefaults(NOW)).toMatchObject({
      until: "2026-12-01",
      currency: "GBP",
      spend: 0,
      transfer: false,
      SendMessage: "ask",
      BookAppointment: "ask",
      Remember: "ask",
    });
    expect(editorSchema.safeParse(values()).success).toBe(true);
  });
  it.each([
    { bindings: [] },
    { recipients: [] },
    { sends: -1 },
    { sends: 1.5 },
    { sends: 10001 },
    { perRecipient: -1 },
    { perRecipient: 1001 },
    { spend: -1 },
    { spend: Number.NaN },
    { spend: Number.POSITIVE_INFINITY },
    { spend: 1000001 },
    { currency: "gbp" },
    { currency: "POUNDS" },
    { until: "" },
    { until: "not a date" },
    { until: "2026-11-31" },
    { until: "2026-02-29" },
    { until: "2026-10-31" },
    { until: "2027-11-02" },
    { transfer: true },
    { spend: 1, SendMessage: "auto" },
    { spend: 1, Remember: "auto" },
    { spend: 1, BookAppointment: "auto", confirm: "confirm" },
  ] as Partial<EditorValues>[])("refuses unsafe editor values %j", (changes) => {
    expect(editorSchema.safeParse(values(changes)).success).toBe(false);
  });
  it("requires CONFIRM only for autonomous spend or Transfer and accepts a future date within a year", () => {
    for (const changes of [
      { spend: 10 },
      { SendMessage: "auto" as const },
      { spend: 10, SendMessage: "auto" as const, confirm: "CONFIRM" },
      { transfer: true, confirm: "CONFIRM" },
      { until: "2027-10-31" },
    ])
      expect(editorSchema.safeParse(values(changes)).success).toBe(true);
  });
  it("keeps the reply template limited to approval-only sends over the supplied email bindings", async () => {
    const original = defaultMandate(options());
    const reply = replyTemplate({ ...options(), recipientHashes: [HASH, OTHER_HASH] }, [
      "gmail",
      "graph-mail",
    ]);
    expect(reply.autonomous).toEqual(original.autonomous);
    expect(reply.prohibitions).toEqual(original.prohibitions);
    expect(reply.limits).toEqual(original.limits);
    expect(reply.withApproval.permissions?.map((r) => r.action)).toEqual([`${AGENT}SendMessage`]);
    for (const binding of ["gmail", "graph-mail"]) {
      const decision = await evaluateIntent(
        reply,
        proposalIntent(proposal({ binding, recipientHash: OTHER_HASH }), AGENT_ID, NOW),
      );
      expect(decision).toEqual({ decision: "confirm-required", reason: "owner-approval" });
    }
    expect(
      await evaluateIntent(reply, proposalIntent(proposal({ binding: "matrix" }), AGENT_ID, NOW)),
    ).toEqual({ decision: "confirm-required", reason: "no-matching-rule" });
    expect(
      await evaluateIntent(
        reply,
        proposalIntent(proposal({ action: `${AGENT}Remember` }), AGENT_ID, NOW),
      ),
    ).toEqual({ decision: "confirm-required", reason: "no-matching-rule" });
  });
  it("builds scoped ask/autonomous rules with hard limits and explicit prohibitions", async () => {
    const m = buildEditorMandate(
      values({ Remember: "auto", BookAppointment: "auto", sends: 7, perRecipient: 2 }),
      options(),
    );
    expect(m.validUntil).toBe("2026-12-01T23:59:59.999Z");
    expect(m.limits).toEqual([
      limitConstraint(`${AGENT}sendsPerDay`, 7, "hard"),
      limitConstraint(`${AGENT}perRecipientPerDay`, 2, "hard"),
      limitConstraint(`${AGENT}spendPerDay`, 0, "hard"),
    ]);
    expect(await proposalBadge(m, proposal(), NOW)).toBe("Ask first");
    expect(await proposalBadge(m, proposal({ action: `${AGENT}Remember` }), NOW)).toBe("Allowed");
    expect(await proposalBadge(m, proposal({ action: `${AGENT}BookAppointment` }), NOW)).toBe(
      "Allowed",
    );
    expect(
      await proposalBadge(
        m,
        proposal({ action: `${AGENT}BookAppointment`, amount: { value: 1, currency: "GBP" } }),
        NOW,
      ),
    ).toBe("Never");
    expect(await proposalBadge(m, proposal({ recipientHash: OTHER_HASH }), NOW)).toBe("Never");
    expect(await proposalBadge(m, proposal({ action: `${AGENT}Transfer` }), NOW)).toBe("Never");
    expect(await proposalBadge(undefined, proposal(), NOW)).toBe("Ask first");
    const expanded = buildEditorMandate(
      values({ transfer: true, confirm: "CONFIRM", spend: 10 }),
      options(),
    );
    expect(expanded.withApproval.permissions?.some((r) => r.action === `${AGENT}Transfer`)).toBe(
      true,
    );
    expect(await proposalBadge(expanded, proposal({ action: `${AGENT}Transfer` }), NOW)).toBe(
      "Ask first",
    );
    expect(proposalIntent(proposal({ action: `${AGENT}Sign` }), AGENT_ID, NOW).action).toBe(
      `${AGENT}Sign`,
    );
  });
  it("gates Send using the account's binding and actual recipient hash", async () => {
    const own = account(HASH);
    expect(await mandateNamesBinding(mandate(), own, NOW)).toBe(true);
    expect(await mandateNamesBinding(mandate(), { ...own, provider: "matrix" }, NOW)).toBe(false);
    expect(await mandateNamesBinding(mandate(), account(OTHER_HASH), NOW)).toBe(false);
    expect(await mandateNamesBinding(undefined, own, NOW)).toBe(false);
    const { channelHandleHash: _, ...withoutHash } = own;
    expect(await mandateNamesBinding(mandate(), withoutHash, NOW)).toBe(false);
  });
  it("allows similar actions for precisely seven days with exact action, target, binding, recipient and cost", async () => {
    const p = proposal({ amount: { value: 2, currency: "GBP" } });
    const current = { ...mandate(), autonomous: { id: "urn:auto" } };
    const widened = allowSimilar(current, p, at("mandates/widened.trig"), NOW);
    expect(current.autonomous).toEqual({ id: "urn:auto" });
    expect(widened.id).toBe(at("mandates/widened.trig"));
    expect(widened.withApproval).toEqual(current.withApproval);
    expect(widened.prohibitions).toEqual(current.prohibitions);
    expect(widened.limits).toEqual(current.limits);
    const request = proposalIntent(p, AGENT_ID, NOW);
    const decide = async (changes: Partial<typeof request> = {}) =>
      (await evaluateIntent(widened, { ...request, ...changes })).decision;
    expect(await decide()).toBe("permit");
    expect(await decide({ at: new Date(NOW.getTime() + 7 * DAY - 1).toISOString() })).toBe(
      "permit",
    );
    expect(await decide({ at: new Date(NOW.getTime() + 7 * DAY).toISOString() })).toBe(
      "confirm-required",
    );
    expect(await decide({ at: new Date(NOW.getTime() - 1).toISOString() })).toBe("refuse-all");
    expect(await decide({ action: `${AGENT}Remember` })).toBe("confirm-required");
    expect(await decide({ target: "urn:another:target" })).toBe("confirm-required");
    for (const changes of [
      { [`${AGENT}binding`]: "matrix" },
      { [`${AGENT}recipientSet`]: OTHER_HASH },
      { [`${AGENT}costExceeds`]: 3 },
    ])
      expect(await decide({ attributes: { ...request.attributes, ...changes } })).toBe(
        "confirm-required",
      );
    const existing = {
      ...mandate(),
      autonomous: { id: "urn:auto", permissions: [permission("Remember")] },
    };
    expect(allowSimilar(existing, p, "urn:widened", NOW).autonomous.permissions).toHaveLength(2);
    expect(
      await proposalBadge(
        allowSimilar(mandate(), proposal({ action: `${AGENT}Transfer` }), "urn:widened", NOW),
        proposal({ action: `${AGENT}Transfer` }),
        NOW,
      ),
    ).toBe("Never");
  });
});

describe("agent introduction and status allocation", () => {
  it("reads one explicit agent introduction and never substitutes the owner", async () => {
    const { client } = await fixture(false);
    expect(await readAgentIdentity(client)).toBe(AGENT_ID);
    await client.create(`${client.paths.descriptors}folder/`, "");
    const duplicate = await introduction("agent/descriptors/same.ttl");
    await client.create(new URL(duplicate.path, ROOT).href, duplicate.body as string);
    expect(await readAgentIdentity(client)).toBe(AGENT_ID);
    const missing = await fixture(false, false);
    expect(await readAgentIdentity(missing.client)).toBeUndefined();
    expect(await loadVerifiedMandate(missing.client, missing.session, NOW)).toBeUndefined();
    expect(
      await loadVerifiedMandate(client, { fetch: missing.pod.fetch, webId: OWNER }, NOW),
    ).toBeUndefined();
  });
  it.each(
    [[], ["urn:agent:identity"], [AGENT_ID, "https://another.example/agent"]].map((identities) => ({
      identities,
    })),
  )("refuses malformed or ambiguous introductions %j", async ({ identities }) => {
    const { client } = await fixture(false, false);
    const file = await introduction(undefined, identities);
    await client.create(new URL(file.path, ROOT).href, file.body as string);
    await expect(readAgentIdentity(client)).rejects.toThrow("introduction");
  });
  it("reads only the fixed introduction, refuses disagreement and ignores named proof graphs", async () => {
    const { client } = await fixture(false);
    // Another descriptor claiming a different identity is not the agent's introduction.
    const other = await introduction("agent/descriptors/other.ttl", [
      "https://other.example/agent",
    ]);
    await client.create(new URL(other.path, ROOT).href, other.body as string);
    expect(await readAgentIdentity(client)).toBe(AGENT_ID);
    // Two introductions in the agent's own document that name different agents disagree.
    const store = await parseRdf((await introduction()).body as string, "text/turtle");
    const second = metadataNode(store, `${client.paths.agentIntroduction}#second`);
    second.setIri(`${RDF}type`, `${AGENT}ImplementationDescription`);
    second.setIri(`${AGENT}describes`, "https://other.example/agent");
    await replace(client, client.paths.agentIntroduction, await serialize([...store]));
    await expect(readAgentIdentity(client)).rejects.toThrow("disagree");
    const { client: empty } = await fixture(false, false);
    const named = await parseRdf((await introduction()).body as string, "text/turtle");
    await empty.create(
      empty.paths.agentIntroduction,
      await serialize(
        [...named].map((q) =>
          DataFactory.quad(
            q.subject,
            q.predicate,
            q.object,
            DataFactory.namedNode("urn:proof:graph"),
          ),
        ),
        { format: "application/trig" },
      ),
      "application/trig",
    );
    expect(await readAgentIdentity(empty)).toBeUndefined();
  });
  it("treats a gone introduction as absent and refuses an unreadable one", async () => {
    const status = (code: number) => clientFor(async () => new Response(null, { status: code }));
    expect(await readAgentIdentity(status(410))).toBeUndefined();
    await expect(readAgentIdentity(status(403))).rejects.toThrow();
  });
  it("allocates max-used plus one, including gaps and an array status entry", () => {
    const vc = (index: string): VerifiableCredential => ({
      ...mandateCredential(mandate(), {
        statusListCredential: at("mandates/status.ttl"),
        statusListIndex: index,
      }),
      proof: {
        type: "DataIntegrityProof",
        cryptosuite: "ecdsa-rdfc-2019",
        proofPurpose: "assertionMethod",
        verificationMethod: "urn:key",
        proofValue: "ztest",
      },
    });
    expect(nextStatusIndex([])).toBe(0);
    expect(() => nextStatusIndex([vc(String(Number.MAX_SAFE_INTEGER))])).toThrow("full");
    expect(nextStatusIndex([vc("0"), vc("5"), vc("2")])).toBe(6);
    expect(
      statusIndex({
        ...vc("4"),
        credentialStatus: [vc("4").credentialStatus as BitstringStatusListEntry],
      }),
    ).toBe(4);
    for (const index of ["-1", "01", "1.5", "NaN", "9007199254740992", ""])
      expect(() => statusIndex(vc(index))).toThrow("status");
    const { credentialStatus: _status, ...missingStatus } = vc("0");
    expect(() => statusIndex(missingStatus)).toThrow("status");
    expect(() => statusIndex({ ...vc("0"), credentialStatus: [] })).toThrow("status");
    expect(() =>
      statusIndex({
        ...vc("0"),
        credentialStatus: [vc("0").credentialStatus, vc("1").credentialStatus] as NonNullable<
          VerifiableCredential["credentialStatus"]
        >,
      }),
    ).toThrow("status");
  });
});

describe("signed mandate activation and revocation", () => {
  it("previews read-only policy claims, issues P-256, creates status and activates with conditional writes in order", async () => {
    const { client, session, pod } = await fixture();
    const m = mandate();
    const preview = await parseRdf(await previewMandate(m, client), "text/turtle");
    expect(await digestQuads([...preview])).toBe(
      await digestQuads(
        credentialToRdf(
          mandateCredential(m, {
            statusListCredential: client.paths.mandatesStatus,
            statusListIndex: "0",
          }),
        ),
      ),
    );
    const key = await getKey();
    expect(key.privateKey.extractable).toBe(false);
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT")
        calls.push({ url: String(input), headers: new Headers(init.headers) });
      return pod.fetch(input, init);
    };
    const writing = clientFor(fetch);
    const vc = await activateMandate(writing, { ...session, fetch }, m, NOW);
    expect(calls.map((c) => c.url)).toEqual([
      m.id,
      client.paths.mandatesStatus,
      client.paths.mandatesCurrent,
    ]);
    expect(calls.every((c) => c.headers.get("if-none-match") === "*")).toBe(true);
    expect(statusIndex(vc)).toBe(0);
    await expectSameMandate(await loadVerifiedMandate(client, session, NOW), m);
    const resolver = createWebIdKeyResolver({ fetch: session.fetch });
    await expectSameMandate(
      await createVcMandateVerifier({
        read: async () => vc,
        ownerWebId: OWNER,
        agentWebId: AGENT_ID,
        statusListCredential: client.paths.mandatesStatus,
        webIdKeyResolver: resolver,
        resolveStatus: createBitstringStatusResolver({
          fetch: session.fetch,
          resolveKey: resolver.resolveKey,
          isControlledBy: resolver.isControlledBy,
          now: NOW,
        }),
        now: () => NOW,
      }).load(),
      m,
    );
    const pointerRecord = (await readMandateCurrent(client))[0]?.record;
    expect(pointerRecord?.credential).toBe(m.id);
    expect(pointerRecord?.digest).toBe(await digestQuads(credentialToRdf(vc)));
    expect(await mandateHistory(client, session, NOW)).toMatchObject([
      { id: m.id, status: "active", key: key.verificationMethod.split("#").at(-1) },
    ]);
  });
  it("warns before revoking the key that signed the current permissions", async () => {
    const { client, session } = await fixture();
    const signing = (await getKey()).verificationMethod;
    const m = mandate(at("mandates/first.trig"));
    await activateMandate(client, session, m, NOW);
    await setupApprovalKey(session);
    expect(await revocationImpact(client, session, signing, NOW)).toMatchObject({
      permissions: true,
    });
    // A pointer that no longer matches its credential grants nothing, so there's no warning.
    const pointer = (await readMandateCurrent(client))[0];
    if (!pointer) throw new Error("Missing pointer");
    const doc = await client.graph(pointer.url);
    await replace(
      client,
      pointer.url,
      doc.text.replace(pointer.record.digest, "0".repeat(pointer.record.digest.length)),
      doc.contentType,
    );
    expect(await revocationImpact(client, session, signing, NOW)).toMatchObject({
      permissions: false,
    });
  });
  it("replaces without reusing status indices, preserves revocation bits and emits a verified revoke control", async () => {
    const { client, session } = await fixture();
    const first = mandate(at("mandates/first.trig"));
    const second = {
      ...mandate(at("mandates/second.trig")),
      validFrom: new Date(NOW.getTime() + 1000).toISOString(),
    };
    await activateMandate(client, session, first, NOW);
    const next = new Date(NOW.getTime() + 1000);
    expect(statusIndex(await activateMandate(client, session, second, next))).toBe(1);
    await expectSameMandate(await loadVerifiedMandate(client, session, next), second);
    const status = await parseStatusListCredential(
      (await client.graph(client.paths.mandatesStatus)).text,
    );
    if (!status) throw new Error("Missing signed status");
    expect(await readStatusBit(status, 0)).toBe(true);
    expect(await readStatusBit(status, 1)).toBe(false);
    expect(await mandateHistory(client, session, next)).toMatchObject([
      { id: second.id, status: "active" },
      { id: first.id, status: "replaced" },
    ]);
    await revokeMandate(client, session, next);
    expect(await loadVerifiedMandate(client, session, next)).toBeUndefined();
    expect(
      loadedRecords(
        await readControl(
          client,
          createAgentVerifier(session, () => next),
        ),
      ),
    ).toMatchObject([{ kind: "RevokeMandate", target: second.id, verification: "verified" }]);
    expect(await mandateHistory(client, session, next)).toMatchObject([
      { id: second.id, status: "revoked" },
      { id: first.id, status: "replaced" },
    ]);
    const third = {
      ...mandate(at("mandates/third.trig")),
      validFrom: new Date(next.getTime() + 1000).toISOString(),
    };
    expect(
      statusIndex(await activateMandate(client, session, third, new Date(next.getTime() + 1000))),
    ).toBe(2);
    const expired = {
      ...mandate(at("mandates/expired.trig")),
      validFrom: new Date(NOW.getTime() - 40 * DAY).toISOString(),
      validUntil: new Date(NOW.getTime() - DAY).toISOString(),
    };
    await client.create(
      expired.id,
      await mandateToTurtle(await signedCredential(expired, "3")),
      "application/trig",
    );
    const history = await mandateHistory(client, session, new Date(next.getTime() + 1000));
    expect(history.find((r) => r.id === expired.id)?.status).toBe("expired");
    expect(history.find((r) => r.id === second.id)?.status).toBe("revoked");
    expect(history.find((r) => r.id === third.id)?.status).toBe("active");
    expect(nextStatusIndex(loadedRecords(await readMandateCredentials(client)))).toBe(4);
  });
  // AUTHORED-BY Claude Opus 5.5
  it("renews and revokes over a JSON-LD status list exactly as verification reads it", async () => {
    const { client, session } = await fixture();
    const first = mandate(at("mandates/json-first.trig"));
    await activateMandate(client, session, first, NOW);
    const signed = await parseStatusListCredential(
      (await client.graph(client.paths.mandatesStatus)).text,
    );
    if (!signed) throw new Error("Missing signed status");
    const putStatus = async (body: unknown) =>
      client.replace(
        client.paths.mandatesStatus,
        JSON.stringify(body),
        (await client.statusDocument(client.paths.mandatesStatus)).etag as string,
        "application/ld+json",
      );
    // A JSON-LD list that fails the strict parse or the signature never reaches an update.
    for (const bad of [
      { ...signed, id: at("mandates/other.ttl") },
      { ...signed, validUntil: "2027-06-01T00:00:00Z" },
    ]) {
      await putStatus(bad);
      await expect(revokeMandate(client, session, NOW)).rejects.toThrow("permission status");
    }
    await putStatus(signed);
    await expectSameMandate(await loadVerifiedMandate(client, session, NOW), first);
    const next = new Date(NOW.getTime() + 1000);
    const second = { ...mandate(at("mandates/json-second.trig")), validFrom: next.toISOString() };
    expect(statusIndex(await activateMandate(client, session, second, next))).toBe(1);
    await revokeMandate(client, session, next);
    expect(await loadVerifiedMandate(client, session, next)).toBeUndefined();
    expect(await mandateHistory(client, session, next)).toMatchObject([
      { id: second.id, status: "revoked" },
      { id: first.id, status: "replaced" },
    ]);
  });
  it("signs the editor's currency so the executor can count its spend limits", async () => {
    const { client, session } = await fixture();
    const agent = await readAgentIdentity(client);
    if (!agent) throw new Error("Missing fixture agent");
    const built = {
      ...buildEditorMandate(values({ Remember: "auto" }), options()),
      id: at("mandates/editor.trig"),
      subject: agent,
      validFrom: NOW.toISOString(),
    };
    expect(built.currency).toBe("GBP");
    expect(built.limits.map((l) => l.leftOperand)).toContain(`${AGENT}spendPerDay`);
    await activateMandate(client, session, built, NOW);
    expect((await loadVerifiedMandate(client, session, NOW))?.currency).toBe("GBP");
  });
  it("reads an off-storage owner profile only through the public fetch for mandates", async () => {
    const { client, session, pod } = await fixture();
    const first = mandate(at("mandates/public-first.trig"));
    await activateMandate(client, session, first, NOW);
    const profile = OWNER.split("#")[0] as string;
    const profileReads: string[] = [];
    const external = {
      webId: OWNER,
      storageUrl: BASE,
      // The extension's credentials cover only the granted storage.
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.startsWith(profile)) {
          profileReads.push(url);
          throw new Error("outside the granted storage");
        }
        return pod.fetch(input, init);
      }) as typeof pod.fetch,
      publicFetch: vi.fn(pod.fetch),
    };
    await expectSameMandate(await loadVerifiedMandate(client, external, NOW), first);
    const next = new Date(NOW.getTime() + 1000);
    const second = { ...mandate(at("mandates/public-second.trig")), validFrom: next.toISOString() };
    await activateMandate(client, external, second, next);
    await revokeMandate(client, external, next);
    expect(await mandateHistory(client, external, next)).toMatchObject([
      { id: second.id, status: "revoked" },
      { id: first.id, status: "replaced" },
    ]);
    expect(profileReads).toEqual([]);
    expect(external.publicFetch).toHaveBeenCalled();
  });
  it("retains a verified revocation in history after its delivery window expires and a newer mandate replaces it", async () => {
    const { client, session } = await fixture();
    const first = mandate(at("mandates/revoked-historically.trig"));
    await activateMandate(client, session, first, NOW);
    await revokeMandate(client, session, NOW);
    const second = mandate(at("mandates/after-revocation.trig"));
    await activateMandate(client, session, second, NOW);
    const later = new Date(NOW.getTime() + 2 * DAY);
    const delivery = loadedRecords(
      await readControl(
        client,
        createAgentVerifier(session, () => later),
      ),
    );
    expect(delivery).toMatchObject([
      { kind: "RevokeMandate", target: first.id, verification: { invalid: "expired" } },
    ]);
    const history = await mandateHistory(client, session, later);
    expect(history.find((row) => row.id === first.id)?.status).toBe("revoked");
    expect(history.find((row) => row.id === second.id)?.status).toBe("active");
    expect(await loadVerifiedMandate(client, session, later)).toMatchObject({ id: second.id });
  });
  it("ignores future revocations and other control kinds as evidence of a historical revocation", async () => {
    const { client, session } = await fixture();
    const first = mandate(at("mandates/replaced-not-revoked.trig"));
    await activateMandate(client, session, first, NOW);
    const second = mandate(at("mandates/current-after-replacement.trig"));
    await activateMandate(client, session, second, NOW);
    const future = new Date(NOW.getTime() + DAY);
    await createAgentSigner(session, client, () => future).signControl("RevokeMandate", {
      target: first.id,
    });
    await createAgentSigner(session, client, () => NOW).signControl("Halt", { target: first.id });
    const history = await mandateHistory(client, session, NOW);
    expect(history.find((row) => row.id === first.id)?.status).toBe("replaced");
    expect(history.find((row) => row.id === second.id)?.status).toBe("active");
  });
  it.each([
    "credential",
    "status",
    "pointer",
  ] as const)("keeps the previous pointer byte-for-byte unchanged when the %s write fails", async (stage) => {
    const { client, session, pod } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const before = await client.graph(client.paths.mandatesCurrent);
    const next = mandate(at("mandates/next.trig"));
    const target =
      stage === "credential"
        ? next.id
        : stage === "status"
          ? client.paths.mandatesStatus
          : client.paths.mandatesCurrent;
    const writes: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT") {
        writes.push(String(input));
        if (String(input) === target) return new Response(null, { status: 500 });
      }
      return pod.fetch(input, init);
    };
    await expect(
      activateMandate(clientFor(fetch), { ...session, fetch }, next, NOW),
    ).rejects.toThrow("save");
    const after = await client.graph(client.paths.mandatesCurrent);
    expect(after.text).toBe(before.text);
    expect(after.etag).toBe(before.etag);
    expect(writes.at(-1)).toBe(target);
    expect(writes).toHaveLength(stage === "credential" ? 1 : stage === "status" ? 2 : 3);
    await expectSameMandate(await loadVerifiedMandate(client, session, NOW), mandate());
  });
  it("refuses a concurrent pointer conflict without overwriting the winner or retrying", async () => {
    const { client, session, pod } = await fixture();
    const initial = await activateMandate(client, session, mandate(), NOW);
    const winner = { ...(await pointer(client, initial)), digest: "winner-digest" };
    const next = mandate(at("mandates/conflict.trig"));
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT" && String(input) === client.paths.mandatesCurrent)
        await replace(client, client.paths.mandatesCurrent, await recordToTurtle(winner));
      return pod.fetch(input, init);
    };
    await expect(
      activateMandate(clientFor(fetch), { ...session, fetch }, next, NOW),
    ).rejects.toThrow("changed");
    expect((await readMandateCurrent(client))[0]?.record.digest).toBe("winner-digest");
  });
  it.each([
    { id: at("accounts/not-a-mandate.trig") },
    { id: at("mandates/current.ttl") },
    { id: at("mandates/status.ttl") },
    { subject: OWNER },
    { issuer: "https://other.example/#me" },
    { validFrom: "2026-11-02T00:00:00Z" },
    { validUntil: NOW.toISOString() },
    { validUntil: "2027-11-02T00:00:00Z" },
  ])("refuses unsafe activation metadata %j before writing", async (changes) => {
    const { client, session, pod } = await fixture(false);
    const spy = vi.spyOn(client, "create");
    await expect(
      activateMandate(client, session, { ...mandate(), ...changes }, NOW),
    ).rejects.toThrow("Check the agent");
    expect(spy).not.toHaveBeenCalled();
    expect(pod.has(client.paths.mandatesCurrent)).toBe(false);
  });
  it("activates a seven-day allowance only from the verified current snapshot", async () => {
    const { client, session } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const current = await loadVerifiedMandate(client, session, NOW);
    if (!current) throw new Error("Missing current fixture mandate");
    const widened = allowSimilar(current, proposal(), at("mandates/similar.trig"), NOW);
    expect(statusIndex(await activateMandate(client, session, widened, NOW, current))).toBe(1);
    expect(
      await proposalBadge(await loadVerifiedMandate(client, session, NOW), proposal(), NOW),
    ).toBe("Allowed");
  });
  it("preserves a named status entry while matching a parsed singleton-array snapshot", async () => {
    const { client, session } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const vc = await issueMandate(
      mandate(),
      await getKey(),
      {
        statusListCredential: client.paths.mandatesStatus,
        statusListIndex: "0",
        id: `${client.paths.mandatesStatus}#entry-0`,
      },
      { cryptosuite: "ecdsa-rdfc-2019" },
    );
    await replace(client, vc.id as string, await mandateToTurtle(vc), "application/trig");
    await replace(
      client,
      client.paths.mandatesCurrent,
      await recordToTurtle(await pointer(client, vc)),
    );
    const current = await loadVerifiedMandate(client, session, NOW);
    if (!current) throw new Error("Missing current fixture mandate");
    const parse = mandateApi.parseMandateCredential;
    vi.spyOn(mandateApi, "parseMandateCredential").mockImplementation(async (document) => {
      const parsed = await parse(document);
      if (!parsed) return undefined;
      return {
        ...parsed,
        credentialStatus: Array.isArray(parsed.credentialStatus)
          ? parsed.credentialStatus
          : [parsed.credentialStatus as BitstringStatusListEntry],
      };
    });
    const widened = allowSimilar(current, proposal(), at("mandates/similar-array.trig"), NOW);
    expect(statusIndex(await activateMandate(client, session, widened, NOW, current))).toBe(1);
  });
  it("refreshes an expired signed status list for fresh permissions while preserving revoked bits", async () => {
    const { client, session } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    await activateMandate(client, session, mandate(at("mandates/replacement.trig")), NOW);
    const later = new Date(NOW.getTime() + 367 * DAY);
    expect(await loadVerifiedMandate(client, session, later)).toBeUndefined();
    expect(
      (await mandateHistory(client, session, later)).every((r) => r.status === "expired"),
    ).toBe(true);
    const fresh = defaultMandate({ ...options(at("mandates/fresh.trig")), now: later });
    expect(statusIndex(await activateMandate(client, session, fresh, later))).toBe(2);
    await expectSameMandate(await loadVerifiedMandate(client, session, later), fresh);
    const list = await parseStatusListCredential(
      (await client.graph(client.paths.mandatesStatus)).text,
    );
    if (!list) throw new Error("Missing refreshed status list");
    expect(Date.parse(list.validUntil as string)).toBeGreaterThan(later.getTime());
    expect(await readStatusBit(list, 0)).toBe(true);
    expect(await readStatusBit(list, 1)).toBe(true);
    expect(await readStatusBit(list, 2)).toBe(false);
  });
  it("refuses fresh activation when the expired status list has an invalid signature", async () => {
    const { client, session } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const status = await client.graph(client.paths.mandatesStatus);
    await replace(
      client,
      client.paths.mandatesStatus,
      status.text.replace("ecdsa-rdfc-2019", "unsupported-suite"),
      "application/trig",
    );
    const later = new Date(NOW.getTime() + 367 * DAY);
    const create = vi.spyOn(client, "create");
    const replaceWrite = vi.spyOn(client, "replace");
    const fresh = defaultMandate({ ...options(at("mandates/forbidden-fresh.trig")), now: later });
    await expect(activateMandate(client, session, fresh, later)).rejects.toThrow(
      "status could not be verified",
    );
    expect(create).not.toHaveBeenCalled();
    expect(replaceWrite).not.toHaveBeenCalled();
  });
  it("rejects a stale allowance snapshot after another device narrows the current permissions", async () => {
    const { client, session } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const current = await loadVerifiedMandate(client, session, NOW);
    if (!current) throw new Error("Missing current fixture mandate");
    const narrowed = buildEditorMandate(
      values({ sends: 1 }),
      options(at("mandates/narrowed.trig")),
    );
    await activateMandate(client, session, narrowed, NOW);
    const create = vi.spyOn(client, "create");
    const replaceWrite = vi.spyOn(client, "replace");
    const widened = allowSimilar(current, proposal(), at("mandates/stale-similar.trig"), NOW);
    await expect(activateMandate(client, session, widened, NOW, current)).rejects.toThrow(
      "permissions changed",
    );
    expect(create).not.toHaveBeenCalled();
    expect(replaceWrite).not.toHaveBeenCalled();
    expect((await readMandateCurrent(client))[0]?.record.credential).toBe(narrowed.id);
  });
  it("rejects a stale snapshot even when the current credential address stays the same", async () => {
    const { client, session } = await fixture();
    const issued = await activateMandate(client, session, mandate(), NOW);
    const current = await loadVerifiedMandate(client, session, NOW);
    if (!current) throw new Error("Missing current fixture mandate");
    const narrowed = { ...current, limits: [limitConstraint(`${AGENT}sendsPerDay`, 1, "hard")] };
    const changed = await signedCredential(narrowed, String(statusIndex(issued)));
    await replace(client, current.id, await mandateToTurtle(changed), "application/trig");
    await replace(
      client,
      client.paths.mandatesCurrent,
      await recordToTurtle(await pointer(client, changed)),
    );
    const create = vi.spyOn(client, "create");
    const replaceWrite = vi.spyOn(client, "replace");
    await expect(
      activateMandate(
        client,
        session,
        allowSimilar(current, proposal(), at("mandates/stale.trig"), NOW),
        NOW,
        current,
      ),
    ).rejects.toThrow("permissions changed");
    expect(create).not.toHaveBeenCalled();
    expect(replaceWrite).not.toHaveBeenCalled();
  });
  it("rejects a current snapshot when the pointer has disappeared", async () => {
    const { client, session, pod } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    await pod.fetch(client.paths.mandatesCurrent, { method: "DELETE" });
    const create = vi.spyOn(client, "create");
    await expect(
      activateMandate(client, session, mandate(at("mandates/stale.trig")), NOW, mandate()),
    ).rejects.toThrow("permissions changed");
    expect(create).not.toHaveBeenCalled();
  });
  it.each([
    "revoked",
    "status missing",
  ] as const)("rejects a same-pointer snapshot after its authority is %s", async (mode) => {
    const { client, session, pod } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const current = await loadVerifiedMandate(client, session, NOW);
    if (!current) throw new Error("Missing current fixture mandate");
    if (mode === "revoked") await revokeMandate(client, session, NOW);
    else await pod.fetch(client.paths.mandatesStatus, { method: "DELETE" });
    const create = vi.spyOn(client, "create");
    const replaceWrite = vi.spyOn(client, "replace");
    await expect(
      activateMandate(
        client,
        session,
        allowSimilar(current, proposal(), at("mandates/stale.trig"), NOW),
        NOW,
        current,
      ),
    ).rejects.toThrow("permissions have stopped");
    expect(create).not.toHaveBeenCalled();
    expect(replaceWrite).not.toHaveBeenCalled();
  });
  it("refuses status-list exhaustion before creating another credential", async () => {
    const { client, session } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const orphan = mandate(at("mandates/last-bit.trig"));
    await client.create(
      orphan.id,
      await mandateToTurtle(await signedCredential(orphan, "131071")),
      "application/trig",
    );
    const create = vi.spyOn(client, "create");
    await expect(
      activateMandate(client, session, mandate(at("mandates/overflow.trig")), NOW),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it("refuses signing without an agent introduction or browser key", async () => {
    const absent = await fixture(false, false);
    await expect(activateMandate(absent.client, absent.session, mandate(), NOW)).rejects.toThrow(
      "agent",
    );
    const noKey = await fixture(false);
    await expect(activateMandate(noKey.client, noKey.session, mandate(), NOW)).rejects.toThrow(
      "device",
    );
    expect(noKey.pod.has(noKey.client.paths.mandatesCurrent)).toBe(false);
  });
  it("requires a validator on the previous pointer", async () => {
    const { client, session, pod } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await pod.fetch(input, init);
      if (String(input) === client.paths.mandatesCurrent && !init?.method)
        response.headers.delete("etag");
      return response;
    };
    await expect(
      activateMandate(
        clientFor(fetch),
        { ...session, fetch },
        mandate(at("mandates/next.trig")),
        NOW,
      ),
    ).rejects.toThrow("safe updates");
  });
});

describe("mandate readers fail closed", () => {
  it("reads capability descriptors while skipping introductions and folders and retaining malformed rows", async () => {
    const { client } = await fixture(false);
    const descriptor = {
      ...exampleRecords["channel-capability"],
      id: `${client.paths.descriptors}gmail.ttl`,
    };
    await client.create(descriptor.id, await recordToTurtle(descriptor));
    await client.create(`${client.paths.descriptors}folder/`, "");
    const invalid = `${client.paths.descriptors}invalid.ttl`;
    await client.create(invalid, "not valid Turtle");
    const rows = await readDescriptors(client);
    expect(loadedRecords(rows)).toEqual([descriptor]);
    expect(rows.filter((row) => "error" in row)).toMatchObject([
      { url: invalid, error: expect.any(Error) },
    ]);
  });
  it("has empty history/current when no mandate was issued and refuses revocation", async () => {
    const { client, session } = await fixture(false);
    expect(await loadVerifiedMandate(client, session, NOW)).toBeUndefined();
    expect(await mandateHistory(client, session, NOW)).toEqual([]);
    await expect(revokeMandate(client, session, NOW)).rejects.toThrow("no current");
  });
  it("displays the signing key for a parsed singleton proof array", async () => {
    const { client, session } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const parse = mandateApi.parseMandateCredential;
    vi.spyOn(mandateApi, "parseMandateCredential").mockImplementation(async (document) => {
      const vc = await parse(document);
      return vc ? { ...vc, proof: Array.isArray(vc.proof) ? vc.proof : [vc.proof] } : undefined;
    });
    const history = await mandateHistory(client, session, NOW);
    expect(history).toMatchObject([
      { status: "active", key: (await getKey()).verificationMethod.split("#").at(-1) },
    ]);
  });
  it("skips containers and legacy references while reading every credential newest first", async () => {
    const { client, session } = await fixture();
    const first = await activateMandate(client, session, mandate(), NOW);
    await client.create(`${client.paths.mandates}folder/`, "");
    const reference = { ...(await pointer(client, first)), id: at("mandates/legacy.ttl") };
    await client.create(reference.id, await recordToTurtle(reference));
    expect((await readMandateCredentials(client)).map((r) => r.url)).toEqual([first.id]);
    const wrong = await signedCredential(mandate(at("mandates/other.trig")), "1");
    await client.create(
      at("mandates/wrong.trig"),
      await mandateToTurtle(wrong),
      "application/trig",
    );
    expect(await readMandateCredentials(client)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: at("mandates/wrong.trig"), error: expect.any(Error) }),
      ]),
    );
  });
  it("rejects malformed credential files and current references whose digest or credential does not match", async () => {
    const { client, session, pod } = await fixture();
    const vc = await activateMandate(client, session, mandate(), NOW);
    const reference = await pointer(client, vc);
    await replace(
      client,
      client.paths.mandatesCurrent,
      await recordToTurtle({ ...reference, digest: "wrong" }),
    );
    await expect(loadVerifiedMandate(client, session, NOW)).rejects.toThrow("verified");
    await replace(client, client.paths.mandatesCurrent, await recordToTurtle(reference));
    await replace(client, vc.id as string, "not valid RDF", "text/turtle");
    await expect(loadVerifiedMandate(client, session, NOW)).rejects.toThrow();
    await pod.fetch(vc.id as string, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "",
    });
    await expect(loadVerifiedMandate(client, session, NOW)).rejects.toThrow("verified");
    expect(await readMandateCredentials(client)).toEqual([
      expect.objectContaining({ error: expect.any(Error) }),
    ]);
  });
  it.each([
    "missing",
    "bad signature",
    "no validator",
    "forbidden",
  ] as const)("refuses unconfirmed status: %s", async (mode) => {
    const { client, session, pod } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    if (mode === "missing") await pod.fetch(client.paths.mandatesStatus, { method: "DELETE" });
    if (mode === "bad signature") {
      const doc = await client.graph(client.paths.mandatesStatus);
      await replace(
        client,
        client.paths.mandatesStatus,
        doc.text.replace("ecdsa-rdfc-2019", "unknown-suite"),
        "application/trig",
      );
    }
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input) === client.paths.mandatesStatus && mode === "forbidden")
        return new Response(null, { status: 403 });
      const response = await pod.fetch(input, init);
      if (String(input) === client.paths.mandatesStatus && mode === "no validator")
        response.headers.delete("etag");
      return response;
    };
    const reading = clientFor(fetch);
    await expect(
      activateMandate(reading, { ...session, fetch }, mandate(at("mandates/next.trig")), NOW),
    ).rejects.toThrow();
    await expect(revokeMandate(reading, { ...session, fetch }, NOW)).rejects.toThrow();
    if (mode !== "no validator")
      expect(await loadVerifiedMandate(reading, { ...session, fetch }, NOW)).toBeUndefined();
  });
  it("isolates a historical credential with a bad signature even if its claims still match the pointer", async () => {
    const { client, session } = await fixture();
    const vc = await activateMandate(client, session, mandate(), NOW);
    const proof = Array.isArray(vc.proof) ? vc.proof[0] : vc.proof;
    if (!proof) throw new Error("Missing fixture proof");
    await replace(
      client,
      vc.id as string,
      await mandateToTurtle({ ...vc, proof: { ...proof, cryptosuite: "unsupported-suite" } }),
      "application/trig",
    );
    expect(await mandateHistory(client, session, NOW)).toMatchObject([
      { id: vc.id, status: "unchecked", key: "Couldn't be checked" },
    ]);
  });
  it("refuses malformed status and missing status after a current pointer is removed", async () => {
    const { client, session, pod } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    await replace(client, client.paths.mandatesStatus, "", "application/trig");
    await expect(mandateHistory(client, session, NOW)).rejects.toThrow("status");
    await pod.fetch(client.paths.mandatesStatus, { method: "DELETE" });
    await pod.fetch(client.paths.mandatesCurrent, { method: "DELETE" });
    await expect(
      activateMandate(client, session, mandate(at("mandates/next.trig")), NOW),
    ).rejects.toThrow("status is missing");
    expect(await mandateHistory(client, session, NOW)).toMatchObject([{ status: "replaced" }]);
  });
  it("verifies the owner of the signed status list and never writes a revoke control after a status failure", async () => {
    const { client, session, pod } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const credential = await buildBitstringStatusListCredential({
      id: client.paths.mandatesStatus,
      issuer: "https://other.example/#me",
      statusPurpose: "revocation",
      validFrom: NOW.toISOString(),
      validUntil: new Date(NOW.getTime() + DAY).toISOString(),
    });
    const signed = await issue({
      credential,
      key: await getKey(),
      suite: new DataIntegritySuite("ecdsa-rdfc-2019"),
      options: { created: NOW },
    });
    await replace(
      client,
      client.paths.mandatesStatus,
      await statusListCredentialToTurtle(signed),
      "application/trig",
    );
    await expect(revokeMandate(client, session, NOW)).rejects.toThrow("status");
    expect(loadedRecords(await readControl(client))).toEqual([]);
    const fetch: typeof globalThis.fetch = async (input, init) =>
      String(input) === client.paths.mandatesStatus
        ? new Response(null, { status: 503 })
        : pod.fetch(input, init);
    await expect(mandateHistory(clientFor(fetch), { ...session, fetch }, NOW)).rejects.toThrow(
      "503",
    );
  });
});

describe("synthetic demo mandate", () => {
  it("publishes only public synthetic key material and serves a verifiable revoked-aware mandate", async () => {
    for (const [slug, digit] of [
      ["gmail", "1"],
      ["graph-mail", "2"],
      ["matrix", "3"],
      ["conflict", "4"],
    ])
      expect(demoAccountHash(slug as string)).toBe(`sha256:${digit?.repeat(64)}`);
    const { files, digest } = await demoMandateFiles(NOW.getTime());
    const original = await profileFile();
    const profile = await withDemoAgentKey(original.body as string);
    const pod = createDemoPod({
      root: ROOT,
      now: () => NOW.getTime(),
      seed: [{ ...original, body: profile }, await introduction(), ...files],
    });
    const client = clientFor(pod.fetch);
    const vc = await parseMandateCredential(
      (await client.graph(at("mandates/demo-credential.trig"))).text,
    );
    if (!vc) throw new Error("Missing fixture mandate");
    expect(digest).toBe(await digestQuads(credentialToRdf(vc)));
    await client.create(
      client.paths.mandatesCurrent,
      await recordToTurtle(await pointer(client, vc)),
    );
    const current = await loadVerifiedMandate(client, { fetch: pod.fetch, webId: OWNER }, NOW);
    expect(current?.subject).toBe(AGENT_ID);
    expect(await proposalBadge(current, proposal({ recipientHash: OTHER_HASH }), NOW)).toBe(
      "Never",
    );
    const approval = {
      ...exampleRecords.approval,
      id: at("approvals/demo-signed.trig"),
      attributedTo: OWNER,
      approves: proposal().id,
      termsDigest: proposal().intent.termsDigest,
      decision: "approve" as const,
      createdAt: NOW.toISOString(),
      expires: new Date(NOW.getTime() + DAY).toISOString(),
    };
    const document = await demoApprovalDocument(approval);
    const claims = {
      id: approval.id,
      approves: approval.approves,
      termsDigest: approval.termsDigest,
      decision: approval.decision,
      expires: approval.expires,
    };
    expect(await readApprovalClaims(document, approval.id)).toEqual(claims);
    expect(
      await verifyApproval(document, {
        id: approval.id,
        proposal: approval.approves,
        termsDigest: approval.termsDigest,
        ownerWebId: OWNER,
        webIdKeyResolver: createWebIdKeyResolver({ fetch: pod.fetch }),
        now: () => NOW,
      }),
    ).toEqual({ valid: true, approval: claims });
    expect(profile).not.toContain("PRIVATE KEY");
    expect(await withDemoAgentKey(profile)).toBeTruthy();
  });
});

describe("fresh signed account mutations", () => {
  async function setup() {
    const f = await fixture();
    const initial: Account = {
      ...account(HASH, "Email"),
      id: at("accounts/email.ttl"),
      channel: "email",
      provider: "gmail",
      bindingState: "connected",
      restrictions: { read: false, triage: false, draft: false, send: true },
    };
    await f.client.create(initial.id, await recordToTurtle(initial));
    return { ...f, initial };
  }
  it("merges two stale tabs one field at a time and preserves Send disabled elsewhere", async () => {
    const { client, session, initial, pod } = await setup();
    let atTime = NOW.getTime();
    const clock = () => new Date(atTime);
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (!init?.method || init.method === "GET") expect(init?.cache).toBe("no-store");
      if (init?.method === "PUT") expect(new Headers(init.headers).get("if-none-match")).toBe("*");
      return pod.fetch(input, init);
    };
    const left = new AccountSettingsQueue(
      initial,
      (patch) => persistAccountPatch(client, { ...session, fetch }, initial.id, patch, clock),
      () => {},
    );
    const right = new AccountSettingsQueue(
      initial,
      (patch) => persistAccountPatch(client, session, initial.id, patch, clock),
      () => {},
    );
    await right.change({ restrictions: { send: false } });
    atTime++;
    await left.change({ restrictions: { read: true } });
    atTime++;
    await right.change({ restrictions: { draft: true } });
    const latest = loadedRecords(await readAccountSettings(client, session, atTime))[0];
    expect(latest?.restrictions).toEqual({ read: true, triage: false, draft: true, send: false });
    expect(left.value.restrictions.send).toBe(false);
  });
  it("preserves different fields when both tabs finish reading before either writes", async () => {
    const { client, session, initial, pod } = await setup();
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      release = resolve;
    });
    let continueWrite!: () => void;
    const barrier = new Promise<void>((resolve) => {
      continueWrite = resolve;
    });
    let signed = "";
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT" && String(input).startsWith(client.paths.control)) {
        signed = String(init.body);
        release();
        await barrier;
      }
      return pod.fetch(input, init);
    };
    const left = persistAccountPatch(
      client,
      { ...session, fetch },
      initial.id,
      { restrictions: { read: true } },
      () => new Date(NOW.getTime() + 1),
    );
    await reached;
    await persistAccountPatch(
      client,
      session,
      initial.id,
      { restrictions: { send: false } },
      () => NOW,
    );
    continueWrite();
    const saved = await left;
    expect(saved.restrictions).toEqual({ read: true, triage: false, draft: false, send: false });
    const { readControlClaims } = await import("@jeswr/agent-mandate/control");
    const graph = [...(await parseRdf(signed, "application/trig"))];
    const id = graph.find((q) => q.predicate.value === `${AGENT}controlKind`)?.subject
      .value as string;
    expect((await readControlClaims(signed, id))?.restrictions).toEqual({ read: true });
    expect(
      loadedRecords(await readAccountSettings(client, session, NOW.getTime() + 1))[0]?.restrictions,
    ).toEqual(saved.restrictions);
  });
  it("a toggle after another tab disconnects never reconnects the account", async () => {
    const { client, session, initial } = await setup();
    const clock = () => new Date(NOW.getTime() + 1);
    await persistAccountPatch(client, session, initial.id, { bindingState: "disabled" }, () => NOW);
    const saved = await persistAccountPatch(
      client,
      session,
      initial.id,
      { restrictions: { read: true } },
      clock,
    );
    expect(saved).toMatchObject({ bindingState: "disabled", restrictions: { read: true } });
    const controls = loadedRecords(await readControl(client, createAgentVerifier(session, clock)));
    expect(controls.filter((c) => c.restrictions).every((c) => c.bindingState === undefined)).toBe(
      true,
    );
  });
  it.each([
    "disconnect",
    "send",
    "same-field",
  ] as const)("folds concurrent %s changes without rejecting owner intent", async (race) => {
    const { client, session, initial, pod } = await setup();
    let atTime = NOW.getTime();
    let writes = 0;
    const clock = () => new Date(atTime);
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT" && String(input).startsWith(client.paths.control)) {
        writes++;
        const response = await pod.fetch(input, init);
        atTime++;
        await createAgentSigner(session, client, clock).signControl("SetBindingState", {
          target: initial.id,
          binding: "gmail",
          ...(race === "disconnect"
            ? { bindingState: "disabled" }
            : {
                restrictions: race === "send" ? { send: false } : { read: false },
              }),
        });
        return response;
      }
      return pod.fetch(input, init);
    };
    const queue = new AccountSettingsQueue(
      initial,
      (patch) => persistAccountPatch(client, { ...session, fetch }, initial.id, patch, clock),
      () => {},
    );
    await queue.change({ restrictions: { read: true } });
    expect(writes).toBe(1);
    if (race === "disconnect") expect(queue.value.bindingState).toBe("disabled");
    if (race === "send") expect(queue.value.restrictions.send).toBe(false);
    if (race === "same-field") expect(queue.value.restrictions.read).toBe(false);
  });
  it("uses a fresh wall clock when saving without an injected clock", async () => {
    const { client, session, initial } = await setup();
    const saved = await persistAccountPatch(client, session, initial.id, {
      restrictions: { read: true },
    });
    expect(saved.restrictions.read).toBe(true);
  });
  it("refuses a toggle when a control document cannot be read", async () => {
    const { client, session, initial } = await setup();
    await client.create(at("control/broken.trig"), "broken", "application/trig");
    await expect(
      persistAccountPatch(client, session, initial.id, { restrictions: { read: true } }),
    ).rejects.toThrow("latest settings");
  });
});

describe("activation and stopping recover only unfinished revocation", () => {
  async function pending(work: Promise<unknown>) {
    try {
      await work;
    } catch (error) {
      expect(error).toBeInstanceOf(PendingRevocation);
      return error as PendingRevocation;
    }
    throw new Error("Expected pending revocation");
  }
  it("activates the new mandate before revoking, and retry only revokes the old one", async () => {
    const { client, session, pod } = await fixture();
    const old = mandate();
    await activateMandate(client, session, old, NOW);
    const next = mandate(at("mandates/new.trig"));
    let failed = true;
    let statusWrites = 0;
    const writes: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT") {
        writes.push(String(input));
        if (String(input) === client.paths.mandatesStatus && ++statusWrites > 1 && failed)
          return new Response(null, { status: 500 });
      }
      return pod.fetch(input, init);
    };
    const recovery = await pending(
      activateMandate(clientFor(fetch), { ...session, fetch }, next, NOW),
    );
    expect(recovery.message).toBe(
      "Your new permissions are active. The old ones couldn't be switched off yet.",
    );
    expect(writes).toEqual([
      next.id,
      client.paths.mandatesStatus,
      client.paths.mandatesCurrent,
      client.paths.mandatesStatus,
    ]);
    await expectSameMandate(await loadVerifiedMandate(client, session, NOW), next);
    let list = await parseStatusListCredential(
      (await client.graph(client.paths.mandatesStatus)).text,
    );
    expect(await readStatusBit(list as VerifiableCredential, 0)).toBe(false);
    const again = await pending(recovery.retry());
    expect(again.message).toBe(recovery.message);
    failed = false;
    writes.length = 0;
    await again.retry();
    expect(writes).toEqual([client.paths.mandatesStatus]);
    list = await parseStatusListCredential((await client.graph(client.paths.mandatesStatus)).text);
    expect(await readStatusBit(list as VerifiableCredential, 0)).toBe(true);
    expect(await readStatusBit(list as VerifiableCredential, 1)).toBe(false);
    writes.length = 0;
    await recovery.retry();
    expect(writes).toEqual([]);
  });
  it.each([
    1, 3,
  ])("re-reads the status list on %i concurrent CAS conflicts without losing bits", async (conflicts) => {
    const { client, session, pod } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    let attempts = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (
        String(input) === client.paths.mandatesStatus &&
        init?.method === "PUT" &&
        ++attempts <= conflicts
      ) {
        const list = await parseStatusListCredential(
          (await client.graph(client.paths.mandatesStatus)).text,
        );
        const { withStatusBit } = await import("@jeswr/solid-vc");
        const updated = await issue({
          credential: await withStatusBit(list as VerifiableCredential, 8, true),
          key: await getKey(),
          suite: new DataIntegritySuite("ecdsa-rdfc-2019"),
          options: { created: NOW },
        });
        await replace(
          client,
          client.paths.mandatesStatus,
          await statusListCredentialToTurtle(updated),
          "application/trig",
        );
      }
      return pod.fetch(input, init);
    };
    const operation = revokeMandate(clientFor(fetch), { ...session, fetch }, NOW);
    if (conflicts === 1) await operation;
    else {
      const recovery = await pending(operation);
      expect(attempts).toBe(3);
      await recovery.retry();
    }
    const list = await parseStatusListCredential(
      (await client.graph(client.paths.mandatesStatus)).text,
    );
    expect(await readStatusBit(list as VerifiableCredential, 0)).toBe(true);
    expect(await readStatusBit(list as VerifiableCredential, 8)).toBe(true);
    expect(loadedRecords(await readControl(client))).toMatchObject([{ kind: "RevokeMandate" }]);
  });
  it.each([
    "status",
    "control",
  ] as const)("retries a failed stop at its %s step without touching the current pointer", async (stage) => {
    const { client, session, pod } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const before = await client.graph(client.paths.mandatesCurrent);
    let fail = true;
    const writes: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT") {
        writes.push(String(input));
        if (
          fail &&
          (stage === "status"
            ? String(input) === client.paths.mandatesStatus
            : String(input).startsWith(client.paths.control))
        )
          return new Response(null, { status: 500 });
      }
      return pod.fetch(input, init);
    };
    const recovery = await pending(revokeMandate(clientFor(fetch), { ...session, fetch }, NOW));
    if (stage === "status") expect(await loadVerifiedMandate(client, session, NOW)).toBeDefined();
    else expect(await loadVerifiedMandate(client, session, NOW)).toBeUndefined();
    const repeated = await pending(recovery.retry());
    fail = false;
    writes.length = 0;
    await repeated.retry();
    expect(writes.filter((url) => url === client.paths.mandatesStatus)).toHaveLength(
      stage === "status" ? 1 : 0,
    );
    expect(writes.filter((url) => url.startsWith(client.paths.control))).toHaveLength(1);
    expect((await client.graph(client.paths.mandatesCurrent)).text).toBe(before.text);
    expect(await loadVerifiedMandate(client, session, NOW)).toBeUndefined();
  });
  it("keeps a stop retry focused on notification if revocation succeeds but the control write fails", async () => {
    const { client, session, pod } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    let stage = "status";
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (
        init?.method === "PUT" &&
        (stage === "status"
          ? String(input) === client.paths.mandatesStatus
          : stage === "control" && String(input).startsWith(client.paths.control))
      )
        return new Response(null, { status: 500 });
      return pod.fetch(input, init);
    };
    const recovery = await pending(revokeMandate(clientFor(fetch), { ...session, fetch }, NOW));
    stage = "control";
    const notification = await pending(recovery.retry());
    expect(notification.message).toBe(
      "These permissions have stopped. The agent couldn't be notified yet.",
    );
    stage = "none";
    await notification.retry();
    expect(loadedRecords(await readControl(client))).toMatchObject([{ kind: "RevokeMandate" }]);
  });
  it("marks a verified history entry unchecked when its individual status cannot be read", async () => {
    const { client, session } = await fixture();
    await activateMandate(client, session, mandate(), NOW);
    const old = mandate(at("mandates/invalid-index.trig"));
    await client.create(
      old.id,
      await mandateToTurtle(await signedCredential(old, "99999999")),
      "application/trig",
    );
    expect(await mandateHistory(client, session, NOW)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: old.id, status: "unchecked" })]),
    );
    expect(await loadVerifiedMandate(client, session, NOW)).toBeDefined();
  });
  it("retains each unreadable history entry when multiple old documents fail parsing", async () => {
    const { client, session } = await fixture(false);
    const bad = [at("mandates/broken-a.trig"), at("mandates/broken-b.trig")];
    for (const id of bad) await client.create(id, "not RDF", "application/trig");
    expect(await mandateHistory(client, session, NOW)).toEqual(
      bad.map((id) => ({ id, status: "unreadable", key: "Couldn't be checked" })),
    );
  });
  it("isolates a historical proof with a changed datatype while current controls remain usable", async () => {
    const { client, session } = await fixture();
    const old = mandate(at("mandates/old-datatype.trig"));
    await activateMandate(client, session, old, NOW);
    const current = mandate(at("mandates/current-readable.trig"));
    await activateMandate(client, session, current, NOW);
    const doc = await client.graph(old.id);
    const changed = [...doc.dataset].map((quad) =>
      quad.predicate.value === "https://w3id.org/security#proofValue"
        ? DataFactory.quad(
            quad.subject,
            quad.predicate,
            DataFactory.literal(
              quad.object.value,
              DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#string"),
            ),
            quad.graph,
          )
        : quad,
    );
    await replace(client, old.id, await serialize(changed, { format: "TriG" }), "application/trig");
    expect(await mandateHistory(client, session, NOW)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: old.id, status: "unreadable" }),
        expect.objectContaining({ id: current.id, status: "active" }),
      ]),
    );
    await expectSameMandate(await loadVerifiedMandate(client, session, NOW), current);
    await revokeMandate(client, session, NOW);
    expect(await loadVerifiedMandate(client, session, NOW)).toBeUndefined();
    await expect(
      activateMandate(client, session, mandate(at("mandates/no-index-reuse.trig")), NOW),
    ).rejects.toThrow("Check history before signing");
  });
  it("keeps valid current permissions usable when a historical signature is invalid", async () => {
    const { client, session } = await fixture();
    const old = await activateMandate(client, session, mandate(), NOW);
    const current = mandate(at("mandates/current-valid.trig"));
    await activateMandate(client, session, current, NOW);
    const proof = Array.isArray(old.proof) ? old.proof[0] : old.proof;
    await replace(
      client,
      old.id as string,
      await mandateToTurtle({ ...old, proof: { ...proof, cryptosuite: "unsupported-suite" } }),
      "application/trig",
    );
    expect(await mandateHistory(client, session, NOW)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: old.id, status: "unchecked" }),
        expect.objectContaining({ id: current.id, status: "active" }),
      ]),
    );
    await expectSameMandate(await loadVerifiedMandate(client, session, NOW), current);
    await revokeMandate(client, session, NOW);
    expect(await loadVerifiedMandate(client, session, NOW)).toBeUndefined();
  });
});

describe("UI authority agrees with the shared evaluator on unchanged signed policies", () => {
  const own = account(HASH, "Personal email");
  const auto = (rule: Rule): Mandate => ({
    ...mandate(),
    autonomous: { id: "urn:auto", permissions: [rule] },
    withApproval: { id: "urn:ask" },
  });
  it.each([
    "pay",
    "Transfer",
    "agent:Transfer",
    `${AGENT}Transfer`,
    "odrl:use",
    "http://www.w3.org/ns/odrl/2/use",
    "use",
    "urn:example:action",
  ])("keeps intent action %s unchanged", async (action) => {
    const p = proposal({ action });
    expect(proposalIntent(p, AGENT_ID, NOW).action).toBe(action);
    const decision = await evaluateIntent(mandate(), proposalIntent(p, AGENT_ID, NOW));
    expect(await proposalBadge(mandate(), p, NOW)).toBe(
      decision.decision === "prohibited" ? "Never" : "Ask first",
    );
  });
  it.each([
    ["eq", "gmail"],
    ["neq", "gmail"],
    ["neq", "matrix"],
    ["isAnyOf", ["gmail", "matrix"]],
    ["isNoneOf", ["gmail"]],
    ["isNoneOf", ["matrix"]],
    ["lt", "matrix"],
    ["lteq", "gmail"],
    ["gt", "gmail"],
    ["gteq", "gmail"],
    ["unsupported", "gmail"],
  ] as const)("probes binding %s %j with shared semantics", async (operator, rightOperand) => {
    const m = auto(
      permission("SendMessage", [
        { leftOperand: `${AGENT}binding`, operator: operator as "eq", rightOperand },
      ]),
    );
    const expected = await evaluateIntent(
      m,
      proposalIntent(proposal({ target: own.id }), AGENT_ID, NOW),
    );
    expect(await mandateNamesBinding(m, own, NOW)).toBe(
      expected.decision === "permit" || expected.reason === "owner-approval",
    );
    const lines = await describeMandate(m, [own], "GBP", NOW);
    expect(lines.some((line) => line.startsWith("May send"))).toBe(expected.decision === "permit");
  });
  it.each([
    ["eq", HASH],
    ["neq", HASH],
    ["isAnyOf", [HASH]],
    ["isNoneOf", [HASH]],
    ["lt", OTHER_HASH],
    ["lteq", HASH],
    ["gt", HASH],
    ["gteq", HASH],
  ] as const)("probes recipient %s %j with shared semantics", async (operator, rightOperand) => {
    const m = auto(
      permission("SendMessage", [{ leftOperand: `${AGENT}recipientSet`, operator, rightOperand }]),
    );
    const expected = await evaluateIntent(
      m,
      proposalIntent(proposal({ target: own.id }), AGENT_ID, NOW),
    );
    expect(await proposalBadge(m, proposal(), NOW)).toBe(
      expected.decision === "permit" ? "Allowed" : "Ask first",
    );
    const lines = await describeMandate(m, [own], "GBP", NOW);
    expect(lines.some((line) => line.startsWith("May send"))).toBe(expected.decision === "permit");
    expect(lines.join(" ")).not.toContain(HASH);
  });
  it.each([
    ["eq", 0],
    ["neq", 0],
    ["lt", 1],
    ["lteq", 0],
    ["gt", 0],
    ["gteq", 0],
    ["isAnyOf", [0, 1]],
    ["isNoneOf", [0, 1]],
  ] as const)("probes cost %s %j with shared semantics", async (operator, rightOperand) => {
    const m = auto(
      permission("SendMessage", [{ leftOperand: `${AGENT}costExceeds`, operator, rightOperand }]),
    );
    const expected = await evaluateIntent(m, proposalIntent(proposal(), AGENT_ID, NOW));
    expect(await proposalBadge(m, proposal(), NOW)).toBe(
      expected.decision === "permit" ? "Allowed" : "Ask first",
    );
  });
  it.each([
    "agent:SendMessage",
    "SendMessage",
  ])("never normalizes signed action %s into authority", async (action) => {
    const m = auto({ type: "permission", action });
    expect(await proposalBadge(m, proposal(), NOW)).toBe("Ask first");
    expect(await mandateNamesBinding(m, own, NOW)).toBe(false);
    expect(
      (await describeMandate(m, [own], "GBP", NOW)).some((line) => line.startsWith("May")),
    ).toBe(false);
    expect(await canAllowSimilar(m, proposal(), NOW)).toBe(false);
  });
  it.each([
    "agent:binding",
    "odrl:dateTime",
    "http://www.w3.org/ns/odrl/2/dateTime",
  ])("never normalizes signed operand %s", async (leftOperand) => {
    const m = auto(
      permission("SendMessage", [{ leftOperand, operator: "eq", rightOperand: "gmail" }]),
    );
    expect(await proposalBadge(m, proposal(), NOW)).toBe("Ask first");
    expect(await mandateNamesBinding(m, own, NOW)).toBe(false);
  });
  it.each([
    "odrl:eq",
    "http://www.w3.org/ns/odrl/2/eq",
  ])("never normalizes signed operator %s", async (operator) => {
    const m = auto(
      permission("SendMessage", [
        { leftOperand: `${AGENT}binding`, operator: operator as "eq", rightOperand: "gmail" },
      ]),
    );
    expect(await proposalBadge(m, proposal(), NOW)).toBe("Ask first");
    expect(await mandateNamesBinding(m, own, NOW)).toBe(false);
  });
  it.each([
    "autonomous",
    "withApproval",
  ] as const)("honors policy obligations in %s for descriptions, Send and seven days", async (set) => {
    const base = auto(permission("SendMessage"));
    const m: Mandate = { ...base, [set]: { ...base[set], obligations: [{ action: "attribute" }] } };
    expect(await proposalBadge(m, proposal(), NOW)).toBe("Ask first");
    expect(await mandateNamesBinding(m, own, NOW)).toBe(false);
    expect(
      (await describeMandate(m, [own], "GBP", NOW)).some((line) => line.startsWith("May")),
    ).toBe(false);
    expect(await canAllowSimilar(m, proposal(), NOW)).toBe(false);
  });
  it("requires confirmation for duties, profiles, and policy assignees the probe cannot satisfy", async () => {
    for (const policy of [
      {
        permissions: [{ ...permission("SendMessage"), duties: [{ action: "attribute" as const }] }],
      },
      { permissions: [permission("SendMessage")], profile: "urn:unknown:profile" },
      { permissions: [permission("SendMessage")], assignee: "https://other.example/#agent" },
    ]) {
      const m: Mandate = {
        ...mandate(),
        autonomous: { id: "urn:auto", ...policy },
        withApproval: { id: "urn:ask" },
      };
      expect(await proposalBadge(m, proposal(), NOW)).toBe("Ask first");
      expect(await mandateNamesBinding(m, own, NOW)).toBe(false);
      expect(
        (await describeMandate(m, [own], "GBP", NOW)).some((line) => line.startsWith("May")),
      ).toBe(false);
    }
  });
  it("probes canonical actions, actual accounts and seven-day validity without inventing recipients", async () => {
    const m = auto(permission("SendMessage"));
    expect(await canAllowSimilar(undefined, proposal(), NOW)).toBe(false);
    expect(await canAllowSimilar(m, proposal(), NOW)).toBe(true);
    expect(await canAllowSimilar(m, proposal({ action: `${AGENT}Transfer` }), NOW)).toBe(false);
    const lines = await describeMandate(m, [own, account(OTHER_HASH)], "GBP", NOW);
    expect(lines).toContain(
      "May send messages without asking for Personal email on gmail (at zero cost)",
    );
    expect(lines).toContain(
      "May send messages without asking for another account on gmail (at zero cost)",
    );
    const { channelHandleHash: _, ...noHash } = own;
    expect(
      (await describeMandate(m, [noHash], "GBP", NOW)).some((line) => line.startsWith("May")),
    ).toBe(false);
    expect(
      (await describeMandate(m, [own], "GBP", new Date(m.validUntil))).some((line) =>
        line.startsWith("May"),
      ),
    ).toBe(false);
  });
  it("handles empty policy sets and watches prohibitions in either set at their exact boundaries", async () => {
    const end = new Date(NOW.getTime() + DAY).toISOString();
    const rule: Rule = {
      type: "prohibition",
      action: `${AGENT}SendMessage`,
      constraints: [{ leftOperand: "dateTime", operator: "lt", rightOperand: end }],
    };
    const m: Mandate = {
      ...mandate(),
      autonomous: { id: "urn:auto", prohibitions: [rule] },
      withApproval: { id: "urn:ask", prohibitions: [rule] },
    };
    expect(mandateBoundaries(m)).toEqual([
      Date.parse(m.validFrom),
      Date.parse(m.validUntil),
      Date.parse(end),
      Date.parse(end),
    ]);
    const lines = await describeMandate(m);
    expect(lines).toContain("Asks you first: send messages");
    expect(lines.some((line) => line.startsWith("May"))).toBe(false);
  });
  it("extracts exact validity and temporal boundaries without rewriting signed operands", () => {
    expect(mandateBoundaries(undefined)).toEqual([]);
    const m = auto(
      permission("SendMessage", [
        {
          leftOperand: "dateTime",
          operator: "isAnyOf",
          rightOperand: [NOW.toISOString(), new Date(NOW.getTime() + DAY).toISOString()],
        },
        {
          leftOperand: "dateTime",
          operator: "lt",
          rightOperand: new Date(NOW.getTime() + 7 * DAY).toISOString(),
        },
      ]),
    );
    expect(mandateBoundaries(m)).toEqual([
      Date.parse(m.validFrom),
      Date.parse(m.validUntil),
      NOW.getTime(),
      NOW.getTime() + DAY,
      NOW.getTime() + 7 * DAY,
    ]);
  });
});
