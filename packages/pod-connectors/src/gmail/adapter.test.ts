// AUTHORED-BY Claude Opus 5.5
import { DataFactory } from "n3";
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
import { MailCollection, MailMessage } from "../mail/vocab.js";
import { gmailAdapter } from "./adapter.js";
import { GMAIL_API, GMAIL_FIXTURES, type GmailMessage, MESSAGES, rawMessage } from "./fixtures.js";

const ROOT = `${TEST_POD_ROOT}integrations/gmail/`;
const ACCOUNT = `${ROOT}mail/alex~40example.test/`;
const msg = (id: string) => `${ACCOUNT}messages/${encodeURIComponent(id).replace(/%/g, "~")}.ttl`;
const LUNCH_1 = msg("<lunch-1@example.test>");
const LUNCH_2 = msg("<lunch-2@example.test>");
const RECEIPT = msg("<receipt-9@shop.example.test>");
const THREAD_1 = `${ACCOUNT}threads/gmail-t1.ttl`;
const folder = (name: string) => `${ACCOUNT}folders/${name}.ttl`;

const message = (pod: ReturnType<typeof createMemoryPod>, url: string) =>
  new MailMessage(`${url}#it`, pod.dataset(url), DataFactory);
const members = (pod: ReturnType<typeof createMemoryPod>, url: string) =>
  [...new MailCollection(`${url}#it`, pod.dataset(url), DataFactory).members].sort();

function setup() {
  const pod = createMemoryPod();
  const podWriter = createFetchPodWriter({
    adapterId: "gmail",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
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
  return { pod, run };
}

const base = GMAIL_FIXTURES.filter((r) => !r.url.includes("/messages"));
const fetched = (m: GmailMessage): FixtureRoute => ({
  url: `${GMAIL_API}/messages/${m.id}`,
  json: m,
});

describe("Gmail full import", () => {
  it("stores messages, sources, threads and folders in the pod-mail layout", async () => {
    const { pod, report } = await demoImport(gmailAdapter);
    expect(report.cursor).toBe("1000");
    expect(report.categories).toEqual(["mail"]);

    const first = message(pod, LUNCH_1);
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
  });

  it("stores attachments as opaque bytes, never as RDF", async () => {
    const { pod } = await demoImport(gmailAdapter);
    const receipt = message(pod, RECEIPT);
    const [attachment] = [...receipt.attachments];
    expect(attachment).toBe(
      `${ROOT}mail/attachments/alex~40example.test/~3Creceipt-9~40shop.example.test~3E-0`,
    );
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

  it("uses a fallback id when Message-ID is missing", async () => {
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
});

describe("Gmail full resync", () => {
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
    // Once the owner is gone, the copy keeps its document instead of moving to the Message-ID.
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
    const Lunch3 = msg("<lunch-3@example.test>");
    expect(members(pod, THREAD_1)).toEqual([`${LUNCH_1}#it`, `${Lunch3}#it`]);
    expect(members(pod, folder("system:sent"))).toEqual([]);
    expect(members(pod, folder("system:inbox"))).toEqual([`${Lunch3}#it`]);
    expect(members(pod, folder("system:archive"))).toEqual([`${LUNCH_1}#it`, `${RECEIPT}#it`]);
    expect(message(pod, LUNCH_1).dateRead?.toISOString()).toBe("2026-06-11T09:00:00.000Z");
    expect([...message(pod, LUNCH_1).folderIris]).toEqual([`${folder("system:archive")}#it`]);
  });

  it("recovers messages an interrupted run wrote before its index was saved", async () => {
    const { pod, run, state } = await imported();
    const added: GmailMessage = {
      id: "m5",
      threadId: "t5",
      labelIds: ["INBOX"],
      raw: rawMessage(["From: a@example.test", "Message-ID: <late@example.test>", "", "Hi"]),
    };
    const history = (records: unknown[]): FixtureRoute => ({
      url: `${GMAIL_API}/history`,
      json: { history: records, historyId: "1010" },
    });
    // m5 is written, then the next fetch fails: the run ends before the index is saved.
    await expect(
      run(
        [
          ...base,
          history([
            { id: "1005", messagesAdded: [{ message: { id: "m5", threadId: "t5" } }] },
            { id: "1006", messagesAdded: [{ message: { id: "m6", threadId: "t6" } }] },
          ]),
          fetched(added),
          { url: `${GMAIL_API}/messages/m6`, json: {}, status: 500 },
        ],
        state,
      ).result,
    ).rejects.toMatchObject({ status: 500 });
    const late = msg("<late@example.test>");
    expect(pod.get(late)).toBeDefined();
    // Gmail deletes m5 before the retry, which replays the same history.
    await run(
      [
        ...base,
        history([
          { id: "1005", messagesAdded: [{ message: { id: "m5", threadId: "t5" } }] },
          { id: "1007", messagesDeleted: [{ message: { id: "m5", threadId: "t5" } }] },
        ]),
      ],
      state,
    ).result;
    expect(pod.get(late)).toBeUndefined();
    expect(pod.get(`${ACCOUNT}gmail-index.ttl`)).not.toContain("incomplete");
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
