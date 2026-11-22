// AUTHORED-BY Codex GPT-6

import { readContainerMembers } from "@jeswr/ldp-container";
import { expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { verifyCompact } from "../src/mechanisms/jws.js";
import { testKey } from "../src/reference/keys.js";
import { PodRecordMirror } from "../src/standins/pod-mirror.js";
import { FictionalSolidStorage } from "../src/standins/storage.js";
import { MemoryLedger } from "../src/store/ledger.js";

it("Sam reads exact signed entries independently; changed stored copies cannot silently verify", async () => {
  const [provider, actor, principal] = await Promise.all([
    testKey("mirror-provider"),
    testKey("mirror-agent"),
    testKey("mirror-principal"),
  ]);
  const storage = new FictionalSolidStorage(
    "https://mirror-provider.example",
    "https://mirror-provider.example/#org",
    provider,
    () => "2026-11-14T00:00:00Z",
  );
  const ledger = new MemoryLedger();
  ledger.append({ type: "decision", verdict: "permitted" }, "2026-11-14T00:00:00Z");
  const mirror = new PodRecordMirror(
    storage,
    "https://operator.example/agent",
    "https://sam.example/#me",
    actor,
    principal,
    () => ledger,
  );
  await mirror.setup();
  storage.available = false;
  expect(await mirror.flush()).toBe(false);
  expect(mirror.count).toBe(0);
  storage.available = true;
  expect(await mirror.flush()).toBe(true);
  expect(mirror.count).toBe(1);
  const body = await (await mirror.principalRead(1)).text();
  const checked = await verifyCompact(body, {
    typ: "awp-pod-record-entry+jws",
    allowedAlgs: ["EdDSA"],
    limits: DEFAULT_LIMITS,
    resolve: (kid) => (kid === actor.kid ? actor : undefined),
  });
  expect(checked.outcome).toBe("valid");
  if (checked.outcome === "valid") expect(checked.payload).toEqual(ledger.entries()[0]);
  expect((await storage.client()(`${mirror.root}00000001`)).status).toBe(401);
  storage.alterAtRest(`${mirror.root}00000001`, () => "altered");
  // A fresh mirror detects a conflicting existing copy rather than overwriting it.
  const restarting = new PodRecordMirror(
    storage,
    mirror.actor,
    mirror.principal,
    actor,
    principal,
    () => ledger,
  );
  expect(await restarting.flush()).toBe(false);
  const listing = await readContainerMembers(
    storage.client(mirror.principal, principal),
    mirror.root,
    { scope: `${storage.origin}/` },
  );
  expect(listing).toHaveLength(1);
});
it("serializes simultaneous flushes so each ledger entry advances the cursor exactly once", async () => {
  const [provider, actor, principal] = await Promise.all([
    testKey("concurrent-mirror-provider"),
    testKey("concurrent-mirror-agent"),
    testKey("concurrent-mirror-principal"),
  ]);
  const storage = new FictionalSolidStorage(
    "https://concurrent-mirror.example",
    "https://concurrent-mirror.example/#provider",
    provider,
    () => "2026-11-14T00:00:00Z",
  );
  const ledger = new MemoryLedger();
  const mirror = new PodRecordMirror(
    storage,
    "https://operator.example/agent",
    "https://sam.example/#me",
    actor,
    principal,
    () => ledger,
  );
  await mirror.setup();
  ledger.append({ type: "decision" }, "2026-11-14T00:00:00Z");
  ledger.append({ type: "release" }, "2026-11-14T00:00:00Z");
  expect(await Promise.all([mirror.flush(), mirror.flush(), mirror.flush()])).toEqual([
    true,
    true,
    true,
  ]);
  expect(mirror.count).toBe(2);
  ledger.append({ type: "next-action" }, "2026-11-14T00:00:01Z");
  expect(await mirror.flush()).toBe(true);
  expect(mirror.count).toBe(3);
  const third = await mirror.principalRead(3);
  expect(third.status).toBe(200);
  const checked = await verifyCompact(await third.text(), {
    typ: "awp-pod-record-entry+jws",
    allowedAlgs: ["EdDSA"],
    limits: DEFAULT_LIMITS,
    resolve: (kid) => (kid === actor.kid ? actor : undefined),
  });
  expect(checked.outcome).toBe("valid");
  if (checked.outcome === "valid") expect(checked.payload).toEqual(ledger.entries()[2]);
});

it("the real evidence gate holds on mirror failure, then releases after recovery with baseline confinement", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, scenario))[0]?.trace;
  const paths = await runScenario(profile, scenario, {
    configuration: "accountability-pod-mirror",
  });
  const main = paths.find((path) => path.path === "main"),
    failure = paths.find((path) => path.path === "mirror-unreachable");
  expect(main?.blocked).toBeUndefined();
  if (!baseline || !main?.trace || !failure?.trace) throw new Error("The real paths must run");
  expect(confinementDifferences(baseline, main.trace, "accountability")).toEqual([]);
  expect(failure.disagrees).not.toBe(true);
  const held = failure.trace.events.findIndex(
    (event) =>
      event.check === "evidence" &&
      event.reason === "record-unavailable" &&
      event.verdict === "indeterminate",
  );
  expect(held).toBeGreaterThan(-1);
  const recovered = failure.trace.events.findIndex((event) =>
    event.caption.startsWith("The fictional independent storage provider returns"),
  );
  expect(recovered).toBeGreaterThan(held);
  expect(
    failure.trace.events.slice(held, recovered).some((event) => event.kind === "message-out"),
  ).toBe(false);
  expect(failure.trace.events.slice(recovered).some((event) => event.kind === "message-out")).toBe(
    true,
  );
  expect(failure.trace.events.findLast((event) => event.kind === "decision")?.outcome).toBe(
    "admit",
  );
}, 120000);
