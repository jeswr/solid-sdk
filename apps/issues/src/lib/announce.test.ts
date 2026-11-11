// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { Announcer, defaultSummary, sendAnnounce } from "./announce";

const ACTOR = "https://8.8.8.8/profile/card#me";
const TARGET = "https://8.8.4.4/profile/card#me";
const TARGET_INBOX = "https://8.8.4.4/inbox/";
const ISSUE = "https://8.8.8.8/issue-tracker/issues/42.ttl";

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
  pim:storage <https://8.8.4.4/> .`;
}

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
      {
        kind: "assignment",
        actorWebId: ACTOR,
        objectIri: ISSUE,
        targetWebId: TARGET,
        summary: "s",
      },
      { fetch: fetchImpl },
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
      { fetch: fetchImpl },
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
      {
        kind: "assignment",
        actorWebId: ACTOR,
        objectIri: ISSUE,
        targetWebId: TARGET,
        summary: "s",
      },
      { fetch: fetchImpl },
    );
    expect(result).toMatchObject({ status: "error", stage: "post" });
    expect(onPost).not.toHaveBeenCalled();
  });

  it("returns { status: error, stage: post } when the inbox POST is redirected", async () => {
    const fetchImpl = fakePod({
      profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) },
      postStatus: 307,
      postLocation: "https://evil.example/",
    });
    const result = await sendAnnounce(
      {
        kind: "assignment",
        actorWebId: ACTOR,
        objectIri: ISSUE,
        targetWebId: TARGET,
        summary: "s",
      },
      { fetch: fetchImpl },
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
    const other = "https://1.1.1.1/profile/card#me";
    const posts: string[] = [];
    const fetchImpl = fakePod({
      profiles: {
        [TARGET]: profile(TARGET, TARGET_INBOX),
        [other]: profile(other, "https://1.1.1.1/inbox/"),
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
    const other = "https://1.1.1.1/profile/card#me";
    const posts: string[] = [];
    const fetchImpl = fakePod({
      profiles: {
        [TARGET]: profile(TARGET, TARGET_INBOX),
        [other]: profile(other, "https://1.1.1.1/inbox/"),
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
    const fetchImpl = fakePod({
      profiles: { [TARGET]: profile(TARGET, TARGET_INBOX) },
      postStatus: 500,
    });
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
    const a = new Announcer({ actorWebId: ACTOR, fetch: dynamic, onError });
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
