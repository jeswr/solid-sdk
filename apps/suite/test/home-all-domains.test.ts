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

it("does not discover template metadata, Docs snapshots or Sheets content as Home items", async () => {
  const { templatesForSession } = await import("../src/lib/templates/store");
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const session = {
    mode: "demo" as const,
    storageUrl: DEMO_ROOT,
    webId: DEMO_WEBID,
    displayName: "Alice",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await (await templatesForSession(session)).save({
    metadata: { name: "Budget template", app: "sheets", category: "Work" },
    content: () => ({ body: "{}", contentType: "application/json" }),
  });
  const { TEMPLATE_CLASS } = await import("@jeswr/suite-templates");
  const reads: string[] = [];
  for (const category of ["all", "other"]) {
    const result = await discoverDomainItems(category, {
      storage: DEMO_ROOT,
      webId: DEMO_WEBID,
      typeIndex: [{ forClass: TEMPLATE_CLASS, container: `${DEMO_ROOT}templates/` }],
      fetch: async (input, init) => {
        reads.push(String(input));
        return pod.fetch(input, init);
      },
    });
    expect(result.items.every((item) => !item.url.includes("/templates/"))).toBe(true);
    expect(result.failures).toEqual([]);
  }
  expect(reads.every((url) => !url.includes("/templates/"))).toBe(true);
});
