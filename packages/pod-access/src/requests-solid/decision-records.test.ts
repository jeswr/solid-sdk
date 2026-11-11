// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// Sealed, per-generation decision records: the records key, requester-bound grant and receipt
// ids, refused targets, resuming only with the same choices, and every race on the way.
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import {
  type Asked,
  accessRequestTurtle,
  buildPod,
  CONTACTS_CLASS,
  decisionUrl,
  denialReceiptUrl,
  grantIdFor,
  legacyIntentUrl,
  OWNER,
  POD,
  PREFIXES,
  RECORDS,
  REQUEST,
  REQUESTER,
  recordTurtle,
  sealedKey,
} from "../../test/requests/fixtures.js";
import type { PodStub } from "../../test/requests/pod-stub.js";
import { ACCM, ACL, decide, listRequests, previewDecision, RequestConflictError } from "./index.js";
import { set, turtle, values } from "./rdf.js";

const ID = REQUEST;
const ALICE = `${POD}contacts/alice.ttl`;
const CAROL = `${POD}contacts/carol.ttl`;
const INDEX = `${POD}settings/publicTypeIndex.ttl`;
const CALENDAR = "http://www.w3.org/2002/12/cal/ical#Vevent";
const READ_WRITE: Asked = { [CONTACTS_CLASS]: ["read", "write"] };

const opts = (pod: PodStub) => ({
  fetch: pod.fetch,
  webId: OWNER,
  storage: POD,
  publicFetch: async () => new Response(null, { status: 404 }),
});
const puts = (pod: PodStub, from = 0) =>
  pod.log.slice(from).filter(({ method }) => method === "PUT");
/** The fixture request, asking to read and change contacts. */
const readWrite = () =>
  accessRequestTurtle(ID).replace(
    "odrl:permission [",
    `odrl:permission [ odrl:assignee <${REQUESTER}>; odrl:action odrl:write; odrl:target <${CONTACTS_CLASS}> ], [`,
  );
const ownerOnly = (extra = "") => `${PREFIXES}<${RECORDS}.acl#owner> a acl:Authorization;
  acl:agent <${OWNER}>; acl:accessTo <${RECORDS}>; acl:default <${RECORDS}>;
  acl:mode acl:Read, acl:Write, acl:Control.
${extra}`;
/** The modes an ACL gives `agent`. */
async function modesOf(pod: PodStub, acl: string, agent = REQUESTER): Promise<string[]> {
  const dataset = await parseRdf(pod.body(acl) ?? "", "text/turtle");
  const modes = new Set<string>();
  for (const quad of dataset.match(null, null, null))
    if (quad.predicate.value === ACL.agent && quad.object.value === agent)
      for (const mode of values(dataset, quad.subject, ACL.mode)) modes.add(mode);
  return [...modes].sort();
}
async function record(pod: PodStub, url: string) {
  const dataset = await parseRdf(pod.body(url) as string, "text/turtle");
  const stored = values(dataset, url, `${ACCM.ns}snapshot`)[0];
  return {
    outcome: values(dataset, url, `${ACCM.ns}outcome`)[0],
    snapshot: stored === undefined ? undefined : JSON.parse(stored),
  };
}
/** Crash on the request's own CAS, leaving a pinned decision and a pending request. */
async function pinOnly(pod: PodStub, decision: Parameters<typeof decide>[1] = { approve: true }) {
  pod.intercept = (method, url) =>
    method === "PUT" && url === ID ? new Response(null, { status: 500 }) : undefined;
  await expect(decide({ id: ID }, decision, opts(pod))).rejects.toThrow("500");
  pod.intercept = undefined;
  expect((await listRequests(opts(pod)))[0]).toMatchObject({ status: "pending" });
}
/** A planted approval of the whole storage, the worst a pre-seal writer could pin. */
const plantedSnapshot = (grantId: string) => ({
  grantId,
  targets: [POD],
  agent: REQUESTER,
  modes: ["append", "read", "write"],
  targetModes: { [POD]: ["append", "read", "write"] },
  dataTypes: [CONTACTS_CLASS],
  schemaVersion: "1",
  decidedAt: "2026-11-01T00:00:00.000Z",
  chosen: { dataTypes: [CONTACTS_CLASS], viewer: false },
});

describe("sealed records key", () => {
  it("never trusts a file planted while the folder was being sealed, at any name", async () => {
    const pod = buildPod();
    const legacy = await legacyIntentUrl();
    const guessed = await decisionUrl(pod, { key: "guessed" });
    const bodies = await Promise.all(
      [legacy, guessed].map(async (url) => ({
        url,
        body: await recordTurtle(url, {
          outcome: "approving",
          snapshot: plantedSnapshot("forged"),
        }),
      })),
    );
    // The listing has already been checked when the mark is removed; files land just then.
    pod.intercept = (method, url, init) => {
      if (
        method === "PUT" &&
        url === `${RECORDS}.acl` &&
        new Headers(init?.headers).has("if-match")
      )
        for (const { url, body } of bodies) pod.seed(url, body);
      return undefined;
    };
    const result = await decide({ id: ID }, { approve: true }, opts(pod));
    pod.intercept = undefined;
    expect(result.status).toBe("approved");
    expect(sealedKey(pod)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await modesOf(pod, `${ALICE}.acl`)).toEqual([ACL.Read]);
    expect(await modesOf(pod, `${POD}.acl`)).toEqual([]);
    expect(pod.etag(legacy)).toBe('"v1"');
    expect(pod.etag(guessed)).toBe('"v1"');
    expect((await record(pod, await decisionUrl(pod))).outcome).toBe("approved");
  });

  it("refuses to orphan records in a private folder that has no key", async () => {
    // Sealed by older code (or its key went missing): private, no unverified mark, no key.
    const pod = buildPod();
    const legacy = await legacyIntentUrl();
    pod.seed(RECORDS, "");
    pod.seed(`${RECORDS}.acl`, ownerOnly());
    pod.seed(legacy, await recordTurtle(legacy, { snapshot: plantedSnapshot("old") }));
    for (const approve of [true, false]) {
      const before = pod.log.length;
      await expect(decide({ id: ID }, { approve }, opts(pod))).rejects.toThrow(
        "The access records folder has records this version can't read; move them out of settings/access-records/ first",
      );
      expect(puts(pod, before)).toEqual([]);
    }
    expect(sealedKey(pod)).toBeUndefined();
    expect(await modesOf(pod, `${ALICE}.acl`)).toEqual([]);
    expect((await listRequests(opts(pod)))[0]).toMatchObject({ status: "pending" });
    // Once the old records are moved out, the empty folder gets a key and decisions go ahead.
    pod.delete(legacy);
    expect((await decide({ id: ID }, { approve: true }, opts(pod))).status).toBe("approved");
    expect(sealedKey(pod)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await modesOf(pod, `${POD}.acl`)).toEqual([]);
  });

  it("mints a key for an empty private folder that has none", async () => {
    const pod = buildPod();
    pod.seed(RECORDS, "");
    pod.seed(`${RECORDS}.acl`, ownerOnly());
    const result = await decide({ id: ID }, { approve: false }, opts(pod));
    expect(result.status).toBe("denied");
    const key = sealedKey(pod);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(pod.body(`${RECORDS}.acl`)).not.toContain("unverifiedRecords");
    expect((await record(pod, await decisionUrl(pod))).outcome).toBe("denied");
  });

  it("replaces a records key found next to the unverified mark", async () => {
    const pod = buildPod();
    pod.seed(RECORDS, "");
    pod.seed(
      `${RECORDS}.acl`,
      ownerOnly(`<${RECORDS}.acl> accm:unverifiedRecords "true"; accm:recordsKey "planted".`),
    );
    const planted = await decisionUrl(pod, { key: "planted" });
    const body = await recordTurtle(planted, {
      outcome: "approving",
      snapshot: plantedSnapshot(await grantIdFor(planted, [POD])),
    });
    // A record at the planted key's name lands after the emptiness check.
    pod.intercept = (method, url, init) => {
      if (
        method === "PUT" &&
        url === `${RECORDS}.acl` &&
        new Headers(init?.headers).has("if-match")
      )
        pod.seed(planted, body);
      return undefined;
    };
    expect((await decide({ id: ID }, { approve: true }, opts(pod))).status).toBe("approved");
    pod.intercept = undefined;
    const key = sealedKey(pod);
    expect(key).not.toBe("planted");
    const acl = await parseRdf(pod.body(`${RECORDS}.acl`) as string, "text/turtle");
    expect(values(acl, `${RECORDS}.acl`, `${ACCM.ns}recordsKey`)).toEqual([key]);
    expect(values(acl, `${RECORDS}.acl`, `${ACCM.ns}unverifiedRecords`)).toEqual([]);
    expect(await modesOf(pod, `${POD}.acl`)).toEqual([]);
    expect(pod.etag(planted)).toBe('"v1"');
  });

  it("seals even when the server lists the folder's own ACL as a member", async () => {
    const pod = buildPod();
    pod.intercept = (method, url) =>
      method === "GET" && url === RECORDS && pod.has(`${RECORDS}.acl`)
        ? new Response(`<${RECORDS}> <http://www.w3.org/ns/ldp#contains> <${RECORDS}.acl> .`, {
            headers: { "content-type": "text/turtle" },
          })
        : undefined;
    expect((await decide({ id: ID }, { approve: true }, opts(pod))).status).toBe("approved");
    expect(sealedKey(pod)).toBeDefined();
    expect(pod.body(`${RECORDS}.acl`)).not.toContain("unverifiedRecords");
  });

  it("retries a lost race to remove the mark, and gives up after three", async () => {
    for (const losses of [1, 3]) {
      const pod = buildPod();
      let lost = 0;
      pod.intercept = (method, url, init) =>
        method === "PUT" &&
        url === `${RECORDS}.acl` &&
        new Headers(init?.headers).has("if-match") &&
        lost++ < losses
          ? new Response(null, { status: 412 })
          : undefined;
      const operation = decide({ id: ID }, { approve: true }, opts(pod));
      if (losses === 1) {
        expect((await operation).status).toBe("approved");
        expect(sealedKey(pod)).toBeDefined();
      } else {
        await expect(operation).rejects.toThrow("kept changing");
        expect(pod.body(`${RECORDS}.acl`)).toContain("unverifiedRecords");
      }
    }
  });

  it("stops when the records folder becomes unreadable between the peek and the seal", async () => {
    const pod = buildPod();
    let heads = 0;
    pod.intercept = (method, url) =>
      method === "HEAD" && url === RECORDS && heads++ > 0
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(decide({ id: ID }, { approve: false }, opts(pod))).rejects.toThrow(
      "Records folder check failed (503)",
    );
    expect(puts(pod)).toEqual([]);
  });
});

describe("refused targets", () => {
  it("refuses a pinned snapshot that targets the storage root or the owner's settings", async () => {
    for (const target of [
      POD,
      `${POD}?x`,
      INDEX,
      `${POD}settings/prefs.ttl`,
      `${POD}settings`,
      `${POD}%73ettings/prefs.ttl`,
      `${POD}contacts/./../settings/prefs.ttl`,
      `${POD}/settings/prefs.ttl`,
      `${POD}contacts//alice.ttl`,
      `${POD}Settings/prefs.ttl`,
      `${POD}contacts/%61lice.ttl`,
      `${POD}contacts/%2e%2e/settings/prefs.ttl`,
      `${POD}contacts/a%00.ttl`,
      `${POD}contacts/a%C3.ttl`,
      `${POD}contacts/alice.ttl.ACL`,
      `${POD}contacts/x.ACR`,
      `${POD}contacts/alice.ttl.meta`,
      `${POD}contacts/alice.ttl.META`,
      `${POD}contacts/alice.ttl.meta.`,
      `${POD}contacts/alice.ttl.meta%20`,
      `${POD}contacts/.meta`,
      `${POD}%C5%BFettings/prefs.ttl`,
      `${POD}contacts/alice.ttl.acl.`,
      `${POD}settings%20/prefs.ttl`,
      `${POD}contacts/alice.ttl::$DATA`,
      `${POD}contacts/100%25.ttl`,
    ]) {
      const pod = buildPod();
      await pinOnly(pod);
      const slot = await decisionUrl(pod);
      const snapshot = {
        ...plantedSnapshot(await grantIdFor(slot, [target])),
        targets: [target],
        modes: ["read"],
        targetModes: { [target]: ["read"] },
      };
      pod.seed(slot, await recordTurtle(slot, { outcome: "approving", snapshot }));
      const before = pod.log.length;
      await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
        "can't be shared",
      );
      expect(puts(pod, before)).toEqual([]);
    }
  });

  it("refuses a Type Index registration resolving to the storage root or settings before any write", async () => {
    for (const registration of [
      `solid:instance <${POD}>`,
      `solid:instance <${INDEX}#it>`,
      `solid:instanceContainer <${POD}settings/>`,
    ]) {
      const pod = buildPod();
      pod.seed(
        INDEX,
        `${PREFIXES}<${INDEX}#r> a solid:TypeRegistration; solid:forClass <${CONTACTS_CLASS}>; ${registration}.`,
      );
      await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
        "can't be shared",
      );
      expect(puts(pod)).toEqual([]);
    }
  });

  it("refuses a Type Index registration naming an access-control or metadata document", async () => {
    for (const instance of [`${POD}contacts/alice.ttl.meta`, `${POD}contacts/alice.ttl.Meta#it`]) {
      const pod = buildPod();
      pod.seed(
        INDEX,
        `${PREFIXES}<${INDEX}#r> a solid:TypeRegistration; solid:forClass <${CONTACTS_CLASS}>; solid:instance <${instance}>.`,
      );
      await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
        "metadata documents cannot be targets",
      );
      expect(puts(pod)).toEqual([]);
    }
  });

  it("still shares ordinary encoded names such as spaces and accented letters", async () => {
    const pod = buildPod();
    const spaced = `${POD}contacts/John%20Smith.ttl`;
    const accented = `${POD}contacts/caf%C3%A9.ttl`;
    const reserved = `${POD}contacts/a:b@c.ttl`;
    pod.seed(reserved, `<${reserved}#me> a <${CONTACTS_CLASS}>.`);
    pod.seed(spaced, `<${spaced}#me> a <${CONTACTS_CLASS}>.`);
    pod.seed(accented, `<${accented}#me> a <${CONTACTS_CLASS}>.`);
    const result = await decide({ id: ID }, { approve: true }, opts(pod));
    expect(result.status).toBe("approved");
    for (const target of [spaced, accented, reserved])
      expect(pod.body(`${target}.acl`)).toContain(REQUESTER);
  });

  it("compares normalised targets against storage below the origin root", async () => {
    const storage = `${POD}alice/`;
    const id = `${storage}inbox/request-1.ttl`;
    const index = `${storage}settings/publicTypeIndex.ttl`;
    // Model detection never walks above the storage root, so the storage has its own ACL.
    const ownAcl = (pod: PodStub) =>
      pod.seed(
        `${storage}.acl`,
        `${PREFIXES}<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read, acl:Write, acl:Control.`,
      );
    for (const instance of [
      `${POD}alice`,
      `${storage}?x`,
      `${POD}alice?x`,
      `${storage}%73ettings/prefs.ttl`,
      `${storage}settings/prefs.ttl`,
      `${storage}settings`,
    ]) {
      const pod = buildPod();
      pod.seed(id, accessRequestTurtle(id));
      ownAcl(pod);
      const typeIndex = await parseRdf(
        `${PREFIXES}<${index}#r> a solid:TypeRegistration; solid:forClass <${CONTACTS_CLASS}>; solid:instance <${instance}>.`,
        "text/turtle",
      );
      await expect(
        decide({ id }, { approve: true }, { ...opts(pod), storage, typeIndex }),
      ).rejects.toThrow("can't be shared");
      expect(puts(pod)).toEqual([]);
    }
    // A slashless storage option names the same root.
    const pod = buildPod();
    pod.seed(id, accessRequestTurtle(id));
    ownAcl(pod);
    const typeIndex = await parseRdf(
      `${PREFIXES}<${index}#r> a solid:TypeRegistration; solid:forClass <${CONTACTS_CLASS}>; solid:instance <${storage}>.`,
      "text/turtle",
    );
    await expect(
      decide({ id }, { approve: true }, { ...opts(pod), storage: `${POD}alice`, typeIndex }),
    ).rejects.toThrow("can't be shared");
    expect(puts(pod)).toEqual([]);
  });
});

describe("requester-bound grants and receipts", () => {
  it("gives identical requests from different requesters different grant and receipt ids", async () => {
    const other = "https://other.example/profile#me";
    const approvals: string[] = [];
    const denials: string[] = [];
    for (const decision of [{ approve: true }, { approve: false }]) {
      const pod = buildPod();
      for (const requester of [REQUESTER, other]) {
        pod.seed(ID, accessRequestTurtle(ID).replaceAll(REQUESTER, requester));
        const result = await decide({ id: ID }, decision, opts(pod));
        const slot = await decisionUrl(pod, { requester });
        if (decision.approve) {
          expect(result.grantUrl).toBe(
            `${RECORDS}grant-${await grantIdFor(slot, [ALICE, CAROL])}.ttl`,
          );
          approvals.push(result.grantUrl as string, result.receiptUrl);
          expect(pod.body(result.grantUrl as string)).toContain(requester);
        } else {
          expect(result.receiptUrl).toBe(await denialReceiptUrl(slot));
          denials.push(result.receiptUrl);
        }
        expect(pod.body(result.receiptUrl)).toContain(requester);
      }
    }
    expect(new Set(approvals).size).toBe(4);
    expect(new Set(denials).size).toBe(2);
  });
});

describe("per-generation decision records", () => {
  it("decides a new identical request at a reused URL afresh, after an approval or a denial", async () => {
    for (const first of [true, false]) {
      const pod = buildPod();
      pod.seed(ID, readWrite());
      const earlier = await decide({ id: ID }, { approve: first }, opts(pod));
      const gen0 = await decisionUrl(pod, { asked: READ_WRITE });
      const settled = pod.etag(gen0);
      expect((await record(pod, gen0)).outcome).toBe(first ? "approved" : "denied");
      if (first) expect(await modesOf(pod, `${ALICE}.acl`)).toContain(ACL.Write);
      // Access was revoked, the notification removed, and the same request arrives again.
      pod.delete(`${ALICE}.acl`);
      pod.delete(`${CAROL}.acl`);
      pod.seed(ID, readWrite());
      const result = await decide({ id: ID }, { approve: true, role: "viewer" }, opts(pod));
      expect(result.status).toBe("approved");
      expect(pod.etag(gen0)).toBe(settled);
      const gen1 = await decisionUrl(pod, { asked: READ_WRITE, generation: 1 });
      const { outcome, snapshot } = await record(pod, gen1);
      expect(outcome).toBe("approved");
      expect(snapshot).toMatchObject({ modes: ["read"], chosen: { viewer: true } });
      expect(result.grantUrl).toBe(`${RECORDS}grant-${await grantIdFor(gen1, [ALICE, CAROL])}.ttl`);
      if (first) expect(result.grantUrl).not.toBe(earlier.grantUrl);
      expect(await modesOf(pod, `${ALICE}.acl`)).toEqual([ACL.Read]);
      expect(await modesOf(pod, `${CAROL}.acl`)).toEqual([ACL.Read]);
    }
  });

  it("consumes a pinned approval when the owner denies instead", async () => {
    const pod = buildPod();
    await pinOnly(pod, { approve: true, expiresAt: new Date("2028-01-01Z") });
    const gen0 = await decisionUrl(pod);
    expect((await record(pod, gen0)).outcome).toBe("approving");
    const denied = await decide({ id: ID }, { approve: false }, opts(pod));
    expect(denied.receiptUrl).toBe(await denialReceiptUrl(gen0));
    expect(await record(pod, gen0)).toEqual({ outcome: "denied", snapshot: undefined });
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
      "Cannot approve a denial",
    );
    // A later identical request is decided afresh: a different expiry is accepted, not refused.
    pod.seed(ID, accessRequestTurtle(ID));
    const result = await decide(
      { id: ID },
      { approve: true, expiresAt: new Date("2029-01-01Z") },
      opts(pod),
    );
    expect(pod.body(result.receiptUrl)).toContain("2029-01-01");
    expect((await record(pod, await decisionUrl(pod, { generation: 1 }))).outcome).toBe("approved");
  });

  it("consumes a pinned approval even when the denial crashed before recording it", async () => {
    const pod = buildPod();
    await pinOnly(pod, { approve: true, expiresAt: new Date("2028-01-01Z") });
    const gen0 = await decisionUrl(pod);
    pod.intercept = (method, url) =>
      method === "PUT" && url === gen0 ? new Response(null, { status: 500 }) : undefined;
    await expect(decide({ id: ID }, { approve: false }, opts(pod))).rejects.toThrow("500");
    pod.intercept = undefined;
    expect((await listRequests(opts(pod)))[0]).toMatchObject({ status: "denied" });
    const denied = await decide({ id: ID }, { approve: false }, opts(pod));
    expect(denied.receiptUrl).toBe(await denialReceiptUrl(gen0));
    expect((await record(pod, gen0)).outcome).toBe("denied");
    pod.seed(ID, accessRequestTurtle(ID));
    const result = await decide(
      { id: ID },
      { approve: true, expiresAt: new Date("2029-01-01Z") },
      opts(pod),
    );
    expect(pod.body(result.receiptUrl)).toContain("2029-01-01");
  });

  it("resumes a pinned approval only with the same explicit choices", async () => {
    const pod = buildPod();
    pod.seed(ID, readWrite());
    const expiresAt = new Date("2028-01-01Z");
    await pinOnly(pod, { approve: true, role: "editor", expiresAt });
    for (const changed of [
      { dataTypes: ["urn:other"] },
      { dataTypes: [CONTACTS_CLASS, "urn:other"] },
      { role: "viewer" as const },
      { expiresAt: new Date("2029-01-01Z") },
    ]) {
      const before = pod.log.length;
      await expect(decide({ id: ID }, { approve: true, ...changed }, opts(pod))).rejects.toThrow(
        "still finishing",
      );
      expect(puts(pod, before)).toEqual([]);
    }
    const result = await decide(
      { id: ID },
      { approve: true, dataTypes: [CONTACTS_CLASS, CONTACTS_CLASS], role: "editor", expiresAt },
      opts(pod),
    );
    expect(result.status).toBe("approved");
    // An omitted recorded role is a mismatch; repeating it resumes.
    const plain = buildPod();
    plain.seed(ID, readWrite());
    await pinOnly(plain, { approve: true, role: "viewer" });
    await expect(decide({ id: ID }, { approve: true }, opts(plain))).rejects.toThrow(
      "still finishing",
    );
    expect((await decide({ id: ID }, { approve: true, role: "viewer" }, opts(plain))).status).toBe(
      "approved",
    );
    expect(await modesOf(plain, `${ALICE}.acl`)).toEqual([ACL.Read]);
  });

  it("drops data types that grant no mode from the pinned decision", async () => {
    // Calendar is named but has no permission of its own.
    const unnamed = buildPod();
    unnamed.seed(
      ID,
      `${PREFIXES}<${ID}> a odrl:Offer; odrl:uid <${ID}>; accm:dataClass <${CONTACTS_CLASS}>, <${CALENDAR}>;
  odrl:permission [ odrl:assignee <${REQUESTER}>; odrl:action odrl:read; odrl:target <${CONTACTS_CLASS}> ].`,
    );
    expect((await decide({ id: ID }, { approve: true }, opts(unnamed))).status).toBe("approved");
    const first = await record(unnamed, await decisionUrl(unnamed));
    expect(first.snapshot.dataTypes).toEqual([CONTACTS_CLASS]);
    expect(first.snapshot.chosen.dataTypes).toEqual([CALENDAR, CONTACTS_CLASS].sort());
    // A viewer approval drops a type that only asked to change data.
    const writeOnly = buildPod();
    writeOnly.seed(
      ID,
      `${PREFIXES}<${ID}> a odrl:Offer; odrl:uid <${ID}>;
  odrl:permission [ odrl:assignee <${REQUESTER}>; odrl:action odrl:read; odrl:target <${CONTACTS_CLASS}> ],
    [ odrl:assignee <${REQUESTER}>; odrl:action odrl:write; odrl:target <${CALENDAR}> ].`,
    );
    const result = await decide({ id: ID }, { approve: true, role: "viewer" }, opts(writeOnly));
    expect(result.choices?.dataTypes).toEqual([CONTACTS_CLASS]);
    const asked = { [CONTACTS_CLASS]: ["read"], [CALENDAR]: ["write"] };
    const second = await record(writeOnly, await decisionUrl(writeOnly, { asked }));
    expect(second.snapshot).toMatchObject({ dataTypes: [CONTACTS_CLASS], modes: ["read"] });
  });

  it("refuses a request decided too many times at the same URL", async () => {
    const pod = buildPod();
    pod.seed(RECORDS, "");
    pod.seed(`${RECORDS}.acl`, ownerOnly(`<${RECORDS}.acl> accm:recordsKey "k".`));
    for (let generation = 0; generation < 32; generation++) {
      const url = await decisionUrl(pod, { generation });
      pod.seed(url, await recordTurtle(url, { outcome: "denied" }));
    }
    const before = pod.log.length;
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
      "decided too many times",
    );
    expect(puts(pod, before)).toEqual([]);
  });

  it("rejects a decision record that is not one of ours", async () => {
    const pod = buildPod();
    await pinOnly(pod);
    const slot = await decisionUrl(pod);
    const { snapshot } = await record(pod, slot);
    for (const forged of [
      { id: `${POD}inbox/other.ttl`, outcome: "approving", snapshot },
      { outcome: "granted", snapshot },
      { outcome: "approving" },
      { outcome: "denied", snapshot },
      { snapshot },
    ]) {
      pod.seed(slot, await recordTurtle(slot, forged));
      const before = pod.log.length;
      await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
        "Decision record does not match",
      );
      expect(puts(pod, before)).toEqual([]);
    }
  });
});

describe("races on the decision record", () => {
  /** Answer the owner's create-only pin with 412, after `winner` puts its own record there. */
  function racePin(pod: PodStub, winner: (url: string, body: string) => Promise<string | null>) {
    pod.intercept = (method, url, init) => {
      if (method !== "PUT" || !url.includes("/decision-")) return undefined;
      if (new Headers(init?.headers).get("if-none-match") !== "*") return undefined;
      pod.intercept = undefined;
      return (async () => {
        const body = await winner(url, String(init?.body));
        if (body !== null) pod.seed(url, body);
        return new Response(null, { status: 412 });
      })() as unknown as Response;
    };
  }

  it("resumes a concurrent pin with the same choices and refuses one with different choices", async () => {
    const same = buildPod();
    racePin(same, async (_url, body) => body);
    expect((await decide({ id: ID }, { approve: true }, opts(same))).status).toBe("approved");
    expect(await modesOf(same, `${ALICE}.acl`)).toEqual([ACL.Read]);

    const viewer = buildPod();
    racePin(viewer, async (url, body) => {
      const dataset = await parseRdf(body, "text/turtle");
      const snapshot = JSON.parse(values(dataset, url, `${ACCM.ns}snapshot`)[0] as string);
      snapshot.chosen.viewer = true;
      set(dataset, url, `${ACCM.ns}snapshot`, JSON.stringify(snapshot));
      return turtle(dataset);
    });
    await expect(
      decide({ id: ID }, { approve: true, role: "editor" }, opts(viewer)),
    ).rejects.toThrow("still finishing");
    expect(viewer.has(`${ALICE}.acl`)).toBe(false);

    for (const winner of [
      async (url: string) => recordTurtle(url, { outcome: "denied" }),
      async () => null,
    ]) {
      const pod = buildPod();
      racePin(pod, winner);
      await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toBeInstanceOf(
        RequestConflictError,
      );
      expect(pod.has(`${ALICE}.acl`)).toBe(false);
      expect((await listRequests(opts(pod)))[0]).toMatchObject({ status: "pending" });
    }
  });

  it("reports the request's real status when the pin loses to a finished decision", async () => {
    for (const approve of [false, true]) {
      const pod = buildPod();
      // Another call decides the request completely between this call's lookup and its pin.
      racePin(pod, async () => {
        await decide({ id: ID }, { approve }, opts(pod));
        return null;
      });
      const error = await decide({ id: ID }, { approve: true }, opts(pod)).catch((e) => e);
      expect(error).toBeInstanceOf(RequestConflictError);
      expect(error.current).toBe(approve ? "approved" : "denied");
      expect((await record(pod, await decisionUrl(pod))).outcome).toBe(
        approve ? "approved" : "denied",
      );
      expect((await listRequests(opts(pod)))[0]).toMatchObject({
        status: approve ? "approved" : "denied",
      });
      if (!approve) expect(pod.has(`${ALICE}.acl`)).toBe(false);
    }
  });

  it("lets a denial that wins after the pin, before the Approving CAS, stand", async () => {
    const pod = buildPod();
    pod.intercept = (method, url, init) => {
      if (method !== "PUT" || url !== ID) return undefined;
      pod.intercept = undefined;
      return (async () => {
        // The denier finishes first; the approver's CAS then runs against a stale ETag.
        await decide({ id: ID }, { approve: false }, opts(pod));
        return pod.fetch(url, init);
      })() as unknown as Response;
    };
    const error = await decide({ id: ID }, { approve: true }, opts(pod)).catch((e) => e);
    expect(error).toBeInstanceOf(RequestConflictError);
    expect(error.current).toBe("denied");
    const gen0 = await decisionUrl(pod);
    expect(await record(pod, gen0)).toEqual({ outcome: "denied", snapshot: undefined });
    expect(pod.body(await denialReceiptUrl(gen0))).toContain("ConsentRefused");
    expect((await listRequests(opts(pod)))[0]).toMatchObject({ status: "denied" });
    expect(pod.has(`${ALICE}.acl`)).toBe(false);
    expect(pod.has(`${CAROL}.acl`)).toBe(false);
    expect(pod.log.some(({ method, url }) => method === "PUT" && url.includes("/grant-"))).toBe(
      false,
    );
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
      "Cannot approve a denial",
    );
  });

  it("consumes a stale approval still in progress when a newer request at the URL is denied", async () => {
    const pod = buildPod();
    // The older request reached Approving, then crashed before its grant was written.
    pod.intercept = (method, url) => {
      if (method === "PUT" && url.includes("/grant-")) throw new Error("crash");
    };
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow("crash");
    pod.intercept = undefined;
    const gen0 = await decisionUrl(pod);
    expect((await record(pod, gen0)).outcome).toBe("approving");
    // A newer, identical request replaces the notification and the owner denies it.
    pod.seed(ID, accessRequestTurtle(ID));
    const denied = await decide({ id: ID }, { approve: false }, opts(pod));
    expect(denied.status).toBe("denied");
    expect(denied.receiptUrl).toBe(await denialReceiptUrl(gen0));
    expect(await record(pod, gen0)).toEqual({ outcome: "denied", snapshot: undefined });
    expect(pod.has(`${ALICE}.acl`)).toBe(false);
    // The stale approval never resumes: the next request at the URL starts a new generation.
    pod.seed(ID, accessRequestTurtle(ID));
    expect((await decide({ id: ID }, { approve: true }, opts(pod))).status).toBe("approved");
    expect((await record(pod, gen0)).outcome).toBe("denied");
    expect((await record(pod, await decisionUrl(pod, { generation: 1 }))).outcome).toBe("approved");
  });

  it("settles a record that changed underneath, and refuses one recorded differently", async () => {
    const settle = (pod: PodStub, onLoss: (url: string) => Promise<void>, losses = 1) => {
      let lost = 0;
      pod.intercept = (method, url, init) => {
        if (
          method !== "PUT" ||
          !url.includes("/decision-") ||
          !new Headers(init?.headers).has("if-match") ||
          lost++ >= losses
        )
          return undefined;
        return onLoss(url).then(() => new Response(null, { status: 412 })) as unknown as Response;
      };
    };
    // Someone else touched the record without changing it: the retry settles it.
    const touched = buildPod();
    settle(touched, async (url) => {
      touched.seed(url, touched.body(url) as string);
    });
    expect((await decide({ id: ID }, { approve: true }, opts(touched))).status).toBe("approved");
    expect((await record(touched, await decisionUrl(touched))).outcome).toBe("approved");
    // A concurrent resumer settled it first.
    const finished = buildPod();
    settle(finished, async (url) => {
      const { snapshot } = await record(finished, url);
      finished.seed(url, await recordTurtle(url, { outcome: "approved", snapshot }));
    });
    expect((await decide({ id: ID }, { approve: true }, opts(finished))).status).toBe("approved");
    // It was recorded as a denial meanwhile.
    const denied = buildPod();
    settle(denied, async (url) => {
      denied.seed(url, await recordTurtle(url, { outcome: "denied" }));
    });
    await expect(decide({ id: ID }, { approve: true }, opts(denied))).rejects.toThrow(
      "recorded differently",
    );
    // Three lost races in a row.
    const busy = buildPod();
    settle(busy, async () => undefined, 3);
    await expect(decide({ id: ID }, { approve: true }, opts(busy))).rejects.toThrow(
      "decision record kept changing",
    );
    busy.intercept = undefined;
    // The request itself is approved; settling the record again finishes it.
    expect((await decide({ id: ID }, { approve: true }, opts(busy))).status).toBe("approved");
    expect((await record(busy, await decisionUrl(busy))).outcome).toBe("approved");
  });

  it("throws the grant's own error when the status re-read fails too", async () => {
    const pod = buildPod();
    let failed = false;
    pod.intercept = (method, url) => {
      if (method === "PUT" && url === `${ALICE}.acl`) {
        failed = true;
        throw new Error("ACL write refused");
      }
      if (failed && method === "GET" && url === ID) throw new Error("request unreadable");
      return undefined;
    };
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
      "ACL write refused",
    );
  });
});

describe("recorded decision choices", () => {
  it("compares absent expiry and role as values in either direction", async () => {
    const expiry = new Date("2028-01-01Z");
    for (const [pinned, changed] of [
      [{}, { expiresAt: expiry }],
      [{ expiresAt: expiry }, {}],
      [{ role: "viewer" as const }, {}],
      [{ role: "editor" as const }, {}],
      [{}, { role: "editor" as const }],
    ]) {
      const pod = buildPod();
      await pinOnly(pod, { approve: true, ...pinned });
      const before = pod.log.length;
      await expect(decide({ id: ID }, { approve: true, ...changed }, opts(pod))).rejects.toThrow(
        "still finishing",
      );
      expect(puts(pod, before)).toEqual([]);
      expect((await decide({ id: ID }, { approve: true, ...pinned }, opts(pod))).status).toBe(
        "approved",
      );
    }
  });

  it("infers the applied role when resuming legacy records with only chosen.viewer", async () => {
    for (const role of ["editor", "viewer"] as const) {
      for (const resumedRole of [undefined, role]) {
        const pod = buildPod();
        pod.seed(ID, readWrite());
        await pinOnly(pod, { approve: true, role });
        const url = await decisionUrl(pod, { asked: READ_WRITE });
        const { snapshot } = await record(pod, url);
        delete snapshot.chosen.role;
        delete snapshot.targetDataTypes;
        // Legacy default Viewer approvals could have viewer=false: it meant no narrowing.
        snapshot.chosen.viewer = false;
        pod.seed(url, await recordTurtle(url, { outcome: "approving", snapshot }));
        const before = pod.log.length;
        for (const operation of [previewDecision, decide])
          await expect(
            operation(
              { id: ID },
              { approve: true, role: role === "editor" ? "viewer" : "editor" },
              opts(pod),
            ),
          ).rejects.toThrow(
            `An earlier approval of this request is still finishing with role "${role}"; omit role or repeat "${role}" to resume it`,
          );
        const decision = { approve: true, role: resumedRole };
        const expected = await previewDecision({ id: ID }, decision, opts(pod));
        expect(expected.targets.every((target) => target.role === role)).toBe(true);
        expect(puts(pod, before)).toEqual([]);
        expect((await decide({ id: ID }, decision, { ...opts(pod), expected })).status).toBe(
          "approved",
        );
        expect(await modesOf(pod, `${ALICE}.acl`)).toEqual(
          role === "editor" ? [ACL.Append, ACL.Read, ACL.Write] : [ACL.Read],
        );
      }
    }
  });

  it("returns applied types, role and expiry from the record on every replay", async () => {
    const pod = buildPod();
    pod.seed(ID, readWrite());
    const expiresAt = new Date("2028-01-01Z");
    const decision = { approve: true, role: "viewer" as const, expiresAt };
    await pinOnly(pod, decision);
    const applied = await decide({ id: ID }, decision, opts(pod));
    expect(applied.choices).toEqual({
      dataTypes: [CONTACTS_CLASS],
      role: "viewer",
      targetRoles: { [ALICE]: "viewer", [CAROL]: "viewer" },
      expiresAt,
    });
    const replay = await decide(
      { id: ID },
      { approve: true, role: "editor", expiresAt: new Date("2029-01-01Z") },
      opts(pod),
    );
    expect(replay).toEqual(applied);
    expect(pod.body(replay.receiptUrl)).toContain("2028-01-01");
    expect(await modesOf(pod, `${ALICE}.acl`)).toEqual([ACL.Read]);
    replay.choices?.dataTypes.push("urn:caller-mutation");
    expect((await decide({ id: ID }, { approve: true }, opts(pod))).choices?.dataTypes).toEqual([
      CONTACTS_CLASS,
    ]);
  });

  it("resumes older WAC snapshots and refuses a persisted change of access model", async () => {
    const pod = buildPod();
    await pinOnly(pod);
    const url = await decisionUrl(pod);
    const { snapshot } = await record(pod, url);
    for (const change of [
      { model: "acp" },
      { model: "invalid" },
      { chosen: { ...snapshot.chosen, role: "manager" } },
    ]) {
      pod.seed(
        url,
        await recordTurtle(url, { outcome: "approving", snapshot: { ...snapshot, ...change } }),
      );
      const before = pod.log.length;
      await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow();
      expect(puts(pod, before)).toEqual([]);
    }
    delete snapshot.model;
    pod.seed(url, await recordTurtle(url, { outcome: "approving", snapshot }));
    expect((await decide({ id: ID }, { approve: true }, opts(pod))).status).toBe("approved");
  });
});
