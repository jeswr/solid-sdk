// AUTHORED-BY Codex GPT-6.1-Sol
import { readWac } from "@jeswr/pod-access";
import { Writer } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { parseResource } from "../src/apps/home/lib/model/rdf";
import { loadPermissions, resolveClientName } from "../src/apps/home/lib/permissions";
import { clientLogoSource, demoClientResource } from "../src/apps/home/lib/permissions/demo-client";
import { getDemoPod } from "../src/lib/demo-pod/browser";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { DEMO_APP_CLIENT_ID, DEMO_APP_LOGO } from "../src/lib/demo-pod/seed-permission-app";
import { seedPermissions } from "../src/lib/demo-pod/seed-permissions";

vi.mock("../src/lib/demo-pod/browser", () => ({ getDemoPod: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("resolves the seeded app's real client name and logo through the fixture transport, retaining MaraCoach", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", "1");
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.UTC(2026, 10, 1)) });
  const transport = vi.spyOn(pod, "fetch");
  vi.mocked(getDemoPod).mockResolvedValue(pod);
  const network = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", network);
  const metadata = await resolveClientName(DEMO_APP_CLIENT_ID);
  expect(metadata).toEqual({
    name: "NoteNest",
    uri: `${DEMO_ROOT}apps/notenest/`,
    logoUri: DEMO_APP_LOGO,
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledWith(
    DEMO_APP_CLIENT_ID,
    expect.objectContaining({ credentials: "omit", redirect: "error" }),
  );
  const document = await pod.fetch(DEMO_APP_CLIENT_ID);
  expect(document.headers.get("content-type")).toBe("application/json");
  const client = await document.json();
  expect(client["@context"]).toBe("https://www.w3.org/ns/solid/oidc-context.jsonld");
  expect(client.client_id).toBe(DEMO_APP_CLIENT_ID);
  expect(client.client_name).toBe(metadata.name);
  expect(client.logo_uri).toBe(metadata.logoUri);
  const snapshot = await loadPermissions({
    fetch: pod.fetch,
    storage: DEMO_ROOT,
    webId: DEMO_WEBID,
  });
  expect(snapshot.failures).toEqual([]);
  const app = snapshot.rows.find((row) => row.id === DEMO_APP_CLIENT_ID);
  expect(app?.kind).toBe("app");
  expect(app?.lines).toHaveLength(1);
  expect(app?.lines[0]).toMatchObject({
    modes: ["read"],
    inherited: false,
    resources: [
      expect.objectContaining({ scope: "resource" }),
      expect.objectContaining({ scope: "members" }),
    ],
  });
  expect(snapshot.rows.some((row) => row.id === "https://maracoach.example")).toBe(true);
  const logo = await clientLogoSource(DEMO_APP_LOGO);
  expect(logo?.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
  expect(decodeURIComponent(logo || "")).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  const image = await pod.fetch(DEMO_APP_LOGO);
  expect((await image.arrayBuffer()).byteLength).toBeLessThan(4096);
  const aclUrl = `${DEMO_ROOT}apps/notenest/.acl`;
  const dataset = await parseResource(
    await (await pod.fetch(aclUrl)).text(),
    "text/turtle",
    aclUrl,
  );
  for (const url of [DEMO_APP_CLIENT_ID, DEMO_APP_LOGO]) {
    expect(readWac(dataset, new URL(".", url).href, aclUrl).grants).toContainEqual(
      expect.objectContaining({
        who: [[{ kind: "public" }]],
        appliesTo: "members",
        modes: new Set(["read"]),
      }),
    );
  }
  expect(network).not.toHaveBeenCalled();
});

it("only serves the exact two fixture URLs and leaves ordinary public metadata on public fetch", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", "0");
  expect(await demoClientResource(DEMO_APP_CLIENT_ID)).toBeUndefined();
  expect(await clientLogoSource(DEMO_APP_LOGO)).toBe(DEMO_APP_LOGO);
  vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", "1");
  for (const url of [
    DEMO_ROOT,
    `${DEMO_APP_CLIENT_ID}?q=1`,
    `${DEMO_ROOT}private/secret.json`,
    "https://external.example/client.json",
  ])
    expect(await demoClientResource(url)).toBeUndefined();
  expect(getDemoPod).not.toHaveBeenCalled();
  const publicFetch = vi.fn<typeof fetch>(async () => Response.json({ client_name: "Public app" }));
  vi.stubGlobal("fetch", publicFetch);
  expect(await resolveClientName("https://public-fixture.example/client.json")).toEqual({
    name: "Public app",
  });
  expect(publicFetch).toHaveBeenCalledTimes(1);
  expect(await clientLogoSource("https://public-fixture.example/logo.svg")).toBe(
    "https://public-fixture.example/logo.svg",
  );
  expect(publicFetch).toHaveBeenCalledTimes(1);
});

it("does not fall back to a network logo when the fixture is absent, malformed or offline", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", "1");
  const pod = createDemoPod({ root: DEMO_ROOT });
  vi.mocked(getDemoPod).mockResolvedValue(pod);
  expect(await clientLogoSource(DEMO_APP_LOGO)).toBeUndefined();
  await pod.fetch(DEMO_APP_LOGO, {
    method: "PUT",
    body: "not an SVG",
    headers: { "content-type": "text/html" },
  });
  expect(await clientLogoSource(DEMO_APP_LOGO)).toBeUndefined();
  vi.mocked(getDemoPod).mockRejectedValue(new Error("offline"));
  expect(await clientLogoSource(DEMO_APP_LOGO)).toBeUndefined();
});

it.each([
  "image/svg+xml; charset=utf-8",
  "IMAGE/SVG+XML ; charset=UTF-8",
])("loads a demo SVG whose content type has parameters: %s", async (contentType) => {
  vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", "1");
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(0) });
  vi.mocked(getDemoPod).mockResolvedValue(pod);
  const original = await pod.fetch(DEMO_APP_LOGO);
  await pod.fetch(DEMO_APP_LOGO, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: await original.text(),
  });
  const source = await clientLogoSource(DEMO_APP_LOGO);
  expect(source).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  expect(decodeURIComponent(source || "")).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
});

it("refuses a demo logo response without a content type", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", "1");
  const pod = createDemoPod({ root: DEMO_ROOT });
  vi.spyOn(pod, "fetch").mockResolvedValue(new Response(null));
  vi.mocked(getDemoPod).mockResolvedValue(pod);
  expect(await clientLogoSource(DEMO_APP_LOGO)).toBeUndefined();
});

it("propagates permission seed serialization failures", async () => {
  const error = new Error("Permission serialization failed");
  const end = vi
    .spyOn(Writer.prototype, "end")
    .mockImplementationOnce((callback) => callback?.(error, ""));
  try {
    await expect(seedPermissions(DEMO_ROOT, DEMO_WEBID, 0)).rejects.toBe(error);
  } finally {
    end.mockRestore();
  }
});
