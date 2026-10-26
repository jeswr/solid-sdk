// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { createServer } from "http";
import { expect, it, vi } from "vitest";
import { createOriginScopedFetch } from "../src/origins.js";

it("refuses an undeclared local origin before connecting, and permits listed loopback only in tests", async () => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.end("local fixture");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no local fixture address");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const allowed = new Set(["https://allowed.example"]);
    const scoped = createOriginScopedFetch(allowed);
    allowed.add(origin);
    await expect(scoped(`${origin}/blocked`)).rejects.toThrow("ORIGINS");
    expect(requests).toBe(0);
    await expect(createOriginScopedFetch(new Set([origin]))(origin)).rejects.toThrow();
    expect(requests).toBe(0);
    const local = createOriginScopedFetch(new Set([origin]), { allowLoopback: true });
    expect(await (await local(new URL(`${origin}/listed`))).text()).toBe("local fixture");
    expect(requests).toBe(1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("checks string, URL and Request inputs and refuses redirects before forwarding credentials", async () => {
  const transport = vi.fn(async () => new Response("fixture"));
  const dnsLookup = vi.fn(async () => [{ address: "1.1.1.1", family: 4 as const }]);
  const origin = "https://allowed.example";
  const scoped = createOriginScopedFetch(new Set([origin]), { transport, dnsLookup });
  for (const input of [origin, new URL(`${origin}/url`), new Request(`${origin}/request`)])
    expect(await (await scoped(input)).text()).toBe("fixture");
  expect(transport).toHaveBeenCalledTimes(3);
  await expect(
    scoped("https://other.example/private", { headers: { authorization: "Bearer test-token" } }),
  ).rejects.toThrow("ORIGINS");
  expect(transport).toHaveBeenCalledTimes(3);
  expect(dnsLookup).toHaveBeenCalledTimes(3);
  const redirect = vi.fn(
    async () => new Response(null, { status: 302, headers: { location: "https://other.example" } }),
  );
  await expect(
    createOriginScopedFetch(new Set([origin]), { transport: redirect, dnsLookup })(origin, {
      redirect: "follow",
      headers: { authorization: "Bearer test-token" },
    }),
  ).rejects.toThrow();
  expect(redirect).toHaveBeenCalledTimes(1);
});

it("refuses malformed origins, userinfo, unsupported schemes and unsafe destinations", async () => {
  for (const origin of [
    "!",
    "https://allowed.example/path",
    "https://user:pass@allowed.example",
    "file://",
    "ftp://allowed.example",
    "https://allowed.example/",
    "https://allowed.example#fragment",
  ])
    expect(() => createOriginScopedFetch(new Set([origin]))).toThrow();
  const transport = vi.fn(async () => new Response("unexpected"));
  const scoped = createOriginScopedFetch(
    new Set(["https://allowed.example", "https://127.0.0.1", "http://allowed.example"]),
    { transport, dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }] },
  );
  for (const input of [
    "!",
    "https://user:pass@allowed.example",
    "https://127.0.0.1",
    "http://allowed.example",
  ])
    await expect(scoped(input)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
