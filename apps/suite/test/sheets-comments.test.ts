// AUTHORED-BY Codex GPT-6.1-Sol

import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { LiteralAs, LiteralFrom, OptionalAs, OptionalFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { beforeEach, expect, it, vi } from "vitest";
import { readRdf, writeRdf } from "../src/apps/docs/lib/model/rdf-io";
import { DCT, OA, PD, RDF_TYPE } from "../src/apps/docs/lib/model/vocab";
import {
  type CellAnchor,
  commentStructuralEdit,
  formatCellSelector,
  parseCellSelector,
  shiftCellAnchor,
} from "../src/apps/sheets/lib/comments/selector";
import {
  type CellComment,
  CellCommentStore,
  type CellThread,
  MAX_COMMENT_LENGTH,
} from "../src/apps/sheets/lib/comments/store";
import { SheetResource } from "../src/apps/sheets/lib/model/rdf";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const container = "https://pod.example/sheets/book/";
const author = "https://pod.example/profile#me";
const other = "https://other.example/profile#me";
const anchor: CellAnchor = { sheetId: "stable ID/!", cell: "B3", deleted: false };
const now = new Date("2026-11-11T10:00:00Z");
const VALUE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#value";
const O = "http://www.w3.org/ns/oa#";
let pod: ReturnType<typeof createDemoPod>;
let store: CellCommentStore;
beforeEach(() => {
  pod = createDemoPod({ root: "https://pod.example/", seed: [] });
  store = new CellCommentStore(container, pod.fetch);
});
async function mutate(
  url: string,
  change: (node: SheetResource, dataset: Awaited<ReturnType<typeof readRdf>>["dataset"]) => void,
) {
  const { dataset, etag } = await readRdf(url, pod.fetch);
  change(new SheetResource(url, dataset, DataFactory), dataset);
  await writeRdf(url, dataset, { fetchImpl: pod.fetch, etag });
}

it("round-trips cell selectors and rejects noncanonical, enormous and hostile values", () => {
  const value = formatCellSelector(anchor);
  expect(value).toBe("sheet=stable%20ID%2F!&cell=B3");
  expect(parseCellSelector(value)).toEqual(anchor);
  for (const a of [
    { ...anchor, sheetId: "" },
    { ...anchor, sheetId: "x".repeat(257) },
    { ...anchor, cell: "A".repeat(33) },
    { ...anchor, cell: "Sheet!B3" },
    { ...anchor, cell: "A1:B3" },
    { ...anchor, cell: "A:A" },
    { ...anchor, cell: "1:1" },
    { ...anchor, cell: "$A$1" },
    { ...anchor, cell: "$A1" },
    { ...anchor, cell: "A$1" },
    { ...anchor, cell: "a1" },
  ])
    expect(() => formatCellSelector(a)).toThrow();
  for (const text of [
    "",
    "sheet=x&cell=A0",
    "sheet=%ZZ&cell=A1",
    "sheet=%61&cell=A1",
    "sheet=x&cell=A1\n",
    "sheet=x&cell=A1&x=1",
  ])
    expect(() => parseCellSelector(text)).toThrow();
});
it("shifts using the refs helpers and preserves a deleted cell's last address", () => {
  const edit = {
    sheet: anchor.sheetId,
    axis: "row" as const,
    kind: "insert" as const,
    index: 3,
    count: 2,
  };
  expect(shiftCellAnchor(anchor, edit).cell).toBe("B5");
  expect(shiftCellAnchor(anchor, { ...edit, index: 4 }).cell).toBe("B3");
  expect(shiftCellAnchor(anchor, { ...edit, axis: "column", index: 1 }).cell).toBe("D3");
  expect(shiftCellAnchor(anchor, { ...edit, kind: "delete", index: 1, count: 1 }).cell).toBe("B2");
  const deleted = shiftCellAnchor(anchor, { ...edit, kind: "delete" });
  expect(deleted).toEqual({ ...anchor, deleted: true });
  expect(shiftCellAnchor(deleted, edit)).toBe(deleted);
  expect(shiftCellAnchor(anchor, { ...edit, sheet: "STABLE ID/!" })).toBe(anchor);
});
it("decodes the engine's row/column insert/delete mutations and rejects malformed payloads", () => {
  const range = { startRow: 2, endRow: 4, startColumn: 1, endColumn: 2 };
  for (const [op, axis, kind, index, count] of [
    ["insert-row", "row", "insert", 3, 3],
    ["remove-rows", "row", "delete", 3, 3],
    ["insert-col", "column", "insert", 2, 2],
    ["remove-col", "column", "delete", 2, 2],
  ])
    expect(commentStructuralEdit(`sheet.mutation.${op}`, { subUnitId: "s", range })).toEqual({
      sheet: "s",
      axis,
      kind,
      index,
      count,
    });
  for (const params of [
    undefined,
    null,
    1,
    {},
    { subUnitId: "s" },
    { range },
    { subUnitId: "s", range: { ...range, startRow: -1 } },
    { subUnitId: "s", range: { ...range, endRow: 1 } },
    { subUnitId: "s", range: { ...range, startRow: 0.5 } },
    { subUnitId: "s", range: { ...range, endRow: NaN } },
  ])
    expect(commentStructuralEdit("sheet.mutation.insert-row", params)).toBeUndefined();
  expect(commentStructuralEdit("sheet.other", { subUnitId: "s", range })).toBeUndefined();
});
it("round-trips threads, replies, TextualBody, dates and hostile plain text through real RDF I/O", async () => {
  expect(await store.list()).toEqual([]);
  const root = await store.create(' <script>alert("x")</script>\n" \\ ', author, anchor, now);
  const reply = await store.reply(root, " Reply ", other, now);
  const raw = await (await pod.fetch(root.url)).text();
  const rdf = await parseRdf(raw, "text/turtle", { baseIRI: root.url });
  const node = new SheetResource(`${root.url}#body`, rdf, DataFactory);
  expect(node.iri(RDF_TYPE)).toBe(`${O}TextualBody`);
  expect(node.text(VALUE)).toBe(root.text);
  expect(await store.list()).toEqual([{ root, replies: [reply] }]);
  await store.edit(reply, "Updated", other, now);
  let thread = (await store.list())[0];
  expect(thread?.replies[0]?.text).toBe("Updated");
  await store.resolve(root, true, now);
  thread = (await store.list())[0];
  expect(thread?.root.resolved).toBe(true);
  const updated = (thread as CellThread).root;
  await store.resolve(updated, false);
  expect((await store.list())[0]?.root.resolved).toBe(false);
  const latest = (await store.list())[0] as CellThread;
  await store.delete(latest.replies[0] as CellComment, other);
  expect((await store.list())[0]?.replies).toEqual([]);
  await store.delete(latest.root, author);
  expect(await store.list()).toEqual([]);
});
it("sorts equal-time entries by URL and replies by time, hides orphan replies", async () => {
  const a = await store.create("A", author, anchor, now);
  await store.create("B", author, anchor, now);
  const r1 = await store.reply(a, "later", other, new Date(now.getTime() + 1000));
  const r2 = await store.reply(a, "same", other, now);
  const r3 = await store.reply(a, "also same", other, now);
  const threads = await store.list();
  expect(threads.map(({ root }) => root.url)).toEqual(threads.map(({ root }) => root.url).sort());
  expect(threads.find(({ root }) => root.url === a.url)?.replies.map(({ url }) => url)).toEqual(
    [r2.url, r3.url].sort().concat(r1.url),
  );
  await store.delete(a, author);
  expect((await store.list()).flatMap(({ replies }) => replies)).toEqual([]);
});
it("enforces ownership, root reply targets, body bounds and concurrency validators", async () => {
  const root = await store.create("First", author, anchor);
  const reply = await store.reply(root, "Reply", author);
  await expect(store.reply(reply, "Nested", author)).rejects.toThrow("Invalid reply target");
  await expect(store.resolve(reply, true)).rejects.toThrow("Invalid thread");
  await expect(store.edit(root, "Hijack", other)).rejects.toThrow("own comments");
  await expect(store.delete(root, other)).rejects.toThrow("own comments");
  for (const text of [" ", "x".repeat(MAX_COMMENT_LENGTH + 1)])
    await expect(store.create(text, author, anchor)).rejects.toThrow("1–10,000");
  await expect(store.edit(root, " ", author)).rejects.toThrow("1–10,000");
  await store.edit(root, "Changed", author);
  await expect(store.edit(root, "Stale", author)).rejects.toMatchObject({ status: 412 });
  await expect(store.delete(root, author)).rejects.toMatchObject({ status: 412 });
  await expect(store.resolve({ ...root, etag: null }, true)).rejects.toThrow("ETag");
  await expect(
    store.delete({ ...root, url: "https://evil.example/comment.ttl" }, author),
  ).rejects.toThrow("location");
});
it("persists structural shifts, skips unrelated/unchanged/deleted anchors", async () => {
  await store.create("Cell", author, { ...anchor, sheetId: "stable" }, now);
  await store.create("Other", author, { ...anchor, sheetId: "other" }, now);
  const edit = {
    sheet: "stable",
    axis: "row" as const,
    kind: "insert" as const,
    index: 4,
    count: 1,
  };
  await store.shift(edit);
  await store.shift({ ...edit, index: 2 }, now);
  expect((await store.list()).find(({ root }) => root.text === "Cell")?.root.anchor?.cell).toBe(
    "B4",
  );
  await store.shift({ ...edit, kind: "delete", count: 1 }, now);
  await store.shift(edit);
  expect((await store.list()).find(({ root }) => root.text === "Cell")?.root.anchor).toEqual({
    ...anchor,
    sheetId: "stable",
    cell: "B4",
    deleted: true,
  });
});
it.each([
  ["type", (node: SheetResource) => node.setIri(RDF_TYPE, `${O}TextualBody`)],
  ["motivation", (node: SheetResource) => node.setIri(OA.motivatedBy, `${O}tagging`)],
  [
    "creator",
    (node: SheetResource) => OptionalAs.object(node, DCT.creator, undefined, LiteralFrom.string),
  ],
  [
    "target",
    (node: SheetResource) => OptionalAs.object(node, OA.hasTarget, undefined, LiteralFrom.string),
  ],
  ["body link", (node: SheetResource) => node.setIri(`${O}hasBody`, "https://evil.example/body")],
  [
    "body type",
    (node: SheetResource, ds: DatasetCore) =>
      new SheetResource(`${node.value}#body`, ds, DataFactory).setIri(RDF_TYPE, OA.Annotation),
  ],
  [
    "body missing",
    (node: SheetResource, ds: DatasetCore) =>
      OptionalAs.object(
        new SheetResource(`${node.value}#body`, ds, DataFactory),
        VALUE,
        undefined,
        LiteralFrom.string,
      ),
  ],
  [
    "body huge",
    (node: SheetResource, ds: DatasetCore) =>
      new SheetResource(`${node.value}#body`, ds, DataFactory).setText(
        VALUE,
        "x".repeat(MAX_COMMENT_LENGTH + 1),
      ),
  ],
  [
    "target foreign",
    (node: SheetResource) => node.setIri(OA.hasTarget, "https://evil.example/target"),
  ],
  [
    "source foreign",
    (node: SheetResource, ds: DatasetCore) =>
      new SheetResource(`${node.value}#target`, ds, DataFactory).setIri(
        OA.hasSource,
        "https://evil.example/workbook",
      ),
  ],
  [
    "selector foreign",
    (node: SheetResource, ds: DatasetCore) =>
      new SheetResource(`${node.value}#target`, ds, DataFactory).setIri(
        OA.hasSelector,
        "https://evil.example/cell",
      ),
  ],
  [
    "selector type",
    (node: SheetResource, ds: DatasetCore) =>
      new SheetResource(`${node.value}#cell`, ds, DataFactory).setIri(RDF_TYPE, OA.Annotation),
  ],
  [
    "selector value",
    (node: SheetResource, ds: DatasetCore) =>
      new SheetResource(`${node.value}#cell`, ds, DataFactory).setText(VALUE, "bad"),
  ],
  [
    "created",
    (node: SheetResource) => OptionalAs.object(node, DCT.created, undefined, LiteralFrom.string),
  ],
  ["modified", (node: SheetResource) => node.setText(DCT.modified, "invalid")],
])("isolates malformed RDF: %s", async (_name, change) => {
  const root = await store.create("Broken", author, anchor, now);
  await mutate(root.url, change as Parameters<typeof mutate>[1]);
  expect(await store.list()).toEqual([]);
});
it("rejects foreign reply targets and ignores external/nested/non-Turtle listing members", async () => {
  const root = await store.create("Root", author, anchor, now);
  const reply = await store.reply(root, "Reply", author, now);
  await mutate(reply.url, (node) => node.setIri(OA.hasTarget, "https://evil.example/root.ttl"));
  const ds = new Store();
  const node = new SheetResource(store.container, ds, DataFactory);
  for (const url of [
    root.url,
    reply.url,
    "https://evil.example/x.ttl",
    `${store.container}nested/x.ttl`,
    `${store.container}file.txt`,
    `${store.container}missing.ttl`,
  ])
    node.links("http://www.w3.org/ns/ldp#contains").add(url);
  const listing = await import("../src/apps/docs/lib/model/rdf-io").then(({ serializeTurtle }) =>
    serializeTurtle(ds),
  );
  const transport = vi.fn<typeof fetch>((url, init) =>
    String(url) === store.container
      ? Promise.resolve(new Response(listing, { headers: { "content-type": "text/turtle" } }))
      : pod.fetch(url, init),
  );
  const safe = new CellCommentStore(container, transport);
  expect(await safe.list()).toEqual([{ root, replies: [] }]);
  expect(transport.mock.calls.some(([url]) => String(url).includes("evil.example"))).toBe(false);
});
it("fails closed on permissions and reads inherited Append/Write hints", async () => {
  for (const [header, expected] of [
    ['user="read append",public=""', { append: true, write: false }],
    ['public="read", user = "read write"', { append: true, write: true }],
    ["", { append: false, write: false }],
    ['public="read append"', { append: false, write: false }],
  ] as const) {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { headers: { "wac-allow": header } }));
    expect(await new CellCommentStore(container, http).permissions()).toEqual(expected);
  }
  const http = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { headers: { "wac-allow": 'user="append"' } }));
  expect(await new CellCommentStore(container, http).permissions()).toEqual({
    append: true,
    write: false,
  });
  expect(http.mock.calls[1]?.[0]).toBe(container);
  expect(
    await new CellCommentStore(
      container,
      async () => new Response(null, { status: 403 }),
    ).permissions(),
  ).toEqual({ append: false, write: false });
});
it("propagates listing errors and guards container creation, including concurrent creation", async () => {
  await expect(
    new CellCommentStore(container, async () => new Response(null, { status: 403 })).list(),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    new CellCommentStore(container, async () => new Response(null, { status: 403 })).create(
      "X",
      author,
      anchor,
    ),
  ).rejects.toThrow("access comments");
  for (const status of [412, 403]) {
    const http = vi.fn<typeof fetch>((url, init) => {
      if (String(url) === store.container)
        return Promise.resolve(
          new Response(null, { status: init?.method === "HEAD" ? 404 : status }),
        );
      return pod.fetch(url, init);
    });
    const attempt = new CellCommentStore(container, http).create("Race", author, anchor);
    if (status === 412) expect((await attempt).text).toBe("Race");
    else await expect(attempt).rejects.toMatchObject({ status });
  }
});
it("retains typed boolean and modified timestamps", async () => {
  const root = await store.create("Root", author, anchor, now);
  await store.resolve(root, true, now);
  const { dataset } = await readRdf(root.url, pod.fetch);
  const node = new SheetResource(root.url, dataset, DataFactory);
  expect(OptionalFrom.subjectPredicate(node, PD.resolved, LiteralAs.boolean)).toBe(true);
  expect(node.date?.toISOString()).toBe(now.toISOString());
});

it("treats missing permission headers as no comment access", async () => {
  expect(
    await new CellCommentStore(container, async () => new Response(null)).permissions(),
  ).toEqual({ append: false, write: false });
});
