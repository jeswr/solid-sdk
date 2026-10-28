// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { Compensation, commitIrreversible } from "../src/apps/drive/lib/client/commit";
import { restoreItems, trashItems, uploadFile } from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { DRIVE, OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

it.each([
  "access",
  "identity",
  "mutation",
  "later bookkeeping",
])("compensation remains usable only before commit when %s fails", async (failure) => {
  const undo = vi.fn(async () => {});
  const compensation = new Compensation(undo);
  await commitIrreversible({ step: async () => {}, arm: [compensation] });
  const calls: string[] = [];
  const phase = async (name: string) => {
    calls.push(name);
    if (name === failure) throw new Error(name);
  };
  await expect(
    commitIrreversible({
      rechecks: [() => phase("access")],
      identityChecks: [() => phase("identity")],
      step: () => phase("mutation"),
      disarm: [compensation],
      onCommit: () => {
        calls.push("later bookkeeping");
        throw new Error("later bookkeeping");
      },
    }),
  ).rejects.toThrow(failure);
  await compensation.rollback();
  await compensation.rollback();
  expect(undo).toHaveBeenCalledTimes(failure === "later bookkeeping" ? 0 : 1);
  expect(calls).toEqual(
    ["access", "identity", "mutation", "later bookkeeping"].slice(
      0,
      ["access", "identity", "mutation", "later bookkeeping"].indexOf(failure) + 1,
    ),
  );
});

it("all Drive overwrites and deletes follow their final conditional identity check without intervening requests", async () => {
  const f = await rdfPod();
  const requests: { url: string; method: string; headers: Headers }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
    });
    return f.fetch(input, init);
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch, webId: OWNER });
  const source = `${PRIVATE}secret`;
  await uploadFile(
    client,
    PRIVATE,
    new Blob(["replacement"]),
    "secret",
    "replace",
    await client.stat(source),
  );
  await client.copy(source, `${PRIVATE}copy`, { kind: "preserve-source" });
  await client.move(`${PRIVATE}copy`, `${PRIVATE}moved`, { kind: "confirm-move" });
  const trashed = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  expect(trashed.failed).toEqual([]);
  expect((await restoreItems(client, DRIVE, trashed.done)).failed).toEqual([]);
  await client.remove(PRIVATE, { recursive: true });
  const mutations = requests.flatMap((request, index) =>
    request.method === "DELETE" || (request.method === "PUT" && request.headers.has("if-match"))
      ? [{ request, prior: requests[index - 1] }]
      : [],
  );
  expect(mutations.length).toBeGreaterThan(10);
  for (const { request, prior } of mutations) {
    expect(prior?.method).toBe("HEAD");
    expect(prior?.headers.has("if-match")).toBe(true);
    if (request.method === "PUT") {
      expect(prior?.url).toBe(request.url);
      expect(prior?.headers.get("if-match")).toBe(request.headers.get("if-match"));
    }
  }
});
