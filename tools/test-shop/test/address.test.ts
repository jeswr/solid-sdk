// AUTHORED-BY Codex GPT-6.1-Sol
import { afterAll, beforeAll, expect, it } from "vitest";
import { type RunningShop, startShop } from "../src/index.js";

let shop: RunningShop;
beforeAll(async () => {
  shop = await startShop();
});
afterAll(async () => shop.close());

it("protects the delivery address form with a signed-in session and CSRF", async () => {
  const transport = fetch;
  expect((await transport(`${shop.url}/account/address`, { redirect: "manual" })).status).toBe(302);
  const login = await transport(`${shop.url}/login`);
  const csrfCookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  const csrf = csrfCookie.slice("csrf=".length);
  const signedIn = await transport(`${shop.url}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: csrfCookie },
    body: new URLSearchParams({
      username: "alex@example.test",
      password: "correct-horse",
      csrf_token: csrf,
    }),
  });
  const cookies = signedIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const sessionCsrf =
    signedIn.headers
      .getSetCookie()
      .find((c) => c.startsWith("csrf="))
      ?.split(";")[0]
      ?.slice(5) ?? "";
  const invalid = await transport(`${shop.url}/account/address`, {
    method: "POST",
    headers: { cookie: cookies },
    body: new URLSearchParams({ csrf_token: "wrong", streetAddress: "12 Example Lane" }),
  });
  expect(invalid.status).toBe(403);
  expect(shop.state.addresses.size).toBe(0);
  const valid = await transport(`${shop.url}/account/address`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: cookies },
    body: new URLSearchParams({ csrf_token: sessionCsrf, streetAddress: "12 Example Lane" }),
  });
  expect(valid.status).toBe(303);
  expect(shop.state.addresses.get("alex@example.test")).toBe("12 Example Lane");
});
