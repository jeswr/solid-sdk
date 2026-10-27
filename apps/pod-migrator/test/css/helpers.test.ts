// AUTHORED-BY Codex GPT-6
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseRdf } from "@jeswr/fetch-rdf";
import { AccessControlResource, AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { createPodHttp } from "../../src/engine/index.js";
import { accountRequest, createAccount, rememberCookies } from "./account.js";
import { createProofKey, createSession, exchangeToken, localUrl, mintProof } from "./auth.js";
import { cssComponentState } from "./component-state.mjs";
import { fixtureAccess, ownerRule } from "./fixtures.js";
import {
  accessLink,
  appendProbeBody,
  assertSubset,
  conditionalAccess,
  modesFromHead,
  observeWrites,
  probeAccess,
} from "./probe.js";
import { cssDirectory, memoryConfig } from "./server.js";

const base = "http://localhost:12345/";
const endpoint = `${base}.oidc/token`;
const credentials = { id: "id: /é", secret: "secret:+ &" };
function jwt(value: string) {
  const parts = value.split(".");
  return {
    header: JSON.parse(Buffer.from(parts[0] as string, "base64url").toString()),
    claims: JSON.parse(Buffer.from(parts[1] as string, "base64url").toString()),
    signed: Buffer.from(parts.slice(0, 2).join(".")),
    signature: Buffer.from(parts[2] as string, "base64url"),
  };
}
const tokenResponse = (value = "test-token") =>
  Response.json({ access_token: value, token_type: "DPoP", expires_in: 600 });

describe("offline CSS DPoP transport", () => {
  it("signs verifiable ES256 proofs with public JWK, seconds, unique jti, htm/htu and ath", () => {
    const key = createProofKey();
    const proof = jwt(
      mintProof(key, "patch", `${base}resource?ignored=true#fragment`, {
        now: 1_800_000_123_456,
        token: "token",
        nonce: "server-nonce",
      }),
    );
    expect(proof.header).toEqual({ typ: "dpop+jwt", alg: "ES256", jwk: key.jwk });
    expect(Object.keys(key.jwk).sort()).toEqual(["crv", "kty", "x", "y"]);
    expect(proof.claims).toMatchObject({
      htm: "PATCH",
      htu: `${base}resource`,
      iat: 1_800_000_123,
      nonce: "server-nonce",
      ath: createHash("sha256").update("token").digest("base64url"),
    });
    expect(proof.signature).toHaveLength(64);
    expect(
      verify(
        "sha256",
        proof.signed,
        { key: createPublicKey({ key: key.jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
        proof.signature,
      ),
    ).toBe(true);
    expect(
      verify(
        "sha256",
        Buffer.from("tampered"),
        { key: createPublicKey({ key: key.jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
        proof.signature,
      ),
    ).toBe(false);
    const next = jwt(mintProof(key, "POST", endpoint));
    expect(next.claims.jti).not.toBe(proof.claims.jti);
    expect(next.claims).not.toHaveProperty("ath");
    expect(next.claims).not.toHaveProperty("nonce");
  });

  it("builds OAuth Basic credentials correctly and retries a token nonce with a fresh proof", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("nonce", { status: 400, headers: { "dpop-nonce": "challenge" } }),
      )
      .mockResolvedValueOnce(tokenResponse());
    const token = await exchangeToken(endpoint, credentials, createProofKey(), fetcher);
    expect(token.token).toBe("test-token");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const requests = fetcher.mock.calls.map(([, init]) => ({
      headers: new Headers(init?.headers),
      init,
    }));
    expect(requests[0]?.headers.get("authorization")).toBe(
      `Basic ${Buffer.from(`${encodeURIComponent(credentials.id)}:${encodeURIComponent(credentials.secret)}`).toString("base64")}`,
    );
    expect(String(requests[0]?.init?.body)).toBe("grant_type=client_credentials&scope=webid");
    const first = jwt(requests[0]?.headers.get("dpop") as string);
    const retry = jwt(requests[1]?.headers.get("dpop") as string);
    expect(first.claims).not.toHaveProperty("ath");
    expect(retry.claims).toMatchObject({ nonce: "challenge", htm: "POST", htu: endpoint });
    expect(retry.claims.jti).not.toBe(first.claims.jti);
    expect(retry.header.jwk).toEqual(first.header.jwk);
    expect(requests.every(({ init }) => init?.redirect === "manual")).toBe(true);
  });

  it("bounds nonce retries and rejects non-DPoP, malformed and failed exchanges", async () => {
    for (const response of [
      new Response(null, { status: 500 }),
      Response.json({ access_token: "x", token_type: "Bearer", expires_in: 60 }),
      Response.json({ access_token: "", token_type: "DPoP", expires_in: 60 }),
      Response.json({ access_token: "x", token_type: "DPoP", expires_in: -1 }),
    ]) {
      await expect(
        exchangeToken(
          endpoint,
          credentials,
          createProofKey(),
          vi.fn<typeof fetch>().mockResolvedValue(response),
        ),
      ).rejects.toThrow();
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(null, { status: 401, headers: { "dpop-nonce": "again" } }),
      );
    await expect(exchangeToken(endpoint, credentials, createProofKey(), fetcher)).rejects.toThrow(
      "401",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("binds resource proofs to token/key, preserves PUT bytes, caches nonces and retries once", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response(null, { status: 401, headers: { "dpop-nonce": "rs-nonce" } }),
      )
      .mockResolvedValueOnce(new Response("ok"))
      .mockResolvedValueOnce(new Response("ok"));
    const session = await createSession(endpoint, credentials, [base], fetcher);
    const bytes = new Uint8Array([0, 255, 1]);
    await session(`${base}resource?version=1`, { method: "PUT", body: bytes });
    await session(`${base}other`);
    const calls = fetcher.mock.calls.slice(1);
    const proofs = calls.map(([, init]) => jwt(new Headers(init?.headers).get("dpop") as string));
    expect(proofs[0]?.claims).toMatchObject({
      htu: `${base}resource`,
      htm: "PUT",
      ath: createHash("sha256").update("test-token").digest("base64url"),
    });
    expect(proofs[1]?.claims.nonce).toBe("rs-nonce");
    expect(proofs[2]?.claims).toMatchObject({ nonce: "rs-nonce", htu: `${base}other`, htm: "GET" });
    expect(new Set(proofs.map((proof) => proof.claims.jti)).size).toBe(3);
    expect(calls[0]?.[1]?.body).toBe(bytes);
    expect(calls[1]?.[1]?.body).toBe(bytes);
    expect(proofs[0]?.header.jwk).toEqual(
      jwt(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("dpop") as string).header.jwk,
    );
    expect(calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
  });

  it("fails closed on foreign URLs, caller credentials, Request objects and redirects", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://foreign.test/" } }),
      );
    const session = await createSession(endpoint, credentials, [base], fetcher);
    for (const url of [
      "https://foreign.test/",
      "http://localhost:54321/",
      "http://user@localhost:12345/",
    ])
      await expect(session(url)).rejects.toThrow();
    await expect(session(new Request(`${base}x`))).rejects.toThrow("string URL");
    for (const header of ["authorization", "dpop"])
      await expect(session(`${base}x`, { headers: { [header]: "injected" } })).rejects.toThrow(
        "Caller-supplied",
      );
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(session(`${base}redirect`)).rejects.toThrow("redirects");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(() => localUrl("http://127.0.0.1:12345/")).toThrow("loopback");
  });

  it("renews expiring tokens once for concurrent requests and hashes the renewed token", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(tokenResponse("old"))
        .mockResolvedValueOnce(tokenResponse("new"))
        .mockImplementation(async () => new Response("ok"));
      const session = await createSession(endpoint, credentials, [base], fetcher);
      now.mockReturnValue(680_000);
      await Promise.all([session(`${base}a`), session(`${base}b`)]);
      expect(fetcher.mock.calls.filter(([url]) => url === endpoint)).toHaveLength(2);
      for (const [, init] of fetcher.mock.calls.slice(2))
        expect(jwt(new Headers(init?.headers).get("dpop") as string).claims.ath).toBe(
          createHash("sha256").update("new").digest("base64url"),
        );
    } finally {
      now.mockRestore();
    }
  });
});

describe("offline CSS JSON account API", () => {
  it("builds explicit JSON requests, carries multiple cookies, and fences hypermedia controls", () => {
    const cookies = new Map<string, string>();
    const headers = new Headers();
    headers.append("set-cookie", "session=first; Path=/.account/; HttpOnly");
    headers.append("set-cookie", "other=a=b; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/");
    rememberCookies(headers, cookies);
    rememberCookies(new Headers({ "set-cookie": "session=rotated; Path=/" }), cookies);
    expect(cookies).toEqual(
      new Map([
        ["session", "rotated"],
        ["other", "a=b"],
      ]),
    );
    const post = accountRequest(base, "/.account/account/", cookies, {});
    expect(post.init.body).toBe("{}");
    expect(post.init.method).toBe("POST");
    expect(new Headers(post.init.headers).get("cookie")).toBe("session=rotated; other=a=b");
    expect(new Headers(post.init.headers).get("content-type")).toBe("application/json");
    const get = accountRequest(base, "/.account/", cookies);
    expect(get.init.method).toBe("GET");
    expect(get.init.body).toBeUndefined();
    for (const endpoint of [
      "https://foreign.test/.account/",
      "http://localhost:54321/.account/",
      "/pod/private",
      "/.account/../private",
    ])
      expect(() => accountRequest(base, endpoint, cookies, {})).toThrow();
  });

  it("drives registration → discovered controls → pod → credentials → discovered token endpoint", async () => {
    const responses = [
      Response.json({}, { headers: { "set-cookie": "session=one; Path=/" } }),
      Response.json({
        controls: {
          password: { create: `${base}.account/custom/password/` },
          account: {
            pod: `${base}.account/custom/pod/`,
            clientCredentials: `${base}.account/custom/credentials/`,
          },
        },
      }),
      Response.json({}),
      Response.json({ pod: `${base}returned-pod/`, webId: `${base}returned-pod/profile/card#me` }),
      Response.json(credentials),
      Response.json({ token_endpoint: `${base}custom-token` }),
      tokenResponse(),
      new Response("private"),
    ];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("Unexpected HTTP request");
      return response;
    });
    const account = await createAccount(base, [base], fetcher);
    expect(account.podRoot).toBe(`${base}returned-pod/`);
    expect(account.webId).toBe(`${base}returned-pod/profile/card#me`);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${base}.account/account/`,
      `${base}.account/`,
      `${base}.account/custom/password/`,
      `${base}.account/custom/pod/`,
      `${base}.account/custom/credentials/`,
      `${base}.well-known/openid-configuration`,
      `${base}custom-token`,
    ]);
    for (const [, init] of fetcher.mock.calls.slice(1, 5))
      expect(new Headers(init?.headers).get("cookie")).toBe("session=one");
    const body = JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body));
    expect(body.webId).toBe(account.webId);
    await account.side.http.get(`${account.podRoot}private`);
    expect(new Headers(fetcher.mock.calls[7]?.[1]?.headers).get("authorization")).toBe(
      "DPoP test-token",
    );
    expect(responses).toHaveLength(0);
  });

  it("fails when registration is unavailable rather than skipping authentication", async () => {
    await expect(
      createAccount(
        base,
        [base],
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 })),
      ),
    ).rejects.toThrow("403");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ controls: {} }));
    await expect(createAccount(base, [base], fetcher)).rejects.toThrow("missing registration");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("offline effective-access and write auditing", () => {
  it("extracts current user modes, normalizes Write, and rejects malformed/error responses", () => {
    expect(
      modesFromHead(
        new Response(null, { headers: { "wac-allow": 'user="read write",public="read control"' } }),
      ),
    ).toEqual(new Set(["read", "write", "append"]));
    expect(modesFromHead(new Response(null, { status: 403 }))).toBeUndefined();
    expect(modesFromHead(new Response())).toBeUndefined();
    for (const status of [404, 302, 500])
      expect(() => modesFromHead(new Response(null, { status }))).toThrow();
    expect(() =>
      modesFromHead(new Response(null, { headers: { "wac-allow": 'user="unterminated' } })),
    ).toThrow("Malformed");
    expect(() =>
      modesFromHead(new Response(null, { headers: { "wac-allow": 'user="",public="read"' } })),
    ).toThrow("advertise Read");
    expect(conditionalAccess(new Response(null, { status: 412 }))).toBe(true);
    expect(conditionalAccess(new Response(null, { status: 409 }), true)).toBe(true);
    for (const status of [401, 403])
      expect(conditionalAccess(new Response(null, { status }))).toBe(false);
    for (const status of [200, 204, 404, 409, 500])
      expect(() => conditionalAccess(new Response(null, { status }))).toThrow();
  });

  it("discovers ACL links with context and refuses ambiguity", () => {
    const response = new Response(null, {
      headers: { link: '<unrelated.acl>; rel="acl"; anchor="/other", <file.acr>; rel="acl"' },
    });
    expect(accessLink(response, `${base}file`)).toBe(`${base}file.acr`);
    expect(() => accessLink(new Response(), `${base}file`)).toThrow("one ACL");
    expect(() =>
      accessLink(
        new Response(null, { headers: { link: '<a>; rel="acl", <b>; rel="acl"' } }),
        `${base}file`,
      ),
    ).toThrow("one ACL");
  });

  it("detects append/write/control even when Read is denied, without performing a mutation", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const patch = await appendProbeBody();
    expect(patch).toContain("INSERT DATA");
    expect(patch).toContain("urn:css-test:value");
    const modes = await probeAccess(fetcher, `${base}file`, `${base}file.acl`, patch);
    expect(modes).toEqual(new Set(["append"]));
    expect(() => assertSubset(new Set(), modes, "between writes")).toThrow("widened append");
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual([
      "HEAD",
      "PUT",
      "PATCH",
      "PUT",
    ]);
    for (const [, init] of fetcher.mock.calls.slice(1))
      expect(new Headers(init?.headers).get("if-match")).toMatch(/^"css-test-never-match-/);
    expect(fetcher.mock.calls[2]?.[1]?.body).toBe(patch);
  });

  it("falls back to operations for ACP without headers and fails on unexpected probe errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response())
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(
      await probeAccess(
        fetcher,
        `${base}container/`,
        `${base}container/.acr`,
        await appendProbeBody(),
      ),
    ).toEqual(new Set(["read", "write", "append"]));
    const failure = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(probeAccess(failure, `${base}file`, `${base}file.acl`, "patch")).rejects.toThrow(
      "500",
    );
    const header = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { headers: { "wac-allow": 'user="read append",public="read"' } }),
      );
    expect(await probeAccess(header, `${base}file`, `${base}file.acl`, "patch")).toEqual(
      new Set(["read", "append"]),
    );
    expect(header).toHaveBeenCalledTimes(1);
  });

  it("awaits every write observer, including placeholders and ACL writes, and propagates audit failures", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 201 }));
    const http = createPodHttp({ root: base, fetch: fetcher, allowInsecureLoopback: true });
    let release: (() => void) | undefined;
    const observer = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("widened"));
    const audited = observeWrites(http, observer);
    let done = false;
    const write = audited.http.put(`${base}file`, "", { contentType: "text/plain" }).then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(observer).toHaveBeenCalledTimes(1));
    expect(done).toBe(false);
    release?.();
    await write;
    expect(done).toBe(true);
    await expect(
      audited.http.put(`${base}file.acl`, "", { contentType: "text/turtle" }),
    ).rejects.toThrow("widened");
    await audited.http.delete(`${base}file`);
    expect(audited.writes.map((event) => [event.method, event.current, event.status])).toEqual([
      ["PUT", `${base}file`, 201],
      ["PUT", `${base}file.acl`, 201],
      ["DELETE", `${base}file`, 201],
    ]);
    expect(audited.writes.map((event) => event.done)).toEqual([1, 2, 3]);
    assertSubset(new Set(["read", "append"]), new Set(["read"]), "safe");
  });
});

describe("shipped CSS configuration and independent seed documents", () => {
  it("isolates CSS 7.2 component discovery from other workspace versions and remote contexts", async () => {
    const state = await cssComponentState(cssDirectory);
    expect(Object.values(state.componentModules)).toEqual([
      join(cssDirectory, "dist/components/components.jsonld"),
    ]);
    expect(Object.keys(state.contexts).sort()).toEqual([
      "https://linkedsoftwaredependencies.org/bundles/npm/@solid/community-server/^7.0.0/components/context.jsonld",
      "https://linkedsoftwaredependencies.org/bundles/npm/componentsjs/^5.0.0/components/context.jsonld",
    ]);
    expect(state.mainModulePath).toBe(cssDirectory);
    expect(state.nodeModuleImportPaths).toEqual([cssDirectory]);
    expect(state.nodeModulePaths).toHaveLength(2);
  });

  it("CSS grants ACL recovery to the pod owner, so an unreadable fixture needs a delegate", async () => {
    const requireCss = createRequire(join(cssDirectory, "package.json"));
    const { OwnerPermissionReader } = requireCss("./dist/authorization/OwnerPermissionReader.js");
    const root = `${base}pod/`;
    const acl = { path: `${root}file.acl` };
    const reader = new OwnerPermissionReader(
      {
        findByBaseUrl: async () => ({ id: "pod" }),
        getOwners: async () => [{ webId: "urn:owner" }],
      },
      { isAuxiliaryIdentifier: (value: { path: string }) => value.path.endsWith(".acl") },
      { getStorageIdentifier: async () => ({ path: root }) },
    );
    const requestedModes = { distinctKeys: () => [acl] };
    const owner = await reader.handle({
      requestedModes,
      credentials: { agent: { webId: "urn:owner" } },
    });
    const delegated = await reader.handle({
      requestedModes,
      credentials: { agent: { webId: "urn:delegate" } },
    });
    expect(owner.get(acl)).toMatchObject({ read: true, write: true, control: true });
    expect(delegated.get(acl)).toBeUndefined();
  });

  it("composes memory configs from installed CSS with account APIs and matching authorization/auxiliaries", async () => {
    for (const [file, authorization, auxiliary] of [
      ["file.json", "webacl", "acl"],
      ["file-acp.json", "acp", "acr"],
    ]) {
      const shipped = JSON.parse(
        await readFile(join(cssDirectory, "config", file as string), "utf8"),
      );
      const config = memoryConfig(shipped);
      for (const path of [
        `ldp/authorization/${authorization}.json`,
        `util/auxiliary/${auxiliary}.json`,
        "storage/backend/memory.json",
        "util/resource-locker/memory.json",
        "storage/location/pod.json",
        "identity/handler/default.json",
        "identity/access/public.json",
        "identity/pod/static.json",
      ])
        expect(config.import).toContain(`css:config/${path}`);
      for (const entry of config.import)
        expect(await readFile(join(cssDirectory, entry.replace("css:", "")), "utf8")).toBeTruthy();
      expect(config.import).not.toContain("css:config/storage/backend/file.json");
    }
  });

  it("seeds WAC through typed accessors with separate resource/default scope and origin/group conditions", async () => {
    const root = `${base}pod/`;
    const text = await fixtureAccess("wac", root, `${root}.acl`, [
      ownerRule("urn:owner", true),
      { group: "urn:group", allow: ["read"] },
      { agent: "urn:stranger", origin: "https://app.test", allow: ["read", "append"] },
    ]);
    const graph = await parseRdf(text, "text/turtle", { baseIRI: root });
    const acl = new AclResource(graph, DataFactory);
    const rules = [...acl.authorizations];
    expect(rules).toHaveLength(3);
    expect(text).toContain("http://www.w3.org/ns/auth/acl#default");
    expect(text).toContain("urn:group");
    expect(text).toContain("https://app.test");
  });

  it("CSS's own ACP reader evaluates seeded deny/client/exclusion/member controls", async () => {
    const root = `${base}pod/`;
    const acl = `${root}.acr`;
    const text = await fixtureAccess("acp", root, acl, [
      ownerRule("urn:owner", true),
      { public: true, allow: ["read", "append"] },
      { agent: "urn:stranger", deny: ["read"] },
      { agent: "urn:stranger", client: "urn:client", allow: ["write"] },
      { authenticated: true, exceptAgent: "urn:stranger", allow: ["control"] },
    ]);
    const graph = await parseRdf(text, "text/turtle", { baseIRI: root });
    const typed = new AccessControlResource(acl, graph, DataFactory);
    expect([...typed.memberAccessControl]).toHaveLength(1);
    const requireCss = createRequire(join(cssDirectory, "package.json"));
    const { getAccessControlledResources } = requireCss("./dist/authorization/AcpUtil.js");
    const { allowAccessModes } = requireCss("@solid/access-control-policy");
    const resources = [...getAccessControlledResources(graph)];
    const policies = resources
      .filter((entry) => entry.iri === root)
      .flatMap((entry) =>
        entry.accessControlResource.accessControl.flatMap(
          (control: { policy: unknown[] }) => control.policy,
        ),
      );
    const read = "http://www.w3.org/ns/auth/acl#Read";
    const write = "http://www.w3.org/ns/auth/acl#Write";
    expect(
      allowAccessModes(policies, { target: root, agent: "urn:stranger", client: "urn:client" }).has(
        write,
      ),
    ).toBe(true);
    expect(
      allowAccessModes(policies, { target: root, agent: "urn:stranger", client: "urn:other" }).has(
        write,
      ),
    ).toBe(false);
    expect(allowAccessModes(policies, { target: root, agent: "urn:stranger" }).has(read)).toBe(
      false,
    );
    expect(allowAccessModes(policies, { target: root }).has(read)).toBe(true);
    expect(allowAccessModes(policies, { target: root, agent: "urn:owner" }).has(write)).toBe(true);
  });
});
