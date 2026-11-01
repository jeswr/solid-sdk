// AUTHORED-BY Claude Opus 5.5
import { expect, it, vi } from "vitest";
import { useDrivePreferences } from "../src/apps/drive/state/prefs";
import { act, h, mount } from "./drive-ui-dom";

it("keeps a preference change when storage refuses to save it", async () => {
  const values = new Map<string, string>();
  const original = globalThis.localStorage;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
  });
  let state: ReturnType<typeof useDrivePreferences> | undefined;
  function Probe() {
    state = useDrivePreferences("https://pod.example/profile#me");
    return null;
  }
  const view = await mount(h(Probe));
  await act(async () => {
    state?.[1]((current) => ({ ...current, starred: ["https://pod.example/drive/A.txt"] }));
  });
  expect(state?.[0].starred).toEqual(["https://pod.example/drive/A.txt"]);
  await act(async () => {
    state?.[1]((current) => ({ ...current, view: "grid" }));
  });
  expect(state?.[0]).toMatchObject({ view: "grid", starred: ["https://pod.example/drive/A.txt"] });
  await view.unmount();
  vi.stubGlobal("localStorage", original);
});
