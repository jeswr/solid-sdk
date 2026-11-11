// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
import { createAt } from "./helpers.js";
import { createLwsBackend } from "./lws.js";
import { createMemoryStorage } from "./memory.js";
import { createSolidBackend } from "./solid.js";
import type { CreateOptions } from "./types.js";

const root = "https://pod.example/owner/";

describe("createAt", () => {
  test.each([
    ["note.txt", undefined],
    ["draft%20one.txt", "resource"],
    ["x%3Ay.txt", "resource"],
    ["100%25.txt", "resource"],
    ["%E2%98%83.txt", "resource"],
    ["notes/", "container"],
    ["draft%20one/", "container"],
    ["x%3Ay/", "container"],
  ] as const)("PUTs the exact URL %s for kind %s", async (path, kind) => {
    const fetch = vi.fn(async () => new Response(null, { status: 201, headers: { etag: '"1"' } }));
    const storage = createSolidBackend({ root, fetch });
    const url = `${root}${path}`;
    const result = await createAt(storage, url, kind === "container" ? null : "draft", {
      contentType: "text/plain",
      ...(kind === undefined ? {} : { kind }),
    });
    expect(result).toMatchObject({ url, created: true, etag: '"1"', etagSource: "response" });
    expect(fetch).toHaveBeenCalledOnce();
    const [target, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe(url);
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("if-none-match")).toBe("*");
    expect(init.body).toBe(kind === "container" ? "" : "draft");
  });

  test("forwards body and options, derives the name, and returns the backend result unchanged", async () => {
    const storage = createMemoryStorage({ protocol: "solid", root });
    const result = { url: `${root}draft%20one.txt`, created: true, etag: null };
    const create = vi.spyOn(storage, "create").mockResolvedValue(result);
    const body = new Uint8Array([1, 2]);
    const options = {
      contentType: "application/octet-stream",
      signal: new AbortController().signal,
      keepalive: true,
      links: [{ rel: "type", target: "urn:fixture:Type" }],
    };
    expect(await createAt(storage, result.url, body, options)).toBe(result);
    expect(create).toHaveBeenCalledExactlyOnceWith(root, body, {
      ...options,
      name: "draft one.txt",
    });
  });

  test("forwards an explicit container kind and leaves content type validation to create", async () => {
    const storage = createMemoryStorage({ protocol: "solid", root });
    await expect(
      createAt(storage, `${root}notes/`, null, { kind: "container" }),
    ).resolves.toMatchObject({
      url: `${root}notes/`,
      created: true,
    });
    const create = vi.spyOn(storage, "create");
    await expect(createAt(storage, `${root}note.txt`, "draft")).rejects.toThrow(TypeError);
    expect(create).toHaveBeenCalledWith(root, "draft", { name: "note.txt" });
  });

  test("refuses an empty child name before create", async () => {
    const storage = createMemoryStorage({ protocol: "solid", root: "https://pod.example/" });
    const create = vi.spyOn(storage, "create");
    await expect(createAt(storage, storage.root, null)).rejects.toMatchObject({
      code: "bad-request",
    });
    expect(create).not.toHaveBeenCalled();
  });

  test.each([
    ["x:y.txt", "resource"],
    ["x:y/", "container"],
    ["x%3ay.txt", "resource"],
    ["x%3ay/", "container"],
    ["%6Eote.txt", "resource"],
    ["note%2Etxt", "resource"],
    ["snow☃.txt", "resource"],
    ["%ff.txt", "resource"],
    ["%.txt", "resource"],
    ["%E2%98.txt", "resource"],
    ["notes/", "resource"],
    ["notes", "container"],
    ["note.txt?version=1", "resource"],
    ["note.txt?", "resource"],
    ["note.txt#part", "resource"],
    ["note.txt#", "resource"],
  ] as const)("refuses %s (%s) before calling create or fetch", async (path, kind) => {
    const fetch = vi.fn();
    const storage = createSolidBackend({ root, fetch });
    const create = vi.spyOn(storage, "create");
    const promise = createAt(storage, `${root}${path}`, null, { kind, contentType: "text/plain" });
    await expect(promise).rejects.toBeInstanceOf(StorageError);
    await expect(promise).rejects.toMatchObject({
      code: "bad-request",
      status: null,
      retryable: false,
    });
    expect(create).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    "resource",
    "container",
  ] as const)("refuses LWS %s creation without a POST", async (kind) => {
    const fetch = vi.fn();
    const storage = createLwsBackend({ root, fetch });
    const create = vi.spyOn(storage, "create");
    const promise = createAt(storage, `${root}note${kind === "container" ? "/" : ".txt"}`, null, {
      kind,
    });
    await expect(promise).rejects.toBeInstanceOf(StorageError);
    await expect(promise).rejects.toMatchObject({
      code: "unsupported",
      status: null,
      retryable: false,
    });
    await expect(promise).rejects.toThrow("Solid");
    expect(create).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    409, 412,
  ])("preserves HTTP %i instead of retrying or replacing a taken name", async (status) => {
    const fetch = vi.fn(async () => new Response(null, { status, headers: { etag: '"other"' } }));
    const storage = createSolidBackend({ root, fetch });
    await expect(
      createAt(storage, `${root}note.txt`, "draft", { contentType: "text/plain" }),
    ).rejects.toMatchObject({
      code: "conflict",
      status,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test.each([
    "https://foreign.example/note.txt",
    "https://pod.example/owner-sibling/note.txt",
    `${root}encoded%2Fslash.txt`,
    "note.txt",
  ])("keeps the storage scope boundary for %s", async (url) => {
    const storage = createMemoryStorage({ protocol: "solid", root });
    const create = vi.spyOn(storage, "create");
    await expect(createAt(storage, url, null)).rejects.toMatchObject({ code: "scope" });
    expect(create).not.toHaveBeenCalled();
  });

  test("rejects an invalid kind before create", async () => {
    const storage = createMemoryStorage({ protocol: "solid", root });
    const create = vi.spyOn(storage, "create");
    await expect(
      createAt(storage, `${root}note.txt`, null, { kind: "invalid" } as unknown as CreateOptions),
    ).rejects.toThrow(TypeError);
    expect(create).not.toHaveBeenCalled();
  });
});
