// AUTHORED-BY Codex GPT-6
import { PodScopeError } from "@jeswr/guarded-fetch";
import { describe, expect, it } from "vitest";
import { PrivateIndexAccessError } from "../../src/apps/docs/lib/model/errors.js";
import { ensureTypeRegistrations } from "../../src/apps/docs/lib/model/type-index.js";
import { verifyPrivateIndexAccess } from "../../src/apps/docs/lib/model/type-index-access.js";
import { DOCUMENT_CLASS, NS } from "../../src/apps/docs/lib/model/vocab.js";
import { type MockResponse, mockFetch, privateIndexPolicy } from "./helpers.js";

const POD = "https://pod.example/alice/";
const WEBID = `${POD}profile/card#me`;
const INDEX = `${POD}settings/privateTypeIndex.ttl`;
const ACL = "http://www.w3.org/ns/auth/acl#";
const ACP = "http://www.w3.org/ns/solid/acp#";
const OWNER = `@prefix acl: <${ACL}>. <#owner> a acl:Authorization; acl:accessTo <${INDEX}>; acl:agent <${WEBID}>; acl:mode acl:Read, acl:Write, acl:Control.`;
const verify = (script: Record<string, MockResponse>) => {
  const { fetch } = mockFetch(script);
  return verifyPrivateIndexAccess(INDEX, WEBID, POD, fetch);
};
const head = (resource: string, link = `<${resource}.acl>; rel="acl"`) => ({
  [`HEAD ${resource}`]: { headers: { link } },
});

// These use actual WAC RDF through typed accessors, not a boolean permission stub.
describe("private Type Index effective access", () => {
  it("accepts direct owner-only WAC and ignores grants for other resources or without modes", async () => {
    await expect(
      verify({
        ...privateIndexPolicy(INDEX, WEBID),
        [`GET ${INDEX}.acl`]: {
          body: `${OWNER}
      <#other> a acl:Authorization; acl:accessTo <${POD}public>; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>; acl:mode acl:Read.
      <#empty> a acl:Authorization; acl:accessTo <${INDEX}>; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>.
    `,
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("reads every accessTo target rather than only the first one", async () => {
    await expect(
      verify({
        ...privateIndexPolicy(INDEX, WEBID),
        [`GET ${INDEX}.acl`]: {
          body: `${OWNER}
      <#public> a acl:Authorization; acl:accessTo <${POD}public>, <${INDEX}>; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>; acl:mode acl:Read.
    `,
        },
      }),
    ).rejects.toBeInstanceOf(PrivateIndexAccessError);
  });

  it.each([
    `acl:agent <https://bob.example/#me>`,
    `acl:agent <${WEBID}>, <https://bob.example/#me>`,
    `acl:agent <${WEBID}>; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>`,
    `acl:agent <${WEBID}>; acl:agentClass acl:AuthenticatedAgent`,
    `acl:agent <${WEBID}>; acl:agentGroup <${POD}group>`,
    `acl:agent <${WEBID}>; acl:origin <https://app.example>`,
  ])("rejects non-owner or unverified principals: %s", async (principal) => {
    await expect(
      verify({
        ...privateIndexPolicy(INDEX, WEBID),
        [`GET ${INDEX}.acl`]: {
          body: `${OWNER}
      <#grant> a acl:Authorization; acl:accessTo <${INDEX}>; ${principal}; acl:mode acl:Read.
    `,
        },
      }),
    ).rejects.toBeInstanceOf(PrivateIndexAccessError);
  });

  it.each([
    "",
    `@prefix acl: <${ACL}>. <#owner> a acl:Authorization; acl:accessTo <${INDEX}>; acl:agent <${WEBID}>; acl:mode acl:Read.`,
  ])("rejects an absent or incomplete owner grant", async (body) => {
    await expect(
      verify({ ...privateIndexPolicy(INDEX, WEBID), [`GET ${INDEX}.acl`]: { body } }),
    ).rejects.toBeInstanceOf(PrivateIndexAccessError);
  });

  it("uses the nearest inherited default policy and skips a genuinely absent parent", async () => {
    const { fetch, calls } = mockFetch({
      ...head(INDEX),
      [`HEAD ${POD}settings/`]: { status: 404 },
      ...head(POD),
      [`GET ${POD}.acl`]: {
        body: OWNER.replace(`acl:accessTo <${INDEX}>`, `acl:default <${POD}>`),
      },
    });
    await expect(verifyPrivateIndexAccess(INDEX, WEBID, POD, fetch)).resolves.toBeUndefined();
    expect(calls.map((call) => call.url)).toEqual([
      INDEX,
      `${INDEX}.acl`,
      `${POD}settings/`,
      POD,
      `${POD}.acl`,
    ]);
  });

  it("stops at an existing nearest ACL even if a more distant policy is private", async () => {
    const parent = `${POD}settings/`;
    const { fetch, calls } = mockFetch({
      ...head(INDEX),
      ...head(parent),
      ...privateIndexPolicy(POD, WEBID),
      [`GET ${parent}.acl`]: { body: OWNER },
    });
    await expect(verifyPrivateIndexAccess(INDEX, WEBID, POD, fetch)).rejects.toBeInstanceOf(
      PrivateIndexAccessError,
    );
    expect(calls.some((call) => call.url === POD)).toBe(false);
  });

  it("rejects public inherited defaults", async () => {
    const parent = `${POD}settings/`;
    await expect(
      verify({
        ...head(INDEX),
        ...head(parent),
        [`GET ${parent}.acl`]: {
          body:
            OWNER.replace(`acl:accessTo <${INDEX}>`, `acl:default <${parent}>`) +
            `
      <#public> a acl:Authorization; acl:default <${parent}>; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>; acl:mode acl:Read.
    `,
        },
      }),
    ).rejects.toBeInstanceOf(PrivateIndexAccessError);
  });

  it.each([401, 403, 500])("propagates unreadable effective ACLs (%s)", async (status) => {
    await expect(
      verify({ ...head(INDEX), [`GET ${INDEX}.acl`]: { status } }),
    ).rejects.toMatchObject({ status });
    await expect(verify({ [`HEAD ${INDEX}`]: { status } })).rejects.toMatchObject({ status });
  });

  it("stops searching at the selected storage root", async () => {
    const { fetch, calls } = mockFetch({
      ...head(INDEX),
      ...head(`${POD}settings/`),
      ...head(POD),
    });
    await expect(verifyPrivateIndexAccess(INDEX, WEBID, POD, fetch)).rejects.toBeInstanceOf(
      PrivateIndexAccessError,
    );
    expect(calls.every((call) => call.url.startsWith(POD))).toBe(true);
  });

  it.each([
    undefined,
    '<meta>; rel="describedby"',
    '<meta>; rel="not-acl"',
    '<meta>; title="other; rel=acl"; rel="describedby"',
  ])("rejects missing or unrelated control links (%s)", async (link) => {
    await expect(
      verify({ [`HEAD ${INDEX}`]: { headers: link ? { link } : {} } }),
    ).rejects.toBeInstanceOf(PrivateIndexAccessError);
  });

  it.each([
    "acl",
    '"acl"',
    '"describedby acl"',
    '"acl describedby"',
  ])("resolves relative control URLs with rel=%s", async (rel) => {
    await expect(
      verify({
        ...head(
          INDEX,
          `<other>; rel="describedby", <privateTypeIndex.ttl.acl>; title="policy"; rel=${rel}`,
        ),
        [`GET ${INDEX}.acl`]: { body: OWNER },
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    { ...head(INDEX, `<${INDEX}.acr>; rel="acl"`) },
    { ...head(INDEX, `<${INDEX}.acr>; rel="${ACP}accessControl"`) },
    {
      ...head(INDEX),
      [`GET ${INDEX}.acl`]: { body: `${OWNER} <#acp> <${ACP}accessControl> <#policy>.` },
    },
    {
      ...head(INDEX),
      [`GET ${INDEX}.acl`]: { body: `${OWNER} <#acp> a <${ACP}AccessControlResource>.` },
    },
  ])("fails closed for unsupported ACP or hybrid policies", async (script) => {
    await expect(verify(script)).rejects.toBeInstanceOf(PrivateIndexAccessError);
  });

  it("rejects malformed WAC principals rather than ignoring them", async () => {
    await expect(
      verify({
        ...head(INDEX),
        [`GET ${INDEX}.acl`]: {
          body: OWNER.replace(`acl:agent <${WEBID}>`, 'acl:agent "not a WebID"'),
        },
      }),
    ).rejects.toThrow();
  });

  it("scope-checks advertised policy URLs and their redirects", async () => {
    await expect(
      verify({ ...head(INDEX, '<https://evil.example/policy>; rel="acl"') }),
    ).rejects.toBeInstanceOf(PodScopeError);
    const { fetch: transport } = mockFetch(head(INDEX));
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push(String(url));
      if (String(url) === `${INDEX}.acl`)
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/policy" },
        });
      return transport(url, init);
    };
    await expect(verifyPrivateIndexAccess(INDEX, WEBID, POD, fetchImpl)).rejects.toMatchObject({
      cause: expect.any(PodScopeError),
    });
    expect(calls).toEqual([INDEX, `${INDEX}.acl`]);
  });

  it.each([
    false,
    true,
  ])("never links or registers a publicly readable private index (linked: %s)", async (linked) => {
    const { fetch, calls } = mockFetch({
      [`GET ${WEBID}`]: {
        body: linked ? `<${WEBID}> <${NS.SOLID}privateTypeIndex> <${INDEX}>.` : "",
      },
      [`PUT ${INDEX}`]: { status: 201 },
      [`GET ${INDEX}`]: { body: "" },
      ...head(INDEX),
      [`GET ${INDEX}.acl`]: {
        body: `${OWNER} <#public> a acl:Authorization; acl:accessTo <${INDEX}>; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>; acl:mode acl:Read.`,
      },
    });
    await expect(
      ensureTypeRegistrations({
        webId: WEBID,
        podRoot: POD,
        registrations: [{ forClass: DOCUMENT_CLASS, container: `${POD}docs/` }],
        fetchImpl: fetch,
      }),
    ).rejects.toBeInstanceOf(PrivateIndexAccessError);
    expect(
      calls
        .filter((call) => call.method === "PUT")
        .every((call) => call.url === INDEX && call.headers["if-none-match"] === "*"),
    ).toBe(true);
  });
});
