// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { discoverDomainItems } from "../src/apps/home/lib/model/discovery";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

it("discovers every domain in one pass without fetching a resource twice", async () => {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const reads: string[] = [];
  const result = await discoverDomainItems("all", {
    storage: DEMO_ROOT,
    webId: DEMO_WEBID,
    fetch: async (input, init) => {
      reads.push(String(input));
      return pod.fetch(input, init);
    },
  });
  expect(result.items.some((item) => item.dataType?.id === "identity")).toBe(true);
  expect(result.items.some((item) => item.dataType?.id === "files")).toBe(true);
  expect(new Set(reads).size).toBe(reads.length);
  expect(result.failures).toEqual([]);
});
