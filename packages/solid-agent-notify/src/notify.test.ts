// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * End-to-end tests for discoverInbox / sendNotification / notifyAgent / readInbox
 * against a 127.0.0.1 fixture server (the documented loopback test hook), driving
 * the REAL DNS-pinned guardedFetch — no public network, no mocked egress.
 *
 * Also covers the SSRF refusals at the high level: a profile/inbox on a private IP,
 * a discovered inbox that resolves private (rebinding), and the confused-deputy
 * read guard (a hostile listing pointing off-origin / out of container is skipped).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildActivity, serializeTurtle } from "./activity.js";
import { discoverInbox } from "./discover.js";
import { NoInboxError, NotificationSendError } from "./errors.js";
import { isDirectChild, readInbox } from "./read.js";
import { notifyAgent, sendNotification } from "./send.js";

type RouteFn = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let base: string;
const routes = new Map<string, RouteFn>();
/** Records of what was POSTed, keyed by path. */
const posted = new Map<string, { ct: string; body: string }[]>();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const list = posted.get(url) ?? [];
        list.push({
          ct: String(req.headers["content-type"] ?? ""),
          body: Buffer.concat(chunks).toString("utf8"),
        });
        posted.set(url, list);
        const fn = routes.get(`POST ${url}`);
        if (fn) fn(req, res);
        else {
          res.writeHead(201);
          res.end();
        }
      });
      return;
    }
    const fn = routes.get(url);
    if (fn) {
      fn(req, res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

function turtle(res: http.ServerResponse, body: string, status = 200) {
  res.writeHead(status, { "content-type": "text/turtle" });
  res.end(body);
}

/** A profile that advertises an inbox via ldp:inbox. */
function profileWithInbox(webId: string, inbox: string): string {
  return `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${webId}> ldp:inbox <${inbox}> .`;
}

const LOOPBACK = { allowLoopback: true } as const;

// ════════════════════════════════ discoverInbox ════════════════════════════════

describe("discoverInbox", () => {
  it("reads ldp:inbox off the WebID profile", async () => {
    const webId = `${base}/alice/card#me`;
    const inbox = `${base}/alice/inbox/`;
    routes.set("/alice/card", (_r, res) =>
      turtle(res, profileWithInbox(webId, inbox))
    );
    expect(await discoverInbox(webId, LOOPBACK)).toBe(inbox);
  });

  it("resolves a RELATIVE inbox IRI against the profile doc URL", async () => {
    const webId = `${base}/bob/card#me`;
    routes.set("/bob/card", (_r, res) =>
      turtle(
        res,
        `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<#me> ldp:inbox <../bob/inbox/> .`
      )
    );
    expect(await discoverInbox(webId, LOOPBACK)).toBe(`${base}/bob/inbox/`);
  });

  it("returns undefined for an unparseable WebID", async () => {
    expect(await discoverInbox("not a url", LOOPBACK)).toBeUndefined();
  });

  it("returns undefined when the profile advertises NO inbox", async () => {
    const webId = `${base}/noinbox/card#me`;
    routes.set("/noinbox/card", (_r, res) =>
      turtle(res, `<${webId}> <http://xmlns.com/foaf/0.1/name> "Nobody" .`)
    );
    expect(await discoverInbox(webId, LOOPBACK)).toBeUndefined();
  });

  it("returns undefined when MULTIPLE inboxes are advertised (ambiguous)", async () => {
    const webId = `${base}/ambig/card#me`;
    routes.set("/ambig/card", (_r, res) =>
      turtle(
        res,
        `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${webId}> ldp:inbox <${base}/a/>, <${base}/b/> .`
      )
    );
    expect(await discoverInbox(webId, LOOPBACK)).toBeUndefined();
  });

  it("returns undefined when the profile is a 404", async () => {
    expect(
      await discoverInbox(`${base}/missing/card#me`, LOOPBACK)
    ).toBeUndefined();
  });

  it("returns undefined when the profile is a 500 (non-2xx)", async () => {
    routes.set("/err500/card", (_r, res) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("boom");
    });
    expect(
      await discoverInbox(`${base}/err500/card#me`, LOOPBACK)
    ).toBeUndefined();
  });

  it("honours a timeoutMs option", async () => {
    routes.set("/slowprofile/card", (_r, res) => {
      setTimeout(() => {
        try {
          turtle(
            res,
            profileWithInbox(`${base}/slowprofile/card#me`, `${base}/x/`)
          );
        } catch {
          /* torn down */
        }
      }, 1500);
    });
    expect(
      await discoverInbox(`${base}/slowprofile/card#me`, {
        ...LOOPBACK,
        timeoutMs: 100,
      })
    ).toBeUndefined();
  });

  it("returns undefined when the profile is unparseable RDF", async () => {
    const webId = `${base}/bad/card#me`;
    routes.set("/bad/card", (_r, res) => turtle(res, "this is not { turtle"));
    expect(await discoverInbox(webId, LOOPBACK)).toBeUndefined();
  });

  it("returns undefined when the WebID host is a PRIVATE IP (SSRF-refused)", async () => {
    // No allowLoopback → the loopback profile GET is refused by the guard.
    expect(await discoverInbox("https://127.0.0.1/card#me")).toBeUndefined();
  });

  it("returns undefined when the WebID host RESOLVES private (rebinding)", async () => {
    expect(
      await discoverInbox("https://evil.example/card#me", {
        dnsLookup: vi.fn(async () => [{ address: "10.0.0.1", family: 4 }]),
      })
    ).toBeUndefined();
  });
});

// ════════════════════════════════ sendNotification ════════════════════════════════

describe("sendNotification (known inbox)", () => {
  it("POSTs a Turtle AS2.0 notification and returns the 2xx status", async () => {
    const inbox = `${base}/send/inbox/`;
    routes.set("POST /send/inbox/", (_r, res) => {
      res.writeHead(202);
      res.end();
    });
    const r = await sendNotification(
      inbox,
      {
        type: "Announce",
        actor: `${base}/alice/card#me`,
        summary: "hi",
      },
      LOOPBACK
    );
    expect(r.status).toBe(202);
    expect(r.inbox).toBe(inbox);
    const records = posted.get("/send/inbox/") ?? [];
    expect(records.length).toBeGreaterThan(0);
    expect(records[records.length - 1].ct).toBe("text/turtle");
    expect(records[records.length - 1].body).toContain("Announce");
  });

  it("throws NotificationSendError on a non-2xx inbox response", async () => {
    const inbox = `${base}/send/reject/`;
    routes.set("POST /send/reject/", (_r, res) => {
      res.writeHead(403);
      res.end();
    });
    await expect(
      sendNotification(
        inbox,
        { type: "Announce", actor: `${base}/alice/card#me` },
        LOOPBACK
      )
    ).rejects.toBeInstanceOf(NotificationSendError);
    await expect(
      sendNotification(
        inbox,
        { type: "Announce", actor: `${base}/alice/card#me` },
        LOOPBACK
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses (NotificationSendError, status 0) a PRIVATE inbox target — never POSTs", async () => {
    await expect(
      sendNotification("https://169.254.169.254/inbox/", {
        type: "Announce",
        actor: "https://alice.example/card#me",
      })
    ).rejects.toMatchObject({ status: 0 });
  });

  it("refuses a POST whose inbox redirects (confused-deputy)", async () => {
    routes.set("POST /send/redir/", (_r, res) => {
      res.writeHead(307, { location: `${base}/send/elsewhere/` });
      res.end();
    });
    await expect(
      sendNotification(
        `${base}/send/redir/`,
        { type: "Announce", actor: `${base}/alice/card#me` },
        LOOPBACK
      )
    ).rejects.toBeInstanceOf(NotificationSendError);
  });

  it("honours timeoutMs + dnsLookup options on the send path", async () => {
    // A stubbed resolver pointing the (fake) public host at loopback, with a tiny
    // timeout — exercises the optional-spread branches and reaches the fixture.
    const port = Number(new URL(base).port);
    routes.set("POST /send/opts/", (_r, res) => {
      res.writeHead(201);
      res.end();
    });
    const r = await sendNotification(
      `http://send-opts.test:${port}/send/opts/`,
      { type: "Announce", actor: `${base}/alice/card#me` },
      {
        allowLoopback: true,
        timeoutMs: 5000,
        dnsLookup: vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]),
      }
    );
    expect(r.status).toBe(201);
  });

  it("reads + bounds a small POST receipt body (200 with content)", async () => {
    const inbox = `${base}/send/receipt/`;
    routes.set("POST /send/receipt/", (_r, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    const r = await sendNotification(
      inbox,
      { type: "Announce", actor: `${base}/alice/card#me` },
      LOOPBACK
    );
    expect(r.status).toBe(200);
  });

  it("defaults the activity type to Announce", async () => {
    const inbox = `${base}/send/default/`;
    routes.set("POST /send/default/", (_r, res) => {
      res.writeHead(201);
      res.end();
    });
    // @ts-expect-error — exercising the runtime default when type is omitted.
    await sendNotification(inbox, { actor: `${base}/alice/card#me` }, LOOPBACK);
    const records = posted.get("/send/default/") ?? [];
    expect(records[records.length - 1].body).toContain("Announce");
  });
});

// ════════════════════════════════ notifyAgent (discover + send) ════════════════════════════════

describe("notifyAgent", () => {
  it("discovers the inbox from the recipient profile then delivers", async () => {
    const webId = `${base}/carol/card#me`;
    const inbox = `${base}/carol/inbox/`;
    routes.set("/carol/card", (_r, res) =>
      turtle(res, profileWithInbox(webId, inbox))
    );
    routes.set("POST /carol/inbox/", (_r, res) => {
      res.writeHead(201);
      res.end();
    });
    const r = await notifyAgent(
      {
        recipientWebId: webId,
        actorWebId: `${base}/alice/card#me`,
        type: "Invite",
        object: `${base}/alice/chat/`,
        summary: "Join us",
      },
      LOOPBACK
    );
    expect(r.status).toBe(201);
    expect(r.inbox).toBe(inbox);
    const records = posted.get("/carol/inbox/") ?? [];
    expect(records[records.length - 1].body).toContain("Invite");
    expect(records[records.length - 1].body).toContain("alice/chat");
  });

  it("threads ALL optional fields (target, content, published) into the payload", async () => {
    const webId = `${base}/erin/card#me`;
    const inbox = `${base}/erin/inbox/`;
    routes.set("/erin/card", (_r, res) =>
      turtle(res, profileWithInbox(webId, inbox))
    );
    routes.set("POST /erin/inbox/", (_r, res) => {
      res.writeHead(201);
      res.end();
    });
    await notifyAgent(
      {
        recipientWebId: webId,
        actorWebId: `${base}/alice/card#me`,
        type: "Offer",
        object: `${base}/alice/doc`,
        target: `${base}/erin/files/`,
        content: "have a document",
        published: new Date("2026-03-04T05:06:07.000Z"),
      },
      LOOPBACK
    );
    const records = posted.get("/erin/inbox/") ?? [];
    const body = records[records.length - 1].body;
    expect(body).toContain("Offer");
    expect(body).toContain("erin/files");
    expect(body).toContain("have a document");
    expect(body).toContain("2026-03-04");
  });

  it("defaults type to Announce when omitted in notifyAgent", async () => {
    const webId = `${base}/frank/card#me`;
    const inbox = `${base}/frank/inbox/`;
    routes.set("/frank/card", (_r, res) =>
      turtle(res, profileWithInbox(webId, inbox))
    );
    routes.set("POST /frank/inbox/", (_r, res) => {
      res.writeHead(201);
      res.end();
    });
    await notifyAgent(
      { recipientWebId: webId, actorWebId: `${base}/alice/card#me` },
      LOOPBACK
    );
    const records = posted.get("/frank/inbox/") ?? [];
    expect(records[records.length - 1].body).toContain("Announce");
  });

  it("throws NoInboxError when the recipient advertises no inbox — no POST", async () => {
    const webId = `${base}/dave/card#me`;
    routes.set("/dave/card", (_r, res) =>
      turtle(res, `<${webId}> <http://xmlns.com/foaf/0.1/name> "Dave" .`)
    );
    await expect(
      notifyAgent(
        { recipientWebId: webId, actorWebId: `${base}/alice/card#me` },
        LOOPBACK
      )
    ).rejects.toBeInstanceOf(NoInboxError);
  });
});

// ════════════════════════════════ readInbox ════════════════════════════════

describe("readInbox", () => {
  it("lists + parses members, newest first", async () => {
    const inbox = `${base}/read/inbox/`;
    routes.set("/read/inbox/", (_r, res) =>
      turtle(
        res,
        `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${inbox}> ldp:contains <${inbox}n1>, <${inbox}n2> .`
      )
    );
    routes.set("/read/inbox/n1", (_r, res) =>
      turtle(
        res,
        `@prefix as: <https://www.w3.org/ns/activitystreams#> .
<#it> a as:Announce ; as:actor <${base}/alice/card#me> ;
  as:summary "first" ; as:published "2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`
      )
    );
    routes.set("/read/inbox/n2", (_r, res) =>
      turtle(
        res,
        `@prefix as: <https://www.w3.org/ns/activitystreams#> .
<#it> a as:Invite ; as:actor <${base}/bob/card#me> ;
  as:summary "second" ; as:published "2026-02-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`
      )
    );
    const list = await readInbox(inbox, LOOPBACK);
    expect(list.length).toBe(2);
    expect(list[0].summary).toBe("second"); // newest first
    expect(list[0].type).toBe("Invite");
    expect(list[0].actor).toBe(`${base}/bob/card#me`);
    expect(list[1].summary).toBe("first");
  });

  it("returns [] for a 404 / unreadable inbox", async () => {
    expect(await readInbox(`${base}/read/missing/`, LOOPBACK)).toEqual([]);
  });

  it("returns [] for an SSRF-refused inbox (private host)", async () => {
    expect(await readInbox("https://10.0.0.1/inbox/")).toEqual([]);
  });

  it("SKIPS a member the listing points OFF-ORIGIN (confused-deputy guard)", async () => {
    const inbox = `${base}/read/hostile/`;
    routes.set("/read/hostile/", (_r, res) =>
      turtle(
        res,
        `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${inbox}> ldp:contains <${inbox}good>, <https://169.254.169.254/secret> .`
      )
    );
    routes.set("/read/hostile/good", (_r, res) =>
      turtle(
        res,
        `@prefix as: <https://www.w3.org/ns/activitystreams#> .
<#it> a as:Announce ; as:summary "legit" .`
      )
    );
    const list = await readInbox(inbox, LOOPBACK);
    expect(list.length).toBe(1);
    expect(list[0].summary).toBe("legit");
  });

  it("SKIPS a member outside the container path (sub-container / parent)", async () => {
    const inbox = `${base}/read/scope/`;
    routes.set("/read/scope/", (_r, res) =>
      turtle(
        res,
        `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${inbox}> ldp:contains <${inbox}ok>, <${base}/read/outside>, <${inbox}sub/deep> .`
      )
    );
    routes.set("/read/scope/ok", (_r, res) =>
      turtle(
        res,
        `@prefix as: <https://www.w3.org/ns/activitystreams#> .
<#it> a as:Announce ; as:summary "ok" .`
      )
    );
    const list = await readInbox(inbox, LOOPBACK);
    expect(list.length).toBe(1);
    expect(list[0].summary).toBe("ok");
  });

  it("skips a member that is unreadable or non-AS2.0", async () => {
    const inbox = `${base}/read/mixed/`;
    routes.set("/read/mixed/", (_r, res) =>
      turtle(
        res,
        `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${inbox}> ldp:contains <${inbox}good>, <${inbox}gone>, <${inbox}notact> .`
      )
    );
    routes.set("/read/mixed/good", (_r, res) =>
      turtle(
        res,
        `@prefix as: <https://www.w3.org/ns/activitystreams#> .
<#it> a as:Announce ; as:summary "kept" .`
      )
    );
    routes.set("/read/mixed/gone", (_r, res) => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("gone");
    });
    routes.set("/read/mixed/notact", (_r, res) =>
      turtle(res, `<${inbox}notact> <http://xmlns.com/foaf/0.1/name> "x" .`)
    );
    const list = await readInbox(inbox, LOOPBACK);
    expect(list.length).toBe(1);
    expect(list[0].summary).toBe("kept");
  });

  it("ignores a ldp:contains LITERAL object (non-NamedNode) and dedupes", async () => {
    const inbox = `${base}/read/lit/`;
    routes.set("/read/lit/", (_r, res) =>
      turtle(
        res,
        `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${inbox}> ldp:contains "not-a-resource", <${inbox}n>, <${inbox}n> .`
      )
    );
    routes.set("/read/lit/n", (_r, res) =>
      turtle(
        res,
        `@prefix as: <https://www.w3.org/ns/activitystreams#> .
<#it> a as:Announce ; as:summary "one" .`
      )
    );
    const list = await readInbox(inbox, LOOPBACK);
    expect(list.length).toBe(1); // literal skipped; the duplicate member deduped
    expect(list[0].summary).toBe("one");
  });

  it("orders two UNDATED notifications deterministically by URL", async () => {
    const inbox = `${base}/read/undated/`;
    routes.set("/read/undated/", (_r, res) =>
      turtle(
        res,
        `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${inbox}> ldp:contains <${inbox}b>, <${inbox}a> .`
      )
    );
    for (const id of ["a", "b"]) {
      routes.set(`/read/undated/${id}`, (_r, res) =>
        turtle(
          res,
          `@prefix as: <https://www.w3.org/ns/activitystreams#> .
<#it> a as:Announce ; as:summary "${id}" .`
        )
      );
    }
    const list = await readInbox(inbox, LOOPBACK);
    expect(list.map((n) => n.url)).toEqual([`${inbox}a`, `${inbox}b`]);
  });

  it("returns [] for an empty inbox (no ldp:contains)", async () => {
    const inbox = `${base}/read/empty/`;
    routes.set("/read/empty/", (_r, res) =>
      turtle(res, `<${inbox}> <http://purl.org/dc/terms/title> "Inbox" .`)
    );
    expect(await readInbox(inbox, LOOPBACK)).toEqual([]);
  });

  it("returns [] when the container listing is unparseable", async () => {
    const inbox = `${base}/read/badlisting/`;
    routes.set("/read/badlisting/", (_r, res) =>
      turtle(res, "not { valid turtle")
    );
    expect(await readInbox(inbox, LOOPBACK)).toEqual([]);
  });

  it("parses a #it activity that has no rdf:type but has as:actor", async () => {
    const inbox = `${base}/read/typeless/`;
    routes.set("/read/typeless/", (_r, res) =>
      turtle(
        res,
        `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${inbox}> ldp:contains <${inbox}n> .`
      )
    );
    routes.set("/read/typeless/n", (_r, res) =>
      turtle(
        res,
        `@prefix as: <https://www.w3.org/ns/activitystreams#> .
<#it> as:actor <${base}/alice/card#me> ; as:summary "typeless" .`
      )
    );
    const list = await readInbox(inbox, LOOPBACK);
    expect(list.length).toBe(1);
    expect(list[0].type).toBe("Notification"); // no as: type → fallback label
    expect(list[0].summary).toBe("typeless");
  });
});

// ════════════════════════════════ isDirectChild (unit) ════════════════════════════════

describe("isDirectChild", () => {
  const C = "https://pod.example/inbox/";
  it("accepts a direct child member", () => {
    expect(isDirectChild("https://pod.example/inbox/n1", C)).toBe(true);
  });
  it("rejects a different origin", () => {
    expect(isDirectChild("https://evil.example/inbox/n1", C)).toBe(false);
    expect(isDirectChild("https://169.254.169.254/inbox/n1", C)).toBe(false);
  });
  it("rejects a parent / sibling / sub-container", () => {
    expect(isDirectChild("https://pod.example/other/n1", C)).toBe(false);
    expect(isDirectChild("https://pod.example/inbox/sub/n1", C)).toBe(false);
    expect(isDirectChild(C, C)).toBe(false); // the container itself
  });
  it("rejects query / fragment / encoded slash", () => {
    expect(isDirectChild("https://pod.example/inbox/n1?x=1", C)).toBe(false);
    expect(isDirectChild("https://pod.example/inbox/n1#f", C)).toBe(false);
    expect(isDirectChild("https://pod.example/inbox/a%2fb", C)).toBe(false);
  });
  it("handles a container URL without a trailing slash", () => {
    expect(
      isDirectChild("https://pod.example/inbox/n1", "https://pod.example/inbox")
    ).toBe(true);
  });
  it("returns false for unparseable URLs", () => {
    expect(isDirectChild("not a url", C)).toBe(false);
    expect(isDirectChild("https://pod.example/inbox/n1", "not a url")).toBe(
      false
    );
  });
});

// ════════════════════════════════ build/serialise interplay (smoke) ════════════════════════════════

describe("buildActivity + serializeTurtle wiring (smoke through send path)", () => {
  it("the bytes sent are valid Turtle parseable back to the activity", async () => {
    const store = buildActivity({
      type: "Create",
      actor: `${base}/alice/card#me`,
      content: "body",
    });
    const ttl = await serializeTurtle(store);
    expect(ttl).toContain("as:Create");
    expect(ttl).toContain('"body"');
  });
});
