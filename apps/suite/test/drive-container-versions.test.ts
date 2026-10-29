// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { containerVersions } from "../src/apps/drive/lib/client/container-versions";

const root = "https://versions.test/tree/";
const child = `${root}child`;
const receipt = (value: unknown) =>
  new Response(null, { headers: { "x-solid-drive-parent-validators": JSON.stringify(value) } });

it("round 56: only atomic mutation receipts advance connected parent validators", async () => {
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
  etag = '"after-first-child"';
  versions.committed(first, receipt({ [root]: etag }));
  expect(identity.etag).toBe(etag);
  expect(http).toHaveBeenCalledOnce();
  const second = await versions.prepare(child);
  etag = '"after-second-child"';
  versions.committed(second, receipt({ [root]: etag }));
  expect(identity.etag).toBe(etag);
  expect(versions.current(root, '"after-first-child"')).toBe(etag);
  const repeated = await versions.prepare(child);
  etag = '"original"';
  versions.committed(repeated, receipt({ [root]: etag }));
  expect(identity.etag).toBe(etag);
  etag = '"foreign"';
  const foreign = await versions.prepare(child);
  versions.committed(foreign, receipt({ [root]: '"foreign-after-local-edit"' }));
  expect(identity.etag).toBe('"original"');
  expect(versions.current(root, etag)).toBe('"foreign-after-local-edit"');
  expect(await containerVersions(http).prepare(child)).toEqual([]);
});

it.each([
  null,
  {},
  [],
  true,
  { [root]: null },
  { [root]: 42 },
  { [root]: "" },
  { [root]: 'W/"weak"' },
  { [root]: '"bad\nvalidator"' },
])("round 56: an absent or invalid receipt never adopts a post-mutation HEAD (%j)", async (value) => {
  let etag = '"approved"';
  const http = vi.fn<typeof fetch>(async () => new Response(null, { headers: { etag } }));
  const versions = containerVersions(http);
  versions.track(root);
  const parents = await versions.prepare(child);
  etag = '"replacement"';
  versions.committed(parents, receipt(value));
  expect(versions.current(root, '"approved"')).toBe('"approved"');
  expect(http).toHaveBeenCalledOnce();
  versions.committed(parents, new Response());
  versions.committed(
    parents,
    new Response(null, { headers: { "x-solid-drive-parent-validators": "{" } }),
  );
  expect(http).toHaveBeenCalledOnce();
});

it.each([
  "missing",
  "weak",
  "refused",
  "offline",
])("container preflight cannot capture a %s validator", async (failure) => {
  const http: typeof fetch = async () => {
    if (failure === "offline") throw new Error("Offline");
    return new Response(null, {
      status: failure === "refused" ? 403 : 200,
      headers: failure === "missing" ? {} : { etag: 'W/"weak"' },
    });
  };
  const versions = containerVersions(http);
  versions.track(root);
  if (failure === "offline") await expect(versions.prepare(child)).rejects.toThrow("Offline");
  else expect(await versions.prepare(child)).toEqual([]);
});
