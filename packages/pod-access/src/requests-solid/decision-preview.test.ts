// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Term } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildPod,
  CONTACTS_CLASS,
  decisionUrl,
  OWNER,
  POD,
  RECORDS,
  REQUEST,
  REQUESTER,
  recordTurtle,
} from "../../test/requests/fixtures.js";
import { grantsWithRoles } from "../roles/client.js";
import { properties } from "../roles/rdf.js";
import { recordsKey } from "./acl.js";
import {
  ACCM,
  ACL,
  type DecisionPreview,
  DecisionPreviewConflictError,
  type DecisionTarget,
  decide,
  ODRL,
  previewDecision,
  RDF,
  SOLID,
} from "./index.js";
import { set, turtle, values } from "./rdf.js";

const ALICE = `${POD}contacts/alice.ttl`;
const CAROL = `${POD}contacts/carol.ttl`;
const CALENDAR = "http://www.w3.org/2002/12/cal/ical#Vevent";
const nn = DataFactory.namedNode;
const opts = (pod: ReturnType<typeof buildPod>) => ({
  fetch: pod.fetch,
  webId: OWNER,
  storage: POD,
});
const writes = (pod: ReturnType<typeof buildPod>, from = 0) =>
  pod.log.slice(from).filter(({ method }) => method !== "GET" && method !== "HEAD");

async function offer(rules: [string, string[]][], agent = REQUESTER): Promise<string> {
  const dataset = new Store();
  const root = properties(nn(REQUEST), dataset);
  root.add(RDF.type, ODRL.Offer);
  for (const [type, modes] of rules) {
    for (const mode of modes) {
      const permission = properties(DataFactory.blankNode(), dataset);
      permission.add(`${ODRL.ns}assignee`, agent);
      permission.add(`${ODRL.ns}target`, type);
      permission.add(`${ODRL.ns}action`, mode === "append" ? ACL.Append : ODRL.ns + mode);
      root.terms(`${ODRL.ns}permission`).add(permission as Term);
    }
  }
  return turtle(dataset);
}

function index(registrations: [string, string[]][]) {
  const dataset = new Store();
  for (const [type, targets] of registrations) {
    const reg = properties(DataFactory.blankNode(), dataset);
    reg.add(RDF.type, SOLID.TypeRegistration);
    reg.add(SOLID.forClass, type);
    for (const target of targets) reg.add(SOLID.instance, target);
  }
  return dataset;
}

describe("decision previews and bound consent", () => {
  it("previews the exact WAC grants, retains source classes and writes nothing", async () => {
    const pod = buildPod();
    const preview = await previewDecision({ id: REQUEST }, { approve: true }, opts(pod));
    expect(preview).toMatchObject({
      requestId: REQUEST,
      webId: OWNER,
      storage: POD,
      requester: REQUESTER,
      approve: true,
      model: "wac",
      dataTypes: [CONTACTS_CLASS],
      targets: [ALICE, CAROL].map((url) => ({
        url,
        role: "viewer",
        modes: ["read"],
        dataTypes: [CONTACTS_CLASS],
      })),
    });
    expect(writes(pod)).toEqual([]);
    expect(pod.has(RECORDS)).toBe(false);
    expect(pod.has(`${RECORDS}.acl`)).toBe(false);
    const expected: DecisionPreview = JSON.parse(JSON.stringify(preview));
    // Input ordering is not part of the granted set.
    expected.targets.reverse();
    const result = await decide({ id: REQUEST }, { approve: true }, { ...opts(pod), expected });
    for (const target of preview.targets) {
      expect(
        (await grantsWithRoles(target.url, { fetch: pod.fetch, root: POD })).find(
          (grant) => grant.agent.type === "webid" && grant.agent.id === REQUESTER,
        )?.role,
      ).toBe(target.role);
      const grant = await parseRdf(pod.body(result.grantUrl as string) as string, "text/turtle");
      const permissions = [...grant.match(null, nn(`${ODRL.ns}target`), nn(target.url))];
      expect(
        permissions.flatMap((quad) => values(grant, quad.subject, `${ODRL.ns}action`)),
      ).toEqual(target.modes.map((mode) => ODRL.ns + mode));
    }
    expect(result.choices?.targetRoles).toEqual({ [ALICE]: "viewer", [CAROL]: "viewer" });
  });

  it("refuses a stale preview after a container gains or loses a member", async () => {
    for (const added of [true, false]) {
      const pod = buildPod();
      const expected = await previewDecision({ id: REQUEST }, { approve: true }, opts(pod));
      if (added) pod.seed(`${POD}contacts/new.ttl`, "");
      else pod.delete(CAROL);
      const before = pod.log.length;
      await expect(
        decide({ id: REQUEST }, { approve: true }, { ...opts(pod), expected }),
      ).rejects.toBeInstanceOf(DecisionPreviewConflictError);
      expect(writes(pod, before)).toEqual([]);
      expect(pod.has(`${ALICE}.acl`)).toBe(false);
    }
  });

  it("snapshots the consent inputs before asynchronous discovery", async () => {
    const pod = buildPod();
    pod.seed(REQUEST, await offer([[CONTACTS_CLASS, ["read", "write"]]]));
    const decision = { approve: true, role: "viewer" as "viewer" | "editor" };
    const expected = await previewDecision({ id: REQUEST }, decision, opts(pod));
    const fetch: typeof globalThis.fetch = async (input, init) => {
      decision.role = "editor";
      expected.targets.length = 0;
      return pod.fetch(input, init);
    };
    const result = await decide({ id: REQUEST }, decision, { ...opts(pod), fetch, expected });
    expect(result.choices?.targetRoles).toEqual({ [ALICE]: "viewer", [CAROL]: "viewer" });
  });

  it("reports mixed roles per target and all source classes for a shared target", async () => {
    const pod = buildPod();
    pod.seed(
      REQUEST,
      await offer([
        [CONTACTS_CLASS, ["read"]],
        [CALENDAR, ["write"]],
      ]),
    );
    const options = {
      ...opts(pod),
      typeIndex: index([
        [CONTACTS_CLASS, [ALICE, CAROL]],
        [CALENDAR, [CAROL]],
      ]),
    };
    const preview = await previewDecision({ id: REQUEST }, { approve: true }, options);
    expect(preview.targets).toEqual([
      { url: ALICE, role: "viewer", modes: ["read"], dataTypes: [CONTACTS_CLASS] },
      {
        url: CAROL,
        role: "editor",
        modes: ["append", "read", "write"],
        dataTypes: [CALENDAR, CONTACTS_CLASS].sort(),
      },
    ]);
    const result = await decide(
      { id: REQUEST },
      { approve: true },
      { ...options, expected: preview },
    );
    expect(result.choices).toMatchObject({
      role: "editor",
      targetRoles: { [ALICE]: "viewer", [CAROL]: "editor" },
    });
    const before = pod.log.length;
    expect(
      await previewDecision({ id: REQUEST }, { approve: true, role: "viewer" }, options),
    ).toEqual(preview);
    expect(writes(pod, before)).toEqual([]);
  });

  it("binds roles, modes, provenance, identity, metadata and access model", async () => {
    const pod = buildPod();
    pod.seed(REQUEST, await offer([[CONTACTS_CLASS, ["read", "write"]]]));
    const expiresAt = new Date("2028-01-01Z");
    const decision = { approve: true, expiresAt };
    const preview = await previewDecision({ id: REQUEST }, decision, opts(pod));
    for (const mutate of [
      (p: DecisionPreview) => {
        (p.targets[0] as DecisionTarget).role = "viewer";
      },
      (p: DecisionPreview) => {
        (p.targets[0] as DecisionTarget).modes = ["read"];
      },
      (p: DecisionPreview) => {
        (p.targets[0] as DecisionTarget).dataTypes = [CALENDAR];
      },
      (p: DecisionPreview) => {
        p.requester = OWNER;
      },
      (p: DecisionPreview) => {
        p.requestId += "-other";
      },
      (p: DecisionPreview) => {
        p.webId = REQUESTER;
      },
      (p: DecisionPreview) => {
        p.model = "acp";
      },
      (p: DecisionPreview) => {
        p.expiresAt = "2029-01-01T00:00:00.000Z";
      },
      (p: DecisionPreview) => {
        p.purpose = "changed";
      },
      (p: DecisionPreview) => {
        p.approve = false;
      },
    ]) {
      const expected = structuredClone(preview);
      mutate(expected);
      const before = pod.log.length;
      await expect(decide({ id: REQUEST }, decision, { ...opts(pod), expected })).rejects.toThrow(
        DecisionPreviewConflictError,
      );
      expect(writes(pod, before)).toEqual([]);
    }
    const expected = structuredClone(preview);
    expected.targets.forEach((target) => {
      target.modes.reverse();
    });
    expect((await decide({ id: REQUEST }, decision, { ...opts(pod), expected })).status).toBe(
      "approved",
    );
  });

  it("compares a fresh request's changed modes with the preview", async () => {
    const pod = buildPod();
    const expected = await previewDecision({ id: REQUEST }, { approve: true }, opts(pod));
    pod.seed(REQUEST, await offer([[CONTACTS_CLASS, ["write"]]]));
    const before = pod.log.length;
    await expect(
      decide({ id: REQUEST }, { approve: true }, { ...opts(pod), expected }),
    ).rejects.toThrow(DecisionPreviewConflictError);
    expect(writes(pod, before)).toEqual([]);
  });

  it("previews denials without resolving targets and binds the decision", async () => {
    const pod = buildPod();
    const options = { ...opts(pod), typeIndex: new Store() };
    const expected = await previewDecision({ id: REQUEST }, { approve: false }, options);
    expect(expected).toMatchObject({ approve: false, targets: [], dataTypes: [] });
    expect(writes(pod)).toEqual([]);
    await expect(
      decide(
        { id: REQUEST },
        { approve: false },
        { ...options, expected: { ...expected, approve: true } },
      ),
    ).rejects.toThrow(DecisionPreviewConflictError);
    expect(writes(pod)).toEqual([]);
    expect(
      (await decide({ id: REQUEST }, { approve: false }, { ...options, expected })).status,
    ).toBe("denied");
    const before = pod.log.length;
    expect(await previewDecision({ id: REQUEST }, { approve: false }, options)).toEqual(expected);
    expect(writes(pod, before)).toEqual([]);
    await expect(previewDecision({ id: REQUEST }, { approve: true }, options)).rejects.toThrow(
      "Cannot approve a denial",
    );
  });

  it("throws the same resolution and grant refusals as decide, without writes", async () => {
    const missing = buildPod();
    await expect(
      previewDecision(
        { id: REQUEST },
        { approve: true },
        { ...opts(missing), typeIndex: new Store() },
      ),
    ).rejects.toThrow("needs an owner registration");
    const append = buildPod();
    append.seed(REQUEST, await offer([[CONTACTS_CLASS, ["append"]]]));
    await expect(previewDecision({ id: REQUEST }, { approve: true }, opts(append))).rejects.toThrow(
      "only asks to add data",
    );
    const locked = buildPod();
    const acl = `${ALICE}.acl`;
    const data = new Store();
    const rule = properties(nn(`${acl}#owner`), data);
    rule.add(RDF.type, ACL.Authorization);
    rule.add(ACL.agent, OWNER);
    rule.add(ACL.accessTo, ALICE);
    rule.add(ACL.mode, ACL.Read);
    locked.seed(acl, await turtle(data));
    await expect(
      previewDecision({ id: REQUEST }, { approve: true }, opts(locked)),
    ).rejects.toMatchObject({ code: "owner-lockout" });
    for (const pod of [missing, append, locked]) expect(writes(pod)).toEqual([]);
  });

  it("checks unsealed WAC records without minting a key or writing an ACL", async () => {
    for (const state of ["no-acl", "no-key", "unverified", "sealed"] as const) {
      const pod = buildPod();
      pod.seed(RECORDS, "");
      if (state !== "no-acl") {
        await decide({ id: REQUEST }, { approve: false }, opts(pod));
        // Remove decision artifacts and restore a fresh request, leaving the private ACL.
        const body = buildPod().body(REQUEST) as string;
        pod.seed(REQUEST, body);
        for (const { method, url } of pod.log)
          if (method === "PUT" && url.startsWith(RECORDS) && url.endsWith(".ttl")) pod.delete(url);
        const data = await parseRdf(pod.body(`${RECORDS}.acl`) as string, "text/turtle");
        if (state !== "sealed") set(data, `${RECORDS}.acl`, `${ACCM.ns}recordsKey`, undefined);
        if (state === "unverified")
          set(data, `${RECORDS}.acl`, `${ACCM.ns}unverifiedRecords`, "true");
        pod.seed(`${RECORDS}.acl`, await turtle(data));
      }
      const before = pod.log.length;
      const etag = pod.etag(`${RECORDS}.acl`);
      expect(
        (await previewDecision({ id: REQUEST }, { approve: true }, opts(pod))).targets,
      ).toHaveLength(2);
      expect(writes(pod, before)).toEqual([]);
      expect(pod.etag(`${RECORDS}.acl`)).toBe(etag);
    }
  });

  it("keeps the ordinary records-key lookup's absent and unreadable cases", async () => {
    const pod = buildPod();
    expect(await recordsKey(RECORDS, POD, OWNER, pod.fetch)).toBeUndefined();
    pod.seed(RECORDS, "");
    expect(await recordsKey(RECORDS, POD, OWNER, pod.fetch)).toBeUndefined();
    pod.intercept = (method, url) =>
      method === "HEAD" && url === RECORDS ? new Response(null, { status: 403 }) : undefined;
    await expect(recordsKey(RECORDS, POD, OWNER, pod.fetch)).rejects.toThrow(
      "Records folder check failed (403)",
    );
    expect(writes(pod)).toEqual([]);
  });

  it("checks the existing WAC parent in previews and decisions when records are missing", async () => {
    for (const status of [401, 403, 500]) {
      const pod = buildPod();
      const settings = `${POD}settings/`;
      pod.intercept = (method, url) =>
        method === "HEAD" && url === settings ? new Response(null, { status }) : undefined;
      for (const operation of [previewDecision, decide])
        await expect(operation({ id: REQUEST }, { approve: false }, opts(pod))).rejects.toThrow(
          `Access model discovery failed (${status})`,
        );
      expect(pod.log).toContainEqual({ method: "HEAD", url: settings });
      expect(pod.has(RECORDS)).toBe(false);
      expect(writes(pod)).toEqual([]);
    }
  });

  it("previews WAC records under a missing settings folder using the existing root", async () => {
    const pod = buildPod();
    const settings = `${POD}settings/`;
    pod.intercept = (method, url) =>
      method === "HEAD" && url === settings && !pod.has(RECORDS)
        ? new Response(null, { status: 404 })
        : undefined;
    const decision = { approve: false };
    const expected = await previewDecision({ id: REQUEST }, decision, opts(pod));
    expect(writes(pod)).toEqual([]);
    expect((await decide({ id: REQUEST }, decision, { ...opts(pod), expected })).status).toBe(
      "denied",
    );
  });

  it("refuses a preview when a needed request or sealing validator is missing", async () => {
    for (const target of [REQUEST, `${RECORDS}.acl`]) {
      const pod = buildPod();
      if (target !== REQUEST) {
        const data = new Store();
        const rule = properties(nn(`${target}#owner`), data);
        rule.add(RDF.type, ACL.Authorization);
        rule.add(ACL.agent, OWNER);
        rule.add(ACL.accessTo, RECORDS);
        rule.add(ACL.default, RECORDS);
        for (const mode of [ACL.Read, ACL.Write, ACL.Control]) rule.add(ACL.mode, mode);
        pod.seed(RECORDS, "");
        pod.seed(target, await turtle(data));
      }
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const response = await pod.fetch(input, init);
        if (String(input) !== target || init?.method === "HEAD") return response;
        const headers = new Headers(response.headers);
        headers.delete("etag");
        return new Response(response.body, { status: response.status, headers });
      };
      await expect(
        previewDecision({ id: REQUEST }, { approve: true }, { ...opts(pod), fetch }),
      ).rejects.toThrow("strong ETag is required");
      expect(writes(pod)).toEqual([]);
    }
  });

  it("previews a pinned recovery without resolving new members or accepting new choices", async () => {
    const pod = buildPod();
    const decision = { approve: true, role: "viewer" as const };
    pod.intercept = (method, url) => {
      if (method === "PUT" && url.includes("/grant-")) throw new Error("crash");
    };
    await expect(decide({ id: REQUEST }, decision, opts(pod))).rejects.toThrow("crash");
    pod.intercept = undefined;
    pod.seed(`${POD}contacts/new.ttl`, "");
    const before = pod.log.length;
    const options = { ...opts(pod), typeIndex: new Store() };
    const expected = await previewDecision({ id: REQUEST }, decision, options);
    expect(expected.targets.map(({ url }) => url)).toEqual([ALICE, CAROL]);
    await expect(
      previewDecision({ id: REQUEST }, { approve: true, role: "editor" }, options),
    ).rejects.toThrow("still finishing");
    await expect(previewDecision({ id: REQUEST }, { approve: false }, options)).rejects.toThrow(
      "Cannot deny an approval",
    );
    expect(writes(pod, before)).toEqual([]);
    expect((await decide({ id: REQUEST }, decision, { ...options, expected })).status).toBe(
      "approved",
    );
    expect(pod.has(`${POD}contacts/new.ttl.acl`)).toBe(false);
  });

  it("rejects a concurrent pin with a different scope even when choices match", async () => {
    for (const changed of [true, false]) {
      const pod = buildPod();
      pod.seed(REQUEST, await offer([[CONTACTS_CLASS, ["write"]]]));
      const expected = await previewDecision({ id: REQUEST }, { approve: true }, opts(pod));
      pod.intercept = (method, url, init) => {
        if (method !== "PUT" || !url.includes("/decision-")) return undefined;
        pod.intercept = undefined;
        return (async () => {
          const data = await parseRdf(String(init?.body), "text/turtle");
          const snapshot = JSON.parse(values(data, url, `${ACCM.ns}snapshot`)[0] as string);
          if (changed) {
            snapshot.modes = ["read"];
            for (const target of snapshot.targets) snapshot.targetModes[target] = ["read"];
          }
          pod.seed(url, await recordTurtle(url, { outcome: "approving", snapshot }));
          return new Response(null, { status: 412 });
        })() as unknown as Response;
      };
      const result = decide({ id: REQUEST }, { approve: true }, { ...opts(pod), expected });
      if (changed) {
        await expect(result).rejects.toThrow(DecisionPreviewConflictError);
        expect(pod.has(`${ALICE}.acl`)).toBe(false);
      } else expect((await result).status).toBe("approved");
    }
  });

  it("refuses malformed recorded provenance and previews legacy records explicitly without it", async () => {
    const pod = buildPod();
    pod.intercept = (method, url) =>
      method === "PUT" && url === REQUEST ? new Response(null, { status: 500 }) : undefined;
    await expect(decide({ id: REQUEST }, { approve: true }, opts(pod))).rejects.toThrow("500");
    pod.intercept = undefined;
    const url = await decisionUrl(pod);
    const data = await parseRdf(pod.body(url) as string, "text/turtle");
    const snapshot = JSON.parse(values(data, url, `${ACCM.ns}snapshot`)[0] as string);
    for (const targetDataTypes of [
      null,
      "invalid",
      {},
      { [ALICE]: [CONTACTS_CLASS], [CAROL]: [] },
      { [ALICE]: [CONTACTS_CLASS], [CAROL]: [CALENDAR] },
      { [ALICE]: [CONTACTS_CLASS], other: [CONTACTS_CLASS] },
    ]) {
      pod.seed(
        url,
        await recordTurtle(url, {
          outcome: "approving",
          snapshot: { ...snapshot, targetDataTypes },
        }),
      );
      const before = pod.log.length;
      await expect(previewDecision({ id: REQUEST }, { approve: true }, opts(pod))).rejects.toThrow(
        "Invalid persisted approval snapshot",
      );
      expect(writes(pod, before)).toEqual([]);
    }
    delete snapshot.targetDataTypes;
    pod.seed(url, await recordTurtle(url, { outcome: "approving", snapshot }));
    const expected = await previewDecision({ id: REQUEST }, { approve: true }, opts(pod));
    expect(expected.targets.every((target) => target.dataTypes === undefined)).toBe(true);
    expect(
      (await decide({ id: REQUEST }, { approve: true }, { ...opts(pod), expected })).status,
    ).toBe("approved");
  });
});
