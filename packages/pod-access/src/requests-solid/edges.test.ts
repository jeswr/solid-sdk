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
import { applyGrant } from "./acl.js";
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
const INDEX = `${POD}settings/publicTypeIndex.ttl`;
const RECORDS = `${POD}settings/access-records/`;
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

describe("conditional ACL grant port", () => {
  it("preserves unrelated grants, avoids widening multi-scope nodes and reuses exact grants", async () => {
    const pod = buildPod();
    const url = `${ALICE}.acl`;
    pod.seed(
      url,
      `${PREFIXES}
<${url}#multi> a acl:Authorization; acl:accessTo <${ALICE}>, <${POD}other>; acl:agent <${OWNER}>; acl:mode acl:Read.
<${url}#default> a acl:Authorization; acl:accessTo <${ALICE}>; acl:default <${POD}>; acl:agent <${OWNER}>; acl:mode acl:Read.
<${url}#group> a acl:Authorization; acl:accessTo <${ALICE}>; acl:agentGroup <https://group.example/>; acl:mode acl:Read.
<${url}#origin> a acl:Authorization; acl:accessTo <${ALICE}>; acl:origin <https://origin.example/>; acl:mode acl:Read.
<${url}#public> a acl:Authorization; acl:accessTo <${ALICE}>; acl:agentClass foaf:Agent; acl:mode acl:Read.
<${url}#none> a acl:Authorization; acl:mode acl:Read.`,
    );
    let conflict = true;
    pod.intercept = (method, target, init) => {
      if (method === "PUT" && target === url) {
        expect(new Headers(init?.headers).get("if-match")).not.toBeNull();
        if (conflict) {
          conflict = false;
          return new Response(null, { status: 412 });
        }
      }
    };
    await applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch);
    const dataset = await graph(pod.body(url) as string);
    expect(values(dataset, `${url}#multi`, ACL.agent)).toEqual([OWNER]);
    expect(values(dataset, `${url}#grant-0`, ACL.agent)).toEqual([REQUESTER]);
    await applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch);
    await applyGrant(ALICE, POD, OWNER, REQUESTER, ["append"], pod.fetch);
    expect(pod.body(url)).toContain("grant-1");
  });

  it("materializes inherited container ACLs, preserving group/origin/default semantics", async () => {
    const pod = buildPod();
    const target = `${POD}contacts/`;
    pod.seed(
      `${POD}.acl`,
      `${pod.body(`${POD}.acl`)} ${PREFIXES}<${POD}.acl#group> a acl:Authorization; acl:agentGroup <https://group.example/>; acl:origin <https://origin.example/>; acl:default <${POD}>; acl:mode acl:Read. <${POD}.acl#unrelated> a acl:Authorization; acl:accessTo <${POD}>; acl:mode acl:Read.`,
    );
    await applyGrant(target, POD, OWNER, REQUESTER, ["append"], pod.fetch);
    expect(pod.body(`${target}.acl`)).toContain("group.example");
    expect(pod.body(`${target}.acl`)).toContain("origin.example");
    expect(pod.body(`${target}.acl`)).toContain("default");
    const blankPod = buildPod();
    blankPod.seed(
      `${POD}.acl`,
      `${PREFIXES}[] a acl:Authorization; acl:agent <${REQUESTER}>; acl:default <${POD}>; acl:mode acl:Read.`,
    );
    await applyGrant(target, POD, OWNER, "https://another.example/", ["append"], blankPod.fetch);
    expect(blankPod.body(`${target}.acl`)).toContain(REQUESTER);
    pod.delete(`${POD}.acl`);
    await expect(
      applyGrant(`${POD}other/x`, POD, OWNER, REQUESTER, ["read"], pod.fetch),
    ).rejects.toThrow("No effective ACL");
  });

  it("reconciles a create race, refuses ACP/foreign ACL links, and fails after bounded races", async () => {
    const pod = buildPod();
    const url = `${ALICE}.acl`;
    let race = true;
    pod.intercept = (method, target, init) => {
      if (
        race &&
        method === "PUT" &&
        target === url &&
        new Headers(init?.headers).has("if-none-match")
      ) {
        race = false;
        pod.seed(url, String(init?.body));
      }
    };
    await applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch);
    pod.intercept = (method) =>
      method === "PUT" ? new Response(null, { status: 412 }) : undefined;
    await expect(applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch)).rejects.toThrow(
      "three",
    );
    for (const link of [
      '<x>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
      "<https://evil.example/x>; rel=acl",
    ]) {
      pod.intercept = (method) =>
        method === "HEAD" ? new Response(null, { headers: { link } }) : undefined;
      await expect(applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch)).rejects.toThrow();
    }
    pod.intercept = (method) => (method === "HEAD" ? new Response(null) : undefined);
    await applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch);
    pod.delete(url);
    pod.intercept = (method) =>
      method === "PUT" ? new Response(null, { status: 412 }) : undefined;
    await expect(applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch)).rejects.toThrow(
      "three",
    );
  });
});

describe("forward-only approval reconciliation", () => {
  async function orphan(pod: ReturnType<typeof buildPod>) {
    pod.intercept = (method, url) => {
      if (method === "PUT" && url.startsWith(RECORDS)) throw new Error("crash");
    };
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow("crash");
    pod.intercept = undefined;
    const dataset = await graph(pod.body(ID) as string);
    return {
      dataset,
      snapshot: JSON.parse(values(dataset, ID, `${ACCM.ns}snapshot`)[0] as string),
    };
  }

  it("rejects corrupt or missing persisted snapshots before records or ACL writes", async () => {
    const pod = buildPod();
    const { dataset, snapshot } = await orphan(pod);
    for (const change of [
      { schemaVersion: "2" },
      { targets: [] },
      { targets: Array(MAX_MEMBERS + 1).fill(ALICE) },
      { modes: [] },
      { modes: ["control"] },
      { grantId: "forged" },
      { targets: ["https://evil.example/x"] },
      { targets: [`${ALICE}.acl`] },
    ]) {
      const forged = { ...snapshot, ...change };
      if (change.targets?.length === 1)
        forged.grantId = await deriveGrantId(ID, forged.targets, OWNER);
      set(dataset, ID, `${ACCM.ns}snapshot`, JSON.stringify(forged));
      pod.seed(ID, await turtle(dataset));
      const before = pod.log.length;
      await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow();
      expect(pod.log.slice(before).some(({ method }) => method === "PUT")).toBe(false);
    }
    set(dataset, ID, `${ACCM.ns}snapshot`, undefined);
    pod.seed(ID, await turtle(dataset));
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
      "Missing persisted",
    );
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
    const label = accessRequestTurtle(ID)
      .replace("odrl:read", `<${ACL.Append}>`)
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
