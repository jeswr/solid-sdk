// AUTHORED-BY Codex GPT-6.1-Sol
import { createSolidAuth } from "@jeswr/solid-auth-core";
import { expect, it, vi } from "vitest";
import { createConnection, inspectPod } from "../../src/connections.js";
import { createPodHttp } from "../../src/index.js";
import { fakeAuth, sourceRoot, sourceWebId } from "./fixtures.js";

vi.mock("@jeswr/solid-auth-core", () => ({ createSolidAuth: vi.fn() }));

it("uses the host client document with an isolated destination callback and namespace", () => {
  vi.mocked(createSolidAuth).mockReturnValue(fakeAuth(null));
  const connection = createConnection(
    "target",
    "https://suite.example",
    "/settings/move-pod/",
    "https://suite.example/.well-known/solid-client-id.jsonld",
  );
  expect(connection.id).toBe("target");
  expect(createSolidAuth).toHaveBeenCalledWith(
    expect.objectContaining({
      clientId: "https://suite.example/.well-known/solid-client-id.jsonld",
      redirectUri: "https://suite.example/settings/move-pod/callback/target",
      dbName: "pod-migrator:target:sessions",
      patchGlobalFetch: false,
      includeIssuerOrigin: false,
    }),
  );
});

it.each([
  ["Community Solid Server/7.2.0", "css"],
  ["solid-server/5.0.0", "nss"],
  [null, undefined],
] as const)("inspects the active source using storage evidence %s", async (header, expected) => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { headers: header ? { "x-powered-by": header } : {} }),
  );
  const http = createPodHttp({ root: sourceRoot, fetch });
  const side = await inspectPod(
    { root: sourceRoot, ownerWebId: sourceWebId, http },
    new AbortController().signal,
  );
  expect(side.implementation).toBe(expected);
  expect(side.http).toBe(http);
  expect(fetch).toHaveBeenCalledWith(
    sourceRoot,
    expect.objectContaining({ method: "HEAD", redirect: "manual" }),
  );
});

it("falls back to GET and retains unknown evidence on transport failure", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 405 }))
    .mockResolvedValueOnce(
      new Response(null, { headers: { "x-powered-by": "Community Solid Server" } }),
    );
  const http = createPodHttp({ root: sourceRoot, fetch });
  expect(
    (
      await inspectPod(
        { root: sourceRoot, ownerWebId: sourceWebId, http },
        new AbortController().signal,
      )
    ).implementation,
  ).toBe("css");
  fetch.mockRejectedValue(new Error("unavailable"));
  expect(
    (
      await inspectPod(
        { root: sourceRoot, ownerWebId: sourceWebId, http },
        new AbortController().signal,
      )
    ).implementation,
  ).toBeUndefined();
});

it("rejects an aborted source inspection", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null));
  const http = createPodHttp({ root: sourceRoot, fetch });
  await expect(
    inspectPod({ root: sourceRoot, ownerWebId: sourceWebId, http }, AbortSignal.abort()),
  ).rejects.toThrow();
});
