import { describe, it, expect } from "vitest";
import { parseRdf } from "@jeswr/fetch-rdf";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { categoryById } from "./categories.js";
import type { CategorySummary } from "./pod-data.js";
import { AclWriteError } from "./errors.js";
import {
  ALL_DATA,
  WacPermissionsBackend,
  aclUrlFromLinkHeader,
  allGrants,
  describeModes,
  fetchAppIdentity,
  roleForModes,
  type PermissionsContext,
} from "./permissions.js";
import { aclPod, type AclPod } from "./__fixtures__/acl-pod.js";

const POD = "https://alice.example/";
const OWNER = "https://alice.example/profile/card#me";
const APP_WHOLE_POD = "https://coach.example/id#this";
const APP_HEALTH = "https://tracker.example/profile#app";
const APP_STRAY = "https://stray.example/id#this";

const ROOT_ACL = `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.
<#owner> a acl:Authorization ;
  acl:agent <${OWNER}> ;
  acl:accessTo <./> ; acl:default <./> ;
  acl:mode acl:Read, acl:Write, acl:Control .
<#public> a acl:Authorization ;
  acl:agentClass foaf:Agent ;
  acl:accessTo <./> ;
  acl:mode acl:Read .
<#coach> a acl:Authorization ;
  acl:agent <${APP_WHOLE_POD}> ;
  acl:accessTo <./> ; acl:default <./> ;
  acl:mode acl:Read .
<#stray> a acl:Authorization ;
  acl:agent <${APP_STRAY}> ;
  acl:accessTo <https://alice.example/misc/secret.ttl> ;
  acl:mode acl:Read .
`;

const HEALTH_ACL = `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization ;
  acl:agent <${OWNER}> ;
  acl:accessTo <./> ; acl:default <./> ;
  acl:mode acl:Read, acl:Write, acl:Control .
<#tracker> a acl:Authorization ;
  acl:agent <${APP_HEALTH}> ;
  acl:accessTo <./> ; acl:default <./> ;
  acl:mode acl:Read, acl:Write .
`;

function healthSummary(): CategorySummary {
  const category = categoryById("health");
  if (!category) throw new Error("health category missing");
  return {
    category,
    hasData: true,
    locations: [
      {
        forClass: "https://schema.org/MedicalEntity",
        container: `${POD}health/`,
      },
    ],
  };
}

function ctx(): PermissionsContext {
  return { ownerWebId: OWNER, podRoot: POD, summaries: [healthSummary()] };
}

interface RecordedPut {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/**
 * A fake pod: serves HEAD (Link rel=acl) for resources, GET (turtle + etag)
 * for ACL docs, and records PUTs. ACL docs are mutable so a PUT round-trip
 * can be re-read.
 */
function fakePod(options?: {
  putStatus?: number[] | number;
  healthAclMissing?: boolean;
}) {
  const docs = new Map<string, string>([
    [`${POD}.acl`, ROOT_ACL],
    ...(options?.healthAclMissing ? [] : [[`${POD}health/.acl`, HEALTH_ACL] as const]),
  ]);
  const resources = new Set([POD, `${POD}health/`]);
  const puts: RecordedPut[] = [];
  const putStatuses = Array.isArray(options?.putStatus)
    ? [...options.putStatus]
    : options?.putStatus !== undefined
      ? [options.putStatus]
      : [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "HEAD" || method === "GET") {
      // ACL documents serve their turtle body + etag.
      const aclBody = docs.get(url);
      if (aclBody !== undefined) {
        return new Response(method === "HEAD" ? null : aclBody, {
          status: 200,
          headers: { "content-type": "text/turtle", etag: '"v1"' },
        });
      }
      // Resources answer with the Link: rel="acl" discovery header. Discovery
      // uses GET (the auth-patched fetch only upgrades GET on a 401).
      if (resources.has(url)) {
        return new Response(method === "HEAD" ? null : "", {
          status: 200,
          headers: { link: '<.acl>; rel="acl"', "content-type": "text/turtle" },
        });
      }
      return new Response("missing", { status: 404 });
    }
    if (method === "PUT") {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => {
        headers[k] = v;
      });
      puts.push({ url, body: String(init?.body), headers });
      const status = putStatuses.shift() ?? 205;
      if (status < 400) docs.set(url, String(init?.body));
      return new Response(null, { status });
    }
    return new Response("unexpected", { status: 500 });
  };

  return { fetchImpl, puts, docs };
}

describe("aclUrlFromLinkHeader", () => {
  it("resolves a relative rel=acl target against the resource URL", () => {
    expect(aclUrlFromLinkHeader('<.acl>; rel="acl"', `${POD}health/`)).toBe(
      `${POD}health/.acl`,
    );
  });

  it("finds the acl link among multiple link-values", () => {
    const header =
      '<http://www.w3.org/ns/ldp#Container>; rel="type", <https://x.example/a,b>; rel="describedby", <card.acl>; rel=acl';
    expect(aclUrlFromLinkHeader(header, `${POD}profile/card`)).toBe(
      `${POD}profile/card.acl`,
    );
  });

  it("returns undefined when no acl relation is present", () => {
    expect(aclUrlFromLinkHeader('<x>; rel="describedby"', POD)).toBeUndefined();
    expect(aclUrlFromLinkHeader(null, POD)).toBeUndefined();
  });
});

describe("WacPermissionsBackend.listApps", () => {
  it("builds the per-app read model, excluding the owner and public rules", async () => {
    const pod = fakePod();
    const backend = new WacPermissionsBackend(pod.fetchImpl);
    const apps = await backend.listApps(ctx());

    const ids = apps.map((a) => a.agentId).sort();
    expect(ids).toEqual([APP_WHOLE_POD, APP_STRAY, APP_HEALTH].sort());
    // Neither the owner nor agentClass (public) rules become "apps".
    expect(ids).not.toContain(OWNER);
  });

  it("maps a storage-root default rule to a single whole-pod 'All data' row", async () => {
    const pod = fakePod();
    const backend = new WacPermissionsBackend(pod.fetchImpl);
    const apps = await backend.listApps(ctx());

    const coach = apps.find((a) => a.agentId === APP_WHOLE_POD);
    expect(coach?.wholePod).toBe(true);
    expect(coach?.categories.map((c) => c.category.id)).toEqual([ALL_DATA.id]);
    expect(coach?.modes).toEqual(["read"]);
  });

  it("maps a category-container rule to that category with its modes", async () => {
    const pod = fakePod();
    const backend = new WacPermissionsBackend(pod.fetchImpl);
    const apps = await backend.listApps(ctx());

    const tracker = apps.find((a) => a.agentId === APP_HEALTH);
    expect(tracker?.wholePod).toBe(false);
    expect(tracker?.categories.map((c) => c.category.id)).toEqual(["health"]);
    expect(tracker?.categories[0].modes).toEqual(["read", "write"]);
    expect(tracker?.categories[0].grants[0]).toMatchObject({
      aclUrl: `${POD}health/.acl`,
      authorization: `${POD}health/.acl#tracker`,
    });
  });

  it("buckets rules on unrecognised resources under 'Other data' (never hidden)", async () => {
    const pod = fakePod();
    const backend = new WacPermissionsBackend(pod.fetchImpl);
    const apps = await backend.listApps(ctx());

    const stray = apps.find((a) => a.agentId === APP_STRAY);
    expect(stray?.categories.map((c) => c.category.id)).toEqual(["other"]);
  });
});

describe("WacPermissionsBackend.revokeGrants", () => {
  it("removes the agent from the named authorizations and PUTs with If-Match", async () => {
    const pod = fakePod();
    const backend = new WacPermissionsBackend(pod.fetchImpl);
    const apps = await backend.listApps(ctx());
    const tracker = apps.find((a) => a.agentId === APP_HEALTH);
    if (!tracker) throw new Error("tracker missing from read model");

    await backend.revokeGrants(APP_HEALTH, allGrants(tracker));

    expect(pod.puts).toHaveLength(1);
    const put = pod.puts[0];
    expect(put.url).toBe(`${POD}health/.acl`);
    expect(put.headers["if-match"]).toBe('"v1"');

    const dataset = await parseRdf(put.body, "text/turtle", { baseIRI: put.url });
    const acl = new AclResource(dataset, DataFactory);
    const agents = [...acl.authorizations].flatMap((a) => [...a.agent]);
    expect(agents).not.toContain(APP_HEALTH);
    // The owner's rule survives untouched.
    expect(agents).toContain(OWNER);
    // The now-empty tracker rule is pruned entirely.
    expect(put.body).not.toContain("tracker");
  });

  it("disappears from the read model after a revoke round-trip", async () => {
    const pod = fakePod();
    const backend = new WacPermissionsBackend(pod.fetchImpl);
    const before = await backend.listApps(ctx());
    const tracker = before.find((a) => a.agentId === APP_HEALTH);
    if (!tracker) throw new Error("tracker missing from read model");

    await backend.revokeGrants(APP_HEALTH, allGrants(tracker));
    const after = await backend.listApps(ctx());
    expect(after.map((a) => a.agentId)).not.toContain(APP_HEALTH);
  });

  it("fails closed with AclWriteError when the PUT is rejected", async () => {
    const pod = fakePod({ putStatus: 500 });
    const backend = new WacPermissionsBackend(pod.fetchImpl);
    const apps = await backend.listApps(ctx());
    const tracker = apps.find((a) => a.agentId === APP_HEALTH);
    if (!tracker) throw new Error("tracker missing from read model");

    await expect(
      backend.revokeGrants(APP_HEALTH, allGrants(tracker)),
    ).rejects.toBeInstanceOf(AclWriteError);
  });

  it("retries once after a 412 conflict, then succeeds", async () => {
    const pod = fakePod({ putStatus: [412, 205] });
    const backend = new WacPermissionsBackend(pod.fetchImpl);
    const apps = await backend.listApps(ctx());
    const tracker = apps.find((a) => a.agentId === APP_HEALTH);
    if (!tracker) throw new Error("tracker missing from read model");

    await backend.revokeGrants(APP_HEALTH, allGrants(tracker));
    expect(pod.puts).toHaveLength(2);
  });
});

describe("WacPermissionsBackend.revokeGrants — origins", () => {
  const ORIGIN = "https://app.example";
  const OTHER_ORIGIN = "https://other.example";
  const HEALTH = `${POD}health/`;
  const originAcl = (origins: string) => `${HEALTH_ACL}
<#via-origin> a acl:Authorization ;
  acl:agent <${APP_HEALTH}> ; acl:origin ${origins} ;
  acl:accessTo <./> ; acl:default <./> ;
  acl:mode acl:Read, acl:Write .`;

  async function revokeOrigin(origins: string) {
    const pod = aclPod([POD, HEALTH], {
      [`${POD}.acl`]: ROOT_ACL,
      [`${HEALTH}.acl`]: originAcl(origins),
    });
    const backend = new WacPermissionsBackend(pod.fetch);
    const app = (await backend.listApps(ctx())).find((a) => a.agentId === ORIGIN);
    if (!app) throw new Error("origin missing from read model");
    expect(app.kind).toBe("origin");
    await backend.revokeGrants(ORIGIN, allGrants(app));
    const doc = pod.docs.get(`${HEALTH}.acl`);
    if (!doc) throw new Error("health ACL missing");
    return new AclResource(
      await parseRdf(doc.body, "text/turtle", { baseIRI: `${HEALTH}.acl` }),
      DataFactory,
    );
  }

  it("deletes a rule whose last origin is revoked instead of un-restricting its agents", async () => {
    const acl = await revokeOrigin(`<${ORIGIN}>`);
    const rules = [...acl.authorizations];
    // The origin-restricted Read+Write rule is gone, not widened to every origin.
    expect(rules.some((a) => a.origin.size > 0)).toBe(false);
    // The app's separate, unrestricted Read+Write rule (#tracker) is untouched.
    expect(rules.filter((a) => a.agent.has(APP_HEALTH))).toHaveLength(1);
    expect(rules.some((a) => a.agent.has(OWNER) && a.canReadWriteAcl)).toBe(true);
  });

  it("refuses to delete an origin rule that carries Control, writing nothing", async () => {
    const pod = aclPod([POD, HEALTH], {
      [`${POD}.acl`]: ROOT_ACL,
      [`${HEALTH}.acl`]: `${HEALTH_ACL}
<#owner-via-origin> a acl:Authorization ;
  acl:agent <${OWNER}> ; acl:origin <${ORIGIN}> ;
  acl:accessTo <./> ; acl:default <./> ;
  acl:mode acl:Read, acl:Write, acl:Control .`,
    });
    const before = pod.docs.get(`${HEALTH}.acl`)?.body;
    const backend = new WacPermissionsBackend(pod.fetch);
    const app = (await backend.listApps(ctx())).find((a) => a.agentId === ORIGIN);
    if (!app) throw new Error("origin missing from read model");
    await expect(backend.revokeGrants(ORIGIN, allGrants(app))).rejects.toMatchObject({
      name: "SharingError",
      code: "owner-lockout",
    });
    expect(pod.docs.get(`${HEALTH}.acl`)?.body).toBe(before);
  });

  it("keeps the rule restricted to its remaining origins", async () => {
    const acl = await revokeOrigin(`<${ORIGIN}>, <${OTHER_ORIGIN}>`);
    const restricted = [...acl.authorizations].filter((a) => a.origin.size > 0);
    expect(restricted).toHaveLength(1);
    expect([...restricted[0].origin]).toEqual([OTHER_ORIGIN]);
    expect(restricted[0].agent.has(APP_HEALTH)).toBe(true);
  });
});

describe("WacPermissionsBackend.grant (via @jeswr/pod-access/roles addGrant)", () => {
  const NEW_APP = "https://new-app.example/id#this";
  const HEALTH = `${POD}health/`;

  function rolePod(withHealthAcl = true) {
    return aclPod([POD, HEALTH], {
      [`${POD}.acl`]: ROOT_ACL,
      ...(withHealthAcl ? { [`${HEALTH}.acl`]: HEALTH_ACL } : {}),
    });
  }

  async function aclAt(pod: AclPod, url: string) {
    const doc = pod.docs.get(url);
    if (!doc) throw new Error(`no ACL at ${url}`);
    return new AclResource(await parseRdf(doc.body, "text/turtle", { baseIRI: url }), DataFactory);
  }

  it("adds Read on the category folder and its contents with a conditional PUT", async () => {
    const pod = rolePod();
    const etag = pod.docs.get(`${HEALTH}.acl`)?.etag;
    await new WacPermissionsBackend(pod.fetch).grant(ctx(), NEW_APP, "health");

    const puts = pod.puts();
    expect(puts.map((p) => p.url)).toEqual([`${HEALTH}.acl`]);
    expect(puts[0].headers["if-match"]).toBe(etag);
    const acl = await aclAt(pod, `${HEALTH}.acl`);
    const granted = [...acl.authorizations].filter((a) => a.agent.has(NEW_APP));
    expect(granted).toHaveLength(1);
    expect(granted[0].accessTo).toBe(HEALTH);
    expect(granted[0].default).toBe(HEALTH);
    expect(granted[0].canRead).toBe(true);
    expect(granted[0].canWrite).toBe(false);
    expect(granted[0].canReadWriteAcl).toBe(false);
    // Existing rules survive.
    expect([...acl.authorizations].some((a) => a.agent.has(APP_HEALTH))).toBe(true);
    expect([...acl.authorizations].some((a) => a.agent.has(OWNER) && a.canReadWriteAcl)).toBe(
      true,
    );
  });

  it("shows up in the read model after a grant round-trip (Read+Write = editor)", async () => {
    const pod = rolePod();
    const backend = new WacPermissionsBackend(pod.fetch);
    await backend.grant(ctx(), NEW_APP, "health", ["read", "write"]);

    const added = (await backend.listApps(ctx())).find((a) => a.agentId === NEW_APP);
    expect(added?.categories.map((c) => c.category.id)).toEqual(["health"]);
    expect(added?.categories[0].modes).toEqual(["read", "write"]);
  });

  it("can be revoked again from the listing (blank-node rules round-trip)", async () => {
    const pod = rolePod();
    const backend = new WacPermissionsBackend(pod.fetch);
    await backend.grant(ctx(), NEW_APP, "health", ["read", "write"]);
    const added = (await backend.listApps(ctx())).find((a) => a.agentId === NEW_APP);
    if (!added) throw new Error("granted app missing from read model");

    await backend.revokeGrants(NEW_APP, allGrants(added));
    const after = await backend.listApps(ctx());
    expect(after.map((a) => a.agentId)).not.toContain(NEW_APP);
    expect(after.map((a) => a.agentId)).toContain(APP_HEALTH);
    const acl = await aclAt(pod, `${HEALTH}.acl`);
    expect([...acl.authorizations].some((a) => a.agent.has(NEW_APP))).toBe(false);
  });

  it("is a no-op when the app already holds that role", async () => {
    const pod = rolePod();
    await new WacPermissionsBackend(pod.fetch).grant(ctx(), APP_HEALTH, "health", ["read"]);
    expect(pod.puts()).toHaveLength(0);
  });

  it("materialises inherited rules into a new ACL so nobody loses access", async () => {
    const pod = rolePod(false);
    await new WacPermissionsBackend(pod.fetch).grant(ctx(), NEW_APP, "health");

    const [put] = pod.puts();
    expect(put.url).toBe(`${HEALTH}.acl`);
    expect(put.headers["if-none-match"]).toBe("*");
    const acl = await aclAt(pod, `${HEALTH}.acl`);
    const rules = [...acl.authorizations];
    // The owner keeps full control and the whole-pod app keeps its inherited
    // Read — a fresh ACL replaces inheritance, so both must be copied.
    expect(rules.some((a) => a.agent.has(OWNER) && a.canReadWriteAcl && a.canWrite)).toBe(true);
    expect(rules.some((a) => a.agent.has(APP_WHOLE_POD) && a.canRead)).toBe(true);
    expect(rules.some((a) => a.agent.has(NEW_APP) && a.canRead && !a.canWrite)).toBe(true);
    // The root ACL is never edited.
    expect(pod.docs.get(`${POD}.acl`)?.body).toBe(ROOT_ACL);
  });

  it("refuses a mode set that is not exactly a role, without any request", async () => {
    const pod = rolePod();
    await expect(
      new WacPermissionsBackend(pod.fetch).grant(ctx(), NEW_APP, "health", ["append"]),
    ).rejects.toBeInstanceOf(AclWriteError);
    expect(pod.requests).toHaveLength(0);
  });

  it("refuses a category location outside the pod and writes nothing there", async () => {
    const pod = rolePod();
    const foreign: PermissionsContext = {
      ownerWebId: OWNER,
      podRoot: POD,
      summaries: [
        {
          ...healthSummary(),
          locations: [{ forClass: "https://schema.org/MedicalEntity", container: "https://bob.example/health/" }],
        },
      ],
    };
    await expect(
      new WacPermissionsBackend(pod.fetch).grant(foreign, NEW_APP, "health"),
    ).rejects.toBeInstanceOf(AclWriteError);
    expect(pod.puts()).toHaveLength(0);
  });

  it("surfaces a rejected PUT as AclWriteError", async () => {
    const pod = rolePod();
    pod.failNextPuts(403);
    await expect(
      new WacPermissionsBackend(pod.fetch).grant(ctx(), NEW_APP, "health"),
    ).rejects.toBeInstanceOf(AclWriteError);
    expect(pod.docs.get(`${HEALTH}.acl`)?.body).toBe(HEALTH_ACL);
  });

  it("throws AclWriteError when the category has no storage location", async () => {
    const pod = rolePod();
    const empty: PermissionsContext = { ownerWebId: OWNER, podRoot: POD, summaries: [] };
    await expect(
      new WacPermissionsBackend(pod.fetch).grant(empty, NEW_APP, "health"),
    ).rejects.toBeInstanceOf(AclWriteError);
  });
});

describe("roleForModes", () => {
  it("maps only exact role mode sets, never rounding up", () => {
    expect(roleForModes(["read"])).toBe("viewer");
    expect(roleForModes(["read", "write"])).toBe("editor");
    expect(roleForModes(["read", "append", "write"])).toBe("editor");
    expect(roleForModes(["read", "write", "control"])).toBe("manager");
    expect(roleForModes(["append"])).toBeUndefined();
    expect(roleForModes(["read", "append"])).toBeUndefined();
    expect(roleForModes(["read", "control"])).toBeUndefined();
    expect(roleForModes(["write"])).toBeUndefined();
  });
});

describe("fetchAppIdentity", () => {
  it("reads client_name and client_uri from a Client Identifier Document", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          "@context": "https://www.w3.org/ns/solid/oidc-context.jsonld",
          client_id: "https://coach.example/clientid.jsonld",
          client_name: "Mara Coach",
          client_uri: "https://coach.example",
          logo_uri: "https://coach.example/logo.png",
        }),
        { status: 200, headers: { "content-type": "application/ld+json" } },
      );
    const id = await fetchAppIdentity("https://coach.example/clientid.jsonld", fetchImpl);
    expect(id.name).toBe("Mara Coach");
    expect(id.homepage).toBe("https://coach.example");
    // Logos are never surfaced — name + homepage only.
    expect(Object.keys(id)).not.toContain("logoUrl");
  });

  it("falls back to an RDF profile name for WebID-shaped agents", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        `@prefix foaf: <http://xmlns.com/foaf/0.1/>.
         <https://tracker.example/profile#app> foaf:name "Tired Bike" .`,
        { status: 200, headers: { "content-type": "text/turtle" } },
      );
    const id = await fetchAppIdentity("https://tracker.example/profile#app", fetchImpl);
    expect(id.name).toBe("Tired Bike");
  });

  it("falls back to the URL host when the agent URL cannot be dereferenced", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network down");
    };
    const id = await fetchAppIdentity("https://opaque.example/agent#x", fetchImpl);
    expect(id.name).toBe("opaque.example");
    expect(id.homepage).toBe("https://opaque.example");
  });
});

describe("describeModes", () => {
  it("describes modes in plain language", () => {
    expect(describeModes(["read"])).toBe("see");
    expect(describeModes(["read", "write"])).toBe("see and change");
    expect(describeModes(["read", "append", "control"])).toBe(
      "see, add to and manage sharing of",
    );
  });
});
