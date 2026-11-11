// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { recordingStorage } from "../../../test/storage";
import { StorageError } from "@jeswr/storage-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureContainer, ensureDiaryReady, putResource, resetDiaryReadyMemo } from "./pod-fs";

const ROOT = "https://alice.example/";
const OWNER = "https://alice.example/profile/card#me";


beforeEach(() => resetDiaryReadyMemo());

describe("ensureDiaryReady", () => {
  it("writes an OWNER-ONLY ACL on the diary root BEFORE any other container", async () => {
    const { storage, calls } = recordingStorage();
    await ensureDiaryReady(storage, ROOT, OWNER);

    const aclPut = calls.find((c) => c.method === "PUT" && c.url.endsWith("/health/diary/.acl"));
    expect(aclPut).toBeTruthy();
    // No public / agentClass grant anywhere in the ACL body (fail-closed).
    expect(aclPut?.body ?? "").not.toMatch(/agentClass|foaf:Agent|Public/i);
    // The owner IS granted.
    expect(aclPut?.body ?? "").toContain(OWNER);

    // The ACL is written before the meals container PUT.
    const aclIndex = calls.findIndex((c) => c.url.endsWith("/health/diary/.acl") && c.method === "PUT");
    const mealsIndex = calls.findIndex((c) => c.url.endsWith("/health/diary/meals/") && c.method === "PUT");
    expect(aclIndex).toBeGreaterThanOrEqual(0);
    expect(mealsIndex).toBeGreaterThan(aclIndex);
  });

  it("is memoised — a second call issues no further requests", async () => {
    const { storage, calls } = recordingStorage();
    await ensureDiaryReady(storage, ROOT, OWNER);
    const countAfterFirst = calls.length;
    await ensureDiaryReady(storage, ROOT, OWNER);
    expect(calls.length).toBe(countAfterFirst);
  });

  it("does not provision descendants after an ACL failure and retries instead of memoising it", async () => {
    const acl = `${ROOT}health/diary/.acl`;
    let denied = true;
    const { storage } = recordingStorage(ROOT, (call) => {
      if (call.url === acl && denied) {
        throw new StorageError("forbidden", { status: 403, url: acl, method: "PUT" });
      }
    });
    await expect(ensureDiaryReady(storage, ROOT, OWNER)).rejects.toThrow(
      `owner-only ACL write failed: PUT ${acl} -> 403 Forbidden`,
    );
    await expect(storage.head(`${ROOT}health/diary/meals/`)).rejects.toMatchObject({ status: 404 });
    denied = false;
    await ensureDiaryReady(storage, ROOT, OWNER);
    expect((await storage.head(`${ROOT}health/diary/meals/`)).kind).toBe("container");
  });

  it("provisions a second injected client even when its root and owner are identical", async () => {
    const first = recordingStorage();
    const second = recordingStorage();
    await ensureDiaryReady(first.storage, ROOT, OWNER);
    await ensureDiaryReady(second.storage, ROOT, OWNER);
    expect(await (await second.storage.read(`${ROOT}health/diary/.acl`)).text()).toContain(OWNER);
  });
});

describe("ensureContainer", () => {
  it("skips the PUT when the container already exists (HEAD 200)", async () => {
    const { storage } = recordingStorage();
    await storage.create(ROOT, null, { kind: "container", name: "health" });
    await storage.create(`${ROOT}health/`, null, { kind: "container", name: "diary" });
    vi.mocked(storage.create).mockClear();
    await ensureContainer(storage, "https://alice.example/health/diary/");
    expect(storage.create).not.toHaveBeenCalled();
  });

  it("tolerates only a concurrent name-taken container create (412)", async () => {
    const { storage } = recordingStorage();
    vi.mocked(storage.create).mockRejectedValueOnce(new StorageError(
      "conflict",
      { status: 412, url: `${ROOT}notes/`, method: "PUT" },
    ));
    await expect(ensureContainer(storage, `${ROOT}notes/`)).resolves.toBeUndefined();
  });

  it("surfaces a real HTTP 409 instead of pretending the container exists", async () => {
    const { storage } = recordingStorage();
    const failure = new StorageError("conflict", {
      status: 409, url: `${ROOT}notes/`, method: "PUT",
    });
    vi.mocked(storage.create).mockRejectedValueOnce(failure);
    await expect(ensureContainer(storage, `${ROOT}notes/`)).rejects.toMatchObject({
      name: "PodWriteError", status: 409, cause: failure,
    });
  });

  it("still attempts conditional creation when HEAD is unavailable", async () => {
    const { storage } = recordingStorage();
    vi.mocked(storage.head).mockRejectedValueOnce(new StorageError("forbidden", {
      status: 403, url: `${ROOT}notes/`, method: "HEAD",
    }));
    await ensureContainer(storage, `${ROOT}notes/`);
    expect(storage.create).toHaveBeenCalledWith(ROOT, null, { kind: "container", name: "notes" });
  });

  it("never converts an SDK scope rejection into a container create", async () => {
    const { storage } = recordingStorage();
    const failure = new StorageError("scope", { url: `${ROOT}notes/`, method: "HEAD" });
    vi.mocked(storage.head).mockRejectedValueOnce(failure);
    await expect(ensureContainer(storage, `${ROOT}notes/`)).rejects.toBe(failure);
    expect(storage.create).not.toHaveBeenCalled();
  });

  it("rejects foreign container URLs before traversing their parents", async () => {
    const { storage } = recordingStorage();
    await expect(ensureContainer(storage, "https://foreign.example/notes/"))
      .rejects.toMatchObject({ code: "scope" });
    expect(storage.head).toHaveBeenCalledTimes(1);
    expect(storage.create).not.toHaveBeenCalled();
  });
});

it("preserves the UI write error and retains the SDK failure as its cause", async () => {
  const { storage } = recordingStorage();
  const url = `${ROOT}denied.ttl`;
  const failure = new StorageError("forbidden", { status: 403, url, method: "PUT" });
  vi.mocked(storage.write).mockRejectedValueOnce(failure);
  await expect(putResource(storage, url, "")).rejects.toMatchObject({
    name: "PodWriteError", status: 403, url,
    message: `Pod write to ${url} failed: HTTP 403`, cause: failure,
  });
});

it.each([
  ["network", "Failed to fetch"],
  ["scope", "Storage location is outside this pod"],
  ["unsupported", "Unsupported storage operation"],
] as const)("gives a status-less %s write failure a stable short message", async (code, message) => {
  const { storage } = recordingStorage();
  const url = `${ROOT}private-meal.ttl`;
  const failure = new StorageError(code, { url, method: "PUT" });
  vi.mocked(storage.write).mockRejectedValueOnce(failure);
  await expect(putResource(storage, url, "")).rejects.toMatchObject({ message, cause: failure });
});
