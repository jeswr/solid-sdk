// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { MemorySharingAdapter } from "../src/shell/share/memory-adapter";
import { ShareError, type SharingState } from "../src/shell/share/types";

const initial: SharingState = {
  people: [
    { webId: "https://example.org/owner", role: "owner" },
    {
      webId: "https://example.org/inherited",
      role: "viewer",
      inherited: { from: "https://example.org/", fromName: "Parent" },
    },
  ],
  general: { mode: "restricted" },
  canManage: true,
};
const signal = () => new AbortController().signal;
describe("memory sharing", () => {
  it("isolates resources and snapshots, writes roles/duration/general, notifies and requests", async () => {
    const adapter = new MemorySharingAdapter(initial, 0);
    const loaded = await adapter.load("one", signal());
    loaded.people.length = 0;
    expect((await adapter.load("one", signal())).people).toHaveLength(2);
    const expires = new Date("2027-01-01");
    await adapter.setPerson("one", "https://example.org/friend", "editor", {
      expires,
      purpose: "Planning",
    });
    expect((await adapter.load("one", signal())).people[2]).toMatchObject({
      role: "editor",
      expires,
    });
    expect((await adapter.load("two", signal())).people).toHaveLength(2);
    expect(adapter.purposes.get("one")?.get("https://example.org/friend")).toBe("Planning");
    await adapter.setPerson("one", "https://example.org/friend", "viewer");
    await adapter.setGeneral("one", { mode: "link", role: "viewer" });
    expect((await adapter.load("one", signal())).general.mode).toBe("link");
    await adapter.notify("one", ["https://example.org/friend"], "Hello");
    await adapter.requestAccess("one", { role: "viewer", purpose: "Planning" });
    expect(adapter.notifications).toHaveLength(1);
    expect(adapter.requests).toHaveLength(1);
    await adapter.setPerson("one", "https://example.org/friend", null);
    expect((await adapter.load("one", signal())).people).toHaveLength(2);
  });
  it("refuses owner/inherited changes, read-only, and non-managers", async () => {
    const adapter = new MemorySharingAdapter(initial, 0);
    for (const webId of ["https://example.org/owner", "https://example.org/inherited"])
      await expect(adapter.setPerson("one", webId, null)).rejects.toMatchObject({
        code: "forbidden",
      });
    for (const readOnly of ["forbidden", "offline", undefined] as const) {
      const locked = new MemorySharingAdapter(
        { ...initial, canManage: false, ...(readOnly ? { readOnly } : {}) },
        0,
      );
      await expect(locked.setGeneral("one", { mode: "link" })).rejects.toBeInstanceOf(ShareError);
    }
  });
  it("injects each failure once without mutating, and aborts loading", async () => {
    const adapter = new MemorySharingAdapter(initial, 1);
    for (const code of ["forbidden", "network"] as const) {
      adapter.failNext(code);
      await expect(adapter.setGeneral("one", { mode: "link" })).rejects.toMatchObject({ code });
      expect((await adapter.load("one", signal())).general.mode).toBe("restricted");
    }
    const abort = new AbortController();
    const pending = adapter.load("one", abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(adapter.load("one", abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
