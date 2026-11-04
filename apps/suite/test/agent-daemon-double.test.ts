// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { digestOf } from "@jeswr/agent-model";
import type { Page } from "@playwright/test";
import { afterEach, expect, it, vi } from "vitest";
import { daemonDouble } from "../e2e/agent/daemon-double";
import { setupApprovalKey } from "../src/apps/agent/lib/keys";
import { loadedRecords, readApprovals, readAudit, readOutbox } from "../src/apps/agent/lib/readers";
import { createAgentSigner } from "../src/apps/agent/lib/sign";
import { createAgentVerifier } from "../src/apps/agent/lib/verify";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("the browser-pod double verifies real approvals, changed terms, denials and Halt before any approval work", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const prefs = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => prefs.get(key) ?? null,
    setItem: (key: string, value: string) => prefs.set(key, value),
  });
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  vi.stubGlobal("window", {});
  window.__suiteDemoPod = pod;
  // Execute page.evaluate callbacks locally; all I/O still crosses the exact fixture-hook adapter.
  const page = {
    evaluate: async (callback: (arg: unknown) => unknown, arg: unknown) => callback(arg),
  } as Page;
  const daemon = daemonDouble(page);
  const session = { fetch: daemon.fetch, webId: DEMO_WEBID };
  await setupApprovalKey(session);
  const signer = createAgentSigner(session, daemon.client);
  const source = (
    await daemon.client.read(
      daemon.client.paths.resolveSlug("proposals", "send-reply"),
      "action-proposal",
    )
  ).record;
  const first = await daemon.propose("first", source);
  expect(await daemon.tick(first)).toBe("awaiting-approval");
  await signer.signApproval(first, "approve");
  const approvals = loadedRecords(await readApprovals(daemon.client, createAgentVerifier(session)));
  expect(approvals.find((a) => a.approves === first.id)?.verification).toBe("verified");
  expect(await daemon.tick(first)).toBe("sent");
  const sent = loadedRecords(await readOutbox(daemon.client)).find((t) => t.proposal === first.id);
  expect(sent).toMatchObject({ status: "sent", externalId: expect.stringMatching(/^fake-/) });
  expect(await daemon.tick(first)).toBe("sent");
  expect(
    loadedRecords(await readOutbox(daemon.client)).find((t) => t.proposal === first.id)?.externalId,
  ).toBe(sent?.externalId);
  const second = await daemon.propose("changed", source);
  await signer.signApproval(second, "approve");
  const changed = await daemon.edit(second);
  expect(await daemon.tick(changed)).toBe("terms-digest-mismatch");
  expect(
    loadedRecords(await readOutbox(daemon.client)).find((t) => t.proposal === second.id)
      ?.externalId,
  ).toBeUndefined();
  const denied = await daemon.propose("denied", source);
  await signer.signApproval(denied, "deny");
  expect(await daemon.tick(denied)).toBe("denied");
  const halted = await daemon.propose("halted", source);
  await signer.signControl("Halt");
  const spy = vi.fn(pod.fetch);
  window.__suiteDemoPod = { ...pod, fetch: spy };
  expect(await daemon.tick(halted)).toBe("halted");
  expect(spy.mock.calls.some(([input]) => String(input).includes("/approvals/"))).toBe(false);
  // Ensure Resume is strictly newer even on clocks with coarse resolution.
  await createAgentSigner(session, daemon.client, () => new Date(Date.now() + 1)).signControl(
    "Resume",
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(await daemon.tick(halted)).toBe("awaiting-approval");
  await signer.signApproval(halted, "approve");
  expect(await daemon.tick(halted)).toBe("sent");
  const audit = loadedRecords(await readAudit(daemon.client)).toReversed();
  let previous = "sha-256:genesis";
  for (const entry of audit) {
    expect(entry.prev).toBe(previous);
    expect(entry.hash).toBe(
      digestOf({ seq: entry.seq, at: entry.at, prev: entry.prev, record: entry.record }),
    );
    previous = entry.hash;
  }
  expect(audit.at(-1)?.record).toMatchObject({
    proposal: halted.id,
    approval: expect.any(String),
    transmission: expect.any(String),
    mandate: expect.any(String),
  });
});
