// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  accessRequestTurtle,
  buildPod,
  CONTACTS_CLASS,
  INBOX,
  OWNER,
  POD,
  PREFIXES,
  REQUESTER,
} from "../../test/requests/fixtures.js";
import { members, project } from "./inbox.js";
import {
  ACCM,
  ACL,
  DPV,
  decide,
  deriveGrantId,
  listRequests,
  MAX_MEMBERS,
  MAX_NOTIFICATION_BYTES,
  RequestConflictError,
  UnsupportedAccessModelError,
} from "./index.js";
import { turtle, values } from "./rdf.js";

const ID = `${INBOX}request-1.ttl`;
const ALICE = `${POD}contacts/alice.ttl`;
const CAROL = `${POD}contacts/carol.ttl`;
const RECORDS = `${POD}settings/access-records/`;
const NOW = "2026-11-01T12:00:00.000Z";
function options(pod = buildPod()) {
  return {
    fetch: pod.fetch,
    webId: OWNER,
    storage: POD,
    now: () => new Date(NOW),
    publicFetch: vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch,
  };
}
async function entry(pod: ReturnType<typeof buildPod>) {
  return (await listRequests(options(pod)))[0] as Awaited<ReturnType<typeof listRequests>>[number];
}
async function graph(body: string) {
  return parseRdf(body, "text/turtle");
}
function _throwsFetch(message: string): typeof fetch {
  return async () => {
    throw new Error(message);
  };
}

describe("bounded untrusted inbox", () => {
  it("discovers the owner inbox, projects all metadata locally, and does not read third-party documents", async () => {
    const pod = buildPod();
    pod.seed(
      ID,
      `${accessRequestTurtle(ID)}\n<${REQUESTER}> <http://xmlns.com/foaf/0.1/name> "Reader" .\n<${ID}> <http://purl.org/dc/terms/created> "2026-10-31" .`,
    );
    const list = await listRequests(options(pod));
    expect(list).toEqual([
      expect.objectContaining({
        id: ID,
        status: "pending",
        requester: REQUESTER,
        requesterName: "Reader",
        dataTypes: [CONTACTS_CLASS],
        modes: ["read"],
        purpose: "https://w3id.org/dpv#ServiceProvision",
        expiresAt: "2027-01-01T00:00:00Z",
        created: "2026-10-31",
      }),
    ]);
    expect(pod.log.every(({ url }) => url.startsWith(POD))).toBe(true);
  });

  it("supports a supplied profile or inbox and missing discovery", async () => {
    const pod = buildPod();
    expect(await listRequests({ ...options(pod), profile: new Store() })).toEqual([]);
    pod.delete(`${POD}profile/card`);
    expect(await listRequests(options(pod))).toEqual([]);
    expect(await listRequests({ ...options(pod), inbox: `${POD}missing/` })).toEqual([]);
    expect(await listRequests({ ...options(pod), inbox: INBOX })).toHaveLength(1);
    await expect(
      listRequests({ ...options(pod), inbox: "https://evil.example/" }),
    ).rejects.toThrow();
  });

  it("surfaces malformed, missing, oversized and non-notification members; skips containers and ACLs", async () => {
    const pod = buildPod();
    for (const [file, body] of [
      ["bad", "not turtle @@@"],
      ["large", "#".repeat(MAX_NOTIFICATION_BYTES + 1)],
      ["note", "<urn:note> a <urn:Note>."],
      [
        "unknown",
        accessRequestTurtle(`${INBOX}unknown`) +
          `<${INBOX}unknown> <${ACCM.status}> <urn:unknown>.`,
      ],
    ])
      pod.seed(`${INBOX}${file}`, body);
    pod.seed(`${INBOX}child/one`, "");
    pod.seed(`${INBOX}data.acl`, "");
    const list = await listRequests({ ...options(pod), inbox: INBOX });
    expect(list).toHaveLength(5);
    expect(list.filter((e) => e.status === "unreadable")).toHaveLength(4);
    pod.seed(
      INBOX,
      `<${INBOX}> <http://www.w3.org/ns/ldp#contains> <${INBOX}missing>, <https://evil.example/x>, "bad".`,
    );
    expect(await listRequests({ ...options(pod), inbox: INBOX })).toEqual([
      { id: `${INBOX}missing`, status: "unreadable" },
      { id: "https://evil.example/x", status: "unreadable" },
    ]);
    expect(pod.log.some(({ url }) => url.startsWith("https://evil"))).toBe(false);
  });

  it("caps inbox members and ignores contains statements on unrelated subjects", async () => {
    const pod = buildPod();
    const listing = new Store();
    for (let i = 0; i < MAX_MEMBERS + 2; i++)
      listing.add(
        DataFactory.quad(
          DataFactory.namedNode(INBOX),
          DataFactory.namedNode("http://www.w3.org/ns/ldp#contains"),
          DataFactory.namedNode(`${INBOX}${i}`),
        ),
      );
    listing.add(
      DataFactory.quad(
        DataFactory.namedNode("urn:fake"),
        DataFactory.namedNode("http://www.w3.org/ns/ldp#contains"),
        DataFactory.namedNode(ID),
      ),
    );
    pod.seed(INBOX, await turtle(listing));
    expect(members(listing, INBOX)).toHaveLength(MAX_MEMBERS);
    expect(await listRequests({ ...options(pod), inbox: INBOX })).toHaveLength(MAX_MEMBERS);
  });

  it("maps append and duration, accepts literal purpose, and survives malformed policy fields", async () => {
    const url = `${INBOX}append`;
    const body = accessRequestTurtle(url)
      .replace("odrl:read", `<${ACL.Append}>`)
      .replace("odrl:dateTime", "odrl:elapsedTime");
    const parsed = project(url, await graph(body), null);
    expect(parsed.entry).toMatchObject({
      modes: ["append"],
      requestedDuration: "2027-01-01T00:00:00Z",
    });
    expect(
      project(
        url,
        await graph(accessRequestTurtle(url).replace(`<${REQUESTER}>`, "<urn:agent>")),
        null,
      ).entry.status,
    ).toBe("unreadable");
    expect(
      project(
        url,
        await graph(accessRequestTurtle(url).replace("odrl:read", "<urn:unknown>")),
        null,
      ).entry.status,
    ).toBe("unreadable");
  });

  it("propagates cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(listRequests({ ...options(), signal: controller.signal })).rejects.toThrow();
  });
});

describe("decision state machine", () => {
  it("pins targets before the CAS; creates deterministic records before ACLs and final state", async () => {
    const pod = buildPod();
    const writes: { url: string; headers: Headers; body: string }[] = [];
    pod.intercept = (method, url, init) => {
      if (method === "PUT")
        writes.push({ url, headers: new Headers(init?.headers), body: String(init?.body) });
    };
    const result = await decide(
      await entry(pod),
      { approve: true, role: "viewer", expiresAt: new Date("2027-01-01Z") },
      options(pod),
    );
    expect(result).toMatchObject({ status: "approved", notified: false, expiryEnforced: false });
    // The owner-only records folder and the owner's intent record precede the request CAS.
    const intent = `${RECORDS}intent-${await deriveGrantId(ID, [], OWNER, "intent-1")}.ttl`;
    expect(writes.slice(0, 3).map((write) => write.url)).toEqual([
      RECORDS,
      `${RECORDS}.acl`,
      intent,
    ]);
    expect(writes[2]?.headers.get("if-none-match")).toBe("*");
    expect(pod.body(`${RECORDS}.acl`)).not.toContain(REQUESTER);
    writes.splice(0, 3);
    expect(writes[0]).toMatchObject({ url: ID });
    expect(writes[0]?.headers.get("if-match")).toBe('"v1"');
    expect(writes[0]?.body).toContain("Approving");
    expect(writes[1]?.url).toBe(result.grantUrl);
    expect(writes[2]?.url).toBe(result.receiptUrl);
    expect(writes.slice(1, 3).every((write) => write.headers.get("if-none-match") === "*")).toBe(
      true,
    );
    expect(writes.at(-1)?.body).toContain("Approved");
    const receipt = await graph(pod.body(result.receiptUrl) as string);
    expect(values(receipt, result.receiptUrl, DPV.hasPurpose)).toEqual([
      "https://w3id.org/dpv#ServiceProvision",
    ]);
    expect(values(receipt, result.receiptUrl, DPV.hasExpiryTime)).toEqual([
      "2027-01-01T00:00:00.000Z",
    ]);
    expect(pod.body(result.grantUrl as string)).not.toContain("2027-01-01");
    expect(pod.body(`${ALICE}.acl`)).toContain(REQUESTER);
    expect(pod.body(`${CAROL}.acl`)).toContain(REQUESTER);
    expect(await entry(pod)).toMatchObject({ status: "approved", decidedAt: NOW });
    const again = await decide({ id: ID }, { approve: true }, options(pod));
    expect(again).toEqual(result);
    await expect(decide({ id: ID }, { approve: false }, options(pod))).rejects.toThrow(
      "Cannot deny",
    );
  });

  it("rejects foreign targets, poisoned registration locations and unrequested type subsets before writes", async () => {
    for (const url of [
      "https://evil.example/secret",
      "https://pod.example.evil/x",
      `${POD}contacts/%2f..%2fsecret`,
    ]) {
      const pod = buildPod();
      pod.seed(
        ID,
        accessRequestTurtle(ID).replace(
          `<${CONTACTS_CLASS}> ;\n    odrl:constraint`,
          `<${url}> ;\n    odrl:constraint`,
        ),
      );
      await expect(decide({ id: ID }, { approve: true }, options(pod))).rejects.toThrow();
      expect(pod.log.some(({ method }) => method === "PUT")).toBe(false);
    }
    const pod = buildPod();
    await expect(
      decide({ id: ID }, { approve: true, dataTypes: ["urn:other"] }, options(pod)),
    ).rejects.toThrow("subset");
    await expect(
      decide({ id: ID }, { approve: true, dataTypes: [] }, options(pod)),
    ).rejects.toThrow("subset");
    pod.seed(
      `${POD}settings/publicTypeIndex.ttl`,
      `${PREFIXES}<urn:reg> a solid:TypeRegistration; solid:forClass <${CONTACTS_CLASS}>; solid:instance <https://evil.example/x>.`,
    );
    await expect(decide({ id: ID }, { approve: true }, options(pod))).rejects.toThrow();
    expect(pod.log.some(({ method }) => method === "PUT")).toBe(false);
  });

  it("ignores requester-supplied grant/receipt/snapshot IRIs", async () => {
    const pod = buildPod();
    pod.seed(
      ID,
      `${accessRequestTurtle(ID)} <${ID}> <${ACCM.grantId}> "evil"; <${ACCM.grantRef}> <https://evil.example/grant>; <${ACCM.ns}receiptRef> <https://evil.example/receipt>; <${ACCM.ns}snapshot> "{}".`,
    );
    const result = await decide({ id: ID }, { approve: true }, options(pod));
    expect(result.grantUrl).toMatch(new RegExp(`^${RECORDS}grant-[a-f0-9]{64}.ttl$`));
    expect(pod.log.some(({ url }) => url.startsWith("https://evil"))).toBe(false);
  });

  it("a real concurrent approval 412 observes the winner and creates exactly one grant", async () => {
    const pod = buildPod();
    const outcomes = await Promise.allSettled([
      decide({ id: ID }, { approve: true }, options(pod)),
      decide({ id: ID }, { approve: true }, options(pod)),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const loser = outcomes.find(
      (outcome) => outcome.status === "rejected",
    ) as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(RequestConflictError);
    expect(["approving", "approved"]).toContain(loser.reason.current);
    const grantWrites = pod.log.filter(
      ({ method, url }) => method === "PUT" && url.startsWith(`${RECORDS}grant-`),
    );
    expect(grantWrites).toHaveLength(1);
    expect(await entry(pod)).toMatchObject({ status: "approved" });
  });

  it("recovers after records but before ACLs, without resolving again or duplicating records", async () => {
    const pod = buildPod();
    pod.intercept = (method, url) => {
      if (method === "PUT" && url.endsWith(".acl") && !url.startsWith(RECORDS))
        throw new Error("crash before ACL write");
    };
    await expect(
      decide({ id: ID }, { approve: true, expiresAt: new Date("2028-01-01Z") }, options(pod)),
    ).rejects.toThrow("crash");
    expect(await entry(pod)).toMatchObject({ status: "approving" });
    const persisted = pod.body(ID) as string;
    expect(persisted).not.toContain(ALICE);
    const intent = `${RECORDS}intent-${await deriveGrantId(ID, [], OWNER, "intent-1")}.ttl`;
    expect(pod.body(intent)).toContain(ALICE);
    pod.seed(`${POD}settings/publicTypeIndex.ttl`, "corrupted index @@@");
    pod.seed(`${POD}contacts/new.ttl`, "<urn:new> a <urn:Contact>.");
    pod.intercept = undefined;
    const result = await decide(
      { id: ID },
      { approve: true, dataTypes: ["urn:ignored-on-resume"] },
      options(pod),
    );
    expect(result.status).toBe("approved");
    expect(pod.has(`${POD}contacts/new.ttl.acl`)).toBe(false);
    expect(pod.etag(result.receiptUrl)).toBe('"v1"');
    expect(pod.etag(result.grantUrl as string)).toBe('"v1"');
    expect(pod.body(result.receiptUrl)).toContain("2028-01-01");
  });

  it("denies with a create-only receipt; retries a failed denial receipt and forbids approving it", async () => {
    const pod = buildPod();
    pod.intercept = (method, url) => {
      if (method === "PUT" && url.startsWith(RECORDS)) return new Response(null, { status: 500 });
    };
    await expect(decide({ id: ID }, { approve: false }, options(pod))).rejects.toThrow("500");
    pod.intercept = undefined;
    const result = await decide({ id: ID }, { approve: false }, options(pod));
    expect(result.status).toBe("denied");
    expect(pod.body(result.receiptUrl)).toContain("ConsentRefused");
    expect(await decide({ id: ID }, { approve: false }, options(pod))).toEqual(result);
    expect(
      pod.log.some(
        ({ method, url }) => method === "PUT" && url.endsWith(".acl") && url !== `${RECORDS}.acl`,
      ),
    ).toBe(false);
    await expect(decide({ id: ID }, { approve: true }, options(pod))).rejects.toThrow(
      "Cannot approve",
    );
  });

  it("refuses ACP/unknown and weak or absent validators", async () => {
    for (const link of ['<.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"', ""]) {
      const pod = buildPod();
      pod.intercept = (method) =>
        method === "HEAD" ? new Response(null, { headers: { link } }) : undefined;
      await expect(decide({ id: ID }, { approve: true }, options(pod))).rejects.toBeInstanceOf(
        UnsupportedAccessModelError,
      );
      expect(pod.log.some(({ method }) => method === "PUT")).toBe(false);
    }
    for (const etag of [null, 'W/"weak"']) {
      const pod = buildPod();
      pod.intercept = (method, url) =>
        method === "GET" && url === ID
          ? new Response(accessRequestTurtle(ID), {
              headers: { "content-type": "text/turtle", ...(etag !== null && { etag }) },
            })
          : undefined;
      await expect(decide({ id: ID }, { approve: true }, options(pod))).rejects.toThrow(
        "strong ETag",
      );
      expect(pod.log.some(({ method }) => method === "PUT")).toBe(false);
    }
  });

  it("never notifies through the global fetch; an explicit public fetch omits credentials and failure never rolls back", async () => {
    const pod = buildPod();
    const global = vi.fn<typeof fetch>(async () => new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", global);
    try {
      const { publicFetch: _unused, ...opts } = options(pod);
      const result = await decide({ id: ID }, { approve: true }, opts);
      expect(result.notified).toBe(false);
      expect(global).not.toHaveBeenCalled();
      expect(await entry(pod)).toMatchObject({ status: "approved" });
    } finally {
      vi.unstubAllGlobals();
    }
    const other = buildPod();
    const calls: RequestInit[] = [];
    const publicFetch: typeof fetch = async (_input, init) => {
      calls.push(init as RequestInit);
      if (init?.method === "POST") return new Response(null, { status: 503 });
      return new Response(
        `<${REQUESTER}> <http://www.w3.org/ns/ldp#inbox> <https://app.example/inbox/>.`,
        { headers: { "content-type": "text/turtle" } },
      );
    };
    const result = await decide({ id: ID }, { approve: true }, { ...options(other), publicFetch });
    expect(result.notified).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.credentials === "omit" && call.redirect === "error")).toBe(
      true,
    );
    expect(String(calls[1]?.body)).toContain("Accept");
    expect(await entry(other)).toMatchObject({ status: "approved" });
  });

  it("never contacts a requester profile or inbox on a local, private or cleartext host", async () => {
    const hosts = [
      "http://app.example/inbox/",
      "https://localhost/inbox/",
      "https://printer.local/inbox/",
      "https://127.0.0.1/inbox/",
      "https://10.0.0.8/inbox/",
      "https://192.168.1.1/inbox/",
      "https://169.254.169.254/latest/",
      "https://[::1]/inbox/",
      "https://[fd00::1]/inbox/",
      "https://metadata.google.internal/inbox/",
    ];
    for (const inbox of hosts) {
      const pod = buildPod();
      const posts: string[] = [];
      const publicFetch: typeof fetch = async (input, init) => {
        if (init?.method === "POST") posts.push(String(input));
        return new Response(`<${REQUESTER}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`, {
          headers: { "content-type": "text/turtle" },
        });
      };
      const result = await decide({ id: ID }, { approve: false }, { ...options(pod), publicFetch });
      expect(result.notified).toBe(false);
      expect(posts).toEqual([]);
    }
    for (const requester of ["http://app.example/agent#it", "https://127.0.0.1/agent#it"]) {
      const pod = buildPod();
      pod.seed(ID, accessRequestTurtle(ID).replaceAll(REQUESTER, requester));
      const publicFetch = vi.fn<typeof fetch>();
      const result = await decide({ id: ID }, { approve: false }, { ...options(pod), publicFetch });
      expect(result.notified).toBe(false);
      expect(publicFetch).not.toHaveBeenCalled();
    }
  });

  it("reads an owner profile outside storage only through the public transport", async () => {
    const webId = "https://id.example/alice#me";
    const pod = buildPod();
    const profile = `<${webId}> <http://www.w3.org/ns/ldp#inbox> <${INBOX}>; <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${POD}settings/publicTypeIndex.ttl>.`;
    const calls: { url: string; init?: RequestInit }[] = [];
    const publicFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init as RequestInit });
      return new Response(profile, { headers: { "content-type": "text/turtle" } });
    };
    pod.seed(`${POD}.acl`, (pod.body(`${POD}.acl`) as string).replace(OWNER, webId));
    const base = { ...options(pod), webId };
    expect(await listRequests({ ...base, publicFetch: undefined })).toEqual([]);
    const listed = await listRequests({ ...base, publicFetch });
    expect(listed).toHaveLength(1);
    const result = await decide({ id: ID }, { approve: true }, { ...base, publicFetch });
    expect(result.status).toBe("approved");
    expect(pod.log.some(({ url }) => url.startsWith("https://id.example/"))).toBe(false);
    expect(calls.filter(({ url }) => url.startsWith("https://id.example/")).length).toBeGreaterThan(
      0,
    );
    for (const { init } of calls) {
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
    }
  });

  it("grants each approved data type only its own requested modes", async () => {
    const Calendar = "http://www.w3.org/2002/12/cal/ical#Vevent";
    const Event = `${POD}calendar/event.ttl`;
    const seed = (pod: ReturnType<typeof buildPod>) => {
      pod.seed(
        `${POD}settings/publicTypeIndex.ttl`,
        `${PREFIXES}<${POD}settings/publicTypeIndex.ttl#contacts> a solid:TypeRegistration; solid:forClass vcard:Individual; solid:instanceContainer <${POD}contacts/>.
<${POD}settings/publicTypeIndex.ttl#calendar> a solid:TypeRegistration; solid:forClass <${Calendar}>; solid:instance <${Event}>.`,
      );
      pod.seed(Event, `<${Event}#it> a <${Calendar}>.`);
      pod.seed(
        ID,
        `${PREFIXES}<${ID}> a odrl:Offer; odrl:uid <${ID}>;
  odrl:permission [ odrl:assignee <${REQUESTER}>; odrl:action odrl:read; odrl:target <${CONTACTS_CLASS}> ],
    [ odrl:assignee <${REQUESTER}>; odrl:action odrl:modify; odrl:target <${Calendar}> ].`,
      );
    };
    const pod = buildPod();
    seed(pod);
    expect(await entry(pod)).toMatchObject({
      modes: ["read", "write"],
      modesByType: { [CONTACTS_CLASS]: ["read"], [Calendar]: ["write"] },
    });
    await decide({ id: ID }, { approve: true, dataTypes: [CONTACTS_CLASS] }, options(pod));
    const contactsAcl = await graph(pod.body(`${ALICE}.acl`) as string);
    expect(contactsAcl.match(null, null, DataFactory.namedNode(ACL.Write)).size).toBe(
      (await graph(pod.body(`${POD}.acl`) as string)).match(
        null,
        null,
        DataFactory.namedNode(ACL.Write),
      ).size,
    );
    expect(pod.has(`${Event}.acl`)).toBe(false);
    const both = buildPod();
    seed(both);
    const result = await decide({ id: ID }, { approve: true }, options(both));
    const eventAcl = pod.body(`${Event}.acl`);
    expect(eventAcl).toBeUndefined();
    const grant = both.body(result.grantUrl as string) as string;
    expect(grant).toContain(Event);
    const aliceAcl = await graph(both.body(`${ALICE}.acl`) as string);
    const requesterRules = [
      ...aliceAcl.match(null, DataFactory.namedNode(ACL.agent), DataFactory.namedNode(REQUESTER)),
    ].map((q) => q.subject);
    const requesterModes = requesterRules.flatMap((subject) =>
      [...aliceAcl.match(subject, DataFactory.namedNode(ACL.mode))].map((q) => q.object.value),
    );
    expect(requesterModes).toEqual([ACL.Read]);
    const event = await graph(both.body(`${Event}.acl`) as string);
    const eventRules = [
      ...event.match(null, DataFactory.namedNode(ACL.agent), DataFactory.namedNode(REQUESTER)),
    ].map((q) => q.subject);
    expect(
      eventRules.flatMap((subject) =>
        [...event.match(subject, DataFactory.namedNode(ACL.mode))].map((q) => q.object.value),
      ),
      // A change request is approved as Editor, which also lets the requester view.
    ).toEqual(expect.arrayContaining([ACL.Read, ACL.Write]));
    const viewer = buildPod();
    seed(viewer);
    await expect(
      decide({ id: ID }, { approve: true, role: "viewer", dataTypes: [Calendar] }, options(viewer)),
    ).rejects.toThrow("no requested modes");
  });

  it("delivers Reject; missing/unsafe requester inbox and network failures are best effort", async () => {
    for (const mode of ["success", "missing", "unsafe", "network"]) {
      const pod = buildPod();
      const publicFetch: typeof fetch = async (_input, init) => {
        if (mode === "network") throw new Error("offline");
        if (init?.method === "POST") {
          expect(String(init.body)).toContain("Reject");
          return new Response(null, { status: 201 });
        }
        return new Response(
          mode === "missing"
            ? ""
            : `<${REQUESTER}> <http://www.w3.org/ns/ldp#inbox> <${mode === "unsafe" ? "file:///tmp/inbox" : "https://app.example/inbox/"}>.`,
          { headers: { "content-type": "text/turtle" } },
        );
      };
      const result = await decide({ id: ID }, { approve: false }, { ...options(pod), publicFetch });
      expect(result.notified).toBe(mode === "success");
      expect(await entry(pod)).toMatchObject({ status: "denied" });
    }
  });
});
