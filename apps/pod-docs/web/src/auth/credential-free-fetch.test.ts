// AUTHORED-BY Codex GPT-6
import { installProactiveAuthFetch } from "@jeswr/solid-elements/auth";
import { describe, expect, it, vi } from "vitest";
import { respectOmittedCredentials } from "./credential-free-fetch";

describe("credential-free identity redirect transport", () => {
  it.each([
    "init",
    "request",
  ])("bypasses proactive tokens for credentials omitted via %s", async (source) => {
    const url = "https://pod.example/profile";
    const upgrade = vi.fn(async (request: Request) => {
      const headers = new Headers(request.headers);
      headers.set("authorization", "DPoP private-token");
      headers.set("dpop", "private-proof");
      return new Request(request, { headers });
    });
    const base = vi.fn<typeof fetch>(async () => new Response(""));
    const install = installProactiveAuthFetch({
      patchGlobal: false,
      pristineFetch: base,
      initial: { provider: { upgrade }, allowedOrigins: new Set([new URL(url).origin]) },
    });
    const transport = respectOmittedCredentials(install.fetch, install.pristineFetch);
    const init = { redirect: "follow", credentials: "omit" } as const;
    if (source === "init") await transport(url, init);
    else await transport(new Request(url, init));
    expect(upgrade).not.toHaveBeenCalled();
    const anonymous = base.mock.calls[0]?.[0] as Request;
    expect(anonymous.credentials).toBe("omit");
    expect(anonymous.redirect).toBe("follow");
    expect(anonymous.headers.has("authorization")).toBe(false);
    expect(anonymous.headers.has("dpop")).toBe(false);

    // The same origin still receives its token for ordinary authenticated reads.
    await transport(url);
    expect(upgrade).toHaveBeenCalledTimes(1);
    const authenticated = base.mock.calls[1]?.[0] as Request;
    expect(authenticated.headers.get("authorization")).toBe("DPoP private-token");
  });
});
