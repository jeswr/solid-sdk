// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { buildMeal, buildProtocol, buildSymptom, parseMealTtl } from "@jeswr/solid-health-diary";
import { NamedNodeFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { Authorization } from "@solid/object";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { ensureSample } from "../src/apps/health/demo/sample";
import {
  createDiaryStore,
  type DiaryDraft,
  type DiaryEntry,
  diaryLabel,
  diaryPatterns,
  matchDiaryItems,
} from "../src/apps/health/lib/data/diary";
import { createHealthDataStore } from "../src/apps/health/lib/data/store";
import { toTurtle } from "../src/apps/health/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

const ROOT = "https://diary.test/",
  OWNER = `${ROOT}profile#me`;
const at = new Date("2026-11-01T12:00:00Z");
const meal = {
  kind: "meal",
  at,
  foods: ["Oats", "Milk"],
  ingredients: "rolled oats",
  tags: ["breakfast", ""],
  note: "At home",
} satisfies DiaryDraft;
const symptom = {
  kind: "symptom",
  at: new Date("2026-11-01T16:00:00Z"),
  symptomType: "bloating",
  severity: 5,
  durationMinutes: 90,
  note: "After lunch",
} satisfies DiaryDraft;
type Interceptor = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fetch: typeof globalThis.fetch,
) => Promise<Response>;
function fixture(intercept?: Interceptor) {
  const pod = createDemoPod({ root: ROOT });
  const fetch: typeof globalThis.fetch = intercept
    ? (input, init) => intercept(input, init, pod.fetch)
    : pod.fetch;
  return {
    pod,
    fetch,
    diary: createDiaryStore(fetch, ROOT, OWNER),
    health: createHealthDataStore(fetch, ROOT, OWNER),
  };
}
describe("private Health diary on the demo pod", () => {
  it("preserves product metadata, per-item ingredients and derived exposures when editing", async () => {
    const { diary, health, pod } = fixture();
    const first = await diary.save(meal, "products");
    const items = [
      {
        name: "Yoghurt",
        ingredientsText: "milk",
        offBarcode: "123",
        offRef: "https://world.openfoodfacts.org/product/123",
        declaredAllergen: ["en:milk"],
        traceAllergen: ["en:peanuts"],
        additive: ["en:e100"],
        offCategory: ["en:yoghurts"],
        sourceConfidence: "off" as const,
      },
      {
        name: "Apricots",
        ingredientsText: "apricots",
        offCategory: ["en:dried-apricots"],
        sourceConfidence: "manual" as const,
      },
    ];
    await health.write(first.url, buildMeal(first.url, { startTime: at, items }), {
      etag: first.etag as string,
    });
    const current = await diary.read(first.url);
    const edited = await diary.save({ ...current, note: "New note" }, "products", current);
    const parsed = await parseMealTtl(
      edited.url,
      (await (await pod.fetch(edited.url)).text()).replaceAll(
        "https://schema.org/",
        "http://schema.org/",
      ),
    );
    expect(parsed?.items).toMatchObject(items);
    expect(parsed?.exposures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trigger: "lactose", exposureLevel: "present" }),
        expect.objectContaining({
          trigger: "sulphites",
          exposureLevel: "possible-undeclared",
          derivedFrom: [`${edited.url}#item-1`],
        }),
      ]),
    );
  });
  it("skips foreign resources and collects entry failures without losing readable entries", async () => {
    let failing = false;
    const { diary, health, pod } = fixture(async (input, init, fetch) =>
      failing && String(input).endsWith("unreadable.ttl") && !init?.method
        ? new Response(null, { status: 403 })
        : fetch(input, init),
    );
    const good = await diary.save(meal, "good");
    await diary.save(symptom, "unreadable");
    const unknown = await diary.save(symptom, "unknown");
    const { document } = await health.read(unknown.url);
    // Use the model's predicate rather than assuming its namespace.
    const typeQuad = [...document].find(
      (quad) =>
        quad.predicate.value.endsWith("symptomType") &&
        quad.object.value !== "https://example.test/unknown",
    );
    if (!typeQuad) throw new Error("Missing symptom type");
    OptionalAs.object(
      new TermWrapper(typeQuad.subject, document, DataFactory),
      typeQuad.predicate.value,
      "https://example.test/unknown",
      NamedNodeFrom.string,
    );
    await health.write(unknown.url, document, { etag: unknown.etag as string });
    const foreign = `${diary.base}2026-11/protocol.ttl`;
    await health.write(
      foreign,
      buildProtocol(foreign, { targetTrigger: "lactose", phase: "baseline" }),
      { create: true },
    );
    await pod.fetch(`${diary.base}2026-11/photo.jpg`, {
      method: "PUT",
      body: "image",
      headers: { "content-type": "image/jpeg" },
    });
    failing = true;
    const failures: { url: string; error: unknown }[] = [];
    expect(await diary.list(undefined, { failures })).toEqual([good]);
    expect(failures.map((item) => item.url).sort()).toEqual(
      [unknown.url, `${diary.base}2026-11/unreadable.ttl`].sort(),
    );
  });
  it("reads only overlapping months, shares cached listings and bounds entry concurrency to six", async () => {
    let count = false,
      active = 0,
      peak = 0;
    const reads: string[] = [];
    const { diary } = fixture(async (input, init, fetch) => {
      const url = String(input);
      if (!count || init?.method) return fetch(input, init);
      reads.push(url);
      if (!url.endsWith(".ttl")) return fetch(input, init);
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      try {
        return await fetch(input, init);
      } finally {
        active--;
      }
    });
    await diary.save({ ...meal, at: new Date("2026-09-15T12:00:00Z") }, "old");
    for (let i = 0; i < 13; i++) await diary.save(meal, `meal-${i}`);
    count = true;
    const range = {
      start: new Date("2026-11-01T00:00:00Z"),
      end: new Date("2026-12-01T00:00:00Z"),
    };
    expect(await diary.list(range, { cached: true })).toHaveLength(13);
    expect(reads.some((url) => url.includes("2026-09/"))).toBe(false);
    expect(peak).toBe(6);
    const before = reads.length;
    await diary.list(range, { cached: true });
    expect(reads).toHaveLength(before);
    await diary.list(undefined, { cached: true });
    expect(reads.filter((url) => /2026-11\/meal-\d+\.ttl$/.test(url))).toHaveLength(13);
  });
  it("finds entries another time zone filed under the neighbouring month", async () => {
    // Written in UTC+14 at 00:30 on 1 Nov local (10:30 UTC on 31 Oct), so filed under 2026-11/.
    vi.stubEnv("TZ", "Pacific/Kiritimati");
    let diary: ReturnType<typeof fixture>["diary"];
    let saved: DiaryEntry;
    try {
      ({ diary } = fixture());
      saved = await diary.save({ ...meal, at: new Date("2026-10-31T10:30:00Z") }, "kiritimati");
      expect(saved.url).toContain("2026-11/kiritimati.ttl");
    } finally {
      vi.unstubAllEnvs();
    }
    // Viewed from London, the moment falls in the week ending 1 Nov 00:00 local.
    const week = { start: new Date("2026-10-25T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") };
    expect(await diary.list(week)).toEqual([saved]);
  });
  it("counts an unreadable month folder as a failure and retries it on the next listing", async () => {
    let refuse = true;
    const { diary } = fixture(async (input, init, fetch) =>
      refuse && !init?.method && String(input).endsWith("/diary/2026-11/")
        ? new Response("no", { status: 500 })
        : fetch(input, init),
    );
    refuse = false;
    const saved = await diary.save(meal, "folder");
    refuse = true;
    const failures: { url: string; error: unknown }[] = [];
    expect(await diary.list(undefined, { failures, cached: true })).toEqual([]);
    expect(failures.map((item) => item.url)).toEqual([`${ROOT}health/diary/2026-11/`]);
    refuse = false;
    expect(await diary.list(undefined, { cached: true })).toEqual([saved]);
  });
  it("partitions by the local date and moves timestamp edits to the matching month", async () => {
    vi.stubEnv("TZ", "Pacific/Honolulu");
    try {
      const { diary } = fixture();
      const first = await diary.save({ ...meal, at: new Date("2026-11-01T03:00:00Z") }, "local");
      expect(first.url).toContain("2026-10/local.ttl");
      const edited = await diary.save(
        { ...first, at: new Date("2026-11-02T03:00:00Z") },
        "local",
        first,
      );
      expect(edited.url).toContain("2026-11/local.ttl");
      expect(
        await diary.list({
          start: new Date("2026-11-01T10:00:00Z"),
          end: new Date("2026-12-01T10:00:00Z"),
        }),
      ).toEqual([edited]);
      await expect(diary.read(first.url)).rejects.toMatchObject({ status: 404 });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("refuses stale cross-month edits and rolls the destination back if the source deletion conflicts", async () => {
    let blockDelete = false;
    const { diary, pod } = fixture(async (input, init, fetch) => {
      if (blockDelete && init?.method === "DELETE" && String(input).includes("2026-11/"))
        return new Response(null, { status: 412 });
      return fetch(input, init);
    });
    const first = await diary.save(meal, "move");
    const changed = await diary.save({ ...meal, note: "Other device" }, "move", first);
    const draft = { ...meal, at: new Date("2026-12-01T12:00:00Z") };
    await expect(diary.save(draft, "move", first)).rejects.toMatchObject({ status: 412 });
    expect(pod.has(`${diary.base}2026-12/move.ttl`)).toBe(false);
    blockDelete = true;
    await expect(diary.save(draft, "move", changed)).rejects.toMatchObject({ status: 412 });
    expect(pod.has(`${diary.base}2026-12/move.ttl`)).toBe(false);
    expect((await diary.read(first.url)).note).toBe("Other device");
    blockDelete = false;
    const occupied = await diary.save({ ...draft, note: "Existing destination" }, "move");
    await expect(diary.save(draft, "move", changed)).rejects.toMatchObject({ status: 412 });
    expect((await diary.read(occupied.url)).note).toBe("Existing destination");
    expect((await diary.read(first.url)).note).toBe("Other device");
  });
  it("edits ingredients per item, leaving other item data intact and defaulting omitted ingredient slots to blank", async () => {
    const { diary } = fixture();
    const entry = await diary.save(
      { ...meal, itemIngredients: ["milk", "apricots"] },
      "ingredients",
    );
    if (entry.kind !== "meal") throw new Error("Expected meal");
    const edited = await diary.save({ ...entry, itemIngredients: ["oats"] }, "ingredients", entry);
    expect(edited.kind === "meal" && edited.items?.map((item) => item.ingredientsText)).toEqual([
      "oats",
      "",
    ]);
    await expect(
      diary.save({ ...meal, itemIngredients: ["a".repeat(4001)] }, "long"),
    ).rejects.toThrow("food text");
  });
  it.each([
    "gone",
    "unverifiable",
  ] as const)("retains a saved destination after a lost source DELETE response (%s)", async (outcome) => {
    let deleting = false;
    const { diary, pod } = fixture(async (input, init, fetch) => {
      const source = String(input).includes("2026-11/");
      if (source && init?.method === "DELETE") {
        deleting = true;
        if (outcome === "gone") await fetch(input, init);
        return new Response(null, { status: 500 });
      }
      if (source && deleting && outcome === "unverifiable" && !init?.method)
        return new Response(null, { status: 503 });
      return fetch(input, init);
    });
    const first = await diary.save(meal, "lost-delete");
    const moving = diary.save(
      { ...meal, at: new Date("2026-12-01T12:00:00Z") },
      "lost-delete",
      first,
    );
    if (outcome === "gone")
      await expect(moving).resolves.toMatchObject({ url: `${diary.base}2026-12/lost-delete.ttl` });
    else await expect(moving).rejects.toMatchObject({ status: 500 });
    expect(pod.has(`${diary.base}2026-12/lost-delete.ttl`)).toBe(true);
    expect(pod.has(first.url)).toBe(outcome === "unverifiable");
  });
  it("blocks diary writes when Health access is not owner-only", async () => {
    const { diary, health, pod } = fixture();
    await health.initialize();
    const { document, etag } = await health.read(".acl");
    const publicRule = new Authorization(`${ROOT}health/.acl#public`, document, DataFactory);
    publicRule.type.add("http://www.w3.org/ns/auth/acl#Authorization");
    publicRule.agentClass.add("http://xmlns.com/foaf/0.1/Agent");
    publicRule.accessTo = `${ROOT}health/`;
    publicRule.canRead = true;
    await pod.fetch(`${ROOT}health/.acl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-match": etag as string },
      body: await toTurtle(document),
    });
    await expect(diary.save(meal, "private")).rejects.toThrow("owner-private");
    expect(pod.has(`${diary.base}2026-11/private.ttl`)).toBe(false);
  });
  it("round trips meals and symptoms, edits across months, filters dates, deletes and restores", async () => {
    const { diary, pod } = fixture();
    expect(await diary.list()).toEqual([]);
    const first = await diary.save(meal, "meal-1");
    expect(first).toMatchObject({
      ...meal,
      tags: ["breakfast"],
      url: `${diary.base}2026-11/meal-1.ttl`,
    });
    const second = await diary.save(symptom, "symptom-1");
    expect(second).toMatchObject(symptom);
    expect(await diary.list()).toEqual([second, first]);
    const tied = await diary.save({ ...symptom, at }, "same-time");
    expect(
      (await diary.list())
        .filter((entry) => entry.at.getTime() === at.getTime())
        .map((entry) => entry.url),
    ).toEqual([first.url, tied.url]);
    await diary.remove(tied);
    expect(await diary.list({ start: at, end: symptom.at })).toEqual([first]);
    expect(
      await diary.list({ start: new Date("2026-12-01Z"), end: new Date("2027-01-01Z") }),
    ).toEqual([]);
    const updated = await diary.save(
      { ...meal, at: new Date("2026-12-01T12:00:00Z"), note: "Changed", foods: ["Rice"], tags: [] },
      "meal-1",
      first,
    );
    expect(updated.url).toBe(`${diary.base}2026-12/meal-1.ttl`);
    expect(
      (await diary.list({ start: new Date("2026-12-01Z"), end: new Date("2027-01-01Z") }))[0],
    ).toEqual(updated);
    const noDuration = await diary.save({ ...symptom, durationMinutes: null }, "symptom-1", second);
    expect(noDuration).toMatchObject({ durationMinutes: null });
    expect(await diary.save({ ...symptom, severity: null }, "symptom-1", noDuration)).toMatchObject(
      { severity: null },
    );
    await diary.remove(updated);
    await diary.remove(updated);
    const restored = await diary.restore(updated);
    expect(restored.url).toBe(updated.url);
    expect(restored.note).toBe("Changed");
    const acl = await (await pod.fetch(`${ROOT}health/.acl`)).text();
    expect(acl).toContain(OWNER);
    expect(acl).not.toContain("agentClass");
    expect(acl).not.toContain("agentGroup");
  });
  it("accepts already applied creates/updates but never overwrites a concurrent change", async () => {
    const { diary } = fixture();
    const first = await diary.save(meal, "same");
    expect(await diary.save(meal, "same")).toEqual(first);
    const draft = { ...meal, note: "Edited" };
    const edited = await diary.save(draft, "same", first);
    expect(await diary.save(draft, "same", first)).toEqual(edited);
    await expect(diary.save({ ...meal, note: "Concurrent" }, "same", first)).rejects.toMatchObject({
      status: 412,
    });
    await expect(diary.save({ ...meal, note: "Different" }, "same")).rejects.toMatchObject({
      status: 412,
    });
    await expect(diary.remove(first)).rejects.toMatchObject({ status: 412 });
    expect(await diary.read(first.url)).toEqual(edited);
  });
  it("handles missing optional model fields and keeps package context on edits", async () => {
    const { diary, health, pod } = fixture();
    const entry = await diary.save(meal, "optional");
    await health.write(
      entry.url,
      buildMeal(entry.url, { startTime: at, context: "restaurant", items: [{ name: "Soup" }] }),
      { etag: entry.etag as string },
    );
    const plain = await diary.read(entry.url);
    expect(plain).toMatchObject({ ingredients: "", note: "", tags: [] });
    const changed = await diary.save({ ...plain, note: "New note" }, "optional", plain);
    const body = await (await pod.fetch(changed.url)).text();
    expect(
      await parseMealTtl(changed.url, body.replaceAll("https://schema.org/", "http://schema.org/")),
    ).toMatchObject({ context: "restaurant", note: "New note" });
    const s = await diary.save(symptom, "optional-s");
    await health.write(s.url, buildSymptom(s.url, { onset: at, symptomType: "fatigue" }), {
      etag: s.etag as string,
    });
    expect(await diary.read(s.url)).toMatchObject({
      severity: null,
      note: "",
      durationMinutes: null,
    });
    const withoutSeverity = await diary.save({ ...symptom, severity: null }, "unrated");
    expect(withoutSeverity).toMatchObject({ severity: null });
  });
  it("validates input and refuses unsafe paths and missing or weak versions", async () => {
    const { diary } = fixture();
    for (const range of [
      { start: at, end: at },
      { start: new Date("bad"), end: at },
      { start: at, end: new Date("bad") },
    ])
      await expect(diary.list(range)).rejects.toThrow("range");
    for (const draft of [
      { ...meal, at: new Date("bad") },
      { ...meal, note: "n".repeat(4001) },
      { ...meal, foods: [] },
      { ...meal, foods: [" "] },
      { ...meal, foods: ["a".repeat(4001)] },
      { ...meal, ingredients: "a".repeat(4001) },
      { ...meal, tags: ["a".repeat(1001)] },
      { ...symptom, symptomType: "unknown" },
      { ...symptom, severity: 1.5 },
      { ...symptom, severity: -1 },
      { ...symptom, severity: 11 },
      { ...symptom, durationMinutes: 0 },
      { ...symptom, durationMinutes: 1.5 },
      { ...symptom, durationMinutes: 525601 },
    ])
      await expect(diary.save(draft as DiaryDraft, "invalid")).rejects.toThrow();
    await expect(diary.save(meal, "../bad")).rejects.toThrow("ID");
    await expect(diary.read("https://evil.test/data.ttl")).rejects.toThrow();
    await expect(diary.read(`${diary.base}not-an-entry`)).rejects.toThrow("URL");
    const entry = await diary.save(meal, "valid");
    for (const etag of [null, 'W/"weak"', "*"]) {
      await expect(diary.save(meal, "valid", { ...entry, etag })).rejects.toThrow("version");
      await expect(diary.remove({ ...entry, etag })).rejects.toThrow("version");
    }
    await expect(diary.save(symptom, "valid", entry)).rejects.toThrow("kind");
  });
  it("surfaces transport, parse, and permission errors", async () => {
    let fail = "";
    const { diary, pod, health } = fixture(async (input, init, fetch) => {
      const url = String(input),
        method = init?.method ?? "GET";
      if (fail === "listing" && url.endsWith("diary/") && method === "GET")
        return new Response(null, { status: 403 });
      if (fail === "container" && url.endsWith("diary/") && method === "PUT")
        return new Response(null, { status: 500 });
      if (fail === "put" && url.endsWith("x.ttl") && method === "PUT")
        return new Response(null, { status: 500 });
      if (fail === "delete" && method === "DELETE") return new Response(null, { status: 500 });
      if (fail === "read" && url.endsWith("x.ttl") && method === "GET")
        return new Response(null, { status: 500 });
      return fetch(input, init);
    });
    fail = "listing";
    await expect(diary.list()).rejects.toMatchObject({ status: 403 });
    fail = "container";
    await expect(diary.save(meal, "x")).rejects.toMatchObject({ status: 500 });
    fail = "put";
    await expect(diary.save(meal, "x")).rejects.toMatchObject({ status: 500 });
    fail = "";
    const entry = await diary.save(meal, "x");
    fail = "delete";
    await expect(diary.remove(entry)).rejects.toMatchObject({ status: 500 });
    fail = "read";
    expect(await diary.list()).toEqual([]);
    fail = "";
    await pod.fetch(entry.url, {
      method: "PUT",
      body: "",
      headers: { "content-type": "text/turtle", "if-match": entry.etag as string },
    });
    await expect(diary.read(entry.url)).rejects.toThrow("could not be read");
    const s = await diary.save(symptom, "duration");
    const raw = await (await pod.fetch(s.url)).text();
    await pod.fetch(s.url, {
      method: "PUT",
      body: raw.replace("PT90M", "nonsense"),
      headers: { "content-type": "text/turtle", "if-match": s.etag as string },
    });
    await expect(diary.read(s.url)).rejects.toThrow("duration");
    await health.write(
      `${diary.base}ignored.ttl`,
      buildMeal(`${diary.base}ignored.ttl`, { startTime: at, items: [{ name: "Ignored" }] }),
      { create: true },
    );
    await pod.fetch(entry.url, { method: "DELETE" });
    await pod.fetch(s.url, { method: "DELETE" });
    expect(await diary.list()).toEqual([]);
  });
  it("re-reads a failed delete and accepts an already absent resource", async () => {
    let gone = false,
      readFailure = false;
    const { diary } = fixture(async (input, init, fetch) => {
      if (init?.method === "DELETE") {
        if (gone) await fetch(input, init);
        return new Response(null, { status: 412 });
      }
      if (readFailure && String(input).endsWith("x.ttl") && !init?.method)
        return new Response(null, { status: 503 });
      return fetch(input, init);
    });
    const entry = await diary.save(meal, "x");
    readFailure = true;
    await expect(diary.remove(entry)).rejects.toMatchObject({ status: 503 });
    readFailure = false;
    gone = true;
    await diary.remove(entry);
  });
});
it("seeds a week of diary meals and symptoms without future entries or duplicate writes", async () => {
  const pod = createDemoPod({ root: ROOT });
  const session: PodSession = {
    mode: "demo",
    fetch: pod.fetch,
    webId: OWNER,
    storageUrl: ROOT,
    displayName: "Alice",
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await ensureSample(session, at);
  const diary = createDiaryStore(pod.fetch, ROOT, OWNER);
  const entries = await diary.list();
  expect(entries).toHaveLength(23);
  expect(entries.filter((entry) => entry.kind === "symptom")).toHaveLength(3);
  expect(new Set(entries.map((entry) => entry.at.toISOString().slice(0, 10))).size).toBe(7);
  expect(entries.every((entry) => entry.at <= at)).toBe(true);
  const patterns = diaryPatterns(entries, 2, 48, at);
  expect(
    patterns.find((row) => row.food === "oats" && row.symptomType === "bloating"),
  ).toMatchObject({ followed: 3, without: 2, symptoms: 2 });
  expect(
    patterns.find((row) => row.food === "porridge" && row.symptomType === "headache"),
  ).toMatchObject({ followed: 2, without: 3, symptoms: 1 });
  const before = pod.snapshot();
  await ensureSample(session, at);
  expect(pod.snapshot()).toEqual(before);
});
it("matches reordered and renamed foods while keeping the correct per-item metadata and ingredients", () => {
  const previous = [
    { name: "Rice", offBarcode: "1", ingredientsText: "rice" },
    { name: "Sauce", offBarcode: "2", ingredientsText: "tomato" },
  ];
  expect(matchDiaryItems(["Sauce", "Rice", "Peas"], previous)).toEqual([
    previous[1],
    previous[0],
    { name: "Peas", sourceConfidence: "manual" },
  ]);
  expect(matchDiaryItems(["Rice", "New sauce"], previous)[1]).toEqual({
    ...previous[1],
    name: "New sauce",
  });
  expect(matchDiaryItems(["Sauce", "Rice", "Rice"], previous)[2]).toEqual({
    name: "Rice",
    sourceConfidence: "manual",
  });
});
function m(id: string, hour: number, foods = ["Oats"], tags = ["Breakfast"]): DiaryEntry {
  return {
    ...meal,
    url: id,
    etag: '"1"',
    at: new Date(at.getTime() + hour * 3600000),
    foods,
    tags,
  };
}
function s(id: string, hour: number, symptomType = "bloating" as const): DiaryEntry {
  return {
    ...symptom,
    url: id,
    etag: '"1"',
    at: new Date(at.getTime() + hour * 3600000),
    symptomType,
  };
}
describe("descriptive diary patterns", () => {
  it("counts a symptom only once per food or tag across overlapping meal windows", () => {
    const rows = diaryPatterns(
      [m("a", -4), m("b", 0), s("s", 4)],
      2,
      48,
      new Date(at.getTime() + 100 * 3600000),
    );
    expect(rows).toEqual([
      {
        symptomType: "bloating",
        food: "breakfast",
        kind: "tag",
        followed: 2,
        without: 0,
        symptoms: 1,
      },
      { symptomType: "bloating", food: "oats", kind: "food", followed: 2, without: 0, symptoms: 1 },
    ]);
  });
  it("counts distinct meals per food/tag with inclusive windows and complete follow-up", () => {
    const entries = [
      m("a", 0, ["Oats", " oats ", ""], ["Breakfast", "breakfast"]),
      m("b", -100),
      m("c", 99),
      s("s", 2),
      s("s2", 48),
      s("s3", 1),
      s("future", 200),
    ];
    const rows = diaryPatterns(
      entries,
      undefined,
      undefined,
      new Date(at.getTime() + 100 * 3600000),
    );
    expect(rows).toEqual([
      {
        symptomType: "bloating",
        food: "breakfast",
        kind: "tag",
        followed: 1,
        without: 1,
        symptoms: 2,
      },
      { symptomType: "bloating", food: "oats", kind: "food", followed: 1, without: 1, symptoms: 2 },
    ]);
    expect(diaryPatterns([], 0, 24)).toEqual([]);
    expect(diaryLabel(meal)).toBe("Oats, Milk");
    expect(diaryLabel({ ...symptom, symptomType: "abdominal-pain" })).toBe("abdominal pain");
  });
  it("sorts food and tag ties deterministically and validates windows", () => {
    const entries = [
      m("a", 0, ["Same", "apple"], ["Same"]),
      s("s", 4),
      { ...s("s2", 5), symptomType: "fatigue" as const },
    ];
    expect(diaryPatterns(entries, 0, 24, new Date(at.getTime() + 100 * 3600000))).toHaveLength(6);
    for (const [min, max] of [
      [NaN, 48],
      [0, NaN],
      [-1, 48],
      [2, 2],
      [0, 169],
    ])
      expect(() => diaryPatterns([], min, max)).toThrow("window");
    expect(() => diaryPatterns([], 2, 48, new Date("bad"))).toThrow("window");
  });
});
