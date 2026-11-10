// AUTHORED-BY Codex GPT-6.1-Sol
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const distIndexUrl = pathToFileURL(join(process.cwd(), "dist", "index.js")).href;
const distReactUrl = pathToFileURL(join(process.cwd(), "dist", "react", "index.js")).href;

describe("packaged request-access API", () => {
  it("both entries share the request-access helpers and typed errors", async () => {
    const core = await import(distIndexUrl);
    const react = await import(distReactUrl);
    for (const name of [
      "canRequestAccess",
      "requestAccessAfterDenial",
      "RequestAccessUnavailableError",
      "AccessDeniedError",
    ]) {
      expect(typeof core[name]).toBe("function");
      expect(react[name]).toBe(core[name]);
    }
    const error = new core.AccessDeniedError("https://pod.example/private", { status: 403 });
    const request = { classes: ["https://schema.org/Person"], modes: ["read"] };
    const target = { solid: { requestAccess: async () => ({ ok: true, grants: [] }) } };
    expect(react.canRequestAccess(target)).toBe(true);
    expect(core.canRequestAccess({})).toBe(false);
    await expect(react.requestAccessAfterDenial(error, request, target)).resolves.toEqual({
      ok: true,
      granted: false,
    });
    await expect(core.requestAccessAfterDenial(error, request, {})).rejects.toBeInstanceOf(
      react.RequestAccessUnavailableError,
    );
  });
});
