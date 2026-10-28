// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { moveWithValidator } from "../src/apps/drive/state/undo";

const ROOT = "https://pod.example/";
const SOURCE = `${ROOT}drive/B.txt`;
const TARGET = `${ROOT}drive/A.txt`;
type Resource = { etag: string; body: string };
function transport(
  options: {
    sourceEtag?: string;
    beforeDelete?: (files: Map<string, Resource>) => void;
    omitCreatedEtag?: boolean;
  } = {},
) {
  const files = new Map<string, Resource>([
    [SOURCE, { etag: options.sourceEtag ?? '"moved"', body: "original" }],
  ]);
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (url === `${ROOT}drive/` && method === "HEAD")
      return new Response(null, { headers: { "x-solid-demo-access-control": "none" } });
    if (method === "DELETE" && url === SOURCE) options.beforeDelete?.(files);
    const current = files.get(url);
    const ifMatch = headers.get("if-match");
    if (ifMatch && current?.etag !== ifMatch) return new Response(null, { status: 412 });
    if (method === "GET" || method === "HEAD")
      return current
        ? new Response(method === "HEAD" ? null : current.body, {
            headers: {
              etag: current.etag,
              "content-type": "text/plain",
              "x-solid-demo-access-control": "none",
            },
          })
        : new Response(null, { status: 404 });
    if (method === "PUT") {
      if (current && headers.get("if-none-match") === "*")
        return new Response(null, { status: 412 });
      const body = init?.body;
      expect(body).toBeInstanceOf(Blob);
      files.set(url, { etag: '"created"', body: await (body as Blob).text() });
      return new Response(null, {
        status: 201,
        headers: options.omitCreatedEtag ? {} : { etag: '"created"' },
      });
    }
    if (method === "DELETE") {
      files.delete(url);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected ${method}`);
  });
  return { files, fetch };
}
it("Undo sends If-Match on the reverse move's read and delete", async () => {
  const { files, fetch } = transport();
  await moveWithValidator({ storageUrl: ROOT, fetch }, SOURCE, TARGET, '"moved"');
  expect(files.has(SOURCE)).toBe(false);
  expect(files.get(TARGET)?.body).toBe("original");
  for (const [url, init] of fetch.mock.calls.filter(([url]) => String(url) === SOURCE)) {
    expect(String(url)).toBe(SOURCE);
    expect(new Headers(init?.headers).get("if-match")).toBe('"moved"');
  }
});
it("Undo never reads or moves a replacement occupying the old destination", async () => {
  const { files, fetch } = transport({ sourceEtag: '"unrelated"' });
  await expect(
    moveWithValidator({ storageUrl: ROOT, fetch }, SOURCE, TARGET, '"moved"'),
  ).rejects.toMatchObject({ status: 412 });
  expect(files.get(SOURCE)?.etag).toBe('"unrelated"');
  expect(files.has(TARGET)).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("Undo protects replacement source and destination resources during failed-move cleanup", async () => {
  const { files, fetch } = transport({
    beforeDelete: (resources) => {
      resources.set(SOURCE, { etag: '"new-source"', body: "other source" });
      resources.set(TARGET, { etag: '"new-target"', body: "other target" });
    },
  });
  await expect(
    moveWithValidator({ storageUrl: ROOT, fetch }, SOURCE, TARGET, '"moved"'),
  ).rejects.toThrow();
  expect(files.get(SOURCE)?.body).toBe("other source");
  expect(files.get(TARGET)?.body).toBe("other target");
  expect(
    fetch.mock.calls.some(([url, init]) => String(url) === TARGET && init?.method === "DELETE"),
  ).toBe(false);
});
it("Undo retains its recovery copy when the source changes during DELETE", async () => {
  const { files, fetch } = transport({
    beforeDelete: (resources) => resources.set(SOURCE, { etag: '"replacement"', body: "other" }),
  });
  await expect(
    moveWithValidator({ storageUrl: ROOT, fetch }, SOURCE, TARGET, '"moved"'),
  ).rejects.toMatchObject({
    kind: "partial-failure",
    cause: { kind: "conflict", status: 412 },
  });
  expect(files.get(SOURCE)?.body).toBe("other");
  expect(files.get(TARGET)?.body).toBe("original");
});
it("Undo keeps the source and recovery copy when the destination PUT omits its validator", async () => {
  const { files, fetch } = transport({
    omitCreatedEtag: true,
    beforeDelete: (resources) => resources.set(SOURCE, { etag: '"replacement"', body: "other" }),
  });
  await expect(
    moveWithValidator({ storageUrl: ROOT, fetch }, SOURCE, TARGET, '"moved"'),
  ).rejects.toThrow();
  expect(files.get(SOURCE)?.body).toBe("original");
  expect(files.get(TARGET)?.body).toBe("original");
  expect(
    fetch.mock.calls.some(([url, init]) => String(url) === TARGET && init?.method === "DELETE"),
  ).toBe(false);
});
it("Undo of a folder refuses an unrelated replacement after A to B then B elsewhere", async () => {
  const { createDemoPod } = await import("../src/lib/demo-pod/pod");
  const { createSolidDriveClient } = await import("../src/apps/drive/lib/client/client");
  const pod = createDemoPod({
    root: ROOT,
    seed: [{ path: "drive/A/original", body: "original", contentType: "text/plain" }],
  });
  const options = { storageUrl: ROOT, fetch: pod.fetch };
  const client = createSolidDriveClient(options);
  const from = `${ROOT}drive/B/`,
    to = `${ROOT}drive/A/`;
  const moved = await client.move(to, from, { kind: "confirm-move" });
  await client.move(from, `${ROOT}drive/C/`, { kind: "confirm-move" });
  await client.write(
    `${from}unrelated`,
    "unrelated",
    {
      contentType: "text/plain",
      ifNoneMatch: "*",
    },
    { kind: "protect-ancestors" },
  );
  await expect(
    moveWithValidator(options, from, to, moved.etag as string, moved.tree),
  ).rejects.toThrow("cannot be safely undone");
  expect(await (await client.read(`${from}unrelated`)).text()).toBe("unrelated");
  expect(await (await client.read(`${ROOT}drive/C/original`)).text()).toBe("original");
  expect(pod.has(to)).toBe(false);
});
it.each([
  ["", SOURCE],
  ['W/"moved"', SOURCE],
])("Undo fails closed for unsupported validators (%s, %s)", async (etag, source) => {
  const { fetch } = transport();
  await expect(
    moveWithValidator({ storageUrl: ROOT, fetch }, source, TARGET, etag),
  ).rejects.toThrow("safely undone");
  expect(fetch).not.toHaveBeenCalled();
});

it("Undo rejects replacement bytes even when a transport ignores GET preconditions", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response("unrelated", { headers: { etag: '"replacement"' } }));
  await expect(
    moveWithValidator({ storageUrl: ROOT, fetch }, SOURCE, TARGET, '"moved"'),
  ).rejects.toMatchObject({ status: 412 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("reproduces A to B, B elsewhere, unrelated upload at B against the real demo adapter", async () => {
  const { createDemoPod } = await import("../src/lib/demo-pod/pod");
  const { createSolidDriveClient } = await import("../src/apps/drive/lib/client/client");
  const pod = createDemoPod({
    root: ROOT,
    seed: [{ path: "drive/A.txt", body: "original", contentType: "text/plain" }],
  });
  const options = { storageUrl: ROOT, fetch: pod.fetch };
  const client = createSolidDriveClient(options);
  await client.move(TARGET, SOURCE, { kind: "confirm-move" });
  const moved = await client.stat(SOURCE);
  await client.move(SOURCE, `${ROOT}drive/C.txt`, { kind: "confirm-move" });
  await client.write(
    SOURCE,
    "unrelated",
    { contentType: "text/plain", ifNoneMatch: "*" },
    { kind: "protect-ancestors" },
  );
  expect(moved.etag).toBeDefined();
  await expect(
    moveWithValidator(options, SOURCE, TARGET, moved.etag as string),
  ).rejects.toMatchObject({ status: 412 });
  expect(await (await client.read(SOURCE)).text()).toBe("unrelated");
  expect(await (await client.read(`${ROOT}drive/C.txt`)).text()).toBe("original");
  expect(pod.has(TARGET)).toBe(false);
});

it("Undo restores an unchanged folder through the client's conditional recursive move", async () => {
  const { createDemoPod } = await import("../src/lib/demo-pod/pod");
  const { createSolidDriveClient } = await import("../src/apps/drive/lib/client/client");
  const pod = createDemoPod({
    root: ROOT,
    seed: [{ path: "drive/C/child/note", body: "original", contentType: "text/plain" }],
  });
  const fetch = vi.fn<typeof globalThis.fetch>(pod.fetch);
  const options = { storageUrl: ROOT, fetch };
  const client = createSolidDriveClient(options);
  const from = `${ROOT}drive/B/`,
    to = `${ROOT}drive/A/`;
  const moved = await client.move(`${ROOT}drive/C/`, from, { kind: "confirm-move" });
  fetch.mockClear();
  await moveWithValidator(options, from, to, moved.etag as string, moved.tree);
  expect(await (await client.read(`${to}child/note`)).text()).toBe("original");
  expect(pod.has(from)).toBe(false);
  const deletes = fetch.mock.calls.filter(([, init]) => init?.method === "DELETE");
  expect(deletes).toHaveLength(3);
  for (const [, init] of deletes) expect(new Headers(init?.headers).has("if-match")).toBe(true);
});

it("Undo refuses a changed folder child set even when the server reuses its ETag", async () => {
  const { createDemoPod } = await import("../src/lib/demo-pod/pod");
  const { createSolidDriveClient } = await import("../src/apps/drive/lib/client/client");
  const pod = createDemoPod({
    root: ROOT,
    seed: [{ path: "drive/B/unrelated", body: "unrelated", contentType: "text/plain" }],
  });
  const from = `${ROOT}drive/B/`,
    to = `${ROOT}drive/A/`;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const response = await pod.fetch(input, { ...init, headers: {} });
    response.headers.set("etag", '"reused"');
    return response;
  });
  await expect(
    moveWithValidator({ storageUrl: ROOT, fetch }, from, to, '"reused"', [
      { url: from, etag: '"reused"', children: [`${from}original`] },
      { url: `${from}original`, etag: '"original"' },
    ]),
  ).rejects.toThrow("cannot be safely undone");
  expect(pod.has(to)).toBe(false);
  expect(
    await (
      await createSolidDriveClient({ storageUrl: ROOT, fetch: pod.fetch }).read(`${from}unrelated`)
    ).text(),
  ).toBe("unrelated");
  expect(
    fetch.mock.calls.every(([, init]) => !["PUT", "DELETE"].includes(init?.method ?? "GET")),
  ).toBe(true);
});

it("Undo fails closed for a folder whose child set was not captured", async () => {
  const { fetch } = transport();
  await expect(
    moveWithValidator({ storageUrl: ROOT, fetch }, `${SOURCE}/`, `${TARGET}/`, '"moved"'),
  ).rejects.toThrow("cannot be safely undone");
  expect(fetch).not.toHaveBeenCalled();
});
