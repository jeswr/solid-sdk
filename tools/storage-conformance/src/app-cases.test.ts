// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { StorageError } from "@jeswr/storage-client";
import { expect, test, vi } from "vitest";
import { storageCases } from "./cases.js";
import { evaluateCase, runTarget } from "./harness.js";
import { optionalServiceCases, sq8Cases, trashProbe, versioningProbe } from "./optional-cases.js";
import { memoryTarget } from "./targets/memory.js";
import type { ConformanceCase } from "./types.js";

const appCases = storageCases.filter((scenario) =>
  /^SC-(ROLES|TRASH|VERSIONS|TYPEINDEX|PREFS)-/.test(scenario.id),
);
function scenario(id: string): ConformanceCase {
  const found = appCases.find((item) => item.id === id);
  if (!found) throw new Error("Missing app conformance case");
  return found;
}

test.each([
  ["solid", "wac"],
  ["solid", "acp"],
  ["lws", "wac"],
] as const)("app cases on %s/%s exercise public APIs without failures", async (protocol, accessModel) => {
  const report = await runTarget(memoryTarget(protocol, { accessModel }), appCases);
  expect(report.results.filter((row) => row.status === "fail")).toEqual([]);
  expect(
    report.results.filter((row) => row.status === "pass" && row.test.startsWith("SC-")).length,
  ).toBeGreaterThanOrEqual(8);
});

test.each([
  "solid",
  "lws",
] as const)("%s disabled optional services skip only with successful absence assertions", async (protocol) => {
  const report = await runTarget(
    memoryTarget(protocol, { trash: false, versioning: false }),
    optionalServiceCases,
  );
  for (const [id, feature] of [
    ["SC-TRASH-roundtrip", "trash"],
    ["SC-VERSIONS-roundtrip", "versioning"],
  ]) {
    expect(report.results).toContainEqual({
      test: `${id}:absence:${feature}`,
      status: "pass",
      feature,
      reason: null,
    });
    expect(report.results).toContainEqual({
      test: id,
      status: "skip",
      feature,
      reason: `target-lacks:${feature}`,
    });
  }
  expect(report.results.some((row) => row.status === "fail")).toBe(false);
});

test.each([
  "unknown",
  "unavailable",
] as const)("%s advertisements cannot hide working optional services or TypeSearch", async (state) => {
  for (const protocol of ["solid", "lws"] as const) {
    const target = await memoryTarget(protocol).start();
    const features = await target.resolveFeatures?.();
    if (!features) throw new Error("Missing features");
    for (const item of appCases.filter((item) =>
      item.requires.some((key) => ["trash", "versioning", "typeIndex"].includes(key)),
    )) {
      const key = item.requires[0];
      if (!key) throw new Error("Missing requirement");
      features[key].state = state;
      const rows = await evaluateCase(item, target, features);
      expect(rows[0]).toMatchObject({ status: "fail", reason: `advertisement-missing:${key}` });
      expect(rows.at(-1)?.status).toBe("fail");
    }
  }
});

test.each([
  404, 405, 410, 501, 401, 403, 412, 500,
])("HTTP optional probes interpret status %i without consulting the SDK guard", async (status) => {
  for (const [probe, feature] of [
    [trashProbe, "trash"],
    [versioningProbe, "versioning"],
  ] as const) {
    const target = await memoryTarget("solid", { trash: false, versioning: false }).start();
    target.resolveFeatures = undefined;
    const transport = vi.fn<typeof fetch>(async () => new Response(null, { status }));
    target.fetch = transport;
    const result = probe(target);
    if ([404, 405, 410, 501].includes(status)) await expect(result).resolves.toBe(false);
    else await expect(result).rejects.toThrow("Unexpected optional service probe response");
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(transport.mock.calls[0]?.[1]?.method ?? "GET").toBe(
      feature === "trash" ? "POST" : "GET",
    );
  }
});

test.each([
  false,
  true,
])("a successful raw trash command must actually move the source: %s", async (moves) => {
  const target = await memoryTarget("solid").start();
  target.resolveFeatures = undefined;
  target.fetch = vi.fn<typeof fetch>(async (_input, init) => {
    const { resource } = JSON.parse(init?.body as string);
    if (moves)
      await target.storage.delete(resource, {
        ifMatch: (await target.storage.head(resource)).etag as string,
      });
    return new Response(null, { status: 201 });
  });
  expect(await trashProbe(target)).toBe(moves);
});

test("HTTP history probes honor the server's version-history Link and detect missing advertising", async () => {
  const target = await memoryTarget("solid").start();
  target.resolveFeatures = undefined;
  const transport = vi.fn<typeof fetch>(async () => new Response(null));
  target.fetch = transport;
  const head = target.storage.head.bind(target.storage);
  const history = `${target.root}actual-history/`;
  vi.spyOn(target.storage, "head").mockImplementation(async (url) => {
    const result = await head(url);
    const links = new Map(result.links);
    links.set("version-history", [{ target: history, params: {} }]);
    return { ...result, links };
  });
  expect(await versioningProbe(target)).toBe(true);
  expect(transport).toHaveBeenCalledWith(history, expect.any(Object));
});

test.each([
  trashProbe,
  versioningProbe,
])("optional absence probes propagate storage/transport errors", async (probe) => {
  const memory = await memoryTarget("solid").start();
  vi.spyOn(memory.storage, "create").mockRejectedValue(
    new StorageError("network", { method: "POST", url: memory.root }),
  );
  await expect(probe(memory)).rejects.toMatchObject({ code: "network" });
  const target = await memoryTarget("solid").start();
  target.resolveFeatures = undefined;
  target.fetch = async () => {
    throw new Error("offline");
  };
  await expect(probe(target)).rejects.toThrow("offline");
  target.serviceEndpoints = undefined;
  // Version-history may be absent even when the reference client has the service enabled.
  if (probe === trashProbe)
    await expect(probe(target)).rejects.toThrow("Missing trash probe route");
});

test("SQ-8 reuses the exact SC run functions, requirements and absence checks", async () => {
  for (const [index, item] of sq8Cases.entries()) {
    expect(item.id).toMatch(/^SQ-8-(TRASH|VERSIONS)-/);
    expect(item.run).toBe(optionalServiceCases[index]?.run);
    expect(item.checks).toBe(optionalServiceCases[index]?.checks);
    expect(item.requires).toBe(optionalServiceCases[index]?.requires);
  }
  const report = await runTarget(memoryTarget("solid"), sq8Cases);
  expect(report.results.some((row) => row.status === "fail")).toBe(false);
});

test.each([
  "stale-accepted",
  "body-corrupt",
  "wrong-media-type",
])("preferences conformance detects %s writes", async (fault) => {
  const target = await memoryTarget("solid").start();
  const write = target.storage.write.bind(target.storage);
  vi.spyOn(target.storage, "write").mockImplementation((url, body, opts) =>
    write(url, fault === "body-corrupt" ? "{}" : body, {
      ...opts,
      ...(fault === "stale-accepted" ? { ifMatch: "*" } : {}),
      ...(fault === "wrong-media-type" ? { contentType: "text/plain" } : {}),
    }),
  );
  await expect(scenario("SC-PREFS-create-update-412").run(target)).rejects.toThrow();
});

test("LWS TypeSearch goes through QUERY with a class OR group and sees server-managed types", async () => {
  const target = await memoryTarget("lws").start();
  const transport = vi.fn(target.fetch);
  target.fetch = transport;
  await scenario("SC-TYPEINDEX-register-find").run(target);
  expect(transport).toHaveBeenCalled();
  for (const [, init] of transport.mock.calls) {
    expect(init?.method).toBe("QUERY");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/lws-query+json" });
    expect(JSON.parse(init?.body as string).type[0]).toContain(
      "https://example.org/ConformanceNote",
    );
  }
});

test("role and preference exchanges keep their scenario recording boundaries", async () => {
  const target = await memoryTarget("solid").start();
  const events: string[] = [];
  let current = "";
  const transport = target.fetch;
  target.recordScenario = (id) => {
    current = id;
  };
  target.fetch = async (input, init) => {
    events.push(current);
    return transport(input, init);
  };
  const report = await runTarget({ name: "recording", start: async () => target }, [
    scenario("SC-ROLES-commenter"),
  ]);
  expect(report.results.every((row) => row.status === "pass")).toBe(true);
  expect(events.length).toBeGreaterThan(0);
  expect(new Set(events)).toEqual(new Set(["SC-ROLES-commenter"]));
});

test("memory LWS move roles skip only after proving move absence", async () => {
  const target = await memoryTarget("lws").start();
  const features = await target.resolveFeatures?.();
  if (!features) throw new Error("Missing features");
  const item = scenario("SC-ROLES-movePreservingAccess");
  expect(await evaluateCase(item, target, features)).toEqual([
    { test: `${item.id}:absence:move`, status: "pass", feature: "move", reason: null },
    { test: item.id, status: "skip", feature: "move", reason: "target-lacks:move" },
  ]);
});
