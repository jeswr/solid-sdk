// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { readInbox, resolveOwnInbox } from "./inbox";

const WEBID = "https://8.8.8.8/alice/profile/card#me";
const OWN = ["https://8.8.8.8/alice/"];
const INBOX = "https://8.8.8.8/alice/inbox/";

const PREFIXES = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
`;

describe("resolveOwnInbox (own-pod SSRF guard)", () => {
  it("returns the inbox URL when it is within the user's own pod", async () => {
    const doFetch = vi.fn(
      async () =>
        new Response(`${PREFIXES}\n<${WEBID}> ldp:inbox <${INBOX}> .`, {
          headers: { "content-type": "text/turtle" },
        }),
    ) as unknown as typeof fetch;
    expect(await resolveOwnInbox(WEBID, OWN, doFetch)).toBe(INBOX);
  });

  it("REJECTS a foreign inbox URL (never fetched with the user's token)", async () => {
    const doFetch = vi.fn(
      async () =>
        new Response(`${PREFIXES}\n<${WEBID}> ldp:inbox <https://evil.example/inbox/> .`, {
          headers: { "content-type": "text/turtle" },
        }),
    ) as unknown as typeof fetch;
    expect(await resolveOwnInbox(WEBID, OWN, doFetch)).toBeUndefined();
  });

  it("rejects a sibling-pod inbox on the same host", async () => {
    const doFetch = vi.fn(
      async () =>
        new Response(`${PREFIXES}\n<${WEBID}> ldp:inbox <https://8.8.8.8/bob/inbox/> .`, {
          headers: { "content-type": "text/turtle" },
        }),
    ) as unknown as typeof fetch;
    expect(await resolveOwnInbox(WEBID, OWN, doFetch)).toBeUndefined();
  });

  it("returns undefined when the profile advertises no inbox", async () => {
    const doFetch = vi.fn(
      async () =>
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
      if (u === WEBID.split("#")[0])
        return new Response(profileTtl, { headers: { "content-type": "text/turtle" } });
      if (u === INBOX)
        return new Response(containerTtl, { headers: { "content-type": "text/turtle" } });
      if (notificationTtl[u])
        return new Response(notificationTtl[u], { headers: { "content-type": "text/turtle" } });
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

  it("sorts by published BEFORE applying the display cap (newest survive regardless of container order)", async () => {
    // 60 members in OLDEST-first container order; only the newest 50 should show,
    // and a member newer than the first-50-by-container-order must NOT be dropped.
    const N = 60;
    const members = Array.from({ length: N }, (_, i) => `${INBOX}n${i}.ttl`);
    const ttl: Record<string, string> = {};
    members.forEach((m, i) => {
      // Published time increases with index (i hours from a base instant) ⇒ the
      // LAST 50 (i=10..59) are the newest. Use a real instant per member so every
      // timestamp is valid (a fixed calendar field would overflow past 31 days).
      const published = new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString();
      ttl[m] =
        `${PREFIXES}\n<${m}> a as:Announce ; as:summary "n${i}" ; as:published "${published}" .`;
    });
    const doFetch = inboxPod(members, ttl);
    const { notifications } = await readInbox(WEBID, OWN, doFetch);
    expect(notifications.length).toBe(50);
    // Newest-first: n59 first, and the cut-off is n10 (the 50th newest); n0..n9 dropped.
    expect(notifications[0].summary).toBe("n59");
    expect(notifications.at(-1)?.summary).toBe("n10");
    expect(notifications.some((n) => n.summary === "n0")).toBe(false);
  });

  it("flags truncation EXPLICITLY when the container exceeds the fetch ceiling", async () => {
    // 5 members, fetch ceiling of 3 → truncated, totalMembers reported, only 3 fetched.
    const members = Array.from({ length: 5 }, (_, i) => `${INBOX}n${i}.ttl`);
    const ttl: Record<string, string> = {};
    members.forEach((m, i) => {
      ttl[m] = `${PREFIXES}\n<${m}> a as:Announce ; as:summary "n${i}" .`;
    });
    const doFetch = inboxPod(members, ttl);
    const result = await readInbox(WEBID, OWN, doFetch, /* maxFetch */ 3);
    expect(result.truncated).toBe(true);
    expect(result.totalMembers).toBe(5);
    expect(result.notifications.length).toBe(3); // only the ceiling was fetched
    // The foreign-member filter still feeds totalMembers (eligible only).
    const spy = doFetch as unknown as ReturnType<typeof vi.fn>;
    const fetchedMembers = spy.mock.calls.filter(
      (c) => String(c[0]).startsWith(INBOX) && String(c[0]) !== INBOX,
    );
    expect(fetchedMembers.length).toBe(3);
  });

  it("does NOT flag truncation when the container fits within the ceiling", async () => {
    const members = [`${INBOX}a.ttl`, `${INBOX}b.ttl`];
    const doFetch = inboxPod(members, {
      [`${INBOX}a.ttl`]: `${PREFIXES}\n<${INBOX}a.ttl> a as:Announce ; as:summary "a" .`,
      [`${INBOX}b.ttl`]: `${PREFIXES}\n<${INBOX}b.ttl> a as:Announce ; as:summary "b" .`,
    });
    const result = await readInbox(WEBID, OWN, doFetch, 3);
    expect(result.truncated).toBe(false);
    expect(result.totalMembers).toBe(2);
  });

  it("returns an empty list when the profile advertises no own-pod inbox", async () => {
    const doFetch = vi.fn(async (url: string) => {
      if (String(url) === WEBID.split("#")[0]) {
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

it.each([
  401, 403,
])("propagates listing HTTP %s instead of rendering an empty inbox", async (status) => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response(
        "<https://8.8.8.8/alice/profile/card#me> <http://www.w3.org/ns/ldp#inbox> <https://8.8.8.8/alice/inbox/>.",
        { headers: { "content-type": "text/turtle" } },
      ),
    )
    .mockResolvedValue(new Response(null, { status }));
  await expect(readInbox(WEBID, OWN, fetch)).rejects.toMatchObject({ status });
});

it("keeps untyped notifications without inventing an as:Notification IRI", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response(
        "<https://8.8.8.8/alice/profile/card#me> <http://www.w3.org/ns/ldp#inbox> <https://8.8.8.8/alice/inbox/>.",
        { headers: { "content-type": "text/turtle" } },
      ),
    )
    .mockResolvedValueOnce(
      new Response("<> <http://www.w3.org/ns/ldp#contains> <n>.", {
        headers: { "content-type": "text/turtle" },
      }),
    )
    .mockResolvedValueOnce(
      new Response('[] <https://www.w3.org/ns/activitystreams#summary> "Legacy".', {
        headers: { "content-type": "text/turtle" },
      }),
    );
  const result = await readInbox(WEBID, OWN, fetch);
  expect(result.notifications).toEqual([{ url: `${INBOX}n`, types: [], summary: "Legacy" }]);
});

it("own-pod HTTPS reads retain non-default ports", async () => {
  const webId = "https://8.8.8.8:8443/alice/profile#me";
  const root = "https://8.8.8.8:8443/alice/";
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response(
        "<https://8.8.8.8:8443/alice/profile#me> <http://www.w3.org/ns/ldp#inbox> <https://8.8.8.8:8443/alice/inbox/>.",
        { headers: { "content-type": "text/turtle" } },
      ),
    )
    .mockResolvedValue(new Response("", { headers: { "content-type": "text/turtle" } }));
  expect((await readInbox(webId, [root], fetch)).inboxUrl).toBe(`${root}inbox/`);
});

it("loopback reader development support is explicit", async () => {
  const webId = "http://localhost:3000/alice/profile#me";
  const root = "http://localhost:3000/alice/";
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(
      async (url) =>
        new Response(
          String(url).endsWith("/profile")
            ? "<http://localhost:3000/alice/profile#me> <http://www.w3.org/ns/ldp#inbox> <http://localhost:3000/alice/inbox/>."
            : "",
          { headers: { "content-type": "text/turtle" } },
        ),
    );
  expect((await readInbox(webId, [root], fetch)).inboxUrl).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
  expect((await readInbox(webId, [root], fetch, 500, true)).inboxUrl).toBe(`${root}inbox/`);
});

it("retains a readable empty notification with no invented type", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response(
        "<https://8.8.8.8/alice/profile/card#me> <http://www.w3.org/ns/ldp#inbox> <https://8.8.8.8/alice/inbox/>.",
        { headers: { "content-type": "text/turtle" } },
      ),
    )
    .mockResolvedValueOnce(
      new Response("<> <http://www.w3.org/ns/ldp#contains> <n>.", {
        headers: { "content-type": "text/turtle" },
      }),
    )
    .mockResolvedValueOnce(new Response("", { headers: { "content-type": "text/turtle" } }));
  expect((await readInbox(WEBID, OWN, fetch)).notifications).toEqual([
    { url: `${INBOX}n`, types: [], summary: undefined },
  ]);
});
