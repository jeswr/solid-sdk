// AUTHORED-BY GPT-6.1 Sol
import { createAppPodAuth } from "@jeswr/app-session";
import { fakePodAuth } from "@jeswr/app-session/testing";
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "@/app/clientid.jsonld/route";

vi.mock("@jeswr/app-session", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session")>()),
  createAppPodAuth: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllEnvs();
});

it.each([
  "production",
  "development",
])("creates one lazy getter at the site root without touching location in %s", async (environment) => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", environment);
  vi.stubGlobal("location", undefined);
  const core = fakePodAuth().auth;
  const getter = vi.fn(async () => core);
  vi.mocked(createAppPodAuth).mockClear().mockReturnValue(getter);
  const adapter = await import("./pod-auth");
  expect(createAppPodAuth).toHaveBeenCalledExactlyOnceWith({
    base: "/",
    dev: environment === "development",
  });
  expect(getter).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  expect(await adapter.getPodAuth()).toBe(core);
});

it("serves a public client document registering only the popup callback", async () => {
  const response = GET(new Request("https://diary.example/clientid.jsonld"));
  expect(response.headers.get("content-type")).toBe("application/ld+json");
  expect(await response.json()).toMatchObject({
    client_id: "https://diary.example/clientid.jsonld",
    redirect_uris: ["https://diary.example/callback.html"],
    client_name: "Coeliac Diary",
    token_endpoint_auth_method: "none",
    scope: "openid webid offline_access",
  });
});
