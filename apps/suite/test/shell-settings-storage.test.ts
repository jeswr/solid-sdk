// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { diagnostics } from "../src/shell/lib/settings-diagnostics";
import { clearSavedCopies } from "../src/shell/lib/settings-offline";
import { defaultPreferences } from "../src/shell/lib/settings-preferences";

describe("clearing saved copies", () => {
  it("deletes suite copies and preserves unrelated caches, demo originals and sessions", async () => {
    const cacheStorage = {
      keys: vi.fn(async () => ["suite-files", "other-cache", "suite-shell"]),
      delete: vi.fn(async (_name: string) => true),
    };
    const deleted: string[] = [];
    const databaseFactory = {
      databases: async () => [
        { name: "suite-offline" },
        { name: "solid-suite-demo" },
        { name: "other" },
        {},
      ],
      deleteDatabase(name: string) {
        deleted.push(name);
        const request = {} as IDBOpenDBRequest;
        queueMicrotask(() => request.onsuccess?.call(request, new Event("success")));
        return request;
      },
    };
    await clearSavedCopies({ cacheStorage, databaseFactory });
    expect(cacheStorage.delete.mock.calls.map(([name]) => name)).toEqual([
      "suite-files",
      "suite-shell",
    ]);
    expect(deleted).toEqual(["suite-offline"]);
    await expect(clearSavedCopies({})).resolves.toBeUndefined();
    await expect(clearSavedCopies({ cacheStorage })).resolves.toBeUndefined();
  });
  it.each(["error", "blocked"] as const)("reports database %s", async (eventName) => {
    const databaseFactory = {
      databases: async () => [{ name: "suite-files" }],
      deleteDatabase() {
        const request = {} as IDBOpenDBRequest;
        queueMicrotask(() => {
          if (eventName === "blocked")
            request.onblocked?.call(request, new Event("blocked") as IDBVersionChangeEvent);
          else request.onerror?.call(request, new Event("error"));
        });
        return request;
      },
    };
    await expect(clearSavedCopies({ databaseFactory })).rejects.toThrow(
      eventName === "blocked" ? "Close other" : "Couldn't clear",
    );
  });
  it("reports unavailable enumeration and browser storage failures", async () => {
    await expect(
      clearSavedCopies({ databaseFactory: { deleteDatabase: vi.fn() } as unknown as IDBFactory }),
    ).rejects.toThrow("can't list");
    await expect(
      clearSavedCopies({
        cacheStorage: {
          keys: async () => {
            throw new Error("unavailable");
          },
          delete: vi.fn(),
        },
      }),
    ).rejects.toThrow("unavailable");
  });
});

describe("diagnostics", () => {
  it("exports valid, redacted JSON without account identifiers or resource references", () => {
    const result = diagnostics({
      version: "preview",
      route: "/drive/f/private-reference?account=https://example.org/me#person",
      caps: { move: true, serverSearch: false },
      preferences: { ...defaultPreferences, theme: "dark" },
    });
    expect(JSON.parse(result)).toEqual({
      version: "preview",
      route: "/drive/f/[ref]",
      capabilities: { move: true, serverSearch: false },
      preferences: { ...defaultPreferences, theme: "dark" },
    });
    expect(result).not.toContain("example.org");
    expect(result).not.toContain("private-reference");
  });
  it("redacts hostile strings, strips unknown preference data and ignores non-boolean caps", () => {
    const result = diagnostics({
      version: 'preview https://example.org/me#person "quoted"',
      route: "/settings/advanced?url=https://example.org",
      caps: {
        move: true,
        liveUpdates: "https://example.org",
        "https://example.org/private": true,
      } as never,
      preferences: { ...defaultPreferences, webId: "https://example.org/me#person" } as never,
    });
    expect(result).not.toContain("example.org");
    expect(JSON.parse(result).version).toContain("<redacted>");
    expect(JSON.parse(result).preferences).toEqual(defaultPreferences);
    expect(JSON.parse(result).capabilities).toEqual({ move: true });
  });
});
