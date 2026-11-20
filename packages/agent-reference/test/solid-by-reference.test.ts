// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers

import { parseRdf } from "@jeswr/fetch-rdf";
import { AclResource } from "@solid/object";
import { readFileSync } from "fs";
import { DataFactory } from "n3";
import { beforeAll, expect, it, vi } from "vitest";
import { digestBytes } from "../src/core/canonical.js";
import type { EvidenceItem } from "../src/core/types.js";
import { ConsumerMortgageHandler } from "../src/domains/mortgage.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { OutboundGate } from "../src/gates/outbound.js";
import {
  type AccessPointer,
  isAccessPointer,
  signAccessPointer,
} from "../src/mechanisms/access-pointer.js";
import { accessDocument } from "../src/model/solid-storage.js";
import { testKey } from "../src/reference/keys.js";
import type { OutboundMessage } from "../src/runtime/agent.js";
import { EvidencePod, type PodGrant } from "../src/standins/pod-access.js";
import { FictionalSolidStorage } from "../src/standins/storage.js";
import type { MemoryLedger } from "../src/store/ledger.js";
import { MemoryStateStore } from "../src/store/state.js";
import { INBOUND_CHECKS, type TraceFile } from "../src/trace/types.js";
import { inspectEvidenceJws } from "../src/wire/evidence-jws.js";

const configuration = "data-access-by-reference-solid";
const item = "urn:awp:evidence:harbourbank-deposit-2026-10";
const sam = "https://agents.hostco.example/sam#agent";
const owner = "https://sam.example/#me";
const lender = "https://northbank.example/agents/intake#agent";
const origin = "https://fictional-evidence-pod.example";
const resource = origin + "/sam/evidence/harbourbank-deposit-2026-10";
const aclUrl = resource + ".acl";
const day = 86_400_000;
const root = new URL("..", import.meta.url).pathname;
const load = () => loadCase(root, "mortgage-main");
const solidTest = (name: string, test: () => Promise<void> | void) => it(name, test, 300_000);
type FixtureHook = NonNullable<NonNullable<Parameters<typeof runScenario>[2]>["beforeSolidStep"]>;
type Fixture = Parameters<FixtureHook>[0];

async function run(
  beforeSolidStep: FixtureHook,
  {
    stopAfter,
    branch,
    change,
  }: {
    stopAfter?: string;
    branch?: string;
    change?: (scenario: ReturnType<typeof load>["scenario"]) => void;
  } = {},
) {
  const { profile, scenario } = load();
  scenario.branches = [];
  const entry = scenario.configurations.find((e) => e.id === configuration)!;
  entry.world.branches = branch
    ? (entry.world.branches as Array<{ id: string }>).filter((b) => b.id === branch)
    : [];
  scenario.stopAfter = stopAfter;
  change?.(scenario);
  const paths = await runScenario(profile, scenario, {
    configuration,
    testOnly: true,
    beforeSolidStep,
  });
  return paths.find((p) => p.path === (branch ?? "main"))!;
}

function pointerOf(delivery: OutboundMessage): { evidence: EvidenceItem; pointer: AccessPointer } {
  const evidence = delivery.message.evidence?.find(isAccessPointer);
  expect(evidence).toBeDefined();
  const pointer = inspectEvidenceJws(evidence!.value).payload as unknown as AccessPointer;
  return { evidence: evidence!, pointer };
}

function records(fixture: Fixture, agent: string) {
  return fixture.ledgers
    .get(agent)!
    .entries()
    .map((e) => e.record);
}

function readDecision(trace: TraceFile, reason?: string) {
  const at = trace.events.findLastIndex(
    (e) =>
      e.agent === "lender" &&
      e.part === "inbound-gate" &&
      e.kind === "decision" &&
      (reason ? e.reason === reason : e.addedBy === configuration),
  );
  expect(at).toBeGreaterThan(0);
  const before = trace.events
    .slice(0, at)
    .filter((e) => e.agent === "lender" && e.part === "inbound-gate");
  const checks = before
    .slice(before.findLastIndex((e) => e.kind === "decision") + 1)
    .filter((e) => e.kind === "check");
  return { checks, decision: trace.events[at]! };
}

async function acl(pod: EvidencePod) {
  const response = await pod.storage.client(sam, await testKey("engine/sam-agent/actor"))(aclUrl);
  expect(response.status).toBe(200);
  return response.text();
}

let mainTrace: TraceFile | undefined;
let delivery: OutboundMessage;
let mainPod: EvidencePod;
let mainLedger: MemoryLedger;
let getsBeforeDelivery: number;
beforeAll(async () => {
  const path = await run((fixture) => {
    if (fixture.step.id === "evidence-arrives") {
      mainPod = fixture.pod;
      mainLedger = fixture.ledgers.get("sam-agent")!;
      delivery = fixture.queued.find((out) => out.kind === "deliver")!;
      getsBeforeDelivery = fixture.pod.storage.accessLog.filter(
        (e) => e.method === "GET" && e.url === resource && e.actor === lender,
      ).length;
    }
  });
  mainTrace = path.trace;
}, 300_000);

solidTest("grants read on one resource and releases the pointer as one action", async () => {
  const trace = mainTrace!;
  mainTrace = undefined;
  const body = await acl(mainPod);
  const dataset = await parseRdf(body, "text/turtle", { baseIRI: aclUrl });
  const rules = [...new AclResource(dataset, DataFactory).authorizations].filter((r) =>
    r.agent.has(lender),
  );
  expect(rules).toHaveLength(1);
  const [rule] = rules;
  expect(rule!.accessTo).toBe(resource);
  expect(rule!.default).toBeUndefined();
  expect([...rule!.mode]).toEqual(["http://www.w3.org/ns/auth/acl#Read"]);
  const { evidence, pointer } = pointerOf(delivery);
  const statements = delivery.message.evidence?.filter((e) => e.role === "credential");
  expect(statements).toHaveLength(1);
  expect(inspectEvidenceJws(statements![0]!.value).payload.claimType).toBe(
    "income.gross.monthly-series",
  );
  const bodyInPod = await mainPod.storage.client(
    sam,
    await testKey("engine/sam-agent/actor"),
  )(resource);
  const original = await bodyInPod.text();
  expect(JSON.stringify(delivery.wire)).not.toContain(original);
  expect(pointer.digest).toBe(digestBytes(original));
  expect(getsBeforeDelivery).toBe(0);
  expect(
    mainPod.storage.accessLog
      .filter((e) => e.method === "GET" && e.url === resource && e.actor === lender)
      .map((e) => e.status),
  ).toEqual([200]);
  const granted = mainLedger.entries().find((e) => e.record.type === "access-granted")?.record;
  expect(granted).toMatchObject({
    pointer: pointer.id,
    pointerDigest: digestBytes(evidence.value),
    resource,
  });
  const { checks, decision } = readDecision(trace);
  expect(checks.map((e) => e.check)).toEqual(INBOUND_CHECKS);
  expect(checks.every((e) => e.verdict === "pass")).toBe(true);
  expect(decision.outcome).toBe("admit");
  const intake = trace.events.find(
    (e) =>
      e.kind === "message-in" &&
      e.agent === "sams-agent" &&
      e.packet?.kind === "receipt" &&
      (e.packet.layers.content.raw as { observed?: { pendingReferences?: number } }).observed
        ?.pendingReferences === 1,
  );
  expect(intake?.packet?.layers.content.raw).toMatchObject({
    observed: {
      missing: ["deposit.balance"],
      pendingReferences: 1,
      completeness: "incomplete",
    },
  });
  const baseline = JSON.parse(
    readFileSync(new URL("../traces/mortgage-main--baseline.json", import.meta.url), "utf8"),
  ) as TraceFile;
  const applicationReceipt = (file: TraceFile) =>
    file.events.findLast(
      (e) =>
        e.kind === "message-in" &&
        e.agent === "sams-agent" &&
        e.packet?.kind === "receipt" &&
        (e.packet.layers.content.raw as { observed?: { stage?: string } }).observed?.stage ===
          "decided",
    )?.packet?.layers.content.raw;
  expect(applicationReceipt(trace)).toBeDefined();
  expect(applicationReceipt(trace)).toEqual(applicationReceipt(baseline));
});

solidTest("does neither when the grant cannot be applied", async () => {
  let fixture: Fixture | undefined;
  let before = "";
  const path = await run(
    async (input) => {
      if (input.step.id !== "consent") return;
      fixture = input;
      before = await acl(input.pod);
      input.pod.storage.available = false;
    },
    { stopAfter: "consent" },
  );
  fixture!.pod.storage.available = true;
  expect(await acl(fixture!.pod)).toBe(before);
  expect(records(fixture!, "sam-agent").some((r) => r.type === "access-grant-failed")).toBe(true);
  expect(path.trace!.events.findLast((e) => e.kind === "decision")).toMatchObject({
    outcome: "stop",
    reason: "execution-failed",
  });
  expect(
    path.trace!.events.some(
      (e) => e.agent === "sams-agent" && e.kind === "message-out" && e.packet?.kind === "deliver",
    ),
  ).toBe(false);
});

solidTest("withdraws the grant when the pointer cannot be released", async () => {
  const at = "2026-11-13T09:00:00.000Z";
  const key = await testKey("brief33/owner-agent");
  const storage = new FictionalSolidStorage(
    origin,
    origin + "/#provider",
    await testKey("brief33/pod"),
    () => at,
  );
  storage.introduce(sam, key);
  const pod = new EvidencePod(storage, owner, sam, key);
  await pod.setup();
  const events: { type: string; reason?: unknown }[] = [];
  const record = (event: { type: string }) => events.push(event);
  const bytes = "the bytes supplied by the fixture";
  const pointer = { ...pointerOf(delivery).pointer, digest: digestBytes(bytes) };
  await pod.store(pointer.item, bytes, record);
  const client = storage.client(sam, key);
  const before = digestBytes(await (await client(aclUrl)).text());
  const grant: PodGrant = { pointer, fragment: "rollback-probe" };
  await expect(
    pod.grantAndRelease([grant], "action", record, async () => {
      const during = await (await client(aclUrl)).text();
      expect(digestBytes(during)).not.toBe(before);
      throw new Error("release refused");
    }),
  ).rejects.toThrow("release refused");
  expect(digestBytes(await (await client(aclUrl)).text())).toBe(before);
  expect(events).toContainEqual(
    expect.objectContaining({ type: "access-withdrawn", reason: "release-failed" }),
  );
});

solidTest("grant-wider-than-terms stops at disclosure", async () => {
  let fixture: Fixture | undefined;
  let before = 0;
  const path = await run(
    (input) => {
      if (input.path === "grant-wider-than-terms" && input.step.id === "terms-arrive") {
        fixture = input;
        before = input.pod.storage.accessLog.length;
      }
    },
    { branch: "grant-wider-than-terms", stopAfter: "terms-arrive" },
  );
  expect(path.blocked).toBeUndefined();
  expect(path.disagrees).toBe(false);
  expect(path.actual).toMatchObject({
    check: "disclosure",
    reason: "excessive-scope",
    outcome: "stop",
  });
  expect(
    fixture!.pod.storage.accessLog
      .slice(before)
      .filter(
        (e) =>
          (e.actor === sam && e.method === "PUT" && e.url.endsWith(".acl")) ||
          (e.actor === lender && e.method === "GET"),
      ),
  ).toEqual([]);
  expect(records(fixture!, "sam-agent").some((r) => r.type === "access-grant-intended")).toBe(
    false,
  );
  expect(
    path.trace!.events.some(
      (e) => e.agent === "sams-agent" && e.kind === "message-out" && e.step === 11,
    ),
  ).toBe(false);
});

solidTest("read-after-withdrawal is refused at the source and the copy remains", async () => {
  let fixture: Fixture | undefined;
  const path = await run(
    (input) => {
      if (input.step.id === "second-read") fixture = input;
    },
    { branch: "read-after-withdrawal" },
  );
  expect(path.disagrees).toBe(false);
  expect(path.actual).toMatchObject({
    check: "source",
    reason: "not-authorised",
    outcome: "refuse",
  });
  expect(fixture!.stores.get("north-store")?.has(item)).toBe(true);
  expect(records(fixture!, "north-agent")).toContainEqual(
    expect.objectContaining({
      type: "reference-copy-stored",
      item,
      deleteBy: expect.any(String),
    }),
  );
  expect(records(fixture!, "north-agent")).toContainEqual(
    expect.objectContaining({
      type: "reference-read-refused",
      status: 403,
      receipt: expect.any(String),
    }),
  );
  expect(records(fixture!, "sam-agent")).toContainEqual(
    expect.objectContaining({
      type: "access-withdrawn",
      reason: "principal",
    }),
  );
  const { checks, decision } = readDecision(path.trace!, "not-authorised");
  expect(checks.map((e) => [e.check, e.verdict])).toEqual([
    ["integrity", "pass"],
    ["source", "fail"],
  ]);
  expect(
    path.trace!.events.filter(
      (e) =>
        e.seq > decision.seq &&
        e.agent === "lender" &&
        (e.kind === "store" || e.kind === "message-out"),
    ),
  ).toEqual([]);
});

solidTest("the reader refuses a grant wider than its terms", async () => {
  let fixture: Fixture | undefined;
  const path = await run(
    async (input) => {
      if (input.step.id !== "balance-read") return;
      fixture = input;
      const wider = await accessDocument(
        aclUrl,
        [{ resource, fragment: "extra", agent: lender, modes: ["Write"] }],
        await acl(input.pod),
      );
      input.pod.storage.alterAtRest(aclUrl, () => wider);
    },
    { stopAfter: "balance-read" },
  );
  const { checks, decision } = readDecision(path.trace!, "terms-not-acceptable");
  expect(checks.at(-1)).toMatchObject({ check: "terms", verdict: "fail" });
  expect(decision.outcome).toBe("refuse");
  expect(fixture!.stores.get("north-store")?.has(item)).toBe(false);
});

solidTest("the reader refuses a pointer made out to someone else, and an expired one", async () => {
  const original = EvidencePod.prototype.grantAndRelease;
  const spy = vi.spyOn(EvidencePod.prototype, "grantAndRelease").mockImplementation(async function (
    this: EvidencePod,
    grants,
    action,
    record,
    release,
    journal,
  ) {
    const key = await testKey("engine/sam-agent/actor");
    return original.call(
      this,
      grants,
      action,
      record,
      async (items) => {
        const wrong = new Map(items);
        for (const { pointer } of grants)
          wrong.set(pointer.item.id, {
            role: "grant",
            format: "jws-compact",
            value: await signAccessPointer(key, {
              ...pointer,
              reader: { ...pointer.reader, actor: sam },
            }),
          });
        return release(wrong);
      },
      journal,
    );
  });
  try {
    const path = await run(() => {}, { stopAfter: "evidence-arrives" });
    const { checks, decision } = readDecision(path.trace!, "not-authorised");
    expect(checks.at(-1)).toMatchObject({ check: "source", verdict: "fail" });
    expect(decision.outcome).toBe("refuse");
  } finally {
    spy.mockRestore();
  }
  let fixture: Fixture | undefined;
  const expired = await run(
    (input) => {
      if (input.step.id !== "balance-read") return;
      fixture = input;
      input.advance(90 * 86_400_000);
    },
    { stopAfter: "balance-read" },
  );
  const { checks, decision } = readDecision(expired.trace!, "grant-expired");
  expect(checks.at(-1)).toMatchObject({ check: "source", verdict: "fail" });
  expect(decision.outcome).toBe("refuse");
  expect(fixture!.pod.storage.accessLog.some((e) => e.actor === lender && e.method === "GET")).toBe(
    false,
  );
});

solidTest("the reader refuses bytes the pointer did not name", async () => {
  const path = await run(
    (fixture) => {
      if (fixture.step.id === "balance-read")
        fixture.pod.storage.alterAtRest(resource, (bytes) => bytes + " ");
    },
    { stopAfter: "balance-read" },
  );
  const { checks, decision } = readDecision(path.trace!, "evidence-invalid");
  expect(checks.at(-1)).toMatchObject({ check: "integrity", verdict: "fail" });
  expect(decision.outcome).toBe("refuse");
});

solidTest("the pod refuses everyone else", async () => {
  const storage = mainPod.storage;
  const other = origin + "/#other";
  const key = await testKey("brief33/other");
  storage.introduce(other, key);
  expect((await storage.client(other, key)(resource)).status).toBe(403);
  expect((await storage.client()(resource)).status).toBe(401);
  expect(
    (
      await storage.client(lender, await testKey("engine/north-agent/actor"))(resource, {
        method: "PUT",
        body: "changed",
      })
    ).status,
  ).toBe(403);
});

solidTest("access ends at the stated time", async () => {
  let fixture: Fixture | undefined;
  await run(
    async (input) => {
      if (input.step.id !== "balance-read") return;
      fixture = input;
      const pointer = pointerOf(delivery).pointer;
      input.advance(Date.parse(pointer.validUntil) - Date.parse(pointer.validFrom) + 1);
      await input.runtimes.get("sam-agent")!.dischargeDuties();
    },
    { stopAfter: "balance-read" },
  );
  const recordsAfter = records(fixture!, "sam-agent");
  expect(recordsAfter).toContainEqual(
    expect.objectContaining({ type: "access-withdrawn", reason: "expiry" }),
  );
  expect(recordsAfter).toContainEqual(
    expect.objectContaining({ type: "duty-discharged", kind: "withdraw-access" }),
  );
  const response = await fixture!.pod.storage.client(
    lender,
    await testKey("engine/north-agent/actor"),
  )(resource);
  expect(response.status).toBe(403);
});

it.each([30, 59])("checks the lease and copy against the supplier's %i-day limit", async (days) => {
  const disclose = ConsumerMortgageHandler.prototype.onProposal;
  const core = vi
    .spyOn(ConsumerMortgageHandler.prototype, "onProposal")
    .mockImplementation(function (this: ConsumerMortgageHandler, ...args) {
      const reply = disclose.apply(this, args);
      if (reply.type === "accept" && reply.intent?.parameters.access)
        reply.intent.parameters.retentionDays = 1;
      return reply;
    });
  try {
    let fixture: Fixture | undefined;
    const path = await run(
      (input) => {
        if (input.step.id === "terms-arrive") fixture = input;
      },
      {
        stopAfter: "terms-arrive",
        change(scenario) {
          const deposit = scenario.statements.find((s) => s.id === "deposit")!;
          const policy = deposit.terms!.policy as {
            obligations: { constraints: { rightOperand: string }[] }[];
          };
          policy.obligations[0]!.constraints[0]!.rightOperand = `P${days}D`;
        },
      },
    );
    expect(path.trace!.events).toContainEqual(
      expect.objectContaining({ check: "data-terms", verdict: "fail", reason: "prohibited" }),
    );
    expect(records(fixture!, "sam-agent").some((r) => r.type === "access-grant-intended")).toBe(
      false,
    );
  } finally {
    core.mockRestore();
  }
}, 300_000);

solidTest("reconciles an ACL PUT whose response was lost during a pod outage", async () => {
  let fixture: Fixture | undefined;
  let putSucceeded = false;
  let journalStore: MemoryStateStore | undefined;
  let journalBeforePut: string[] = [];
  let restoreClient: (() => void) | undefined;
  const save = MemoryStateStore.prototype.save;
  const snapshot = vi.spyOn(MemoryStateStore.prototype, "save").mockImplementation(function (
    this: MemoryStateStore,
    state,
  ) {
    save.call(this, state);
    if (Object.keys(state.pendingPodGrants ?? {}).length) journalStore = this;
  });
  try {
    const path = await run(
      (input) => {
        if (input.step.id !== "consent") return;
        fixture = input;
        const storage = input.pod.storage;
        const client = storage.client.bind(storage);
        const spy = vi.spyOn(storage, "client").mockImplementation((...args) => {
          const request = client(...args);
          return async (url, init) => {
            if (!putSucceeded && String(url) === aclUrl && init?.method === "PUT")
              journalBeforePut = Object.keys(journalStore?.load().pendingPodGrants ?? {});
            const response = await request(url, init);
            if (!putSucceeded && String(url) === aclUrl && init?.method === "PUT" && response.ok) {
              putSucceeded = true;
              storage.available = false;
              throw new Error("The pod lost the response after committing the ACL");
            }
            return response;
          };
        });
        restoreClient = () => spy.mockRestore();
      },
      { stopAfter: "consent" },
    );
    expect(putSucceeded).toBe(true);
    expect(path.trace!.events).not.toContainEqual(
      expect.objectContaining({
        agent: "sams-agent",
        kind: "message-out",
        packet: expect.objectContaining({ kind: "deliver" }),
      }),
    );
  } finally {
    snapshot.mockRestore();
    restoreClient?.();
    if (fixture) fixture.pod.storage.available = true;
  }
  const { pod, runtimes } = fixture!;
  const read = pod.storage.client(lender, await testKey("engine/north-agent/actor"));
  expect((await read(resource)).status).toBe(200);
  const unrelated = origin + "/#other-reader";
  const otherKey = await testKey("brief33/other-reader");
  pod.storage.introduce(unrelated, otherKey);
  const updated = await accessDocument(
    aclUrl,
    [{ resource, fragment: "other-read", agent: unrelated, modes: ["Read"] }],
    await acl(pod),
  );
  pod.storage.alterAtRest(aclUrl, () => updated);
  await runtimes.get("sam-agent")!.recover();
  expect((await read(resource)).status).toBe(403);
  expect((await pod.storage.client(unrelated, otherKey)(resource)).status).toBe(200);
  expect(journalBeforePut).toEqual([expect.stringContaining(`${aclUrl}#reference-`)]);
  expect(journalStore?.load().pendingPodGrants).toEqual({});
  expect(records(fixture!, "sam-agent")).toContainEqual(
    expect.objectContaining({
      type: "access-grant-intended",
      fragment: expect.stringMatching(/^reference-/),
    }),
  );
  expect(records(fixture!, "sam-agent")).toContainEqual(
    expect.objectContaining({ type: "access-withdrawn", reason: "release-failed" }),
  );
});

it.each([
  "expired",
  "revoked",
] as const)("withdraws a due grant after its original mandate is %s", async (status) => {
  let fixture: Fixture | undefined;
  await run(
    async (input) => {
      if (input.step.id !== "balance-read") return;
      fixture = input;
      const sender = input.runtimes.get("sam-agent")!;
      if (status === "revoked") {
        expect(await sender.revokeMandate()).toMatchObject({ revoked: true });
        input.advance(59 * day + 1);
      } else {
        input.advance(90 * day);
      }
      await sender.dischargeDuties();
    },
    { stopAfter: "balance-read" },
  );
  const reader = fixture!.pod.storage.client(lender, await testKey("engine/north-agent/actor"));
  expect((await reader(resource)).status).toBe(403);
  expect(records(fixture!, "sam-agent")).toContainEqual(
    expect.objectContaining({ type: "access-withdrawn", reason: "expiry" }),
  );
}, 300_000);

solidTest("a failed final readiness check leaves neither a delivery record nor a go", async () => {
  let fixture: Fixture | undefined;
  let checkedAfterPut = false;
  const ensureRecord = OutboundGate.prototype.ensureRecord;
  const ready = vi.spyOn(OutboundGate.prototype, "ensureRecord").mockImplementation(async function (
    this: OutboundGate,
    subject,
  ) {
    if (
      fixture?.pod.storage.accessLog.some(
        (e) => e.actor === sam && e.method === "PUT" && e.url === aclUrl && e.status === 204,
      )
    ) {
      checkedAfterPut = true;
      return false;
    }
    return ensureRecord.call(this, subject);
  });
  try {
    const path = await run(
      (input) => {
        if (input.step.id === "consent") fixture = input;
      },
      { stopAfter: "consent" },
    );
    expect(checkedAfterPut).toBe(true);
    expect(records(fixture!, "sam-agent")).not.toContainEqual(
      expect.objectContaining({ type: "message-out", kind: "deliver" }),
    );
    expect(path.trace!.events).not.toContainEqual(
      expect.objectContaining({
        agent: "sams-agent",
        outcome: "go",
        caption: expect.stringContaining("deliver"),
      }),
    );
    expect(await acl(fixture!.pod)).not.toContain(lender);
  } finally {
    ready.mockRestore();
  }
});

solidTest("erases both the purpose-store copy and the gate statement at deleteBy", async () => {
  let fixture: Fixture | undefined;
  await run(
    (input) => {
      if (input.step.id === "balance-read") fixture = input;
    },
    { stopAfter: "balance-read" },
  );
  const { runtimes, stores, advance } = fixture!;
  const reader = runtimes.get("north-agent")!;
  const store = stores.get("north-store")!;
  const held = () => reader.admittedStatements().find((fact) => fact.id === item);
  expect(held()).toMatchObject({ balance: 90000 });
  expect(store.has(item)).toBe(true);
  const { pointer } = pointerOf(delivery);
  advance(Date.parse(pointer.copy.deleteBy) - Date.parse(pointer.validFrom) - day);
  await reader.dischargeDuties();
  expect(held()).toBeDefined();
  expect(store.has(item)).toBe(true);
  advance(day);
  const snapshots = vi.spyOn(MemoryStateStore.prototype, "save");
  try {
    await reader.dischargeDuties();
    const saved = snapshots.mock.calls.at(-1)?.[0];
    const retained = Object.values(saved?.contextItems ?? {})
      .flat()
      .filter((entry) => entry.id === item);
    expect(retained).toContainEqual(expect.objectContaining({ accepted: false, kind: "memory" }));
    expect(
      retained.every((entry) => entry.statement === undefined && entry.original === undefined),
    ).toBe(true);
    expect(saved?.precedenceHolds[item]).toBeUndefined();
  } finally {
    snapshots.mockRestore();
  }
  expect({ stored: store.has(item), retained: held() !== undefined }).toEqual({
    stored: false,
    retained: false,
  });
  expect(store.tombstones()).toContainEqual(expect.objectContaining({ id: item }));
  expect(records(fixture!, "north-agent")).toContainEqual(
    expect.objectContaining({ type: "duty-discharged", kind: "delete", items: [item] }),
  );
});

solidTest(
  "refuses a signed statement outside the operation schema before retaining it",
  async () => {
    let fixture: Fixture | undefined;
    const path = await run(
      (input) => {
        if (input.step.id === "balance-read") fixture = input;
      },
      {
        stopAfter: "balance-read",
        change(scenario) {
          scenario.statements.find((s) => s.id === "deposit")!.value.balance = "90000";
        },
      },
    );
    const { checks, decision } = readDecision(path.trace!, "evidence-invalid");
    expect(checks.map((e) => [e.check, e.verdict])).toEqual([
      ["integrity", "pass"],
      ["source", "pass"],
      ["authority", "pass"],
      ["terms", "pass"],
      ["fitness", "fail"],
    ]);
    expect(decision.outcome).toBe("refuse");
    expect(
      fixture!.runtimes
        .get("north-agent")!
        .admittedStatements()
        .some((s) => s.id === item),
    ).toBe(false);
    expect(fixture!.stores.get("north-store")!.has(item)).toBe(false);
    expect(path.trace!.events).not.toContainEqual(
      expect.objectContaining({
        agent: "lender",
        kind: "store",
        fact: expect.objectContaining({ id: item }),
      }),
    );
  },
);
