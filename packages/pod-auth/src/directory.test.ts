// AUTHORED-BY Codex GPT-6.1-Sol
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { expect, test, vi } from "vitest";
import {
  classifyLoginInput,
  createRecentProvidersStore,
  InvalidLoginAddressError,
  KNOWN_PROVIDERS,
  NotALoginAddressError,
  providersFromConfig,
  resolveLoginTarget,
} from "./directory.js";
import { abortable } from "./documents.js";

const issuer = "https://op.example/";
const webId = "https://id.example/alice#me";
const discovery = issuer + ".well-known/openid-configuration";
function metadata(value: unknown = { issuer, authorization_endpoint: issuer + "authorize" }) {
  return Response.json(value);
}
function profile(subject = webId, issuers = [issuer]) {
  const dataset = new Store();
  const agent = new TermWrapper(subject, dataset, DataFactory);
  const values = SetFrom.subjectPredicate(
    agent,
    "http://www.w3.org/ns/solid/terms#oidcIssuer",
    TermAs.term,
    TermFrom.itself,
  );
  for (const value of issuers) values.add(DataFactory.namedNode(value));
  return new Response(new Writer().quadsToString([...dataset]), {
    headers: { "content-type": "text/turtle" },
  });
}
function transport(handler: (request: Request) => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async (input, init) => handler(new Request(input, init)));
}
function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(() => {
      value = null;
    }),
  };
}

test("the default directory is ordered, deeply frozen and has no remote icons", () => {
  expect(KNOWN_PROVIDERS.map((provider) => provider.id)).toEqual([
    "solidcommunity",
    "inrupt",
    "solidweb",
    "teamid",
  ]);
  expect(KNOWN_PROVIDERS.map((provider) => provider.name)).toEqual([
    "solidcommunity.net",
    "Inrupt PodSpaces",
    "solidweb.org",
    "teamid.live",
  ]);
  expect(KNOWN_PROVIDERS[0]?.signUpUrl).toBe(
    "https://solidcommunity.net/.account/login/password/register/",
  );
  expect(KNOWN_PROVIDERS[1]?.signUpUrl).toBe("https://start.inrupt.com/");
  expect(Object.isFrozen(KNOWN_PROVIDERS)).toBe(true);
  for (const provider of KNOWN_PROVIDERS) {
    expect(Object.isFrozen(provider)).toBe(true);
    expect(provider.iconUrl).toBeUndefined();
  }
});

test.each([
  undefined,
  "",
  " , ",
  "not a URL,http://localhost,ftp://example.com/",
])("empty or unusable provider config %s returns fresh fallback copies", (raw) => {
  const actual = providersFromConfig(raw);
  expect(actual).toEqual(KNOWN_PROVIDERS);
  actual[0]!.name = "changed";
  expect(KNOWN_PROVIDERS[0]?.name).toBe("solidcommunity.net");
  const fallback = [{ id: "custom", name: "Custom", issuer, label: "Continue", iconUrl: "/icon" }];
  const custom = providersFromConfig(raw, fallback);
  expect(custom).toEqual(fallback);
  custom[0]!.name = "different";
  expect(fallback[0]?.name).toBe("Custom");
  expect(providersFromConfig(raw, [])).toEqual([]);
});

test("config recognizes providers, rejects unsafe URLs, dedupes and keeps distinct issuer paths", () => {
  const actual = providersFromConfig(
    " https://solidcommunity.net, https://solidcommunity.net/,http://remote.example, " +
      "https://user:secret@op.example,https://login.inrupt.com/,https://custom.example:8443/id," +
      "https://custom.example:8443/id/,https://custom.example:8443/id",
  );
  expect(actual).toEqual([
    KNOWN_PROVIDERS[0],
    KNOWN_PROVIDERS[1],
    {
      id: "custom.example:8443",
      name: "custom.example:8443",
      issuer: "https://custom.example:8443/id",
    },
    {
      id: "custom.example:8443",
      name: "custom.example:8443",
      issuer: "https://custom.example:8443/id/",
    },
  ]);
  actual[0]!.description = "mutated";
  expect(KNOWN_PROVIDERS[0]?.description).toBe("Free, run by the Solid community");
});

test.each([
  [" https://op.example ", "issuer"],
  [issuer, "issuer"],
  [webId, "webid"],
  ["https://op.example/?view=profile", "webid"],
  ["https://op.example/?", "webid"],
  ["https://op.example/#", "webid"],
  ["https://op.example/tenant", "webid"],
  ["not a URL", "invalid"],
  ["/relative", "invalid"],
  ["", "invalid"],
  ["http://op.example", "invalid"],
  ["http://localhost", "invalid"],
  ["https://user:secret@op.example", "invalid"],
  ["https://user@op.example", "invalid"],
  ["https://:secret@op.example", "invalid"],
  ["javascript:alert(1)", "invalid"],
  ["data:text/plain,hello", "invalid"],
])("classification of %s is %s without fetching", (input, kind) => {
  expect(classifyLoginInput(input)).toBe(kind);
});

test.each([
  "localhost",
  "127.0.0.1",
  "127.2.3.4",
  "[::1]",
])("loopback HTTP %s requires the explicit option", async (host) => {
  const local = `http://${host}:4040/`;
  expect(classifyLoginInput(local, { allowInsecureLoopback: true })).toBe("issuer");
  expect(classifyLoginInput(local + "id#me", { allowInsecureLoopback: true })).toBe("webid");
  const fetch = transport(() =>
    metadata({ issuer: local, authorization_endpoint: local + "auth" }),
  );
  expect(await resolveLoginTarget(local, { fetch, allowInsecureLoopback: true })).toEqual({
    kind: "issuer",
    issuer: local,
  });
  expect(classifyLoginInput("http://remote.example", { allowInsecureLoopback: true })).toBe(
    "invalid",
  );
});

test("invalid inputs reject with the exported TypeError before network activity", async () => {
  const fetch = transport(() => metadata());
  for (const input of ["relative", "https://user:secret@op.example", "http://localhost/"]) {
    await expect(resolveLoginTarget(input, { fetch })).rejects.toMatchObject({
      name: "InvalidLoginAddressError",
      input,
    });
    await expect(resolveLoginTarget(input, { fetch })).rejects.toBeInstanceOf(TypeError);
  }
  expect(new InvalidLoginAddressError("invalid")).toBeInstanceOf(TypeError);
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  issuer,
  "https://op.example",
])("bare origin %s probes discovery first and accepts the equivalent origin issuer", async (input) => {
  const fetch = transport((request) => {
    expect(request.url).toBe(discovery);
    expect(request.headers.get("accept")).toBe("application/json");
    expect(request.credentials).toBe("omit");
    expect(request.redirect).toBe("error");
    expect(request.headers.has("authorization")).toBe(false);
    return metadata({ issuer: "https://op.example", authorization_endpoint: issuer + "auth" });
  });
  expect(await resolveLoginTarget(` ${input} `, { fetch })).toEqual({
    kind: "issuer",
    issuer: "https://op.example",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("bare origin falls back to a WebID and scopes RDF statements to its exact subject", async () => {
  const fetch = transport((request) =>
    request.url === discovery ? new Response(null, { status: 404 }) : profile(issuer),
  );
  expect(await resolveLoginTarget(issuer, { fetch })).toEqual({ kind: "webid", webId: issuer });
  expect(fetch).toHaveBeenCalledTimes(2);
  const unrelated = transport(() => profile("https://someone-else.example/#me"));
  await expect(resolveLoginTarget(webId, { fetch: unrelated })).rejects.toBeInstanceOf(
    NotALoginAddressError,
  );
});

test.each([
  webId,
  "https://id.example/alice?view=profile#me",
  "https://id.example/?view=1",
])("profile-shaped %s probes RDF first, retaining its query and subject", async (input) => {
  const fetch = transport((request) => {
    expect(request.headers.get("accept")).toContain("text/turtle");
    expect(request.url).toBe(input.split("#")[0]);
    expect(request.credentials).toBe("omit");
    expect(request.headers.has("dpop")).toBe(false);
    return profile(input, ["https://other.example/", issuer]);
  });
  expect(await resolveLoginTarget(` ${input} `, { fetch })).toEqual({
    kind: "webid",
    webId: input,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
  "https://op.example/tenant",
  "https://op.example/tenant/",
  "https://op.example/?view=1",
])("profile-shaped provider %s falls back to discovery with a correctly placed path", async (input) => {
  const expected = new URL(input);
  expected.pathname = expected.pathname.replace(/\/+$/, "") + "/.well-known/openid-configuration";
  const fetch = transport((request) =>
    request.url === expected.href
      ? metadata({ issuer: input, authorization_endpoint: issuer + "auth" })
      : new Response("not RDF", { headers: { "content-type": "text/plain" } }),
  );
  expect(await resolveLoginTarget(input, { fetch })).toEqual({ kind: "issuer", issuer: input });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each([
  null,
  [],
  {},
  { issuer },
  { issuer: 1, authorization_endpoint: "auth" },
  { issuer, authorization_endpoint: 1 },
  { issuer: "https://attacker.example/", authorization_endpoint: "auth" },
])("bad or mismatched discovery %j is rejected without following its issuer", async (value) => {
  const fetch = transport((request) =>
    request.url === discovery ? metadata(value) : new Response(null, { status: 404 }),
  );
  await expect(resolveLoginTarget(issuer, { fetch })).rejects.toMatchObject({
    name: "NotALoginAddressError",
    input: issuer,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(([request]) => new Request(request).url.startsWith(issuer))).toBe(
    true,
  );
});

test("issuer paths are compared exactly, including their trailing slash", async () => {
  const fetch = transport((request) =>
    request.url.includes(".well-known")
      ? metadata({ issuer: issuer + "tenant/", authorization_endpoint: issuer + "auth" })
      : new Response(null, { status: 404 }),
  );
  await expect(resolveLoginTarget(issuer + "tenant", { fetch })).rejects.toBeInstanceOf(
    NotALoginAddressError,
  );
});

test.each([
  "network",
  "parse",
  "empty",
  "literal",
  "primitive",
  "throw-string",
])("%s probe failures try both kinds and return a useful error", async (failure) => {
  const fetch = transport(() => {
    if (failure === "network") throw new Error("offline");
    if (failure === "throw-string") throw "offline";
    if (failure === "empty") return new Response(null);
    if (failure === "primitive") return Response.json(42);
    if (failure === "literal") {
      const dataset = new Store();
      const agent = new TermWrapper(webId, dataset, DataFactory);
      SetFrom.subjectPredicate(
        agent,
        "http://www.w3.org/ns/solid/terms#oidcIssuer",
        TermAs.term,
        TermFrom.itself,
      ).add(DataFactory.literal("invalid"));
      return new Response(new Writer().quadsToString([...dataset]));
    }
    return new Response("<html>no profile here</html>");
  });
  await expect(resolveLoginTarget(webId, { fetch })).rejects.toBeInstanceOf(NotALoginAddressError);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("RDF redirects remain public, preserve the original subject, and reject insecure hops", async () => {
  const fetch = transport((request) => {
    if (request.url === "https://id.example/alice")
      return new Response(null, {
        status: 302,
        headers: { location: "https://profile.example/card" },
      });
    expect(request.url).toBe("https://profile.example/card");
    return profile();
  });
  expect(await resolveLoginTarget(webId, { fetch })).toEqual({ kind: "webid", webId });
  expect(fetch).toHaveBeenCalledTimes(2);
  const downgrade = transport((request) =>
    request.url.includes(".well-known")
      ? new Response(null, { status: 404 })
      : new Response(null, { status: 302, headers: { location: "http://remote.example/card" } }),
  );
  await expect(resolveLoginTarget(webId, { fetch: downgrade })).rejects.toBeInstanceOf(
    NotALoginAddressError,
  );
  expect(
    downgrade.mock.calls.some(([request]) => new Request(request).url.startsWith("http:")),
  ).toBe(false);
});

test("a transport's final response URL is scheme checked", async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const fetch = transport(() => {
    const response = new Response(new ReadableStream({ cancel }));
    Object.defineProperty(response, "url", { value: "http://remote.example/metadata" });
    return response;
  });
  await expect(resolveLoginTarget(issuer, { fetch })).rejects.toBeInstanceOf(NotALoginAddressError);
  expect(cancel).toHaveBeenCalledTimes(2);
});

test.each([
  "json",
  "rdf",
  "declared",
  "non-json",
])("%s bodies above 1 MiB are cancelled before parsing", async (kind) => {
  const cancel = vi.fn();
  const fetch = transport((request) => {
    const target =
      kind === "rdf" ? !request.url.includes(".well-known") : request.url === discovery;
    if (!target) return new Response(null, { status: 404 });
    return new Response(
      new ReadableStream({
        start(controller) {
          if (kind !== "declared") controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel,
      }),
      {
        headers:
          kind === "declared"
            ? { "content-length": "1048577" }
            : kind === "non-json"
              ? { "content-type": "text/html" }
              : {},
      },
    );
  });
  await expect(
    resolveLoginTarget(kind === "rdf" ? webId : issuer, { fetch }),
  ).rejects.toBeInstanceOf(NotALoginAddressError);
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each([
  ["issuer", "large"],
  ["webid", "large"],
  ["issuer", "stalled"],
  ["webid", "stalled"],
])("%s probes cancel unread %s 404 bodies without waiting for cancellation", async (kind, bodyKind) => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (bodyKind === "large") controller.enqueue(new Uint8Array(2 * 1024 * 1024));
    },
    cancel,
  });
  const getReader = vi.spyOn(body, "getReader");
  const fetch = transport((request) => {
    const target =
      kind === "issuer" ? request.url === discovery : !request.url.includes(".well-known");
    return new Response(target ? body : null, { status: 404 });
  });
  await expect(
    resolveLoginTarget(kind === "issuer" ? issuer : webId, { fetch }),
  ).rejects.toBeInstanceOf(NotALoginAddressError);
  expect(getReader).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("a rejected discarded-body cancellation does not prevent the fallback probe", async () => {
  const cancel = vi.fn(async () => {
    throw new Error("cancellation failed");
  });
  const fetch = transport((request) =>
    request.url === discovery
      ? new Response(new ReadableStream({ cancel }), { status: 503 })
      : profile(issuer),
  );
  expect(await resolveLoginTarget(issuer, { fetch })).toEqual({ kind: "webid", webId: issuer });
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("RDF redirects discard their body without waiting for stalled cancellation", async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const fetch = transport((request) =>
    request.url === "https://id.example/alice"
      ? new Response(new ReadableStream({ cancel }), {
          status: 302,
          headers: { location: "https://profile.example/card" },
        })
      : profile(),
  );
  expect(await resolveLoginTarget(webId, { fetch })).toEqual({ kind: "webid", webId });
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("the body limit counts bytes and accepts exactly 1 MiB across multiple chunks", async () => {
  const json = JSON.stringify({ issuer, authorization_endpoint: issuer + "auth" });
  const bytes = new TextEncoder().encode(json.padEnd(1024 * 1024, " "));
  const fetch = transport(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 123));
            controller.enqueue(bytes.slice(123));
            controller.close();
          },
        }),
      ),
  );
  expect(await resolveLoginTarget(issuer, { fetch })).toEqual({ kind: "issuer", issuer });
});

test("already-aborted resolution does not call either probe", async () => {
  const fetch = transport(() => metadata());
  const controller = new AbortController();
  controller.abort();
  await expect(
    resolveLoginTarget(issuer, { fetch, signal: controller.signal }),
  ).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  "network",
  "json-body",
  "rdf-body",
])("abort interrupts a stalled %s even when the transport ignores its signal", async (kind) => {
  const controller = new AbortController();
  const ready = Promise.withResolvers<void>();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const fetch = transport(async () => {
    if (kind === "network") {
      ready.resolve();
      return await new Promise<Response>(() => {});
    }
    const body = new ReadableStream<Uint8Array>({ cancel });
    const getReader = body.getReader.bind(body);
    vi.spyOn(body, "getReader").mockImplementation(() => {
      const reader = getReader();
      const read = reader.read.bind(reader);
      vi.spyOn(reader, "read").mockImplementation(() => {
        const pending = read();
        ready.resolve();
        return pending;
      });
      return reader;
    });
    return new Response(body);
  });
  const pending = resolveLoginTarget(kind === "rdf-body" ? webId : issuer, {
    fetch,
    signal: controller.signal,
  });
  await ready.promise;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledOnce();
  if (kind === "network") expect(cancel).not.toHaveBeenCalled();
  else expect(cancel).toHaveBeenCalledOnce();
});

test("a response arriving after abort is cancelled without being read", async () => {
  const controller = new AbortController();
  const ready = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Response>();
  const cancelled = Promise.withResolvers<void>();
  const cancel = vi.fn(() => {
    cancelled.resolve();
    return new Promise<void>(() => {});
  });
  const body = new ReadableStream<Uint8Array>({ cancel });
  const getReader = vi.spyOn(body, "getReader");
  const fetch = transport(() => {
    ready.resolve();
    return response.promise;
  });
  const pending = resolveLoginTarget(issuer, { fetch, signal: controller.signal });
  await ready.promise;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  response.resolve(new Response(body));
  await cancelled.promise;
  expect(getReader).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
});

test("transport AbortErrors propagate even without a supplied signal", async () => {
  const fetch = transport(() => {
    throw new DOMException("Cancelled", "AbortError");
  });
  await expect(resolveLoginTarget(issuer, { fetch })).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledOnce();
});

test("a custom abort reason is preserved and abort listeners are removed", async () => {
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const ready = Promise.withResolvers<void>();
  const pending = abortable(controller.signal, async () => {
    ready.resolve();
    return await new Promise<void>(() => {});
  });
  await ready.promise;
  const reason = new Error("cancelled by caller");
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(remove.mock.calls[0]?.slice(0, 2)).toEqual(add.mock.calls[0]?.slice(0, 2));
  expect(await abortable(undefined, async () => 42)).toBe(42);
});

test("recent providers store dedupes, orders most recent first, caps at five, and clears", () => {
  const raw = storage();
  const recent = createRecentProvidersStore(raw);
  expect(recent.list()).toEqual([]);
  for (let index = 0; index < 7; index++) recent.remember(`https://provider${index}.example`);
  recent.remember("https://provider3.example/");
  expect(recent.list()).toEqual([
    "https://provider3.example/",
    "https://provider6.example/",
    "https://provider5.example/",
    "https://provider4.example/",
    "https://provider2.example/",
  ]);
  expect(raw.setItem.mock.calls[0]?.[0]).toBe("pod-auth.recentProviders.v1");
  recent.clear();
  expect(recent.list()).toEqual([]);
  expect(raw.removeItem).toHaveBeenCalledWith("pod-auth.recentProviders.v1");
});

test("recent reads filter unsafe and non-string entries and keep issuer paths distinct", () => {
  const raw = storage(
    JSON.stringify([
      "https://op.example",
      issuer,
      "not a URL",
      "http://localhost/",
      "http://remote.example/",
      "https://user:secret@op.example",
      null,
      1,
      {},
      issuer + "tenant",
      issuer + "tenant/",
    ]),
  );
  const recent = createRecentProvidersStore(raw, "custom-key");
  expect(recent.list()).toEqual([issuer, issuer + "tenant", issuer + "tenant/"]);
  for (const value of ["invalid", "http://localhost", "https://user:secret@op.example"])
    recent.remember(value);
  expect(raw.setItem).not.toHaveBeenCalled();
  recent.remember(issuer);
  expect(raw.setItem.mock.calls[0]?.[0]).toBe("custom-key");
  recent.clear();
  expect(raw.removeItem).toHaveBeenCalledWith("custom-key");
});

test.each(["broken JSON", "{}", "null", '"string"'])("recent store tolerates %s", (initial) => {
  expect(createRecentProvidersStore(storage(initial)).list()).toEqual([]);
});

test("absent and throwing storage never prevents sign-in", () => {
  const absent = createRecentProvidersStore(undefined);
  expect(absent.list()).toEqual([]);
  absent.remember(issuer);
  absent.clear();
  const unavailable = () => {
    throw new Error("storage unavailable");
  };
  const recent = createRecentProvidersStore({
    getItem: unavailable,
    setItem: unavailable,
    removeItem: unavailable,
  });
  expect(recent.list()).toEqual([]);
  expect(() => recent.remember(issuer)).not.toThrow();
  expect(() => recent.clear()).not.toThrow();
});

test("a rejected stream cancellation does not mask an oversized-body failure", async () => {
  const cancel = vi.fn(async () => {
    throw new Error("cancellation failed");
  });
  const fetch = transport((request) =>
    request.url === discovery
      ? new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024 + 1));
            },
            cancel,
          }),
        )
      : new Response(null, { status: 404 }),
  );
  await expect(resolveLoginTarget(issuer, { fetch })).rejects.toBeInstanceOf(NotALoginAddressError);
  expect(cancel).toHaveBeenCalledOnce();
});
