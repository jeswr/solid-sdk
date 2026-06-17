import { describe, it, expect, vi } from "vitest";
import { Parser, Store } from "n3";
import { parseNotification, resolveOwnInbox, readInbox } from "./inbox";

const WEBID = "https://pod.example/alice/profile/card#me";
const OWN = ["https://pod.example/alice/"];
const INBOX = "https://pod.example/alice/inbox/";

function turtle(ttl: string): Store {
  const store = new Store();
  store.addQuads(new Parser({ format: "text/turtle" }).parse(ttl));
  return store;
}

const PREFIXES = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
`;

describe("parseNotification", () => {
  it("parses an as:Announce activity at the resource URL", () => {
    const url = `${INBOX}n1.ttl`;
    const ds = turtle(`${PREFIXES}
      <${url}> a as:Announce ;
        as:actor <https://bob.example/profile#me> ;
        as:object <https://pod.example/alice/issues/issues/42.ttl> ;
        as:summary "Bob assigned you issue #42" ;
        as:target <https://pod.example/alice/issues/tracker.ttl#it> ;
        as:published "2026-06-10T09:00:00Z" .
    `);
    const n = parseNotification(url, ds);
    expect(n.url).toBe(url);
    expect(n.types).toContain("https://www.w3.org/ns/activitystreams#Announce");
    expect(n.actor).toBe("https://bob.example/profile#me");
    expect(n.object).toBe("https://pod.example/alice/issues/issues/42.ttl");
    expect(n.summary).toBe("Bob assigned you issue #42");
    expect(n.target).toBe("https://pod.example/alice/issues/tracker.ttl#it");
    expect(n.published).toBe("2026-06-10T09:00:00Z");
  });

  it("falls back to content/name when as:summary is absent", () => {
    const url = `${INBOX}n2.ttl`;
    const ds = turtle(`${PREFIXES}
      <${url}> a as:Create ; as:content "A mention" .
    `);
    expect(parseNotification(url, ds).summary).toBe("A mention");
  });

  it("resolves the activity at a fragment subject when none sits at the resource URL", () => {
    const url = `${INBOX}n3.ttl`;
    const ds = turtle(`${PREFIXES}
      <${url}#activity> a as:Add ; as:object <https://pod.example/alice/issues/issues/7.ttl> .
    `);
    const n = parseNotification(url, ds);
    expect(n.types).toContain("https://www.w3.org/ns/activitystreams#Add");
    expect(n.object).toBe("https://pod.example/alice/issues/issues/7.ttl");
  });
});

describe("resolveOwnInbox (own-pod SSRF guard)", () => {
  it("returns the inbox URL when it is within the user's own pod", async () => {
    const doFetch = vi.fn(async () =>
      new Response(`${PREFIXES}\n<${WEBID}> ldp:inbox <${INBOX}> .`, {
        headers: { "content-type": "text/turtle" },
      }),
    ) as unknown as typeof fetch;
    expect(await resolveOwnInbox(WEBID, OWN, doFetch)).toBe(INBOX);
  });

  it("REJECTS a foreign inbox URL (never fetched with the user's token)", async () => {
    const doFetch = vi.fn(async () =>
      new Response(`${PREFIXES}\n<${WEBID}> ldp:inbox <https://evil.example/inbox/> .`, {
        headers: { "content-type": "text/turtle" },
      }),
    ) as unknown as typeof fetch;
    expect(await resolveOwnInbox(WEBID, OWN, doFetch)).toBeUndefined();
  });

  it("rejects a sibling-pod inbox on the same host", async () => {
    const doFetch = vi.fn(async () =>
      new Response(`${PREFIXES}\n<${WEBID}> ldp:inbox <https://pod.example/bob/inbox/> .`, {
        headers: { "content-type": "text/turtle" },
      }),
    ) as unknown as typeof fetch;
    expect(await resolveOwnInbox(WEBID, OWN, doFetch)).toBeUndefined();
  });

  it("returns undefined when the profile advertises no inbox", async () => {
    const doFetch = vi.fn(async () =>
      new Response(`${PREFIXES}\n<${WEBID}> solid:oidcIssuer <https://idp.example/> .`, {
        headers: { "content-type": "text/turtle" },
      }),
    ) as unknown as typeof fetch;
    expect(await resolveOwnInbox(WEBID, OWN, doFetch)).toBeUndefined();
  });
});

describe("readInbox (end to end, mocked fetch)", () => {
  function inboxPod(members: string[], notificationTtl: Record<string, string>) {
    const profileTtl = `${PREFIXES}\n<${WEBID}> ldp:inbox <${INBOX}> .`;
    const containerTtl = `${PREFIXES}
      <${INBOX}> a ldp:Container .
      ${members.map((m) => `<${INBOX}> ldp:contains <${m}> .`).join("\n")}
    `;
    return vi.fn(async (url: string) => {
      const u = String(url);
      if (u === WEBID) return new Response(profileTtl, { headers: { "content-type": "text/turtle" } });
      if (u === INBOX) return new Response(containerTtl, { headers: { "content-type": "text/turtle" } });
      if (notificationTtl[u]) return new Response(notificationTtl[u], { headers: { "content-type": "text/turtle" } });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
  }

  it("lists + parses the inbox members newest-first", async () => {
    const n1 = `${INBOX}n1.ttl`;
    const n2 = `${INBOX}n2.ttl`;
    const doFetch = inboxPod([n1, n2], {
      [n1]: `${PREFIXES}\n<${n1}> a as:Announce ; as:summary "Older" ; as:published "2026-06-01T00:00:00Z" .`,
      [n2]: `${PREFIXES}\n<${n2}> a as:Add ; as:summary "Newer" ; as:published "2026-06-15T00:00:00Z" .`,
    });
    const { inboxUrl, notifications } = await readInbox(WEBID, OWN, doFetch);
    expect(inboxUrl).toBe(INBOX);
    expect(notifications.map((n) => n.summary)).toEqual(["Newer", "Older"]);
  });

  it("skips a member that fails to fetch (one bad notification doesn't blank the inbox)", async () => {
    const good = `${INBOX}good.ttl`;
    const bad = `${INBOX}bad.ttl`; // returns 404 → fetchRdf throws → skipped
    const doFetch = inboxPod([good, bad], {
      [good]: `${PREFIXES}\n<${good}> a as:Announce ; as:summary "Good" .`,
    });
    const { notifications } = await readInbox(WEBID, OWN, doFetch);
    expect(notifications.map((n) => n.summary)).toEqual(["Good"]);
  });

  it("does NOT fetch a member that points off-pod (defence in depth)", async () => {
    const own = `${INBOX}own.ttl`;
    const foreign = "https://evil.example/inbox/x.ttl";
    const doFetch = inboxPod([own, foreign], {
      [own]: `${PREFIXES}\n<${own}> a as:Announce ; as:summary "Own" .`,
    });
    const { notifications } = await readInbox(WEBID, OWN, doFetch);
    expect(notifications.map((n) => n.summary)).toEqual(["Own"]);
    // The foreign member URL was never requested.
    const spy = doFetch as unknown as ReturnType<typeof vi.fn>;
    expect(spy.mock.calls.some((c) => String(c[0]) === foreign)).toBe(false);
  });

  it("returns an empty list when the profile advertises no own-pod inbox", async () => {
    const doFetch = vi.fn(async (url: string) => {
      if (String(url) === WEBID) {
        return new Response(`${PREFIXES}\n<${WEBID}> ldp:inbox <https://evil.example/inbox/> .`, {
          headers: { "content-type": "text/turtle" },
        });
      }
      throw new Error("should not fetch a foreign inbox");
    }) as unknown as typeof fetch;
    const { inboxUrl, notifications } = await readInbox(WEBID, OWN, doFetch);
    expect(inboxUrl).toBeUndefined();
    expect(notifications).toEqual([]);
  });
});
