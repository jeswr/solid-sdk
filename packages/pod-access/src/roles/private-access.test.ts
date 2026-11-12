// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, expect, it, vi } from "vitest";
import { readGrants, setGrants } from "./client.js";
import { ensurePrivateContainerAccess, verifyPrivateDemoAccess } from "./private-access.js";

vi.mock("./client.js", () => ({ readGrants: vi.fn(), setGrants: vi.fn() }));
const root = "https://pod.example/alice/";
const owner = `${root}profile#me`;
const session = { mode: "demo", storageUrl: root, webId: owner, fetch: vi.fn<typeof fetch>() };
const privateResponse = () =>
  new Response(null, { headers: { "X-Solid-Demo-Access-Control": "none" } });
beforeEach(() => {
  vi.resetAllMocks();
});
it("checks owner, demo mode and scoped unambiguous URLs before transport", async () => {
  expect(await verifyPrivateDemoAccess({ ...session, mode: "solid" }, root, owner)).toBe(false);
  expect(await verifyPrivateDemoAccess(session, root, "https://other.example/me")).toBe(false);
  for (const target of ["invalid", "https://evil.example/", `${root}x?q=1`, `${root}x#f`])
    expect(await verifyPrivateDemoAccess(session, target, owner)).toBe(false);
  expect(session.fetch).not.toHaveBeenCalled();
});
it("walks missing ancestors and accepts only the explicit isolated-backend marker", async () => {
  session.fetch
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(privateResponse());
  expect(await ensurePrivateContainerAccess(session, `${root}templates/nested/file`)).toBe(true);
  expect(session.fetch.mock.calls.map(([url]) => url)).toEqual([
    `${root}templates/nested/file`,
    `${root}templates/nested/`,
    `${root}templates/`,
  ]);
  session.fetch.mockResolvedValueOnce(new Response());
  expect(await verifyPrivateDemoAccess(session, root, owner)).toBe(false);
  session.fetch.mockRejectedValueOnce(new Error("offline"));
  expect(await verifyPrivateDemoAccess(session, root, owner)).toBe(false);
});
it.each([405, 501])("falls back to GET when HEAD is unsupported (%s)", async (status) => {
  session.fetch
    .mockResolvedValueOnce(new Response(null, { status }))
    .mockResolvedValueOnce(privateResponse());
  expect(await verifyPrivateDemoAccess(session, root, owner)).toBe(true);
  expect(session.fetch).toHaveBeenLastCalledWith(root, { redirect: "manual" });
});
it("fails closed at the root, on forbidden or redirect, and at a malformed root boundary", async () => {
  for (const status of [404, 403, 302]) {
    session.fetch.mockResolvedValueOnce(new Response(null, { status }));
    expect(await verifyPrivateDemoAccess(session, root, owner)).toBe(false);
  }
  session.fetch
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect(
    await verifyPrivateDemoAccess(
      { ...session, storageUrl: root.slice(0, -1) },
      `${root}file`,
      owner,
    ),
  ).toBe(false);
});
it("provisions both container scopes through existing role mutations and verifies owner grants", async () => {
  const real = { ...session, mode: "solid" };
  vi.mocked(setGrants).mockResolvedValue({
    applied: [`${root}templates/`],
    failed: [],
    notification: { requested: false, delivered: false },
  });
  const own = {
    agent: { type: "webid" as const, id: owner },
    role: "manager" as const,
    inherited: false,
    source: `${root}templates/.acl`,
  };
  vi.mocked(readGrants).mockResolvedValue({ url: root, version: "test" as never, grants: [own] });
  expect(await ensurePrivateContainerAccess(real, `${root}templates/`)).toBe(true);
  expect(setGrants).toHaveBeenCalledWith(
    [`${root}templates/`],
    [expect.objectContaining({ role: "manager", agent: { type: "webid", id: owner } })],
    expect.objectContaining({ kind: "folder", ownOnly: true }),
  );
  for (const grants of [
    [],
    [{ ...own, inherited: true }],
    [{ ...own, role: "viewer" as const }],
    [{ ...own, agent: { type: "public" as const } }],
    [{ ...own, agent: { type: "webid" as const, id: "https://other.example/me" } }],
  ]) {
    vi.mocked(readGrants).mockResolvedValueOnce({ url: root, version: "test" as never, grants });
    expect(await ensurePrivateContainerAccess(real, `${root}templates/`)).toBe(false);
  }
  vi.mocked(setGrants).mockResolvedValueOnce({
    applied: [],
    failed: [{ url: root, error: "unsupported" }],
    notification: { requested: false, delivered: false },
  });
  expect(await ensurePrivateContainerAccess(real, `${root}templates/`)).toBe(false);
  await expect(ensurePrivateContainerAccess(real, "https://evil.example/")).rejects.toThrow();
});
