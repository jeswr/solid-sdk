// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import {
  accessRequestTurtle,
  buildPod,
  CONTACTS_CLASS,
  decisionUrl,
  grantIdFor,
  INBOX,
  legacyIntentUrl,
  OWNER,
  POD,
  PREFIXES,
  RECORDS,
  REQUESTER,
  recordTurtle,
} from "../../test/requests/fixtures.js";
import { applyGrant } from "./acl.js";
import { ACL, decide, deriveGrantId, listRequests } from "./index.js";
import { values } from "./rdf.js";

const ID = `${INBOX}request-1.ttl`;
const ALICE = `${POD}contacts/alice.ttl`;
const INDEX = `${POD}settings/publicTypeIndex.ttl`;

const opts = (pod = buildPod()) => ({
  fetch: pod.fetch,
  webId: OWNER,
  storage: POD,
  publicFetch: async () => new Response(null, { status: 404 }),
});
const puts = (pod: ReturnType<typeof buildPod>, from = 0) =>
  pod.log.slice(from).filter(({ method }) => method === "PUT");

/** A requester-authored notification that already claims the owner approved it. */
async function forgedApproving(state: "Approving" | "Approved") {
  const grantId = await deriveGrantId(ID, [ALICE], OWNER);
  const snapshot = JSON.stringify({
    grantId,
    targets: [ALICE],
    agent: REQUESTER,
    modes: ["read", "write"],
    targetModes: { [ALICE]: ["read", "write"] },
    dataTypes: [CONTACTS_CLASS],
    schemaVersion: "1",
    decidedAt: "2026-11-01T00:00:00.000Z",
  });
  return `${accessRequestTurtle(ID)}
<${ID}> accm:status accm:${state}; accm:grantId "${grantId}"; accm:snapshot ${JSON.stringify(snapshot)} .`;
}

describe("owner-controlled approval records", () => {
  it("never resumes an approval the requester claims in its own notification", async () => {
    for (const state of ["Approving", "Approved"] as const) {
      const pod = buildPod();
      pod.seed(ID, await forgedApproving(state));
      const before = pod.log.length;
      await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
        "never recorded",
      );
      expect(puts(pod, before)).toEqual([]);
      expect(pod.has(`${ALICE}.acl`)).toBe(false);
      // The owner can still refuse it; nothing is granted.
      const denied = await decide({ id: ID }, { approve: false }, opts(pod));
      expect(denied.status).toBe("denied");
      expect(pod.has(`${ALICE}.acl`)).toBe(false);
      expect((await listRequests(opts(pod)))[0]).toMatchObject({ status: "denied" });
    }
  });

  it("re-denies a denial without a decision time using the current time", async () => {
    const pod = buildPod();
    pod.seed(ID, `${accessRequestTurtle(ID)}<${ID}> accm:status accm:Denied .`);
    const result = await decide({ id: ID }, { approve: false }, opts(pod));
    expect(result.status).toBe("denied");
    expect(pod.body(result.receiptUrl)).toContain("ConsentRefused");
  });

  it("resumes the first pinned decision when the request CAS failed after the pin", async () => {
    const pod = buildPod();
    pod.intercept = (method, url) =>
      method === "PUT" && url === ID ? new Response(null, { status: 500 }) : undefined;
    await expect(
      decide({ id: ID }, { approve: true, expiresAt: new Date("2028-01-01Z") }, opts(pod)),
    ).rejects.toThrow("500");
    pod.intercept = undefined;
    expect((await listRequests(opts(pod)))[0]).toMatchObject({ status: "pending" });
    const intent = await decisionUrl(pod);
    expect(pod.etag(intent)).toBe('"v1"');
    // A different explicit expiry is refused rather than silently ignored.
    await expect(
      decide({ id: ID }, { approve: true, expiresAt: new Date("2029-01-01Z") }, opts(pod)),
    ).rejects.toThrow("still finishing");
    const result = await decide({ id: ID }, { approve: true }, opts(pod));
    expect(result.status).toBe("approved");
    // The pinned record was resumed, then settled as approved.
    expect(pod.etag(intent)).toBe('"v2"');
    expect(pod.body(intent)).toContain('"approved"');
    expect(pod.body(result.receiptUrl)).toContain("2028-01-01");
    expect(pod.body(result.receiptUrl)).not.toContain("2029-01-01");
  });

  it("creates the records folder with an owner-only ACL before any record", async () => {
    const pod = buildPod();
    const result = await decide({ id: ID }, { approve: true }, opts(pod));
    const acl = await parseRdf(pod.body(`${RECORDS}.acl`) as string, "text/turtle");
    const auth = `${RECORDS}.acl#owner`;
    expect(values(acl, auth, ACL.agent)).toEqual([OWNER]);
    expect(values(acl, auth, ACL.default)).toEqual([RECORDS]);
    expect(values(acl, auth, ACL.mode).sort()).toEqual([ACL.Control, ACL.Read, ACL.Write].sort());
    const order = puts(pod).map(({ url }) => url);
    expect(order.indexOf(`${RECORDS}.acl`)).toBeLessThan(order.indexOf(result.grantUrl as string));
    // An existing private folder is reused as-is.
    const again = buildPod();
    again.seed(RECORDS, "");
    again.seed(`${RECORDS}.acl`, pod.body(`${RECORDS}.acl`) as string);
    await decide({ id: ID }, { approve: false }, opts(again));
    expect(again.etag(`${RECORDS}.acl`)).toBe('"v1"');
    // A rule that names no agent grants nobody and is ignored.
    const inert = buildPod();
    inert.seed(RECORDS, "");
    inert.seed(
      `${RECORDS}.acl`,
      `${pod.body(`${RECORDS}.acl`)}\n${PREFIXES}[] a acl:Authorization; acl:origin <https://app.example>; acl:accessTo <${RECORDS}>; acl:mode acl:Read.`,
    );
    expect((await decide({ id: ID }, { approve: true }, opts(inert))).status).toBe("approved");
    // A folder that cannot be listed is not known to be empty: fail closed.
    const unlisted = buildPod();
    unlisted.intercept = (method, url) =>
      method === "GET" && url === RECORDS ? new Response(null, { status: 404 }) : undefined;
    await expect(decide({ id: ID }, { approve: false }, opts(unlisted))).rejects.toThrow(
      "can't be listed",
    );
    expect(unlisted.has(`${RECORDS}.acl`)).toBe(false);
  });

  it("refuses to write records into a shared, uncontrolled or unstable records folder", async () => {
    const shared = [
      `acl:agentClass foaf:Agent`,
      `acl:agentGroup <https://group.example/>`,
      `acl:agent <${OWNER}>, <${REQUESTER}>`,
    ];
    for (const who of shared) {
      for (const approve of [true, false]) {
        const pod = buildPod();
        pod.seed(RECORDS, "");
        pod.seed(
          `${RECORDS}.acl`,
          `${PREFIXES}<#o> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${RECORDS}>; acl:default <${RECORDS}>; acl:mode acl:Read, acl:Write, acl:Control.
<#s> a acl:Authorization; ${who}; acl:default <${RECORDS}>; acl:mode acl:Read.`,
        );
        const before = pod.log.length;
        await expect(decide({ id: ID }, { approve }, opts(pod))).rejects.toThrow("shared");
        expect(puts(pod, before)).toEqual([]);
      }
    }
    const noControl = buildPod();
    noControl.seed(RECORDS, "");
    noControl.seed(
      `${RECORDS}.acl`,
      `${PREFIXES}<#o> a acl:Authorization; acl:agent <${OWNER}>; acl:default <${RECORDS}>; acl:mode acl:Read, acl:Write.`,
    );
    await expect(decide({ id: ID }, { approve: true }, opts(noControl))).rejects.toThrow(
      "full control",
    );
    // Control over the folder alone leaves the records inside unreadable to the owner.
    const noDefault = buildPod();
    noDefault.seed(RECORDS, "");
    noDefault.seed(
      `${RECORDS}.acl`,
      `${PREFIXES}<#o> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${RECORDS}>; acl:mode acl:Read, acl:Write, acl:Control.`,
    );
    await expect(decide({ id: ID }, { approve: true }, opts(noDefault))).rejects.toThrow(
      "full control",
    );
    expect(puts(noDefault)).toEqual([]);
    const racing = buildPod();
    racing.intercept = (method, url) =>
      method === "PUT" && url === `${RECORDS}.acl`
        ? new Response(null, { status: 412 })
        : undefined;
    await expect(decide({ id: ID }, { approve: true }, opts(racing))).rejects.toThrow(
      "kept changing",
    );
    const broken = buildPod();
    broken.intercept = (method, url) =>
      method === "HEAD" && url === RECORDS ? new Response(null, { status: 500 }) : undefined;
    await expect(decide({ id: ID }, { approve: false }, opts(broken))).rejects.toThrow(
      "Records folder check failed (500)",
    );
    expect(puts(broken)).toEqual([]);
  });

  it("grants a fragment instance registration on its document and keeps owner control", async () => {
    const pod = buildPod();
    pod.seed(
      INDEX,
      `${PREFIXES}[] a solid:TypeRegistration; solid:forClass <${CONTACTS_CLASS}>; solid:instance <${ALICE}#it>.`,
    );
    const result = await decide({ id: ID }, { approve: true }, opts(pod));
    expect(result.status).toBe("approved");
    expect(pod.has(`${ALICE}#it.acl`)).toBe(false);
    const acl = await parseRdf(pod.body(`${ALICE}.acl`) as string, "text/turtle");
    expect(acl.size).toBeGreaterThan(0);
    const body = pod.body(`${ALICE}.acl`) as string;
    expect(body).toContain(REQUESTER);
    expect(body).toContain(OWNER);
    expect(body).toContain("Control");
    expect(body).not.toContain(`${ALICE}#it`);
    expect(pod.body(result.grantUrl as string)).not.toContain(`${ALICE}#`);
  });

  it("treats permissions for different assignees as unreadable", async () => {
    const pod = buildPod();
    pod.seed(
      ID,
      `${PREFIXES}<${ID}> a odrl:Offer; odrl:uid <${ID}>;
  odrl:permission [ odrl:assignee <${REQUESTER}>; odrl:action odrl:read; odrl:target <${CONTACTS_CLASS}> ],
    [ odrl:assignee <https://other.example/agent#it>; odrl:action odrl:write; odrl:target <${CONTACTS_CLASS}> ].`,
    );
    expect((await listRequests(opts(pod)))[0]).toMatchObject({ id: ID, status: "unreadable" });
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow("Unreadable");
    const policyLevel = buildPod();
    policyLevel.seed(
      ID,
      `${PREFIXES}<${ID}> a odrl:Offer; odrl:uid <${ID}>; odrl:assignee <${REQUESTER}>;
  odrl:permission [ odrl:action odrl:read; odrl:target <${CONTACTS_CLASS}> ].`,
    );
    expect((await listRequests(opts(policyLevel)))[0]).toMatchObject({
      status: "pending",
      requester: REQUESTER,
    });
  });

  it("refuses to materialise from a legacy acl:defaultForNew rule rather than guess the server", async () => {
    const pod = buildPod();
    pod.seed(
      `${POD}.acl`,
      `${PREFIXES}<${POD}.acl#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${POD}>; acl:default <${POD}>; acl:mode acl:Read, acl:Write, acl:Control.
<${POD}.acl#legacy> a acl:Authorization; acl:agent <https://bob.example/#me>; acl:defaultForNew <${POD}>; acl:mode acl:Read, acl:Write, acl:Control.`,
    );
    await expect(applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch)).rejects.toThrow(
      "defaultForNew",
    );
    expect(pod.has(`${ALICE}.acl`)).toBe(false);
  });

  it("never trusts files that were in the records folder before it was private", async () => {
    // A pinned decision planted while the folder inherited someone else's write access.
    const planted = buildPod();
    planted.seed(RECORDS, "");
    const intent = await legacyIntentUrl();
    planted.seed(intent, `${PREFIXES}<${intent}> accm:requestRef <${ID}>; accm:snapshot "{}" .`);
    for (const approve of [true, false]) {
      await expect(decide({ id: ID }, { approve }, opts(planted))).rejects.toThrow(
        "already has files",
      );
    }
    expect(planted.has(`${RECORDS}.acl`)).toBe(false);
    expect(planted.has(`${ALICE}.acl`)).toBe(false);
    // A file that lands while the folder is being made private is not trusted either.
    const racing = buildPod();
    racing.intercept = (method, url) => {
      if (method === "PUT" && url === `${RECORDS}.acl`) racing.seed(`${RECORDS}stray.ttl`, "");
      return undefined;
    };
    await expect(decide({ id: ID }, { approve: true }, opts(racing))).rejects.toThrow(
      "already has files",
    );
    expect(racing.has(intent)).toBe(false);
  });

  it("resumes a pinned decision without rediscovering targets", async () => {
    const pod = buildPod();
    pod.intercept = (method, url) =>
      method === "PUT" && url === ID ? new Response(null, { status: 500 }) : undefined;
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow("500");
    pod.intercept = undefined;
    pod.seed(INDEX, "corrupted index @@@");
    const result = await decide({ id: ID }, { approve: true }, opts(pod));
    expect(result.status).toBe("approved");
    expect(pod.body(`${ALICE}.acl`)).toContain(REQUESTER);
  });

  it("finds the records folder ACL from its own Link header only", async () => {
    const refuse = async (link: string | null, message: RegExp | string) => {
      const pod = buildPod();
      pod.seed(RECORDS, "");
      pod.intercept = (method, url) =>
        method === "HEAD" && url === RECORDS
          ? new Response(null, { headers: link === null ? {} : { link } })
          : undefined;
      await expect(decide({ id: ID }, { approve: false }, opts(pod))).rejects.toThrow(message);
      expect(puts(pod)).toEqual([]);
    };
    await refuse('<x>; rel="http://www.w3.org/ns/solid/acp#accessControl"', "acp");
    await refuse("<https://evil.example/records.acl>; rel=acl", /.+/);
    // Without a Link header the conventional sibling is used.
    const plain = buildPod();
    plain.intercept = (method, url) =>
      method === "HEAD" && url === RECORDS && plain.has(RECORDS) ? new Response(null) : undefined;
    await decide({ id: ID }, { approve: false }, opts(plain));
    expect(plain.body(`${RECORDS}.acl`)).toContain(OWNER);
  });

  it("keeps distrusting a folder whose privacy check was interrupted", async () => {
    const intent = await legacyIntentUrl();
    const planted = async (pod: ReturnType<typeof buildPod>) => {
      const grantId = await deriveGrantId(ID, [`${POD}`], OWNER);
      const snapshot = JSON.stringify({
        grantId,
        targets: [POD],
        agent: REQUESTER,
        modes: ["append", "read", "write"],
        targetModes: { [POD]: ["append", "read", "write"] },
        dataTypes: [CONTACTS_CLASS],
        schemaVersion: "1",
        decidedAt: "2026-11-01T00:00:00.000Z",
      });
      pod.seed(
        intent,
        `${PREFIXES}<${intent}> accm:requestRef <${ID}>; accm:snapshot ${JSON.stringify(snapshot)} .`,
      );
    };
    for (const interruption of ["crash", "stray"] as const) {
      const pod = buildPod();
      pod.intercept = (method, url, init) => {
        if (method !== "PUT" || url !== `${RECORDS}.acl`) return undefined;
        if (interruption === "stray") {
          void planted(pod);
          return undefined;
        }
        if (new Headers(init?.headers).has("if-match")) throw new Error("crash");
        return undefined;
      };
      await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
        interruption === "crash" ? "crash" : "already has files",
      );
      pod.intercept = undefined;
      if (interruption === "crash") await planted(pod);
      expect(pod.body(`${RECORDS}.acl`)).toContain("unverifiedRecords");
      for (const approve of [true, false])
        await expect(decide({ id: ID }, { approve }, opts(pod))).rejects.toThrow(
          "already has files",
        );
      expect(pod.has(`${POD}.acl`) && pod.body(`${POD}.acl`)?.includes(REQUESTER)).toBe(false);
      expect(pod.has(`${ALICE}.acl`)).toBe(false);
      // Once the planted file is cleared, the folder is checked again and sealed.
      pod.delete(intent);
      expect((await decide({ id: ID }, { approve: true }, opts(pod))).status).toBe("approved");
      expect(pod.body(`${RECORDS}.acl`)).not.toContain("unverifiedRecords");
    }
  });

  it("never resumes a decision recorded for different content at the same request URL", async () => {
    const pod = buildPod();
    const first = await decide({ id: ID }, { approve: true }, opts(pod));
    expect(first.status).toBe("approved");
    // The handled notification is removed; a new one from someone else lands at the same URL.
    const other = "https://other.example/profile#me";
    pod.seed(ID, accessRequestTurtle(ID).replaceAll(REQUESTER, other));
    const second = await decide({ id: ID }, { approve: true }, opts(pod));
    expect(second.status).toBe("approved");
    // The grant is bound to its requester, so it never collides with the first one.
    expect(second.grantUrl).not.toBe(first.grantUrl);
    expect(pod.body(second.grantUrl as string)).toContain(other);
    expect(pod.body(first.grantUrl as string)).not.toContain(other);
    const acl = pod.body(`${ALICE}.acl`) as string;
    expect(acl).toContain(other);
    // A pinned record whose agent is not this request's requester is refused before any write.
    const sealed = buildPod();
    await decide({ id: ID }, { approve: true }, opts(sealed));
    sealed.seed(ID, accessRequestTurtle(ID));
    // The first record is approved, so the new pending request looks at the next generation.
    const slot = await decisionUrl(sealed, { generation: 1 });
    const snapshot = {
      grantId: await grantIdFor(slot, [ALICE]),
      targets: [ALICE],
      agent: other,
      modes: ["read"],
      targetModes: { [ALICE]: ["read"] },
      dataTypes: [CONTACTS_CLASS],
      schemaVersion: "1",
      decidedAt: "2026-11-01T00:00:00.000Z",
      chosen: { dataTypes: [CONTACTS_CLASS], viewer: false },
    };
    sealed.seed(slot, await recordTurtle(slot, { outcome: "approving", snapshot }));
    const before = sealed.log.length;
    await expect(decide({ id: ID }, { approve: true }, opts(sealed))).rejects.toThrow(
      "Invalid persisted",
    );
    expect(puts(sealed, before)).toEqual([]);
  });

  it("refuses before recording anything when the sharing layer would refuse the grant", async () => {
    const pod = buildPod();
    pod.seed(
      `${ALICE}.acl`,
      `${PREFIXES}<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${ALICE}>; acl:mode acl:Read, acl:Write, acl:Control.
<#app> a acl:Authorization; acl:origin <https://app.example>; acl:agent <https://bob.example/#me>; acl:accessTo <${ALICE}>; acl:mode acl:Read.`,
    );
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow();
    expect(puts(pod)).toEqual([]);
    expect((await listRequests(opts(pod)))[0]).toMatchObject({ status: "pending" });
  });

  it("refuses a pinned grant wider than an append-only request", async () => {
    const pod = buildPod();
    await decide({ id: ID }, { approve: false }, opts(pod));
    pod.seed(ID, accessRequestTurtle(ID).replace("odrl:read", `<${ACL.Append}>`));
    const slot = await decisionUrl(pod, { asked: { [CONTACTS_CLASS]: ["append"] } });
    const snapshot = {
      grantId: await grantIdFor(slot, [ALICE]),
      targets: [ALICE],
      agent: REQUESTER,
      modes: ["read"],
      targetModes: { [ALICE]: ["read"] },
      dataTypes: [CONTACTS_CLASS],
      schemaVersion: "1",
      decidedAt: "2026-11-01T00:00:00.000Z",
      chosen: { dataTypes: [CONTACTS_CLASS], viewer: false },
    };
    pod.seed(slot, await recordTurtle(slot, { outcome: "approving", snapshot }));
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow(
      "Invalid persisted",
    );
    expect(pod.has(`${ALICE}.acl`)).toBe(false);
  });

  it("reports the winner when another resumer finishes while this one loses a grant race", async () => {
    const pod = buildPod();
    pod.intercept = (method, url) => {
      if (method === "PUT" && /access-records\/grant-/.test(url)) throw new Error("crash");
    };
    await expect(decide({ id: ID }, { approve: true }, opts(pod))).rejects.toThrow("crash");
    pod.intercept = (method, url) => {
      if (method === "PUT" && url === `${ALICE}.acl`) {
        pod.seed(ID, (pod.body(ID) as string).replaceAll("Approving", "Approved"));
        return new Response(null, { status: 412 });
      }
      return undefined;
    };
    expect((await decide({ id: ID }, { approve: true }, opts(pod))).status).toBe("approved");
  });
});
