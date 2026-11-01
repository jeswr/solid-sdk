// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { forClientCredentials } from "@jeswr/pod-auth/node";
import { createPodClient } from "@jeswr/storage-client";
import { afterEach, expect, test, vi } from "vitest";
import { cssTarget, seedCssAccount } from "./css.js";
import { memoryTarget } from "./memory.js";

const mocks = vi.hoisted(() => ({ create: vi.fn(), start: vi.fn(), stop: vi.fn() }));
vi.mock("@solid/community-server", () => ({
  AppRunner: class {
    create = mocks.create;
  },
}));
vi.mock("@jeswr/pod-auth/node", () => ({ forClientCredentials: vi.fn() }));
vi.mock("node:net", () => ({ createServer: vi.fn() }));
vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<typeof import("@jeswr/storage-client")>()),
  createPodClient: vi.fn(),
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function accountFetch() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.startsWith("/conformance-")) return new Response(null, { status: 401 });
    if (url.pathname === "/.account/") {
      expect(init?.headers).not.toHaveProperty("Content-Type");
      return Response.json({
        controls: {
          password: { create: "/password" },
          account: { pod: "/pod", clientCredentials: "/credentials" },
        },
      });
    }
    if (url.pathname === "/credentials")
      return Response.json({ id: "fixture-id", secret: "fixture-secret" });
    return Response.json({}, { headers: { "Set-Cookie": "session=fixture-cookie; HttpOnly" } });
  });
}

test("account seeding sends {}, follows same-origin controls and creates distinct accounts", async () => {
  const transport = accountFetch();
  const a = await seedCssAccount("http://localhost:3000/", transport);
  const b = await seedCssAccount("http://localhost:3000/", transport);
  expect(a.root).not.toBe(b.root);
  expect(a.webId).toBe(`${a.root}profile/card#me`);
  expect(a.clientId).toBe("fixture-id");
  expect(transport.mock.calls[0]?.[1]?.body).toBe("{}");
  expect(transport.mock.calls[1]?.[1]?.headers).toHaveProperty("Cookie", "session=fixture-cookie");
  expect(transport.mock.calls[3]?.[1]?.headers).toHaveProperty("Cookie", "session=fixture-cookie");
});

test("account failures do not echo credential-bearing response bodies", async () => {
  await expect(
    seedCssAccount(
      "http://localhost:3000/",
      async () => new Response("fixture-secret", { status: 500 }),
    ),
  ).rejects.toThrow("CSS account operation failed");
});

test("malformed account JSON cannot echo credentials through a JSON parse error", async () => {
  await expect(
    seedCssAccount("http://localhost:3000/", async () => new Response("fixture-secret")),
  ).rejects.toThrow("Invalid CSS account response");
});

test("account controls cannot send the session cookie to a foreign origin", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({ controls: { password: { create: "https://foreign.example/" }, account: {} } }),
  );
  await expect(seedCssAccount("http://localhost:3000/", transport)).rejects.toThrow(
    "Foreign account control",
  );
  expect(transport).toHaveBeenCalledTimes(2);
});

test("same-origin credential-bearing controls fail before fetch can echo the URL", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({
      controls: {
        password: { create: "http://fixture-secret@localhost:3000/password" },
        account: {},
      },
    }),
  );
  await expect(seedCssAccount("http://localhost:3000/", transport)).rejects.toThrow(
    "Credential-bearing account control",
  );
  expect(transport).toHaveBeenCalledTimes(2);
});

async function setup() {
  // CSS and its transport are mocked in this unit suite; port allocation must be too.
  const portServer = {
    once: vi.fn(),
    listen: vi.fn((_port: number, _host: string, ready: () => void) => ready()),
    address: vi.fn(() => ({ port: 31337 })),
    close: vi.fn((done: () => void) => done()),
  };
  vi.mocked(createServer).mockReturnValue(portServer as never);
  vi.stubGlobal("fetch", accountFetch());
  mocks.create.mockResolvedValue({ start: mocks.start, stop: mocks.stop });
  const logout = vi.fn();
  const authFetch = vi.fn<typeof fetch>(async () => new Response(null));
  vi.mocked(forClientCredentials).mockResolvedValue({ fetch: authFetch, logout } as never);
  const memory = await memoryTarget("solid").start();
  vi.spyOn(memory.storage, "head").mockImplementation(
    async (url) =>
      ({
        etag: '"root-acl"',
        links: new Map([["acl", [{ target: `${url}.acl`, params: {} }]]]),
      }) as never,
  );
  vi.spyOn(memory.storage, "writeRdf").mockResolvedValue({
    url: memory.root,
    etag: '"private-acl"',
    created: false,
  });
  vi.mocked(createPodClient).mockResolvedValue({
    storage: memory.storage,
    features: memory.storage.features,
    description: {} as never,
  });
  return { logout, authFetch, portServer };
}

test("starts file-backed in-process CSS, uses pod-auth credentials and removes data on stop", async () => {
  const { logout, authFetch, portServer } = await setup();
  const running = await cssTarget.start();
  const input = mocks.create.mock.calls[0]?.[0];
  expect(input.config).toBe("@css:config/file.json");
  expect(portServer.listen).toHaveBeenCalledWith(0, "127.0.0.1", expect.any(Function));
  expect(portServer.close).toHaveBeenCalledOnce();
  expect(input.shorthand.port).toBe(31337);
  expect(input.loaderProperties.moduleState.contexts).toHaveProperty(
    "https://linkedsoftwaredependencies.org/bundles/npm/@solid/community-server/^7.0.0/components/context.jsonld",
  );
  expect(forClientCredentials).toHaveBeenCalledWith(
    expect.objectContaining({
      boundary: [running.root],
      allowInsecureLoopback: true,
      clientId: "fixture-id",
      clientSecret: "fixture-secret",
    }),
  );
  expect(createPodClient).toHaveBeenCalledWith(
    expect.objectContaining({ fetch: running.fetch, storage: running.root }),
  );
  expect(await running.authFetchFor(running.webId)).toBe(running.fetch);
  await expect(running.authFetchFor("https://id.example/bob#me")).rejects.toMatchObject({
    code: "unsupported",
  });
  await running.fetch(running.root);
  expect(authFetch).toHaveBeenCalledOnce();
  await access(input.shorthand.rootFilePath);
  await running.stop();
  expect(logout).toHaveBeenCalledOnce();
  expect(mocks.stop).toHaveBeenCalledOnce();
  await expect(access(input.shorthand.rootFilePath)).rejects.toThrow();
});

test.each([
  "create",
  "start",
  "account",
  "auth",
  "discovery",
  "logout",
  "stop",
])("cleans up after a %s failure", async (phase) => {
  const { logout } = await setup();
  const error = new Error("synthetic failure");
  if (phase === "create") mocks.create.mockRejectedValue(error);
  if (phase === "start") mocks.start.mockRejectedValue(error);
  if (phase === "account") vi.stubGlobal("fetch", async () => new Response(null, { status: 500 }));
  if (phase === "auth") vi.mocked(forClientCredentials).mockRejectedValue(error);
  if (phase === "discovery") vi.mocked(createPodClient).mockRejectedValue(error);
  if (phase === "logout" || phase === "stop") {
    const running = await cssTarget.start();
    if (phase === "logout") logout.mockRejectedValue(error);
    else mocks.stop.mockRejectedValue(error);
    await expect(running.stop()).rejects.toThrow(error);
  } else await expect(cssTarget.start()).rejects.toThrow();
  const directory = mocks.create.mock.calls[0]?.[0].shorthand.rootFilePath;
  await expect(access(directory)).rejects.toThrow();
  expect(mocks.stop).toHaveBeenCalledTimes(phase === "create" ? 0 : 1);
});
