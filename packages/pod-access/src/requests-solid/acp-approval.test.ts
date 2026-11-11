// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Term } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  accessRequestTurtle,
  buildPod,
  CONTACTS_CLASS,
  OWNER,
  POD,
  RECORDS,
  REQUEST,
  REQUESTER,
} from "../../test/requests/fixtures.js";
import { ACP, RDF } from "../rdf.js";
import { grantsWithRoles } from "../roles/client.js";
import { readAccessDocuments } from "../roles/http.js";
import { properties } from "../roles/rdf.js";
import {
  accessModel,
  applyGrant,
  checkGrant,
  ensureOwnerOnlyContainer,
  recordsKey,
} from "./acl.js";
import { acpRecords } from "./acp-records.js";
import { decide, previewDecision } from "./approval.js";
import { UnsupportedAccessModelError } from "./errors.js";
import { set, turtle, values } from "./rdf.js";
import { ACCM, ACL, LDP, SOLID } from "./vocab.js";

const ALICE = `${POD}contacts/alice.ttl`;
const ACR = `${RECORDS}.acr`;
const KEY = `${ACCM.ns}recordsKey`;
const MARK = `${ACCM.ns}unverifiedRecords`;
const nn = DataFactory.namedNode;
const options = (pod: Awaited<ReturnType<typeof acpPod>>) => ({
  fetch: pod.fetch,
  storage: POD,
  webId: OWNER,
  typeIndex: pod.index,
});

/** Independent CSS fixture: explicit local subjects, rather than the production ACP writer. */
function acr(
  resource: string,
  url = `${resource}.acr`,
  agent = OWNER,
  modes = [ACL.Read, ACL.Write, ACL.Control] as string[],
) {
  const dataset = new Store();
  const root = properties(nn(url), dataset);
  root.add(`${RDF}type`, `${ACP}AccessControlResource`);
  root.add(`${ACP}resource`, resource);
  const policy = addPolicy(dataset, url, "owner", agent, modes);
  bind(dataset, url, "owner", policy, resource.endsWith("/"));
  return dataset;
}
function addPolicy(
  dataset: Store,
  url: string,
  name: string,
  agent: string,
  modes: string[],
  deny = false,
) {
  const matcher = properties(nn(`${url}#${name}-matcher`), dataset);
  matcher.add(`${RDF}type`, `${ACP}Matcher`);
  matcher.add(`${ACP}agent`, agent);
  const policy = properties(nn(`${url}#${name}-policy`), dataset);
  policy.add(`${RDF}type`, `${ACP}Policy`);
  policy.terms(`${ACP}allOf`).add(matcher as Term);
  for (const mode of modes) policy.add(ACP + (deny ? "deny" : "allow"), mode);
  return policy;
}
function bind(dataset: Store, url: string, name: string, policy: Term, members = true, root = url) {
  const control = properties(nn(`${url}#${name}-control`), dataset);
  control.add(`${RDF}type`, `${ACP}AccessControl`);
  control.terms(`${ACP}apply`).add(policy);
  const r = properties(nn(root), dataset);
  r.terms(`${ACP}accessControl`).add(control as Term);
  if (members) r.terms(`${ACP}memberAccessControl`).add(control as Term);
}
async function acpPod(relation = "acl") {
  const pod = buildPod();
  pod.delete(`${POD}.acl`);
  pod.seed(`${POD}.acr`, await turtle(acr(POD)));
  const index = new Store();
  const reg = properties(DataFactory.blankNode(), index);
  reg.add(`${RDF}type`, SOLID.TypeRegistration);
  reg.add(SOLID.forClass, CONTACTS_CLASS);
  reg.add(SOLID.instance, ALICE);
  const calls: { method: string; url: string; headers: Headers; body: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      method,
      url,
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ""),
    });
    const response = await pod.fetch(input, init);
    if (method !== "HEAD" || url.endsWith(".acr")) return response;
    const headers = new Headers(response.headers);
    headers.set("link", `<${url}.acr>; rel="${relation}"`);
    return new Response(response.body, { status: response.status, headers });
  };
  return { ...pod, fetch, index, calls };
}
async function seedRecords(pod: Awaited<ReturnType<typeof acpPod>>, dataset = acr(RECORDS)) {
  pod.seed(RECORDS, "");
  pod.seed(ACR, await turtle(dataset));
}
const writes = (pod: Awaited<ReturnType<typeof acpPod>>) =>
  pod.calls.filter((call) => call.method === "PUT");
const accessWrites = (pod: Awaited<ReturnType<typeof acpPod>>) =>
  writes(pod).filter(({ url }) => url === `${ALICE}.acr`);

// Wrapping the fixture retains its actual interceptor: object spread does not proxy assignments.
function intercept(
  pod: Awaited<ReturnType<typeof acpPod>>,
  callback: (method: string, url: string, init?: RequestInit) => Response | undefined,
) {
  const original = pod.fetch;
  pod.fetch = async (input, init) =>
    callback(init?.method ?? "GET", String(input), init) ?? original(input, init);
  return () => {
    pod.fetch = original;
  };
}

describe("ACP approval and sealed owner records", () => {
  it("approves, seals before recording, preserves control, and replays additively", async () => {
    for (const relation of ["acl", `${ACP}accessControl`]) {
      const pod = await acpPod(relation);
      pod.seed(REQUEST, accessRequestTurtle(REQUEST).replace("odrl:read", "odrl:write"));
      const expiresAt = new Date("2028-01-01Z");
      const decision = { approve: true, role: "editor" as const, expiresAt };
      const result = await decide({ id: REQUEST }, decision, options(pod));
      expect(result).toMatchObject({
        status: "approved",
        expiryEnforced: false,
        choices: { dataTypes: [CONTACTS_CLASS], role: "editor", expiresAt },
      });
      const stored = await parseRdf(pod.body(ACR) as string, "text/turtle");
      const key = values(stored, ACR, KEY)[0];
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
      expect(values(stored, ACR, MARK)).toEqual([]);
      expect(pod.body(ACR)).not.toContain(REQUESTER);
      const order = writes(pod);
      expect(order.slice(0, 3).map(({ url }) => url)).toEqual([RECORDS, ACR, ACR]);
      expect(order[1]?.headers.get("if-none-match")).toBe("*");
      expect(order[2]?.headers.get("if-match")).toBe('"v1"');
      expect(pod.body(result.grantUrl as string)).toContain(REQUESTER);
      expect(pod.body(result.receiptUrl)).toContain("ConsentGiven");
      const roles = await grantsWithRoles(ALICE, { fetch: pod.fetch, root: POD, model: "acp" });
      expect(roles).toContainEqual(
        expect.objectContaining({ agent: { type: "webid", id: REQUESTER }, role: "editor" }),
      );
      expect(roles).toContainEqual(
        expect.objectContaining({ agent: { type: "webid", id: OWNER }, role: "manager" }),
      );
      const before = accessWrites(pod).length;
      // Completed replay reports the pinned choices even when the caller supplies different ones.
      expect(
        await decide({ id: REQUEST }, { approve: true, role: "viewer" }, options(pod)),
      ).toEqual(result);
      await applyGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch);
      expect(accessWrites(pod)).toHaveLength(before);
      expect(await recordsKey(RECORDS, POD, OWNER, pod.fetch)).toBe(key);
    }
  });

  it("resumes exactly after a grant failure without resolving again", async () => {
    const pod = await acpPod();
    const restore = intercept(pod, (method, url) => {
      if (method === "PUT" && url === `${ALICE}.acr`) throw new Error("crash");
    });
    const decision = { approve: true, role: "viewer" as const };
    await expect(decide({ id: REQUEST }, decision, options(pod))).rejects.toThrow("crash");
    restore();
    const result = await decide({ id: REQUEST }, decision, {
      ...options(pod),
      typeIndex: new Store(),
    });
    expect(result.status).toBe("approved");
    expect(result.choices).toEqual({
      dataTypes: [CONTACTS_CLASS],
      role: "viewer",
      targetRoles: { [ALICE]: "viewer" },
    });
    expect(pod.body(`${ALICE}.acr`)).toContain(REQUESTER);
    expect(pod.etag(result.grantUrl as string)).toBe('"v1"');
  });

  it("checks existing private ACRs without rewriting metadata and supports deny-only policies", async () => {
    const pod = await acpPod();
    const dataset = acr(RECORDS);
    const p = addPolicy(dataset, ACR, "deny", REQUESTER, [ACL.Read], true);
    bind(dataset, ACR, "deny", p);
    const narrow = addPolicy(dataset, ACR, "narrow", OWNER, [ACL.Read]);
    const client = properties(nn(`${ACR}#client`), dataset);
    client.add(`${ACP}client`, "https://app.example/client");
    client.add(`${ACP}issuer`, "https://issuer.example/");
    narrow.terms(`${ACP}allOf`).add(client as Term);
    bind(dataset, ACR, "narrow", narrow);
    set(dataset, ACR, "https://example.org/note", "preserve");
    // Metadata on the document subject is independent of controls; move the root to a local node.
    const r = properties(nn(`${ACR}#root`), dataset);
    for (const predicate of [
      `${RDF}type`,
      `${ACP}resource`,
      `${ACP}accessControl`,
      `${ACP}memberAccessControl`,
    ]) {
      const source = properties(nn(ACR), dataset);
      for (const term of source.terms(predicate)) r.terms(predicate).add(term);
      source.terms(predicate).clear();
    }
    await seedRecords(pod, dataset);
    const result = await decide({ id: REQUEST }, { approve: true }, options(pod));
    expect(result.status).toBe("approved");
    expect(pod.etag(ACR)).toBe('"v2"');
    expect(pod.body(ACR)).toContain("preserve");
  });

  it("refuses every wider or unverified records graph before a grant write", async () => {
    const mutations: ((dataset: Store) => void)[] = [
      ...[`${ACP}PublicAgent`, `${ACP}AuthenticatedAgent`, REQUESTER].map(
        (agent) => (dataset: Store) => {
          bind(dataset, ACR, "shared", addPolicy(dataset, ACR, "shared", agent, [ACL.Read]));
        },
      ),
      (dataset) => {
        const p = addPolicy(dataset, ACR, "any", OWNER, [ACL.Read]);
        p.values(`${ACP}allOf`).clear();
        p.add(`${ACP}anyOf`, `${ACR}#owner-matcher`);
        p.add(`${ACP}anyOf`, `${ACR}#other`);
        properties(nn(`${ACR}#other`), dataset).add(`${ACP}agent`, REQUESTER);
        bind(dataset, ACR, "any", p);
      },
      (dataset) => {
        properties(nn(`${ACR}#owner-policy`), dataset)
          .values(`${ACP}allOf`)
          .clear();
        properties(nn(`${ACR}#owner-policy`), dataset).add(
          `${ACP}allOf`,
          "https://elsewhere.example/#matcher",
        );
        properties(nn("https://elsewhere.example/#matcher"), dataset).add(`${ACP}agent`, OWNER);
      },
      (dataset) =>
        properties(nn(`${ACR}#owner-control`), dataset)
          .values(`${ACP}apply`)
          .clear(),
      (dataset) =>
        properties(nn(`${ACR}#owner-control`), dataset)
          .values(`${ACP}apply`)
          .add("https://elsewhere.example/#policy"),
      (dataset) =>
        properties(nn(`${ACR}#owner-matcher`), dataset).add("https://example.org/widens", OWNER),
      (dataset) => properties(nn(`${ACR}#owner-matcher`), dataset).add(`${ACP}unknown`, OWNER),
      (dataset) => properties(nn(`${ACR}#detached`), dataset).add(`${ACP}agent`, OWNER),
      (dataset) => {
        const root = properties(nn(`${ACR}#auxiliary`), dataset);
        root.add(`${ACP}resource`, ACR);
        bind(
          dataset,
          ACR,
          "reader",
          addPolicy(dataset, ACR, "reader", REQUESTER, [ACL.Read]),
          false,
          root.value,
        );
      },
    ];
    for (const mutate of mutations) {
      const pod = await acpPod();
      const dataset = acr(RECORDS);
      mutate(dataset);
      await seedRecords(pod, dataset);
      await expect(decide({ id: REQUEST }, { approve: true }, options(pod))).rejects.toThrow(
        "folder is shared",
      );
      expect(accessWrites(pod)).toEqual([]);
      expect(writes(pod)).toEqual([]);
    }
  });

  it("refuses inherited public access even behind an owner-only own ACR", async () => {
    for (const own of [true, false]) {
      const pod = await acpPod();
      if (own) await seedRecords(pod);
      const root = acr(POD);
      bind(
        root,
        `${POD}.acr`,
        "public",
        addPolicy(root, `${POD}.acr`, "public", `${ACP}PublicAgent`, [ACL.Read]),
      );
      pod.seed(`${POD}.acr`, await turtle(root));
      await expect(decide({ id: REQUEST }, { approve: true }, options(pod))).rejects.toThrow(
        "shared",
      );
      expect(accessWrites(pod)).toEqual([]);
    }
  });

  it("checks public member policies above a path-based storage root", async () => {
    const pod = await acpPod();
    const storage = `${POD}alice/`;
    const records = `${storage}settings/access-records/`;
    pod.seed(`${storage}.acr`, await turtle(acr(storage)));
    pod.seed(records, "");
    pod.seed(`${records}.acr`, await turtle(acr(records)));
    const server = acr(POD);
    bind(
      server,
      `${POD}.acr`,
      "public",
      addPolicy(server, `${POD}.acr`, "public", `${ACP}PublicAgent`, [ACL.Read, ACL.Control]),
    );
    pod.seed(`${POD}.acr`, await turtle(server));
    await expect(ensureOwnerOnlyContainer(records, storage, OWNER, pod.fetch)).rejects.toThrow(
      "folder is shared",
    );
    expect(writes(pod)).toEqual([]);
  });

  it("refuses unreadable parent rules above storage, including missing advertisements", async () => {
    for (const fault of ["head-401", "head-403", "get-401", "get-403", "link"] as const) {
      const pod = await acpPod();
      const storage = `${POD}alice/`;
      const records = `${storage}settings/access-records/`;
      pod.seed(`${storage}.acr`, await turtle(acr(storage)));
      pod.seed(records, "");
      pod.seed(`${records}.acr`, await turtle(acr(records)));
      intercept(pod, (method, url) => {
        if (method === "HEAD" && url === POD && fault === "link") return new Response(null);
        if (
          (method === "HEAD" && url === POD && fault.startsWith("head")) ||
          (method === "GET" && url === `${POD}.acr` && fault.startsWith("get"))
        )
          return new Response(null, { status: fault.endsWith("401") ? 401 : 403 });
      });
      await expect(ensureOwnerOnlyContainer(records, storage, OWNER, pod.fetch)).rejects.toThrow(
        `server's parent access rules can't be checked at ${POD}`,
      );
      expect(writes(pod)).toEqual([]);
    }
  });

  it("makes strict ancestor advertisements opt-in without changing roles discovery", async () => {
    const pod = await acpPod();
    await seedRecords(pod);
    const settings = `${POD}settings/`;
    intercept(pod, (method, url) =>
      method === "HEAD" && url === settings ? new Response(null) : undefined,
    );
    expect((await readAccessDocuments(RECORDS, { fetch: pod.fetch, root: POD })).model).toBe("acp");
    expect(await grantsWithRoles(RECORDS, { fetch: pod.fetch, root: POD })).toContainEqual(
      expect.objectContaining({ agent: { type: "webid", id: OWNER }, role: "manager" }),
    );
    await expect(recordsKey(RECORDS, POD, OWNER, pod.fetch)).rejects.toThrow(
      `server's parent access rules can't be checked at ${settings}`,
    );
    expect(writes(pod)).toEqual([]);
  });

  it("allows direct public listing access on ancestors but refuses inherited access", async () => {
    for (const member of [false, true]) {
      const pod = await acpPod();
      await seedRecords(pod);
      const root = acr(POD);
      bind(
        root,
        `${POD}.acr`,
        "listing",
        addPolicy(root, `${POD}.acr`, "listing", `${ACP}PublicAgent`, [ACL.Read]),
        member,
      );
      pod.seed(`${POD}.acr`, await turtle(root));
      if (member)
        await expect(recordsKey(RECORDS, POD, OWNER, pod.fetch)).rejects.toThrow(
          "folder is shared",
        );
      else expect(await ensureOwnerOnlyContainer(RECORDS, POD, OWNER, pod.fetch)).toBeDefined();
    }
  });

  it("previews ACP approvals on a subdomain pod whose storage is its origin root", async () => {
    const pod = await acpPod();
    expect(POD).toBe(`${new URL(POD).origin}/`);
    const preview = await previewDecision({ id: REQUEST }, { approve: true }, options(pod));
    expect(preview).toMatchObject({
      model: "acp",
      targets: [{ url: ALICE, role: "viewer", modes: ["read"], dataTypes: [CONTACTS_CLASS] }],
    });
    expect(pod.calls.every(({ method }) => method === "GET" || method === "HEAD")).toBe(true);
    const result = await decide(
      { id: REQUEST },
      { approve: true },
      { ...options(pod), expected: preview },
    );
    expect(result.choices?.targetRoles).toEqual({ [ALICE]: "viewer" });
    expect(pod.body(`${ALICE}.acr`)).toContain(REQUESTER);
    const before = writes(pod).length;
    expect(await previewDecision({ id: REQUEST }, { approve: true }, options(pod))).toEqual(
      preview,
    );
    expect(writes(pod)).toHaveLength(before);
  });

  it("previews every unsealed ACP state without changing its ACR or minting a key", async () => {
    for (const state of ["no-acr", "no-key", "unverified"] as const) {
      const pod = await acpPod();
      const data = acr(RECORDS);
      if (state === "unverified") {
        set(data, ACR, MARK, "true");
        set(data, ACR, KEY, "planted");
      }
      await seedRecords(pod, data);
      if (state === "no-acr") pod.delete(ACR);
      const before = pod.body(ACR);
      const expected = await previewDecision({ id: REQUEST }, { approve: true }, options(pod));
      expect(pod.body(ACR)).toBe(before);
      expect(writes(pod)).toEqual([]);
      pod.seed(`${RECORDS}untrusted.ttl`, "");
      await expect(
        previewDecision({ id: REQUEST }, { approve: true }, options(pod)),
      ).rejects.toThrow(state === "no-key" ? "can't read" : "already has files");
      expect(writes(pod)).toEqual([]);
      pod.delete(`${RECORDS}untrusted.ttl`);
      expect(
        (await decide({ id: REQUEST }, { approve: true }, { ...options(pod), expected })).status,
      ).toBe("approved");
    }
  });

  it("keeps ordinary ACP key lookup read-only without an ACR and seals an existing private one", async () => {
    const pod = await acpPod();
    pod.seed(RECORDS, "");
    expect(await recordsKey(RECORDS, POD, OWNER, pod.fetch)).toBeUndefined();
    expect(writes(pod)).toEqual([]);
    await seedRecords(pod);
    const key = await recordsKey(RECORDS, POD, OWNER, pod.fetch);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(writes(pod).map(({ url }) => url)).toEqual([ACR]);
  });

  it("refuses an ACP preview whose unsealed ACR lacks a conditional-write validator", async () => {
    const pod = await acpPod();
    await seedRecords(pod);
    const original = pod.fetch;
    pod.fetch = async (input, init) => {
      const response = await original(input, init);
      if (String(input) !== ACR || init?.method === "HEAD") return response;
      const headers = new Headers(response.headers);
      headers.delete("etag");
      return new Response(response.body, { status: response.status, headers });
    };
    await expect(previewDecision({ id: REQUEST }, { approve: true }, options(pod))).rejects.toThrow(
      "strong ETag is required",
    );
    expect(writes(pod)).toEqual([]);
  });

  it("requires unconditional owner Read, Write and Control on both scopes", async () => {
    for (const change of ["direct", "members", "control", "conditional", "denied"] as const) {
      const pod = await acpPod();
      const dataset = acr(RECORDS);
      const root = properties(nn(ACR), dataset);
      if (change === "direct") root.values(`${ACP}accessControl`).clear();
      if (change === "members") root.values(`${ACP}memberAccessControl`).clear();
      if (change === "control")
        properties(nn(`${ACR}#owner-policy`), dataset)
          .values(`${ACP}allow`)
          .delete(ACL.Control);
      if (change === "conditional")
        properties(nn(`${ACR}#owner-matcher`), dataset).add(
          `${ACP}client`,
          "https://client.example/",
        );
      if (change === "denied")
        bind(dataset, ACR, "deny", addPolicy(dataset, ACR, "deny", OWNER, [ACL.Write], true));
      await seedRecords(pod, dataset);
      await expect(decide({ id: REQUEST }, { approve: true }, options(pod))).rejects.toThrow(
        "full control",
      );
      expect(writes(pod)).toEqual([]);
    }
  });

  it("never trusts old contents, lost keys, or a key beside an unverified mark", async () => {
    for (const state of ["absent", "unverified", "missing-key"] as const) {
      const pod = await acpPod();
      if (state !== "absent") {
        const dataset = acr(RECORDS);
        if (state === "unverified") {
          set(dataset, ACR, MARK, "true");
          set(dataset, ACR, KEY, "planted");
        }
        await seedRecords(pod, dataset);
      }
      pod.seed(`${RECORDS}old.ttl`, "");
      await expect(decide({ id: REQUEST }, { approve: true }, options(pod))).rejects.toThrow(
        state === "missing-key" ? "can't read" : "already has files",
      );
      expect(accessWrites(pod)).toEqual([]);
      pod.delete(`${RECORDS}old.ttl`);
      expect((await decide({ id: REQUEST }, { approve: true }, options(pod))).status).toBe(
        "approved",
      );
      expect(values(await parseRdf(pod.body(ACR) as string, "text/turtle"), ACR, KEY)[0]).not.toBe(
        "planted",
      );
    }
  });

  it("retains the unverified state after a crash and rechecks emptiness on recovery", async () => {
    const pod = await acpPod();
    let privateWritten = false;
    const restore = intercept(pod, (method, url) => {
      if (method === "PUT" && url === ACR) privateWritten = true;
      if (privateWritten && method === "GET" && url === RECORDS)
        throw new Error("crash after privacy");
    });
    await expect(decide({ id: REQUEST }, { approve: true }, options(pod))).rejects.toThrow(
      "crash after privacy",
    );
    restore();
    expect(pod.body(ACR)).toContain("unverifiedRecords");
    pod.seed(`${RECORDS}stray`, "");
    await expect(decide({ id: REQUEST }, { approve: true }, options(pod))).rejects.toThrow(
      "already has files",
    );
    pod.delete(`${RECORDS}stray`);
    expect((await decide({ id: REQUEST }, { approve: true }, options(pod))).status).toBe(
      "approved",
    );
  });

  it("seals when the ACR itself is listed as a folder member", async () => {
    const pod = await acpPod();
    const listing = new Store();
    properties(nn(RECORDS), listing).add(LDP.contains, ACR);
    const body = await turtle(listing);
    intercept(pod, (method, url) =>
      method === "GET" && url === RECORDS && pod.has(ACR)
        ? new Response(body, { headers: { "content-type": "text/turtle" } })
        : undefined,
    );
    expect(await ensureOwnerOnlyContainer(RECORDS, POD, OWNER, pod.fetch)).toBeDefined();
  });

  it("keeps a sealed key after a crash before the first record", async () => {
    const pod = await acpPod();
    const restore = intercept(pod, (method, url) => {
      if (method === "GET" && url.includes("/decision-")) throw new Error("crash after key");
    });
    await expect(decide({ id: REQUEST }, { approve: true }, options(pod))).rejects.toThrow(
      "crash after key",
    );
    restore();
    const key = values(await parseRdf(pod.body(ACR) as string, "text/turtle"), ACR, KEY)[0];
    expect(key).toBeDefined();
    expect((await decide({ id: REQUEST }, { approve: true }, options(pod))).status).toBe(
      "approved",
    );
    expect(values(await parseRdf(pod.body(ACR) as string, "text/turtle"), ACR, KEY)[0]).toBe(key);
  });

  it("fails closed when listing fails or conditional sealing keeps losing", async () => {
    for (const fault of ["listing", "races"] as const) {
      const pod = await acpPod();
      const restore = intercept(pod, (method, url, init) => {
        if (fault === "listing" && method === "GET" && url === RECORDS)
          return new Response(null, { status: 404 });
        if (
          fault === "races" &&
          method === "PUT" &&
          url === ACR &&
          new Headers(init?.headers).has("if-match")
        )
          return new Response(null, { status: 412 });
      });
      await expect(decide({ id: REQUEST }, { approve: true }, options(pod))).rejects.toThrow(
        fault === "listing" ? "can't be listed" : "kept changing",
      );
      restore();
      expect(accessWrites(pod)).toEqual([]);
    }
  });

  it("refuses mixed targets and models that flip between detection, planning and writing", async () => {
    const mixed = await acpPod();
    // An own WAC ACL disagrees with the ACP storage model.
    mixed.seed(`${ALICE}.acr`, `${podWac(ALICE)}`);
    await expect(decide({ id: REQUEST }, { approve: true }, options(mixed))).rejects.toMatchObject({
      name: "UnsupportedAccessModelError",
      model: "unknown",
    });
    expect(writes(mixed)).toEqual([]);
    for (const step of [checkGrant, applyGrant]) {
      const pod = await acpPod();
      let reads = 0;
      intercept(pod, (method, url) => {
        // First accessDocument detection sees ACP. The roles layer then sees WAC.
        if (method === "GET" && url === `${ALICE}.acr` && ++reads >= 2)
          return new Response(podWac(ALICE), {
            headers: { "content-type": "text/turtle", etag: '"flip"' },
          });
      });
      pod.seed(`${ALICE}.acr`, await turtle(acr(ALICE)));
      await expect(
        step(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch, "acp"),
      ).rejects.toMatchObject({ name: "UnsupportedAccessModelError", model: "unknown" });
      expect(accessWrites(pod)).toEqual([]);
    }
  });
});

describe("ACP graph boundaries and discovery races", () => {
  it("accepts owner-only alternatives, narrowing exclusions and private ACR-self controls", async () => {
    const pod = await acpPod();
    const dataset = acr(RECORDS);
    const ownerPolicy = properties(nn(`${ACR}#owner-policy`), dataset);
    ownerPolicy.values(`${ACP}allOf`).clear();
    ownerPolicy.add(`${ACP}anyOf`, `${ACR}#owner-matcher`);
    const narrow = addPolicy(dataset, ACR, "narrow", OWNER, [ACL.Read]);
    narrow.add(`${ACP}noneOf`, `${ACR}#owner-matcher`);
    bind(dataset, ACR, "narrow", narrow);
    const denying = addPolicy(dataset, ACR, "deny", `${ACP}PublicAgent`, [ACL.Read], true);
    denying.add(`${ACP}noneOf`, `${ACR}#owner-matcher`);
    bind(dataset, ACR, "deny", denying);
    const otherDeny = addPolicy(dataset, ACR, "deny-any", REQUESTER, [ACL.Read], true);
    otherDeny.values(`${ACP}allOf`).clear();
    otherDeny.add(`${ACP}anyOf`, `${ACR}#deny-any-matcher`);
    bind(dataset, ACR, "deny-any", otherDeny);
    const auxiliary = properties(nn(`${ACR}#auxiliary`), dataset);
    auxiliary.add(`${ACP}resource`, ACR);
    bind(
      dataset,
      ACR,
      "aux",
      addPolicy(dataset, ACR, "aux", OWNER, [ACL.Read]),
      false,
      auxiliary.value,
    );
    bind(
      dataset,
      ACR,
      "aux-deny",
      addPolicy(dataset, ACR, "aux-deny", REQUESTER, [ACL.Read], true),
      false,
      auxiliary.value,
    );
    await seedRecords(pod, dataset);
    expect((await decide({ id: REQUEST }, { approve: false }, options(pod))).status).toBe("denied");
  });

  it("refuses unsupported dialects, incomplete definitions and unknown policy structure", async () => {
    const mutations: ((dataset: Store) => void)[] = [
      (d) => properties(nn(`${ACR}#owner-policy`), d).add(`${ACP}allow`, `${ACP}Read`),
      (d) => properties(nn(ACR), d).values(`${ACP}resource`).clear(),
      ...["access", "memberAccess"].map(
        (name) => (d: Store) => properties(nn(ACR), d).add(ACP + name, `${ACR}#owner-policy`),
      ),
      (d) => {
        const p = properties(nn(`${ACR}#owner-policy`), d);
        p.values(`${ACP}allOf`).clear();
        p.add(`${ACP}allOf`, `${ACR}#undefined`);
      },
      (d) =>
        properties(nn(`${ACR}#owner-policy`), d)
          .values(`${ACP}allOf`)
          .clear(),
      (d) =>
        properties(nn(`${ACR}#owner-matcher`), d)
          .values(`${ACP}agent`)
          .clear(),
      (d) => {
        const r = properties(nn(`${ACR}#auxiliary`), d);
        r.add(`${ACP}resource`, ACR);
        bind(
          d,
          ACR,
          "aux-deny",
          addPolicy(d, ACR, "aux-deny", OWNER, [ACL.Read], true),
          false,
          r.value,
        );
      },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const pod = await acpPod();
      const dataset = acr(RECORDS);
      mutate(dataset);
      await seedRecords(pod, dataset);
      await expect(decide({ id: REQUEST }, { approve: true }, options(pod))).rejects.toThrow(
        index < 4 ? UnsupportedAccessModelError : "folder is shared",
      );
      expect(writes(pod)).toEqual([]);
    }
    // Target policy shapes refused by the roles mapper use the typed ACP error.
    for (const step of [applyGrant, checkGrant]) {
      const pod = await acpPod();
      const dataset = acr(ALICE);
      properties(nn(`${ALICE}.acr#owner-matcher`), dataset).add(
        `${ACP}issuer`,
        "https://issuer.example/",
      );
      pod.seed(`${ALICE}.acr`, await turtle(dataset));
      await expect(step(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch)).rejects.toMatchObject({
        name: "UnsupportedAccessModelError",
        model: "acp",
      });
      expect(writes(pod)).toEqual([]);
    }
  });

  it("accounts for inherited denials and keeps constrained owner grants from proving control", async () => {
    const pod = await acpPod();
    await seedRecords(pod);
    const root = acr(POD);
    bind(
      root,
      `${POD}.acr`,
      "deny-owner",
      addPolicy(root, `${POD}.acr`, "deny-owner", OWNER, [ACL.Control], true),
    );
    pod.seed(`${POD}.acr`, await turtle(root));
    await expect(recordsKey(RECORDS, POD, OWNER, pod.fetch)).rejects.toThrow("full control");
    expect(writes(pod)).toEqual([]);
    const constrained = await acpPod();
    const dataset = acr(RECORDS);
    const policy = addPolicy(dataset, ACR, "conditional", OWNER, [ACL.Read]);
    const client = properties(nn(`${ACR}#client`), dataset);
    client.add(`${ACP}client`, "https://client.example/");
    policy.terms(`${ACP}anyOf`).add(client as Term);
    bind(dataset, ACR, "conditional", policy);
    const deny = addPolicy(dataset, ACR, "inert-deny", REQUESTER, [ACL.Read], true);
    deny.values(`${ACP}allOf`).clear();
    properties(nn(`${ACR}#inert-deny-matcher`), dataset)
      .values(`${ACP}agent`)
      .clear();
    properties(nn(`${ACR}#inert-deny-matcher`), dataset)
      .values(`${RDF}type`)
      .clear();
    bind(dataset, ACR, "inert-deny", deny);
    // An owner-excluding denial is inert for the owner.
    deny.add(`${ACP}noneOf`, `${ACR}#owner-matcher`);
    await seedRecords(constrained, dataset);
    expect(await ensureOwnerOnlyContainer(RECORDS, POD, OWNER, constrained.fetch)).toBeDefined();
  });

  it("fails closed when discovery changes before raw verification, and reports empty model discovery", async () => {
    const pod = await acpPod();
    pod.seed(RECORDS, "");
    const settings = {
      unverified: MARK,
      recordsKey: KEY,
      assertEmpty: async () => {},
      notPrivate: "not private",
      missingKey: "missing key",
    };
    await expect(
      acpRecords(RECORDS, POD, OWNER, pod.fetch, `${ACR}-wrong`, settings),
    ).rejects.toThrow("ambiguous");
    const wac = buildPod();
    wac.seed(RECORDS, "");
    await expect(
      acpRecords(RECORDS, POD, OWNER, wac.fetch, `${RECORDS}.acl`, settings),
    ).rejects.toMatchObject({ model: "unknown" });
    await expect(
      checkGrant(ALICE, POD, OWNER, REQUESTER, ["read"], wac.fetch, "acp"),
    ).rejects.toMatchObject({ model: "unknown" });
    pod.seed(`${POD}.acr`, "");
    expect((await readAccessDocuments(POD, { fetch: pod.fetch, root: POD })).model).toBe("unknown");
    expect(await accessModel({ fetch: pod.fetch, storage: POD })).toBe("unknown");
  });

  it("preserves transport errors and refuses a mixed-model race during raw verification", async () => {
    const pod = await acpPod();
    pod.seed(RECORDS, "");
    pod.seed(`${RECORDS}.acr`, await turtle(acr(RECORDS)));
    pod.seed(`${POD}.acr`, podWac(POD));
    const settings = {
      unverified: MARK,
      recordsKey: KEY,
      assertEmpty: async () => {},
      notPrivate: "not private",
      missingKey: "missing key",
    };
    await expect(acpRecords(RECORDS, POD, OWNER, pod.fetch, ACR, settings)).rejects.toMatchObject({
      model: "unknown",
    });
    const network = new TypeError("network failed");
    intercept(pod, () => {
      throw network;
    });
    await expect(acpRecords(RECORDS, POD, OWNER, pod.fetch, ACR, settings)).rejects.toBe(network);
    for (const step of [checkGrant, applyGrant]) {
      const fresh = await acpPod();
      let rootReads = 0;
      intercept(fresh, (method, url) => {
        if (method === "GET" && url === `${POD}.acr` && ++rootReads === 2) throw network;
      });
      await expect(step(ALICE, POD, OWNER, REQUESTER, ["read"], fresh.fetch)).rejects.toBe(network);
      expect(accessWrites(fresh)).toEqual([]);
    }
  });

  it("stops a WAC to ACP flip during role planning, and before initial/resumed target preflight", async () => {
    for (const step of [applyGrant, checkGrant]) {
      const pod = buildPod();
      const original = pod.fetch;
      let rootReads = 0;
      const dataset = acr(ALICE, `${ALICE}.acl`);
      const body = await turtle(dataset);
      const fetch: typeof globalThis.fetch = async (input, init) => {
        if (init?.method !== "HEAD" && String(input) === `${POD}.acl`) rootReads++;
        if (rootReads && String(input) === `${ALICE}.acl` && init?.method !== "HEAD")
          return new Response(body, { headers: { "content-type": "text/turtle", etag: '"v1"' } });
        if (rootReads > 1 && String(input) === `${POD}.acl` && init?.method !== "HEAD")
          return new Response(await turtle(acr(POD, `${POD}.acl`)), {
            headers: { "content-type": "text/turtle", etag: '"v1"' },
          });
        return original(input, init);
      };
      await expect(step(ALICE, POD, OWNER, REQUESTER, ["read"], fetch)).rejects.toMatchObject({
        name: "UnsupportedAccessModelError",
        model: "acp",
      });
    }
    // A new target with ACP under WAC must be refused before the records folder is created.
    for (const resume of [false, true]) {
      const pod = await acpPod();
      const wac = buildPod();
      const wacOptions = { fetch: wac.fetch, storage: POD, webId: OWNER, typeIndex: pod.index };
      if (resume) {
        wac.intercept = (method, url) => {
          if (method === "PUT" && url.includes("/grant-")) throw new Error("crash");
        };
        await expect(decide({ id: REQUEST }, { approve: true }, wacOptions)).rejects.toThrow(
          "crash",
        );
        wac.intercept = undefined;
      }
      // The storage detection is WAC, then a coherent ACP subtree appears on the target check.
      const original = wac.fetch;
      let targetHeads = 0;
      wacOptions.fetch = async (input, init) => {
        if (String(input) === ALICE && init?.method === "HEAD") targetHeads++;
        if (targetHeads && String(input).endsWith(".acl") && init?.method !== "HEAD") {
          const resource = String(input).slice(0, -4);
          return new Response(await turtle(acr(resource, String(input))), {
            headers: { "content-type": "text/turtle", etag: '"v1"' },
          });
        }
        return original(input, init);
      };
      await expect(decide({ id: REQUEST }, { approve: true }, wacOptions)).rejects.toMatchObject({
        model: "acp",
      });
    }
  });
});

function podWac(resource: string) {
  // Only an existing fixture is reused; no production RDF is parsed with text matching.
  return buildPod().body(`${POD}.acl`)?.replaceAll(POD, resource) as string;
}
