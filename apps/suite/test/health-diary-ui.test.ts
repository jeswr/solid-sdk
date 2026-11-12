// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { buildMeal, SYMPTOM_TYPES, storeToTurtle } from "@jeswr/solid-health-diary";
import { beforeEach, expect, it, vi } from "vitest";
import { createDiaryStore, MANUAL_EXPOSURE_NOTE } from "../src/apps/health/lib/data/diary";
import { createDiaryPreferencesStore } from "../src/apps/health/lib/data/diary-preferences";
import { createHealthDataStore } from "../src/apps/health/lib/data/store";
import { diaryDay, diaryMonday, diaryWeek } from "../src/apps/health/lib/diary-time";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

// Radix portals must be imported after the DOM harness installs document.
const { HealthProvider } = await import("../src/apps/health/state/health-context");
const { DiaryCard } = await import("../src/apps/health/components/diary-card");
const { DiaryPatterns } = await import("../src/apps/health/components/diary-patterns");
const { DiaryView } = await import("../src/apps/health/components/diary-view");
const { SearchView } = await import("../src/apps/health/components/search-view");

const route = vi.hoisted(() => ({ query: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(route.query),
  usePathname: () => "/health/diary",
  useRouter: () => ({ replace: route.replace }),
}));
const ROOT = "https://diary-ui.test/",
  OWNER = `${ROOT}profile#me`;
beforeEach(() => {
  route.query = "";
  route.replace.mockClear();
  window.history.replaceState(null, "", "/health/diary");
  vi.stubGlobal("matchMedia", window.matchMedia);
});
async function eventually(assert: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => {});
      assert();
    },
    { timeout: 5000 },
  );
}
function button(name: string, root: ParentNode = document) {
  const result = [...root.querySelectorAll("button")].find(
    (element) => (element.getAttribute("aria-label") ?? element.textContent) === name,
  );
  if (!result) throw new Error(`Missing button: ${name}`);
  return result;
}
async function fill(selector: string, value: string) {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!element) throw new Error(`Missing field: ${selector}`);
  const prototype =
    element.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit() {
  const form = document.querySelector('[role="dialog"] form');
  if (!form) throw new Error("Missing diary form");
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function setup() {
  const pod = createDemoPod({ root: ROOT });
  const diary = createDiaryStore(pod.fetch, ROOT, OWNER);
  const at = new Date(Date.now() - 3 * 86400000);
  await diary.save(
    {
      kind: "meal",
      at,
      foods: ["Porridge"],
      ingredients: "oats",
      tags: ["breakfast"],
      note: "At home",
    },
    "meal",
  );
  await diary.save(
    {
      kind: "symptom",
      at: new Date(at.getTime() + 3 * 3600000),
      symptomType: "bloating",
      severity: 4,
      durationMinutes: 30,
      note: "Mild discomfort",
    },
    "symptom",
  );
  const session: PodSession = {
    mode: "demo",
    webId: OWNER,
    storageUrl: ROOT,
    displayName: "Alice",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  return { diary, session, pod };
}
it("renders mixed entries, filters by type/tag and validates and saves the meal sheet", async () => {
  const { session, diary } = await setup();
  const view = await mount(h(HealthProvider, { session, children: h(DiaryView) }));
  await eventually(() => expect(view.host.querySelectorAll("article")).toHaveLength(2));
  expect(view.host.querySelectorAll("h1")).toHaveLength(1);
  await click(button("Meals", view.host));
  expect(view.host.querySelectorAll("article")).toHaveLength(1);
  expect(view.host.textContent).not.toContain("Mild discomfort");
  await click(button("Clear", view.host));
  await click(button("breakfast", view.host));
  expect(view.host.querySelectorAll("article")).toHaveLength(1);
  await click(button("Clear", view.host));
  await click(button("Log meal", view.host));
  await submit();
  expect(document.body.textContent).toContain("Enter at least one food");
  await fill("#hlt-diary-foods", "Rice bowl");
  await fill("#hlt-diary-tags", "lunch, homemade");
  await fill("#hlt-diary-note", "Searchable diary note");
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await eventually(() => expect(view.host.textContent).toContain("Rice bowl"));
  expect((await diary.list()).filter((entry) => entry.kind === "meal")).toHaveLength(2);
});
it("offers Not recorded severity and associates a missing-date error with the date input", async () => {
  const { session, diary } = await setup();
  const view = await mount(h(HealthProvider, { session, children: h(DiaryView) }));
  await eventually(() => expect(view.host.querySelectorAll("article")).toHaveLength(2));
  await click(button("Log symptom", view.host));
  const severity = document.querySelector<HTMLSelectElement>("#hlt-diary-severity");
  expect(severity?.selectedOptions[0]?.textContent).toBe("Not recorded");
  await fill("#hlt-diary-at", "");
  await submit();
  const input = document.querySelector("#hlt-diary-at");
  expect(input?.getAttribute("aria-invalid")).toBe("true");
  expect(input?.getAttribute("aria-describedby")).toBe("hlt-diary-at-error");
  expect(document.querySelector("#hlt-diary-at-error")?.textContent).toBe(
    "Choose a date and time.",
  );
  const day = diaryDay(new Date());
  await fill("#hlt-diary-at", `${day}T09:30`);
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  const saved = (await diary.list()).find(
    (entry) => entry.at.getTime() === new Date(`${day}T09:30`).getTime(),
  );
  expect(saved).toMatchObject({ kind: "symptom", severity: null });
  await click(button("Edit bloating", view.host));
  expect(document.querySelector<HTMLSelectElement>("#hlt-diary-severity")?.value).toBe("");
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
});
it("keeps each product's ingredients and metadata when a meal's names are reordered or its note changes", async () => {
  const { session, diary } = await setup();
  await diary.save(
    {
      kind: "meal",
      at: new Date(),
      foods: ["Milk", "Apricots"],
      ingredients: "milk\napricots",
      tags: [],
      note: "",
      items: [
        {
          name: "Milk",
          ingredientsText: "milk",
          offBarcode: "123",
          sourceConfidence: "off",
          declaredAllergen: ["en:milk"],
        },
        { name: "Apricots", ingredientsText: "apricots", offCategory: ["en:dried-apricots"] },
      ],
    },
    "products",
  );
  const view = await mount(h(HealthProvider, { session, children: h(DiaryView) }));
  await eventually(() => expect(view.host.textContent).toContain("Milk, Apricots"));
  await click(button("Edit Milk, Apricots", view.host));
  expect(document.querySelector<HTMLTextAreaElement>("#hlt-diary-ingredients-0")?.value).toBe(
    "milk",
  );
  expect(document.querySelector<HTMLTextAreaElement>("#hlt-diary-ingredients-1")?.value).toBe(
    "apricots",
  );
  await fill("#hlt-diary-ingredients-1", "apricots, sulphites");
  await fill("#hlt-diary-foods", "Apricots\nMilk");
  expect(document.querySelector<HTMLTextAreaElement>("#hlt-diary-ingredients-0")?.value).toBe(
    "apricots, sulphites",
  );
  expect(document.querySelector<HTMLTextAreaElement>("#hlt-diary-ingredients-1")?.value).toBe(
    "milk",
  );
  await fill("#hlt-diary-note", "Shared snack");
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  const saved = (await diary.list()).find((entry) => entry.note === "Shared snack");
  expect(saved?.kind === "meal" && saved.items).toMatchObject([
    {
      name: "Apricots",
      ingredientsText: "apricots, sulphites",
      offCategory: ["en:dried-apricots"],
    },
    {
      name: "Milk",
      ingredientsText: "milk",
      offBarcode: "123",
      sourceConfidence: "off",
      declaredAllergen: ["en:milk"],
    },
  ]);
});
it("uses local dates in the week, grouping, displayed times and search links, including DST", async () => {
  vi.stubEnv("TZ", "Pacific/Honolulu");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
  try {
    const { session, diary } = await setup();
    const entry = await diary.save(
      {
        kind: "meal",
        at: new Date("2026-11-01T03:15:00Z"),
        foods: ["Local oats"],
        ingredients: "",
        tags: [],
        note: "",
      },
      "local",
    );
    route.query = "date=2026-10-31";
    const view = await mount(h(HealthProvider, { session, children: h(DiaryView) }));
    await eventually(() =>
      expect(view.host.querySelector(`#diary-${encodeRef(entry.url)}`)).not.toBeNull(),
    );
    const article = document.getElementById(`diary-${encodeRef(entry.url)}`);
    expect(article?.closest("section")?.getAttribute("aria-label")).toBe("Diary for 2026-10-31");
    expect(article?.querySelector("time")?.textContent).toBe("17:15");
    expect(view.host.textContent).toContain("2026-10-25 – 2026-10-31 · local time");
    await view.render(
      h(HealthProvider, { session, children: h(SearchView, { query: "Local oats" }) }),
    );
    await eventually(() =>
      expect(view.host.querySelector('a[href*="date=2026-10-31"]')).not.toBeNull(),
    );
    expect(diaryMonday(new Date("2026-11-02T08:00:00Z")).toISOString()).toBe(
      "2026-10-26T10:00:00.000Z",
    );
    expect(diaryWeek(new Date("2026-11-02T08:00:00Z"), "2026-02-30", 0)).toEqual(
      diaryWeek(new Date("2026-11-02T08:00:00Z"), "bad", 0),
    );
    expect(diaryWeek(new Date("2026-11-02T08:00:00Z"), "2099-01-01", 0)).toEqual(
      diaryWeek(new Date("2026-11-02T08:00:00Z"), null, 0),
    );
    vi.stubEnv("TZ", "America/New_York");
    const range = diaryWeek(new Date("2026-11-02T03:00:00Z"), null, 0);
    expect(range.end.getTime() - range.start.getTime()).toBe(169 * 3600000);
    vi.stubEnv("TZ", "America/Sao_Paulo");
    const midnightGap = diaryWeek(new Date("2018-11-04T12:00:00Z"), null, 0);
    expect(midnightGap.start.toISOString()).toBe("2018-10-29T03:00:00.000Z");
    expect(midnightGap.end.toISOString()).toBe("2018-11-05T02:00:00.000Z");
  } finally {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  }
});
it("resets pagination for a changed date, advances to today and focuses an anchor after async loading", async () => {
  const { session, diary } = await setup();
  const old = new Date();
  old.setDate(old.getDate() - 20);
  const entry = await diary.save(
    { kind: "meal", at: old, foods: ["Anchored meal"], ingredients: "", tags: [], note: "" },
    "anchor",
  );
  route.query = `date=${diaryDay(old)}`;
  window.history.replaceState(
    null,
    "",
    `/health/diary?${route.query}#diary-${encodeRef(entry.url)}`,
  );
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  const view = await mount(h(HealthProvider, { session, children: h(DiaryView) }));
  await eventually(() => expect(document.activeElement?.id).toBe(`diary-${encodeRef(entry.url)}`));
  expect(scroll).toHaveBeenCalled();
  expect(button("Next week", view.host).disabled).toBe(false);
  await click(button("Previous week", view.host));
  route.query = `date=${diaryDay(new Date())}`;
  await view.render(h(HealthProvider, { session, children: h(DiaryView) }));
  await eventually(() => expect(view.host.querySelectorAll("article")).toHaveLength(2));
  expect(button("Next week", view.host).disabled).toBe(true);
  route.query = `date=${diaryDay(old)}`;
  await view.render(h(HealthProvider, { session, children: h(DiaryView) }));
  await eventually(() => expect(view.host.textContent).toContain("Anchored meal"));
  for (let i = 0; i < 3; i++) await click(button("Next week", view.host));
  await eventually(() => expect(button("Next week", view.host).disabled).toBe(true));
  expect(view.host.textContent).toContain(diaryDay(new Date()));
});
it("shares the diary listing with search and keeps results when a Health source or diary entry fails", async () => {
  const { session, diary, pod } = await setup();
  const unreadable = await diary.save(
    {
      kind: "symptom",
      at: new Date(),
      symptomType: "fatigue",
      severity: null,
      durationMinutes: null,
      note: "Unreadable",
    },
    "broken",
  );
  const reads: string[] = [];
  const scopedSession = {
    ...session,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method) {
        if (url.includes("/diary/")) reads.push(url);
        if (url === unreadable.url || url.endsWith("/medications/"))
          return new Response(null, { status: 403 });
      }
      return pod.fetch(input, init);
    },
  };
  const view = await mount(h(HealthProvider, { session: scopedSession, children: h(DiaryView) }));
  await eventually(() => expect(view.host.textContent).toContain("1 entry couldn't be read"));
  expect(view.host.querySelectorAll("article")).toHaveLength(2);
  const before = reads.length;
  await view.render(
    h(HealthProvider, {
      session: scopedSession,
      children: h(SearchView, { query: "Mild discomfort" }),
    }),
  );
  await eventually(() =>
    expect(view.host.querySelector(".hlt-search-results")?.textContent).toContain("bloating"),
  );
  expect(reads).toHaveLength(before);
  expect(view.host.textContent).toContain("Some Health records couldn't be read");
  expect(view.host.textContent).toContain("1 entry couldn't be read");
  await view.render(h(HealthProvider, { session: scopedSession, children: h(DiaryPatterns) }));
  await eventually(() => expect(view.host.textContent).toContain("1 entry couldn't be read"));
  await view.render(h(HealthProvider, { session: scopedSession, children: h(DiaryCard) }));
  await eventually(() => expect(view.host.textContent).toContain("1 entry couldn't be read"));
  expect(
    (await createHealthDataStore(pod.fetch, ROOT, OWNER).read(unreadable.url)).etag,
  ).not.toBeNull();
});
it("shows pattern counts and the dashboard summary, and finds notes in Health search", async () => {
  const { session } = await setup();
  const view = await mount(h(HealthProvider, { session, children: h(DiaryPatterns) }));
  await eventually(() => expect(view.host.querySelectorAll("tbody tr")).toHaveLength(2));
  expect(view.host.textContent).toContain("not a diagnosis or medical advice");
  const row = view.host.querySelector("tbody tr");
  expect([...(row?.querySelectorAll("td") ?? [])].slice(1).map((cell) => cell.textContent)).toEqual(
    ["1", "0", "1"],
  );
  await fill("#hlt-pattern-min", "49");
  await act(async () =>
    view.host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("Enter a window");
  await view.render(h(HealthProvider, { session, children: h(DiaryCard) }));
  await eventually(() => expect(view.host.textContent).toContain("Last entry: bloating"));
  await view.render(
    h(HealthProvider, { session, children: h(SearchView, { query: "Mild discomfort" }) }),
  );
  await eventually(() =>
    expect(view.host.querySelector('a[href^="/health/diary?date="]')?.textContent).toContain(
      "bloating",
    ),
  );
});

it("enables Coeliac for a visit, logs suspected exposure and keeps tracking only on request", async () => {
  const { session, diary, pod } = await setup();
  route.query = "mode=coeliac";
  const view = await mount(h(HealthProvider, { session, children: h(DiaryView) }));
  await eventually(() => expect(button("Keep it on", view.host).disabled).toBe(false));
  const preferences = createDiaryPreferencesStore(pod.fetch, ROOT, OWNER);
  expect((await preferences.read()).enabled).toBe(false);
  await click(button("Log meal", view.host));
  await fill("#hlt-diary-foods", "Possible gluten");
  const exposure = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (input) => input.closest("label")?.textContent?.includes("Contains gluten"),
  );
  if (!exposure) throw new Error("Missing gluten toggle");
  await click(exposure);
  const suspected = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (input) => input.closest("label")?.textContent?.includes("Suspected exposure"),
  );
  if (!suspected) throw new Error("Missing suspected toggle");
  await click(suspected);
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  const saved = (await diary.list()).find(
    (entry) => entry.kind === "meal" && entry.foods.includes("Possible gluten"),
  );
  expect(saved?.kind === "meal" && saved.exposures).toMatchObject([
    { trigger: "gluten", exposureLevel: "possible-undeclared" },
  ]);
  await click(button("Log symptom", view.host));
  expect(
    [...document.querySelectorAll<HTMLOptionElement>("#hlt-diary-type option")].map(
      (option) => option.value,
    ),
  ).toEqual(SYMPTOM_TYPES);
  await click(button("Cancel"));
  await act(async () => {
    const trigger = view.host.querySelector<HTMLSelectElement>("#hlt-diary-trigger");
    if (!trigger) throw new Error("Missing trigger selector");
    trigger.value = "lactose";
    trigger.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect((await preferences.read()).enabled).toBe(false);
  await click(button("Keep it on", view.host));
  await eventually(() =>
    expect(view.host.textContent).not.toContain("Food intolerance tracking is on for this visit."),
  );
  expect(await preferences.read()).toEqual({ enabled: true, trigger: "lactose" });
  await view.render(h(HealthProvider, { session, children: h(DiaryPatterns) }));
  await eventually(() =>
    expect(view.host.querySelector('[aria-label="Likely triggers"]')?.textContent).toContain(
      "of 1 exposures",
    ),
  );
  expect(view.host.textContent).toContain(
    "This is information, not medical advice — decision support, not diagnosis. Always discuss anything here with your clinician.",
  );
});
it("shows legacy Coeliac entries with their source note and no edit or delete action", async () => {
  const { session, pod } = await setup();
  const folder = `${ROOT}health/diary/meals/`,
    url = `${folder}legacy.ttl`;
  await pod.fetch(folder, { method: "PUT", headers: { "content-type": "text/turtle" }, body: "" });
  await pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await storeToTurtle(
      buildMeal(url, { startTime: new Date(), items: [{ name: "Legacy toast" }] }),
    ),
  });
  const view = await mount(h(HealthProvider, { session, children: h(DiaryView) }));
  await eventually(() => expect(view.host.textContent).toContain("Legacy toast"));
  const legacy = [...view.host.querySelectorAll("article")].find((article) =>
    article.textContent?.includes("Legacy toast"),
  );
  expect(legacy?.textContent).toContain("Logged in the Coeliac app");
  expect(legacy?.querySelectorAll("button")).toHaveLength(0);
});

it("retains legacy reads after a suite edit and refreshes them on a matching notification", async () => {
  const { session, pod } = await setup();
  const folder = `${ROOT}health/diary/meals/`,
    url = `${folder}legacy.ttl`;
  await pod.fetch(folder, { method: "PUT", headers: { "content-type": "text/turtle" }, body: "" });
  const legacyBody = async (name: string) =>
    storeToTurtle(buildMeal(url, { startTime: new Date(), items: [{ name }] }));
  await pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await legacyBody("Old toast"),
  });
  const gets: string[] = [];
  const listeners = new Set<(url: string) => void>();
  const release = deferred<void>();
  let pauseSave = false,
    savingPaused = false;
  const subscribe: PodSession["subscribe"] = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (!init?.method || init.method === "GET") gets.push(String(input));
    if (pauseSave && init?.method === "PUT" && String(input).endsWith("/meal.ttl")) {
      savingPaused = true;
      await release.promise;
    }
    return pod.fetch(input, init);
  };
  const view = await mount(
    h(HealthProvider, { session: { ...session, fetch, subscribe }, children: h(DiaryView) }),
  );
  await eventually(() => expect(button("Edit Porridge", view.host).disabled).toBe(false));
  expect(view.host.textContent).toContain("Old toast");
  await click(button("Edit Porridge", view.host));
  await fill("#hlt-diary-note", "A suite edit");
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await eventually(() => expect(view.host.textContent).toContain("A suite edit"));
  expect(gets.filter((value) => value === url)).toHaveLength(1);
  pauseSave = true;
  await click(button("Edit Porridge", view.host));
  await fill("#hlt-diary-note", "A second suite edit");
  await submit();
  await eventually(() => expect(savingPaused).toBe(true));
  await pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await legacyBody("Fresh toast"),
  });
  await act(async () => {
    for (const callback of listeners) {
      callback(`${ROOT}health/diary/2026-11/`);
      callback(folder);
    }
    release.resolve();
  });
  await eventually(() => expect(view.host.textContent).toContain("Fresh toast"));
  expect(gets.filter((value) => value === url)).toHaveLength(2);
});

function checkbox(label: string) {
  const input = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (element) => element.closest("label")?.textContent?.includes(label),
  );
  if (!input) throw new Error(`Missing checkbox: ${label}`);
  return input;
}
it("waits for late settings before Log/Edit and preserves the stored trigger's manual exposure", async () => {
  const { session, diary, pod } = await setup();
  const preferences = createDiaryPreferencesStore(pod.fetch, ROOT, OWNER);
  await preferences.save({ enabled: true, trigger: "lactose" });
  await diary.save(
    {
      kind: "meal",
      at: new Date(),
      foods: ["Manual milk"],
      ingredients: "",
      tags: [],
      note: "",
      exposures: [{ trigger: "lactose", exposureLevel: "present", note: MANUAL_EXPOSURE_NOTE }],
    },
    "manual",
  );
  const gate = deferred<void>();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input) === preferences.url && (!init?.method || init.method === "GET"))
      await gate.promise;
    return pod.fetch(input, init);
  };
  const view = await mount(
    h(HealthProvider, { session: { ...session, fetch }, children: h(DiaryView) }),
  );
  await eventually(() => expect(view.host.textContent).toContain("Manual milk"));
  expect(button("Log meal", view.host).disabled).toBe(true);
  expect(button("Log symptom", view.host).disabled).toBe(true);
  expect(button("Edit Manual milk", view.host).disabled).toBe(true);
  await act(async () => gate.resolve());
  await eventually(() => expect(button("Edit Manual milk", view.host).disabled).toBe(false));
  await click(button("Edit Manual milk", view.host));
  expect(checkbox("Contains lactose").checked).toBe(true);
  for (const trigger of ["gluten", "lactose"]) {
    await act(async () => {
      const select = view.host.querySelector<HTMLSelectElement>("#hlt-diary-trigger");
      if (!select) throw new Error("Missing trigger selector");
      select.value = trigger;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await eventually(() =>
      expect(checkbox(`Contains ${trigger}`).checked).toBe(trigger === "lactose"),
    );
  }
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  const saved = (await diary.list()).find(
    (entry) => entry.kind === "meal" && entry.foods[0] === "Manual milk",
  );
  expect(saved?.kind === "meal" && saved.exposures).toMatchObject([
    { trigger: "lactose", note: MANUAL_EXPOSURE_NOTE },
  ]);
});
it("keeps derived exposures off the manual toggle and recalculates them after an ingredient edit", async () => {
  const { session, diary, pod } = await setup();
  await createDiaryPreferencesStore(pod.fetch, ROOT, OWNER).save({
    enabled: true,
    trigger: "sulphites",
  });
  await diary.save(
    {
      kind: "meal",
      at: new Date(),
      foods: ["Recipe"],
      ingredients: "sulphur dioxide",
      tags: [],
      note: "",
    },
    "derived",
  );
  const view = await mount(h(HealthProvider, { session, children: h(DiaryView) }));
  await eventually(() => expect(button("Edit Recipe", view.host).disabled).toBe(false));
  await click(button("Edit Recipe", view.host));
  expect(checkbox("Contains sulphites").checked).toBe(false);
  await fill("#hlt-diary-note", "Still derived");
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  let saved = (await diary.list()).find((entry) => entry.note === "Still derived");
  expect(saved?.kind === "meal" && saved.exposures?.[0]).toMatchObject({ trigger: "sulphites" });
  expect(saved?.kind === "meal" && saved.exposures?.[0]?.note).not.toBe(MANUAL_EXPOSURE_NOTE);
  await click(button("Edit Recipe", view.host));
  await fill("#hlt-diary-ingredients-0", "rice flour");
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  saved = (await diary.list()).find((entry) => entry.note === "Still derived");
  expect(saved?.kind === "meal" && saved.exposures).toEqual([]);
});
it("turns visit-only tracking off locally, removes only mode from the URL and makes no settings write", async () => {
  const { session, pod } = await setup();
  route.query = "mode=coeliac&date=2026-11-11";
  window.history.replaceState(null, "", `/health/diary?${route.query}#diary-entry`);
  const writes: string[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    if (init?.method === "PUT" && String(input).endsWith("/diary-settings.ttl"))
      writes.push(String(input));
    return pod.fetch(input, init);
  };
  const view = await mount(
    h(HealthProvider, { session: { ...session, fetch }, children: h(DiaryView) }),
  );
  await eventually(() => expect(button("Keep it on", view.host).disabled).toBe(false));
  await click(checkbox("Track a food intolerance"));
  expect(checkbox("Track a food intolerance").checked).toBe(false);
  expect(route.replace).toHaveBeenCalledWith("/health/diary?date=2026-11-11#diary-entry", {
    scroll: false,
  });
  expect(writes).toEqual([]);
});
it("keeps settings disabled but allows logging and exposure-preserving edits after a settings read error", async () => {
  const { session, pod, diary } = await setup();
  const preferences = createDiaryPreferencesStore(pod.fetch, ROOT, OWNER);
  await preferences.save({ enabled: true, trigger: "lactose" });
  const meal = (await diary.list()).find((entry) => entry.kind === "meal");
  if (meal?.kind !== "meal") throw new Error("Missing meal");
  await diary.save(
    {
      ...meal,
      exposures: [{ trigger: "lactose", exposureLevel: "present", note: MANUAL_EXPOSURE_NOTE }],
    },
    "meal",
    meal,
  );
  route.query = "mode=coeliac";
  let fail = true;
  const writes: string[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    if (init?.method === "PUT" && String(input).endsWith("/diary-settings.ttl"))
      writes.push(String(input));
    if (fail && String(input) === preferences.url && (!init?.method || init.method === "GET"))
      return Promise.resolve(new Response(null, { status: 503 }));
    return pod.fetch(input, init);
  };
  const view = await mount(
    h(HealthProvider, { session: { ...session, fetch }, children: h(DiaryView) }),
  );
  await eventually(() => expect(view.host.textContent).toContain("Couldn't load diary settings"));
  expect(checkbox("Track a food intolerance").disabled).toBe(true);
  expect(button("Log meal", view.host).disabled).toBe(false);
  expect(button("Log symptom", view.host).disabled).toBe(false);
  expect(button("Edit Porridge", view.host).disabled).toBe(false);
  await click(button("Log meal", view.host));
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Contains gluten");
  await fill("#hlt-diary-foods", "Rice during settings outage");
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await click(button("Log symptom", view.host));
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await click(button("Edit Porridge", view.host));
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Contains gluten");
  await fill("#hlt-diary-note", "Edited during settings outage");
  await submit();
  await eventually(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  const edited = await diary.read(meal.url);
  expect(edited.kind === "meal" && edited.exposures).toMatchObject([
    { trigger: "lactose", exposureLevel: "present", note: MANUAL_EXPOSURE_NOTE },
  ]);
  expect(view.host.textContent).toContain("Couldn't load diary settings");
  expect(button("Retry diary settings", view.host).disabled).toBe(false);
  expect(writes).toEqual([]);
  fail = false;
  await click(button("Retry diary settings", view.host));
  await eventually(() => expect(checkbox("Track a food intolerance").disabled).toBe(false));
  expect(view.host.querySelector<HTMLSelectElement>("#hlt-diary-trigger")?.value).toBe("lactose");
  expect(writes).toEqual([]);
});

it("revalidates legacy listings on storage-root notifications and retries failed documents", async () => {
  const { session, pod } = await setup();
  const folder = `${ROOT}health/diary/meals/${new Date().toISOString().slice(0, 7).replace("-", "/")}/`;
  const original = `${folder}original.ttl`,
    added = `${folder}added.ttl`;
  for (const path of ["meals/", `meals/${new Date().getUTCFullYear()}/`, folder]) {
    await pod.fetch(path.startsWith(ROOT) ? path : `${ROOT}health/diary/${path}`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "",
    });
  }
  const put = async (url: string, name: string) =>
    pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await storeToTurtle(buildMeal(url, { startTime: new Date(), items: [{ name }] })),
    });
  await put(original, "Original meal");
  const gets: string[] = [],
    listeners = new Set<(url: string) => void>();
  let fail = false;
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = String(input);
    if (!init?.method) {
      if (url.includes("/diary/meals/") || url.includes("/diary/symptoms/")) gets.push(url);
      if (fail && url === added) return Promise.resolve(new Response(null, { status: 503 }));
    }
    return pod.fetch(input, init);
  };
  const subscribe: PodSession["subscribe"] = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  };
  const view = await mount(
    h(HealthProvider, { session: { ...session, fetch, subscribe }, children: h(DiaryView) }),
  );
  await eventually(() => expect(view.host.textContent).toContain("Original meal"));
  await put(added, "Added elsewhere");
  gets.length = 0;
  await act(async () => {
    for (const notify of listeners) notify(ROOT);
  });
  await eventually(() => expect(view.host.textContent).toContain("Added elsewhere"));
  expect(gets.filter((url) => !url.endsWith("/"))).toEqual([added]);
  // A targeted notification discards this document, then focus retries its failed read.
  fail = true;
  await act(async () => {
    for (const notify of listeners) notify(added);
  });
  await eventually(() => expect(view.host.textContent).toContain("1 entry couldn't be read"));
  fail = false;
  gets.length = 0;
  await act(async () => {
    for (const notify of listeners) notify(ROOT);
  });
  await eventually(() => {
    expect(view.host.textContent).toContain("Added elsewhere");
    expect(view.host.textContent).not.toContain("1 entry couldn't be read");
  });
  expect(gets.filter((url) => !url.endsWith("/"))).toEqual([added]);
});
