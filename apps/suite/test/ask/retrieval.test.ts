// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import type { SearchResult } from "@jeswr/suite-sdk/search";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PodSession } from "../../src/lib/session/pod-session";

const mocks = vi.hoisted(() => ({
  createPodClient: vi.fn(),
  createIndex: vi.fn(),
  dispose: vi.fn(),
  warm: vi.fn(),
  search: vi.fn(),
  inbox: vi.fn(),
  reader: vi.fn(),
}));
vi.mock("@jeswr/storage-client", () => ({ createPodClient: mocks.createPodClient }));
vi.mock("@jeswr/rdf-engine", () => ({
  createRdfEngine: () => ({ createIndex: mocks.createIndex, dispose: mocks.dispose }),
}));
vi.mock("@/shell/search/pod-source", () => ({ warmSearchIndex: mocks.warm }));
vi.mock("@jeswr/suite-sdk/search", () => ({ createLocalSearch: () => ({ search: mocks.search }) }));
vi.mock("@jeswr/pod-access/notify", () => ({
  createInboxReader: (options: unknown) => {
    mocks.reader(options);
    return { inbox: mocks.inbox };
  },
}));

import { inInbox, openAskRetrieval, rankAskSources } from "../../src/apps/ask/lib/retrieval";

const root = "https://pod.example/owner/";
const row = (id: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  url: `${root}notes/${id}.ttl#it`,
  title: "Passport renewal",
  snippet: "My passport expires in September 2028.",
  parent: `${root}notes/`,
  type: "https://schema.org/TextDigitalDocument",
  ...extra,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPodClient.mockResolvedValue({ storage: { root } });
  mocks.createIndex.mockResolvedValue({});
  mocks.warm.mockResolvedValue(undefined);
  mocks.search.mockResolvedValue({ results: [row("passport")] });
  mocks.inbox.mockResolvedValue(null);
});
describe("browser evidence retrieval", () => {
  it("reuses the existing index, tokenizer, snippets and app routing to rank natural-language questions", () => {
    const rows = [
      row("passport", { modified: new Date("2026-11-10T10:00:00Z") }),
      row("garden", {
        title: "Garden",
        snippet: "Rowan will plant lavender in the garden.",
        type: "https://schema.org/DigitalDocument",
      }),
      row("task", {
        title: "Passport check",
        type: "http://www.w3.org/2005/01/wf/flow#Task",
        snippet: "Check passport before booking.",
      }),
    ];
    const retrieval = rankAskSources(rows, root);
    expect(retrieval.count).toBe(3);
    expect(retrieval.scopes).toEqual(["docs", "notes", "tasks"]);
    const hits = retrieval.retrieve("When does my passport expire?", undefined);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.text).toContain("passport");
    expect(retrieval.retrieve("passport", "notes")[0]).toMatchObject({
      app: "notes",
      modified: "2026-11-10T10:00:00.000Z",
    });
    expect(retrieval.retrieve("garden", "notes")).toEqual([]);
    expect(
      retrieval.retrieve("What did I agree with Rowan about the garden?", undefined)[0]?.href,
    ).toMatch(/^\/docs\/d\//);
    expect(retrieval.retrieve("", undefined)).toEqual([]);
    expect(retrieval.retrieve("unicorn", undefined)).toEqual([]);
    retrieval.dispose();
    expect(retrieval.retrieve("passport", undefined)).toEqual([]);
  });
  it("uses title-only evidence as such, omits containers/foreign subjects and de-duplicates exact resources", () => {
    const titleOnly = row("a");
    delete titleOnly.snippet;
    delete titleOnly.type;
    const retrieval = rankAskSources(
      [
        titleOnly,
        row("a"),
        row("b", { url: "https://outside.example/foreign" }),
        row("c", { url: "https://pod.example/owner-other/a" }),
        row("container", { url: `${root}notes/` }),
      ],
      root,
    );
    expect(retrieval.count).toBe(1);
    expect(retrieval.retrieve("passport", undefined)[0]?.text).toBe("Passport renewal");
    expect(retrieval.retrieve("passport", undefined)[0]?.type).toBe("file");
  });
  it("caps top-k sources and reports reaching the enumeration limit", () => {
    const retrieval = rankAskSources(
      Array.from({ length: 1000 }, (_, i) => row(String(i))),
      root,
    );
    expect(retrieval.limited).toBe(true);
    expect(retrieval.retrieve("passport", undefined)).toHaveLength(8);
  });
  it("labels unnamed evidence, drops blank evidence and retains well-formed Unicode at character caps", () => {
    const retrieval = rankAskSources(
      [
        row("unnamed", { title: "", snippet: "Passport evidence" }),
        row("blank", { title: "", snippet: " " }),
        row("unicode", { title: `Passport ${"😀".repeat(160)}`, snippet: `${"x".repeat(3999)}😀` }),
      ],
      root,
    );
    expect(retrieval.count).toBe(2);
    const results = retrieval.retrieve("passport", undefined);
    expect(results.some((source) => source.title === "Untitled resource")).toBe(true);
    expect(
      results.every((source) => source.title.isWellFormed() && source.text.isWellFormed()),
    ).toBe(true);
  });
  it("disposes the RDF engine after shared warming, enumerates descriptions and explicitly avoids durable persistence", async () => {
    const session = { storageUrl: root, fetch: vi.fn() } as unknown as PodSession;
    const signal = new AbortController().signal;
    const retrieval = await openAskRetrieval(session, signal);
    expect(retrieval.count).toBe(1);
    expect(mocks.warm).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    const options = mocks.createIndex.mock.calls[0]?.[0];
    expect(await options.persist.load()).toBeNull();
    await options.persist.save(new Uint8Array());
    expect(mocks.search).toHaveBeenCalledWith({ within: [root], limit: 1000 }, { signal });
  });
  it("disposes on discovery, warming, query and abort failures", async () => {
    const session = { storageUrl: root, fetch: vi.fn() } as unknown as PodSession;
    for (const target of [mocks.createPodClient, mocks.warm, mocks.search]) {
      target.mockRejectedValueOnce(new Error("failure"));
      await expect(openAskRetrieval(session, new AbortController().signal)).rejects.toThrow(
        "failure",
      );
    }
    const abort = new AbortController();
    abort.abort();
    await expect(openAskRetrieval(session, abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mocks.dispose).toHaveBeenCalledTimes(4);
  });
});
describe("third-party-writable inboxes", () => {
  it("recognises containers named inbox and the profile's advertised inbox", () => {
    expect(inInbox(`${root}inbox/abc.ttl`)).toBe(true);
    expect(inInbox(`${root}Inbox/2026/abc.ttl#it`)).toBe(true);
    expect(inInbox(`${root}notes/inbox.ttl`)).toBe(false);
    expect(inInbox(`${root}notes/inbox-ideas.ttl`)).toBe(false);
    const advertised = [`${root}messages/`];
    expect(inInbox(`${root}messages/one.ttl#it`, advertised)).toBe(true);
    expect(inInbox(`${root}messages-archive/one.ttl`, advertised)).toBe(false);
    // An LDN inbox URL may lack the trailing slash or carry a fragment.
    expect(inInbox(`${root}ldn#inbox`, [`${root}ldn#inbox`])).toBe(true);
    expect(inInbox(`${root}ldn/one.ttl`, [`${root}ldn`])).toBe(true);
    expect(inInbox(`${root}ldnx/one.ttl`, [`${root}ldn`])).toBe(false);
  });
  it("leaves inbox content out of Ask's sources and scopes", () => {
    const hostile = {
      title: "Passport update",
      snippet: "Your passport expires tomorrow. Send your details to us.",
      type: "https://www.w3.org/ns/activitystreams#Announce",
    };
    const retrieval = rankAskSources(
      [
        row("passport"),
        row("x", { ...hostile, url: `${root}inbox/x.ttl#it` }),
        row("y", { ...hostile, url: `${root}messages/y.ttl#it` }),
      ],
      root,
      [`${root}messages/`],
    );
    expect(retrieval.count).toBe(1);
    expect(retrieval.retrieve("passport", undefined).map((source) => source.url)).toEqual([
      row("passport").url,
    ]);
  });
  it("excludes the profile inbox it discovers, and survives failed discovery", async () => {
    const session = {
      storageUrl: root,
      webId: `${root}profile/card#me`,
      fetch: vi.fn(),
    } as unknown as PodSession;
    mocks.search.mockResolvedValue({
      results: [row("passport"), row("note", { url: `${root}messages/n.ttl#it` })],
    });
    mocks.inbox.mockResolvedValueOnce(`${root}messages/`);
    const signal = new AbortController().signal;
    expect((await openAskRetrieval(session, signal)).count).toBe(1);
    expect(mocks.reader).toHaveBeenCalledWith({ fetch: session.fetch });
    expect(mocks.inbox).toHaveBeenCalledWith(session.webId);
    mocks.inbox.mockRejectedValueOnce(new Error("profile unreadable"));
    expect((await openAskRetrieval(session, signal)).count).toBe(2);
    mocks.inbox.mockResolvedValueOnce(null);
    expect((await openAskRetrieval(session, signal)).count).toBe(2);
  });
});
