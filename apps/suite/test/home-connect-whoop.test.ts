// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { createMemoryPod, TEST_POD_ROOT, TEST_WEBID } from "@jeswr/pod-connectors/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, click, h, mount } from "./drive-ui-dom";

let session: { webId: string; storageUrl: string; fetch: typeof fetch };
vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => session }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

// Exercise the Tier B flow with its real adapter made available by the host.
vi.mock("../src/apps/home/components/connect/config", async (original) => {
  const config = await original<typeof import("../src/apps/home/components/connect/config")>();
  const { catalogue } = await import("../src/apps/home/lib/connect/catalogue");
  return {
    ...config,
    entries: catalogue(config.registry, true).map((entry) =>
      entry.id === "garmin" ? { ...entry, status: "demo" } : entry,
    ),
  };
});

import { ConnectFlow } from "../src/apps/home/components/connect/flow";

beforeEach(() => {
  localStorage.clear();
  session = { webId: TEST_WEBID, storageUrl: TEST_POD_ROOT, fetch: createMemoryPod().fetch };
});
afterEach(() => vi.restoreAllMocks());
function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label} button`);
  return found;
}

it("offers a real WHOOP export import beside its demo/API connection", async () => {
  const { host } = await mount(h(ConnectFlow, { service: "whoop" }));
  await click(button(host, "Continue"));
  await click(button(host, "Import an export file"));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Missing WHOOP export input");
  expect(input.accept).toContain(".zip");
  expect(host.textContent).toContain("Data Export");
  const text =
    "Sleep onset,Wake onset,Asleep duration (min)\n2026-06-07T22:00:00Z,2026-06-08T06:00:00Z,450";
  Object.defineProperty(input, "files", { value: [new File([text], "sleeps.csv")] });
  await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  await vi.waitFor(() =>
    expect(host.querySelector(".hm-connect-result h2")?.textContent).toMatch(
      /Added .*Body & Health/,
    ),
  );
  const saved = Object.keys(localStorage)
    .filter((key) => key.includes("whoop"))
    .map((key) => localStorage.getItem(key))
    .join("\n");
  expect(saved).toContain('"mode":"file"');
});

// AUTHORED-BY Codex GPT-6
it("lists only the WHOOP scopes used by the import", async () => {
  const { host } = await mount(h(ConnectFlow, { service: "whoop" }));
  // Four data scopes; `offline` is no longer requested because refresh is not implemented.
  expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(4);
  expect(host.textContent).not.toContain("Your WHOOP profile");
  expect(host.textContent).not.toContain("Keep the connection available");
});

it.each([
  ["whoop", "WHOOP"],
  ["garmin", "Garmin"],
])("returns from file mode to the %s connection", async (service, name) => {
  const { host } = await mount(h(ConnectFlow, { service }));
  await click(button(host, "Continue"));
  await click(button(host, "Import an export file"));
  expect(host.querySelector('input[type="file"]')).not.toBeNull();
  await click(button(host, `Use ${name} connection`));
  expect(host.querySelector('input[type="file"]')).toBeNull();
  expect(button(host, "Import an export file")).toBeDefined();
});
