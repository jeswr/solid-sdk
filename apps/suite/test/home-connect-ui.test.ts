// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

let session: { webId: string; storageUrl: string; fetch: typeof fetch };

vi.mock("../src/apps/home/components/home-app", () => ({
  useHomeSession: () => session,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

import { ConnectCatalogue } from "../src/apps/home/components/connect/catalogue";
import { registry } from "../src/apps/home/components/connect/config";
import { ConnectFlow } from "../src/apps/home/components/connect/flow";

beforeEach(async () => {
  localStorage.clear();
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.parse("2026-11-01T12:00:00Z")),
  });
  session = { webId: DEMO_WEBID, storageUrl: DEMO_ROOT, fetch: pod.fetch };
});
afterEach(() => vi.restoreAllMocks());

function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label} button`);
  return found;
}

it.each([
  [[{ header: "Calendar", title: "Meeting" }], "Added 1 item to Calendar", ["calendar"]],
  [
    [
      { header: "Calendar", title: "Meeting" },
      { header: "Google", title: "Note" },
      { header: "Calendar", title: "Lunch" },
    ],
    "Added 3 items to Documents, Calendar",
    ["documents", "calendar"],
  ],
] as const)("links to the domains written by Takeout %j", async (activities, heading, domains) => {
  const { host } = await mount(h(ConnectFlow, { service: "google-takeout" }));
  await click(button(host, "Continue"));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Missing export input");
  Object.defineProperty(input, "files", {
    value: [new File([JSON.stringify(activities)], "MyActivity.json")],
  });
  await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  await vi.waitFor(() =>
    expect(host.querySelector(".hm-connect-result h2")?.textContent).toBe(heading),
  );
  expect(
    [...host.querySelectorAll(".hm-connect-actions a")].map((link) => link.getAttribute("href")),
  ).toEqual(domains.map((domain) => `/home/${domain}`));
});

it("completes rides-only Strava imports in Mobility without an empty Health destination", async () => {
  const adapter = registry.adapterById("strava");
  if (!adapter) throw new Error("Missing Strava adapter");
  const url = "https://www.strava.com/api/v3/athlete/activities";
  vi.spyOn(registry, "adapterById").mockReturnValue({
    ...adapter,
    fixtures: () => [
      {
        url,
        json: [
          { id: 1, name: "Morning ride", sport_type: "Ride", start_date: "2026-11-01T09:00:00Z" },
        ],
      },
      { url, json: [] },
    ],
  });
  const { host } = await mount(h(ConnectFlow, { service: "strava" }));
  await click(button(host, "Continue"));
  await click(button(host, "Continue with Strava"));
  await vi.waitFor(() =>
    expect(host.querySelector(".hm-connect-result h2")?.textContent).toBe(
      "Added 1 item to Mobility",
    ),
  );
  expect(
    [...host.querySelectorAll(".hm-connect-actions a")].map((link) => link.getAttribute("href")),
  ).toEqual(["/home/mobility"]);
});

it.each([
  "discord",
  "reddit",
  "dropbox",
])("explains and fixes the required identity permission for %s", async (service) => {
  const { host } = await mount(h(ConnectFlow, { service }));
  const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  const identity = boxes.find((box) => box.disabled);
  if (!identity) throw new Error("Missing required identity permission");
  expect(identity.checked).toBe(true);
  expect(identity.parentElement?.textContent).toContain(
    "Required to identify your account before importing.",
  );
  for (const box of boxes.filter((box) => !box.disabled)) await click(box);
  expect(identity.checked).toBe(true);
  expect(boxes.filter((box) => !box.disabled).every((box) => !box.checked)).toBe(true);
  const next = host.querySelector<HTMLButtonElement>(".hm-connect-result > button");
  expect(next?.disabled).toBe(false);
});

it("honours the shell shortcut setting at each keypress and tolerates blocked storage", async () => {
  const { host } = await mount(h(ConnectCatalogue));
  const search = host.querySelector<HTMLInputElement>('input[type="search"]');
  const link = host.querySelector<HTMLAnchorElement>("a");
  if (!link || !search) throw new Error("Missing Connect controls");
  link.focus();
  localStorage.setItem("suite.settings.shortcuts", "off");
  await key(link, "n");
  expect(document.activeElement).toBe(link);
  localStorage.setItem("suite.settings.shortcuts", "on");
  await key(link, "n");
  expect(document.activeElement).toBe(search);
  await act(() => link.focus());
  vi.spyOn(Object.getPrototypeOf(localStorage), "getItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  await key(link, "n");
  expect(document.activeElement).toBe(search);
});

function liveRegion(host: HTMLElement) {
  const regions = host.querySelectorAll(".hm-connect-flow [role='status']");
  expect(regions).toHaveLength(1);
  return regions[0] as HTMLElement;
}
function heading(host: HTMLElement, text: string) {
  const found = [...host.querySelectorAll("h2")].find((item) => item.textContent === text);
  if (!found) throw new Error(`Missing ${text} heading`);
  return found;
}

it("announces the result through one mounted live region and moves focus to each panel heading", async () => {
  const { host } = await mount(h(ConnectFlow, { service: "strava" }));
  const region = liveRegion(host);
  expect(region.textContent).toBe("");
  // The initial panel never steals focus on page load.
  expect(document.activeElement).toBe(document.body);
  await click(button(host, "Continue"));
  expect(document.activeElement).toBe(heading(host, "Sign in to Strava"));
  await click(button(host, "Continue with Strava"));
  await vi.waitFor(() => expect(host.querySelector(".hm-connect-actions")).not.toBeNull());
  const result = host.querySelector(".hm-connect-result h2");
  expect(document.activeElement).toBe(result);
  expect(result?.getAttribute("tabindex")).toBe("-1");
  expect(liveRegion(host)).toBe(region);
  expect(region.textContent).toBe(`${result?.textContent}.`);
  expect(host.querySelector("h1")?.hasAttribute("tabindex")).toBe(false);
  await click(button(host, "Sync again"));
  expect(document.activeElement).toBe(heading(host, "Choose what to sync"));
  expect(liveRegion(host)).toBe(region);
});

it("focuses the error result heading and announces the failure", async () => {
  const { host } = await mount(h(ConnectFlow, { service: "netflix" }));
  const region = liveRegion(host);
  await click(button(host, "Continue"));
  expect(document.activeElement).toBe(heading(host, "Import a file"));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Missing export input");
  Object.defineProperty(input, "files", {
    value: [new File(['Title,Date\n"unfinished'], "NetflixViewingHistory.csv")],
  });
  await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(heading(host, "Netflix sync didn't finish")),
  );
  expect(region.textContent).toMatch(/^Netflix sync didn't finish\. /);
  await click(button(host, "Try again"));
  expect(document.activeElement).toBe(heading(host, "Choose what to sync"));
});

it("focuses the cancelled result heading and announces the incomplete sync", async () => {
  const adapter = registry.adapterById("strava");
  if (!adapter) throw new Error("Missing Strava adapter");
  const entered = deferred<void>();
  vi.spyOn(registry, "adapterById").mockReturnValue({
    ...adapter,
    async import(ctx) {
      ctx.progress({ label: "Fetching activities…", done: 1, total: 4 });
      entered.resolve();
      // Waits (like a rate-limit backoff) until the run's signal cancels it.
      await new Promise((_, reject) =>
        ctx.signal?.addEventListener("abort", () => reject(ctx.signal?.reason)),
      );
      return {};
    },
  });
  const { host } = await mount(h(ConnectFlow, { service: "strava" }));
  const region = liveRegion(host);
  await click(button(host, "Continue"));
  await click(button(host, "Continue with Strava"));
  await act(() => entered.promise);
  // The adapter reported a step total, so the live region counts against it.
  expect(region.textContent).toBe("Imported 1 of 4 collections");
  expect(document.activeElement).toBe(heading(host, "Importing"));
  await click(button(host, "Cancel"));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(heading(host, "Last sync incomplete")),
  );
  expect(region.textContent).toBe("Last sync incomplete. Items already added are kept.");
});

it("shows a visible offline note on the catalogue in an always-mounted status region", async () => {
  const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const { host } = await mount(h(ConnectCatalogue));
  const region = host.querySelector<HTMLElement>("[role='status']");
  expect(region?.textContent).toBe("You're offline. Reconnect to connect services.");
  expect(host.querySelectorAll('[title="Reconnect to connect services"]').length).toBeGreaterThan(
    0,
  );
  onLine.mockReturnValue(true);
  await act(() => window.dispatchEvent(new Event("online")));
  expect(host.querySelector("[role='status']")).toBe(region);
  expect(region?.textContent).toBe("");
});
