import { describe, it, expect, vi } from "vitest";
import { Parser, Store, DataFactory } from "n3";
import type { GuardOptions } from "@jeswr/guarded-fetch";
import {
  Announcer,
  AnnounceError,
  buildAnnounceTurtle,
  defaultSummary,
  postToInbox,
  resolveCollaboratorInbox,
  sendAnnounce,
} from "./announce";
import { parseNotification } from "./inbox";

const ACTOR = "https://alice.example/profile/card#me";
const TARGET = "https://bob.example/profile/card#me";
const TARGET_INBOX = "https://bob.example/inbox/";
const ISSUE = "https://alice.example/issue-tracker/issues/42.ttl";

// A deterministic public DNS answer so `assertSafeUrl`'s Node branch never hits
// real DNS for a hostname target. IP-literal / scheme / denylist refusals are
// classified BEFORE any lookup, so this same option object is safe to reuse for
// the negative SSRF cases too (a literal 169.254.169.254 never consults it).
const SAFE_GUARD: GuardOptions = {
  dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
};

/** A fake pod: serves Turtle profiles on GET, records/answers inbox POSTs. */
function fakePod(opts: {
  profiles?: Record<string, string>;
  /** GET URLs that 302-redirect to the given Location (for discovery-redirect tests). */
  getRedirects?: Record<string, string>;
  postStatus?: number;
  postLocation?: string;
  onPost?: (url: string, body: string) => void;
}): typeof fetch {
  const profiles = opts.profiles ?? {};
  const getRedirects = opts.getRedirects ?? {};
  // Fragment-tolerant lookup: a server serves the document, ignoring the `#me`.
  const noFrag = (u: string) => u.split("#")[0];
  const lookup = (u: string): string | undefined => {
    const target = noFrag(u);
    const key = Object.keys(profiles).find((k) => noFrag(k) === target);
    return key ? profiles[key] : undefined;
  };
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      const redirect = getRedirects[noFrag(url)] ?? getRedirects[url];
      if (redirect) return new Response(null, { status: 302, headers: { location: redirect } });
      const ttl = lookup(url);
      if (ttl === undefined) return new Response("Not found", { status: 404 });
      return new Response(method === "HEAD" ? null : ttl, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
    }
    // POST → the inbox
    opts.onPost?.(url, typeof init?.body === "string" ? init.body : String(init?.body ?? ""));
    const status = opts.postStatus ?? 201;
    if (status >= 300 && status < 400) {
      return new Response(null, {
        status,
        headers: opts.postLocation ? { location: opts.postLocation } : {},
      });
    }
    return new Response(null, { status });
  }) as typeof fetch;
}

function profile(webId: string, inbox: string | null): string {
  const inboxLine = inbox ? `\n  ldp:inbox <${inbox}> ;` : "";
  return `@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
<${webId}>${inboxLine}
  pim:storage <https://bob.example/> .`;
}

describe("buildAnnounceTurtle → the AS2 Announce is well-formed and round-trips", () => {
  it("round-trips through the inbox reader (parseNotification) with all fields", async () => {
    const ttl = await buildAnnounceTurtle({
      kind: "assignment",
      actorWebId: ACTOR,
      objectIri: ISSUE,
      targetWebId: TARGET,
      summary: 'You were assigned to "Fix login"',
      published: "2026-07-05T10:00:00.000Z",
    });
    // The server mints the resource URL; the empty-IRI subject `<>` resolves to it.
    const mintedUrl = `${TARGET_INBOX}n-abc.ttl`;
    const store = new Store();
    store.addQuads(new Parser({ format: "text/turtle", baseIRI: mintedUrl }).parse(ttl));

    const n = parseNotification(mintedUrl, store);
    expect(n.types).toContain("https://www.w3.org/ns/activitystreams#Announce");
    // own-vs-foreign origin: actor is the ACTING user; target is the COLLABORATOR.
    expect(n.actor).toBe(ACTOR);
    expect(n.target).toBe(TARGET);
    expect(n.object).toBe(ISSUE);
    expect(n.summary).toBe('You were assigned to "Fix login"');
    expect(n.published).toBe("2026-07-05T10:00:00.000Z");
  });

  it("carries own-origin PROV provenance (wasGeneratedBy an activity associated with the actor)", async () => {
    const ttl = await buildAnnounceTurtle({
      kind: "mention",
      actorWebId: ACTOR,
      objectIri: ISSUE,
      targetWebId: TARGET,
      summary: "mentioned",
    });
    const store = new Store();
    store.addQuads(new Parser({ format: "text/turtle", baseIRI: `${TARGET_INBOX}x.ttl` }).parse(ttl));
    const PROV = "http://www.w3.org/ns/prov#";
    const activities = [...store.match(null, null, DataFactory.namedNode(`${PROV}Activity`))];
    expect(activities.length).toBe(1);
    const assoc = [...store.match(null, DataFactory.namedNode(`${PROV}wasAssociatedWith`), null)];
    expect(assoc.some((q) => q.object.value === ACTOR)).toBe(true);
  });

  it("defaults as:published to now when omitted (still a valid xsd:dateTime)", async () => {
    const ttl = await buildAnnounceTurtle({
      kind: "assignment",
      actorWebId: ACTOR,
      objectIri: ISSUE,
      targetWebId: TARGET,
      summary: "s",
    });
    const store = new Store();
    store.addQuads(new Parser({ format: "text/turtle", baseIRI: `${TARGET_INBOX}y.ttl` }).parse(ttl));
    const n = parseNotification(`${TARGET_INBOX}y.ttl`, store);
    expect(n.published).toBeDefined();
    expect(Number.isNaN(Date.parse(n.published as string))).toBe(false);
  });
});

describe("resolveCollaboratorInbox → inbox discovery is fail-closed", () => {
  it("returns the inbox advertised by the collaborator's own profile", async () => {
    const fetchImpl = fakePod({ profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) } });
    const inbox = await resolveCollaboratorInbox(TARGET, { fetch: fetchImpl, guardOptions: SAFE_GUARD });
    expect(inbox).toBe(TARGET_INBOX);
  });

  it("fails closed (undefined) when the profile advertises NO ldp:inbox", async () => {
    const fetchImpl = fakePod({ profiles: { [TARGET]: profile(TARGET, null) } });
    const inbox = await resolveCollaboratorInbox(TARGET, { fetch: fetchImpl, guardOptions: SAFE_GUARD });
    expect(inbox).toBeUndefined();
  });

  it("REFUSES an inbox pointing at the cloud-metadata address (169.254.169.254)", async () => {
    const fetchImpl = fakePod({
      profiles: { [TARGET]: profile(TARGET, "https://169.254.169.254/inbox/") },
    });
    await expect(
      resolveCollaboratorInbox(TARGET, { fetch: fetchImpl, guardOptions: SAFE_GUARD }),
    ).rejects.toThrow();
  });

  it("REFUSES an inbox on a loopback literal (127.0.0.1)", async () => {
    const fetchImpl = fakePod({ profiles: { [TARGET]: profile(TARGET, "https://127.0.0.1/inbox/") } });
    await expect(
      resolveCollaboratorInbox(TARGET, { fetch: fetchImpl, guardOptions: SAFE_GUARD }),
    ).rejects.toThrow();
  });

  it("REFUSES an inbox on the IPv6 loopback ([::1])", async () => {
    const fetchImpl = fakePod({ profiles: { [TARGET]: profile(TARGET, "https://[::1]/inbox/") } });
    await expect(
      resolveCollaboratorInbox(TARGET, { fetch: fetchImpl, guardOptions: SAFE_GUARD }),
    ).rejects.toThrow();
  });

  it("REFUSES a plain-http inbox (credential-bearing POST must be https)", async () => {
    const fetchImpl = fakePod({ profiles: { [TARGET]: profile(TARGET, "http://bob.example/inbox/") } });
    await expect(
      resolveCollaboratorInbox(TARGET, { fetch: fetchImpl, guardOptions: SAFE_GUARD }),
    ).rejects.toThrow();
  });

  it("REFUSES a cloud-internal metadata NAME (metadata.google.internal)", async () => {
    const fetchImpl = fakePod({
      profiles: { [TARGET]: profile(TARGET, "https://metadata.google.internal/inbox/") },
    });
    await expect(
      resolveCollaboratorInbox(TARGET, { fetch: fetchImpl, guardOptions: SAFE_GUARD }),
    ).rejects.toThrow();
  });

  it("REFUSES dereferencing a WebID that is itself an SSRF target (before any fetch)", async () => {
    const spy = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveCollaboratorInbox("https://169.254.169.254/card#me", {
        fetch: spy,
        guardOptions: SAFE_GUARD,
      }),
    ).rejects.toThrow();
    // The poisoned WebID is refused BEFORE any authenticated request is issued.
    expect(spy).not.toHaveBeenCalled();
  });

  it("REFUSES a WebID that 302-redirects the discovery read to an internal target", async () => {
    // A safe-looking WebID whose profile GET redirects to the cloud-metadata host.
    // The guarded discovery fetch re-validates each hop, so the redirect is refused.
    const fetchImpl = fakePod({
      getRedirects: { [TARGET]: "https://169.254.169.254/card" },
    });
    await expect(
      resolveCollaboratorInbox(TARGET, { fetch: fetchImpl, guardOptions: SAFE_GUARD }),
    ).rejects.toThrow();
  });

  it("FOLLOWS a legitimate same-origin profile redirect during discovery", async () => {
    // WebID doc 302s to the real profile doc on the SAME origin — allowed + followed.
    const realDoc = "https://bob.example/profile/real.ttl";
    const fetchImpl = fakePod({
      getRedirects: { [TARGET]: realDoc },
      profiles: { [realDoc]: profile(TARGET, TARGET_INBOX) },
    });
    const inbox = await resolveCollaboratorInbox(TARGET, { fetch: fetchImpl, guardOptions: SAFE_GUARD });
    expect(inbox).toBe(TARGET_INBOX);
  });

  it("permits an http/loopback inbox UNDER allowLoopback (local-CSS dev topology)", async () => {
    const localWebId = "http://localhost:3000/alice#me";
    const localInbox = "http://localhost:3000/alice/inbox/";
    const fetchImpl = fakePod({ profiles: { [localWebId]: profile(localWebId, localInbox) } });
    const inbox = await resolveCollaboratorInbox(localWebId, {
      fetch: fetchImpl,
      guardOptions: { allowLoopback: true },
    });
    expect(inbox).toBe(localInbox);
  });

  it("REFUSES the same http/loopback WebID under the STRICT default (production)", async () => {
    const localWebId = "http://localhost:3000/alice#me";
    const fetchImpl = fakePod({
      profiles: { [localWebId]: profile(localWebId, "http://localhost:3000/alice/inbox/") },
    });
    await expect(
      resolveCollaboratorInbox(localWebId, { fetch: fetchImpl, guardOptions: {} }),
    ).rejects.toThrow();
  });
});

describe("postToInbox → self-guarding, refuses redirects", () => {
  it("POSTs the notification body to the inbox on success", async () => {
    let seenUrl = "";
    let seenBody = "";
    const fetchImpl = fakePod({
      postStatus: 201,
      onPost: (u, b) => {
        seenUrl = u;
        seenBody = b;
      },
    });
    await postToInbox(TARGET_INBOX, "<> a <x> .", { fetch: fetchImpl, guardOptions: SAFE_GUARD });
    expect(seenUrl).toBe(TARGET_INBOX);
    expect(seenBody).toContain("<> a <x> .");
  });

  it("SSRF-validates its OWN target (never trusts the caller) — refuses an internal host", async () => {
    const onPost = vi.fn();
    const fetchImpl = fakePod({ postStatus: 201, onPost });
    await expect(
      postToInbox("https://169.254.169.254/inbox/", "body", { fetch: fetchImpl, guardOptions: SAFE_GUARD }),
    ).rejects.toThrow();
    expect(onPost).not.toHaveBeenCalled();
  });

  it("REFUSES a 302 redirect on the credentialed POST", async () => {
    const fetchImpl = fakePod({ postStatus: 302, postLocation: "https://evil.example/steal" });
    await expect(
      postToInbox(TARGET_INBOX, "body", { fetch: fetchImpl, guardOptions: SAFE_GUARD }),
    ).rejects.toThrow();
  });

  it("throws AnnounceError on a non-2xx inbox response", async () => {
    const fetchImpl = fakePod({ postStatus: 403 });
    await expect(
      postToInbox(TARGET_INBOX, "body", { fetch: fetchImpl, guardOptions: SAFE_GUARD }),
    ).rejects.toBeInstanceOf(AnnounceError);
  });
});

describe("sendAnnounce → discriminated end-to-end result", () => {
  it("resolves + posts, returning { status: sent }", async () => {
    let posted = "";
    const fetchImpl = fakePod({
      profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) },
      onPost: (_u, b) => {
        posted = b;
      },
    });
    const result = await sendAnnounce(
      { kind: "assignment", actorWebId: ACTOR, objectIri: ISSUE, targetWebId: TARGET, summary: "s" },
      { fetch: fetchImpl, guardOptions: SAFE_GUARD },
    );
    expect(result.status).toBe("sent");
    // A real AS2 Announce body was posted (round-trippable turtle).
    expect(posted).toContain("Announce");
    expect(posted).toContain(ACTOR);
  });

  it("returns { status: no-inbox } (never posts) when none is advertised", async () => {
    const onPost = vi.fn();
    const fetchImpl = fakePod({ profiles: { [TARGET]: profile(TARGET, null) }, onPost });
    const result = await sendAnnounce(
      { kind: "mention", actorWebId: ACTOR, objectIri: ISSUE, targetWebId: TARGET, summary: "s" },
      { fetch: fetchImpl, guardOptions: SAFE_GUARD },
    );
    expect(result.status).toBe("no-inbox");
    expect(onPost).not.toHaveBeenCalled();
  });

  it("returns { status: error, stage: resolve } on an SSRF inbox (no POST)", async () => {
    const onPost = vi.fn();
    const fetchImpl = fakePod({
      profiles: { [TARGET]: profile(TARGET, "https://10.0.0.1/inbox/") },
      onPost,
    });
    const result = await sendAnnounce(
      { kind: "assignment", actorWebId: ACTOR, objectIri: ISSUE, targetWebId: TARGET, summary: "s" },
      { fetch: fetchImpl, guardOptions: SAFE_GUARD },
    );
    expect(result).toMatchObject({ status: "error", stage: "resolve" });
    expect(onPost).not.toHaveBeenCalled();
  });

  it("returns { status: error, stage: post } when the inbox POST is redirected", async () => {
    const fetchImpl = fakePod({
      profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) },
      postStatus: 307,
      postLocation: "https://evil.example/",
    });
    const result = await sendAnnounce(
      { kind: "assignment", actorWebId: ACTOR, objectIri: ISSUE, targetWebId: TARGET, summary: "s" },
      { fetch: fetchImpl, guardOptions: SAFE_GUARD },
    );
    expect(result).toMatchObject({ status: "error", stage: "post" });
  });
});

describe("Announcer → non-blocking, self-skipping, transition-gated, idempotent", () => {
  function announcer(fetchImpl: typeof fetch, extra: { onError?: () => void } = {}) {
    const sent: string[] = [];
    const a = new Announcer({
      actorWebId: ACTOR,
      fetch: fetchImpl,
      guardOptions: SAFE_GUARD,
      onSent: (target) => sent.push(target),
      onError: extra.onError,
    });
    return { a, sent };
  }

  it("announces an assignment to a new, foreign assignee exactly once", async () => {
    const posts: string[] = [];
    const fetchImpl = fakePod({
      profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) },
      onPost: (_u, b) => posts.push(b),
    });
    const { a, sent } = announcer(fetchImpl);
    a.announceAssignment({ issueUrl: ISSUE, issueTitle: "Fix login", assignee: TARGET });
    await vi.waitFor(() => expect(sent).toEqual([TARGET]));
    expect(posts.length).toBe(1);
    expect(posts[0]).toContain(TARGET);
  });

  it("does NOT double-announce the same assignment (idempotent)", async () => {
    const onPost = vi.fn();
    const fetchImpl = fakePod({ profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) }, onPost });
    const { a, sent } = announcer(fetchImpl);
    a.announceAssignment({ issueUrl: ISSUE, assignee: TARGET });
    await vi.waitFor(() => expect(sent).toEqual([TARGET]));
    // A second identical fire (e.g. a re-save / double-click) is a no-op.
    a.announceAssignment({ issueUrl: ISSUE, assignee: TARGET });
    await new Promise((r) => setTimeout(r, 20));
    expect(onPost).toHaveBeenCalledTimes(1);
  });

  it("RE-announces a re-assignment BACK to a prior assignee (transition-keyed, not suppressed)", async () => {
    const other = "https://carol.example/profile/card#me";
    const posts: string[] = [];
    const fetchImpl = fakePod({
      profiles: {
        [TARGET]: profile(TARGET, TARGET_INBOX),
        [other]: profile(other, "https://carol.example/inbox/"),
      },
      onPost: (u) => posts.push(u),
    });
    const { a } = announcer(fetchImpl);
    // Assign TARGET (no prior) → announce.
    a.announceAssignment({ issueUrl: ISSUE, assignee: TARGET });
    await vi.waitFor(() => expect(posts.length).toBe(1));
    // Re-assign to carol (prev TARGET) → announce.
    a.announceAssignment({ issueUrl: ISSUE, assignee: other, previousAssignee: TARGET });
    await vi.waitFor(() => expect(posts.length).toBe(2));
    // Re-assign BACK to TARGET (prev carol) → a DIFFERENT transition than the first,
    // so it is announced again rather than suppressed by a per-assignee key.
    a.announceAssignment({ issueUrl: ISSUE, assignee: TARGET, previousAssignee: other });
    await vi.waitFor(() => expect(posts.length).toBe(3));
  });

  it("does NOT announce when the assignee is UNCHANGED (transition-gated)", async () => {
    const onPost = vi.fn();
    const fetchImpl = fakePod({ profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) }, onPost });
    const { a } = announcer(fetchImpl);
    a.announceAssignment({ issueUrl: ISSUE, assignee: TARGET, previousAssignee: TARGET });
    await new Promise((r) => setTimeout(r, 20));
    expect(onPost).not.toHaveBeenCalled();
  });

  it("does NOT announce when the assignee is CLEARED", async () => {
    const onPost = vi.fn();
    const fetchImpl = fakePod({ profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) }, onPost });
    const { a } = announcer(fetchImpl);
    a.announceAssignment({ issueUrl: ISSUE, assignee: undefined, previousAssignee: TARGET });
    await new Promise((r) => setTimeout(r, 20));
    expect(onPost).not.toHaveBeenCalled();
  });

  it("does NOT notify the acting user when they assign the issue to THEMSELVES", async () => {
    const onPost = vi.fn();
    const fetchImpl = fakePod({ profiles: { [ACTOR]: profile(ACTOR, TARGET_INBOX) }, onPost });
    const { a } = announcer(fetchImpl);
    a.announceAssignment({ issueUrl: ISSUE, assignee: ACTOR });
    await new Promise((r) => setTimeout(r, 20));
    expect(onPost).not.toHaveBeenCalled();
  });

  it("announces each newly-mentioned collaborator once, skipping self + duplicates", async () => {
    const other = "https://carol.example/profile/card#me";
    const posts: string[] = [];
    const fetchImpl = fakePod({
      profiles: {
        [TARGET]: profile(TARGET, TARGET_INBOX),
        [other]: profile(other, "https://carol.example/inbox/"),
      },
      onPost: (u) => posts.push(u),
    });
    const { a, sent } = announcer(fetchImpl);
    // TARGET twice + self (ACTOR) + carol → only TARGET + carol, one each.
    a.announceMentions({ issueUrl: ISSUE, mentions: [TARGET, TARGET, ACTOR, other] });
    await vi.waitFor(() => expect(sent.sort()).toEqual([other, TARGET].sort()));
    expect(posts.length).toBe(2);
  });

  it("RE-notifies a collaborator mentioned again in a LATER comment (mentions are per-comment)", async () => {
    const posts: string[] = [];
    const fetchImpl = fakePod({
      profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) },
      onPost: (u) => posts.push(u),
    });
    const { a } = announcer(fetchImpl);
    // Comment 1 mentions TARGET.
    a.announceMentions({ issueUrl: ISSUE, mentions: [TARGET] });
    await vi.waitFor(() => expect(posts.length).toBe(1));
    // Comment 2 on the SAME issue mentions TARGET again → a SECOND notification
    // (a mention is a per-comment event, not a durable per-issue state).
    a.announceMentions({ issueUrl: ISSUE, mentions: [TARGET] });
    await vi.waitFor(() => expect(posts.length).toBe(2));
  });

  it("surfaces a notify FAILURE via onError WITHOUT throwing (non-blocking)", async () => {
    const onError = vi.fn();
    const fetchImpl = fakePod({ profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) }, postStatus: 500 });
    const { a } = announcer(fetchImpl, { onError });
    // Fire-and-forget: the call returns void synchronously and never throws — so a
    // caller's assignment write is unaffected by a notify failure.
    expect(a.announceAssignment({ issueUrl: ISSUE, assignee: TARGET })).toBeUndefined();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  });

  it("allows a retry after a genuine failure, but never after a success", async () => {
    // First: POST fails (500) → key released → onError.
    const onError = vi.fn();
    let status = 500;
    const posts: string[] = [];
    const fetchImpl = fakePod({ profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) } });
    // Swap postStatus dynamically via a wrapper (GETs delegate to the fake pod).
    const dynamic = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        posts.push(String(input));
        return new Response(null, { status });
      }
      return fetchImpl(input, init);
    }) as typeof fetch;
    const a = new Announcer({ actorWebId: ACTOR, fetch: dynamic, guardOptions: SAFE_GUARD, onError });
    a.announceAssignment({ issueUrl: ISSUE, assignee: TARGET });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(posts.length).toBe(1);
    // Retry now succeeds.
    status = 201;
    a.announceAssignment({ issueUrl: ISSUE, assignee: TARGET });
    await vi.waitFor(() => expect(posts.length).toBe(2));
    // A THIRD identical fire after success is deduped (no more posts).
    a.announceAssignment({ issueUrl: ISSUE, assignee: TARGET });
    await new Promise((r) => setTimeout(r, 20));
    expect(posts.length).toBe(2);
  });
});

describe("defaultSummary", () => {
  it("names the issue when a title is given", () => {
    expect(defaultSummary("assignment", "Fix login")).toBe('You were assigned to "Fix login"');
    expect(defaultSummary("mention", "Fix login")).toBe('You were mentioned in "Fix login"');
  });
  it("falls back cleanly with no title", () => {
    expect(defaultSummary("assignment")).toBe("You were assigned to an issue");
    expect(defaultSummary("mention")).toBe("You were mentioned in a comment");
  });
});
