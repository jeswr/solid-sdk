// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { expect, it, vi } from "vitest";
import { accessControl, privateAcl, requireAccess } from "../src/apps/drive/lib/client/access";
import { discardVersion, ownsEmptyContainer } from "../src/apps/drive/lib/client/cleanup";
import { DriveError } from "../src/apps/drive/lib/client/client";
import { containsGraph } from "../src/apps/drive/lib/client/rdf";
import { OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const url = "https://cleanup.test/folder/";
it.each([
  undefined,
  'W/"weak"',
])("cleanup refuses an unusable captured validator %s", async (etag) => {
  const remove = vi.fn();
  await expect(
    discardVersion({
      url,
      captured: { content: new Store(), etag },
      read: vi.fn(),
      owns: () => true,
      remove,
    }),
  ).rejects.toMatchObject({ kind: "missing-validator" });
  expect(remove).not.toHaveBeenCalled();
});
it("cleanup uses a new validator only after reading and checking the matching graph", async () => {
  const data = await parseRdf(`<${url}> <https://example.test/note> "ours".`, "text/turtle");
  const remove = vi
    .fn()
    .mockRejectedValueOnce(new DriveError("conflict", 412, url))
    .mockResolvedValue(undefined);
  const read = vi.fn(async () => ({ content: data, etag: '"new"' }));
  await discardVersion({
    url,
    captured: { content: data, etag: '"old"' },
    read,
    owns: (current) => ownsEmptyContainer(url, data, current),
    remove,
  });
  expect(remove.mock.calls).toEqual([['"old"'], ['"new"']]);
  expect(read).toHaveBeenCalledOnce();
});
it("cleanup refuses foreign RDF after 412 and never deletes with its newer validator", async () => {
  const foreign = await parseRdf(`<${url}> <https://example.test/note> "foreign".`, "text/turtle");
  const remove = vi.fn().mockRejectedValue(new DriveError("conflict", 412, url));
  await expect(
    discardVersion({
      url,
      captured: { content: new Store(), etag: '"old"' },
      read: async () => ({ content: foreign, etag: '"foreign"' }),
      owns: (data) => ownsEmptyContainer(url, new Store(), data),
      remove,
    }),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(remove.mock.calls).toEqual([['"old"']]);
});
it("cleanup accepts another writer removing the resource after a refused deletion", async () => {
  await expect(
    discardVersion({
      url,
      captured: { content: "ours", etag: '"old"' },
      read: async () => undefined,
      owns: () => true,
      remove: async () => {
        throw new DriveError("conflict", 412, url);
      },
    }),
  ).resolves.toBeUndefined();
});
it.each([
  new Error("Offline"),
  new DriveError("forbidden", 403, url),
])("cleanup never retries an uncertain or forbidden deletion: %s", async (error) => {
  const read = vi.fn();
  await expect(
    discardVersion({
      url,
      captured: { content: "ours", etag: '"old"' },
      read,
      owns: () => true,
      remove: async () => {
        throw error;
      },
    }),
  ).rejects.toBe(error);
  expect(read).not.toHaveBeenCalled();
});
it("cleanup stops under continuous validator churn", async () => {
  const remove = vi.fn().mockRejectedValue(new DriveError("conflict", 412, url));
  await expect(
    discardVersion({
      url,
      captured: { content: "ours", etag: '"first"' },
      read: async () => ({ content: "ours", etag: '"still-ours"' }),
      owns: () => true,
      remove,
    }),
  ).rejects.toMatchObject({ status: 412 });
  expect(remove).toHaveBeenCalledTimes(3);
});
it("graph inclusion checks merged data even when the survivor also has its own RDF", async () => {
  const data = await parseRdf(
    `<${url}> <https://example.test/note> [<https://example.test/value> "ours"].`,
    "text/turtle",
  );
  const survivor = await parseRdf(
    `<${url}> <https://example.test/note> [<https://example.test/value> "ours"]; <https://example.test/extra> "retained".`,
    "text/turtle",
  );
  expect(containsGraph(data, survivor)).toBe(true);
  expect(containsGraph(survivor, data)).toBe(false);
});

it("an absent policy cannot be created without identifying its governing resource's model", async () => {
  const f = await wacPod();
  const access = accessControl(f.fetch, ROOT);
  await expect(
    access.store(`${PUBLIC}missing.policy`, privateAcl(PUBLIC, OWNER)),
  ).rejects.toThrow();
  expect(f.calls.some(({ method }) => method === "PUT")).toBe(false);
  expect(
    access.discover(PUBLIC, new Headers({ "x-solid-demo-access-control": "none" })),
  ).toBeUndefined();
});

it("policy installation refuses a failed destination HEAD before writing an ACL", async () => {
  const f = await wacPod();
  const access = accessControl(f.fetch, ROOT);
  const policy = requireAccess(await access.effective(PRIVATE), PRIVATE);
  f.intercept(async (target, init) =>
    target === PUBLIC && init?.method === "HEAD" ? new Response(null, { status: 503 }) : undefined,
  );
  await expect(access.install(policy, PRIVATE, PUBLIC)).rejects.toThrow();
  expect(f.calls.some(({ method }) => method === "PUT")).toBe(false);
});
