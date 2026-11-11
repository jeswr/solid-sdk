// AUTHORED-BY Codex GPT-6.1-Sol
import { randomUUID } from "node:crypto";
import { forClientCredentials } from "@jeswr/pod-auth/node";
import { Authorization } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { encodeRef } from "../../src/lib/refs";
import { type AccountName, accessible, cssAccount, expect, test, warmLiveRoutes } from "./fixtures";

test.beforeAll(({ request }) => warmLiveRoutes(request));

/** Arrange through CSS's account API; browser tests still use interactive OIDC. */
async function accountAuth(name: AccountName) {
  const account = cssAccount(name);
  let cookie = "";
  const json = async (path: string, body?: unknown) => {
    const url = new URL(path, account.issuer);
    expect(url.origin).toBe(new URL(account.issuer).origin);
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Cookie: cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    // Account responses contain credentials: assert only status, never response bodies.
    expect(response.ok).toBe(true);
    return response.json();
  };
  const before = await json(".account/");
  await json(before.controls.password.login, {
    email: account.email,
    password: account.password,
  });
  const after = await json(".account/");
  const credentials = await json(after.controls.account.clientCredentials, {
    name: `shell-errors-${randomUUID()}`,
    webId: account.webId,
  });
  return forClientCredentials({
    issuer: account.issuer,
    clientId: credentials.id,
    clientSecret: credentials.secret,
    // Both fixture users explicitly receive this known root for arrangement only.
    boundary: [new URL("alice/", account.issuer).href],
    allowInsecureLoopback: true,
  });
}

test("scenario 10: an unknown route shows 404 actions and returns Home", async ({ page }) => {
  const response = await page.goto("/missing-shell-page");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "We couldn't find that page", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Search", exact: true })).toHaveAttribute(
    "href",
    "/search",
  );
  await accessible(page);
  await page.getByRole("link", { name: "Go to Home", exact: true }).click();
  // A document navigation restores the DPoP-bound session before Home can mount.
  await page.getByRole("heading", { level: 1, name: "Home", exact: true }).waitFor();
  await expect(page).toHaveURL(/\/home\/?$/);
  await accessible(page);
});

test("scenario 10: Bob's private file shows a real 403 to Alice in Drive", async ({ page }) => {
  // Bootstrap Drive before introducing an unreadable member of the pod. New-folder
  // admission deliberately stops if it cannot inspect the complete storage namespace.
  await page.goto("/drive");
  await expect(page.getByRole("heading", { name: "Your Drive is empty", exact: true })).toBeVisible(
    { timeout: 30_000 },
  );
  const alice = await accountAuth("alice");
  const bob = await accountAuth("bob");
  // Alice can authenticate within her verified storage boundary. Give Bob sole read access
  // to this resource there, so CSS returns authenticated denial rather than anonymous 401.
  const url = new URL(`alice/bob-private-${randomUUID()}.txt`, cssAccount("alice").issuer).href;
  const contents = "Bob's private shell test file";
  try {
    const created = await alice.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "If-None-Match": "*" },
      body: contents,
    });
    expect(created.status).toBe(201);
    const head = await alice.fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    const aclLink = head.headers.get("link")?.match(/<([^>]+)>;\s*rel="acl"/);
    expect(aclLink?.[1]).toBeTruthy();
    const aclUrl = new URL(aclLink?.[1] as string, url).href;
    const dataset = new Store();
    const owner = new Authorization(`${aclUrl}#owner`, dataset, DataFactory);
    const acl = "http://www.w3.org/ns/auth/acl#";
    owner.type.add(`${acl}Authorization`);
    owner.agent.add(cssAccount("bob").webId);
    owner.accessTo = url;
    for (const mode of ["Read", "Write", "Control"]) owner.mode.add(`${acl}${mode}`);
    // Alice retains management rights for cleanup, but no Read permission.
    const creator = new Authorization(`${aclUrl}#creator`, dataset, DataFactory);
    creator.type.add(`${acl}Authorization`);
    creator.agent.add(cssAccount("alice").webId);
    creator.accessTo = url;
    for (const mode of ["Write", "Control"]) creator.mode.add(`${acl}${mode}`);
    const writer = new Writer();
    writer.addQuads(dataset.getQuads(null, null, null, null));
    const body = await new Promise<string>((resolve, reject) =>
      writer.end((error, result) => (error ? reject(error) : resolve(result))),
    );
    const protectedFile = await alice.fetch(aclUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
      body,
    });
    expect(protectedFile.status).toBe(201);
    const anonymous = await fetch(url);
    expect([401, 403]).toContain(anonymous.status);
    await anonymous.body?.cancel();
    const ownerRead = await bob.fetch(url);
    expect(ownerRead.status).toBe(200);
    expect(await ownerRead.text()).toBe(contents);

    const denied = page.waitForResponse(
      (response) =>
        response.url() === url &&
        response.request().method() === "HEAD" &&
        // pod-auth first receives CSS's anonymous challenge, then sends its DPoP proof.
        response.status() !== 401,
    );
    await page.goto(`/drive/p/${encodeRef(url)}`);
    expect((await denied).status()).toBe(403);
    const alert = page.getByRole("alert").filter({ hasText: "You don't have access to this file" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Request access from the owner, then retry.");
    await expect(alert.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(page.getByText(contents, { exact: true })).toHaveCount(0);
    await accessible(page);
  } finally {
    expect((await alice.fetch(url, { method: "DELETE" })).ok).toBe(true);
    await Promise.all([alice.logout(), bob.logout()]);
  }
});

test("scenario 10: storage down shows Retry and recovers when CSS returns", async ({ page }) => {
  await page.goto("/drive");
  await expect(page.getByRole("heading", { name: "Your Drive is empty", exact: true })).toBeVisible(
    { timeout: 30_000 },
  );
  const origin = new URL(cssAccount("alice").issuer).origin;
  const blocked = `${origin}/**`;
  await page.route(blocked, (route) => route.abort("connectionrefused"));
  try {
    // Client navigation keeps the established session; the failed read is storage IO.
    if ((page.viewportSize()?.width ?? 1280) < 1024)
      await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
    await page.getByRole("link", { name: "Recent", exact: true }).filter({ visible: true }).click();
    if ((page.viewportSize()?.width ?? 1280) < 1024) {
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("dialog", { name: "Drive navigation", exact: true }),
      ).toBeHidden();
    }
    const alert = page.getByRole("alert").filter({ hasText: "The storage didn't respond" });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("heading", { name: "Can't open this folder" })).toBeVisible();
    await accessible(page);
    await page.unroute(blocked);
    const recovered = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${origin}/alice/`) &&
        response.request().method() === "GET" &&
        response.status() === 200,
    );
    await alert.getByRole("button", { name: "Retry", exact: true }).click();
    await recovered;
    await expect(
      page.getByRole("heading", { name: "Nothing recent yet", exact: true }),
    ).toBeVisible();
    await expect(alert).toHaveCount(0);
    await accessible(page);
  } finally {
    await page.unroute(blocked);
  }
});
