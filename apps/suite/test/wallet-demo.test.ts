// AUTHORED-BY Codex (GPT-6.1 Sol)

import { checkCredential } from "@jeswr/solid-wallet";
import { expect, it } from "vitest";
import { ensureWalletSample } from "@/apps/wallet/demo/sample";
import { openWallet, walletVerification } from "@/apps/wallet/lib/data/client";
import { createDemoPod } from "@/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "@/lib/demo-pod/seed";
import type { PodSession } from "@/lib/session/pod-session";

it("seeds four fictional items, privately registers DigitalDocument, verifies the real demo signature and preserves exact credential bytes", async () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(now.getTime()),
    now: () => now.getTime(),
    latency: 0,
  });
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: DEMO_NAME,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await ensureWalletSample(session, now);
  await ensureWalletSample(session, now);
  const { repository } = await openWallet(session);
  const records = await repository.list();
  expect(records).toHaveLength(4);
  expect(records.every((item) => item.holderName === "Rowan Meadow")).toBe(true);
  const credential = records.find((item) => item.credential);
  const source = await repository.credential(credential?.credential as string);
  expect(await checkCredential(source, walletVerification(session, now))).toMatchObject({
    state: "verified",
  });
  expect(
    await (
      await session.fetch(new URL("settings/privateTypeIndex.ttl", session.storageUrl))
    ).text(),
  ).toContain("DigitalDocument");
  const original = `\uFEFF${source}\r\n`;
  const stored = await repository.storeCredential(original);
  expect(await repository.credential(stored)).toBe(original);
  const file = await repository.upload(
    new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
  );
  expect((await repository.preview(file)).type).toBe("image/png");
  const saved = await repository.save({
    name: "Test document",
    kind: "certificate",
    created: now,
    modified: now,
    file,
  });
  const edited = await repository.save({ ...saved, name: "Changed" }, saved);
  expect((await repository.read(edited.url)).name).toBe("Changed");
  await expect(repository.save({ ...saved, name: "stale" }, saved)).rejects.toMatchObject({
    code: "precondition-failed",
  });
  await repository.remove(edited);
  expect(await repository.list()).toHaveLength(4);
});
