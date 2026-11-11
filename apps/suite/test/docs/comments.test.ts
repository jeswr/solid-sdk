// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { expect, it, vi } from "vitest";
import {
  type CommentAnchor,
  commentDisabledReason,
  commentError,
  DocumentCommentStore,
} from "../../src/apps/docs/lib/model/comments";
import { ResourceDeleteError, ResourceWriteError } from "../../src/apps/docs/lib/model/errors";
import { readRdf } from "../../src/apps/docs/lib/model/rdf-io";
import { OA, PD } from "../../src/apps/docs/lib/model/vocab";
import { createDemoPod } from "../../src/lib/demo-pod/pod";

const document = "https://pod.example/docs/plan.ttl";
const container = "https://pod.example/docs/plan/comments/";
const actor = "https://pod.example/profile#me";
const other = "https://bob.example/#me";
const anchor: CommentAnchor = {
  exact: "word",
  prefix: "before ",
  suffix: " after",
  start: "AA==",
  end: "AQ==",
};
function setup() {
  const pod = createDemoPod({ root: "https://pod.example/", seed: [] });
  const http = vi.fn<typeof fetch>(pod.fetch);
  const store = new DocumentCommentStore(container, document, http);
  return { pod, http, store };
}
it("creates Web Annotations with create-only validators, groups replies, and orders anchored roots first", async () => {
  const { store, http } = setup();
  const root = await store.create(' Check "word" ', actor, anchor, new Date("2026-01-01"));
  const unanchored = await store.create("Lost", actor, anchor, new Date("2025-01-01"));
  const first = await store.reply(root, "First", other, new Date("2026-02-01"));
  const second = await store.reply(root, "Second", actor, new Date("2026-03-01"));
  const third = await store.reply(root, "Same time", actor, new Date("2026-03-01"));
  const rows = await store.list((comment) => (comment.url === root.url ? 5 : undefined));
  expect(rows.map(({ root }) => root.url)).toEqual([root.url, unanchored.url]);
  expect(rows[0]?.replies.map((reply) => reply.url)).toEqual([
    first.url,
    ...[second, third].sort((a, b) => a.url.localeCompare(b.url)).map((entry) => entry.url),
  ]);
  expect(rows[0]?.root).toEqual({ ...root, text: 'Check "word"' });
  expect(
    http.mock.calls
      .filter(([, init]) => init?.method === "PUT")
      .every(([, init]) => new Headers(init?.headers).get("if-none-match") === "*"),
  ).toBe(true);
  const rdf = await readRdf(root.url, http);
  expect(
    [...rdf.dataset].some(
      (quad) => quad.predicate.value === OA.hasSource && quad.object.value === document,
    ),
  ).toBe(true);
  await expect(store.reply(first, "invalid", actor)).rejects.toThrow("Invalid reply target");
  await expect(store.create(" ", actor, anchor)).rejects.toThrow("Enter a comment");
  await expect(store.reply(root, " ", actor)).rejects.toThrow("Enter a comment");
  expect(await store.list()).toHaveLength(2);
});
it("returns an empty absent container but propagates container permission errors", async () => {
  const { store, http } = setup();
  expect(await store.list()).toEqual([]);
  http.mockImplementation(async () => new Response(null, { status: 403 }));
  await expect(store.list()).rejects.toBeInstanceOf(RdfFetchError);
});
it("skips malformed resources, wrong documents, nested children, orphan replies and foreign links independently", async () => {
  const { store, pod, http } = setup();
  const root = await store.create("Valid", actor, anchor);
  const raw = await (await pod.fetch(root.url)).text();
  const cases = [
    raw
      .replaceAll(root.url, `${container}foreign.ttl`)
      .replaceAll(document, "https://other.example/doc.ttl"),
    raw
      .replaceAll(root.url, `${container}missing-text.ttl`)
      .replace(/<http:\/\/www.w3.org\/ns\/oa#bodyValue>[^;]+;/, ""),
    raw.replaceAll(root.url, `${container}bad-date.ttl`).replace(root.created, "bad date"),
    raw
      .replaceAll(root.url, `${container}bad-motivation.ttl`)
      .replace(OA.commenting, `${OA.replying}bogus`),
    raw.replaceAll(root.url, `${container}bad-anchor.ttl`).replace(anchor.start, ""),
    raw
      .replaceAll(root.url, `${container}missing-prefix.ttl`)
      .replace(/<http:\/\/www.w3.org\/ns\/oa#prefix>[^;]+;/, ""),
    raw
      .replaceAll(root.url, `${container}wrong-type.ttl`)
      .replace(OA.Annotation, OA.TextQuoteSelector),
    "malformed",
  ];
  const names = [
    "foreign",
    "missing-text",
    "bad-date",
    "bad-motivation",
    "bad-anchor",
    "missing-prefix",
    "wrong-type",
    "garbage",
  ];
  for (const [i, body] of cases.entries())
    await pod.fetch(`${container}${names[i]}.ttl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body,
    });
  await pod.fetch(`${container}nested/child.ttl`, { method: "PUT", body: raw });
  await pod.fetch(`${container}note.txt`, { method: "PUT", body: "text" });
  const reply = await store.reply(root, "Orphan", actor);
  await pod.fetch(reply.url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: (await (await pod.fetch(reply.url)).text()).replaceAll(
      root.url,
      `${container}missing.ttl`,
    ),
  });
  expect((await store.list()).map(({ root }) => root.url)).toEqual([root.url]);
  const base = http.getMockImplementation() as typeof fetch;
  http.mockImplementation((input, init) =>
    String(input) === root.url && !init?.method
      ? Promise.resolve(new Response(null, { status: 404 }))
      : base(input, init),
  );
  expect(await store.list()).toEqual([]);
});
it("conditionally resolves, retries a 412 once on fresh data, removes resolution metadata on reopen", async () => {
  const { store, http, pod } = setup();
  const root = await store.create("Discuss", actor, anchor);
  let conflicts = 1;
  http.mockImplementation((input, init) => {
    if (String(input) === root.url && init?.method === "PUT" && conflicts-- > 0)
      return Promise.resolve(new Response(null, { status: 412 }));
    return pod.fetch(input, init);
  });
  await store.setResolved(root, true, actor, new Date("2026-05-01"));
  const resolved = (await store.list())[0]?.root;
  expect(resolved?.resolved).toBe(true);
  const rdf = await readRdf(root.url, http);
  expect(
    [...rdf.dataset].find((quad) => quad.predicate.value === PD.resolvedBy)?.object.value,
  ).toBe(actor);
  await store.setResolved(root, false, actor);
  expect((await store.list())[0]?.root.resolved).toBe(false);
  expect(
    [...(await readRdf(root.url, http)).dataset].some((quad) =>
      [PD.resolved, PD.resolvedBy, PD.resolvedAt].includes(
        quad.predicate.value as typeof PD.resolved,
      ),
    ),
  ).toBe(false);
  conflicts = 2;
  await expect(store.setResolved(root, true, actor)).rejects.toThrow(
    "This comment changed; try again.",
  );
  http.mockImplementation((input, init) =>
    init?.method === "PUT"
      ? Promise.resolve(new Response(null, { status: 403 }))
      : pod.fetch(input, init),
  );
  await expect(store.setResolved(root, true, actor)).rejects.toMatchObject({ status: 403 });
  http.mockImplementation(pod.fetch);
  const reply = await store.reply(root, "reply", actor);
  await expect(store.setResolved(reply, true, actor)).rejects.toThrow("Invalid comment target");
});
it("edits and deletes only the stored author, uses ETags, and deletes a root first, conditionally, then its replies best effort", async () => {
  const { store, http, pod } = setup();
  const root = await store.create("Root", actor, anchor);
  const first = await store.reply(root, "Own", actor);
  const second = await store.reply(root, "Other", other);
  await expect(store.edit(root, "Forged", other)).rejects.toThrow("your own");
  await expect(store.delete({ ...root, creator: other }, other)).rejects.toThrow("your own");
  await expect(store.edit(root, " ", actor)).rejects.toThrow("Enter a comment");
  await store.edit(first, " Updated ", actor);
  const fresh = (await store.list())[0]?.replies.find((reply) => reply.url === first.url);
  expect(fresh?.text).toBe("Updated");
  await expect(store.edit(first, "Stale", actor)).rejects.toMatchObject({ status: 412 });

  await expect(store.delete(first, actor)).rejects.toThrow("This comment changed");
  await store.delete(fresh as NonNullable<typeof fresh>, actor);
  http.mockImplementation((input, init) =>
    String(input) === second.url && init?.method === "DELETE"
      ? Promise.resolve(new Response(null, { status: 403 }))
      : pod.fetch(input, init),
  );
  await store.delete(root, actor);
  const deleted = http.mock.calls
    .filter(([, init]) => init?.method === "DELETE")
    .map(([url]) => String(url));
  expect(deleted.slice(-2)).toEqual([root.url, second.url]);
  expect(await store.list()).toEqual([]);
  // A root that changed after the read keeps every reply: nothing is deleted.
  const kept = await store.create("Kept", actor, anchor);
  const keptReply = await store.reply(kept, "Reply", other);
  http.mockImplementation((input, init) =>
    String(input) === kept.url && init?.method === "DELETE"
      ? Promise.resolve(new Response(null, { status: 412 }))
      : pod.fetch(input, init),
  );
  http.mockClear();
  await expect(store.delete(kept, actor)).rejects.toMatchObject({ status: 412 });
  expect(
    http.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([url]) => String(url)),
  ).toEqual([kept.url]);
  expect((await store.list())[0]?.replies.map(({ url }) => url)).toEqual([keptReply.url]);
  for (const url of [keptReply.url, kept.url]) await pod.fetch(url, { method: "DELETE" });
  const vanished = await store.create("Gone", actor, anchor);
  http.mockImplementation((input, init) =>
    init?.method === "DELETE"
      ? Promise.resolve(new Response(null, { status: 410 }))
      : pod.fetch(input, init),
  );
  await store.delete(vanished, actor);
  http.mockImplementation((input, init) =>
    init?.method === "DELETE"
      ? Promise.resolve(new Response(null, { status: 404 }))
      : pod.fetch(input, init),
  );
  await store.delete(vanished, actor);
});
it("rejects foreign URLs before I/O, surfaces conditional and permission errors", async () => {
  const { store, http } = setup();
  const root = await store.create("Root", actor, anchor);
  http.mockClear();
  await expect(
    store.edit({ ...root, url: "https://evil.example/a.ttl" }, "x", actor),
  ).rejects.toThrow("Invalid comment location");
  expect(http).not.toHaveBeenCalled();
  for (const status of [401, 403]) {
    http.mockResolvedValue(new Response(null, { status }));
    await expect(store.create("test", actor, anchor)).rejects.toMatchObject({ status });
    expect(commentError(new ResourceWriteError(container, status))).toBe(
      "You don't have permission to comment on this document.",
    );
  }
  expect(commentError(new ResourceDeleteError(container, 412))).toBe(
    "This comment changed; try again.",
  );
  expect(commentError(new Error("network"))).toBe("network");
  expect(commentError(null)).toContain("connected");
  expect(commentDisabledReason(false, true)).toContain("Save this document");
  expect(commentDisabledReason(true, false)).toContain("Reconnect");
  expect(commentDisabledReason(true, true)).toBeUndefined();
});

it("orders same-time roots by IRI, propagates a retry failure, and deletes when a root disappears from listing", async () => {
  const { store, http, pod } = setup();
  const a = await store.create("A", actor, anchor, new Date("2026-01-01"));
  const b = await store.create("B", actor, anchor, new Date("2026-01-01"));
  expect((await store.list()).map(({ root }) => root.url)).toEqual([a.url, b.url].sort());
  expect((await store.list((root) => (root.url === a.url ? undefined : 1)))[0]?.root.url).toBe(
    b.url,
  );
  let puts = 0;
  http.mockImplementation((input, init) =>
    init?.method === "PUT"
      ? Promise.resolve(new Response(null, { status: ++puts === 1 ? 412 : 500 }))
      : pod.fetch(input, init),
  );
  await expect(store.setResolved(a, true, actor)).rejects.toMatchObject({ status: 500 });
  http.mockImplementation(pod.fetch);
  const list = vi.spyOn(store, "list").mockResolvedValue([]);
  await store.delete(a, actor);
  list.mockRestore();
  const weak: typeof fetch = async (input, init) => {
    const response = await pod.fetch(input, init);
    if (!init?.method && String(input) === b.url) response.headers.set("etag", 'W/"weak"');
    return response;
  };
  const weakStore = new DocumentCommentStore(container, document, weak);
  await expect(weakStore.delete({ ...b, etag: 'W/"weak"' }, actor)).rejects.toThrow("strong ETag");
  const noTag: typeof fetch = async (input, init) => {
    const response = await pod.fetch(input, init);
    if (!init?.method && String(input) === b.url) response.headers.delete("etag");
    return response;
  };
  await expect(
    new DocumentCommentStore(container, document, noTag).delete({ ...b, etag: null }, actor),
  ).rejects.toThrow("strong ETag");
  expect(commentError(new ResourceWriteError(container, 500))).toContain("500");
});

// AUTHORED-BY Claude Opus 5.5
it("bounds untrusted quote selectors and rejects oversized anchors", async () => {
  const { store, pod } = setup();
  const root = await store.create("Root", actor, {
    ...anchor,
    prefix: "p".repeat(5_000),
    suffix: "s".repeat(5_000),
  });
  const [thread] = await store.list();
  expect(thread?.root.anchor?.prefix).toBe("p".repeat(32));
  expect(thread?.root.anchor?.suffix).toBe("s".repeat(32));
  await pod.fetch(root.url, { method: "DELETE" });
  for (const oversized of [
    { exact: "x".repeat(10_001) },
    { start: "A".repeat(1_025) },
    { end: "A".repeat(1_025) },
  ]) {
    const entry = await store.create("Big", actor, { ...anchor, ...oversized });
    expect(await store.list()).toEqual([]);
    await pod.fetch(entry.url, { method: "DELETE" });
  }
});
