// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { WorkbookLinkError } from "../src/apps/sheets/lib/contract";
import { createWorkbookService } from "../src/apps/sheets/lib/workbook";
import { harness, snapshot } from "./sheets-workbook-helpers";

const RECIPIENT = "https://pod.example/bob/";
async function setup() {
  const owner = await harness();
  const book = await owner.service.create({ title: "Alice's spreadsheet", snapshot: snapshot() });
  const reader = createWorkbookService({
    ...owner.options,
    publicFetch: owner.fetch,
    podRoot: RECIPIENT,
    webId: `${RECIPIENT}profile/card#me`,
  });
  owner.calls.length = 0;
  return { ...owner, book, reader };
}

describe("shared workbook credential boundary", () => {
  it.each([
    401, 403,
  ])("explains private foreign access (%s) and opens public workbooks anonymously", async (status) => {
    const { book, pod, options } = await setup();
    let publicRead = false;
    const publicFetch = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return publicRead ? pod.fetch(input, init) : new Response(null, { status });
    });
    const sessionFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("Foreign reads must use the public transport");
    });
    const reader = createWorkbookService({
      ...options,
      podRoot: RECIPIENT,
      fetch: sessionFetch,
      publicFetch,
    });
    await expect(reader.openShared(book.container)).rejects.toMatchObject({
      name: "WorkbookLinkError",
      message:
        "You need access from the owner's pod; opening private workbooks shared from another pod is not supported yet",
    });
    publicRead = true;
    expect((await reader.openShared(book.container)).snapshot).toEqual(book.snapshot);
    expect(sessionFetch).not.toHaveBeenCalled();
    expect(publicFetch).toHaveBeenCalledTimes(4);
  });
  it("reads another pod on the storage origin as view-only even with Write hints, without discovery or writes", async () => {
    const { reader, book, pod, calls, setHook } = await setup();
    setHook(async (call) => {
      const response = await pod.fetch(call.url, call.init);
      const headers = new Headers(response.headers);
      headers.set("wac-allow", 'user="read write control",public=""');
      return new Response(response.body, { status: response.status, headers });
    });
    const opened = await reader.openShared(book.container);
    expect(reader.root).toBe(`${RECIPIENT}sheets/`);
    expect(opened).toEqual({ ...book, readOnly: true, version: { ...book.version, derived: {} } });
    expect(calls.map(({ url }) => url).sort()).toEqual([
      `${book.container}index.ttl`,
      `${book.container}workbook.json`,
    ]);
    expect(calls.every((call) => call.method === "GET" && call.init.redirect === "manual")).toBe(
      true,
    );
    calls.length = 0;
    await expect(
      reader.save(book.container, opened.snapshot, opened.version, { force: true }),
    ).rejects.toThrow();
    await expect(reader.rename(book.container, "Changed", opened.version)).rejects.toThrow();
    await expect(reader.remove(book.container)).rejects.toThrow();
    await expect(reader.open(book.container)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it.each([
    "https://other.example/alice/sheets/book/",
    "http://pod.example/alice/sheets/book/",
    "https://pod.example:444/alice/sheets/book/",
    "https://alice:secret@pod.example/alice/sheets/book/",
    "https://pod.example/alice/sheets/book/?query",
    "https://pod.example/alice/sheets/book/#fragment",
    "https://pod.example/alice/sheets/book",
    "https://pod.example/alice/sheets/a%2fb/",
    "https://pod.example/alice/sheets/a%5cb/",
    "https://pod.example/alice/sheets/../book/",
    "//pod.example/alice/sheets/book/",
    "file:///alice/sheets/book/",
    "not a URL",
  ])("rejects an unsafe shared link before fetching: %s", async (url) => {
    const { reader, calls } = await setup();
    await expect(reader.openShared(url)).rejects.toBeInstanceOf(WorkbookLinkError);
    await expect(reader.openShared(url)).rejects.toThrow("same origin as your pod");
    expect(calls).toEqual([]);
  });

  it.each([
    "index.ttl",
    "workbook.json",
  ])("refuses redirects on %s without fetching their target", async (resource) => {
    const { reader, book, calls, setHook } = await setup();
    setHook((call) =>
      call.url === `${book.container}${resource}`
        ? new Response(null, { status: 302, headers: { location: `${RECIPIENT}redirected` } })
        : undefined,
    );
    await expect(reader.openShared(book.container)).rejects.toBeInstanceOf(WorkbookLinkError);
    await expect(reader.openShared(book.container)).rejects.toThrow("Open a direct workbook link");
    expect(calls.every((call) => call.url.startsWith(book.container))).toBe(true);
    expect(calls.every((call) => call.init.redirect === "manual")).toBe(true);
  });

  it.each([
    401, 403, 404, 410, 500,
  ])("reports a shared read failure (%s) without writes", async (status) => {
    const { reader, book, calls, setHook } = await setup();
    setHook(() => new Response(null, { status }));
    const opening = reader.openShared(book.container);
    if (status === 500)
      await expect(opening).rejects.toMatchObject({ name: "SheetStorageError", status });
    else if (status === 401 || status === 403)
      await expect(opening).rejects.toMatchObject({ name: "WorkbookLinkError" });
    else
      await expect(opening).rejects.toMatchObject({
        name: "WorkbookNotFoundError",
        reason: "missing",
      });
    expect(
      calls.every((call) => call.method === "GET" && call.url.startsWith(book.container)),
    ).toBe(true);
  });
});
