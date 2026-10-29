// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { containerVersions } from "../src/apps/drive/lib/client/container-versions";

const root = "https://versions.test/tree/";
const child = `${root}child`;

it("container receipts advance only connected local versions, including repeated representation tags", async () => {
  let etag = '"original"';
  const http = vi.fn<typeof fetch>(async () => new Response(null, { headers: { etag } }));
  const versions = containerVersions(http);
  versions.track(root);
  versions.track(root);
  versions.track(child);
  versions.track("https://versions.test/unrelated/");
  const identity = versions.identity({ url: root, etag });
  expect(await versions.prepare(root)).toEqual([]);
  expect(versions.current(root, undefined)).toBeUndefined();
  expect(versions.current("https://untracked.test/", etag)).toBe(etag);
  const first = await versions.prepare(child);
  expect(first).toEqual([{ url: root, etag }]);
  expect(http).toHaveBeenCalledOnce();
  expect(http).toHaveBeenCalledWith(root, { method: "HEAD", cache: "no-store" });
  etag = '"after-first-child"';
  expect(identity.etag).toBe('"original"');
  await versions.committed(first);
  expect(identity.etag).toBe(etag);
  const second = await versions.prepare(child);
  etag = '"after-second-child"';
  await versions.committed(second);
  expect(identity.etag).toBe(etag);
  expect(versions.current(root, '"after-first-child"')).toBe(etag);
  const repeated = await versions.prepare(child);
  etag = '"original"';
  await versions.committed(repeated);
  expect(identity.etag).toBe(etag);
  expect(versions.current(root, '"after-first-child"')).toBe(etag);
  await versions.committed(await versions.prepare(child));
  expect(identity.etag).toBe(etag);
  etag = '"foreign"';
  // A changed listing alone is never a receipt for a local mutation.
  expect(identity.etag).toBe('"original"');
  const unconnected = await versions.prepare(child);
  etag = '"foreign-after-local-edit"';
  await versions.committed(unconnected);
  expect(identity.etag).toBe('"original"');
  expect(versions.current(root, '"foreign"')).toBe(etag);
  expect(await containerVersions(http).prepare(child)).toEqual([]);
});

it.each([
  "missing",
  "weak",
  "refused",
  "offline",
])("container receipts preserve the captured identity when the receipt is %s", async (failure) => {
  let capturing = false;
  const http = vi.fn<typeof fetch>(async () => {
    if (!capturing) return new Response(null, { headers: { etag: '"original"' } });
    if (failure === "offline") throw new Error("Offline");
    return new Response(null, {
      status: failure === "refused" ? 403 : 200,
      headers: failure === "missing" ? {} : { etag: failure === "weak" ? 'W/"weak"' : '"new"' },
    });
  });
  const versions = containerVersions(http);
  versions.track(root);
  const before = await versions.prepare(child);
  capturing = true;
  await versions.committed(before);
  expect(versions.current(root, '"original"')).toBe('"original"');
  if (failure === "offline") await expect(versions.prepare(child)).rejects.toThrow("Offline");
  else expect(await versions.prepare(child)).toEqual([]);
});
