// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { PlacesRepository } from "@jeswr/solid-places";
import { beforeEach, expect, it, vi } from "vitest";
import { sampleWeek } from "../src/apps/places/demo/sample";
import { placesController } from "../src/apps/places/state/controller";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({ native: false, read: vi.fn() }));
vi.mock("@jeswr/suite-native", () => ({ isNativeApp: () => mocks.native }));
vi.mock("../src/apps/places/lib/import-worker", () => ({ readTimeline: mocks.read }));
const { ImportView } = await import("../src/apps/places/components/import-view");
const { PlaceDetail, PlacesList, TimelineView, StatsView } = await import(
  "../src/apps/places/components/views"
);
const { entities } = await import("@jeswr/solid-places");
const place = {
  url: "https://pod.example/places/places/p.ttl",
  etag: '"1"',
  data: { ...sampleWeek().places[0]!.data, saved: true },
};
const snapshot = {
  places: [place],
  visits: [
    {
      url: "https://pod.example/visit.ttl",
      etag: null,
      data: {
        place: entities.Place.subject(place.url),
        source: "manual" as const,
        startTime: new Date("2026-07-01T23:30:00Z"),
        endTime: new Date("2026-07-02T00:30:00Z"),
      },
    },
  ],
  journeys: [],
};
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === name,
  );
  expect(found, name).toBeDefined();
  return found!;
}
const text = () => document.body.textContent ?? "";
vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
vi.stubGlobal("DocumentFragment", window.DocumentFragment);
beforeEach(() => {
  mocks.native = false;
  mocks.read.mockReset();
});
it("associates the category label and exposes the saved icon as an image", async () => {
  const ui = await mount(h(PlaceDetail, { place, snapshot, offline: false, save: vi.fn() }));
  const label = [...document.querySelectorAll("label")].find(
    (item) => item.textContent === "Category",
  )!;
  expect(label.htmlFor).toBeTruthy();
  expect(document.getElementById(label.htmlFor)?.getAttribute("role")).toBe("combobox");
  await ui.render(h(PlacesList, { snapshot, query: "", select: vi.fn() }));
  expect(document.querySelector('[role="img"][aria-label="Saved"]')).not.toBeNull();
});
it.each([
  false,
  true,
])("only offers an opt-in embedded map on the web (native=%s)", async (native) => {
  mocks.native = native;
  await mount(h(PlaceDetail, { place, snapshot, offline: false, save: vi.fn() }));
  expect(document.querySelector("iframe")).toBeNull();
  expect(document.querySelector('a[href^="https://www.openstreetmap.org/"]')).not.toBeNull();
  if (native) expect(text()).not.toContain("Show on map");
  else {
    await click(button("Show on map"));
    expect(document.querySelector("iframe")).not.toBeNull();
    await click(button("Hide map"));
    expect(document.querySelector("iframe")).toBeNull();
  }
});
it("shows local dates and times, and selects the local month for stats", async () => {
  // The suite test environment uses Europe/London: 23:30Z in July is 00:30 the next day.
  const ui = await mount(h(TimelineView, { snapshot, select: vi.fn() }));
  expect(document.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe("2026-07-02");
  expect(document.querySelector("time")?.textContent).toBe("00:30");
  expect(text()).toContain("your local time zone");
  expect(text()).not.toContain("UTC");
  await ui.render(
    h(StatsView, {
      snapshot: {
        ...snapshot,
        visits: snapshot.visits.map((row) => ({
          ...row,
          data: {
            ...row.data,
            startTime: new Date("2026-07-31T23:30:00Z"),
            endTime: new Date("2026-08-01T00:30:00Z"),
          },
        })),
      },
    }),
  );
  expect(document.querySelector<HTMLInputElement>('input[type="month"]')?.value).toBe("2026-08");
  expect(text()).toContain("Periods use your local time zone");
});
it("retains preview, progress and cancellation after the import view unmounts", async () => {
  const saved = deferred<void>();
  let signal!: AbortSignal;
  const repo: PlacesRepository = {
    base: "https://pod.example/places/",
    initialize: vi.fn(async () => {}),
    load: vi.fn(async () => snapshot),
    savePlace: vi.fn(),
    importTimeline: vi.fn(async (_data, progress, active) => {
      signal = active!;
      progress!(1, 26);
      await saved.promise;
      signal.throwIfAborted();
    }),
  };
  const controller = placesController(repo, false, vi.fn());
  await controller.open();
  mocks.read.mockResolvedValue(sampleWeek());
  const ui = await mount(h(ImportView, { controller, offline: false }));
  await act(async () => {
    await controller.readFile(new File(["{}"], "Timeline.json"));
  });
  expect(text()).toContain("Preview · Timeline.json");
  await click(button("Import into my private pod"));
  expect(text()).toContain("Saving 1 of 26 records");
  await ui.render(h("p", {}, "Timeline tab"));
  expect(signal.aborted).toBe(false);
  await ui.render(h(ImportView, { controller, offline: false }));
  expect(text()).toContain("Saving 1 of 26 records");
  expect(text()).toContain("Preview · Timeline.json");
  await click(button("Cancel import"));
  expect(signal.aborted).toBe(true);
  await act(async () => {
    saved.resolve();
    await saved.promise;
  });
  expect(text()).toContain("Records already saved are kept");
  controller.dispose();
});
it("keeps file reading in the controller and ignores superseded or disposed reads", async () => {
  const repo = {
    base: "https://pod.example/places/",
    initialize: vi.fn(),
    load: vi.fn(async () => snapshot),
    savePlace: vi.fn(),
    importTimeline: vi.fn(),
  } satisfies PlacesRepository;
  const controller = placesController(repo, false, vi.fn());
  const first = deferred<ReturnType<typeof sampleWeek>>();
  const second = deferred<ReturnType<typeof sampleWeek>>();
  mocks.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = controller.readFile(new File(["{}"], "one.json"));
  const b = controller.readFile(new File(["{}"], "two.json"));
  expect(mocks.read.mock.calls[0]![1].aborted).toBe(true);
  first.reject(new Error("Obsolete"));
  await a;
  expect(controller.getSnapshot().import.filename).toBe("two.json");
  controller.cancelImport();
  second.reject(new DOMException("Aborted", "AbortError"));
  await b;
  expect(controller.getSnapshot().import.error).toBe("Reading cancelled.");
  mocks.read.mockRejectedValueOnce(new Error("Invalid JSON"));
  await controller.readFile(new File(["{"], "bad.json"));
  expect(controller.getSnapshot().import.error).toBe("Invalid JSON");
  controller.dispose();
  const calls = mocks.read.mock.calls.length;
  await controller.readFile(new File([], "closed.json"));
  expect(mocks.read).toHaveBeenCalledTimes(calls);
});
