// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { DriveDeletePendingError, deletionControl } from "../src/apps/drive/lib/client/deletion";
import { deletionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import { DRIVE, PRIVATE, ROOT, wacPod } from "./drive-wac-pod";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };

afterEach(() => vi.unstubAllGlobals());

it("pending source and recovery requirements survive module reload and transport recreation", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await wacPod();
  const source = `${PRIVATE}secret`;
  const recovery = `${DRIVE}public/recovery`;
  let deferred: RequestInit | undefined;
  f.intercept(async (url, init) => {
    if (url === source && init?.method === "DELETE") {
      deferred = init;
      return new Response(null, { status: 202 });
    }
    return undefined;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(client.move(source, recovery, { kind: "preserve-source" })).rejects.toMatchObject({
    kind: "partial-failure",
  });
  expect(await deletionLedger(f.fetch).get(source)).toEqual({ sources: [source], recovery });
  vi.resetModules();
  const { createSolidDriveClient: create } = await import("../src/apps/drive/lib/client/client");
  const { deletionLedger: freshLedger } = await import(
    "../src/apps/drive/lib/client/protection-ledger"
  );
  const transport: typeof fetch = (input, init) => f.fetch(input, init);
  const fresh = create({ storageUrl: ROOT, fetch: transport });
  expect(await freshLedger(transport).get(recovery)).toEqual({ sources: [source] });
  await expect(fresh.remove(recovery)).rejects.toMatchObject({ kind: "delete-pending" });
  await expect(
    fresh.write(source, "new bytes", { contentType: "text/plain" }, { kind: "protect-ancestors" }),
  ).rejects.toMatchObject({ kind: "delete-pending" });
  expect(f.pod.has(recovery)).toBe(true);
  if (!deferred) throw new Error("No deferred request");
  f.intercept(undefined);
  await f.fetch(source, deferred);
  await fresh.move(recovery, source, { kind: "preserve-source" });
  expect(await (await fresh.read(source)).text()).toBe("secret contents");
  expect(await freshLedger(transport).get(recovery)).toBeUndefined();
  expect(await freshLedger(transport).get(source)).toBeUndefined();
});

it.each([
  202, 205, 302, 408,
])("a non-terminal DELETE %s is pending until confirmed", async (status) => {
  const url = "https://delete.test/file";
  const http = vi.fn<typeof fetch>(
    async (_input, init) =>
      new Response(null, { status: init?.method === "DELETE" ? status : 200 }),
  );
  const control = deletionControl(http, (status) => new Error(String(status)));
  await expect(control.remove(url, '"original"')).rejects.toBeInstanceOf(DriveDeletePendingError);
  expect(await deletionLedger(http).get(url)).toBeDefined();
  expect(http.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  await expect(control.remove(url, '"original"')).rejects.toMatchObject({ kind: "delete-pending" });
  expect(http.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
});

it("absence confirmation retires deletion state without discarding a provisioner's ACL archive", async () => {
  const { protectionLedger } = await import("../src/apps/drive/lib/client/protection-ledger");
  const url = "https://delete.test/folder/";
  const http: typeof fetch = async () => new Response(null, { status: 404 });
  const requirement = { acl: `${url}.acl`, from: url, turtle: "archive" };
  await protectionLedger(http).set(url, requirement);
  // Use one module identity after the preceding reload regression.
  const { deletionControl: control } = await import("../src/apps/drive/lib/client/deletion");
  const { deletionLedger: pending } = await import(
    "../src/apps/drive/lib/client/protection-ledger"
  );
  await pending(http).set(url, { sources: [url] });
  await control(http, () => new Error()).guard(url);
  expect(await pending(http).get(url)).toBeUndefined();
  expect(await protectionLedger(http).get(url)).toEqual(requirement);
});

it.each([
  403, 503,
])("a rejected DELETE %s leaves payloads intact and releases its pending intent", async (status) => {
  const url = "https://delete.test/source";
  const recovery = "https://delete.test/recovery";
  const http: typeof fetch = async () => new Response(null, { status });
  const control = deletionControl(http, (status) => new Error(`Rejected ${status}`));
  await expect(control.remove(url, '"original"', recovery)).rejects.toThrow(`Rejected ${status}`);
  expect(await deletionLedger(http).get(url)).toBeUndefined();
  expect(await deletionLedger(http).get(recovery)).toBeUndefined();
  await expect(control.remove(url, '"original"')).rejects.toThrow(`Rejected ${status}`);
});
