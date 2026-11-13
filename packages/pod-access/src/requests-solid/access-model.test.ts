// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildPod,
  INBOX,
  OWNER,
  POD,
  RECORDS,
  REQUESTER,
  rootAclTurtle,
} from "../../test/requests/fixtures.js";
import { RDF, serialize } from "../rdf.js";
import { appendAcp } from "../roles/rdf.js";
import {
  accessModel,
  applyGrant,
  checkGrant,
  ensureOwnerOnlyContainer,
  recordsKey,
  UnsupportedAccessModelError,
} from "./acl.js";
import { decide } from "./approval.js";
import { ACL } from "./vocab.js";

const ID = `${INBOX}request-1.ttl`;
const ALICE = `${POD}contacts/alice.ttl`;

/**
 * An ACP pod that advertises each resource's ACR only with `rel="acl"`, as ESS does (`?ext=acr`)
 * or as a CSS ACP pod may (`.acr`). Every request is recorded, including any to an ACR.
 */
function acpPod(suffix: "?ext=acr" | ".acr") {
  return advertisingPod(suffix, async (resource, url) => {
    const dataset = new Store();
    appendAcp(
      dataset,
      resource,
      url,
      [{ agent: { type: "webid", id: OWNER }, modes: new Set(["read", "write"] as const) }],
      suffix === ".acr" ? "css" : "ess",
    );
    return turtleResponse(await serialize(dataset));
  });
}

const turtleResponse = (body: string) =>
  new Response(body, { headers: { "content-type": "text/turtle", etag: '"1"' } });

/**
 * The fixture pod with each resource advertising `<resource><suffix>` as `rel="acl"`, its access
 * documents answered by `document` (read-only). Every request is recorded.
 */
function advertisingPod(
  suffix: string,
  document: (resource: string, url: string) => Promise<Response>,
) {
  const pod = buildPod();
  const calls: { method: string; url: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    if (url.endsWith(suffix)) {
      if (method !== "GET") return new Response(null, { status: 405 });
      return document(url.slice(0, -suffix.length), url);
    }
    const response = await pod.fetch(input, init);
    if (method !== "GET" && method !== "HEAD") return response;
    const headers = new Headers(response.headers);
    headers.set("link", `<${url}${suffix}>; rel="acl"`);
    return new Response(response.body, { status: response.status, headers });
  };
  const writes = () => calls.filter(({ method }) => method !== "GET" && method !== "HEAD");
  return { pod, fetch, calls, writes };
}

const opts = (fetch: typeof globalThis.fetch) => ({
  fetch,
  webId: OWNER,
  storage: POD,
  publicFetch: async () => new Response(null, { status: 404 }),
});

describe("ACP advertised with rel=acl (ESS style)", () => {
  it("accessModel reads the advertised document and reports ACP, not WAC", async () => {
    for (const suffix of ["?ext=acr", ".acr"] as const) {
      const ess = acpPod(suffix);
      expect(await accessModel({ fetch: ess.fetch, storage: POD })).toBe("acp");
      expect(await accessModel({ fetch: ess.fetch, storage: POD, target: ALICE })).toBe("acp");
      expect(ess.calls.some(({ url }) => url.endsWith(suffix))).toBe(true);
      expect(ess.writes()).toEqual([]);
    }
  });

  it("approving and denying refuse with UnsupportedAccessModelError and write nothing", async () => {
    for (const approve of [true, false]) {
      const ess = acpPod("?ext=acr");
      await expect(decide({ id: ID }, { approve }, opts(ess.fetch))).rejects.toMatchObject({
        name: "UnsupportedAccessModelError",
        model: "acp",
      });
      expect(ess.writes()).toEqual([]);
    }
  });

  it("the records folder is never created, sealed or read as an ACL", async () => {
    for (const existing of [false, true]) {
      const ess = acpPod("?ext=acr");
      if (existing) ess.pod.seed(RECORDS, "");
      await expect(ensureOwnerOnlyContainer(RECORDS, POD, OWNER, ess.fetch)).rejects.toBeInstanceOf(
        UnsupportedAccessModelError,
      );
      if (existing)
        await expect(recordsKey(RECORDS, POD, OWNER, ess.fetch)).rejects.toBeInstanceOf(
          UnsupportedAccessModelError,
        );
      expect(ess.writes()).toEqual([]);
      expect(ess.calls.some(({ url }) => url === `${RECORDS}.acl`)).toBe(false);
    }
  });

  it("an explicit WAC pin refuses an ACP target before writing", async () => {
    const acp = acpPod(".acr");
    for (const step of [checkGrant, applyGrant]) {
      const error = await step(ALICE, POD, OWNER, REQUESTER, ["read"], acp.fetch, "wac").catch(
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(UnsupportedAccessModelError);
      expect(error).toMatchObject({ model: "acp" });
    }
    expect(acp.writes()).toEqual([]);
  });

  it("model detection honours the caller's signal", async () => {
    const pod = buildPod();
    const controller = new AbortController();
    const urls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      urls.push(String(input));
      const response = await pod.fetch(input, init);
      controller.abort();
      return response;
    };
    await expect(
      accessModel({ fetch, storage: POD, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(urls).toEqual([POD]);
  });
});

describe("detection fails closed", () => {
  const headLink = (pod: ReturnType<typeof buildPod>, url: string, link: string) => {
    pod.intercept = (method, at) =>
      method === "HEAD" && at === url ? new Response(null, { headers: { link } }) : undefined;
  };

  it("an acl link the roles layer cannot read is unknown, never WAC", async () => {
    const pod = buildPod();
    headLink(pod, POD, `<${POD}.acl>; rel="ACL"`);
    expect(await accessModel({ fetch: pod.fetch, storage: POD })).toBe("unknown");
    const records = buildPod();
    records.seed(RECORDS, "");
    headLink(records, RECORDS, `<${RECORDS}.acl>; rel="ACL"`);
    await expect(
      ensureOwnerOnlyContainer(RECORDS, POD, OWNER, records.fetch),
    ).rejects.toMatchObject({ model: "unknown" });
    expect(records.log.filter(({ method }) => method === "PUT")).toEqual([]);
  });

  it("refuses a records ACL the two Link parsers disagree on", async () => {
    const pod = buildPod();
    pod.seed(RECORDS, "");
    headLink(pod, RECORDS, `<${RECORDS}other.acl>; rel="ACL", <${RECORDS}.acl>; rel="acl"`);
    await expect(ensureOwnerOnlyContainer(RECORDS, POD, OWNER, pod.fetch)).rejects.toThrow(
      "ambiguous",
    );
    expect(pod.log.filter(({ method }) => method === "PUT")).toEqual([]);
  });

  it("creates no records folder when storage's model can't be checked", async () => {
    const pod = buildPod();
    pod.intercept = (method, url) =>
      method === "HEAD" && url === POD ? new Response(null, { status: 503 }) : undefined;
    await expect(ensureOwnerOnlyContainer(RECORDS, POD, OWNER, pod.fetch)).rejects.toThrow(
      "discovery failed (503)",
    );
    expect(pod.log.filter(({ method }) => method === "PUT")).toEqual([]);
  });

  it("propagates discovery failures other than a missing access link", async () => {
    const pod = buildPod();
    headLink(pod, POD, '<https://evil.example/root.acl>; rel="acl"');
    await expect(accessModel({ fetch: pod.fetch, storage: POD })).rejects.toMatchObject({
      code: "scope",
    });
    const broken = buildPod();
    broken.intercept = (method, url) => {
      if (method === "GET" && url === `${POD}.acl`) throw new TypeError("network down");
    };
    await expect(accessModel({ fetch: broken.fetch, storage: POD })).rejects.toThrow(
      "network down",
    );
  });
});

describe("WAC pods are unchanged", () => {
  it("reports WAC and seals the records folder", async () => {
    const pod = buildPod();
    expect(await accessModel({ fetch: pod.fetch, storage: POD, target: ALICE })).toBe("wac");
    expect(await accessModel({ fetch: pod.fetch, storage: POD.slice(0, -1) })).toBe("wac");
    const key = await ensureOwnerOnlyContainer(RECORDS, POD, OWNER, pod.fetch);
    expect(await recordsKey(RECORDS, POD, OWNER, pod.fetch)).toBe(key);
    expect(pod.body(`${RECORDS}.acl`)).toContain(OWNER);
  });
});

describe("detection decides only from existing, non-empty access documents", () => {
  const acpDocument = async (resource: string, url: string, dialect: "ess" | "css" = "ess") => {
    const dataset = new Store();
    appendAcp(
      dataset,
      resource,
      url,
      [{ agent: { type: "webid", id: OWNER }, modes: new Set(["read", "write"] as const) }],
      dialect,
    );
    return turtleResponse(await serialize(dataset));
  };
  const missing = async () => new Response(null, { status: 404 });

  it("a target whose own ACR is missing under an existing ACP ancestor is ACP and refused", async () => {
    const ess = advertisingPod("?ext=acr", (resource, url) =>
      resource === ALICE ? missing() : acpDocument(resource, url),
    );
    expect(await accessModel({ fetch: ess.fetch, storage: POD, target: ALICE })).toBe("acp");
    await expect(decide({ id: ID }, { approve: true }, opts(ess.fetch))).rejects.toMatchObject({
      name: "UnsupportedAccessModelError",
      model: "acp",
    });
    expect(ess.writes()).toEqual([]);
  });

  it("refuses an existing records folder whose ESS ACRs are missing at every level", async () => {
    const ess = advertisingPod("?ext=acr", missing);
    ess.pod.seed(RECORDS, "");
    await expect(ensureOwnerOnlyContainer(RECORDS, POD, OWNER, ess.fetch)).rejects.toMatchObject({
      name: "UnsupportedAccessModelError",
      model: "unknown",
    });
    expect(await accessModel({ fetch: ess.fetch, storage: POD })).toBe("unknown");
    expect(ess.writes()).toEqual([]);
  });

  it("empty access documents everywhere are unknown and refused", async () => {
    const empty = advertisingPod(".acl", async () => turtleResponse(""));
    expect(await accessModel({ fetch: empty.fetch, storage: POD, target: ALICE })).toBe("unknown");
    await expect(decide({ id: ID }, { approve: true }, opts(empty.fetch))).rejects.toMatchObject({
      name: "UnsupportedAccessModelError",
      model: "unknown",
    });
    empty.pod.seed(RECORDS, "");
    await expect(ensureOwnerOnlyContainer(RECORDS, POD, OWNER, empty.fetch)).rejects.toMatchObject({
      model: "unknown",
    });
    expect(empty.writes()).toEqual([]);
  });

  it("mixed access models are unknown, in detection and in the sharing layer", async () => {
    // Both vocabularies in one document, and an ACP document under a WAC root ACL.
    const mixedVocabulary = async (resource: string, url: string) => {
      const response = await acpDocument(resource, url, "css");
      const dataset = await parseRdf(await response.text(), "text/turtle", { baseIRI: url });
      dataset.addQuad(
        DataFactory.namedNode(`${url}#wac`),
        DataFactory.namedNode(`${RDF}type`),
        DataFactory.namedNode(ACL.Authorization),
      );
      return turtleResponse(await serialize(dataset));
    };
    for (const pod of [
      advertisingPod(".acl", mixedVocabulary),
      advertisingPod(".acl", async (resource, url) =>
        resource === POD ? turtleResponse(rootAclTurtle()) : acpDocument(resource, url, "css"),
      ),
    ]) {
      expect(await accessModel({ fetch: pod.fetch, storage: POD, target: ALICE })).toBe("unknown");
      for (const step of [checkGrant, applyGrant]) {
        const error = await step(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch).catch(
          (thrown: unknown) => thrown,
        );
        expect(error).toBeInstanceOf(UnsupportedAccessModelError);
        expect(error).toMatchObject({ model: "unknown" });
      }
      pod.pod.seed(RECORDS, "");
      await expect(ensureOwnerOnlyContainer(RECORDS, POD, OWNER, pod.fetch)).rejects.toMatchObject({
        name: "UnsupportedAccessModelError",
        model: "unknown",
      });
      expect(pod.writes()).toEqual([]);
    }
  });

  it("other sharing-layer refusals still propagate unchanged", async () => {
    const pod = buildPod();
    pod.intercept = (method, url) =>
      method === "GET" && url === `${ALICE}.acl` ? new Response(null, { status: 500 }) : undefined;
    const error = await checkGrant(ALICE, POD, OWNER, REQUESTER, ["read"], pod.fetch).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).not.toBeInstanceOf(UnsupportedAccessModelError);
    expect(error).toMatchObject({ code: "invalid-response" });
  });
});
