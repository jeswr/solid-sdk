// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, test, vi } from "vitest";
import { clientFetch } from "./clientFetch.js";

afterEach(() => vi.unstubAllGlobals());

test.each([
  undefined,
  null,
  {},
])("recognizes a browser only with window === globalThis and a document (%j)", async (document) => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", document);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null));
  await expect(clientFetch({ fetch })("https://8.8.8.8/profile")).resolves.toHaveProperty(
    "status",
    200,
  );
  expect(fetch).toHaveBeenCalledOnce();
});

test("refuses final responses redirected by a transport that ignored manual mode", async () => {
  for (const finalUrl of [
    "https://1.1.1.1/collect",
    "https://127.0.0.1/collect",
    "https://8.8.8.8/other",
  ]) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      const response = new Response(finalUrl.includes("127.0.0.1") ? null : "body", {
        status: finalUrl.includes("127.0.0.1") ? 204 : 200,
      });
      Object.defineProperty(response, "url", { value: finalUrl });
      return response;
    });
    await expect(clientFetch({ fetch })("https://8.8.8.8/path")).rejects.toThrow("redirect");
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
  }
});

// Retain Pod Manager's complete former rejection matrix at the shared boundary.
test.each([
  "https://localhost/inbox/",
  "https://localhost:3000/inbox/",
  "https://foo.localhost/inbox/",
  "https://printer.local/inbox/",
  "https://127.0.0.1/inbox/",
  "https://127.5.5.5/inbox/",
  "https://10.0.0.1/inbox/",
  "https://10.255.255.255/inbox/",
  "https://172.16.0.1/inbox/",
  "https://172.31.255.255/inbox/",
  "https://192.168.1.1/inbox/",
  "https://169.254.0.1/inbox/",
  "https://169.254.169.254/latest/meta-data/", // cloud metadata
  "https://0.0.0.0/inbox/",
  "https://[::1]/inbox/",
  "https://[::]/inbox/",
  "https://[fc00::1]/inbox/", // unique-local
  "https://[fd12:3456::1]/inbox/", // fd.. is within fc00::/7
  "https://[fe80::1]/inbox/", // link-local
  "https://[::ffff:127.0.0.1]/inbox/", // IPv4-mapped loopback
  "https://[::ffff:192.168.0.1]/inbox/", // IPv4-mapped private
  // Trailing-dot (FQDN) blocklist-bypass variants — must still be blocked.
  "https://localhost./inbox/",
  "https://localhost.:3000/inbox/",
  "https://printer.local./inbox/",
  // Additional reserved IPv4 ranges (fail-closed gate denies all reserved).
  "https://100.64.0.1/inbox/", // CGNAT 100.64.0.0/10
  "https://100.127.255.255/inbox/",
  "https://192.0.0.1/inbox/", // 192.0.0.0/24
  "https://198.18.0.1/inbox/", // 198.18.0.0/15 benchmarking
  "https://198.19.255.255/inbox/",
  "https://255.255.255.255/inbox/", // broadcast
  "https://[fec0::1]/inbox/", // deprecated site-local
  "https://[64:ff9b::7f00:1]/inbox/", // NAT64 embedding 127.0.0.1
  "https://[2002:7f00:1::1]/inbox/", // 6to4 embedding 127.0.0.1
  // Multicast / reserved (224.0.0.0/4, 240.0.0.0/4).
  "https://224.0.0.1/inbox/",
  "https://240.0.0.1/inbox/",
  // Encoded-loopback forms — `new URL()` canonicalises these to 127.0.0.1, so
  // they must be blocked. This regression-locks the canonicalisation
  // assumption that the IPv4 string parser relies on (a load-bearing SSRF
  // defence: if a runtime parsed hosts differently this would silently open).
  "https://2130706433/inbox/", // integer form of 127.0.0.1
  "https://0x7f.0.0.1/inbox/", // hex first octet
  "https://0177.0.0.1/inbox/", // octal first octet
  "https://0x7f000001/inbox/", // hex integer form
  // Known cloud-metadata hostnames (resolve to 169.254.169.254).
  "https://metadata.google.internal/computeMetadata/",
  "https://metadata.google.internal./computeMetadata/", // trailing dot
  // Dotless / single-label hosts resolve to intranet via search domains.
  "https://wiki/inbox/",
  "https://router/inbox/",
  "https://intranet:8080/inbox/",
])("refuses Pod Manager's former blocked targets before authenticated I/O: %s", async (url) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(clientFetch({ fetch })(url)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test("accepts Request inputs while preserving method, headers and final URL checks", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("body"));
  const request = new Request("https://8.8.8.8/path", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "hello",
  });
  await expect(clientFetch({ fetch })(request)).resolves.toHaveProperty("status", 200);
  expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("content-type")).toBe("text/plain");
});

// The browser policy must run without Node DNS or the pinning requirement masking host checks.
test.each([
  "https://wiki/inbox/",
  "https://router/x",
  "https://a..example/x",
  "https://.example/x",
  "https://example.org./x",
  "https://printer.local/x",
  "https://localhost/x",
  "https://127.0.0.1/x",
  "https://10.0.0.1/x",
  "https://169.254.1.1/x",
  "https://[::1]/x",
  "https://[fe80::1]/x",
  "https://[fd00::1]/x",
  "https://user:pass@example.org/x",
  "https://example.org:8443/x",
])("refuses unsafe browser destination with dnsLookup:null: %s", async (url) => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", {});
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(clientFetch({ fetch, dnsLookup: null })(url)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  "https://pod.example/x",
  "https://8.8.8.8/x",
  "https://[2606:4700:4700::1111]/x",
])("accepts public browser names and public IP literals: %s", async (url) => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", {});
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null));
  await expect(clientFetch({ fetch, dnsLookup: null })(url)).resolves.toHaveProperty("status", 200);
});

test.each([
  "localhost",
  "127.0.0.1",
  "[::1]",
])("loopback development is explicit and exact: %s", async (host) => {
  for (const scheme of ["http", "https"]) {
    const url = `${scheme}://${host}:3000/inbox/`;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response(null));
    await expect(clientFetch({ fetch, dnsLookup: null })(url)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      clientFetch({ fetch, dnsLookup: null, devLoopback: true })(url),
    ).resolves.toHaveProperty("status", 200);
  }
});

test.each([
  "http://pod.example/x",
  "http://10.0.0.1/x",
  "http://127.0.0.2/x",
  "https://foo.localhost/x",
  "http://localhost./x",
])("development does not admit non-loopback targets: %s", async (url) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(clientFetch({ fetch, dnsLookup: null, devLoopback: true })(url)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test("only own storage GET/HEAD admits an alternate HTTPS port", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(null));
  const request = clientFetch({ fetch, ownStorageRoots: ["https://8.8.8.8:8443/alice/"] });
  await expect(request("https://8.8.8.8:8443/alice/inbox/")).resolves.toHaveProperty("status", 200);
  await expect(
    request(new Request("https://8.8.8.8:8443/alice/inbox/", { method: "HEAD" })),
  ).resolves.toHaveProperty("status", 200);
  for (const [url, method] of [
    ["https://8.8.8.8:8443/bob/inbox/", "GET"],
    ["https://8.8.8.8:8443/alice/inbox/", "POST"],
    ["https://8.8.8.8:8443/alice/inbox/", "DELETE"],
  ])
    await expect(request(url, { method })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("empty response URLs do not misreport fragment inputs as redirects", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("ok"));
  await expect(clientFetch({ fetch })("https://8.8.8.8/x#fragment")).resolves.toHaveProperty(
    "status",
    200,
  );
  await expect(clientFetch({ fetch })("bad URL")).rejects.toThrow();
});

test("aborting a listing cancels its source stream", async () => {
  const controller = new AbortController();
  const cancelled = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
    return new Response(
      new ReadableStream({
        start() {
          queueMicrotask(() => controller.abort());
        },
        cancel: cancelled,
      }),
    );
  });
  await expect(
    clientFetch({ fetch }, { truncated: false })("https://8.8.8.8/inbox/", {
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());
});

test("checks label safety with a pinned Node resolver before any authenticated request", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const url of ["https://wiki/x", "https://a..example/x", "https://example.org./x"]) {
    await expect(
      clientFetch({
        fetch,
        pinningFetch: fetch,
        dnsLookup: async () => [{ address: "8.8.8.8", family: 4 }],
      })(url),
    ).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("listing cancellation errors cannot hide a capped result", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(256 * 1024 + 1));
          },
          cancel() {
            return Promise.reject(new Error("cancel refused"));
          },
        }),
      ),
  );
  const budget = { truncated: false };
  await expect(clientFetch({ fetch }, budget)("https://8.8.8.8/inbox/")).resolves.toHaveProperty(
    "status",
    200,
  );
  expect(budget.truncated).toBe(true);
});

test("uses the fragment-free input when the runtime cannot attach a response URL", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null));
  const define = Object.defineProperty;
  const mock = vi
    .spyOn(Object, "defineProperty")
    .mockImplementation((target, property, descriptor) => {
      if (target instanceof Response && property === "url") throw new TypeError("read-only URL");
      return define(target, property, descriptor);
    });
  try {
    await expect(clientFetch({ fetch })("https://8.8.8.8/x#fragment")).resolves.toHaveProperty(
      "status",
      200,
    );
  } finally {
    mock.mockRestore();
  }
});

test("the shared deadline also bounds DNS validation before dispatch", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn<typeof globalThis.fetch>();
  try {
    const pending = clientFetch({
      fetch,
      pinningFetch: fetch,
      dnsLookup: async () => new Promise(() => {}),
    })("https://pod.example/inbox/");
    const refused = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(8_001);
    await refused;
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test.each([
  false,
  true,
])("rejects a rebuilt response with an empty URL and redirected=true (listing=%s)", async (listing) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
    const rebuilt = new Response("redirected body");
    Object.defineProperty(rebuilt, "redirected", { value: true });
    expect(rebuilt.url).toBe("");
    return rebuilt;
  });
  await expect(
    clientFetch({ fetch }, listing ? { truncated: false } : undefined)("https://8.8.8.8/inbox/"),
  ).rejects.toThrow("redirect");
  expect(fetch.mock.calls[0][1]?.redirect).toBe("manual");
});

test("redirected responses with no body also fail closed", async () => {
  const response = new Response(null, { status: 204 });
  Object.defineProperty(response, "redirected", { value: true });
  await expect(
    clientFetch({ fetch: async () => response })("https://8.8.8.8/inbox/"),
  ).rejects.toThrow("redirect");
});

test("own-inbox port exception permits only scoped marker PUT and child DELETE", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(null));
  const root = "https://8.8.8.8:8443/alice/";
  const ownInboxUrl = `${root}inbox/`;
  const request = clientFetch({ fetch, ownStorageRoots: [root], ownInboxUrl });
  for (const [name, method] of [
    ["n.read.ttl", "PUT"],
    ["n", "DELETE"],
    ["n.read.ttl", "DELETE"],
  ])
    await expect(request(`${ownInboxUrl}${name}`, { method })).resolves.toHaveProperty(
      "status",
      200,
    );
  for (const [url, method] of [
    [ownInboxUrl, "DELETE"],
    [`${ownInboxUrl}nested/n`, "DELETE"],
    [`${root}other/n`, "DELETE"],
    [`${ownInboxUrl}.acl`, "DELETE"],
    [`${ownInboxUrl}n.acr`, "DELETE"],
    [`${ownInboxUrl}n`, "PUT"],
    [`${ownInboxUrl}n#fragment`, "DELETE"],
    [`${ownInboxUrl}n?query`, "DELETE"],
    [`${ownInboxUrl}n.read.ttl`, "PATCH"],
    [ownInboxUrl, "POST"],
    ["https://8.8.8.8:8443/bob/inbox/n", "DELETE"],
    ["https://8.8.8.8:9443/alice/inbox/n", "DELETE"],
  ])
    await expect(request(url, { method })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(3);
});
