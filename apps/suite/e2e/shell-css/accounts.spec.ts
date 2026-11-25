// AUTHORED-BY Codex GPT-6.1-Sol
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import { LiteralFrom, RequiredAs, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Writer } from "n3";
import { encodeRef } from "../../src/lib/refs";
import {
  type AccountName,
  accessible,
  accountAuth,
  cssAccount,
  expect,
  signIn,
  signedOutTest as test,
} from "./fixtures";

test.beforeAll(async ({ request }) => {
  expect((await request.get("/home/documents")).status()).toBe(200);
});

test("scenario 5: adding Bob is refused without losing Alice; sequential sign-ins isolate Drive and Home", async ({
  page,
}) => {
  // Two OIDC logins plus account-scoped Drive/Home reloads and axe checks.
  test.setTimeout(180_000);
  const issuer = cssAccount("alice").issuer;
  const auth = { alice: await accountAuth("alice", issuer), bob: await accountAuth("bob", issuer) };
  const nonce = randomUUID();
  const item = (name: AccountName) => ({
    root: new URL(`${name}/`, issuer).href,
    file: new URL(`${name}/drive/${name}-${nonce}.txt`, issuer).href,
    fileName: `${name}-${nonce}.txt`,
    note: new URL(`${name}/notes/${name}-${nonce}.ttl`, issuer).href,
    title: `${cssAccount(name).name}'s private note ${nonce}`,
  });
  const fixture = { alice: item("alice"), bob: item("bob") };
  try {
    // Reuse Home's existing template, parser and wrapper setters; no handwritten RDF model.
    const template = await readFile(
      new URL("../../src/apps/home/lib/templates/TextDigitalDocument.ttl", import.meta.url),
      "utf8",
    );
    for (const name of ["alice", "bob"] as const) {
      const own = fixture[name];
      const dataset = await parseRdf(template, "text/turtle", { baseIRI: own.note });
      RequiredAs.object(
        new TermWrapper(`${own.note}#it`, dataset, DataFactory),
        "https://schema.org/name",
        own.title,
        LiteralFrom.string,
      );
      const writer = new Writer();
      writer.addQuads([...dataset]);
      const turtle = await new Promise<string>((resolve, reject) =>
        writer.end((error, result) => (error ? reject(error) : resolve(result))),
      );
      for (const [url, body, contentType] of [
        [own.file, `${name}'s private Drive bytes`, "text/plain"],
        [own.note, turtle, "text/turtle"],
      ] as const) {
        const created = await auth[name].fetch(url, {
          method: "PUT",
          headers: { "Content-Type": contentType, "If-None-Match": "*" },
          body,
        });
        expect(created.status).toBe(201);
        const anonymous = await fetch(url, { redirect: "error" });
        expect(anonymous.status).toBe(401);
        await anonymous.body?.cancel();
        const other = await auth[name === "alice" ? "bob" : "alice"].fetch(url);
        expect(other.status).toBe(403);
        await other.body?.cancel();
      }
    }

    const isolated = async (name: AccountName) => {
      const own = fixture[name];
      const other = fixture[name === "alice" ? "bob" : "alice"];
      await page.goto("/drive");
      const row = page.locator("tr[data-url]").filter({
        has: page.getByText(own.fileName, { exact: true }),
      });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row).toHaveAttribute("data-url", own.file);
      await expect(page.getByText(other.fileName, { exact: true })).toHaveCount(0);
      const urls = await page
        .locator("tr[data-url]")
        .evaluateAll((rows) => rows.map((element) => element.getAttribute("data-url")));
      expect(urls.every((url) => url?.startsWith(own.root))).toBe(true);
      await accessible(page);
      await page.goto("/home/documents");
      const card = page.getByRole("link").filter({ hasText: own.title });
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toHaveAttribute("href", `/home/documents/i/${encodeRef(own.note)}`);
      await expect(page.getByText(other.title, { exact: true })).toHaveCount(0);
      await expect(
        page
          .getByRole("button", {
            name: `Account: ${cssAccount(name).name}`,
            exact: true,
          })
          .filter({ visible: true }),
      ).toBeVisible();
      await accessible(page);
    };
    await signIn(page, "alice");
    await isolated("alice");
    await page
      .getByRole("button", { name: "Account: Alice", exact: true })
      .filter({ visible: true })
      .click();
    await page.getByRole("link", { name: "Add another account", exact: true }).click();
    await expect(page).toHaveURL(/\/signin\?add=1&next=/);
    await expect(page.getByRole("status").filter({ hasText: "Adding another account" })).toHaveText(
      "Adding another account — you stay signed in as Alice.",
      { timeout: 30_000 },
    );
    await page.getByRole("textbox", { name: "WebID", exact: true }).fill(cssAccount("bob").webId);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(
      "Sign out of your current Solid account before signing in to another account.",
    );
    await accessible(page);
    // SolidBackend.signIn rejects account-active before a second grant is issued.
    // Prove the refused addition left Alice's real session and data usable.
    await isolated("alice");
    await page
      .getByRole("button", { name: "Account: Alice", exact: true })
      .filter({ visible: true })
      .click();
    await expect(page.getByRole("region", { name: "Switch account", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/welcome\/?$/);
    await accessible(page);
    // The provider's browser cookies outlive local logout; explicitly log in as Bob.
    await signIn(page, "bob");
    await isolated("bob");
    await page.reload();
    await expect(page.getByRole("link", { name: fixture.bob.title, exact: true })).toBeVisible();
    await expect(page.getByText(fixture.alice.title, { exact: true })).toHaveCount(0);
    await accessible(page);
    await page
      .getByRole("button", { name: "Account: Bob", exact: true })
      .filter({ visible: true })
      .click();
    await page.getByRole("button", { name: "Sign out of all accounts", exact: true }).click();
    await expect(page).toHaveURL(/\/welcome\/?$/);
    await accessible(page);
  } finally {
    // The disposable CSS server cleans these fixtures without cross-project delete races.
    await Promise.all([auth.alice.logout(), auth.bob.logout()]);
  }
});

// Gap: pod-auth remembers one active Solid grant; SolidBackend.signIn rejects
// account-active. These simultaneous-session acceptance steps cannot run through the UI.
test.fixme("scenario 5: switch Alice/Bob with isolated data and keep Bob signed in when Alice signs out", async () => {});
test.fixme("scenario 5: switching to Bob preserves Alice's shared-folder deep link", async () => {});
