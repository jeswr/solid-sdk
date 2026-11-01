// AUTHORED-BY Codex
import { expect, it } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import {
  measureUsage,
  recentFiles,
  searchByName,
} from "../src/apps/drive/lib/operations/operations";
import { exclusiveLocks } from "./drive-locks";
import { DRIVE, OWNER, PRIVATE, ROOT, wacPod } from "./drive-wac-pod";

it.each([
  "Recent",
  "Search",
  "usage",
] as const)("%s rejects root and descendant listing failures and can be queried again", async (view) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const query = () =>
    view === "Recent"
      ? recentFiles(client, [DRIVE])
      : view === "Search"
        ? searchByName(client, DRIVE, "secret")
        : measureUsage(client, DRIVE);
  for (const failed of [DRIVE, PRIVATE]) {
    f.intercept(async (url, init) =>
      url === failed && (init?.method ?? "GET") === "GET"
        ? new Response(null, { status: 503 })
        : undefined,
    );
    await expect(query()).rejects.toMatchObject({ status: 503, url: failed });
    f.intercept(undefined);
    const result = await query();
    if (typeof result === "number") expect(result).toBeGreaterThan(0);
    else expect(result.some((item) => item.name === "secret")).toBe(true);
  }
});

it("provisions a missing nested ancestor without re-entering its own flight", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await client.write(
    `${DRIVE}missing/nested/file`,
    "secret contents",
    { contentType: "text/plain", ifNoneMatch: "*" },
    { kind: "protect-ancestors" },
  );
  expect((await f.anonymous(`${DRIVE}missing/nested/file`)).status).toBe(403);
});

it("exclusive Web Locks queue FIFO per name and release after errors", async () => {
  const locks = exclusiveLocks();
  const gate = Promise.withResolvers<void>();
  const order: string[] = [];
  const first = locks.request("a", async () => {
    order.push("first");
    await gate.promise;
    throw new Error("failed work");
  });
  const rejected = expect(first).rejects.toThrow("failed work");
  const second = locks.request("a", () => order.push("second"));
  const third = locks.request("a", () => order.push("third"));
  await locks.request("b", () => order.push("other name"));
  expect(order).toEqual(["first", "other name"]);
  gate.resolve();
  await Promise.all([rejected, second, third]);
  expect(order).toEqual(["first", "other name", "second", "third"]);
});

it("exclusive Web Locks fail fast on a nested acquisition of the same name", async () => {
  const locks = exclusiveLocks(30);
  await expect(locks.request("nested", () => locks.request("nested", () => {}))).rejects.toThrow(
    "Web Lock timed out: nested",
  );
});
