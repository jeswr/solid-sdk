// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, expect, it, vi } from "vitest";
import { createDiaryStore } from "../src/apps/health/lib/data/diary";
import { createHealthDataStore } from "../src/apps/health/lib/data/store";
import { diaryDay, diaryMonday, diaryWeek } from "../src/apps/health/lib/diary-time";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, mount } from "./drive-ui-dom";

// Radix portals must be imported after the DOM harness installs document.
const { HealthProvider } = await import("../src/apps/health/state/health-context");
const { DiaryCard } = await import("../src/apps/health/components/diary-card");
const { DiaryPatterns } = await import("../src/apps/health/components/diary-patterns");
const { DiaryView } = await import("../src/apps/health/components/diary-view");
const { SearchView } = await import("../src/apps/health/components/search-view");

const route = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(route.query) }));
const ROOT = "https://diary-ui.test/",
  OWNER = `${ROOT}profile#me`;
beforeEach(() => {
  route.query = "";
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
