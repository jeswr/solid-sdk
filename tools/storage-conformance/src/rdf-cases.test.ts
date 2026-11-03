// AUTHORED-BY Codex GPT-6
import { StorageError } from "@jeswr/storage-client";
import { expect, test, vi } from "vitest";
import { storageCases } from "./cases.js";
import { memoryTarget } from "./targets/memory.js";

const scenarios = storageCases.filter((scenario) => /^SC-RDF-(turtle|jsonld)$/.test(scenario.id));

test.each(
  scenarios,
)("$id requires successful JSON-LD writes on both memory protocols", async (scenario) => {
  for (const protocol of ["solid", "lws"] as const) {
    const target = await memoryTarget(protocol).start();
    try {
      expect(target.jsonLdWrites).toBe(true);
      await scenario.run(target);
    } finally {
      await target.stop();
    }
  }
});

test.each(
  scenarios.flatMap((scenario) =>
    ["refused", "network", "corrupt", "wrong-media-type", "stale-write"].map((fault) => ({
      scenario,
      fault,
    })),
  ),
)("$scenario.id rejects a $fault JSON-LD writer", async ({ scenario, fault }) => {
  const target = await memoryTarget("solid").start();
  const writeRdf = target.storage.writeRdf.bind(target.storage);
  const writer = vi.spyOn(target.storage, "writeRdf").mockImplementation((url, dataset, opts) => {
    if (opts.contentType !== "application/ld+json") return writeRdf(url, dataset, opts);
    if (fault === "refused") throw new StorageError("unsupported", { method: "PUT", url });
    if (fault === "network") throw new StorageError("network", { method: "PUT", url });
    if (fault === "corrupt") return writeRdf(url, [], opts);
    if (fault === "wrong-media-type")
      return writeRdf(url, dataset, { ...opts, contentType: "text/turtle" });
    return writeRdf(url, dataset, { ...opts, ifMatch: "*" });
  });
  try {
    await expect(scenario.run(target)).rejects.toThrow();
    expect(writer.mock.calls.some(([, , opts]) => opts.contentType === "application/ld+json")).toBe(
      true,
    );
  } finally {
    await target.stop();
  }
});

test.each(
  scenarios.flatMap((scenario) =>
    ["unsupported", "network", "success", "mutating-refusal"].map((outcome) => ({
      scenario,
      outcome,
    })),
  ),
)("$scenario.id checks HTTP backend JSON-LD refusal: $outcome", async ({ scenario, outcome }) => {
  const target = await memoryTarget("solid").start();
  target.jsonLdWrites = false;
  const writeRdf = target.storage.writeRdf.bind(target.storage);
  vi.spyOn(target.storage, "writeRdf").mockImplementation(async (url, dataset, opts) => {
    if (opts.contentType !== "application/ld+json" || outcome === "success")
      return writeRdf(url, dataset, opts);
    if (outcome === "mutating-refusal") await writeRdf(url, [], opts);
    throw new StorageError(outcome === "network" ? "network" : "unsupported", {
      method: "PUT",
      url,
    });
  });
  try {
    if (outcome === "unsupported") await scenario.run(target);
    else await expect(scenario.run(target)).rejects.toThrow();
  } finally {
    await target.stop();
  }
});
