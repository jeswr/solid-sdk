// AUTHORED-BY Claude Opus 5.5
// The Permissions History over an in-memory WAC pod: the owner's access records as
// `@jeswr/pod-access/requests-solid` writes them, and revocation through the real
// `@jeswr/pod-access/roles` removeGrant against the pod's ACL documents.
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  type ActiveHistoryEntry,
  HistoryChangedError,
  type HistoryEntry,
  HistoryRevokeError,
  historyFrom,
  isActiveGrant,
  placesText,
  readAccessHistory,
  recipientLabel,
  revokeHistoryGrant,
  statusText,
} from "../src/apps/home/lib/permissions/history";
import { UnsupportedAccessError } from "../src/apps/home/lib/permissions/vocab";

const ROOT = "https://pod.test/alice/";
const OWNER = `${ROOT}profile/card#me`;
const BOB = "https://bob.test/profile#me";
const CAROL = "https://carol.test/profile#me";
const RECORDS = `${ROOT}settings/access-records/`;
const GRANT = `${RECORDS}grant-1.ttl`;
const RECEIPT = `${RECORDS}receipt-1.ttl`;
const DENIAL = `${RECORDS}receipt-2.ttl`;
const FOLDER = `${ROOT}activity/`;
const FILE = `${ROOT}notes/plan.ttl`;
const NOW = new Date("2026-11-12T10:00:00.000Z");

const PREFIXES = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix odrl: <http://www.w3.org/ns/odrl/2/>.
@prefix dpv: <https://w3id.org/dpv#>.
@prefix accm: <https://jeswr.org/ns/accm#>.
@prefix dct: <http://purl.org/dc/terms/>.
@prefix ldp: <http://www.w3.org/ns/ldp#>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
`;
const ownerRule = (target: string, folder: boolean) =>
  `<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${target}>; ${
    folder ? `acl:default <${target}>; ` : ""
  }acl:mode acl:Read, acl:Write, acl:Control.`;
const bobRule = (target: string, folder: boolean) =>
  `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${target}>; ${
    folder ? `acl:default <${target}>; ` : ""
  }acl:mode acl:Read.`;
const carolRule = (target: string) =>
  `<#carol> a acl:Authorization; acl:agent <${CAROL}>; acl:accessTo <${target}>; acl:mode acl:Read.`;

function grantBody(targets = [FOLDER, FILE], extra = "") {
  const rules = targets
    .map(
      (target) =>
        `[ a odrl:Permission; odrl:action ${target === FILE ? "odrl:write" : "odrl:read"}; odrl:target <${target}>; odrl:assignee <${BOB}> ]`,
    )
    .join(", ");
  return `${PREFIXES} <${GRANT}> a odrl:Agreement; odrl:assigner <${OWNER}>; odrl:assignee <${BOB}>;
    odrl:permission ${rules}; accm:grantId "1"; dct:created "2026-11-01T09:00:00Z"^^xsd:dateTime ${extra}.`;
}
function receiptBody(status = "dpv:ConsentGiven", extra = "") {
  return `${PREFIXES} <${RECEIPT}> a dpv:ConsentRecord; dpv:hasDataSubject <${OWNER}>;
    dpv:hasRecipient <${BOB}>; dpv:hasConsentStatus ${status}; dpv:hasPurpose dpv:ServiceProvision;
    accm:grantRef <${GRANT}>; dct:created "2026-11-01T09:00:00Z"^^xsd:dateTime ${extra}.`;
}
const denialBody = `${PREFIXES} <${DENIAL}> a dpv:ConsentRecord; dpv:hasRecipient <${CAROL}>;
  dpv:hasConsentStatus dpv:ConsentRefused; dct:created "2026-10-01T09:00:00Z"^^xsd:dateTime.`;

/** An in-memory WAC pod with strong ETags, conditional PUTs and advertised ACLs. */
function pod() {
  const docs = new Map<string, { body: string; etag: string }>();
  const links = new Map<string, string>();
  const failures = new Map<string, number[]>();
  let version = 0;
  const put = (url: string, body: string) => docs.set(url, { body, etag: `"${++version}"` });
  const resource = (url: string, body: string, acl?: string) => {
    put(url, body);
    links.set(url, `${url}.acl`);
    if (acl !== undefined) put(`${url}.acl`, acl);
  };
  resource(ROOT, `${PREFIXES} <> a ldp:Container.`, `${PREFIXES} ${ownerRule(ROOT, true)}`);
  resource(
    FOLDER,
    `${PREFIXES} <> a ldp:Container.`,
    `${PREFIXES} ${ownerRule(FOLDER, true)} ${bobRule(FOLDER, true)}`,
  );
  resource(`${ROOT}notes/`, `${PREFIXES} <> a ldp:Container.`);
  resource(
    FILE,
    `${PREFIXES} <> dct:title "Plan".`,
    `${PREFIXES} ${ownerRule(FILE, false)} ${bobRule(FILE, false)} ${carolRule(FILE)}`,
  );
  put(
    RECORDS,
    `${PREFIXES} <> a ldp:Container; ldp:contains <grant-1.ttl>, <receipt-1.ttl>, <receipt-2.ttl>, <.acl>, <old/>.`,
  );
  put(GRANT, grantBody());
  put(RECEIPT, receiptBody());
  put(DENIAL, denialBody);
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init = {}) => {
    const url = String(input);
    expect(url.startsWith(ROOT)).toBe(true);
    expect(init.redirect).toBe("error");
    const method = init.method ?? "GET";
    const failure = failures.get(`${method} ${url}`)?.shift();
    if (failure) return new Response(null, { status: failure });
    const doc = docs.get(url);
    if (method === "HEAD") {
      if (!doc && !links.has(url)) return new Response(null, { status: 404 });
      const link = links.get(url);
      return new Response(null, { headers: link ? { link: `<${link}>; rel="acl"` } : {} });
    }
    if (method === "PUT") {
      const headers = new Headers(init.headers);
      if (doc ? headers.get("if-match") !== doc.etag : headers.get("if-none-match") !== "*")
        return new Response(null, { status: 412 });
      put(url, String(init.body));
      return new Response(null, { status: 205 });
    }
    return doc
      ? new Response(doc.body, { headers: { "content-type": "text/turtle", etag: doc.etag } })
      : new Response(null, { status: 404 });
  });
  return {
    docs,
    fetch,
    put,
    fail(method: string, url: string, ...statuses: number[]) {
      failures.set(`${method} ${url}`, statuses);
    },
    writes: () =>
      fetch.mock.calls.filter(([, init]) => init?.method === "PUT").map(([url]) => String(url)),
  };
}

/** Agents an authorization in the target's own ACL gives access to the target itself. */
async function agentsOn(memory: ReturnType<typeof pod>, target: string): Promise<string[]> {
  const doc = memory.docs.get(`${target}.acl`);
  const dataset = new Store([
    ...(await parseRdf(doc?.body ?? "", "text/turtle", { baseIRI: `${target}.acl` })),
  ]);
  const acl = (name: string) => DataFactory.namedNode(`http://www.w3.org/ns/auth/acl#${name}`);
  const rules = new Set(
    [...dataset.match(null, acl("accessTo"), DataFactory.namedNode(target))].map(
      (quad) => quad.subject.value,
    ),
  );
  return [...dataset.match(null, acl("agent"))]
    .filter((quad) => rules.has(quad.subject.value))
    .map((quad) => quad.object.value);
}
async function terms(memory: ReturnType<typeof pod>, url: string, predicate: string) {
  const dataset = await parseRdf(memory.docs.get(url)?.body ?? "", "text/turtle", { baseIRI: url });
  return [...dataset.match(DataFactory.namedNode(url), DataFactory.namedNode(predicate))].map(
    (quad) => quad.object.value,
  );
}
const options = (memory: ReturnType<typeof pod>) => ({
  fetch: memory.fetch,
  webId: OWNER,
  storage: ROOT,
  now: () => NOW,
});
async function active(memory: ReturnType<typeof pod>): Promise<ActiveHistoryEntry> {
  const entry = (await readAccessHistory(memory.fetch, ROOT)).find(isActiveGrant);
  if (!entry) throw new Error("No active grant");
  return entry;
}

describe("access history", () => {
  it("lists one entry per receipt, newest first, joined to the grant it records", async () => {
    const memory = pod();
    const entries = await readAccessHistory(memory.fetch, ROOT);
    expect(entries).toEqual([
      {
        receipt: RECEIPT,
        status: "granted",
        recipient: BOB,
        purpose: { iri: "https://w3id.org/dpv#ServiceProvision", label: "Provide the service" },
        decidedAt: "2026-11-01T09:00:00.000Z",
        grant: { url: GRANT, targets: [FOLDER, FILE], role: "editor" },
      },
      {
        receipt: DENIAL,
        status: "denied",
        recipient: CAROL,
        decidedAt: "2026-10-01T09:00:00.000Z",
      },
    ]);
    expect(entries.map(isActiveGrant)).toEqual([true, false]);
    // Folders and access documents in the records folder are never read as records.
    expect(memory.fetch).not.toHaveBeenCalledWith(`${RECORDS}old/`, expect.anything());
    expect(memory.fetch).not.toHaveBeenCalledWith(`${RECORDS}.acl`, expect.anything());
    expect(memory.writes()).toEqual([]);
  });

  it("reads an absent records folder as no history", async () => {
    const memory = pod();
    memory.docs.delete(RECORDS);
    expect(await readAccessHistory(memory.fetch, ROOT)).toEqual([]);
  });

  it("projects partial and odd records conservatively", async () => {
    const memory = pod();
    const dataset = await parseRdf(
      `${PREFIXES}
      <${RECEIPT}> a dpv:ConsentRecord; dpv:hasConsentStatus dpv:ConsentGiven; accm:grantRef <${GRANT}>;
        dct:created "not a date".
      <${GRANT}> a odrl:Agreement; accm:revokedAt "2026-11-05T00:00:00Z"^^xsd:dateTime;
        odrl:permission [ odrl:action odrl:read; odrl:target <${FOLDER}> ].
      <${DENIAL}> a dpv:ConsentRecord; dpv:hasRecipient <mailto:carol@example.org>;
        dpv:hasConsentStatus dpv:SomethingElse; accm:grantRef <${FILE}>.
      <${RECORDS}receipt-3.ttl> a dpv:ConsentRecord; accm:expiresAt "2027-01-01T00:00:00Z";
        dct:created "2026-09-01T00:00:00Z".
      <${RECORDS}receipt-4.ttl> a dpv:ConsentRecord; dpv:hasExpiryTime "2027-02-01T00:00:00Z";
        dct:created "2026-08-01T00:00:00Z".
      _:anonymous a dpv:ConsentRecord.`,
      "text/turtle",
      { baseIRI: RECORDS },
    );
    const entries = historyFrom(dataset);
    expect(entries).toHaveLength(4);
    // Dated entries come first; a receipt's own expiry wins over other record metadata.
    expect(entries.slice(0, 2)).toEqual([
      {
        receipt: `${RECORDS}receipt-3.ttl`,
        status: "unknown",
        decidedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
      {
        receipt: `${RECORDS}receipt-4.ttl`,
        status: "unknown",
        decidedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2027-02-01T00:00:00.000Z",
      },
    ]);
    // Undated entries tie, and fall back to their receipt URLs.
    const [second, first] = entries.slice(2) as [HistoryEntry, HistoryEntry];
    // A revoked grant whose receipt still says given has ended.
    expect(first).toMatchObject({ receipt: DENIAL, status: "unknown" });
    expect(first.grant).toBeUndefined();
    expect(second).toEqual({
      receipt: RECEIPT,
      status: "revoked",
      revokedAt: "2026-11-05T00:00:00.000Z",
      grant: {
        url: GRANT,
        targets: [FOLDER],
        role: "viewer",
        revokedAt: "2026-11-05T00:00:00.000Z",
      },
    });
    expect(entries.some(isActiveGrant)).toBe(false);
    expect(recipientLabel(first)).toBe("Someone");
    expect(recipientLabel(second)).toBe("Someone");
    expect(recipientLabel({ recipient: BOB })).toBe("bob.test");
    expect(memory.writes()).toEqual([]);
  });

  it("words statuses and counts", () => {
    expect(["granted", "denied", "revoked", "unknown"].map((s) => statusText(s as never))).toEqual([
      "Shared",
      "Denied",
      "Access removed",
      "Status unknown",
    ]);
    expect(placesText(1)).toBe("1 place");
    expect(placesText(3)).toBe("3 places");
  });
});

describe("revoking from the history", () => {
  it("removes the recipient's role from every recorded place, then marks the records", async () => {
    const memory = pod();
    await revokeHistoryGrant(await active(memory), options(memory));
    expect(await agentsOn(memory, FOLDER)).toEqual([OWNER]);
    // Only the recipient loses access: other people keep theirs.
    expect((await agentsOn(memory, FILE)).sort()).toEqual([CAROL, OWNER].sort());
    expect(await terms(memory, GRANT, "https://jeswr.org/ns/accm#revokedAt")).toEqual([
      NOW.toISOString(),
    ]);
    expect(await terms(memory, RECEIPT, "https://w3id.org/dpv#hasConsentStatus")).toEqual([
      "https://w3id.org/dpv#ConsentWithdrawn",
    ]);
    expect(await terms(memory, RECEIPT, "https://jeswr.org/ns/accm#revokedAt")).toEqual([
      NOW.toISOString(),
    ]);
    // Unrelated record data is kept.
    expect(await terms(memory, RECEIPT, "https://w3id.org/dpv#hasRecipient")).toEqual([BOB]);
    for (const [url, init] of memory.fetch.mock.calls.filter(([, i]) => i?.method === "PUT"))
      expect(new Headers(init?.headers).get("if-match") ?? url).toMatch(/^"\d+"$/);
    const [entry] = await readAccessHistory(memory.fetch, ROOT);
    expect(entry).toMatchObject({ status: "revoked", revokedAt: NOW.toISOString() });
    expect(isActiveGrant(entry as HistoryEntry)).toBe(false);
  });

  it("keeps the grant active and names the places that kept access when one fails", async () => {
    const memory = pod();
    const entry = await active(memory);
    memory.fail("PUT", `${FILE}.acl`, 500);
    const error = await revokeHistoryGrant(entry, options(memory)).catch((caught) => caught);
    expect(error).toBeInstanceOf(HistoryRevokeError);
    expect((error as HistoryRevokeError).removed).toEqual([FOLDER]);
    expect((error as HistoryRevokeError).failed.map((failure) => failure.url)).toEqual([FILE]);
    expect(await agentsOn(memory, FILE)).toContain(BOB);
    expect(memory.writes()).not.toContain(GRANT);
    expect(memory.writes()).not.toContain(RECEIPT);
    // Trying again finishes the job: the folder is already clear, so it's a no-op there.
    await revokeHistoryGrant(entry, options(memory));
    expect(await agentsOn(memory, FILE)).not.toContain(BOB);
    expect(memory.writes().filter((url) => url === `${FOLDER}.acl`)).toHaveLength(1);
  });

  it("refuses a grant record that no longer says what was shown, before any change", async () => {
    const memory = pod();
    const entry = await active(memory);
    memory.put(GRANT, grantBody([FOLDER, FILE, `${ROOT}photos/`]));
    await expect(revokeHistoryGrant(entry, options(memory))).rejects.toBeInstanceOf(
      HistoryChangedError,
    );
    memory.put(GRANT, grantBody().replace(`odrl:assignee <${BOB}>;`, `odrl:assignee <${CAROL}>;`));
    await expect(revokeHistoryGrant(entry, options(memory))).rejects.toBeInstanceOf(
      HistoryChangedError,
    );
    memory.put(GRANT, grantBody().replace("a odrl:Agreement", "a odrl:Offer"));
    await expect(revokeHistoryGrant(entry, options(memory))).rejects.toBeInstanceOf(
      HistoryChangedError,
    );
    expect(memory.writes()).toEqual([]);
  });

  it("refuses to touch the storage root, settings or the owner's own access", async () => {
    for (const targets of [[ROOT], [`${ROOT}settings/prefs.ttl`], ["https://elsewhere.test/x"]]) {
      const memory = pod();
      memory.put(GRANT, grantBody(targets));
      const entry = await active(memory);
      await expect(revokeHistoryGrant(entry, options(memory))).rejects.toBeInstanceOf(
        UnsupportedAccessError,
      );
      expect(memory.writes()).toEqual([]);
    }
    const memory = pod();
    const entry = await active(memory);
    await expect(
      revokeHistoryGrant(entry, { ...options(memory), webId: BOB }),
    ).rejects.toBeInstanceOf(UnsupportedAccessError);
    expect(memory.writes()).toEqual([]);
  });

  it("finishes a revocation whose grant was already marked, without changing access again", async () => {
    const memory = pod();
    const entry = await active(memory);
    memory.put(
      GRANT,
      grantBody([FOLDER, FILE], `; accm:revokedAt "2026-11-10T00:00:00Z"^^xsd:dateTime`),
    );
    await revokeHistoryGrant(entry, options(memory));
    expect(memory.writes()).toEqual([RECEIPT]);
    expect(await agentsOn(memory, FOLDER)).toContain(BOB);
    // A receipt already withdrawn is left as it is.
    await revokeHistoryGrant(entry, options(memory));
    expect(memory.writes()).toEqual([RECEIPT]);
  });

  it("revokes folder-only grants, and leaves a grant another revoker already marked", async () => {
    const memory = pod();
    memory.put(GRANT, grantBody([FOLDER]));
    const entry = await active(memory);
    const real = memory.fetch.getMockImplementation() as typeof globalThis.fetch;
    memory.fetch.mockImplementation(async (input, init) => {
      const response = await real(input, init);
      // Someone else finishes marking the grant while this revoker removes access.
      if (String(input) === `${FOLDER}.acl` && init?.method === "PUT")
        memory.put(
          GRANT,
          grantBody([FOLDER], `; accm:revokedAt "2026-11-11T00:00:00Z"^^xsd:dateTime`),
        );
      return response;
    });
    await revokeHistoryGrant(entry, options(memory));
    expect(await agentsOn(memory, FOLDER)).toEqual([OWNER]);
    expect(memory.writes()).toEqual([`${FOLDER}.acl`, RECEIPT]);
    expect(await terms(memory, GRANT, "https://jeswr.org/ns/accm#revokedAt")).toEqual([
      "2026-11-11T00:00:00Z",
    ]);
  });

  it("re-reads a record after a lost race, and stops after repeated conflicts", async () => {
    const memory = pod();
    memory.fail("PUT", RECEIPT, 412);
    await revokeHistoryGrant(await active(memory), options(memory));
    expect(await terms(memory, RECEIPT, "https://w3id.org/dpv#hasConsentStatus")).toEqual([
      "https://w3id.org/dpv#ConsentWithdrawn",
    ]);
    const stuck = pod();
    stuck.fail("PUT", GRANT, 412, 412, 412);
    await expect(revokeHistoryGrant(await active(stuck), options(stuck))).rejects.toThrow(
      "The access record couldn't be saved (412)",
    );
    const broken = pod();
    broken.fail("PUT", GRANT, 500);
    await expect(revokeHistoryGrant(await active(broken), options(broken))).rejects.toThrow(
      "The access record couldn't be saved (500)",
    );
  });

  it("needs a strong ETag before changing a record", async () => {
    const memory = pod();
    const entry = await active(memory);
    const weak = memory.fetch.getMockImplementation() as typeof globalThis.fetch;
    memory.fetch.mockImplementation(async (input, init) => {
      const response = await weak(input, init);
      if (String(input) !== GRANT || (init?.method ?? "GET") !== "GET") return response;
      return new Response(await response.text(), {
        headers: { "content-type": "text/turtle", etag: 'W/"1"' },
      });
    });
    await expect(
      revokeHistoryGrant(entry, { fetch: memory.fetch, webId: OWNER, storage: ROOT }),
    ).rejects.toThrow("A strong ETag is required");
    expect(memory.writes()).not.toContain(GRANT);
  });
});
