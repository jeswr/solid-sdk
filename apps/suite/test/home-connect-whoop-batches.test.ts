// AUTHORED-BY Codex GPT-6
import { createMemoryPod, TEST_POD_ROOT, TEST_WEBID } from "@jeswr/pod-connectors/testing";
import { NS } from "@jeswr/suite-vocab";
import { beforeEach, expect, it, vi } from "vitest";
import { act, click, h, mount } from "./drive-ui-dom";

vi.mock("@jeswr/pod-connectors", async (original) => {
  const connectors = await original<typeof import("@jeswr/pod-connectors")>();
  const { createWhoopFileAdapter } = await import("@jeswr/pod-connectors/adapters/whoop");
  const adapter = createWhoopFileAdapter(2);
  return {
    ...connectors,
    fileAdapterById: (id: string) => (id === "whoop" ? adapter : connectors.fileAdapterById(id)),
  };
});
let session: { webId: string; storageUrl: string; fetch: typeof fetch };
vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => session }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

import { ConnectFlow } from "../src/apps/home/components/connect/flow";

beforeEach(() => localStorage.clear());
function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label} button`);
  return found;
}
it("announces partial file imports and resumes the same export after Sync again", async () => {
  const pod = createMemoryPod();
  session = { webId: TEST_WEBID, storageUrl: TEST_POD_ROOT, fetch: pod.fetch };
  const { host } = await mount(h(ConnectFlow, { service: "whoop" }));
  await click(button(host, "Continue"));
  await click(button(host, "Import an export file"));
  const text =
    "Sleep onset,Wake onset,Asleep duration (min)\n" +
    [1, 2, 3]
      .map((day) => `2026-06-0${day}T22:00:00Z,2026-06-0${day + 1}T06:00:00Z,450`)
      .join("\n");
  const upload = async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Missing file input");
    Object.defineProperty(input, "files", { value: [new File([text], "sleeps.csv")] });
    await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    await vi.waitFor(() =>
      expect(host.querySelector(".hm-connect-result h2")?.textContent).toMatch(/Added/),
    );
  };
  await upload();
  const warning = "WHOOP import partial, re-run to continue.";
  expect(host.querySelector(".hm-connect-result")?.textContent).toContain(warning);
  expect(host.querySelector('[role="status"]')?.textContent).toContain(warning);
  await click(button(host, "Sync again"));
  await click(button(host, "Continue"));
  await upload();
  expect(host.textContent).not.toContain(warning);
  const data = pod.dataset(`${TEST_POD_ROOT}integrations/whoop/health/observations/2026-06.ttl`);
  expect(data.getQuads(null, `${NS.RDF}type`, `${NS.HEALTH}SleepObservation`, null)).toHaveLength(
    3,
  );
});
