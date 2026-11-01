// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store, Writer } from "n3";
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
import { applyGrant, roleFor } from "./acl.js";
import { httpUrl, put, read, transport } from "./http.js";
import { project } from "./inbox.js";
import {
  ACCM,
  ACL,
  accessModel,
  canonicalizeAccmDataset,
  decide,
  deriveGrantId,
  listRequests,
  MAX_MEMBERS,
  RequestConflictError,
} from "./index.js";
import { set, turtle, values } from "./rdf.js";
import { resolveTargets } from "./targets.js";

const ID = `${INBOX}request-1.ttl`;
const ALICE = `${POD}contacts/alice.ttl`;
const CAROL = `${POD}contacts/carol.ttl`;
const INDEX = `${POD}settings/publicTypeIndex.ttl`;
const RECORDS = `${POD}settings/access-records/`;

/** The owner's pinned-decision record for the fixture request (read access to contacts). */
const pinnedIntent = async () =>
  `${RECORDS}intent-${await deriveGrantId(ID, [`agent ${REQUESTER}`, `${CONTACTS_CLASS} read`], OWNER, "intent-2")}.ttl`;
const opts = (pod = buildPod()) => ({
  fetch: pod.fetch,
  webId: OWNER,
  storage: POD,
  publicFetch: async () => new Response(null, { status: 404 }),
});
const graph = (body: string) => parseRdf(body, "text/turtle");
const reg = (location: string, predicate = "instance") =>
  `${PREFIXES}[] a solid:TypeRegistration; solid:forClass <${CONTACTS_CLASS}>; solid:${predicate} <${location}>.`;

describe("protocol and RDF boundaries", () => {
  it("refuses userinfo, redirects, transport errors and RDF IRI/datatype injection", async () => {
    expect(() => httpUrl("https://user:secret@pod.example/")).toThrow("credentials");
    await expect(transport(async () => new Response(null, { status: 302 }))(POD)).rejects.toThrow(
      "Redirect",
    );
    await expect(read(POD, async () => new Response(null, { status: 403 }))).rejects.toThrow("403");
    const { namedNode, literal, quad } = DataFactory;
    for (const object of [
      namedNode("urn:x> <urn:s> <urn:p> <urn:o"),
      literal("value", namedNode("urn:type>bad")),
    ]) {
      const dataset = new Store([quad(namedNode("urn:s"), namedNode("urn:p"), object)]);
      await expect(turtle(dataset)).rejects.toThrow("Unsafe RDF");
    }
    await expect(
      turtle(
        new Store([
          quad(namedNode("urn:s"), namedNode("urn:p"), literal("x", "en>bad <urn:a> <urn:b")),
        ]),
      ),
    ).rejects.toThrow("Unsafe RDF language tag");
    await expect(
      turtle(
        new Store([quad(namedNode("urn:s"), namedNode("urn:p"), literal("x"), namedNode("urn:g"))]),
      ),
    ).rejects.toThrow("Named graphs");
    // JSON-LD lets a document choose any blank-node label; labels are regenerated, not echoed.
    const hostile = DataFactory.blankNode("x> <http://bad/s> <http://bad/p> <http://bad/o> . #");
    const written = await turtle(
      new Store([
        quad(namedNode("urn:s"), namedNode("urn:p"), hostile),
        quad(hostile, namedNode("urn:q"), literal("v", "en-GB")),
      ]),
    );
    expect(written).not.toContain("http://bad/");
    const reparsed = await graph(written);
    expect(reparsed.size).toBe(2);
    const [link] = [...reparsed.match(namedNode("urn:s"), namedNode("urn:p"))];
    expect(link?.object.termType).toBe("BlankNode");
    expect(
      [...reparsed.match(link?.object as never, namedNode("urn:q"))].map((q) => q.object),
    ).toEqual([literal("v", "en-GB")]);
    const writer = vi.spyOn(Writer.prototype, "end").mockImplementation((callback) => {
      callback?.(new Error("writer failure"), "");
      return "";
    });
    try {
      await expect(turtle(new Store())).rejects.toThrow("writer failure");
    } finally {
      writer.mockRestore();
    }
    expect(
      values(
        new Store([quad(namedNode("urn:s"), namedNode("urn:p"), DataFactory.blankNode())]),
        "urn:s",
        "urn:p",
      ),
    ).toEqual([]);
  });

  it("canonicalizes legacy vocabulary in named graphs without rewriting resource identifiers", async () => {
    const legacy = "https://w3id.org/jeswr/accm#";
    const dataset = await parseRdf(
      `<urn:g> { <${legacy}resource> <${legacy}status> <${legacy}Approved>. }`,
      "application/trig",
    );
    const copy = canonicalizeAccmDataset(dataset, DataFactory);
    expect([...copy][0]?.predicate.value).toBe(ACCM.status);
    expect([...copy][0]?.object.value).toBe(ACCM.Approved);
    expect([...copy][0]?.subject.value).toBe(`${legacy}resource`);
    expect([...dataset][0]?.predicate.value).toBe(`${legacy}status`);
    const defaultGraph = await graph(`<urn:request> <${legacy}status> <${legacy}Pending>.`);
    expect([...canonicalizeAccmDataset(defaultGraph, DataFactory)][0]?.object.value).toBe(
      ACCM.Pending,
    );
    set(copy, `${legacy}resource`, ACCM.status, ACCM.Denied, true);
    expect(values(copy, `${legacy}resource`, ACCM.status)).toContain(ACCM.Denied);
    const pod = buildPod();
    pod.seed(ID, accessRequestTurtle(ID).replaceAll(CONTACTS_CLASS, `${legacy}DataClass`));
    pod.seed(INDEX, reg(ALICE).replaceAll(CONTACTS_CLASS, ACCM.DataClass));
    expect((await listRequests(opts(pod)))[0]).toMatchObject({ dataTypes: [ACCM.DataClass] });
    expect((await decide({ id: ID }, { approve: true }, opts(pod))).status).toBe("approved");
  });

  it("handles complete Link relation tokens and non-2xx model discovery", async () => {
    for (const link of [
      undefined,
      '<x>; title="acl"',
      "garbage, <x>; rel=acl-other",
      "<x>; rel=acl",
      '<x>; rel="other acl"',
    ]) {
      const model = await accessModel({
        storage: POD,
        fetch: async () => new Response(null, { headers: link === undefined ? {} : { link } }),
      });
      expect(model).toBe(
        link?.endsWith("rel=acl") || link?.endsWith('other acl"') ? "wac" : "unknown",
      );
    }
    await expect(
      accessModel({ storage: POD, fetch: async () => new Response(null, { status: 403 }) }),
    ).rejects.toThrow("403");
    expect(await put(POD, "", async () => new Response(null, { status: 412 }), '"v1"')).toBe(false);
    for (const link of [
      '<x>; title="; rel=acl"',
      '<x>; rel=acl; anchor="https://other.example/"',
      '<x>; title=",<x>; rel=acl"',
    ]) {
      expect(
        await accessModel({
          storage: POD,
          fetch: async () => new Response(null, { headers: { link } }),
        }),
      ).toBe("unknown");
    }
    await expect(
      accessModel({
        storage: POD,
        fetch: async () => new Response(null, { headers: { link: "x".repeat(8193) } }),
      }),
    ).rejects.toThrow("maxBytes");
  });

  it("projects fallback fields, missing permissions/targets/agents and unknown action siblings", async () => {
    const bodies = [
      `${PREFIXES}<${ID}> a odrl:Offer.`,
      `${PREFIXES}<${ID}> a odrl:Offer; odrl:permission [ odrl:action odrl:read; odrl:target <${ALICE}> ].`,
      `${PREFIXES}<${ID}> a odrl:Offer; odrl:assignee <${REQUESTER}>; odrl:permission [ odrl:action odrl:read ].`,
    ];
    for (const body of bodies)
      expect(project(ID, await graph(body), null).entry.status).toBe("unreadable");
    const body = `${PREFIXES}<${ID}> a odrl:Offer; odrl:assignee <${REQUESTER}>; odrl:permission [ odrl:action odrl:read; odrl:target <${ALICE}> ], [odrl:action odrl:distribute] ; dpv:hasPurpose "Research"; dpv:hasExpiryTime "2028-01-01". <${REQUESTER}> vcard:fn "Client".`;
    expect(project(ID, await graph(body), null).entry).toMatchObject({
      purpose: "Research",
      expiresAt: "2028-01-01",
      requesterName: "Client",
      dataTypes: [ALICE],
    });
    const constraints = accessRequestTurtle(ID)
      .replace("odrl:operator odrl:lteq", "odrl:operator odrl:lt")
      .replace("<https://w3id.org/dpv#ServiceProvision>", "42");
    expect(project(ID, await graph(constraints), null).entry).toMatchObject({
      expiresAt: "2027-01-01T00:00:00Z",
    });
  });

  it("cancels a member read without silently turning the abort into an unreadable entry", async () => {
    const pod = buildPod();
    const controller = new AbortController();
    const fetchFn: typeof fetch = async (input, init) => {
      if (String(input) === ID) controller.abort();
      return pod.fetch(input, init);
    };
    await expect(
      listRequests({ ...opts(pod), fetch: fetchFn, signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe("Type Index resolution boundaries", () => {
  it("accepts explicit index datasets/URLs, blank registration subjects and nested containers", async () => {
    const pod = buildPod();
    const index = await graph(
      `${reg(ALICE) + reg(`${POD}contacts/`, "instanceContainer")}${PREFIXES}<urn:other> a solid:TypeRegistration; solid:forClass <urn:other>.`,
    );
    pod.seed(INDEX, await turtle(index));
    pod.seed(`${POD}contacts/deep/one`, "");
    pod.seed(
      `${POD}contacts/deep/`,
      `<${POD}contacts/deep/> <http://www.w3.org/ns/ldp#contains> <${POD}contacts/deep/>, <${POD}contacts/deep/one>.`,
    );
    for (const typeIndex of [index, INDEX])
      expect(
        await resolveTargets([CONTACTS_CLASS], { ...opts(pod), typeIndex }, transport(pod.fetch)),
      ).toContain(`${POD}contacts/deep/one`);
  });

  it("discovers private indexes through preferences; distinguishes missing from unreadable", async () => {
    const pod = buildPod();
    pod.seed(
      `${POD}profile/card`,
      `${PREFIXES}<${OWNER}> <http://www.w3.org/ns/pim/space#preferencesFile> <${POD}settings/prefs>.`,
    );
    pod.seed(`${POD}settings/prefs`, `${PREFIXES}<${OWNER}> solid:privateTypeIndex <${INDEX}>.`);
    pod.seed(INDEX, reg(ALICE));
    expect(await resolveTargets([CONTACTS_CLASS], opts(pod), pod.fetch)).toEqual([ALICE]);
    pod.delete(`${POD}settings/prefs`);
    await expect(resolveTargets([CONTACTS_CLASS], opts(pod), pod.fetch)).rejects.toThrow(
      "registration",
    );
    pod.delete(`${POD}profile/card`);
    await expect(resolveTargets([CONTACTS_CLASS], opts(pod), pod.fetch)).rejects.toThrow(
      "registration",
    );
    await expect(
      resolveTargets([CONTACTS_CLASS], { ...opts(pod), typeIndex: `${POD}absent` }, pod.fetch),
    ).rejects.toThrow("registration");
    const fresh = buildPod();
    fresh.delete(INDEX);
    await expect(resolveTargets([CONTACTS_CLASS], opts(fresh), fresh.fetch)).rejects.toThrow(
      "registration",
    );
  });

  it("bounds discovery and expansion and refuses empty, missing, foreign and auxiliary locations", async () => {
    const pod = buildPod();
    pod.seed(
      `${POD}profile/card`,
      `${PREFIXES}<${OWNER}> solid:publicTypeIndex ${Array.from({ length: 11 }, (_, i) => `<${POD}i${i}>`).join(",")}.`,
    );
    await expect(resolveTargets([CONTACTS_CLASS], opts(pod), pod.fetch)).rejects.toThrow(
      "Too many",
    );
    for (const [location, predicate, message] of [
      [`${POD}missing/`, "instanceContainer", "missing"],
      [`${ALICE}.acl`, "instance", "Access-control"],
      ["https://evil.example/x", "instance", "scope"],
    ]) {
      const index = await graph(reg(location as string, predicate));
      await expect(
        resolveTargets([CONTACTS_CLASS], { ...opts(pod), typeIndex: index }, pod.fetch),
      ).rejects.toThrow(message === "scope" ? undefined : message);
    }
    const empty = await graph(
      `${PREFIXES}<urn:reg> a solid:TypeRegistration; solid:forClass <${CONTACTS_CLASS}>.`,
    );
    await expect(
      resolveTargets([CONTACTS_CLASS], { ...opts(pod), typeIndex: empty }, pod.fetch),
    ).rejects.toThrow("count");
    const large = new Store();
    for (let i = 0; i <= MAX_MEMBERS; i++) {
      const data = await graph(reg(`${POD}r${i}`));
      for (const q of data) large.add(q);
    }
    await expect(
      resolveTargets([CONTACTS_CLASS], { ...opts(pod), typeIndex: large }, pod.fetch),
    ).rejects.toThrow("count");
    const both = new Store([
      ...large,
      ...(await graph(reg(`${POD}contacts/`, "instanceContainer"))),
    ]);
    await expect(
      resolveTargets([CONTACTS_CLASS], { ...opts(pod), typeIndex: both }, pod.fetch),
    ).rejects.toThrow("limit");
    pod.seed(
      `${POD}many/`,
      `<${POD}many/> <http://www.w3.org/ns/ldp#contains> ${Array.from({ length: MAX_MEMBERS }, (_, i) => `<${POD}many/r${i}>`).join(",")}.`,
    );
    await expect(
      resolveTargets(
        [CONTACTS_CLASS],
        { ...opts(pod), typeIndex: await graph(reg(`${POD}many/`, "instanceContainer")) },
        pod.fetch,
      ),
    ).rejects.toThrow("limit");
  });
});

describe("role grant seam", () => {
  const modesOf = async (pod: ReturnType<typeof buildPod>, url: string, agent: string) => {
    const dataset = await graph(pod.body(url) as string);
    return [...dataset.match(null, DataFactory.namedNode(ACL.agent), DataFactory.namedNode(agent))]
      .flatMap((q) => [...dataset.match(q.subject, DataFactory.namedNode(ACL.mode))])
      .map((q) => q.object.value)
      .sort();
  };

  it("maps requested modes to the matching role and refuses append-only requests", () => {
    expect(roleFor(["read"])).toBe("viewer");
    expect(roleFor(["read", "append"])).toBe("viewer");
    expect(roleFor(["write"])).toBe("editor");
    expect(roleFor(["append", "read", "write"])).toBe("editor");
    expect(() => roleFor(["append"])).toThrow("only asks to add data");
  });

  it("grants additively through the role layer, keeps owner control and never downgrades", async () => {
    const pod = buildPod();
    const url = `${ALICE}.acl`;
    await applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch);
    expect(await modesOf(pod, url, REQUESTER)).toEqual([ACL.Read]);
    expect(await modesOf(pod, url, OWNER)).toContain(ACL.Control);
    const before = pod.log.length;
    await applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch);
    expect(pod.log.slice(before).some(({ method }) => method === "PUT")).toBe(false);
    await applyGrant(ALICE, POD, OWNER, REQUESTER, ["read", "write"], pod.fetch);
    expect(await modesOf(pod, url, REQUESTER)).toEqual(
      expect.arrayContaining([ACL.Read, ACL.Write]),
    );
    await applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch);
    expect(await modesOf(pod, url, REQUESTER)).toContain(ACL.Write);
    // Folders are granted as folders: the rule covers their contents.
    await applyGrant(`${POD}contacts/`, POD, OWNER, REQUESTER, ["read"], pod.fetch);
    expect(pod.body(`${POD}contacts/.acl`)).toContain("default");
  });

  it("rethrows role-layer refusals unchanged and never retries them", async () => {
    const pod = buildPod();
    const url = `${ALICE}.acl`;
    pod.seed(
      url,
      `${PREFIXES}<${url}#bob> a acl:Authorization; acl:accessTo <${ALICE}>; acl:agent <https://bob.example/#me>; acl:mode acl:Read, acl:Write, acl:Control.`,
    );
    const before = pod.log.length;
    await expect(
      applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch),
    ).rejects.toMatchObject({ code: "owner-lockout" });
    expect(pod.log.slice(before).some(({ method }) => method === "PUT")).toBe(false);
    const racing = buildPod();
    racing.intercept = (method) =>
      method === "PUT" ? new Response(null, { status: 412 }) : undefined;
    await expect(
      applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], racing.fetch),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(racing.log.filter(({ method }) => method === "PUT")).toHaveLength(1);
    await expect(
      applyGrant("https://evil.example/x", POD, OWNER, REQUESTER, ["read"], pod.fetch),
    ).rejects.toThrow();
  });
});

describe("forward-only approval reconciliation", () => {
  /** Crash after the Approving CAS, before grant records; returns the owner's intent record. */
  async function orphan(pod: ReturnType<typeof buildPod>) {
    pod.intercept = (method, url) => {
      if (method === "PUT" && /access-records\/(grant|receipt)-/.test(url))
        throw new Error("crash");
    };
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow("crash");
    pod.intercept = undefined;
    const intent = await pinnedIntent();
    const dataset = await graph(pod.body(intent) as string);
    return {
      intent,
      dataset,
      snapshot: JSON.parse(values(dataset, intent, `${ACCM.ns}snapshot`)[0] as string),
    };
  }

  it("attributes no mode to an explicit data type no rule targets, and caps targets across types", async () => {
    const Calendar = "http://www.w3.org/2002/12/cal/ical#Vevent";
    const pod = buildPod();
    pod.seed(
      ID,
      `${PREFIXES}<${ID}> a odrl:Offer; odrl:uid <${ID}>; accm:dataClass <${CONTACTS_CLASS}>, <${Calendar}>;
  odrl:permission [ odrl:assignee <${REQUESTER}>; odrl:action odrl:read; odrl:target <${CONTACTS_CLASS}> ].`,
    );
    const listed = (await listRequests(opts(pod)))[0];
    expect(listed).toMatchObject({ modesByType: { [CONTACTS_CLASS]: ["read"] } });
    expect(Object.keys((listed as { modesByType: object }).modesByType)).toEqual([CONTACTS_CLASS]);
    await expect(
      decide({ id: ID }, { approve: true, dataTypes: [Calendar] }, opts(pod)),
    ).rejects.toThrow("no requested modes");
    expect(pod.log.some(({ method }) => method === "PUT")).toBe(false);

    const big = buildPod();
    const many = (folder: string) => {
      for (let n = 0; n < 51; n++) big.seed(`${POD}${folder}/${n}.ttl`, `<#it> a <urn:x>.`);
    };
    many("contacts");
    many("calendar");
    big.seed(
      INDEX,
      `${PREFIXES}<${INDEX}#a> a solid:TypeRegistration; solid:forClass <${CONTACTS_CLASS}>; solid:instanceContainer <${POD}contacts/>.
<${INDEX}#b> a solid:TypeRegistration; solid:forClass <${Calendar}>; solid:instanceContainer <${POD}calendar/>.`,
    );
    big.seed(
      ID,
      `${PREFIXES}<${ID}> a odrl:Offer; odrl:uid <${ID}>;
  odrl:permission [ odrl:assignee <${REQUESTER}>; odrl:action odrl:read; odrl:target <${CONTACTS_CLASS}> ],
    [ odrl:assignee <${REQUESTER}>; odrl:action odrl:read; odrl:target <${Calendar}> ].`,
    );
    await expect(decide({ id: ID }, { approve: true }, opts(big))).rejects.toThrow(
      "Invalid resolved target count",
    );
    expect(big.log.some(({ method }) => method === "PUT")).toBe(false);
  });

  it("rejects corrupt or missing persisted snapshots before records or ACL writes", async () => {
    const pod = buildPod();
    const { intent, dataset, snapshot } = await orphan(pod);
    for (const change of [
      { schemaVersion: "2" },
      { targets: [] },
      { targets: Array(MAX_MEMBERS + 1).fill(ALICE) },
      { modes: [] },
      { modes: ["control"] },
      { grantId: "forged" },
      { targets: ["https://evil.example/x"] },
      { targets: [`${ALICE}.acl`] },
      { targetModes: null },
      { targetModes: undefined },
      { targetModes: { [ALICE]: ["read"] } },
      { targetModes: { [ALICE]: [], [CAROL]: ["read"] } },
      { targetModes: { [ALICE]: ["write"], [CAROL]: ["read"] } },
      { targetModes: { [ALICE]: "read", [CAROL]: ["read"] } },
      { targetModes: { [ALICE]: ["read"], [`${CAROL}x`]: ["read"] } },
    ]) {
      const forged = { ...snapshot, ...change };
      if (change.targets?.length === 1) {
        forged.grantId = await deriveGrantId(ID, forged.targets, OWNER);
        forged.targetModes = { [change.targets[0] as string]: ["read"] };
      }
      set(dataset, intent, `${ACCM.ns}snapshot`, JSON.stringify(forged));
      pod.seed(intent, await turtle(dataset));
      const before = pod.log.length;
      await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow();
      expect(pod.log.slice(before).some(({ method }) => method === "PUT")).toBe(false);
    }
    set(dataset, intent, `${ACCM.ns}snapshot`, undefined);
    pod.seed(intent, await turtle(dataset));
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
      "does not match",
    );
    set(dataset, intent, `${ACCM.ns}snapshot`, JSON.stringify(snapshot));
    set(dataset, intent, ACCM.requestRef, `${INBOX}other.ttl`, true);
    pod.seed(intent, await turtle(dataset));
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
      "does not match",
    );
    // Without the owner's record, an Approving notification is a requester claim: approval refuses
    // it before any write.
    pod.delete(intent);
    const before = pod.log.length;
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
      "never recorded",
    );
    expect(pod.log.slice(before).some(({ method }) => method === "PUT")).toBe(false);
    pod.delete(ID);
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
      "no longer exists",
    );
    pod.seed(ID, "<urn:x> a <urn:Y>.");
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow("Unreadable");
  });

  it("verifies final CAS failure honestly, observes another resumer and rejects backwards states", async () => {
    for (const outcome of ["stuck", "winner", "last-winner", "backwards"]) {
      const pod = buildPod();
      await orphan(pod);
      let attempts = 0;
      pod.intercept = (method, url, init) => {
        if (method === "PUT" && url === ID && String(init?.body).includes(ACCM.Approved)) {
          attempts++;
          if (outcome === "winner" || (outcome === "last-winner" && attempts === 3))
            pod.seed(ID, String(init?.body));
          if (outcome === "backwards") pod.seed(ID, accessRequestTurtle(ID));
          return new Response(null, { status: 412 });
        }
      };
      const operation = decide({ id: ID }, { approve: true }, opts(pod));
      if (outcome === "stuck") await expect(operation).rejects.toBeInstanceOf(RequestConflictError);
      else if (outcome === "backwards") await expect(operation).rejects.toThrow("backwards");
      else expect((await operation).status).toBe("approved");
    }
  });

  it("a lost CAS observes deletion, and model changes stop a resumed approval", async () => {
    const pod = buildPod();
    pod.intercept = (method, url) => {
      if (method === "PUT" && url === ID) {
        pod.delete(ID);
        return new Response(null, { status: 412 });
      }
    };
    await expect(decide({ id: ID }, { approve: false }, opts(pod))).rejects.toMatchObject({
      current: "gone",
    });
    const fresh = buildPod();
    await orphan(fresh);
    fresh.intercept = (method, url) =>
      method === "HEAD" && url === ALICE
        ? new Response(null, {
            headers: { link: '<x>; rel="http://www.w3.org/ns/solid/acp#accessControl"' },
          })
        : undefined;
    await expect(decide({ id: ID }, { approve: true }, opts(fresh))).rejects.toMatchObject({
      model: "acp",
    });
    const pending = buildPod();
    pending.intercept = fresh.intercept;
    await expect(decide({ id: ID }, { approve: true }, opts(pending))).rejects.toMatchObject({
      model: "acp",
    });
    expect(pending.log.some(({ method }) => method === "PUT")).toBe(false);
  });

  it("viewer cannot escalate a write request; editor supports requested write and append; purpose labels remain literals", async () => {
    const pod = buildPod();
    pod.seed(ID, accessRequestTurtle(ID).replace("odrl:read", "odrl:write"));
    await expect(decide({ id: ID }, { approve: true, role: "viewer" }, opts(pod))).rejects.toThrow(
      "no requested modes",
    );
    pod.seed(ID, accessRequestTurtle(ID).replace("odrl:read", `<${ACL.Append}>`));
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
      "only asks to add data",
    );
    expect(pod.log.some(({ method }) => method === "PUT")).toBe(false);
    const label = accessRequestTurtle(ID)
      .replace("odrl:read", "odrl:modify")
      .replace("<https://w3id.org/dpv#ServiceProvision>", '"Research"');
    pod.seed(ID, label);
    const result = await decide(
      { id: ID },
      { approve: true, role: "editor" },
      { ...opts(pod), storage: POD.slice(0, -1) },
    );
    expect(pod.body(result.receiptUrl)).toContain('"Research"');
    const textPod = buildPod();
    textPod.seed(
      ID,
      accessRequestTurtle(ID).replace(
        "<https://w3id.org/dpv#ServiceProvision>",
        '"http research label"',
      ),
    );
    const textResult = await decide({ id: ID }, { approve: true }, opts(textPod));
    expect(textPod.body(textResult.receiptUrl)).toContain('"http research label"');
    const fresh = buildPod();
    fresh.seed(
      ID,
      accessRequestTurtle(ID).replace(
        /odrl:constraint \[[\s\S]*?\]\s*,\s*\[[\s\S]*?\]/,
        "odrl:constraint [odrl:leftOperand odrl:count; odrl:operator odrl:eq; odrl:rightOperand 1]",
      ),
    );
    await decide({ id: ID }, { approve: true }, opts(fresh));
  });
});
