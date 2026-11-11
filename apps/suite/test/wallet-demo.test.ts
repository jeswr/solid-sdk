// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5

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

it("retries an interrupted seed without duplicating completed wallet items", async () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(now.getTime()),
    now: () => now.getTime(),
    latency: 0,
  });
  let writes = 0;
  const transport: typeof fetch = async (input, init) => {
    if (
      init?.method === "PUT" &&
      typeof init.body === "string" &&
      init.body.includes("DigitalDocument") &&
      ++writes === 2
    )
      throw new Error("seed interrupted");
    return pod.fetch(input, init);
  };
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: DEMO_NAME,
    fetch: transport,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await expect(ensureWalletSample(session, now)).rejects.toThrow();
  await ensureWalletSample(session, now);
  const { repository } = await openWallet(session);
  const records = await repository.list();
  expect(records).toHaveLength(4);
  expect(new Set(records.map((item) => item.name)).size).toBe(4);
  const vc = records.find((item) => item.credential);
  expect(
    await checkCredential(
      await repository.credential(vc?.credential as string),
      walletVerification(session, now),
    ),
  ).toMatchObject({ state: "verified" });
  // The retry reused the first attempt's credential and issuer instead of orphaning copies.
  expect(await credentialFiles(session)).toEqual([
    "demo-credential.json",
    "demo-issuer.ttl",
    "demo-seeded.txt",
  ]);
});

async function demoSession(intercept?: (input: RequestInfo | URL, init?: RequestInit) => void) {
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
    fetch: async (input, init) => {
      intercept?.(input, init);
      return pod.fetch(input, init);
    },
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  return { now, session };
}
async function credentialFiles(session: PodSession) {
  const { storage, repository } = await openWallet(session);
  const names: string[] = [];
  for await (const entry of storage.listAll(repository.credentials))
    names.push(new URL(entry.url).pathname.split("/").at(-1) as string);
  return names.sort();
}

it("does not store another credential when a seed fails after storing one", async () => {
  let failed = false;
  const { now, session } = await demoSession((_input, init) => {
    if (
      !failed &&
      init?.method === "PUT" &&
      typeof init.body === "string" &&
      init.body.includes("DEMO-P000042")
    ) {
      failed = true;
      throw new Error("seed interrupted");
    }
  });
  await expect(ensureWalletSample(session, now)).rejects.toThrow();
  expect(await credentialFiles(session)).toEqual(["demo-credential.json", "demo-issuer.ttl"]);
  await ensureWalletSample(session, now);
  expect(await credentialFiles(session)).toEqual([
    "demo-credential.json",
    "demo-issuer.ttl",
    "demo-seeded.txt",
  ]);
  const { repository } = await openWallet(session);
  expect(await repository.list()).toHaveLength(4);
});

it("replaces an empty seed record left by an interrupted create instead of blocking startup", async () => {
  let interrupted = false;
  let cleanupBlocked = false;
  const { now, session } = await demoSession((input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (
      !interrupted &&
      init?.method === "PUT" &&
      typeof init.body === "string" &&
      init.body.includes("DEMO-INS-731")
    ) {
      interrupted = true;
      throw new Error("seed interrupted");
    }
    // The conditional cleanup of the empty record also fails, leaving it behind.
    if (!cleanupBlocked && init?.method === "DELETE" && url.endsWith("/demo-insurance.ttl")) {
      cleanupBlocked = true;
      throw new Error("offline");
    }
  });
  await expect(ensureWalletSample(session, now)).rejects.toThrow();
  expect(cleanupBlocked).toBe(true);
  const { repository } = await openWallet(session);
  const empty = new URL("demo-insurance.ttl", repository.base).href;
  await expect(repository.read(empty)).rejects.toBeInstanceOf(TypeError);
  await ensureWalletSample(session, now);
  let skipped = 0;
  const records = await repository.list(() => ++skipped);
  expect(skipped).toBe(0);
  expect(records).toHaveLength(4);
  expect((await repository.read(empty)).identifier).toBe("DEMO-INS-731");
});

it("replaces an invalid existing seed record with a conditional write", async () => {
  const puts: (string | null)[] = [];
  let seeding = false;
  const { now, session } = await demoSession((input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (seeding && init?.method === "PUT" && url.endsWith("/demo-passport.ttl"))
      puts.push(new Headers(init.headers).get("if-match"));
  });
  const { storage, repository } = await openWallet(session);
  await repository.initialise();
  const invalid = (
    await storage.create(repository.base, "<#x> a <https://schema.org/Thing> .", {
      name: "demo-passport.ttl",
      contentType: "text/turtle",
    })
  ).url;
  const { etag } = await storage.head(invalid, { revalidate: true });
  seeding = true;
  await ensureWalletSample(session, now);
  expect(puts).toEqual([etag]);
  const records = await repository.list();
  expect(records).toHaveLength(4);
  expect((await repository.read(invalid)).identifier).toBe("DEMO-P000042");
});
