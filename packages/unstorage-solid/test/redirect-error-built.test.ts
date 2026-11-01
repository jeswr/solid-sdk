// AUTHORED-BY Codex GPT-6.1-Sol
import { RedirectRefusedError, refuseRedirects } from "@jeswr/guarded-fetch";
import { expect, it } from "vitest";
import { SolidRedirectError } from "../dist/index.js";

const URL = "https://pod.example/alice/item";

it("retains the legacy constructor contract through the built bundle", () => {
  expect(SolidRedirectError).toBe(RedirectRefusedError);
  const error = new SolidRedirectError(URL, 302);
  expect(error).toBeInstanceOf(SolidRedirectError);
  expect(error).toBeInstanceOf(RedirectRefusedError);
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("SolidRedirectError");
  expect(error.message).toBe(
    `[unstorage-solid] refusing to follow a redirect (status 302) from ${URL} ` +
      "(a redirected pod request could forward credentials off-origin — SSRF/credential-leak guard)",
  );
  expect(error).toMatchObject({ url: URL, status: 302, location: undefined });
});

it("retains the shared constructor contract through the built bundle", () => {
  const cause = new Error("fixture cause");
  const error = new SolidRedirectError("fixture message", {
    url: URL,
    status: 307,
    location: "/next",
    cause,
  });
  expect(error).toBeInstanceOf(SolidRedirectError);
  expect(error).toBeInstanceOf(RedirectRefusedError);
  expect(error).toMatchObject({
    name: "RedirectRefusedError",
    message: "fixture message",
    url: URL,
    status: 307,
    location: "/next",
    cause,
  });
});

it("recognizes shared thrown errors through the built alias", async () => {
  const error = await refuseRedirects(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "/next" },
      }),
  )(URL).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(SolidRedirectError);
  expect(error).toMatchObject({ name: "RedirectRefusedError", url: URL, status: 302 });
  expect((error as Error).message).toContain(URL);
});
