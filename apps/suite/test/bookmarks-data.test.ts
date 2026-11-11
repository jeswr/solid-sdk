// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createSolidBookmarkRepository } from "@jeswr/solid-bookmark/pod";
import { describe, expect, it } from "vitest";
import { ensureSample } from "../src/apps/bookmarks/demo/sample";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

describe("bookmark demo pod", () => {
  it("seeds real generated resources, registers their class and leaves an emptied library empty", async () => {
    const pod = createDemoPod({
      root: DEMO_ROOT,
      seed: await buildDemoSeed(Date.now(), { calendar: false }),
    });
    const repository = createSolidBookmarkRepository({
      storageRoot: DEMO_ROOT,
      profile: DEMO_WEBID,
      fetch: pod.fetch,
    });
    const options = { mode: "demo", fetch: pod.fetch, storageUrl: DEMO_ROOT };
    await ensureSample(options, repository, new Date("2026-11-11T12:00:00Z"));
    const items = await repository.list();
    expect(items).toHaveLength(6);
    expect(items.filter((item) => item.data.archived)).toHaveLength(2);
    for (const item of items) await repository.remove(item);
    await ensureSample(options, repository);
    expect(await repository.list()).toEqual([]);
  });
  it("does not seed real accounts or overwrite unreadable demo storage", async () => {
    const pod = createDemoPod({
      root: DEMO_ROOT,
      seed: await buildDemoSeed(Date.now(), { calendar: false }),
    });
    const repository = createSolidBookmarkRepository({
      storageRoot: DEMO_ROOT,
      profile: DEMO_WEBID,
      fetch: pod.fetch,
    });
    await ensureSample({ mode: "solid", fetch: pod.fetch, storageUrl: DEMO_ROOT }, repository);
    const denied = async () => new Response(null, { status: 403 });
    await expect(
      ensureSample({ mode: "demo", fetch: denied, storageUrl: DEMO_ROOT }, repository),
    ).rejects.toThrow("check sample");
  });
});
