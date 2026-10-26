// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import * as fsPromises from "node:fs/promises";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stderr as nodeStderr, stdout as nodeStdout } from "node:process";
import * as dpop from "@jeswr/solid-dpop";
import { AclResource, Agent } from "@solid/object";
import { DataFactory } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as importRunner from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  fixtureFetch,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { ConnectorState } from "../core/types.js";
import { writeResource } from "../pod/resource.js";
import { ProfileTypeIndexAnchor, TypeIndexDataset } from "../pod/type-index.js";
import * as registryModule from "../registry.js";
import { spotifyAdapter } from "../spotify/adapter.js";
import { parseImportArgs, runCli } from "./cli.js";
import type { NodeConfig } from "./config.js";
import { createClientCredentialsFetch } from "./pod-auth.js";
import { connectorState, createStateStore } from "./state.js";

const config: NodeConfig = {
  podRoot: TEST_POD_ROOT,
  webId: TEST_WEBID,
  profileDocumentUrl: TEST_PROFILE_DOC,
  oidcIssuer: "https://issuer.test/",
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret",
  connectors: {},
};
const state: ConnectorState = {
  connectedAt: "2026-10-25T00:00:00.000Z",
  lastSync: "2026-10-25T01:00:00.000Z",
  cursor: "synthetic-cursor",
  lastOutcome: "success",
  counts: { documents: 1, items: 2, skipped: 0 },
};
const tokenUrl = "https://issuer.test/token";
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
}));
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function configPath() {
  const dir = await mkdtemp(join(tmpdir(), "con03-cli-"));
  dirs.push(dir);
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  return path;
}
function fixturePod() {
  const pod = createMemoryPod();
  const requests: { url: string; method: string; headers: Headers; body: unknown }[] = [];
  const raw: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    requests.push({ url, method, headers: new Headers(init?.headers), body: init?.body });
    if (method === "HEAD" && url.endsWith("/state.json"))
      return new Response(null, {
        status: pod.get(url) ? 200 : 404,
        headers: { link: `<${url}.acl>; rel="acl"` },
      });
    return pod.fetch(input, {
      ...init,
      body: init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : init?.body,
    });
  };
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    expect(init?.redirect).toBe("manual");
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({ issuer: config.oidcIssuer, token_endpoint: tokenUrl });
    if (url === tokenUrl) {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(
        `Basic ${Buffer.from("synthetic-client:synthetic-secret").toString("base64")}`,
      );
      expect(new URLSearchParams(String(init?.body)).get("grant_type")).toBe("client_credentials");
      expect(
        JSON.parse(
          Buffer.from(
            (headers.get("dpop") as string).split(".")[1] as string,
            "base64url",
          ).toString(),
        ).ath,
      ).toBeUndefined();
      return Response.json({
        access_token: "synthetic-pod-token",
        token_type: "DPoP",
        expires_in: 300,
      });
    }
    expect(new Headers(init?.headers).get("authorization")).toBe("DPoP synthetic-pod-token");
    return raw(input, init);
  };
  return { pod, raw, transport, requests };
}
function store(fetch: typeof globalThis.fetch, id = "spotify") {
  return createStateStore({ ...config, adapterId: id, fetch });
}

describe("owner-only checkpoint", () => {
  it("finds an ACL relation after other parameters and ignores unrelated or absent rels", async () => {
    const { raw } = fixturePod();
    const checkpoint = store(async (input, init) =>
      init?.method === "HEAD"
        ? new Response(null, {
            status: 404,
            headers: {
              link: `<other>; type="text/turtle", <type>; rel="describedby", <state.json.acl>; type="text/turtle"; rel=acl`,
            },
          })
        : raw(input, init),
    );
    expect(await checkpoint.read()).toBeUndefined();
    await checkpoint.write(state);
  });
  it("installs an owner ACL first, projects JSON fields, and conditionally creates/updates state", async () => {
    const { pod, raw, requests } = fixturePod();
    const checkpoint = store(raw);
    await expect(checkpoint.write(state)).rejects.toMatchObject({ kind: "import" });
    expect(await checkpoint.read()).toBeUndefined();
    await checkpoint.write({
      ...state,
      accessToken: "must-not-save",
      error: "must-not-save",
    } as ConnectorState);
    expect(requests.map((r) => r.method)).toEqual(["HEAD", "PUT", "GET", "PUT"]);
    expect(requests.at(-1)?.headers.get("if-none-match")).toBe("*");
    expect(pod.get(checkpoint.url)).not.toContain("must-not-save");
    const rules = [
      ...new AclResource(pod.dataset(`${checkpoint.url}.acl`), DataFactory).authorizations,
    ];
    expect(rules).toHaveLength(1);
    expect([...rules[0]!.agent]).toEqual([TEST_WEBID]);
    expect([...rules[0]!.agentClass]).toEqual([]);
    expect(rules[0]!.default).toBeUndefined();
    expect(rules[0]!.accessTo).toBe(checkpoint.url);
    expect(rules[0]!.canRead && rules[0]!.canWrite && rules[0]!.canReadWriteAcl).toBe(true);
    expect(await checkpoint.read()).toEqual(state);
    await checkpoint.write({ ...state, lastOutcome: "error" });
    expect(requests.at(-1)?.headers.get("if-match")).toBe('"v1"');
    await expect(checkpoint.write(state)).rejects.toMatchObject({ kind: "import" });
  });
  it("rejects concurrent create/update rather than advancing a stale checkpoint", async () => {
    const { raw } = fixturePod();
    const first = store(raw),
      second = store(raw);
    await first.read();
    await second.read();
    await first.write(state);
    await expect(second.write(state)).rejects.toMatchObject({ kind: "import" });
    await first.read();
    await second.read();
    await first.write({ ...state, cursor: "new" });
    await expect(second.write(state)).rejects.toMatchObject({ kind: "import" });
  });
  it.each([
    "missing-link",
    "foreign-link",
    "root-link",
    "self-link",
    "fragment-link",
    "query-link",
    "duplicate-link",
    "head-error",
    "acl-denied",
    "get-error",
    "no-etag",
    "bad-json",
    "bad-state",
    "large-state",
  ])("fails closed for %s", async (kind) => {
    const { raw, pod } = fixturePod();
    const checkpoint = store(async (input, init) => {
      if (init?.method === "HEAD") {
        if (kind === "head-error") return new Response(null, { status: 403 });
        const target =
          kind === "foreign-link"
            ? "https://other.test/state.acl"
            : kind === "root-link"
              ? TEST_POD_ROOT
              : kind === "self-link"
                ? checkpoint.url
                : kind === "fragment-link"
                  ? `${checkpoint.url}.acl#bad`
                  : kind === "query-link"
                    ? `${checkpoint.url}.acl?bad`
                    : `${checkpoint.url}.acl`;
        return new Response(null, {
          status: 404,
          headers:
            kind === "missing-link"
              ? {}
              : {
                  link: `<${target}>; rel="acl"${kind === "duplicate-link" ? `, <${target}>; rel="acl"` : ""}`,
                },
        });
      }
      if (init?.method === "PUT" && kind === "acl-denied")
        return new Response(null, { status: 403 });
      if (!init?.method) {
        if (kind === "get-error") return new Response(null, { status: 500 });
        return new Response(
          kind === "bad-json"
            ? "invalid"
            : kind === "large-state"
              ? " ".repeat(1024 * 1024 + 1)
              : JSON.stringify(kind === "bad-state" ? {} : state),
          { headers: kind === "no-etag" ? {} : { etag: '"v1"' } },
        );
      }
      return raw(input, init);
    });
    await expect(checkpoint.read()).rejects.toMatchObject({ kind: "import" });
    expect(pod.get(checkpoint.url)).toBeUndefined();
  });
  it("refuses escaping IDs and malformed state fields", () => {
    expect(() => store(vi.fn(), "../escape")).toThrow();
    for (const invalid of [
      null,
      { ...state, connectedAt: "invalid" },
      { ...state, cursor: "" },
      { ...state, lastOutcome: "pending" },
      { ...state, counts: { documents: -1, items: 0, skipped: 0 } },
    ])
      expect(() => connectorState(invalid)).toThrow();
  });
});

describe("Pod client credentials", () => {
  it.each([
    "https://second.test/alice/",
    "https://pod.test/second/",
  ])("allows only the validated index across storage roots when importing into %s", async (podRoot) => {
    const { pod, transport, requests } = fixturePod();
    const firstWriter = createFetchPodWriter({ ...config, adapterId: "spotify", fetch: pod.fetch });
    const { indexUrl } = await firstWriter.registerType([]);
    const profile = pod.dataset(TEST_PROFILE_DOC);
    new Agent(TEST_WEBID, profile, DataFactory).storageUrls.add(podRoot);
    await writeResource(TEST_PROFILE_DOC, profile, { fetchImpl: pod.fetch });
    const authenticated = await createClientCredentialsFetch({ ...config, podRoot }, transport);
    await expect(authenticated(indexUrl)).rejects.toThrow();
    const port = createFetchPodWriter({
      ...config,
      podRoot,
      adapterId: "spotify",
      fetch: authenticated,
    });
    const container = port.resolve("media/");
    expect(
      await port.registerType([{ forClass: "https://schema.org/MusicRecording", container }]),
    ).toMatchObject({ indexUrl, added: 1 });
    expect(
      new TypeIndexDataset(pod.dataset(indexUrl), DataFactory).locate(
        "https://schema.org/MusicRecording",
      ),
    ).toEqual([{ forClass: "https://schema.org/MusicRecording", instance: undefined, container }]);
    const indexRequests = requests.filter((request) => request.url === indexUrl);
    expect(indexRequests.map((request) => request.method)).toEqual(["GET", "PUT"]);
    expect(indexRequests[1]?.headers.get("if-match")).toBe('"v1"');
    for (const url of [
      TEST_POD_ROOT,
      `${indexUrl}.acl`,
      `${indexUrl}/child`,
      `${indexUrl}?other`,
      `${TEST_POD_ROOT}private.ttl`,
    ])
      await expect(authenticated(url)).rejects.toThrow();
    const path = await configPath();
    await writeFile(path, JSON.stringify({ ...config, podRoot }));
    expect(
      await runCli(["import", "spotify"], {
        configPath: path,
        podTransport: transport,
        sourceAuth: { fetch: fixtureFetch("spotify", spotifyAdapter.fixtures()) },
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(0);
    expect(pod.get(`${podRoot}integrations/spotify/state.json`)).toContain(
      '"lastOutcome":"success"',
    );
    const count = requests.length;
    const anchor = new ProfileTypeIndexAnchor(TEST_WEBID, profile, DataFactory);
    anchor.privateIndex = `${TEST_POD_ROOT}settings/replacement.ttl`;
    await writeResource(TEST_PROFILE_DOC, profile, { fetchImpl: pod.fetch });
    await authenticated(TEST_PROFILE_DOC);
    await expect(authenticated(indexUrl)).rejects.toThrow();
    expect(requests).toHaveLength(count + 1);
  });
  it.each([
    "https://outside.test/index.ttl",
    "https://pod.test/alice-sibling/index.ttl",
  ])("never grants a profile-linked index outside advertised storage: %s", async (indexUrl) => {
    const { pod, transport, requests } = fixturePod();
    const profile = pod.dataset(TEST_PROFILE_DOC);
    new ProfileTypeIndexAnchor(TEST_WEBID, profile, DataFactory).privateIndex = indexUrl;
    await writeResource(TEST_PROFILE_DOC, profile, { fetchImpl: pod.fetch });
    const authenticated = await createClientCredentialsFetch(config, transport);
    await expect(authenticated(TEST_PROFILE_DOC)).rejects.toThrow();
    await expect(authenticated(indexUrl)).rejects.toThrow();
    expect(requests.map((request) => request.url)).toEqual([TEST_PROFILE_DOC]);
  });
  it("refuses redirects from a validated cross-storage index", async () => {
    const { pod, transport } = fixturePod();
    const podRoot = "https://second.test/alice/";
    const indexUrl = `${TEST_POD_ROOT}settings/index.ttl`;
    const profile = pod.dataset(TEST_PROFILE_DOC);
    new Agent(TEST_WEBID, profile, DataFactory).storageUrls.add(podRoot);
    new ProfileTypeIndexAnchor(TEST_WEBID, profile, DataFactory).privateIndex = indexUrl;
    await writeResource(TEST_PROFILE_DOC, profile, { fetchImpl: pod.fetch });
    const redirected = vi.fn<typeof fetch>(async (input, init) =>
      String(input) === indexUrl
        ? new Response(null, { status: 302, headers: { location: `${indexUrl}.other` } })
        : transport(input, init),
    );
    const authenticated = await createClientCredentialsFetch({ ...config, podRoot }, redirected);
    const port = createFetchPodWriter({
      ...config,
      podRoot,
      adapterId: "spotify",
      fetch: authenticated,
    });
    await expect(port.registerType([])).rejects.toThrow();
    expect(redirected.mock.calls.filter(([input]) => String(input) === indexUrl)).toHaveLength(1);
    expect(redirected.mock.calls.some(([input]) => String(input) === `${indexUrl}.other`)).toBe(
      false,
    );
  });
  it("refreshes expired tokens in memory through the guarded authorization transport", async () => {
    const { transport } = fixturePod();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetch = vi.fn(transport);
    const authenticated = await createClientCredentialsFetch(config, fetch);
    now += 301_000;
    expect((await authenticated(TEST_PROFILE_DOC)).ok).toBe(true);
    expect(fetch.mock.calls.filter(([input]) => String(input) === tokenUrl)).toHaveLength(2);
  });
  it("rejects unsafe explicit endpoints and unexpected auth-library destinations", async () => {
    const fetch = vi.fn();
    await expect(
      createClientCredentialsFetch({ ...config, tokenUrl: "http://issuer.test/token" }, fetch),
    ).rejects.toMatchObject({ kind: "auth" });
    vi.spyOn(dpop, "createSession").mockImplementation(async (_credentials, transport) => {
      await transport!("https://unexpected.test/token");
      throw new Error("unreachable");
    });
    await expect(createClientCredentialsFetch(config, fetch)).rejects.toMatchObject({
      kind: "auth",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("signs fresh ath-bound DPoP proofs, handles AS/resource nonces and keeps credentials in scope", async () => {
    const { raw } = fixturePod();
    const proofs: Record<string, unknown>[] = [];
    let tokenRequests = 0,
      resourceRequests = 0;
    const transport: typeof fetch = async (input, init) => {
      const url = String(input);
      expect(init?.redirect).toBe("manual");
      if (url.endsWith("/.well-known/openid-configuration"))
        return Response.json({ issuer: config.oidcIssuer, token_endpoint: tokenUrl });
      const proof = new Headers(init?.headers).get("dpop") as string;
      const [header, payload, signature] = proof.split(".");
      const jwk = JSON.parse(Buffer.from(header!, "base64url").toString()).jwk;
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      expect(
        await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          key,
          Buffer.from(signature!, "base64url"),
          Buffer.from(`${header}.${payload}`),
        ),
      ).toBe(true);
      const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
      proofs.push(claims);
      expect(claims.htm).toBe(init?.method ?? "GET");
      if (url === tokenUrl) {
        tokenRequests++;
        expect(claims.ath).toBeUndefined();
        if (tokenRequests === 1)
          return Response.json(
            { error: "use_dpop_nonce" },
            { status: 400, headers: { "DPoP-Nonce": "as-nonce" } },
          );
        expect(claims.nonce).toBe("as-nonce");
        return Response.json({
          access_token: "synthetic-pod-token",
          token_type: "DPoP",
          expires_in: 300,
        });
      }
      expect(claims.htu).toBe(TEST_PROFILE_DOC);
      expect(claims.ath).toBe(
        createHash("sha256").update("synthetic-pod-token").digest("base64url"),
      );
      resourceRequests++;
      if (resourceRequests === 1)
        return new Response(null, { status: 401, headers: { "DPoP-Nonce": "resource-nonce" } });
      expect(claims.nonce).toBe("resource-nonce");
      return raw(input, init);
    };
    const authenticated = await createClientCredentialsFetch(config, transport);
    expect((await authenticated(TEST_PROFILE_DOC)).status).toBe(200);
    expect(new Set(proofs.map((p) => p.jti)).size).toBe(4);
    await expect(authenticated("https://elsewhere.test/private")).rejects.toThrow();
    await expect(authenticated(`${TEST_POD_ROOT}../other/private`)).rejects.toThrow();
  });
  it.each([
    "issuer-mismatch",
    "discovery-error",
    "http-token",
    "token-redirect",
    "token-error",
    "missing-token",
    "wrong-type",
    "bad-expiry",
  ])("refuses %s with a constant diagnostic", async (kind) => {
    const transport: typeof fetch = vi.fn(async (input) => {
      if (String(input).endsWith("/.well-known/openid-configuration")) {
        if (kind === "discovery-error") return new Response(null, { status: 500 });
        return Response.json({
          issuer: kind === "issuer-mismatch" ? "https://evil.test/" : config.oidcIssuer,
          token_endpoint: kind === "http-token" ? "http://issuer.test/token" : tokenUrl,
        });
      }
      if (kind === "token-redirect")
        return new Response(null, { status: 302, headers: { location: "https://evil.test/" } });
      if (kind === "token-error") return new Response("synthetic-private-error", { status: 401 });
      return Response.json({
        access_token: kind === "missing-token" ? undefined : "synthetic-token",
        token_type: kind === "wrong-type" ? "Bearer" : "DPoP",
        ...(kind === "bad-expiry" ? { expires_in: -1 } : {}),
      });
    });
    await expect(createClientCredentialsFetch(config, transport)).rejects.toMatchObject({
      kind: "auth",
      message: "Pod client-credentials login failed.",
    });
  });
  it("honors an explicit token URL without discovery and refuses resource redirects", async () => {
    const transport = vi.fn(async (input) =>
      String(input) === tokenUrl
        ? Response.json({ access_token: "synthetic-token", token_type: "DPoP" })
        : new Response(null, { status: 302, headers: { location: "https://evil.test/" } }),
    );
    const authenticated = await createClientCredentialsFetch({ ...config, tokenUrl }, transport);
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(authenticated(TEST_PROFILE_DOC)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("CLI import", () => {
  it.each([
    "deadline",
    "host",
  ])("cancels a pending source exchange on %s and closes the listener", async (kind) => {
    const { transport } = fixturePod();
    const path = await configPath();
    await writeFile(
      path,
      JSON.stringify({ ...config, connectors: { spotify: { clientId: "synthetic-client" } } }),
    );
    const controller = new AbortController();
    let exchangeSignal: AbortSignal | undefined;
    let redirect: URL | undefined;
    let started: (() => void) | undefined;
    const exchanging = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const result = runCli(["import", "spotify"], {
      configPath: path,
      podTransport: transport,
      signal: controller.signal,
      stdout: vi.fn(),
      stderr: vi.fn(),
      sourceTransport: async (_input, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Missing exchange signal");
        exchangeSignal = signal;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          started?.();
        });
      },
      async openAuthorizationUrl(url) {
        const auth = new URL(url);
        const callbackUrl = new URL(auth.searchParams.get("redirect_uri") as string);
        redirect = callbackUrl;
        callbackUrl.searchParams.set("state", auth.searchParams.get("state") as string);
        callbackUrl.searchParams.set("code", "synthetic-code");
        await new Promise<void>((resolve, reject) => {
          get(callbackUrl, (response) => {
            response.resume();
            response.on("end", resolve);
          }).on("error", reject);
        });
      },
    });
    try {
      await Promise.race([
        exchanging,
        result.then(() => {
          throw new Error("CLI exited before token exchange");
        }),
      ]);
      if (!exchangeSignal || !redirect) throw new Error("Source exchange never started");
      expect(exchangeSignal.aborted).toBe(false);
      if (kind === "deadline") await vi.advanceTimersByTimeAsync(120_000);
      else controller.abort();
      expect(exchangeSignal.aborted).toBe(true);
      expect(controller.signal.aborted).toBe(kind === "host");
      expect(await result).toBe(kind === "deadline" ? 3 : 130);
      await expect(
        new Promise((resolve, reject) => {
          get(redirect as URL, (response) => {
            response.resume();
            resolve(response.statusCode);
          }).on("error", reject);
        }),
      ).rejects.toThrow();
    } finally {
      controller.abort();
      await result;
    }
  });
  it("uses pristine default transports and displays the loopback authorization URL", async () => {
    const { transport } = fixturePod();
    const path = await configPath();
    await writeFile(
      path,
      JSON.stringify({
        ...config,
        connectors: { spotify: { clientId: "synthetic-source-client" } },
      }),
    );
    const source = fixtureFetch("spotify", spotifyAdapter.fixtures());
    const controller = new AbortController();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === spotifyAdapter.oauth?.tokenEndpoint)
        return Response.json({ access_token: "synthetic-source-token", token_type: "Bearer" });
      return String(input).startsWith("https://api.spotify.com/")
        ? source(input, init)
        : transport(input, init);
    });
    let opened: Promise<void> | undefined;
    expect(
      await runCli(["import", "spotify"], {
        configPath: path,
        signal: controller.signal,
        stdout: vi.fn(),
        stderr(message) {
          if (!message.startsWith("Open this URL")) return;
          const auth = new URL(message.trim().split("\n")[1] as string);
          const redirect = new URL(auth.searchParams.get("redirect_uri") as string);
          redirect.searchParams.set("state", auth.searchParams.get("state") as string);
          redirect.searchParams.set("code", "synthetic-code");
          opened = new Promise<void>((resolve, reject) => {
            get(redirect, (response) => {
              response.resume();
              response.on("end", resolve);
            }).on("error", reject);
          });
        },
      }),
    ).toBe(0);
    expect(opened).toBeDefined();
    await opened;
  });
  it("uses default output ports and handles unexpected failures without printing them", async () => {
    const output = vi.spyOn(nodeStdout, "write").mockReturnValue(true);
    const errorOutput = vi.spyOn(nodeStderr, "write").mockReturnValue(true);
    expect(await runCli(["--help"])).toBe(0);
    expect(await runCli([])).toBe(2);
    expect(output).toHaveBeenCalled();
    expect(errorOutput).toHaveBeenCalled();
    vi.spyOn(registryModule, "createRegistry").mockImplementation(() => {
      throw new Error("synthetic-private-error");
    });
    expect(await runCli(["import", "spotify"], { configPath: await configPath() })).toBe(1);
    expect(JSON.stringify(errorOutput.mock.calls)).not.toContain("synthetic-private-error");
  });
  it("rejects missing OAuth and missing runner state, including errors before a checkpoint", async () => {
    const actual = registryModule.createRegistry();
    vi.spyOn(registryModule, "createRegistry").mockReturnValue({
      ...actual,
      adapterById: () => ({ ...spotifyAdapter, oauth: undefined }),
    });
    const { transport } = fixturePod();
    const options = {
      configPath: await configPath(),
      podTransport: transport,
      stdout: vi.fn(),
      stderr: vi.fn(),
    };
    expect(await runCli(["import", "spotify"], options)).toBe(3);
    const runner = vi
      .spyOn(importRunner, "runImport")
      .mockRejectedValue(new Error("synthetic-private-error"));
    const sourceAuth = { fetch: fixtureFetch("spotify", spotifyAdapter.fixtures()) };
    expect(await runCli(["import", "spotify"], { ...options, sourceAuth })).toBe(1);
    runner.mockResolvedValue({
      adapterId: "spotify",
      mode: "live",
      written: [],
      categories: [],
      indexUrl: "",
    });
    expect(await runCli(["import", "spotify"], { ...options, sourceAuth })).toBe(1);
  });
  it("rejects an export that grows after the size check", async () => {
    const path = await configPath();
    const actualOpen = fsPromises.open;
    vi.spyOn(fsPromises, "open").mockImplementation(async (file, ...args) => {
      if (file === "growing-export.csv")
        return {
          stat: async () => ({ isFile: () => true, size: 1 }),
          readFile: async () => ({ length: 64 * 1024 * 1024 + 1 }),
          close: async () => {},
        } as unknown as Awaited<ReturnType<typeof actualOpen>>;
      return actualOpen(file, ...args);
    });
    expect(
      await runCli(["import", "netflix", "--file", "growing-export.csv"], {
        configPath: path,
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(2);
  });
  it("imports fixture source data into a memory Pod and writes its state", async () => {
    const { pod, transport } = fixturePod();
    const stdout = vi.fn(),
      stderr = vi.fn();
    const result = await runCli(["import", "spotify"], {
      configPath: await configPath(),
      podTransport: transport,
      sourceAuth: { fetch: fixtureFetch("spotify", spotifyAdapter.fixtures()) },
      stdout,
      stderr,
    });
    expect(result).toBe(0);
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Imported spotify:"));
    const saved = JSON.parse(pod.get(`${TEST_POD_ROOT}integrations/spotify/state.json`)!);
    expect(saved.lastOutcome).toBe("success");
    expect(saved.counts.documents).toBeGreaterThan(0);
    expect(pod.urls().some((url) => url.endsWith("_provenance.ttl"))).toBe(true);
    for (const url of pod.urls()) expect(pod.get(url)).not.toContain("synthetic-pod-token");
  });
  it("resumes only with --since, keeps connectedAt, and retains checkpoints on failure", async () => {
    const { pod, transport } = fixturePod();
    const actual = registryModule.createRegistry();
    const seen: (string | undefined)[] = [];
    const adapter = {
      ...spotifyAdapter,
      async import(ctx: Parameters<typeof spotifyAdapter.import>[0]) {
        seen.push(ctx.cursor);
        return { ...(await spotifyAdapter.import(ctx)), cursor: "synthetic-checkpoint" };
      },
    };
    vi.spyOn(registryModule, "createRegistry").mockReturnValue({
      ...actual,
      adapterById: () => adapter,
    });
    const options = {
      configPath: await configPath(),
      podTransport: transport,
      sourceAuth: { fetch: fixtureFetch("spotify", spotifyAdapter.fixtures()) },
      stdout: vi.fn(),
      stderr: vi.fn(),
    };
    const url = `${TEST_POD_ROOT}integrations/spotify/state.json`;
    expect(await runCli(["import", "spotify"], options)).toBe(0);
    const first = JSON.parse(pod.get(url)!);
    expect(await runCli(["import", "spotify", "--since"], options)).toBe(0);
    expect(await runCli(["import", "spotify"], options)).toBe(0);
    expect(seen).toEqual([undefined, "synthetic-checkpoint", undefined]);
    expect(JSON.parse(pod.get(url)!).connectedAt).toBe(first.connectedAt);
    const last = JSON.parse(pod.get(url)!);
    expect(
      await runCli(["import", "spotify"], {
        ...options,
        sourceAuth: {
          fetch: async () => {
            throw new Error("synthetic-private-error");
          },
        },
      }),
    ).toBe(1);
    expect(JSON.parse(pod.get(url)!)).toEqual({ ...last, lastOutcome: "error" });
    expect(JSON.stringify(options.stderr.mock.calls)).not.toContain("synthetic-private-error");
  });
  it("imports an export file through the same writer without source login", async () => {
    const { pod, transport } = fixturePod();
    const path = await configPath();
    const file = join(path, "..", "viewing.csv");
    await writeFile(file, "Title,Date\nSynthetic Movie,1/2/2021");
    const openAuthorizationUrl = vi.fn();
    expect(
      await runCli(["import", "netflix", "--file", file], {
        configPath: path,
        podTransport: transport,
        openAuthorizationUrl,
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(0);
    expect(openAuthorizationUrl).not.toHaveBeenCalled();
    expect(pod.get(`${TEST_POD_ROOT}integrations/netflix/media/viewing-history.ttl`)).toContain(
      "Synthetic Movie",
    );
  });
  it("composes source loopback login with isolated source and Pod transports", async () => {
    const { transport } = fixturePod();
    const path = await configPath();
    await writeFile(
      path,
      JSON.stringify({
        ...config,
        connectors: { spotify: { clientId: "synthetic-source-client" } },
      }),
    );
    const sourceFixture = fixtureFetch("spotify", spotifyAdapter.fixtures());
    const sourceTransport: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("dpop")).toBeNull();
      if (String(input) === spotifyAdapter.oauth?.tokenEndpoint)
        return Response.json({ access_token: "synthetic-source-token", token_type: "Bearer" });
      expect(headers.get("authorization")).toBe("Bearer synthetic-source-token");
      return sourceFixture(input, init);
    };
    expect(
      await runCli(["import", "spotify"], {
        configPath: path,
        podTransport: transport,
        sourceTransport,
        stdout: vi.fn(),
        stderr: vi.fn(),
        async openAuthorizationUrl(url) {
          const auth = new URL(url);
          const redirect = new URL(auth.searchParams.get("redirect_uri") as string);
          redirect.searchParams.set("state", auth.searchParams.get("state") as string);
          redirect.searchParams.set("code", "synthetic-code");
          await new Promise<void>((resolve, reject) => {
            get(redirect, (response) => {
              response.resume();
              response.on("end", resolve);
            }).on("error", reject);
          });
        },
      }),
    ).toBe(0);
  });
  it("refuses unreadable, non-regular and oversized export files before login", async () => {
    const path = await configPath();
    const file = join(path, "..", "large.csv");
    await writeFile(file, "");
    await truncate(file, 64 * 1024 * 1024 + 1);
    const podTransport = vi.fn();
    for (const filePath of [file, `${file}.missing`, join(path, "..")]) {
      expect(
        await runCli(["import", "netflix", "--file", filePath], {
          configPath: path,
          podTransport,
          stdout: vi.fn(),
          stderr: vi.fn(),
        }),
      ).toBe(2);
    }
    expect(podTransport).not.toHaveBeenCalled();
  });
  it("records a first failed import and returns source-auth errors separately", async () => {
    const { pod, transport } = fixturePod();
    const options = {
      configPath: await configPath(),
      podTransport: transport,
      stdout: vi.fn(),
      stderr: vi.fn(),
    };
    expect(await runCli(["import", "spotify"], options)).toBe(3);
    expect(
      await runCli(["import", "spotify"], {
        ...options,
        sourceAuth: {
          fetch: async () => {
            throw new Error("synthetic-private-error");
          },
        },
      }),
    ).toBe(1);
    const failed = JSON.parse(pod.get(`${TEST_POD_ROOT}integrations/spotify/state.json`) as string);
    expect(failed).toMatchObject({
      lastOutcome: "error",
      counts: { documents: 0, items: 0, skipped: 0 },
    });
    expect(failed.lastSync).toBeUndefined();
  });
  it("returns help/usage/config/auth/cancellation exit codes without exposing errors", async () => {
    const stdout = vi.fn(),
      stderr = vi.fn(),
      podTransport = vi.fn();
    expect(await runCli(["--help"], { stdout, stderr, podTransport })).toBe(0);
    expect(await runCli([], { stdout, stderr, podTransport })).toBe(2);
    expect(
      await runCli(["import", "spotify"], {
        configPath: "/missing/config.json",
        stdout,
        stderr,
        podTransport,
      }),
    ).toBe(2);
    const path = await configPath();
    for (const args of [
      ["import", "unknown"],
      ["import", "netflix"],
      ["import", "spotify", "--file", "missing"],
    ])
      expect(await runCli(args, { configPath: path, stdout, stderr, podTransport })).toBe(2);
    expect(podTransport).not.toHaveBeenCalled();
    expect(
      await runCli(["import", "spotify"], {
        configPath: path,
        stdout,
        stderr,
        podTransport: async () => {
          throw new Error("synthetic-private-error");
        },
      }),
    ).toBe(3);
    const controller = new AbortController();
    controller.abort();
    expect(await runCli(["import", "spotify"], { stdout, stderr, signal: controller.signal })).toBe(
      130,
    );
    expect(JSON.stringify(stderr.mock.calls)).not.toContain("synthetic-private-error");
  });
  it("returns state failure before reporting success", async () => {
    const { transport } = fixturePod();
    const stdout = vi.fn();
    expect(
      await runCli(["import", "spotify"], {
        configPath: await configPath(),
        stdout,
        stderr: vi.fn(),
        sourceAuth: { fetch: fixtureFetch("spotify", spotifyAdapter.fixtures()) },
        podTransport: async (input, init) =>
          init?.method === "PUT" && String(input).endsWith("state.json")
            ? new Response(null, { status: 412 })
            : transport(input, init),
      }),
    ).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      ["other", "spotify"],
      ["import", "../escape"],
      ["import", "spotify", "--file"],
      ["import", "spotify", "--unknown"],
      ["import", "spotify", "--since", "date"],
      ["import", "spotify", "--since", "--since"],
      ["import", "spotify", "--file", "one", "--file", "two"],
      ["import", "spotify", "--file", "one", "--since"],
    ].map((args) => ({ args })),
  )("rejects malformed argv #%#", ({ args }) => {
    expect(() => parseImportArgs(args)).toThrow();
  });
});
