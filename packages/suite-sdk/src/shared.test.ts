// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { shareNotification } from "@jeswr/pod-access/notify";
import { describe, expect, it } from "vitest";
import {
  classifySharedItem,
  hideSharedItem,
  isHiddenSharedItem,
  isSharedItemUrl,
  isSharedUrlEntry,
  isShareNotification,
  isSuiteDocsDocument,
  latestSharedEntries,
  mergeSharedItems,
  parseSharedEntries,
  removeSharedItem,
  SHARED_CLOCK_SKEW_MS,
  type SharedItem,
  sharedAccountKey,
  sharedHiddenAt,
  sharedItemName,
  sharedItemsForAccount,
  sharedItemsFromInbox,
  shareNotificationUrls,
  visibleSharedItems,
} from "./shared.js";

const url = "https://bob.example/docs/plan.ttl";
const item = (fields: Partial<SharedItem> = {}): SharedItem => ({
  url,
  name: "plan.ttl",
  app: "drive",
  kind: "file",
  source: "opened",
  ...fields,
});

describe("classification", () => {
  it("uses the canonical resolver and rejects spoofed namespaces", () => {
    expect(
      classifySharedItem({ url, rdfTypes: ["https://schema.org/SpreadsheetDigitalDocument"] }),
    ).toEqual({ app: "sheets", kind: "spreadsheet" });
    expect(
      classifySharedItem({
        url: "https://pod.example/item",
        rdfTypes: ["https://evil.example/Task"],
      }),
    ).toEqual({ app: "drive", kind: "file" });
    expect(
      classifySharedItem({
        url: "https://pod.example/item",
        rdfTypes: ["http://xmlns.com/foaf/0.1/Person"],
      }).app,
    ).toBe("drive");
    expect(classifySharedItem({ url: "javascript:alert(1)" }).app).toBe("drive");
  });
  it("extracts names without trusting protocols or malformed escapes", () => {
    expect(sharedItemName("https://example/a%20b.ttl")).toBe("a b.ttl");
    expect(sharedItemName("https://example/")).toBe("example");
    expect(sharedItemName("broken")).toBe("broken");
    expect(sharedItemName("https://example/%FF")).toBe("https://example/%FF");
    for (const value of ["https://example/x", "http://example/x"])
      expect(isSharedItemUrl(value)).toBe(true);
    for (const value of [
      "broken",
      "data:text/plain,x",
      "https://u:p@example/x",
      "https://u@example/x",
    ])
      expect(isSharedItemUrl(value)).toBe(false);
  });
  it("preserves Drive's native Docs scope including legacy storage and separator guards", () => {
    expect(isSuiteDocsDocument(url, "https://bob.example/")).toBe(true);
    expect(
      isSuiteDocsDocument("https://bob.example/pod-docs/plan.ttl", "https://bob.example/"),
    ).toBe(true);
    for (const target of [
      "broken",
      "https://bob.example/docs/plan.md",
      "https://bob.example/docs/sub/a.ttl",
      "https://other.example/docs/plan.ttl",
      "https://bob.example/docs/a%2fb.ttl",
      "https://bob.example/docs/a%5Cb.ttl",
      "https://bob.example/docs/a.ttl?x=a.ttl",
      "https://bob.example/docs/a.ttl#b.ttl",
      "https://bob.example/docs-evil/a.ttl",
    ])
      expect(isSuiteDocsDocument(target, "https://bob.example/")).toBe(false);
    expect(isSuiteDocsDocument(url, "bad")).toBe(false);
  });
});

it("projects only share announcements, tolerating missing metadata and untrusted URLs", () => {
  const base = {
    url: "https://alice.example/inbox/1",
    type: "Announce",
    summary: "Shared with you as Editor",
    object: url,
  };
  expect(
    sharedItemsFromInbox([{ ...base, actor: "Bob", published: "2026-01-02T00:00:00Z" }]),
  ).toEqual([
    {
      url,
      name: "plan.ttl",
      app: "docs",
      kind: "document",
      sharedBy: "Bob",
      fromAnotherPod: true,
      sharedAt: "2026-01-02T00:00:00Z",
      role: "Editor",
      source: "inbox",
    },
  ]);
  expect(sharedItemsFromInbox([{ ...base, content: " Team plan " }])[0]?.name).toBe("Team plan");
  const [minimal] = sharedItemsFromInbox([
    { ...base, summary: "Shared with you as ", published: "bad" },
  ]);
  expect(sharedItemsFromInbox([base])[0]).not.toHaveProperty("sharedAt");
  expect(minimal).toEqual({
    url,
    name: "plan.ttl",
    app: "docs",
    kind: "document",
    source: "inbox",
  });
  expect(
    sharedItemsFromInbox([
      { ...base, type: "Create" },
      { ...base, type: "Offer" },
      { ...base, summary: "Assigned", target: url },
      { url: base.url, type: "Announce" },
      { ...base, object: undefined },
      { ...base, object: "javascript:alert(1)" },
      { ...base, object: "https://u:p@example/secret" },
    ]),
  ).toEqual([]);
});

it("merges exact URLs newest first and keeps richer fields without mutating inputs", () => {
  const oldest = item({
    sharedAt: "2026-01-01",
    name: "Launch plan",
    app: "docs",
    kind: "document",
    sharedBy: "Bob",
    role: "Viewer",
    source: "app",
  });
  const newest = item({ sharedAt: "2026-02-01", role: "Editor", source: "inbox" });
  const other = item({ url: "https://z.example/undated", sharedAt: "bad" });
  expect(mergeSharedItems([oldest, other], [newest, item({ url: "javascript:alert(1)" })])).toEqual(
    [{ ...oldest, sharedAt: newest.sharedAt, role: "Editor" }, other],
  );
  expect(oldest.role).toBe("Viewer");
  expect(newest.name).toBe("plan.ttl");
  expect(
    mergeSharedItems(
      [item({ name: "Explicit", app: "docs", kind: "document" })],
      [item({ name: "", sharedBy: "Bob", role: "Viewer" })],
    )[0],
  ).toMatchObject({ name: "Explicit", sharedBy: "Bob", role: "Viewer" });
  expect(mergeSharedItems([item({ name: "" }), item({ name: "Title" })])[0]?.name).toBe("Title");
  expect(mergeSharedItems([item(), item({ name: "" })])[0]?.name).toBe("plan.ttl");
  expect(
    mergeSharedItems([item({ sharedAt: "2026-01-01", name: "Title" }), item({ name: "old" })])[0]
      ?.sharedAt,
  ).toBe("2026-01-01");
  expect(mergeSharedItems()).toEqual([]);
  expect(
    mergeSharedItems([other, item({ url: "https://a.example/undated" })]).map((x) => x.url),
  ).toEqual(["https://a.example/undated", other.url]);
});

it("preserves Drive's stable insertion order and NaN date comparisons", () => {
  const entries = [
    item({ sharedAt: "2026-02-01" }),
    item({ sharedAt: "2026-01-01" }),
    item({ sharedAt: "2026-02-01", name: "last" }),
  ];
  expect(latestSharedEntries(entries, (entry) => entry.sharedAt)).toEqual([entries[2]]);
  expect(
    latestSharedEntries(
      [item({ url: "https://z.example/" }), item({ url: "https://a.example/", sharedAt: "bad" })],
      (entry) => entry.sharedAt,
    ).map((entry) => entry.url),
  ).toEqual(["https://z.example/", "https://a.example/"]);
  expect(latestSharedEntries([], () => undefined)).toEqual([]);
});

describe("account-scoped removal lists", () => {
  it("uses Tasks' key scheme and fences signed-out or foreign account snapshots", () => {
    expect(sharedAccountKey("https://alice.example/#me", "suite.tasks.shared")).toBe(
      "suite.tasks.shared:https%3A%2F%2Falice.example%2F%23me",
    );
    expect(sharedAccountKey("alice")).toBe("suite.shared.hidden:alice");
    const snapshot = { owner: "alice", items: [{ url }] };
    expect(sharedItemsForAccount("alice", snapshot)).toBe(snapshot.items);
    expect(sharedItemsForAccount("bob", snapshot)).toEqual([]);
    expect(sharedItemsForAccount(undefined, { items: snapshot.items })).toEqual([]);
  });
  it("parses, validates and deduplicates; invalid storage is empty", () => {
    for (const raw of [null, "{", "null", "0", "{}", '"text"'])
      expect(parseSharedEntries(raw, isSharedUrlEntry)).toEqual([]);
    expect(
      parseSharedEntries(
        JSON.stringify([null, 0, {}, { url: 3 }, { url: "bad" }, { url }, { url, extra: true }]),
        isSharedUrlEntry,
      ),
    ).toEqual([{ url, extra: true }]);
  });
  it("hides safely and removes without modifying the input or resource permissions", () => {
    const items = [item(), item({ url: "https://other.example/a" })];
    const hidden = hideSharedItem([], url, "2026-11-11");
    expect(hideSharedItem(hidden, url, "2026-11-11")).toEqual(hidden);
    expect(hideSharedItem(hidden, "bad")).toEqual(hidden);
    expect(visibleSharedItems(items, hidden)).toEqual([items[1]]);
    expect(removeSharedItem(items, url)).toEqual([items[1]]);
    expect(items).toHaveLength(2);
    expect(hidden).toEqual([{ url, hiddenAt: "2026-11-11" }]);
  });
});

it("hides only opens and announcements at or before hiddenAt", () => {
  const hidden = hideSharedItem([], url, "2026-01-02");
  for (const fields of [
    {},
    { sharedAt: "bad" },
    { sharedAt: "2026-01-01" },
    { openedAt: "2026-01-02" },
    { sharedAt: "2026-01-02" },
  ])
    expect(visibleSharedItems([{ url, ...fields }], hidden)).toEqual([]);
  for (const fields of [
    { sharedAt: "2026-01-03" },
    { openedAt: "2026-01-03" },
    { openedAt: new Date("2026-01-03") },
  ])
    expect(visibleSharedItems([{ url, ...fields }], hidden)).toHaveLength(1);
  expect(isHiddenSharedItem(hidden[0])).toBe(true);
  for (const value of [null, { url }, { url, hiddenAt: 123 }, { url, hiddenAt: "bad" }])
    expect(isHiddenSharedItem(value)).toBe(false);
});
it("preserves equal-date insertion order and never replaces a NaN-dated Drive entry", () => {
  const entries = [
    item({ url: "https://z.example/", sharedAt: "2026-01-01" }),
    item({ url: "https://a.example/", sharedAt: "2026-01-01" }),
  ];
  expect(latestSharedEntries(entries, (x) => x.sharedAt)).toEqual(entries);
  for (const dates of [
    ["bad", "2026-01-01"],
    ["2026-01-01", "bad"],
    ["2026-01-01", undefined],
    [undefined, "2026-01-01"],
  ]) {
    const first = item({ sharedAt: dates[0] });
    expect(
      latestSharedEntries([first, item({ sharedAt: dates[1], name: "later" })], (x) => x.sharedAt),
    ).toEqual([first]);
  }
});
it("keeps trusted names over a newer spoof and identifies foreign actor origins", () => {
  for (const source of ["app", "opened"] as const) {
    const trusted = item({ source, name: "Real title", sharedAt: "2026-01-01" });
    const spoof = item({ source: "inbox", name: "Spoof", sharedAt: "2026-02-01" });
    expect(mergeSharedItems([trusted, spoof])[0]).toMatchObject({ name: "Real title", source });
    expect(mergeSharedItems([{ ...trusted, sharedAt: "2026-03-01" }, spoof])[0]?.name).toBe(
      "Real title",
    );
  }
  for (const [actor, foreign] of [
    ["https://bob.example/#me", false],
    ["https://evil.example/#me", true],
  ] as const) {
    expect(
      sharedItemsFromInbox([
        {
          url: "https://a.example/inbox/1",
          type: "Announce",
          summary: "Shared with you as Viewer",
          object: url,
          actor,
        },
      ])[0]?.fromAnotherPod,
    ).toBe(foreign);
  }
});

it("keeps insertion order for missing Drive dates and tolerates invalid Dates in visibility", () => {
  const entries = [item({ url: "https://z.example/" }), item({ url: "https://a.example/" })];
  expect(latestSharedEntries(entries, (x) => x.sharedAt)).toEqual(entries);
  expect(visibleSharedItems([{ url, openedAt: new Date("bad") }], hideSharedItem([], url))).toEqual(
    [],
  );
});

describe("inbox trust boundaries", () => {
  const announce = (object: string, fields: Record<string, string> = {}) => ({
    url: "https://alice.example/inbox/1",
    type: "Announce",
    summary: "Shared with you as Viewer",
    object,
    ...fields,
  });
  it("drops sender dates beyond the clock skew so they neither pin nor outrank a hide", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    const [future, recent] = sharedItemsFromInbox(
      [
        announce("https://bob.example/future.ttl", { published: "2999-01-01T00:00:00Z" }),
        announce("https://bob.example/recent.ttl", { published: "2026-11-10T00:00:00Z" }),
      ],
      { now },
    ).sort((a, b) => a.url.localeCompare(b.url));
    expect(future).not.toHaveProperty("sharedAt");
    expect(recent?.sharedAt).toBe("2026-11-10T00:00:00Z");
    // Undated sorts after dated, and a hide suppresses it until a genuine later reshare.
    expect(
      sharedItemsFromInbox(
        [
          announce("https://bob.example/future.ttl", { published: "2999-01-01T00:00:00Z" }),
          announce("https://bob.example/recent.ttl", { published: "2026-11-10T00:00:00Z" }),
        ],
        { now },
      ).map((entry) => entry.url),
    ).toEqual(["https://bob.example/recent.ttl", "https://bob.example/future.ttl"]);
    const hidden = hideSharedItem(
      [],
      "https://bob.example/future.ttl",
      new Date(now).toISOString(),
    );
    expect(visibleSharedItems([future as SharedItem], hidden)).toEqual([]);
    const skewed = new Date(now + SHARED_CLOCK_SKEW_MS).toISOString();
    expect(sharedItemsFromInbox([announce(url, { published: skewed })], { now })[0]?.sharedAt).toBe(
      skewed,
    );
    expect(
      sharedItemsFromInbox(
        [announce(url, { published: new Date(now + SHARED_CLOCK_SKEW_MS + 1).toISOString() })],
        { now },
      )[0],
    ).not.toHaveProperty("sharedAt");
    expect(
      sharedItemsFromInbox([announce(url, { published: "2999-01-01T00:00:00Z" })])[0],
    ).not.toHaveProperty("sharedAt");
  });
  it("hides at or after a record's own dates", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(sharedHiddenAt(undefined, now)).toBe("2026-11-11T12:00:00.000Z");
    expect(sharedHiddenAt({ sharedAt: "2026-11-11T12:03:00Z" }, now)).toBe(
      "2026-11-11T12:03:00.000Z",
    );
    expect(sharedHiddenAt({ openedAt: new Date("2026-11-11T12:04:00Z") }, now)).toBe(
      "2026-11-11T12:04:00.000Z",
    );
    expect(sharedHiddenAt({ sharedAt: "bad", openedAt: "2026-01-01" }, now)).toBe(
      "2026-11-11T12:00:00.000Z",
    );
    expect(Date.parse(sharedHiddenAt({}))).toBeLessThanOrEqual(Date.now());
    const skewed = item({ sharedAt: "2026-11-11T12:03:00Z" });
    expect(
      visibleSharedItems([skewed], hideSharedItem([], url, sharedHiddenAt(skewed, now))),
    ).toEqual([]);
  });
  it("never lists the user's own storage as shared with me", () => {
    const storageUrl = "https://pod.example/alice/";
    expect(
      sharedItemsFromInbox(
        [
          announce(`${storageUrl}tasks/projects/home.ttl`),
          announce("https://pod.example/alice"),
          announce("https://pod.example/bob/docs/a.ttl"),
          announce("https://pod.example/alicex/a.ttl"),
        ],
        { storageUrl },
      ).map((entry) => entry.url),
    ).toEqual(["https://pod.example/alicex/a.ttl", "https://pod.example/bob/docs/a.ttl"]);
    expect(sharedItemsFromInbox([announce(`${storageUrl}a.ttl`)])).toHaveLength(1);
  });
  it("uses pod roots, not origins, on the user's own path-based host", () => {
    const storageUrl = "https://pod.example/alice/";
    const from = (actor: string, object: string, storage: string | undefined = storageUrl) =>
      sharedItemsFromInbox([announce(object, { actor })], storage ? { storageUrl: storage } : {})[0]
        ?.fromAnotherPod;
    expect(from("https://pod.example/bob/profile/card#me", "https://pod.example/bob/a.ttl")).toBe(
      false,
    );
    expect(from("https://pod.example/eve/profile/card#me", "https://pod.example/bob/a.ttl")).toBe(
      true,
    );
    expect(from("https://pod.example/card#me", "https://pod.example/bob/a.ttl")).toBe(true);
    expect(from("https://pod.example/eve/profile/card#me", "https://pod.example/eve%2fa")).toBe(
      true,
    );
    // Subdomain hosts and other hosts keep the origin boundary.
    expect(
      from(
        "https://bob.example/profile/card#me",
        "https://bob.example/a.ttl",
        "https://alice.example/",
      ),
    ).toBe(false);
    expect(
      from(
        "https://eve.host/profile/card#me",
        "https://eve.host/a.ttl",
        "https://pod.example/alice/",
      ),
    ).toBe(false);
    expect(from("https://pod.example/eve/card#me", "https://pod.example/bob/a.ttl", "bad")).toBe(
      false,
    );
    expect(from("not a url", "https://pod.example/bob/a.ttl")).toBe(true);
  });
});

describe("share notifications in an inbox", () => {
  const share = shareNotification("https://bob.example/docs/plan.ttl", "Editor");
  const n = { url: "https://alice.example/inbox/a.ttl" };

  it("classifies only the share Announce shape with a usable resource link", () => {
    expect(isShareNotification({ ...n, ...share })).toBe(true);
    // Inside the owner's storage it is still a share notification, just never "shared with me".
    expect(isShareNotification({ ...n, ...share, object: "https://alice.example/a.ttl" })).toBe(
      true,
    );
    expect(isShareNotification({ ...n, ...share, object: "mailto:bob@example.org" })).toBe(false);
    expect(isShareNotification({ ...n, type: "Announce", summary: share.summary })).toBe(false);
    expect(isShareNotification({ ...n, type: "Announce", object: share.object })).toBe(false);
    expect(isShareNotification({ ...n, type: "Offer", object: share.object })).toBe(false);
  });

  /** A minimal pod: one profile naming an inbox, its listing and the members' Turtle. */
  function inboxPod(root: string) {
    const as = "https://www.w3.org/ns/activitystreams#";
    const webId = `${root}profile/card#me`;
    const inbox = `${root}inbox/`;
    const announce = (summary: string) =>
      `<#it> a <${as}Announce>; <${as}object> <${share.object}>; <${as}summary> "${summary}".`;
    const docs: Record<string, string> = {
      [`${root}profile/card`]: `<#me> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`,
      [inbox]: `<> <http://www.w3.org/ns/ldp#contains> <share.ttl>, <assign.ttl>, <bad.ttl>, <request.ttl>.`,
      [`${inbox}share.ttl`]: announce(share.summary as string),
      [`${inbox}assign.ttl`]: announce("Bob assigned you 'Plan'"),
      [`${inbox}bad.ttl`]: "this is not turtle",
      [`${inbox}request.ttl`]: announce(share.summary as string),
    };
    const requested: string[] = [];
    const fetch = async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      requested.push(url);
      const body = docs[url];
      return body === undefined
        ? new Response(null, { status: 404 })
        : new Response(body, { headers: { "content-type": "text/turtle" } });
    };
    return { webId, inbox, requested, fetch: fetch as typeof globalThis.fetch };
  }

  it("reads only the profile, the inbox and the candidates, and keeps the shares", async () => {
    const pod = inboxPod("https://8.8.8.8/");
    const candidates = ["share.ttl", "assign.ttl", "bad.ttl"].map((name) => pod.inbox + name);
    const found = await shareNotificationUrls([...candidates, "not a url"], {
      fetch: pod.fetch,
      webId: pod.webId,
    });
    expect([...found]).toEqual([`${pod.inbox}share.ttl`]);
    // request.ttl was already placed by the caller: it is answered locally, never fetched.
    expect(pod.requested.sort()).toEqual(
      ["https://8.8.8.8/profile/card", pod.inbox, ...candidates].sort(),
    );
  });

  it("filters the DNS-pinning transport too", async () => {
    // Node and jsdom refuse unpinned hostnames, so the inbox sits at an IP literal throughout.
    const pod = inboxPod("https://8.8.4.4/");
    const found = await shareNotificationUrls([`${pod.inbox}share.ttl`], {
      fetch: pod.fetch,
      pinningFetch: pod.fetch,
      webId: pod.webId,
      signal: new AbortController().signal,
      maxItems: 10,
    });
    expect([...found]).toEqual([`${pod.inbox}share.ttl`]);
    expect(pod.requested).not.toContain(`${pod.inbox}request.ttl`);
  });

  it("skips discovery when the caller names the inbox", async () => {
    const pod = inboxPod("https://8.8.8.8/");
    const found = await shareNotificationUrls([`${pod.inbox}share.ttl`, `${pod.inbox}bad.ttl`], {
      fetch: pod.fetch,
      webId: pod.webId,
      inbox: pod.inbox,
    });
    expect([...found]).toEqual([`${pod.inbox}share.ttl`]);
    expect(pod.requested.sort()).toEqual([
      pod.inbox,
      `${pod.inbox}bad.ttl`,
      `${pod.inbox}share.ttl`,
    ]);
  });

  it("finds nothing without candidates, an inbox, or before an abort", async () => {
    const pod = inboxPod("https://8.8.8.8/");
    expect(await shareNotificationUrls([], { fetch: pod.fetch, webId: pod.webId })).toEqual(
      new Set(),
    );
    expect(pod.requested).toEqual([]);
    const noInbox = await shareNotificationUrls([`${pod.inbox}share.ttl`], {
      fetch: pod.fetch,
      webId: "https://8.8.8.8/nobody#me",
    });
    expect(noInbox).toEqual(new Set());
    // Aborted while the profile is read: discovery swallows it, the helper still rejects.
    const during = new AbortController();
    const aborting: typeof fetch = async (input, init) => {
      during.abort();
      return pod.fetch(input, init);
    };
    await expect(
      shareNotificationUrls([`${pod.inbox}share.ttl`], {
        fetch: aborting,
        webId: pod.webId,
        signal: during.signal,
      }),
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      shareNotificationUrls([`${pod.inbox}share.ttl`], {
        fetch: pod.fetch,
        webId: pod.webId,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
