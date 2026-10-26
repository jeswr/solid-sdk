// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { createServer } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { grantBindingProblem, login, status } from "../src/operations.js";
import { noTransport } from "../src/providers.js";
import type { Grant, Profile } from "../src/store.js";
import { CredentialStore } from "../src/store.js";

vi.mock("http", async (original) => {
  const actual = await original<typeof import("http")>();
  return { ...actual, createServer: vi.fn(actual.createServer) };
});
let base: string;
let store: CredentialStore;
const now = () => new Date("2026-10-26T00:00:00Z");
const p: Profile = {
  version: 1,
  name: "fixture",
  provider: "google",
  purpose: "read",
  resource: "mail",
  connectionId: "owner",
  account: "owner@example.org",
  inventory: false,
  createdAt: now().toISOString(),
};
const clientId = "fixture.apps.googleusercontent.com";
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "credentials-callback-"));
  store = new CredentialStore(join(base, "store"));
  store.putProfile(p);
  store.putClient({
    version: 1,
    provider: "google",
    clientId,
    importedFrom: "fixture",
    importedAt: now().toISOString(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});
it("refuses malformed callback requests and closes the listener when the operator cancels", async () => {
  await expect(
    login({ store, now, transport: noTransport }, p.name, {
      onUrl: () => {
        const server = fixtureValue(vi.mocked(createServer).mock.results.at(-1)).value as Server;
        const response = { writeHead: vi.fn(), end: vi.fn() };
        server.emit("request", { headers: {}, method: "GET" }, response);
        expect(response.writeHead).toHaveBeenCalledWith(
          404,
          expect.objectContaining({ "cache-control": "no-store" }),
        );
        throw new Error("operator cancelled");
      },
    }),
  ).rejects.toThrow(/operator cancelled/);
  expect(vi.mocked(createServer).mock.results.at(-1)?.value.listening).toBe(false);
  expect(store.grant(p.name)).toBeUndefined();
});
it("keeps IPv4 available if the optional IPv6 loopback listener is unavailable", async () => {
  const actual = await vi.importActual<typeof import("http")>("http");
  const v6 = actual.createServer();
  vi.spyOn(v6, "listen").mockImplementation(() => {
    queueMicrotask(() => v6.emit("error", new Error("IPv6 unavailable")));
    return v6;
  });
  vi.mocked(createServer).mockImplementationOnce(actual.createServer).mockReturnValueOnce(v6);
  store.putProfile({
    ...p,
    provider: "microsoft",
    microsoft: { accountType: "personal", tenant: "consumers" },
  });
  store.putClient({
    version: 1,
    provider: "microsoft",
    clientId: "00000000-1111-4222-8333-444444444444",
    addedAt: now().toISOString(),
  });
  await expect(
    login({ store, now, transport: noTransport }, p.name, {
      onUrl: (url) => {
        expect(new URL(url).searchParams.get("redirect_uri")).toContain("localhost");
        throw new Error("operator cancelled");
      },
    }),
  ).rejects.toThrow(/operator cancelled/);
  expect(v6.listening).toBe(false);
});
it("refuses missing or mismatched tenant binding and reports missing Microsoft client and unreadable grants", () => {
  const ms: Profile = {
    ...p,
    provider: "microsoft",
    microsoft: { accountType: "personal", tenant: "consumers" },
  };
  const g: Grant = {
    version: 1,
    profile: p.name,
    provider: "microsoft",
    purpose: p.purpose,
    resource: p.resource,
    clientId,
    account: { subject: "fixture-sub", username: p.account },
    grantedScopes: [],
    state: "active",
    obtainedAt: now().toISOString(),
    updatedAt: now().toISOString(),
  };
  for (const profile of [ms, { ...ms, microsoft: undefined }])
    expect(grantBindingProblem(g, profile, undefined)).toContain("tenant");
  expect(
    grantBindingProblem(
      { ...g, account: { ...g.account, tenant: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } },
      ms,
      undefined,
    ),
  ).toContain("tenant");
  store.putProfile(ms);
  expect(status(store, () => []).profiles[0]?.client).toBe("missing");
  store.putClient({
    version: 1,
    provider: "microsoft",
    clientId: "00000000-1111-4222-8333-444444444444",
    addedAt: now().toISOString(),
  });
  writeFileSync(join(store.dir, "grants/fixture.json"), "invalid", { mode: 0o600 });
  const summary = status(store, () => []);
  expect(summary.clients.microsoft).toContain("registered");
  expect(summary.profiles[0]?.grant.state).toBe("unreadable");
});

import { fixtureValue } from "./fixture.js";
