// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/noNonNullAssertion: Assertions establish fixture entries before use.
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { pageThreads } from "../../src/apps/mail/lib/model/helpers.js";
import {
  importMbox,
  parseEmail,
  persistImportedMail,
} from "../../src/apps/mail/lib/model/importer.js";
import { MailError, MailStore } from "../../src/apps/mail/lib/model/io.js";
import { MailboxDataset } from "../../src/apps/mail/lib/model/mailbox.js";
import {
  archive,
  documentOf,
  loadFolders,
  loadThread,
  loadThreads,
  setLabel,
  setRead,
  setStarred,
} from "../../src/apps/mail/lib/model/operations.js";
import {
  mailDocument,
  mailRoot,
  systemFolderDocument,
} from "../../src/apps/mail/lib/model/paths.js";
import { serialiseToTurtle } from "../../src/apps/mail/lib/model/serialise.js";
import { TypeIndexDataset } from "../../src/apps/mail/lib/model/typeIndex.js";
import { Classes } from "../../src/apps/mail/lib/model/vocab.js";

const storage = "https://pod.example/alice/";
const root = mailRoot(storage, "personal");
const message = `${mailDocument(root, "messages", "m")}#it`;
const thread = `${mailDocument(root, "threads", "t")}#it`;
const inbox = `${systemFolderDocument(root, "inbox")}#it`;
const archived = `${systemFolderDocument(root, "archive")}#it`;
/** Real RDF over a fetch seam. Reject writes whose validator no longer matches. */
function server() {
  const files = new Map<string, { body: string; etag: string }>();
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let version = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const file = files.get(url);
    if (init?.method === "PUT") {
      const headers = new Headers(init.headers);
      if (file ? headers.get("if-match") !== file.etag : headers.get("if-none-match") !== "*")
        return new Response(null, { status: 412 });
      const body = typeof init.body === "string" ? init.body : await new Response(init.body).text();
      const etag = `"v${++version}"`;
      files.set(url, { body, etag });
      return new Response(null, { status: 201, headers: { etag } });
    }
    return file
      ? new Response(file.body, { headers: { "content-type": "text/turtle", etag: file.etag } })
      : new Response(null, { status: 404 });
  });
  const store = new MailStore(fetch, storage);
  const seed = (url: string, mailbox: MailboxDataset) =>
    files.set(documentOf(url), { body: serialiseToTurtle(mailbox), etag: `"v${++version}"` });
  return { files, calls, fetch, store, seed };
}
function seedMailbox(s: ReturnType<typeof server>) {
  const mb = new MailboxDataset(new Store(), DataFactory);
  const m = mb.createMessage(message);
  m.subjectLine = "Hi";
  m.partOfThread = thread;
  m.folderIris.add(inbox);
  const t = mb.createThread(thread);
  t.addMessage(message);
  const f = mb.createFolder(inbox);
  f.addMessage(message);
  f.title = "Inbox";
  const a = mb.createFolder(archived);
  a.title = "Archive";
  for (const iri of [message, thread, inbox, archived])
    s.seed(
      iri,
      new MailboxDataset(new Store([...mb].filter((q) => q.subject.value === iri)), DataFactory),
    );
}
describe("injected pod I/O", () => {
  it("loads, parses, saves repeatedly with refreshed ETags and creates with If-None-Match", async () => {
    const s = server();
    seedMailbox(s);
    const loaded = await s.store.load(documentOf(message));
    expect(loaded.etag).toMatch(/^"v/);
    expect(loaded.exists).toBe(true);
    loaded.mailbox.message(message).subjectLine = "Updated";
    await s.store.save(loaded);
    await s.store.save(loaded);
    expect((await s.store.load(documentOf(message))).mailbox.message(message).subjectLine).toBe(
      "Updated",
    );
    const created = await s.store.load(`${root}new.ttl`, true);
    expect(created.exists).toBe(false);
    expect(created.etag).toBeNull();
    await s.store.save(created);
    expect(created.exists).toBe(true);
    const stale = await s.store.load(documentOf(message));
    await s.store.save(loaded);
    await expect(s.store.save(stale)).rejects.toMatchObject({ code: "conflict", status: 412 });
    await expect(s.store.load(`${root}missing.ttl`)).rejects.toMatchObject({ code: "not-found" });
    await expect(
      s.store.write(`${root}new.ttl`, "", "text/plain", null, false),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it.each([401, 403, 404, 412, 500])("maps HTTP %s on reads and writes", async (status) => {
    const store = new MailStore(
      vi.fn(async () => new Response(null, { status })),
      storage,
    );
    await expect(store.load(`${root}a`)).rejects.toBeInstanceOf(MailError);
    await expect(store.write(`${root}a`, "x", "text/plain", null, false)).rejects.toMatchObject({
      status,
    });
    if (status === 404) expect((await store.load(`${root}a`, true)).exists).toBe(false);
    else await expect(store.load(`${root}a`, true)).rejects.toBeInstanceOf(MailError);
  });
  it("refuses missing/weak/wildcard validators and preserves network errors", async () => {
    const fetch = vi.fn(
      async () => new Response("", { headers: { "content-type": "text/turtle" } }),
    );
    const store = new MailStore(fetch, storage);
    const loaded = await store.load(`${root}a`);
    expect(loaded.etag).toBeNull();
    for (const etag of [null, "", 'W/"weak"', "*"])
      await expect(store.write(`${root}a`, "", "text/plain", etag, true)).rejects.toMatchObject({
        code: "no-validator",
      });
    expect(fetch).toHaveBeenCalledTimes(1);
    const rawError = new Error("offline");
    const offline = new MailStore(
      vi.fn(async () => {
        throw rawError;
      }),
      storage,
    );
    await expect(offline.load(`${root}a`)).rejects.toThrow();
    const missing = await store.write(`${root}a`, "", "text/plain", null, false);
    expect(missing).toBeNull();
  });
  it("validates all destinations and refuses foreign redirects before credentials move", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    const store = new MailStore(fetch, storage);
    await expect(store.load("https://evil.example/")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      store.write("https://pod.example/alice-other/a", "x", "text/plain", null, false),
    ).rejects.toThrow();
    await expect(store.load(`${root}a`)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(store.register(`${storage}index.ttl`, "https://evil.example/")).rejects.toThrow();
  });
  it.each([
    { "@context": "https://evil.example/context" },
    { "@context": "/other-pod/context" },
    { "@context": [null, { name: "http://schema.org/name" }, `${root}context`] },
    {
      "@graph": [
        { "@context": { term: { "@id": "http://schema.org/name", "@context": "./context" } } },
      ],
    },
    { "@context": { "@import": "https://evil.example/context" } },
  ])("rejects remote JSON-LD contexts before any loader request: %j", async (body) => {
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected global request"));
    try {
      const fetch = vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            headers: { "content-type": "application/ld+json; charset=utf-8" },
          }),
      );
      const store = new MailStore(fetch, storage);
      await expect(store.load(`${root}message`)).rejects.toThrow("Remote JSON-LD contexts");
      await expect(store.list(`${root}folders/`)).rejects.toThrow("Remote JSON-LD contexts");
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      globalFetch.mockRestore();
    }
  });
  it("accepts inline JSON-LD for messages and containers without losing ETags", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            "@context": [null, { schema: "http://schema.org/", ldp: "http://www.w3.org/ns/ldp#" }],
            "@graph": [
              { "@id": message, "@type": "schema:EmailMessage", "schema:headline": "Inline" },
              {
                "@id": `${root}folders/`,
                "@type": "ldp:Container",
                "ldp:contains": { "@id": documentOf(inbox) },
              },
            ],
          }),
          { headers: { "content-type": "application/ld+json", etag: '"jsonld"' } },
        ),
    );
    const store = new MailStore(fetch, storage);
    const loaded = await store.load(documentOf(message));
    expect(loaded.mailbox.message(message).subjectLine).toBe("Inline");
    expect(loaded.etag).toBe('"jsonld"');
    expect(await store.list(`${root}folders/`)).toEqual([documentOf(inbox)]);
  });
  it.each([
    {
      context:
        '"@context":"https://evil.example/context","@context":{"schema":"http://schema.org/","ldp":"http://www.w3.org/ns/ldp#"}',
      messageContext: "",
    },
    {
      context: '"@context":{"schema":"http://schema.org/","ldp":"http://www.w3.org/ns/ldp#"}',
      messageContext: '"@context":"https://evil.example/context","@context":{},',
    },
  ])("parses only the validated representation of duplicate JSON keys: %j", async ({
    context,
    messageContext,
  }) => {
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unscoped request"));
    const url = `${root}final.jsonld`;
    const fetch = vi.fn(async () => {
      const response = new Response(
        `{${context},"@graph":[{${messageContext}"@id":"#it","@type":"schema:EmailMessage","schema:headline":"Canonical"},{"@id":"${root}folders/","@type":"ldp:Container","ldp:contains":{"@id":"${documentOf(inbox)}"}}]}`,
        {
          headers: {
            "content-type": "application/ld+json",
            etag: '"canonical"',
            "content-length": "9999",
          },
        },
      );
      Object.defineProperty(response, "url", { value: url });
      return response;
    });
    try {
      const store = new MailStore(fetch, storage);
      const loaded = await store.load(`${root}original`);
      expect(loaded.url).toBe(url);
      expect(loaded.etag).toBe('"canonical"');
      expect(loaded.mailbox.message(`${url}#it`).subjectLine).toBe("Canonical");
      expect(await store.list(`${root}folders/`)).toEqual([documentOf(inbox)]);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      globalFetch.mockRestore();
    }
  });
  it.each([
    ["application/trig", `<${root}graph> { <${message}> <http://schema.org/headline> "Graph". }`],
    ["application/n-quads", `<${message}> <http://schema.org/headline> "Graph" <${root}graph> .`],
    [
      "application/ld+json",
      JSON.stringify({
        "@id": `${root}graph`,
        "@graph": [{ "@id": message, "http://schema.org/headline": "Graph" }],
      }),
    ],
  ])("rejects named graphs loaded as %s before a Turtle PUT", async (contentType, body) => {
    const fetch = vi.fn(
      async () =>
        new Response(body, {
          headers: { "content-type": contentType, etag: '"graph"' },
        }),
    );
    const store = new MailStore(fetch, storage);
    const loaded = await store.load(documentOf(message));
    expect(loaded.mailbox.size).toBeGreaterThan(0);
    expect([...loaded.mailbox].every((q) => q.graph.termType === "NamedNode")).toBe(true);
    await expect(store.save(loaded)).rejects.toThrow("Named graphs");
    expect(loaded.etag).toBe('"graph"');
    expect(loaded.exists).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("enumerates typed containers and combines documents without duplicating them", async () => {
    const s = server();
    seedMailbox(s);
    s.files.set(`${root}folders/`, {
      body: `@prefix ldp: <http://www.w3.org/ns/ldp#>. <> a ldp:Container; ldp:contains <${documentOf(inbox)}>, <${documentOf(archived)}>.`,
      etag: '"list"',
    });
    expect(await s.store.list(`${root}folders/`)).toEqual([
      documentOf(inbox),
      documentOf(archived),
    ]);
    const counts = await loadFolders(s.store, root);
    expect(counts.map((x) => [x.total, x.unread])).toEqual([
      [1, 1],
      [0, 0],
    ]);
    expect((await loadThreads(s.store, inbox)).items[0]!.thread.value).toBe(thread);
    expect((await loadThread(s.store, thread)).map((m) => m.value)).toEqual([message]);
    s.files.set(`${root}empty/`, { body: "", etag: '"empty"' });
    expect(await s.store.list(`${root}empty/`)).toEqual([]);
    const snapshot = await s.store.snapshot([documentOf(message), documentOf(message)]);
    expect([...snapshot.messages]).toHaveLength(1);
  });
  it("loads complete candidate conversations before sorting and paging a folder", async () => {
    const s = server();
    const complete = new MailboxDataset(new Store(), DataFactory);
    const folder = complete.createFolder(inbox);
    const sent = complete.createFolder(`${systemFolderDocument(root, "sent")}#it`);
    for (const [id, date, conversation, collection] of [
      ["old-inbox", "2026-01-01", "reply-thread", folder],
      ["new-sent", "2026-01-03", "reply-thread", sent],
      ["middle-inbox", "2026-01-02", "other-thread", folder],
    ] as const) {
      const m = complete.createMessage(`${mailDocument(root, "messages", id)}#it`);
      const t = complete.createThread(`${mailDocument(root, "threads", conversation)}#it`);
      m.dateSent = new Date(date);
      m.partOfThread = t.value;
      m.folderIris.add(collection.value);
      collection.addMessage(m.value);
      t.addMessage(m.value);
    }
    // Persist every subject separately, so the folder cannot provide Sent message metadata.
    for (const subject of [...complete.messages, ...complete.threads, ...complete.folders]) {
      s.seed(
        subject.value,
        new MailboxDataset(
          new Store([...complete].filter((q) => q.subject.value === subject.value)),
          DataFactory,
        ),
      );
    }
    const values = (page: ReturnType<typeof pageThreads>) => ({
      ...page,
      items: page.items.map((row) => ({
        thread: row.thread.value,
        messages: row.messages.map((m) => ({ iri: m.value, sent: m.dateSent })),
      })),
    });
    for (const offset of [0, 1, 2]) {
      const actual = await loadThreads(s.store, inbox, offset, 1);
      const expected = pageThreads(complete, inbox, offset, 1);
      expect(values(actual)).toEqual(values(expected));
    }
    const page = await loadThreads(s.store, inbox, 0, 1);
    expect(page.items[0]!.messages.map((m) => m.value)).toEqual([
      `${mailDocument(root, "messages", "old-inbox")}#it`,
      `${mailDocument(root, "messages", "new-sent")}#it`,
    ]);
    expect(page.next).toBe(1);
    expect(page.total).toBe(2);
  });
  it("keeps imported custom labels separate from system folders during archive and star mutations", async () => {
    const s = server();
    const labels = ["Inbox", "inbox", "Archive", "archive", "Starred", "starred", "system:inbox"];
    const imported = [];
    for (const [index, label] of labels.entries()) {
      const item = await parseEmail(
        new TextEncoder().encode(`Message-ID: <label-${index}>\nX-Gmail-Labels: ${label}\n\nHello`),
        storage,
        "personal",
        "fallback",
      );
      imported.push(item);
      await persistImportedMail(s.store, item);
    }
    expect(new Set(imported.map((item) => item.folders[0]!.iri)).size).toBe(labels.length);
    const custom = imported[1]!;
    await archive(s.store, root, custom.message);
    await setStarred(s.store, root, custom.message, true);
    await setStarred(s.store, root, custom.message, false);
    for (const [index, item] of imported.entries()) {
      const f = item.folders[0]!;
      const folder = (await s.store.load(documentOf(f.iri))).mailbox.folder(f.iri);
      expect(folder.title).toBe(labels[index]);
      expect(folder.has(item.message)).toBe(true);
      if (![1, 2].includes(index)) expect(folder.has(custom.message)).toBe(false);
    }
    const snapshot = await s.store.load(documentOf(custom.message));
    expect([...snapshot.mailbox.message(custom.message).folderIris]).toEqual([
      `${mailDocument(root, "folders", "inbox")}#it`,
      archived,
    ]);
    s.files.set(`${root}folders/`, {
      body: `@prefix ldp: <http://www.w3.org/ns/ldp#>. <> a ldp:Container; ldp:contains ${imported.map((item) => `<${documentOf(item.folders[0]!.iri)}>`).join(", ")}.`,
      etag: '"folders"',
    });
    expect((await loadFolders(s.store, root)).map((row) => row.folder.title)).toEqual(labels);
  });
  it("conditionally mutates read, label, star and archive while keeping unrelated RDF", async () => {
    const s = server();
    seedMailbox(s);
    await setRead(s.store, message, true, new Date("2026-10-24T00:00:00Z"));
    expect((await s.store.load(documentOf(message))).mailbox.message(message).isRead).toBe(true);
    await setRead(s.store, message, false, new Date(0));
    await setLabel(s.store, message, archived, true);
    await setLabel(s.store, message, archived, false);
    await setStarred(s.store, root, message, true);
    await setStarred(s.store, root, message, false);
    await archive(s.store, root, message);
    const m = (await s.store.load(documentOf(message))).mailbox.message(message);
    expect(m.subjectLine).toBe("Hi");
    expect(m.isRead).toBe(false);
    expect([...m.folderIris]).toEqual([archived]);
    expect((await s.store.load(documentOf(inbox))).mailbox.folder(inbox).has(message)).toBe(false);
    expect((await s.store.load(documentOf(archived))).mailbox.folder(archived).has(message)).toBe(
      true,
    );
    await expect(setRead(s.store, message, true, new Date("invalid"))).rejects.toThrow("date");
    s.files.set(`${root}empty.ttl`, { body: "", etag: '"empty"' });
    await expect(
      setRead(s.store, `${root}empty.ttl#none`, true, new Date(0)),
    ).rejects.toMatchObject({ code: "not-found" });
  });
  it("preserves an existing index and registers idempotently with its validator", async () => {
    const s = server();
    const indexUrl = `${storage}settings/private.ttl`;
    const index = new TypeIndexDataset(new Store(), DataFactory);
    index.register(indexUrl, "#other", "https://schema.org/Thing", { instance: `${storage}thing` });
    s.seed(indexUrl, new MailboxDataset(index, DataFactory));
    await s.store.register(indexUrl, root);
    await s.store.register(indexUrl, root);
    const result = new TypeIndexDataset((await s.store.load(indexUrl)).mailbox, DataFactory);
    expect(result.locate(Classes.EmailMessage)).toEqual([{ container: root }]);
    expect([...result.registrations]).toHaveLength(2);
  });
  it("persists raw bytes, binary attachments, message metadata, threads and collections", async () => {
    const s = server();
    const item = await parseEmail(
      new TextEncoder().encode(
        "Message-ID: <one>\nSubject: Hi\nContent-Type: multipart/mixed; boundary=x\n\n--x\nContent-Type: text/plain\n\nHello\n--x\nContent-Type: text/plain\nContent-Disposition: attachment; filename=a.txt\n\nAttached\n--x--\n",
      ),
      storage,
      "personal",
      "fallback",
    );
    await persistImportedMail(s.store, item);
    expect(s.files.get(documentOf(item.message))!.body).toContain("EmailMessage");
    expect(s.files.get(documentOf(item.thread))!.body).toContain("Conversation");
    expect(s.files.get(item.mailbox.message(item.message).encoding!)!.body).toBe(
      new TextDecoder().decode(item.raw),
    );
    expect(s.files.get(item.attachments[0]!.url)!.body).toContain("Attached");
    const secondAccount = await parseEmail(item.raw, storage, "work", "fallback");
    expect(secondAccount.attachments[0]!.url).not.toBe(item.attachments[0]!.url);
    await persistImportedMail(s.store, secondAccount);
    for (const imported of [item, secondAccount]) {
      const loaded = await s.store.load(documentOf(imported.message));
      expect([...loaded.mailbox.message(imported.message).attachments]).toEqual([
        imported.attachments[0]!.url,
      ]);
      expect(s.files.get(imported.attachments[0]!.url)!.body).toContain("Attached");
    }
    const follow = await parseEmail(
      new TextEncoder().encode("Message-ID: <two>\nIn-Reply-To: <one>\nSubject: Re: Hi\n\nReply"),
      storage,
      "personal",
      "fallback",
    );
    await persistImportedMail(s.store, follow);
    expect((await s.store.load(documentOf(item.thread))).mailbox.thread(item.thread).size).toBe(2);
    await expect(persistImportedMail(s.store, item)).rejects.toMatchObject({ code: "conflict" });
  });
  it("conditionally reconciles already persisted provisional threads when References arrives", async () => {
    const headers = [
      "Message-ID: <a>\nIn-Reply-To: <b>",
      "Message-ID: <early>\nIn-Reply-To: <a>",
      "Message-ID: <c>\nIn-Reply-To: <a>\nReferences: <root> <b> <a>",
      "Message-ID: <later>\nIn-Reply-To: <early>",
      "Message-ID: <b>",
      "Message-ID: <root>",
    ];
    async function* source() {
      for (const header of headers)
        yield new TextEncoder().encode(`From sender\n${header}\nSubject: Conversation\n\nBody\n`);
    }
    const s = server();
    const imported = [];
    for await (const item of importMbox(source(), storage, "personal", () => "fallback")) {
      imported.push(item);
      await persistImportedMail(s.store, item);
    }
    const canonical = `${mailDocument(root, "threads", "<root>")}#it`;
    const provisional = `${mailDocument(root, "threads", "<b>")}#it`;
    const members = (await s.store.load(documentOf(canonical))).mailbox.thread(canonical);
    expect([...members.messageIris].sort()).toEqual(imported.map((item) => item.message).sort());
    for (const item of imported) {
      const loaded = await s.store.load(documentOf(item.message));
      expect(loaded.mailbox.message(item.message).partOfThread).toBe(canonical);
      expect(loaded.mailbox.message(item.message).body).toContain("Body");
    }
    expect((await s.store.load(documentOf(provisional))).mailbox.thread(provisional).size).toBe(0);
    expect((await loadThreads(s.store, inbox)).total).toBe(1);

    // A consumer may persist only selected yielded items; absent provisional docs stay absent.
    const selected = server();
    await persistImportedMail(selected.store, imported[2]!);
    expect(selected.files.has(documentOf(provisional))).toBe(false);
    expect((await selected.store.load(documentOf(canonical))).mailbox.thread(canonical).size).toBe(
      1,
    );
  });
  it("reconciles persisted replies when their missing parent arrives with References", async () => {
    async function* source() {
      for (const headers of [
        "Message-ID: <c>\nIn-Reply-To: <b>",
        "Message-ID: <b>\nReferences: <root>",
        "Message-ID: <later>\nIn-Reply-To: <c>",
        "Message-ID: <root>",
      ])
        yield new TextEncoder().encode(`From sender\n${headers}\nSubject: Conversation\n\nBody\n`);
    }
    const s = server();
    const imported = [];
    const provisional = `${mailDocument(root, "threads", "<b>")}#it`;
    const canonical = `${mailDocument(root, "threads", "<root>")}#it`;
    for await (const item of importMbox(source(), storage, "personal", () => "fallback")) {
      imported.push(item);
      await persistImportedMail(s.store, item);
      if (item.id === "<c>")
        expect((await s.store.load(documentOf(provisional))).mailbox.thread(provisional).size).toBe(
          1,
        );
      else {
        expect((await s.store.load(documentOf(provisional))).mailbox.thread(provisional).size).toBe(
          0,
        );
        expect(await loadThread(s.store, canonical)).toHaveLength(imported.length);
      }
    }
    const members = (await s.store.load(documentOf(canonical))).mailbox.thread(canonical);
    expect([...members.messageIris].sort()).toEqual(imported.map((item) => item.message).sort());
    for (const item of imported) {
      const loaded = await s.store.load(documentOf(item.message));
      expect(loaded.mailbox.message(item.message).partOfThread).toBe(canonical);
      expect(loaded.mailbox.message(item.message).body).toContain("Body");
    }
    expect((await loadThreads(s.store, inbox)).total).toBe(1);
  });
  it("persists nested labels and delimiter-bearing message identifiers and accounts", async () => {
    const s = server();
    const item = await parseEmail(
      new TextEncoder().encode(
        "Message-ID: <project/2026@example.org>\nX-Gmail-Labels: Projects/2026, Projects%2F2026, Projects~2F2026\n\nHello",
      ),
      storage,
      "team/work",
      "fallback",
    );
    await persistImportedMail(s.store, item);
    const loaded = await s.store.load(documentOf(item.message));
    expect(loaded.mailbox.message(item.message).identifier).toBe("<project/2026@example.org>");
    expect(new Set(item.folders.map((f) => f.iri)).size).toBe(3);
    for (const folder of item.folders) {
      const saved = (await s.store.load(documentOf(folder.iri))).mailbox.folder(folder.iri);
      expect(saved.title).toBe(folder.title);
      expect(saved.has(item.message)).toBe(true);
    }
  });
});

it("refuses write redirects and creates missing archive collections", async () => {
  const fetch = vi.fn(
    async () => new Response(null, { status: 303, headers: { location: `${root}other` } }),
  );
  const store = new MailStore(fetch, storage);
  await expect(store.write(`${root}item`, "x", "text/plain", null, false)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  const s = server();
  seedMailbox(s);
  s.files.delete(documentOf(archived));
  await archive(s.store, root, message);
  expect((await s.store.load(documentOf(archived))).mailbox.folder(archived).has(message)).toBe(
    true,
  );
});
it("reads messages without thread links and handles empty thread/folder documents", async () => {
  const s = server();
  seedMailbox(s);
  const loaded = await s.store.load(documentOf(message));
  loaded.mailbox.message(message).partOfThread = undefined;
  await s.store.save(loaded);
  expect((await loadThreads(s.store, inbox)).items).toEqual([]);
  const empty = new MailboxDataset(new Store(), DataFactory);
  s.seed(thread, empty);
  s.seed(inbox, empty);
  expect(await loadThread(s.store, thread)).toEqual([]);
  expect((await loadThreads(s.store, inbox)).items).toEqual([]);
});
