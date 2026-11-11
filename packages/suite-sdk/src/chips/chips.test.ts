// AUTHORED-BY Codex GPT-6.1-Sol
import { Editor, Mark, Node } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ChipRef,
  chipCandidates,
  chipIri,
  chipKind,
  chipKinds,
  chipQuery,
  chipText,
  createMentionNotifier,
  mentionKey,
  mentionNotification,
  resolveChip,
  textChips,
} from "./index.js";
import { createChipExtension } from "./tiptap.js";

const person: ChipRef = {
  iri: "https://bob.example/profile#me",
  kind: "person",
  label: "Bob Meadow",
};
const file: ChipRef = { iri: "https://pod.example/report.pdf", kind: "file", label: "Report" };
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("chip candidates", () => {
  it("merges people and SDK results, ranks prefixes, deduplicates IRIs and limits", async () => {
    const search = vi.fn(async () => ({
      source: "local" as const,
      results: [
        { url: person.iri, title: "Duplicate Bob", type: "person", parent: "" },
        { url: file.iri, title: "A Bob file", type: "file", parent: "" },
        { url: "https://pod.example/b", title: "Bob document", type: "doc", parent: "" },
        { url: "javascript:alert(1)", title: "Bob unsafe", parent: "" },
        { url: "https://pod.example/no", title: "Other", parent: "" },
      ],
    }));
    expect(await chipCandidates(" bob ", { search, contacts: [person], limit: 2 })).toEqual([
      { iri: "https://pod.example/b", kind: "doc", label: "Bob document" },
      person,
    ]);
    expect(search).toHaveBeenCalledWith({ text: "bob", limit: 50 }, { signal: undefined });
    expect(await chipCandidates("", { search, contacts: [] })).toHaveLength(4);
  });
  it("retains known WebIDs, deterministic ties and a larger limit", async () => {
    const search = vi.fn(async () => ({ source: "server" as const, results: [] }));
    const refs = [
      { ...person, label: "Same" },
      { ...file, label: "Same" },
    ];
    expect(
      (await chipCandidates("", { search, contacts: refs, limit: 60 })).map((ref) => ref.iri),
    ).toEqual(refs.map((ref) => ref.iri).sort());
    expect(await chipCandidates("bob.example", { search, contacts: refs })).toEqual([refs[0]]);
  });
  it.each([0, -1, 1.5, 1001])("refuses invalid limit %s", async (limit) => {
    await expect(chipCandidates("", { search: vi.fn(), contacts: [], limit })).rejects.toThrow(
      RangeError,
    );
  });
  it("propagates search errors and fences late results after abort", async () => {
    await expect(
      chipCandidates("", {
        search: async () => {
          throw new Error("denied");
        },
        contacts: [],
      }),
    ).rejects.toThrow("denied");
    const abort = new AbortController();
    abort.abort();
    await expect(
      chipCandidates("", {
        search: async () => ({ source: "local", results: [] }),
        contacts: [],
        signal: abort.signal,
      }),
    ).rejects.toThrow();
  });
  it("classifies interoperable RDF types and refuses unsafe IRIs", () => {
    for (const kind of chipKinds) expect(chipKind(kind)).toBe(kind);
    for (const [type, kind] of [
      ["Individual", "person"],
      ["Agent", "person"],
      ["DigitalDocument", "doc"],
      ["Document", "doc"],
      ["Spreadsheet", "sheet"],
      ["TextDigitalDocument", "note"],
      ["Vevent", "event"],
      ["Todo", "task"],
      ["Issue", "task"],
      ["Location", "place"],
    ])
      expect(chipKind(`https://schema.example/${type}`)).toBe(kind);
    expect(chipKind()).toBe("file");
    expect(chipKind("unknown")).toBe("file");
    for (const iri of [
      "javascript:alert(1)",
      "relative",
      "https://user:secret@example.org/",
      "https://pod.example/a b",
    ])
      expect(chipIri(iri)).toBe(false);
    expect(chipIri(person.iri)).toBe(true);
  });
});

describe("text chips and mention drafts", () => {
  it("round trips labels and reserved URL punctuation with exact offsets", () => {
    const ref = { ...file, label: "A [report] 50%\nnext", iri: "https://pod.example/(file)" };
    const text = chipText(ref);
    expect(textChips(`See ${text} now`)).toEqual([
      { ref: { ...ref, iri: "https://pod.example/%28file%29" }, from: 4, to: 4 + text.length },
    ]);
    expect(() => chipText({ ...file, iri: "data:bad" })).toThrow();
    expect(
      textChips(
        '@[Bad%zz](https://pod.example/a "chip:file") @[X](https://u:p@pod.example/ "chip:person") @[Y](https://pod.example/y "chip:alien")',
      ),
    ).toEqual([]);
  });
  it("finds @ queries at the caret and excludes emails, explicit chips and fenced code", () => {
    expect(chipQuery("Hello @Bo tail", 9)).toEqual({ query: "Bo", from: 6, to: 9 });
    expect(chipQuery("@", 1)).toEqual({ query: "", from: 0, to: 1 });
    for (const text of ["mail@bob", "@[Bob]", "```\n@Bob", "no mention", `@${"a".repeat(81)}`])
      expect(chipQuery(text, text.length)).toBeNull();
    expect(chipQuery("```x``` @Bob", 12)?.query).toBe("Bob");
  });
  it("builds the existing Create mention shape, with bounded excerpt and stable receipt keys", () => {
    expect(mentionNotification(file.iri, person.iri, "hello")).toEqual({
      type: "Create",
      object: file.iri,
      target: file.iri,
      summary: "Mentioned you: hello",
    });
    expect(mentionNotification(file.iri, person.iri, "x".repeat(500)).summary?.length).toBe(295);
    expect(() => mentionNotification("bad", person.iri, "")).toThrow();
    expect(() => mentionNotification(file.iri, "bad", "")).toThrow();
    expect(mentionKey(file.iri, person.iri)).not.toBe(mentionKey(person.iri, file.iri));
  });
  it("claims before sending, ignores self/nonpeople and persists across saves and instances", async () => {
    const notify = vi.fn(async () => ({ delivered: true, inbox: "https://bob.example/inbox/" }));
    const options = { actor: "https://alice.example/#me", notify, receipts: localStorage };
    const send = createMentionNotifier(options);
    await Promise.all([
      send(file.iri, [person, person, file, { ...person, iri: options.actor }], "Hi"),
      send(file.iri, [person], "Again"),
    ]);
    await createMentionNotifier(options)(file.iri, [person], "Reopened");
    expect(notify).toHaveBeenCalledTimes(1);
    await send("https://pod.example/other", [person], "Elsewhere");
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it("never retries an ambiguous failure and refuses to send without durable receipts", async () => {
    const notify = vi.fn(async () => {
      throw new Error("network");
    });
    const send = createMentionNotifier({ actor: file.iri, notify, receipts: localStorage });
    await expect(send(file.iri, [person], "Hi")).rejects.toThrow("network");
    await send(file.iri, [person], "Retry");
    expect(notify).toHaveBeenCalledTimes(1);
    const unavailable = createMentionNotifier({
      actor: file.iri,
      notify,
      receipts: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      },
    });
    await expect(unavailable(file.iri, [person], "Hi")).rejects.toThrow("quota");
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("live resolution", () => {
  const ttl = (body: string) => new Response(body, { headers: { "content-type": "text/turtle" } });
  it("reads metadata through accessors, coalesces requests, expires and isolates session transports", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetch = vi.fn(async () =>
      ttl(
        `<${file.iri}> <http://purl.org/dc/terms/title> "Live report"; a <https://schema.org/DigitalDocument>; <http://purl.org/dc/terms/creator> <${person.iri}>.`,
      ),
    );
    const options = { fetch, label: "Stored" };
    const [a, b] = await Promise.all([
      resolveChip(file.iri, options),
      resolveChip(file.iri, options),
    ]);
    expect(a).toEqual({
      iri: file.iri,
      label: "Live report",
      kind: "doc",
      icon: "doc",
      readable: true,
      owner: person.iri,
    });
    expect(b).toEqual(a);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(30_001);
    await resolveChip(file.iri, options);
    expect(fetch).toHaveBeenCalledTimes(2);
    const other = vi.fn(async () => ttl(""));
    expect(
      await resolveChip(file.iri, { fetch: other, label: "Stored", kind: "file" }),
    ).toMatchObject({ label: "Stored", kind: "file", icon: "file" });
  });
  it("uses independent fallback predicates, default label/kind and safe owner IRIs", async () => {
    const fetch = vi.fn(async () =>
      ttl(
        `<${person.iri}> <http://purl.org/dc/terms/title> <https://bad.example/>; <https://schema.org/name> "Bob"; <http://purl.org/dc/terms/creator> "bad"; <https://schema.org/creator> <javascript:bad>; a "invalid".`,
      ),
    );
    expect(await resolveChip(person.iri, { fetch })).toMatchObject({
      label: "Bob",
      kind: "link",
      readable: true,
      owner: undefined,
    });
    expect(await resolveChip(file.iri, { fetch: async () => ttl("") })).toMatchObject({
      label: file.iri,
      kind: "link",
    });
    await expect(resolveChip("javascript:bad", { fetch })).rejects.toThrow();
  });
  it("preserves each stored label on unreadable resources, and handles readable binary files", async () => {
    const fetch = vi.fn(async () => new Response("Denied", { status: 403 }));
    expect(await resolveChip(file.iri, { fetch, label: "Secret", kind: "file" })).toMatchObject({
      label: "Secret",
      readable: false,
      icon: "lock",
    });
    expect(await resolveChip(file.iri, { fetch, label: "Other" })).toMatchObject({
      label: "Other",
      icon: "lock",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      await resolveChip(file.iri, {
        fetch: async () => new Response("pdf", { headers: { "content-type": "application/pdf" } }),
        label: "Report",
        kind: "file",
      }),
    ).toMatchObject({ label: "Report", kind: "file", readable: true });
    expect(
      await resolveChip(file.iri, {
        fetch: async () => {
          throw new Error("offline");
        },
      }),
    ).toMatchObject({ readable: false });
  });
  it("bounds the metadata cache", async () => {
    const fetch = vi.fn(async () => ttl(""));
    for (let i = 0; i < 257; i++) await resolveChip(`https://pod.example/${i}`, { fetch });
    await resolveChip("https://pod.example/0", { fetch });
    expect(fetch).toHaveBeenCalledTimes(258);
  });
});

describe("framework-neutral chip extension", () => {
  function editor(content: string | object) {
    return new Editor({
      extensions: [
        Node.create({ name: "doc", topNode: true, content: "paragraph+" }),
        Node.create({
          name: "paragraph",
          group: "block",
          content: "inline*",
          parseHTML: () => [{ tag: "p" }],
          renderHTML: () => ["p", 0],
        }),
        Node.create({ name: "text", group: "inline" }),
        Mark.create({
          name: "link",
          addAttributes: () => ({ href: { default: null } }),
          parseHTML: () => [{ tag: "a[href]" }],
          renderHTML: ({ HTMLAttributes }) => ["a", HTMLAttributes, 0],
        }),
        createChipExtension(),
      ],
      content,
    });
  }
  it("serializes ordinary anchors and round trips atom attributes and plain text", () => {
    const first = editor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "chip", attrs: person }] }],
    });
    expect(first.getHTML()).toContain('href="https://bob.example/profile#me"');
    expect(first.getHTML()).toContain("data-chip");
    expect(first.getText()).toBe(person.label);
    const second = editor(first.getHTML());
    expect(second.getJSON()).toEqual(first.getJSON());
    first.destroy();
    second.destroy();
  });
  it("uses anchor text when label metadata is absent and refuses unsafe/unknown chips", () => {
    const valid = editor(
      `<p><a href="${person.iri}" data-chip data-chip-kind="person">Bob</a></p>`,
    );
    expect(valid.getJSON().content?.[0]?.content?.[0]?.attrs?.label).toBe("Bob");
    for (const attrs of [
      'href="javascript:bad" data-chip-kind="person"',
      'href="https://pod.example/x" data-chip-kind="alien"',
      'data-chip-kind="person"',
    ]) {
      const bad = editor(`<p><a data-chip ${attrs}>Fallback</a></p>`);
      expect(bad.getText()).toBe("Fallback");
      expect(bad.getHTML()).not.toContain("data-chip");
      bad.destroy();
    }
    const unsafe = editor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "chip", attrs: { ...person, iri: "bad" } }] },
      ],
    });
    expect(unsafe.getHTML()).toContain("<span>Bob Meadow</span>");
    valid.destroy();
    unsafe.destroy();
  });
});
