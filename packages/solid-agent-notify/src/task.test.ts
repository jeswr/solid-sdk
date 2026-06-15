// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Tests for the shared federation TASK model (https://w3id.org/jeswr/task):
 * the typed wf:Task accessors (build + read), the task-notification round-trip
 * (an as:Announce carrying an embedded wf:Task), and the discover+deliver task
 * helpers (notifyTaskAssigned / notifyTaskStateChanged) against a 127.0.0.1
 * fixture driving the REAL DNS-pinned guardedFetch — no public network.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serializeTurtle } from "./activity.js";
import { NoInboxError } from "./errors.js";
import { findActivitySubject } from "./read.js";
import {
  TaskDoc,
  buildTaskNotification,
  notifyTaskAssigned,
  notifyTaskStateChanged,
  parseTask,
  parseTaskFromNotification,
  writeTask,
} from "./task.js";

const WF = "http://www.w3.org/2005/01/wf/flow#";
const DCT = "http://purl.org/dc/terms/";
const ALICE = "https://alice.example/card#me";
const BOB = "https://bob.example/card#me";
const TASK_IRI = "https://alice.example/tasks/42#it";

// ──────────────────────────── TaskDoc (typed accessors) ────────────────────────────

describe("TaskDoc + writeTask", () => {
  it("writes the full wf:Task shape via typed accessors", () => {
    const created = new Date("2026-02-03T04:05:06.000Z");
    const store = writeTask(new Store(), {
      task: TASK_IRI,
      state: "Open",
      title: "Fix the login bug",
      description: "Users cannot log in on Safari.",
      assignee: BOB,
      creator: ALICE,
      created,
    });
    const doc = new TaskDoc(TASK_IRI, store, DataFactory);
    expect(doc.types.has(`${WF}Task`)).toBe(true);
    expect(doc.state).toBe("Open");
    expect(doc.title).toBe("Fix the login bug");
    expect(doc.description).toBe("Users cannot log in on Safari.");
    expect(doc.assignee).toBe(BOB);
    expect(doc.creator).toBe(ALICE);
    expect(doc.created?.toISOString()).toBe(created.toISOString());
  });

  it("defaults state to Open and created to now", () => {
    const before = Date.now();
    const store = writeTask(new Store(), { task: TASK_IRI });
    const doc = new TaskDoc(TASK_IRI, store, DataFactory);
    expect(doc.state).toBe("Open");
    const ts = doc.created?.getTime() ?? 0;
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("setState is exclusive — Open XOR Closed, never both", () => {
    const store = new Store();
    const doc = new TaskDoc(TASK_IRI, store, DataFactory).markTask();
    doc.setState("Open");
    expect(doc.state).toBe("Open");
    doc.setState("Closed");
    expect(doc.state).toBe("Closed");
    expect(doc.types.has(`${WF}Open`)).toBe(false);
    expect(doc.types.has(`${WF}Closed`)).toBe(true);
    // The wf:Task type survives a state flip.
    expect(doc.types.has(`${WF}Task`)).toBe(true);
  });

  it("state is undefined when no wf:Open/wf:Closed type is present", () => {
    const store = new Store();
    new TaskDoc(TASK_IRI, store, DataFactory).markTask();
    expect(new TaskDoc(TASK_IRI, store, DataFactory).state).toBeUndefined();
  });

  it("NEVER coerces a non-http assignee/creator into a NamedNode", () => {
    const store = writeTask(new Store(), {
      task: TASK_IRI,
      assignee: "not a webid",
      creator: "mailto:x@y.com",
    });
    const doc = new TaskDoc(TASK_IRI, store, DataFactory);
    expect(doc.assignee).toBeUndefined();
    expect(doc.creator).toBeUndefined();
  });

  it("drops empty/whitespace title + description", () => {
    const store = writeTask(new Store(), {
      task: TASK_IRI,
      title: "   ",
      description: "",
    });
    const doc = new TaskDoc(TASK_IRI, store, DataFactory);
    expect(doc.title).toBeUndefined();
    expect(doc.description).toBeUndefined();
  });

  it("throws on a non-http(s) task IRI (cannot be a wf:Task subject NamedNode)", () => {
    expect(() => writeTask(new Store(), { task: "urn:uuid:1234" })).toThrow(
      TypeError
    );
  });
});

// ──────────────────────── buildTaskNotification + parse round-trip ────────────────────────

describe("buildTaskNotification + parseTaskFromNotification", () => {
  it("embeds the wf:Task as the activity's as:object and round-trips through Turtle", async () => {
    const created = new Date("2026-03-04T05:06:07.000Z");
    const published = new Date("2026-03-04T05:06:09.000Z");
    const store = buildTaskNotification(
      {
        task: TASK_IRI,
        state: "Open",
        title: "Review the PR",
        description: "Check the SSRF guard tests.",
        assignee: BOB,
        creator: ALICE,
        created,
      },
      {
        actor: ALICE,
        summary: "A task was assigned to you",
        target: "https://alice.example/project/",
        content: "Longer body of the announcement.",
        published,
      }
    );
    const ttl = await serializeTurtle(store);
    // It is a single dataset carrying BOTH the activity and the task.
    expect(ttl).toContain("Announce");
    expect(ttl).toContain(`${WF}Task`); // the absolute wf:Task class IRI is present
    expect(ttl).toContain(TASK_IRI);
    expect(ttl).toContain("Review the PR");

    const ds = await parseRdf(ttl, "text/turtle", {
      baseIRI: "https://x.example/n",
    });
    const subject = findActivitySubject("https://x.example/n", ds);
    if (subject === undefined) throw new Error("expected an activity subject");
    const task = parseTaskFromNotification(subject, ds);
    expect(task).toEqual({
      task: TASK_IRI,
      state: "Open",
      title: "Review the PR",
      description: "Check the SSRF guard tests.",
      assignee: BOB,
      creator: ALICE,
      created,
    });
  });

  it("defaults the activity verb to Announce", async () => {
    const store = buildTaskNotification({ task: TASK_IRI }, { actor: ALICE });
    const ttl = await serializeTurtle(store);
    expect(ttl).toContain("Announce");
  });

  it("parseTaskFromNotification returns undefined when the activity has no object", async () => {
    // An activity with no as:object → nothing to follow to a task.
    const ds = await parseRdf(
      `@prefix as: <https://www.w3.org/ns/activitystreams#> .
       <https://x.example/n#it> a as:Announce ; as:actor <${ALICE}> .`,
      "text/turtle",
      { baseIRI: "https://x.example/n" }
    );
    expect(
      parseTaskFromNotification("https://x.example/n#it", ds)
    ).toBeUndefined();
  });

  it("parseTask returns undefined for a subject that is not a wf:Task", async () => {
    const ds = await parseRdf(
      `<${TASK_IRI}> <${DCT}title> "Not a task" .`,
      "text/turtle",
      { baseIRI: "https://alice.example/tasks/42" }
    );
    expect(parseTask(TASK_IRI, ds)).toBeUndefined();
  });

  it("parseTask reads a minimal wf:Task carrying only the type (no state/created)", async () => {
    const ds = await parseRdf(`<${TASK_IRI}> a <${WF}Task> .`, "text/turtle", {
      baseIRI: "https://alice.example/tasks/42",
    });
    expect(parseTask(TASK_IRI, ds)).toEqual({ task: TASK_IRI });
  });

  // ── fail-closed on hostile / malformed RDF (read path is attacker-influenced) ──

  it("parseTask fails closed (no throw) when rdf:type carries a malformed term", async () => {
    // An rdf:type pointing at a LITERAL makes the typed Set accessor throw; the
    // read path must collapse to undefined, never propagate the term error.
    const ds = await parseRdf(
      `<${TASK_IRI}> a "garbage-type" ; <${DCT}title> "x" .`,
      "text/turtle",
      { baseIRI: "https://alice.example/tasks/42" }
    );
    let task: ReturnType<typeof parseTask>;
    expect(() => {
      task = parseTask(TASK_IRI, ds);
    }).not.toThrow();
    expect(task).toBeUndefined();
  });

  it("parseTask reads a Closed-only task as state Closed", async () => {
    const ds = await parseRdf(
      `<${TASK_IRI}> a <${WF}Task>, <${WF}Closed> .`,
      "text/turtle",
      { baseIRI: "https://alice.example/tasks/42" }
    );
    expect(parseTask(TASK_IRI, ds)?.state).toBe("Closed");
  });

  it("parseTask drops a dct:created typed xsd:dateTime but with an invalid lexical value", async () => {
    const ds = await parseRdf(
      `<${TASK_IRI}> a <${WF}Task> ;
         <${DCT}created> "not-a-real-date"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
      "text/turtle",
      { baseIRI: "https://alice.example/tasks/42" }
    );
    expect(parseTask(TASK_IRI, ds)?.created).toBeUndefined();
  });

  it("parseTask rejects a non-http(s) task subject IRI", async () => {
    const urn = "urn:uuid:1234";
    const ds = await parseRdf(
      `<${urn}> a <${WF}Task> ; <${DCT}title> "x" .`,
      "text/turtle",
      { baseIRI: "https://alice.example/tasks/42" }
    );
    expect(parseTask(urn, ds)).toBeUndefined();
  });

  it("parseTask DROPS a literal/non-http assignee + creator (never returns a bogus WebID)", async () => {
    const ds = await parseRdf(
      `<${TASK_IRI}> a <${WF}Task> ;
         <${WF}assignee> "not-a-webid" ;
         <${DCT}creator> <mailto:x@y.com> .`,
      "text/turtle",
      { baseIRI: "https://alice.example/tasks/42" }
    );
    const task = parseTask(TASK_IRI, ds);
    expect(task).toEqual({ task: TASK_IRI });
    expect(task?.assignee).toBeUndefined();
    expect(task?.creator).toBeUndefined();
  });

  it("parseTask does not throw on a malformed dct:created (drops the field)", async () => {
    const ds = await parseRdf(
      `<${TASK_IRI}> a <${WF}Task> ; <${DCT}created> "not-a-date" .`,
      "text/turtle",
      { baseIRI: "https://alice.example/tasks/42" }
    );
    let task: ReturnType<typeof parseTask>;
    expect(() => {
      task = parseTask(TASK_IRI, ds);
    }).not.toThrow();
    expect(task).toEqual({ task: TASK_IRI });
  });

  it("parseTask OMITS out-of-cardinality single-valued fields (ambiguous → absent, not first-match)", async () => {
    const ds = await parseRdf(
      `<${TASK_IRI}> a <${WF}Task> ;
         <${DCT}title> "first", "second" ;
         <${DCT}description> "d1", "d2" ;
         <${WF}assignee> <https://a.example/card#me>, <https://b.example/card#me> ;
         <${DCT}creator> <https://c.example/card#me>, <https://d.example/card#me> ;
         <${DCT}created> "2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>,
                         "2026-02-02T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
      "text/turtle",
      { baseIRI: "https://alice.example/tasks/42" }
    );
    const task = parseTask(TASK_IRI, ds);
    // Every ambiguous field is dropped — never an arbitrary first value.
    expect(task).toEqual({ task: TASK_IRI });
  });

  it("parseTask reads a single value even when it is stated twice identically", async () => {
    const ds = await parseRdf(
      `<${TASK_IRI}> a <${WF}Task> ; <${DCT}title> "Dup", "Dup" .`,
      "text/turtle",
      { baseIRI: "https://alice.example/tasks/42" }
    );
    expect(parseTask(TASK_IRI, ds)?.title).toBe("Dup");
  });

  it("parseTask treats a task asserting BOTH wf:Open and wf:Closed as ambiguous (state undefined)", async () => {
    // A hostile/malformed graph claiming both states must not let RDF statement
    // order pick the winner — state collapses to undefined (fail-closed).
    const ds = await parseRdf(
      `<${TASK_IRI}> a <${WF}Task>, <${WF}Open>, <${WF}Closed> .`,
      "text/turtle",
      { baseIRI: "https://alice.example/tasks/42" }
    );
    const task = parseTask(TASK_IRI, ds);
    expect(task).toEqual({ task: TASK_IRI });
    expect(task?.state).toBeUndefined();
  });

  it("parseTask drops a dct:created that is a plain (untyped) string literal", async () => {
    // strict: only an explicitly xsd:dateTime/date-typed literal is accepted.
    const ds = await parseRdf(
      `<${TASK_IRI}> a <${WF}Task> ; <${DCT}created> "2026-01-01" .`,
      "text/turtle",
      { baseIRI: "https://alice.example/tasks/42" }
    );
    expect(parseTask(TASK_IRI, ds)?.created).toBeUndefined();
  });

  it("parseTaskFromNotification treats MULTIPLE as:object values as ambiguous (no task)", async () => {
    const ds = await parseRdf(
      `@prefix as: <https://www.w3.org/ns/activitystreams#> .
       @prefix wf: <${WF}> .
       <https://x.example/n#it> a as:Announce ;
         as:object <${TASK_IRI}>, <https://alice.example/tasks/99#it> .
       <${TASK_IRI}> a wf:Task .`,
      "text/turtle",
      { baseIRI: "https://x.example/n" }
    );
    expect(
      parseTaskFromNotification("https://x.example/n#it", ds)
    ).toBeUndefined();
  });

  it("parseTaskFromNotification does not throw on a malformed as:object (no task)", async () => {
    // as:object as a literal — the activityObject accessor would throw; the read
    // path must collapse to undefined.
    const ds = await parseRdf(
      `@prefix as: <https://www.w3.org/ns/activitystreams#> .
       <https://x.example/n#it> a as:Announce ; as:object "not-an-iri" .`,
      "text/turtle",
      { baseIRI: "https://x.example/n" }
    );
    let task: ReturnType<typeof parseTaskFromNotification>;
    expect(() => {
      task = parseTaskFromNotification("https://x.example/n#it", ds);
    }).not.toThrow();
    expect(task).toBeUndefined();
  });
});

// ──────────────── notifyTaskAssigned / notifyTaskStateChanged (discover + send) ────────────────

type RouteFn = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let base: string;
const routes = new Map<string, RouteFn>();
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

const LOOPBACK = { allowLoopback: true } as const;

function profileWithInbox(webId: string, inbox: string): string {
  return `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${webId}> ldp:inbox <${inbox}> .`;
}

describe("notifyTaskAssigned", () => {
  it("discovers the inbox, delivers an Announce carrying the wf:Task, and defaults assignee to the recipient", async () => {
    const webId = `${base}/dave/card#me`;
    const inbox = `${base}/dave/inbox/`;
    routes.set("/dave/card", (_r, res) => {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end(profileWithInbox(webId, inbox));
    });
    routes.set("POST /dave/inbox/", (_r, res) => {
      res.writeHead(201);
      res.end();
    });

    const r = await notifyTaskAssigned(
      {
        recipientWebId: webId,
        actorWebId: ALICE,
        task: { task: TASK_IRI, title: "Ship the SDK" },
        summary: "You have a new task",
      },
      LOOPBACK
    );
    expect(r.status).toBe(201);
    expect(r.inbox).toBe(inbox);

    const records = posted.get("/dave/inbox/") ?? [];
    const body = records[records.length - 1].body;
    expect(records[records.length - 1].ct).toBe("text/turtle");
    expect(body).toContain("Announce");
    expect(body).toContain(TASK_IRI);
    // wf:assignee defaulted to the recipient WebID.
    expect(body).toContain(webId);
    expect(body).toContain("assignee");
  });

  it("keeps an explicit assignee over the recipient default", async () => {
    const webId = `${base}/erin/card#me`;
    const inbox = `${base}/erin/inbox/`;
    routes.set("/erin/card", (_r, res) => {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end(profileWithInbox(webId, inbox));
    });
    routes.set("POST /erin/inbox/", (_r, res) => {
      res.writeHead(201);
      res.end();
    });
    await notifyTaskAssigned(
      {
        recipientWebId: webId,
        actorWebId: ALICE,
        task: { task: TASK_IRI, assignee: BOB },
      },
      LOOPBACK
    );
    const body = (posted.get("/erin/inbox/") ?? []).at(-1)?.body ?? "";
    expect(body).toContain(BOB);
  });

  it("COMPOSES a caller-supplied opts.extend (never drops it) after embedding the task", async () => {
    const webId = `${base}/judy/card#me`;
    const inbox = `${base}/judy/inbox/`;
    routes.set("/judy/card", (_r, res) => {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end(profileWithInbox(webId, inbox));
    });
    routes.set("POST /judy/inbox/", (_r, res) => {
      res.writeHead(201);
      res.end();
    });
    let sawTask = false;
    const marker = "https://example.test/marker";
    await notifyTaskAssigned(
      {
        recipientWebId: webId,
        actorWebId: ALICE,
        task: { task: TASK_IRI, title: "Compose" },
      },
      {
        ...LOOPBACK,
        // The caller's own augmentation must still run — and see the task already
        // embedded (writeTask runs first). ASYNC: the send path must AWAIT it, so
        // the marker triple it adds after a tick still reaches the wire.
        extend: async (store) => {
          sawTask = new TaskDoc(TASK_IRI, store, DataFactory).types.has(
            `${WF}Task`
          );
          await Promise.resolve();
          store.addQuad(
            DataFactory.namedNode(TASK_IRI),
            DataFactory.namedNode(`${DCT}subject`),
            DataFactory.namedNode(marker)
          );
        },
      }
    );
    expect(sawTask).toBe(true);
    // The async extend's mutation landed on the POSTed body → it was awaited.
    const body = (posted.get("/judy/inbox/") ?? []).at(-1)?.body ?? "";
    expect(body).toContain(marker);
  });

  it("carries every activity override (type/target/content/published) onto the wire", async () => {
    const webId = `${base}/ivy/card#me`;
    const inbox = `${base}/ivy/inbox/`;
    const published = new Date("2026-04-05T06:07:08.000Z");
    routes.set("/ivy/card", (_r, res) => {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end(profileWithInbox(webId, inbox));
    });
    routes.set("POST /ivy/inbox/", (_r, res) => {
      res.writeHead(201);
      res.end();
    });
    await notifyTaskAssigned(
      {
        recipientWebId: webId,
        actorWebId: ALICE,
        task: { task: TASK_IRI, title: "Triage" },
        type: "Offer",
        target: `${base}/ivy/project/`,
        content: "Please pick this up.",
        published,
      },
      LOOPBACK
    );
    const body = (posted.get("/ivy/inbox/") ?? []).at(-1)?.body ?? "";
    expect(body).toContain("Offer");
    expect(body).toContain(`${base}/ivy/project/`);
    expect(body).toContain("Please pick this up.");
    expect(body).toContain("2026-04-05");
  });

  it("throws NoInboxError when the recipient advertises no inbox", async () => {
    const webId = `${base}/noinbox-task/card#me`;
    routes.set("/noinbox-task/card", (_r, res) => {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end(`<${webId}> <http://xmlns.com/foaf/0.1/name> "Nobody" .`);
    });
    await expect(
      notifyTaskAssigned(
        { recipientWebId: webId, actorWebId: ALICE, task: { task: TASK_IRI } },
        LOOPBACK
      )
    ).rejects.toBeInstanceOf(NoInboxError);
  });

  it("surfaces a NotificationSendError on a non-2xx inbox", async () => {
    const webId = `${base}/frank/card#me`;
    const inbox = `${base}/frank/inbox/`;
    routes.set("/frank/card", (_r, res) => {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end(profileWithInbox(webId, inbox));
    });
    routes.set("POST /frank/inbox/", (_r, res) => {
      res.writeHead(403);
      res.end();
    });
    await expect(
      notifyTaskAssigned(
        { recipientWebId: webId, actorWebId: ALICE, task: { task: TASK_IRI } },
        LOOPBACK
      )
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("notifyTaskStateChanged", () => {
  it("delivers a task at its new lifecycle state", async () => {
    const webId = `${base}/grace/card#me`;
    const inbox = `${base}/grace/inbox/`;
    routes.set("/grace/card", (_r, res) => {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end(profileWithInbox(webId, inbox));
    });
    routes.set("POST /grace/inbox/", (_r, res) => {
      res.writeHead(201);
      res.end();
    });
    const r = await notifyTaskStateChanged(
      {
        recipientWebId: webId,
        actorWebId: ALICE,
        task: { task: TASK_IRI, state: "Open" },
        state: "Closed",
        summary: "Task closed",
      },
      LOOPBACK
    );
    expect(r.status).toBe(201);
    const body = (posted.get("/grace/inbox/") ?? []).at(-1)?.body ?? "";
    // The delivered body must carry the NEW (Closed) state, not the original Open.
    const ds = await parseRdf(body, "text/turtle", { baseIRI: inbox });
    const doc = new TaskDoc(TASK_IRI, ds, DataFactory);
    expect(doc.state).toBe("Closed");
  });

  it("refuses a private recipient inbox (SSRF) — status 0, never POSTs", async () => {
    const webId = `${base}/heidi/card#me`;
    routes.set("/heidi/card", (_r, res) => {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end(profileWithInbox(webId, "https://169.254.169.254/inbox/"));
    });
    await expect(
      notifyTaskStateChanged(
        {
          recipientWebId: webId,
          actorWebId: ALICE,
          task: { task: TASK_IRI },
          state: "Closed",
        },
        LOOPBACK
      )
    ).rejects.toMatchObject({ status: 0 });
  });
});
