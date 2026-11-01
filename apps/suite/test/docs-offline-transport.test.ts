// @vitest-environment jsdom
// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { getDemoPod, resetDemoPod } from "../src/lib/demo-pod/browser";
import { DEMO_ROOT } from "../src/lib/demo-pod/seed";

it("rejects demo pod reads and update writes while the browser is offline", async () => {
  const pod = await getDemoPod();
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    await expect(pod.fetch(DEMO_ROOT)).rejects.toThrow("offline");
    await expect(
      pod.fetch(`${DEMO_ROOT}docs/transport/updates/failed.bin`, { method: "PUT", body: "update" }),
    ).rejects.toThrow("offline");
    online.mockReturnValue(true);
    expect((await pod.fetch(DEMO_ROOT)).ok).toBe(true);
    expect(pod.has(`${DEMO_ROOT}docs/transport/updates/failed.bin`)).toBe(false);
  } finally {
    online.mockRestore();
    await resetDemoPod();
  }
});
