// AUTHORED-BY Codex GPT-6.1-Sol
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, expect, it, vi } from "vitest";
import { publishShareCard, resetCommunityReadyMemo } from "../community/publish";
import { DIET_SAFE_FOOD_SHARE } from "../community/share-card";
import { newMealRecord } from "../diary/log";
import { syncMeal } from "../diary/sync";
import { readGeneticSummary, writeGeneticSummary } from "../genetics/summary";
import { readKnowledgeCache, writeKnowledgeCache } from "../knowledge/cache";
import { readOffCache, writeOffCache } from "../off/cache";
import { ensureContainer, putResource, resetDiaryReadyMemo } from "./pod-fs";
import { conditionalPut } from "./rdf-io";
import { registerDiaryTypes } from "./type-index";

const ROOT = "https://alice.example/";
const OWNER = `${ROOT}profile/card#me`;

afterEach(() => {
  vi.unstubAllGlobals();
  resetDiaryReadyMemo();
  resetCommunityReadyMemo();
});

it("routes container creation and conditional resource writes through the injected client", async () => {
  const network = vi.fn(() => {
    throw new Error("Pod I/O bypassed StorageClient");
  });
  vi.stubGlobal("fetch", network);
  const storage = createMemoryStorage({ protocol: "solid", root: ROOT });
  const container = `${ROOT}notes/`;
  const url = `${container}draft.txt`;
  await ensureContainer(storage, container);
  await putResource(storage, url, "first", "text/plain");
  const original = await storage.read(url);
  await conditionalPut(storage, url, "second", original.etag, "text/plain");
  await expect(conditionalPut(storage, url, "stale", original.etag, "text/plain"))
    .rejects.toMatchObject({ status: 412 });
  expect(await (await storage.read(url)).text()).toBe("second");
  await conditionalPut(storage, url, "without a validator", null, "text/plain");
  expect(await (await storage.read(url)).text()).toBe("without a validator");
  expect(network).not.toHaveBeenCalled();
});

it("uses that client for diary, genetics, OFF, community and Type Index callers", async () => {
  const network = vi.fn(() => { throw new Error("Pod I/O bypassed StorageClient"); });
  vi.stubGlobal("fetch", network);
  const storage = createMemoryStorage({ protocol: "solid", root: ROOT });
  const ctx = { storage, storageRoot: ROOT, webId: OWNER };
  const meal = newMealRecord({ storageRoot: ROOT, items: [{ name: "Rice" }] });
  await syncMeal(ctx, meal);
  expect((await storage.readRdf(meal.url)).dataset.size).toBeGreaterThan(0);

  await writeGeneticSummary(ctx, {
    markers: [{ rsid: "rs2187668", riskHaplotype: "DQ2.5", markerPresence: "present" }],
    interpretation: "Genetic risk does not diagnose coeliac disease.",
    consentGiven: true,
    sourceType: "manual",
  });
  expect((await readGeneticSummary(ctx))?.markers[0].riskHaplotype).toBe("DQ2.5");

  await writeOffCache(storage, ROOT, OWNER, {
    barcode: "3800000000000", found: true, name: "Rice",
    allergensTags: [], tracesTags: [], additivesTags: [], categoriesTags: [],
    dataQualityTags: [], attribution: "Open Food Facts",
    sourceUrl: "https://world.openfoodfacts.org/product/3800000000000",
  });
  expect((await readOffCache(storage, ROOT, "3800000000000"))?.name).toBe("Rice");

  const cardUrl = await publishShareCard(storage, ROOT, OWNER, "01ARZ3NDEKTSV4RRFFQ69G5FAV", {
    kind: "safe-food", shareClass: DIET_SAFE_FOOD_SHARE, audience: "owner-only",
    message: { content: "Rice", mediaType: "text/plain", published: "2026-07-03T12:00:00Z" },
  });
  expect((await storage.readRdf(cardUrl)).dataset.size).toBeGreaterThan(0);

  await putResource(storage, `${ROOT}profile/card`, "");
  expect(await registerDiaryTypes(storage, { webId: OWNER, storageRoot: ROOT }))
    .toMatchObject({ registered: true });
  expect((await storage.readRdf(`${ROOT}settings/privateTypeIndex.ttl`)).dataset.size).toBeGreaterThan(0);
  expect(network).not.toHaveBeenCalled();
});

it("round-trips the pod cache through the same injected client without a fetch fallback", async () => {
  const network = vi.fn(() => {
    throw new Error("Pod I/O bypassed StorageClient");
  });
  vi.stubGlobal("fetch", network);
  const storage = createMemoryStorage({ protocol: "solid", root: ROOT });
  await writeKnowledgeCache(storage, ROOT, OWNER, "research-latest", { count: 3 });
  expect(await readKnowledgeCache(storage, ROOT, "research-latest"))
    .toMatchObject({ data: { count: 3 } });
  expect(network).not.toHaveBeenCalled();
});
