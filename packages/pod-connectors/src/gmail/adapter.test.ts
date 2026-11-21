// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { Provenance } from "../core/provenance.js";
import {
  createMemoryPod,
  demoImport,
  fixtureFetch,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { ConnectorState, FixtureRoute } from "../core/types.js";
import { MAIL_CLASSES, MailCollection, MailMessage } from "../mail/vocab.js";
import { gmailAdapter } from "./adapter.js";
import { GMAIL_API, GMAIL_FIXTURES, type GmailMessage, MESSAGES, rawMessage } from "./fixtures.js";

const ROOT = `${TEST_POD_ROOT}integrations/gmail/`;
const ACCOUNT = `${ROOT}mail/alex~40example.test/`;
const msg = (id: string) => `${ACCOUNT}messages/${encodeURIComponent(id).replace(/%/g, "~")}.ttl`;
const LUNCH_1 = msg("gmail-m1");
const LUNCH_2 = msg("gmail-m2");
const RECEIPT = msg("gmail-m3");
const THREAD_1 = `${ACCOUNT}threads/gmail-t1.ttl`;
const folder = (name: string) => `${ACCOUNT}folders/${name}.ttl`;

const message = (pod: ReturnType<typeof createMemoryPod>, url: string) =>
  new MailMessage(`${url}#it`, pod.dataset(url), DataFactory);
const members = (pod: ReturnType<typeof createMemoryPod>, url: string) =>
  [...new MailCollection(`${url}#it`, pod.dataset(url), DataFactory).members].sort();

function setup() {
  const pod = createMemoryPod();
  let transport = pod.fetch;
  const podWriter = createFetchPodWriter({
    adapterId: "gmail",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: (input, init) => transport(input, init),
  });
  const run = (routes: readonly FixtureRoute[], state?: ConnectorState) => {
    const api = vi.fn(fixtureFetch("gmail", routes));
    return {
      api,
      result: runImport({
        adapter: gmailAdapter,
        mode: "live",
        sourceAuth: { fetch: api },
        podWriter,
        state,
      }),
    };
  };
  return {
    pod,
    podWriter,
    run,
    transport: (fetch: typeof globalThis.fetch) => (transport = fetch),
  };
}

const base = GMAIL_FIXTURES.filter((r) => !r.url.includes("/messages"));
const fetched = (m: GmailMessage): FixtureRoute => ({
  url: `${GMAIL_API}/messages/${m.id}`,
  json: m,
});
const replyMessage = (id: string, parent = "<lunch-1@example.test>"): GmailMessage => ({
  id,
  threadId: "t1",
  labelIds: ["INBOX"],
  raw: rawMessage([
    `Message-ID: <reply-${id}@example.test>`,
    `In-Reply-To: ${parent}`,
    "Subject: Reply",
    "",
    "Synthetic reply.",
  ]),
});
const threadRequests = (api: ReturnType<ReturnType<typeof setup>["run"]>["api"]) =>
  api.mock.calls.map(([u]) => new URL(String(u))).filter((u) => u.pathname.includes("/threads/"));

describe("Gmail full import", () => {
  it("stores messages, sources, threads and folders in the pod-mail layout", async () => {
    const { pod, report } = await demoImport(gmailAdapter);
    expect(report.cursor).toBe("1000");
    expect(report.categories).toEqual(["mail"]);

    const first = message(pod, LUNCH_1);
    expect(first.identifier).toBe("<lunch-1@example.test>");
    expect(first.types.has("http://schema.org/EmailMessage")).toBe(true);
    expect(first.subjectLine).toBe("Lunch on Friday?");
    expect(first.body?.trim()).toBe("Shall we try the new place on the corner?");
    expect(first.sender).toBe("mailto:sam%40example.test");
    expect([...first.to]).toEqual(["mailto:alex%40example.test"]);
    expect(first.dateSent?.toISOString()).toBe("2026-06-11T09:00:00.000Z");
    expect(first.dateRead).toBeUndefined();
    expect(first.encoding).toBe(LUNCH_1.replace(/\.ttl$/, ".eml"));
    expect(pod.contentType(first.encoding ?? "")).toBe("message/rfc822");
    expect(new TextDecoder().decode(pod.bytes(first.encoding ?? ""))).toContain(
      "Message-ID: <lunch-1@example.test>",
    );
    expect(
      new Provenance(`${LUNCH_1}#it`, pod.dataset(LUNCH_1), DataFactory).derivedFrom.has(
        "https://mail.google.com/mail/#all/m1",
      ),
    ).toBe(true);

    const reply = message(pod, LUNCH_2);
    expect(reply.body).toBe("Yes & let's invite Kim.");
    expect(reply.bodyHtml).toContain("<p>");
    expect(reply.dateRead).toBeDefined();
    expect([...reply.cc]).toEqual(["mailto:kim%40example.test"]);
    expect(reply.inReplyTo).toBe(`${LUNCH_1}#it`);
    expect(reply.partOfThread).toBe(`${THREAD_1}#it`);
    expect(members(pod, THREAD_1)).toEqual([`${LUNCH_1}#it`, `${LUNCH_2}#it`]);
    expect(new MailCollection(`${THREAD_1}#it`, pod.dataset(THREAD_1), DataFactory).title).toBe(
      "Lunch on Friday?",
    );

    expect(members(pod, folder("system:inbox"))).toEqual([`${LUNCH_1}#it`]);
    expect(members(pod, folder("system:sent"))).toEqual([`${LUNCH_2}#it`]);
    expect(members(pod, folder("Label_1"))).toEqual([`${RECEIPT}#it`]);
    expect(members(pod, folder("system:starred"))).toEqual([`${RECEIPT}#it`]);
    expect(members(pod, folder("system:archive"))).toEqual([`${RECEIPT}#it`]);
    expect(
      new MailCollection(`${folder("Label_1")}#it`, pod.dataset(folder("Label_1")), DataFactory)
        .title,
    ).toBe("Receipts");
    expect(pod.urls().some((u) => u.includes("CATEGORY"))).toBe(false);
    expect(pod.get(`${ACCOUNT}gmail-index.ttl`)).toBeUndefined();
  });

  it("stores attachments as opaque bytes, never as RDF", async () => {
    const { pod } = await demoImport(gmailAdapter);
    const receipt = message(pod, RECEIPT);
    const [attachment] = [...receipt.attachments];
    expect(attachment).toBe(`${ROOT}mail/attachments/alex~40example.test/gmail-m3-0`);
    expect(pod.contentType(attachment ?? "")).toBe("application/octet-stream");
    expect(new TextDecoder().decode(pod.bytes(attachment ?? ""))).toBe("<#order> a <#Order> .");
    expect(pod.get(RECEIPT)).toContain('"text/turtle"');
  });

  it("registers mail at the account root and is idempotent", async () => {
    const { pod, report } = await demoImport(gmailAdapter);
    const index = pod.get(report.indexUrl) ?? "";
    expect(index).toContain("http://schema.org/EmailMessage");
    expect(index).toContain(ACCOUNT);
    expect(index).not.toContain(`${ACCOUNT}messages/`);
    const before = pod.urls();
    const sizes = before.map((u) => pod.dataset(u).size);
    await demoImport(gmailAdapter, { pod });
    expect(pod.urls()).toEqual(before);
    expect(
      before.map((u) =>
        u.endsWith("_provenance.ttl") ? sizes[before.indexOf(u)] : pod.dataset(u).size,
      ),
    ).toEqual(sizes);
  });

  it("follows list pages and skips malformed items", async () => {
    const { pod, run } = setup();
    const { result, api } = run([
      ...base,
      {
        url: `${GMAIL_API}/messages`,
        json: { messages: [MESSAGES.m1, null, { id: "../x" }], nextPageToken: "p2" },
      },
      { url: `${GMAIL_API}/messages`, json: { messages: [{ id: "bad", threadId: "t9" }] } },
      fetched(MESSAGES.m1 as GmailMessage),
      fetched({ id: "bad", threadId: "t9", raw: "not base64!" }),
    ]);
    const report = await result;
    expect(report.skipped).toBe(3);
    expect(pod.get(LUNCH_1)).toBeDefined();
    const pages = api.mock.calls
      .map(([u]) => new URL(String(u)))
      .filter((u) => u.pathname.endsWith("/messages"));
    expect(pages.map((u) => u.searchParams.get("pageToken"))).toEqual([null, "p2"]);
  });

  it("uses the Gmail id when Message-ID is missing", async () => {
    const { pod, run } = setup();
    const bare: GmailMessage = {
      id: "m9",
      threadId: "t9",
      labelIds: ["INBOX"],
      raw: rawMessage(["From: a@example.test", "Subject: No id", "", "Body"]),
    };
    await run([
      ...base,
      { url: `${GMAIL_API}/messages`, json: { messages: [bare] } },
      fetched(bare),
    ]).result;
    expect(message(pod, msg("gmail-m9")).subjectLine).toBe("No id");
  });

  it("bounds opaque ids and requires a source thread key", async () => {
    const { pod, run } = setup();
    const valid = { ...(MESSAGES.m1 as GmailMessage), id: `${"a".repeat(254)}_-` };
    const badThread = { ...(MESSAGES.m1 as GmailMessage), id: "badThread", threadId: "../bad" };
    const { api, result } = run([
      ...base,
      {
        url: `${GMAIL_API}/messages`,
        json: {
          messages: [valid, badThread, { id: "a".repeat(257) }, { id: "a.b" }, { id: "" }],
        },
      },
      fetched(valid),
      fetched(badThread),
    ]);
    expect((await result).skipped).toBe(4);
    expect(pod.get(msg(`gmail-${valid.id}`))).toBeDefined();
    expect(pod.get(msg("gmail-badThread"))).toBeUndefined();
    expect(api.mock.calls.filter(([url]) => String(url).includes("?format=raw"))).toHaveLength(2);
    expect(threadRequests(api)).toEqual([]);
  });
});

describe("Gmail reply resolution", () => {
  it("resolves newest-first replies with one metadata request per thread and run", async () => {
    const { pod, run } = setup();
    const reply = replyMessage("m4");
    const first = run([
      ...base,
      {
        url: `${GMAIL_API}/messages`,
        json: { messages: [MESSAGES.m2, reply, MESSAGES.m1] },
      },
      fetched(MESSAGES.m2 as GmailMessage),
      fetched(reply),
      fetched(MESSAGES.m1 as GmailMessage),
    ]);
    const report = await first.result;
    for (const id of ["gmail-m2", "gmail-m4"])
      expect(message(pod, msg(id)).inReplyTo).toBe(`${LUNCH_1}#it`);
    expect(pod.get(msg("<lunch-1@example.test>"))).toBeUndefined();
    const requests = threadRequests(first.api);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/gmail/v1/users/me/threads/t1");
    expect(requests[0]?.searchParams.get("format")).toBe("metadata");
    expect(requests[0]?.searchParams.getAll("metadataHeaders")).toEqual(["Message-ID"]);
    expect(first.api).toHaveBeenCalledTimes(7);

    // Only the reply changes in the next run; its parent is already stored in the pod.
    const next = run(
      [
        ...base,
        {
          url: `${GMAIL_API}/history`,
          json: {
            historyId: "1001",
            history: [{ labelsAdded: [{ message: { id: reply.id }, labelIds: ["INBOX"] }] }],
          },
        },
        fetched(reply),
      ],
      report.state,
    );
    await next.result;
    expect(message(pod, msg("gmail-m4")).inReplyTo).toBe(`${LUNCH_1}#it`);
    expect(threadRequests(next.api)).toHaveLength(1);
    expect(next.api.mock.calls.filter(([u]) => String(u).includes("/messages/"))).toHaveLength(1);
    expect(next.api).toHaveBeenCalledTimes(5);
  });

  it("omits unknown parents and caches unsuccessful lookups too", async () => {
    const { pod, run } = setup();
    await run(GMAIL_FIXTURES).result;
    const replies = [
      replyMessage("m2", "<unknown@example.test>"),
      replyMessage("m4", "<other@example.test>"),
    ];
    const { api, result } = run([
      ...base,
      { url: `${GMAIL_API}/messages`, json: { messages: replies } },
      ...replies.map(fetched),
    ]);
    await result;
    for (const reply of replies)
      expect(message(pod, msg(`gmail-${reply.id}`)).inReplyTo).toBeUndefined();
    expect(threadRequests(api)).toHaveLength(1);
  });

  it("validates member ids, thread identity and Message-ID header tokens", async () => {
    const { pod, run } = setup();
    const parent = {
      id: "m1",
      threadId: "t1",
      payload: { headers: [{ name: "message-id", value: " <lunch-1@example.test> " }] },
    };
    const reply = replyMessage("m2");
    await run([
      ...base.filter((r) => !r.url.includes("/threads/")),
      { url: `${GMAIL_API}/messages`, json: { messages: [reply] } },
      fetched(reply),
      {
        url: `${GMAIL_API}/threads/t1`,
        json: {
          id: "t1",
          messages: [
            parent,
            null,
            ...["../bad", "a".repeat(257), "with.dot", ""].map((id) => ({ ...parent, id })),
            { ...parent, id: "wrong-thread", threadId: "other" },
            { id: "no-payload", threadId: "t1" },
            { ...parent, id: "bad-headers", payload: { headers: {} } },
            {
              id: "bad-header",
              threadId: "t1",
              payload: {
                headers: [
                  null,
                  { name: 5, value: "<lunch-1@example.test>" },
                  { name: "Subject", value: "<lunch-1@example.test>" },
                  { name: "Message-ID", value: 5 },
                  { name: "Message-ID", value: "<lunch-1@example.test> <second@example.test>" },
                ],
              },
            },
          ],
        },
      },
    ]).result;
    expect(message(pod, LUNCH_2).inReplyTo).toBe(`${LUNCH_1}#it`);
    expect(pod.get(LUNCH_1)).toBeUndefined();
  });

  it.each([
    null,
    {},
    { id: "other", messages: [] },
    { id: "t1", messages: {} },
    { id: "t1", messages: [null, { id: "invalid.id", threadId: "t1" }] },
  ])("omits links from malformed thread metadata %j", async (json) => {
    const { pod, run } = setup();
    const replies = [replyMessage("m2"), replyMessage("m4")];
    const { api, result } = run([
      ...base.filter((r) => !r.url.includes("/threads/")),
      { url: `${GMAIL_API}/messages`, json: { messages: replies } },
      ...replies.map(fetched),
      { url: `${GMAIL_API}/threads/t1`, json },
    ]);
    await result;
    for (const reply of replies)
      expect(message(pod, msg(`gmail-${reply.id}`)).inReplyTo).toBeUndefined();
    expect(threadRequests(api)).toHaveLength(1);
  });

  it.each([
    401, 403, 404, 429, 500,
  ])("propagates thread metadata HTTP %s before committing the reply", async (status) => {
    const { pod, run } = setup();
    const reply = replyMessage("m2");
    const { api, result } = run([
      ...base.filter((r) => !r.url.includes("/threads/")),
      { url: `${GMAIL_API}/messages`, json: { messages: [reply] } },
      fetched(reply),
      { url: `${GMAIL_API}/threads/t1`, json: {}, status },
    ]);
    await expect(result).rejects.toMatchObject({
      status,
      name: status === 429 ? "RateLimitedError" : "IntegrationSyncError",
    });
    expect(pod.get(LUNCH_2)).toBeUndefined();
    expect(pod.bytes(LUNCH_2.replace(/\.ttl$/, ".eml"))).toBeUndefined();
    expect(threadRequests(api)).toHaveLength(1);
  });
});

describe("Gmail full resync", () => {
  it("batches sweep cleanup and rereads folders for reconciliation", async () => {
    const { pod, run, transport } = setup();
    const messages = Array.from({ length: 53 }, (_, i) => ({
      ...(MESSAGES.m1 as GmailMessage),
      id: `sweep-${i}`,
      threadId: `sweep-${i % 3}`,
      labelIds: ["INBOX", "STARRED", "Label_1"],
    }));
    await run([
      ...base,
      { url: `${GMAIL_API}/messages`, json: { messages } },
      ...messages.map(fetched),
    ]).result;
    const collections = pod
      .urls()
      .filter((url) =>
        ["folders/", "threads/"].some((kind) => url.startsWith(`${ACCOUNT}${kind}`)),
      );
    const reads = new Map<string, number>();
    const writes = new Map<string, number>();
    transport((input, init) => {
      const target = String(input);
      const method = init?.method ?? "GET";
      const counts = method === "GET" ? reads : writes;
      counts.set(target, (counts.get(target) ?? 0) + 1);
      return pod.fetch(input, init);
    });
    await run([...base, { url: `${GMAIL_API}/messages`, json: { messages: [] } }]).result;
    expect(reads.get(`${ACCOUNT}folders/`)).toBe(2);
    for (const url of collections) {
      expect(reads.get(url), url).toBe(url.includes("/folders/") ? 2 : 1);
      expect(writes.get(url) ?? 0, url).toBeLessThanOrEqual(1);
    }
    expect(pod.urls().filter((url) => url.startsWith(`${ACCOUNT}messages/`))).toEqual([]);
    expect(pod.urls().filter((url) => url.startsWith(`${ACCOUNT}threads/`))).toEqual([]);
    expect(pod.get(folder("Label_1"))).toBeUndefined();
    expect(members(pod, folder("system:inbox"))).toEqual([]);
    expect(members(pod, folder("system:starred"))).toEqual([]);
  });

  it("sweeps Gmail messages while ignoring non-message members and subcontainers", async () => {
    const { pod, podWriter, run } = setup();
    await run(GMAIL_FIXTURES).result;
    const slugs = [
      "mail/alex~40example.test/messages/gmail-notmail.ttl",
      "mail/alex~40example.test/messages/gmail-nested/child.ttl",
      "mail/alex~40example.test/messages/notes.ttl",
    ];
    for (const slug of slugs) {
      const dataset = new Store();
      new MailCollection(`${podWriter.resolve(slug)}#it`, dataset, DataFactory).types.add(
        MAIL_CLASSES.Folder,
      );
      await podWriter.write({ slug, category: "mail", forClass: MAIL_CLASSES.Folder, dataset });
    }
    const legacy = "mail/alex~40example.test/messages/old-message-id.ttl";
    const dataset = new Store();
    new MailMessage(`${podWriter.resolve(legacy)}#it`, dataset, DataFactory).types.add(
      MAIL_CLASSES.EmailMessage,
    );
    await podWriter.write({
      slug: legacy,
      category: "mail",
      forClass: MAIL_CLASSES.EmailMessage,
      dataset,
    });
    const orphanSource = "mail/alex~40example.test/messages/gmail-orphan.eml";
    await podWriter.writeBinary?.({
      slug: orphanSource,
      contentType: "message/rfc822",
      body: new Uint8Array([42]),
    });
    await run([...base, { url: `${GMAIL_API}/messages`, json: { messages: [] } }]).result;
    for (const slug of slugs) expect(pod.get(podWriter.resolve(slug))).toBeDefined();
    expect(pod.get(podWriter.resolve(legacy))).toBeUndefined();
    expect(pod.bytes(podWriter.resolve(orphanSource))).toEqual(new Uint8Array([42]));
    for (const url of [LUNCH_1, LUNCH_2, RECEIPT]) {
      expect(pod.get(url)).toBeUndefined();
      expect(pod.bytes(url.replace(/\.ttl$/, ".eml"))).toBeUndefined();
    }
  });

  it("lists Spam and Trash, sweeps vanished messages and follows label renames", async () => {
    const { pod, run } = setup();
    const first = run(GMAIL_FIXTURES);
    await first.result;
    const list = first.api.mock.calls
      .map(([u]) => new URL(String(u)))
      .find((u) => u.pathname.endsWith("/messages"));
    expect(list?.searchParams.get("includeSpamTrash")).toBe("true");

    const renamed = {
      url: `${GMAIL_API}/labels`,
      json: {
        labels: [
          { id: "INBOX", name: "INBOX", type: "system" },
          { id: "Label_1", name: "Invoices", type: "user" },
        ],
      },
    };
    await run([
      ...base.filter((r) => !r.url.endsWith("/labels")),
      renamed,
      { url: `${GMAIL_API}/messages`, json: { messages: [MESSAGES.m1, MESSAGES.m3] } },
      fetched(MESSAGES.m1 as GmailMessage),
      fetched(MESSAGES.m3 as GmailMessage),
    ]).result;
    expect(pod.get(LUNCH_2)).toBeUndefined();
    expect(members(pod, THREAD_1)).toEqual([`${LUNCH_1}#it`]);
    expect(members(pod, folder("system:sent"))).toEqual([]);
    expect(
      new MailCollection(`${folder("Label_1")}#it`, pod.dataset(folder("Label_1")), DataFactory)
        .title,
    ).toBe("Invoices");
  });

  it("skips a message whose MIME cannot be parsed", async () => {
    const { pod, run } = setup();
    let nested = "";
    for (let i = 0; i < 300; i++)
      nested += `Content-Type: multipart/mixed; boundary="b${i}"\n\n--b${i}\n`;
    const broken: GmailMessage = {
      id: "m8",
      threadId: "t8",
      labelIds: ["INBOX"],
      raw: btoa(nested).replace(/\+/g, "-").replace(/\//g, "_"),
    };
    const report = await run([
      ...base,
      { url: `${GMAIL_API}/messages`, json: { messages: [broken, MESSAGES.m1] } },
      fetched(broken),
      fetched(MESSAGES.m1 as GmailMessage),
    ]).result;
    expect(report.skipped).toBe(1);
    expect(pod.get(LUNCH_1)).toBeDefined();
  });

  it("skips a message over the size cap and keeps its stored copy", async () => {
    const { pod, podWriter, run } = setup();
    await run(GMAIL_FIXTURES).result;
    const routes = fixtureFetch("gmail", [
      ...base,
      { url: `${GMAIL_API}/messages`, json: { messages: [MESSAGES.m1] } },
    ]);
    // A declared length past the cap is refused before the body is read.
    const api = vi.fn<typeof globalThis.fetch>(async (input, init) =>
      String(input).startsWith(`${GMAIL_API}/messages/m1`)
        ? new Response("{}", { headers: { "content-length": String(64 * 1024 * 1024) } })
        : routes(input, init),
    );
    const report = await runImport({
      adapter: gmailAdapter,
      mode: "live",
      sourceAuth: { fetch: api },
      podWriter,
    });
    expect(report.skipped).toBe(1);
    expect(pod.get(LUNCH_1)).toBeDefined();
    expect(pod.bytes(LUNCH_1.replace(/\.ttl$/, ".eml"))).toBeDefined();
  });

  it("keeps listed messages whose raw payload cannot be re-read", async () => {
    const { pod, run } = setup();
    await run(GMAIL_FIXTURES).result;
    await run([
      ...base,
      { url: `${GMAIL_API}/messages`, json: { messages: [MESSAGES.m1] } },
      fetched({ ...(MESSAGES.m1 as GmailMessage), raw: "not base64!" }),
    ]).result;
    expect(pod.get(LUNCH_1)).toBeDefined();
    expect(pod.bytes(LUNCH_1.replace(/\.ttl$/, ".eml"))).toBeDefined();
    expect(members(pod, THREAD_1)).toEqual([`${LUNCH_1}#it`]);
    expect(members(pod, folder("system:inbox"))).toEqual([`${LUNCH_1}#it`]);
  });

  it("keeps two Gmail messages that share a Message-ID", async () => {
    const { pod, run } = setup();
    const copy: GmailMessage = { ...(MESSAGES.m1 as GmailMessage), id: "m7", threadId: "t7" };
    await run([
      ...base,
      { url: `${GMAIL_API}/messages`, json: { messages: [MESSAGES.m1, copy] } },
      fetched(MESSAGES.m1 as GmailMessage),
      fetched(copy),
    ]).result;
    expect(pod.get(LUNCH_1)).toBeDefined();
    expect(pod.get(msg("gmail-m7"))).toBeDefined();
    // Deleting one source id cannot change the other message's document identity.
    await run([
      ...base,
      { url: `${GMAIL_API}/messages`, json: { messages: [copy] } },
      fetched(copy),
    ]).result;
    expect(pod.get(LUNCH_1)).toBeUndefined();
    expect(pod.get(msg("gmail-m7"))).toBeDefined();
  });
});

describe("Gmail history continuation", () => {
  async function imported() {
    const ctx = setup();
    const first = await ctx.run(GMAIL_FIXTURES).result;
    return { ...ctx, state: first.state };
  }

  it("replays additions, label changes and deletions, then advances the cursor", async () => {
    const { pod, run, state } = await imported();
    const archived: GmailMessage = { ...(MESSAGES.m1 as GmailMessage), labelIds: [] };
    const added: GmailMessage = {
      id: "m4",
      threadId: "t1",
      labelIds: ["INBOX"],
      raw: rawMessage([
        "From: Sam Example <sam@example.test>",
        "Subject: Re: Lunch on Friday?",
        "Message-ID: <lunch-3@example.test>",
        "In-Reply-To: <lunch-2@example.test>",
        "",
        "Great.",
      ]),
    };
    const { api, result } = run(
      [
        ...base,
        {
          url: `${GMAIL_API}/history`,
          json: {
            history: [
              {
                id: "1001",
                labelsRemoved: [
                  { message: { id: "m1", threadId: "t1" }, labelIds: ["INBOX", "UNREAD"] },
                ],
              },
              { id: "1002", messagesDeleted: [{ message: { id: "m2", threadId: "t1" } }] },
            ],
            historyId: "1002",
            nextPageToken: "h2",
          },
        },
        {
          url: `${GMAIL_API}/history`,
          json: {
            history: [
              { id: "1003", messagesAdded: [{ message: { id: "m4", threadId: "t1" } }] },
              {
                id: "1004",
                labelsAdded: [{ message: { id: "m2", threadId: "t1" }, labelIds: ["STARRED"] }],
              },
            ],
            historyId: "1004",
          },
        },
        fetched(archived),
        fetched(added),
      ],
      state,
    );
    const report = await result;
    expect(report.cursor).toBe("1004");
    const history = api.mock.calls
      .map(([u]) => new URL(String(u)))
      .filter((u) => u.pathname.endsWith("/history"));
    expect(history.map((u) => u.searchParams.get("startHistoryId"))).toEqual(["1000", "1000"]);
    expect(history[1]?.searchParams.get("pageToken")).toBe("h2");
    expect(history[0]?.searchParams.getAll("historyTypes")).toEqual([
      "messageAdded",
      "messageDeleted",
      "labelAdded",
      "labelRemoved",
    ]);

    expect(pod.get(LUNCH_2)).toBeUndefined();
    expect(pod.bytes(LUNCH_2.replace(/\.ttl$/, ".eml"))).toBeUndefined();
    const Lunch3 = msg("gmail-m4");
    expect(members(pod, THREAD_1)).toEqual([`${LUNCH_1}#it`, `${Lunch3}#it`]);
    expect(members(pod, folder("system:sent"))).toEqual([]);
    expect(members(pod, folder("system:inbox"))).toEqual([`${Lunch3}#it`]);
    expect(members(pod, folder("system:archive"))).toEqual([`${LUNCH_1}#it`, `${RECEIPT}#it`]);
    expect(message(pod, LUNCH_1).dateRead?.toISOString()).toBe("2026-06-11T09:00:00.000Z");
    expect([...message(pod, LUNCH_1).folderIris]).toEqual([`${folder("system:archive")}#it`]);
  });

  it("removes a thread document when its last message is deleted", async () => {
    const { pod, run, state } = await imported();
    await run(
      [
        ...base,
        {
          url: `${GMAIL_API}/history`,
          json: {
            history: [{ id: "2", messagesDeleted: [{ message: { id: "m3", threadId: "t3" } }] }],
            historyId: "2",
          },
        },
      ],
      state,
    ).result;
    expect(pod.get(RECEIPT)).toBeUndefined();
    expect(pod.get(`${ACCOUNT}threads/gmail-t3.ttl`)).toBeUndefined();
    expect(pod.get(folder("Label_1"))).toBeUndefined();
    expect(members(pod, folder("system:starred"))).toEqual([]);
    expect(pod.urls().some((u) => u.includes("attachments"))).toBe(false);
  });

  it("treats spam and vanished messages as deletions", async () => {
    const { pod, run, state } = await imported();
    await run(
      [
        ...base,
        {
          url: `${GMAIL_API}/history`,
          json: {
            history: [
              {
                id: "3",
                labelsAdded: [{ message: { id: "m1", threadId: "t1" }, labelIds: ["SPAM"] }],
              },
              { id: "4", messagesAdded: [{ message: { id: "m3", threadId: "t3" } }] },
            ],
            historyId: "4",
          },
        },
        fetched({ ...(MESSAGES.m1 as GmailMessage), labelIds: ["SPAM"] }),
        { url: `${GMAIL_API}/messages/m3`, json: { error: {} }, status: 404 },
      ],
      state,
    ).result;
    expect(pod.get(LUNCH_1)).toBeUndefined();
    expect(pod.get(RECEIPT)).toBeUndefined();
    expect(members(pod, THREAD_1)).toEqual([`${LUNCH_2}#it`]);
  });

  it("falls back to a full sync when the history id has expired", async () => {
    const { run, state } = await imported();
    const { api, result } = run(
      [...GMAIL_FIXTURES, { url: `${GMAIL_API}/history`, json: { error: {} }, status: 404 }],
      state,
    );
    const report = await result;
    expect(report.cursor).toBe("1000");
    expect(api.mock.calls.some(([u]) => new URL(String(u)).pathname.endsWith("/messages"))).toBe(
      true,
    );
  });

  it("does not swallow other history failures", async () => {
    const { run, state } = await imported();
    await expect(
      run([...base, { url: `${GMAIL_API}/history`, json: {}, status: 500 }], state).result,
    ).rejects.toMatchObject({ status: 500 });
  });

  it("rejects an incomplete profile", async () => {
    const { run } = setup();
    await expect(
      run([{ url: `${GMAIL_API}/profile`, json: { emailAddress: "x@example.test" } }]).result,
    ).rejects.toThrow("incomplete mailbox profile");
  });
});

describe("Gmail deletion replay", () => {
  const full = (messages: GmailMessage[]): FixtureRoute[] => [
    ...base,
    { url: `${GMAIL_API}/messages`, json: { messages } },
    ...messages.map(fetched),
  ];
  const history = (deleted: string[], added: GmailMessage[] = []): FixtureRoute[] => [
    ...base,
    {
      url: `${GMAIL_API}/history`,
      json: {
        historyId: "2000",
        history: [
          {
            id: "2000",
            messagesDeleted: deleted.map((id) => ({ message: { id } })),
            messagesAdded: added.map((m) => ({ message: { id: m.id } })),
          },
        ],
      },
    },
    ...added.filter((m) => m.id !== "fail").map(fetched),
  ];
  const failNext: GmailMessage = { id: "fail", threadId: "fail" };
  const failRoute: FixtureRoute = {
    url: `${GMAIL_API}/messages/fail`,
    json: {},
    status: 500,
  };
  const receipt = MESSAGES.m3 as GmailMessage;
  const noMail = (pod: ReturnType<typeof createMemoryPod>) => {
    expect(pod.urls().filter((url) => url.startsWith(`${ACCOUNT}messages/`))).toEqual([]);
    expect(pod.urls().filter((url) => url.startsWith(`${ROOT}mail/attachments/`))).toEqual([]);
    expect(pod.urls().filter((url) => url.startsWith(`${ACCOUNT}threads/`))).toEqual([]);
    for (const url of pod.urls().filter((url) => url.startsWith(`${ACCOUNT}folders/`)))
      expect(members(pod, url)).toEqual([]);
  };

  it("retains queued deletion inventory when a run crashes before flush, then replays", async () => {
    const { pod, run } = setup();
    const { state } = await run(full([receipt])).result;
    await expect(
      run([...history([receipt.id], [failNext]), failRoute], state).result,
    ).rejects.toMatchObject({ status: 500 });
    expect(pod.get(RECEIPT)).toBeDefined();
    expect(pod.bytes(RECEIPT.replace(/\.ttl$/, ".eml"))).toBeDefined();
    expect(members(pod, `${ACCOUNT}threads/gmail-t3.ttl`)).toEqual([`${RECEIPT}#it`]);
    const report = await run(history([receipt.id]), state).result;
    expect(report.cursor).toBe("2000");
    noMail(pod);
  });

  it.each(["history", "full"])("deletes an uncheckpointed addition through %s", async (mode) => {
    const { pod, run, transport } = setup();
    const { state } = await run(full([])).result;
    // Fail after the RDF, bytes AND collections commit, before the run can report success.
    transport((input, init) =>
      String(input) === `${ROOT}_provenance.ttl` && init?.method === "PUT"
        ? Promise.resolve(new Response(null, { status: 500 }))
        : pod.fetch(input, init),
    );
    await expect(run(history([], [receipt]), state).result).rejects.toThrow();
    expect(members(pod, `${ACCOUNT}threads/gmail-t3.ttl`)).toEqual([`${RECEIPT}#it`]);
    transport(pod.fetch);
    await run(
      mode === "history" ? history([receipt.id]) : full([]),
      mode === "history" ? state : undefined,
    ).result;
    noMail(pod);
  });

  it("removes stale label membership when deletion follows interrupted relabeling", async () => {
    const { pod, run } = setup();
    const { state } = await run(full([receipt])).result;
    const relabelled = { ...receipt, labelIds: ["INBOX"] };
    await expect(
      run([...history([], [relabelled, failNext]), failRoute], state).result,
    ).rejects.toMatchObject({ status: 500 });
    expect(members(pod, folder("Label_1"))).toEqual([`${RECEIPT}#it`]);
    expect([...message(pod, RECEIPT).folderIris]).toEqual([`${folder("system:inbox")}#it`]);
    await run(history([receipt.id]), state).result;
    noMail(pod);
  });

  it.each([
    true,
    false,
  ])("keeps replacement identity after a crash (replacement survives: %s)", async (keep) => {
    const { pod, run } = setup();
    const { state } = await run(full([receipt])).result;
    const copy = { ...receipt, id: "m7", threadId: "t7" };
    await expect(
      run([...history([receipt.id], [copy, failNext]), failRoute], state).result,
    ).rejects.toMatchObject({ status: 500 });
    // This deletion is still queued when the subsequent source request fails.
    expect(pod.get(RECEIPT)).toBeDefined();
    expect(pod.get(msg("gmail-m7"))).toBeDefined();
    expect(pod.bytes(msg("gmail-m7").replace(/\.ttl$/, ".eml"))).toBeDefined();
    if (keep) {
      await run(full([copy])).result;
      expect(members(pod, `${ACCOUNT}threads/gmail-t7.ttl`)).toEqual([`${msg("gmail-m7")}#it`]);
      expect(pod.get(`${ACCOUNT}threads/gmail-t3.ttl`)).toBeUndefined();
      expect(members(pod, folder("Label_1"))).toEqual([`${msg("gmail-m7")}#it`]);
      expect(pod.urls().filter((url) => url.startsWith(`${ACCOUNT}messages/`))).toHaveLength(2);
      await run(history([copy.id]), state).result;
    } else {
      await run(history([receipt.id, copy.id]), state).result;
    }
    noMail(pod);
  });

  it("retains cleanup inventory through repeated interruptions at each deletion stage", async () => {
    const { pod, run, transport } = setup();
    const { state } = await run(full([receipt])).result;
    const attachment = [...message(pod, RECEIPT).attachments][0] as string;
    for (const [method, target] of [
      ["DELETE", `${ACCOUNT}threads/gmail-t3.ttl`],
      ["DELETE", folder("Label_1")],
      ["PUT", folder("system:archive")],
      ["PUT", folder("system:starred")],
      ["DELETE", attachment],
      ["DELETE", RECEIPT.replace(/\.ttl$/, ".eml")],
      ["DELETE", RECEIPT],
    ]) {
      let hit = false;
      transport((input, init) => {
        if (init?.method === method && String(input) === target) {
          hit = true;
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        return pod.fetch(input, init);
      });
      await expect(run(history([receipt.id]), state).result).rejects.toThrow();
      expect(hit).toBe(true);
      // The RDF stays until every earlier cleanup operation has succeeded.
      expect(pod.get(RECEIPT)).toBeDefined();
    }
    transport(pod.fetch);
    await expect(
      run([...history([receipt.id], [failNext]), failRoute], state).result,
    ).rejects.toMatchObject({ status: 500 });
    await run(history([receipt.id]), state).result;
    noMail(pod);
  });
});

describe("Gmail capped full-sync convergence", () => {
  it.each([
    "requests",
    "bytes",
  ])("makes progress on consecutive %s-capped runs and eventually completes", async (resource) => {
    const { pod, podWriter } = setup();
    const messages = Array.from({ length: 6 }, (_, i) => ({
      ...(MESSAGES.m1 as GmailMessage),
      id: `capped-${i}`,
      threadId: `capped-${i}`,
    }));
    const routes: FixtureRoute[] = [
      ...base,
      {
        url: `${GMAIL_API}/messages`,
        json: { messages: messages.map(({ id, threadId }) => ({ id, threadId })) },
      },
      ...messages.map(fetched),
    ];
    const limits = resource === "requests" ? { maxRequests: 5 } : { maxBytes: 2300 };
    let previous = 0;
    let complete = false;
    for (let i = 0; i < 6; i++) {
      try {
        const report = await runImport({
          adapter: gmailAdapter,
          mode: "live",
          podWriter,
          sourceAuth: { fetch: fixtureFetch("gmail", routes) },
          limits,
        });
        expect(report.cursor).toBe("1000");
        complete = true;
      } catch (error) {
        expect(error).toMatchObject({ name: "RunBudgetExceededError", resource });
      }
      const saved = messages.filter((m) =>
        pod.bytes(msg(`gmail-${m.id}`).replace(/\.ttl$/, ".eml")),
      ).length;
      expect(saved).toBeGreaterThan(previous);
      previous = saved;
      if (complete) break;
    }
    expect(complete).toBe(true);
    expect(previous).toBe(messages.length);
    expect(members(pod, folder("system:inbox"))).toHaveLength(messages.length);
  });
});

it("resumes Gmail across pages under an item cap, retains the initial history id and sweeps only after completion", async () => {
  const { pod, podWriter, run } = setup();
  const initial = await run(GMAIL_FIXTURES).result;
  const messages = Array.from({ length: 5 }, (_, i) => ({
    ...(MESSAGES.m1 as GmailMessage),
    id: `paged-${i}`,
    threadId: `paged-${i}`,
  }));
  let profile = "1000";
  const source = fixtureFetch("gmail", [...base, ...messages.map(fetched)]);
  const fetchedIds: string[] = [];
  const tokens: (string | null)[] = [];
  const api: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/profile"))
      return Response.json({ emailAddress: "alex@example.test", historyId: profile });
    if (url.pathname.endsWith("/messages")) {
      const pageToken = url.searchParams.get("pageToken");
      tokens.push(pageToken);
      const rows = pageToken ? messages.slice(3) : messages.slice(0, 3);
      return Response.json({
        messages: rows.map(({ id, threadId }) => ({ id, threadId })),
        ...(!pageToken ? { nextPageToken: "second" } : {}),
      });
    }
    const id = url.pathname.split("/messages/")[1];
    if (id) fetchedIds.push(id);
    return source(input, init);
  };
  for (let i = 0; i < messages.length; i++) {
    const onState = vi.fn();
    const pending = runImport({
      adapter: gmailAdapter,
      mode: "live",
      podWriter,
      sourceAuth: { fetch: api },
      state: initial.state,
      cursor: "",
      onState,
      limits: { maxItems: 8 },
    }); // profile + 6 labels + one message
    if (i < messages.length - 1) {
      await expect(pending).rejects.toMatchObject({ resource: "items" });
      expect(onState).toHaveBeenCalledWith({ ...initial.state, lastOutcome: "error" });
      expect(pod.get(RECEIPT)).toBeDefined();
    } else {
      expect((await pending).cursor).toBe("1000");
      expect(pod.get(RECEIPT)).toBeUndefined();
    }
    expect(
      messages.filter((m) => pod.bytes(msg(`gmail-${m.id}`).replace(/\.ttl$/, ".eml"))),
    ).toHaveLength(i + 1);
    profile = "2000";
  }
  expect(fetchedIds).toEqual(messages.map((m) => m.id));
  expect(tokens).toContain("second");
  expect(pod.urls().some((url) => url.endsWith("_full-sync.ttl"))).toBe(false);
  expect(members(pod, folder("system:inbox"))).toHaveLength(messages.length);
});

// Ports the delta-review duration probe, with assertions and a deterministic source clock.
it("completes a full sync across consecutive duration-capped runs", async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
  try {
    const { pod, podWriter } = setup();
    const messages = Array.from({ length: 8 }, (_, i) => ({
      ...(MESSAGES.m1 as GmailMessage),
      id: `duration-${i}`,
      threadId: `duration-${i}`,
    }));
    const source = fixtureFetch("gmail", [
      ...base,
      { url: `${GMAIL_API}/messages`, json: { messages } },
      ...messages.map(fetched),
    ]);
    const fetchedIds: string[] = [];
    const api: typeof fetch = async (input, init) => {
      const id = new URL(String(input)).pathname.split("/messages/")[1];
      if (id) {
        fetchedIds.push(id);
        await vi.advanceTimersByTimeAsync(40);
      }
      return source(input, init);
    };
    let complete = false;
    for (let run = 0; run < 4; run++) {
      try {
        expect(
          (
            await runImport({
              adapter: gmailAdapter,
              mode: "live",
              podWriter,
              sourceAuth: { fetch: api },
              limits: { maxDurationMs: 150 },
            })
          ).cursor,
        ).toBe("1000");
        complete = true;
        break;
      } catch (error) {
        expect(error).toMatchObject({ resource: "duration" });
        expect(pod.urls().some((url) => url.endsWith("_full-sync.ttl"))).toBe(true);
      }
    }
    expect(complete).toBe(true);
    expect(members(pod, folder("system:inbox"))).toHaveLength(messages.length);
    expect(fetchedIds.filter((id) => id === messages[0]?.id)).toHaveLength(1);
    expect(pod.urls().some((url) => url.endsWith("_full-sync.ttl"))).toBe(false);
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

it("does not skip a message when deletion shifts a saved page's rows", async () => {
  const { pod, podWriter } = setup();
  const messages = ["shift-a", "shift-b", "shift-c"].map((id) => ({
    ...(MESSAGES.m1 as GmailMessage),
    id,
    threadId: id,
  }));
  const raw = vi.fn(fixtureFetch("gmail", [...base, ...messages.map(fetched)]));
  let rows = messages;
  const api: typeof fetch = async (input, init) =>
    new URL(String(input)).pathname.endsWith("/messages")
      ? Response.json({ messages: rows })
      : raw(input, init);
  await expect(
    runImport({
      adapter: gmailAdapter,
      mode: "live",
      podWriter,
      sourceAuth: { fetch: api },
      limits: { maxItems: 8 },
    }),
  ).rejects.toMatchObject({ resource: "items" });
  rows = messages.slice(1);
  await runImport({ adapter: gmailAdapter, mode: "live", podWriter, sourceAuth: { fetch: api } });
  for (const row of rows) expect(pod.get(msg(`gmail-${row.id}`))).toBeDefined();
});

it("restarts an expired saved page token and reuses completed message IDs", async () => {
  const { pod, podWriter } = setup();
  const messages = ["token-a", "token-gone", "token-b"].map((id) => ({
    ...(MESSAGES.m1 as GmailMessage),
    id,
    threadId: id,
  }));
  const raw = vi.fn(fixtureFetch("gmail", [...base, ...messages.map(fetched)]));
  let expired = false;
  const api: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) {
      if (url.searchParams.has("pageToken"))
        return expired
          ? Response.json({}, { status: 400 })
          : Response.json({ messages: messages.slice(2) });
      return Response.json({
        messages: expired ? [messages[0], messages[2]] : messages.slice(0, 2),
        ...(!expired ? { nextPageToken: "expired" } : {}),
      });
    }
    return raw(input, init);
  };
  await expect(
    runImport({
      adapter: gmailAdapter,
      mode: "live",
      podWriter,
      sourceAuth: { fetch: api },
      limits: { maxRequests: 5 },
    }),
  ).rejects.toMatchObject({ resource: "requests" });
  expired = true;
  await expect(
    runImport({ adapter: gmailAdapter, mode: "live", podWriter, sourceAuth: { fetch: api } }),
  ).resolves.toMatchObject({ cursor: "1000" });
  expect(pod.get(msg("gmail-token-a"))).toBeDefined();
  expect(pod.get(msg("gmail-token-gone"))).toBeUndefined();
  expect(pod.get(msg("gmail-token-b"))).toBeDefined();
  expect(
    raw.mock.calls.filter(([input]) => String(input).includes("/messages/token-a")),
  ).toHaveLength(1);
});

it("still charges duplicate completed IDs returned again within the same run", async () => {
  const { podWriter } = setup();
  const item = MESSAGES.m1 as GmailMessage;
  const api = fixtureFetch("gmail", [
    ...base,
    fetched(item),
    {
      url: `${GMAIL_API}/messages`,
      json: { messages: [{ id: item.id }, { id: item.id }] },
    },
  ]);
  await expect(
    runImport({
      adapter: gmailAdapter,
      mode: "live",
      podWriter,
      sourceAuth: { fetch: api },
      limits: { maxItems: 8 },
    }),
  ).rejects.toMatchObject({ resource: "items" });
});

describe("Gmail finalisation keeps the journal until the cursor is reported", () => {
  const journalUrl = `${ACCOUNT}_full-sync.ttl`;
  const many = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...(MESSAGES.m1 as GmailMessage),
      id: `${prefix}-${i}`,
      threadId: `${prefix}-${i}`,
    }));
  const source = (messages: GmailMessage[], onRaw: (id: string) => Promise<void> | void) => {
    const routes = fixtureFetch("gmail", [
      ...base,
      { url: `${GMAIL_API}/messages`, json: { messages } },
      ...messages.map(fetched),
    ]);
    const ids: string[] = [];
    const api: typeof fetch = async (input, init) => {
      const id = new URL(String(input)).pathname.split("/messages/")[1];
      if (id) {
        ids.push(id);
        await onRaw(id);
      }
      return routes(input, init);
    };
    return { api, ids };
  };

  // Ports the round-3 delta-review probe: the deadline used to land after the sweep and the
  // journal deletion, failing the run with neither a cursor nor a journal to resume from.
  it("succeeds with the cursor when the deadline expires during the finish phase", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    try {
      const { pod, podWriter, transport } = setup();
      const messages = many("finish", 6);
      let slowSource = true;
      const { api, ids } = source(messages, async () => {
        if (slowSource) await vi.advanceTimersByTimeAsync(40);
      });
      const run = () =>
        runImport({
          adapter: gmailAdapter,
          mode: "live",
          podWriter,
          sourceAuth: { fetch: api },
          limits: { maxDurationMs: 150 },
        });
      await expect(run()).rejects.toMatchObject({ resource: "duration" });
      expect(pod.get(journalUrl)).toBeDefined();
      // Second run: the source is fast, but the final folder flush outlasts the deadline.
      slowSource = false;
      let slowed = 0;
      transport(async (input, init) => {
        if (init?.method === "PUT" && String(input) === folder("system:inbox")) {
          slowed++;
          await vi.advanceTimersByTimeAsync(400);
        }
        return pod.fetch(input, init);
      });
      const report = await run();
      expect(slowed).toBeGreaterThan(0);
      expect(report.cursor).toBe("1000");
      expect(report.state?.cursor).toBe("1000");
      expect(pod.get(journalUrl)).toBeUndefined();
      expect(members(pod, folder("system:inbox"))).toHaveLength(messages.length);
      // Only the payload in flight when run 1's deadline fired is fetched twice.
      expect(ids.length - new Set(ids).size).toBeLessThanOrEqual(1);
      expect(new Set(ids).size).toBe(messages.length);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("keeps the journal when the caller cancels during finish; the next run refetches nothing", async () => {
    const { pod, podWriter, transport } = setup();
    const messages = many("cancel", 4);
    const { api, ids } = source(messages, () => undefined);
    const controller = new AbortController();
    // Cancel once listing is done: during the sweep that precedes the final flush.
    transport((input, init) => {
      if ((init?.method ?? "GET") === "GET" && String(input) === `${ACCOUNT}messages/`)
        controller.abort(new Error("user cancelled"));
      return pod.fetch(input, init);
    });
    const onState = vi.fn();
    await expect(
      runImport({
        adapter: gmailAdapter,
        mode: "live",
        podWriter,
        sourceAuth: { fetch: api },
        signal: controller.signal,
        onState,
      }),
    ).rejects.toThrow("user cancelled");
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ lastOutcome: "success" }));
    expect(pod.get(journalUrl)).toBeDefined();
    expect(ids).toEqual(messages.map((m) => m.id));
    transport(pod.fetch);
    const report = await runImport({
      adapter: gmailAdapter,
      mode: "live",
      podWriter,
      sourceAuth: { fetch: api },
    });
    expect(report.cursor).toBe("1000");
    expect(ids).toEqual(messages.map((m) => m.id));
    expect(pod.get(journalUrl)).toBeUndefined();
    expect(members(pod, folder("system:inbox"))).toHaveLength(messages.length);
  });

  it("reports the cursor even when clearing the journal fails afterwards", async () => {
    const { pod, podWriter, transport } = setup();
    const { api } = source(many("keep", 2), () => undefined);
    const onState = vi.fn();
    transport((input, init) =>
      init?.method === "DELETE" && String(input) === journalUrl
        ? Promise.resolve(new Response(null, { status: 500 }))
        : pod.fetch(input, init),
    );
    const report = await runImport({
      adapter: gmailAdapter,
      mode: "live",
      podWriter,
      sourceAuth: { fetch: api },
      onState,
    });
    expect(report.cursor).toBe("1000");
    expect(onState).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "1000", lastOutcome: "success" }),
    );
    expect(pod.get(journalUrl)).toBeDefined();
  });

  it("skips and counts a raw message whose response times out, keeping its stored copy", async () => {
    const { pod, podWriter, run } = setup();
    await run(GMAIL_FIXTURES).result;
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    try {
      const routes = fixtureFetch("gmail", GMAIL_FIXTURES);
      const api: typeof fetch = async (input, init) => {
        if (String(input).startsWith(`${GMAIL_API}/messages/m1?`)) {
          // The header timeout fires while the transport stalls.
          await vi.advanceTimersByTimeAsync(61_000);
          return new Promise<Response>(() => undefined);
        }
        return routes(input, init);
      };
      const report = await runImport({
        adapter: gmailAdapter,
        mode: "live",
        podWriter,
        sourceAuth: { fetch: api },
      });
      expect(report.skipped).toBe(1);
      expect(report.state?.counts.skipped).toBe(1);
      expect(pod.get(LUNCH_1)).toBeDefined();
      expect(pod.get(LUNCH_2)).toBeDefined();
      expect(pod.get(RECEIPT)).toBeDefined();
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("retries a timed-out message when an interrupted full sync resumes", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    try {
      const { pod, podWriter } = setup();
      const messages = many("stall", 3);
      let stall = true;
      const { api, ids } = source(messages, async (id) => {
        if (stall && id.startsWith("stall-0")) {
          await vi.advanceTimersByTimeAsync(61_000);
          await new Promise(() => undefined);
        }
      });
      await expect(
        runImport({
          adapter: gmailAdapter,
          mode: "live",
          podWriter,
          sourceAuth: { fetch: api },
          limits: { maxItems: 9 }, // profile + 6 labels + two rows
        }),
      ).rejects.toMatchObject({ resource: "items" });
      expect(pod.get(msg("gmail-stall-1"))).toBeDefined();
      stall = false;
      await runImport({
        adapter: gmailAdapter,
        mode: "live",
        podWriter,
        sourceAuth: { fetch: api },
      });
      // stall-0 timed out and is retried; stall-1 was completed and is not refetched.
      expect(ids.filter((id) => id.startsWith("stall-0"))).toHaveLength(2);
      expect(ids.filter((id) => id.startsWith("stall-1"))).toHaveLength(1);
      expect(pod.get(msg("gmail-stall-0"))).toBeDefined();
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});

it("exempts a resumed completed ID from item accounting only once per run", async () => {
  const { podWriter } = setup();
  const item = MESSAGES.m1 as GmailMessage;
  const other = { ...item, id: "resume-other", threadId: "resume-other" };
  // Run 1 completes m1, then fails on the next row: the journal records m1 as charged.
  await expect(
    runImport({
      adapter: gmailAdapter,
      mode: "live",
      podWriter,
      sourceAuth: {
        fetch: fixtureFetch("gmail", [
          ...base,
          fetched(item),
          fetched(other),
          { url: `${GMAIL_API}/messages`, json: { messages: [{ id: item.id }, { id: other.id }] } },
        ]),
      },
      limits: { maxItems: 8 }, // profile + 6 labels + one row
    }),
  ).rejects.toMatchObject({ resource: "items" });
  const resumed = (maxItems: number) =>
    runImport({
      adapter: gmailAdapter,
      mode: "live",
      podWriter,
      sourceAuth: {
        fetch: fixtureFetch("gmail", [
          ...base,
          fetched(item),
          {
            url: `${GMAIL_API}/messages`,
            json: { messages: [{ id: item.id }, { id: item.id }, { id: item.id }] },
          },
        ]),
      },
      limits: { maxItems },
    });
  // Profile + labels (7), the first m1 free, the two repeats charged: 9 items.
  await expect(resumed(8)).rejects.toMatchObject({ resource: "items" });
  await expect(resumed(9)).resolves.toMatchObject({ cursor: "1000" });
});
