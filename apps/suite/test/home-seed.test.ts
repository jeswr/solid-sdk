// AUTHORED-BY Codex GPT-6

import { Writer } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { discoverDomainItems } from "../src/apps/home/lib/model/discovery";
import { provenanceOf } from "../src/apps/home/lib/model/provenance";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { buildHomeSeed } from "../src/lib/demo-pod/seed-home";

it("discovers the Home acceptance fixtures through the actual demo pod", async () => {
  const seed = await buildDemoSeed(Date.now());
  const pod = createDemoPod({ root: DEMO_ROOT, seed });
  const { items, failures, truncated } = await discoverDomainItems("all", {
    fetch: pod.fetch,
    storage: DEMO_ROOT,
    webId: DEMO_WEBID,
  });
  expect(failures).toEqual([]);
  expect(truncated).toBe(false);
  const inDomain = (domain: string) => items.filter((item) => item.domain.id === domain);
  expect(inDomain("personal").map((item) => item.dataType?.id)).toEqual(["identity"]);
  expect(inDomain("media")).toHaveLength(3);
  expect(inDomain("media").every((item) => item.dataType?.id === "music")).toBe(true);
  expect(
    inDomain("media").map((item) => provenanceOf(item.dataset, item.subject, item.containerUrl)),
  ).toEqual(Array(3).fill({ kind: "source", label: "Spotify", logoId: "spotify" }));
  expect(new Set(inDomain("documents").map((item) => item.dataType?.id))).toEqual(
    new Set(["files", "docs", "notes", "bookmarks"]),
  );
  expect(inDomain("socials")).toHaveLength(2);
  expect(inDomain("calendar")).toHaveLength(1);
  expect(inDomain("mobility")).toEqual([]);
});

afterEach(() => vi.restoreAllMocks());
it("propagates serialization errors in Home seed resources", async () => {
  const error = new Error("Cannot serialize");
  vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback) => callback?.(error, ""));
  await expect(buildHomeSeed(Date.now())).rejects.toBe(error);
});
