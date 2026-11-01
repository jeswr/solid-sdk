// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { AgentRow, PermissionsSnapshot } from "../src/apps/home/lib/permissions";
import {
  createPeopleNameResolver,
  initialPermissionsState,
  permissionsReducer,
  readPermissionsView,
  technicalDetailsEnabled,
  writePermissionsView,
} from "../src/apps/home/state/permissions";

const line = {
  key: "files",
  dataType: { id: "files", label: "Files" },
  domainId: "documents",
  resources: [],
  role: "viewer" as const,
  modes: ["read" as const],
  inherited: false,
};
const bob: AgentRow = { key: "bob", id: "https://bob.test/card#me", kind: "person", lines: [line] };
const snapshot: PermissionsSnapshot = {
  rows: [bob],
  failures: [],
  truncated: false,
  summary: { people: 1, apps: 0, publicItems: 0 },
};
const loaded = () => permissionsReducer(initialPermissionsState, { type: "loaded", snapshot });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("permissions state reducer", () => {
  it("loads snapshots, reports failure, and resets the previous identity", () => {
    const state = loaded();
    expect(state.status).toBe("ready");
    expect(state.rows).toEqual([bob]);
    expect(permissionsReducer(state, { type: "error" }).status).toBe("error");
    expect(permissionsReducer(state, { type: "reset" })).toBe(initialPermissionsState);
    expect(permissionsReducer(state, { type: "undo-start" }).busy).toBe(true);
  });
  it("flips a line immediately, retains it through refresh, and removes it on collapse", () => {
    let state = permissionsReducer(loaded(), { type: "start", row: bob, line });
    expect(state.busy).toBe(true);
    expect(state.removed.files?.token).toBeUndefined();
    // Collapsing during a write must not remove a line before its result is known.
    expect(permissionsReducer(state, { type: "collapse", key: bob.key }).rows).toHaveLength(1);
    state = permissionsReducer(state, { type: "line-done", key: line.key, token: "undo1" });
    const empty = { ...snapshot, rows: [] };
    state = permissionsReducer(state, { type: "loaded", snapshot: empty });
    expect(state.rows[0]?.lines).toEqual([line]);
    const ownRow = permissionsReducer(state, { type: "loaded", snapshot });
    expect(ownRow.rows[0]?.lines).toEqual([line]);
    const secondLine = { ...line, key: "contacts" };
    const fresh = { ...snapshot, rows: [{ ...bob, lines: [secondLine] }] };
    expect(permissionsReducer(state, { type: "loaded", snapshot: fresh }).rows[0]?.lines).toEqual([
      secondLine,
      line,
    ]);
    state = permissionsReducer(state, { type: "collapse", key: bob.key });
    expect(state.rows).toEqual([]);
    expect(state.removed).toEqual({});
  });
  it("restores only the failed line, preserves other revoked lines, and ignores stale completions", () => {
    const other = { ...line, key: "contacts" };
    let state = permissionsReducer(loaded(), { type: "start", row: bob, line: other });
    state = permissionsReducer(state, { type: "line-done", key: other.key, token: "other" });
    state = permissionsReducer(state, { type: "start", row: bob, line });
    state = permissionsReducer(state, { type: "write-error", key: line.key });
    expect(state.removed.files).toBeUndefined();
    expect(state.removed.contacts?.token).toBe("other");
    state = permissionsReducer(state, { type: "line-done", key: "missing", token: "old" });
    expect(Object.keys(state.removed)).toEqual(["contacts"]);
    state = permissionsReducer(state, { type: "undo-done", token: "other" });
    expect(state.removed).toEqual({});
  });
  it("removes an entire row after a confirmed write while preserving other people", () => {
    const alice = { ...bob, key: "alice" };
    let state = permissionsReducer(loaded(), {
      type: "loaded",
      snapshot: { ...snapshot, rows: [bob, alice] },
    });
    state = permissionsReducer(state, { type: "start", row: bob, line });
    state = permissionsReducer(state, { type: "row-done", keys: [bob.key] });
    expect(state.rows).toEqual([alice]);
    expect(state.removed).toEqual({});
    state = permissionsReducer(state, { type: "start", row: alice });
    expect(state.busy).toBe(true);
    expect(permissionsReducer(state, { type: "write-error" }).busy).toBe(false);
  });
});

describe("public names and local preferences", () => {
  it("coalesces public profile reads, uses foaf:name then vcard:fn, and omits credentials", async () => {
    const plain = vi.fn<typeof fetch>(
      async () =>
        new Response(
          '@prefix foaf: <http://xmlns.com/foaf/0.1/>. <https://bob.test/card#me> foaf:name "Bob".',
          { headers: { "content-type": "text/turtle" } },
        ),
    );
    vi.stubGlobal("fetch", plain);
    const resolve = createPeopleNameResolver();
    expect(await Promise.all([resolve(bob.id), resolve(bob.id)])).toEqual(["Bob", "Bob"]);
    expect(plain).toHaveBeenCalledTimes(1);
    expect(plain.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit", redirect: "error" });
    plain.mockResolvedValueOnce(
      new Response(
        '<https://person.test/card#me> <http://xmlns.com/foaf/0.1/name> <urn:bad>; <http://www.w3.org/2006/vcard/ns#fn> "Person".',
        { headers: { "content-type": "text/turtle" } },
      ),
    );
    expect(await resolve("https://person.test/card#me")).toBe("Person");
    plain.mockRejectedValueOnce(new Error("offline"));
    expect(await resolve("https://missing.test/card#me")).toBeUndefined();
    expect(await resolve("https://missing.test/card#me")).toBeUndefined();
    expect(await resolve("urn:unsupported")).toBeUndefined();
  });
  it("persists only view and technical preferences, tolerating unavailable storage", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(readPermissionsView()).toBe("overview");
    writePermissionsView("advanced");
    expect(values.get("suite.permissions.view")).toBe("advanced");
    expect(readPermissionsView()).toBe("advanced");
    expect(technicalDetailsEnabled()).toBe(false);
    values.set("suite.settings.advanced", "1");
    expect(technicalDetailsEnabled()).toBe(true);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(readPermissionsView()).toBe("overview");
    expect(technicalDetailsEnabled()).toBe(false);
    expect(() => writePermissionsView("overview")).not.toThrow();
  });
});
