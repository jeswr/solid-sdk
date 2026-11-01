// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { LiteralFrom, NamedNodeFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { CSS_BASE, handleLoginPopups, signIn } from "./helpers";
import { seededAccounts } from "./seeded-accounts";

const AS = "https://www.w3.org/ns/activitystreams#";

/** Typed RDF fixture independent of the browser bundle and its auth runtime. */
class AnnounceFixture extends TermWrapper {
  set activityType(value: string) {
    OptionalAs.object(this, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", value, NamedNodeFrom.string);
  }
  set actor(value: string) {
    OptionalAs.object(this, `${AS}actor`, value, NamedNodeFrom.string);
  }
  set target(value: string) {
    OptionalAs.object(this, `${AS}target`, value, NamedNodeFrom.string);
  }
  set issue(value: string) {
    OptionalAs.object(this, `${AS}object`, value, NamedNodeFrom.string);
  }
  set summary(value: string) {
    OptionalAs.object(this, `${AS}summary`, value, LiteralFrom.string);
  }
  set published(value: Date) {
    OptionalAs.object(this, `${AS}published`, value, LiteralFrom.dateTime);
  }
}

function announceTurtle(actor: string, target: string, issue: string, summary: string): Promise<string> {
  const dataset = new Store();
  // The receiving CSS resolves <> to its minted notification URL.
  const activity = new AnnounceFixture("", dataset, DataFactory);
  activity.activityType = `${AS}Announce`;
  activity.actor = actor;
  activity.target = target;
  activity.issue = issue;
  activity.summary = summary;
  activity.published = new Date();
  const writer = new Writer({ format: "text/turtle" });
  for (const quad of dataset) writer.addQuad(quad);
  return new Promise((resolve, reject) =>
    writer.end((error, turtle) => (error ? reject(error) : resolve(turtle))),
  );
}

test("shows an as:Announce POSTed into Alice's advertised inbox", async ({ browser, context, page }) => {
  const { alice, bob } = seededAccounts();
  handleLoginPopups(context, bob.email, bob.password);
  await signIn(page, bob.webId);
  const summary = `Local LDN announcement ${randomUUID()}`;
  const objectIri = new URL(`announced-${randomUUID()}.ttl`, alice.podRoot).href;
  const body = await announceTurtle(bob.webId, alice.webId, objectIri, summary);
  const posted = await page.evaluate(async ({ inboxUrl, body }) => {
    // Plain fetch uses the app's authenticated DPoP session as Bob (Append only).
    const response = await fetch(inboxUrl, {
      method: "POST", headers: { "content-type": "text/turtle" }, body,
    });
    return { status: response.status, location: response.headers.get("location") };
  }, { inboxUrl: alice.inboxUrl, body });
  expect(posted.status).toBe(201);
  expect(posted.location).toBeTruthy();
  expect(new URL(posted.location!, alice.inboxUrl).href.startsWith(alice.inboxUrl)).toBe(true);

  const aliceContext = await browser.newContext();
  try {
    handleLoginPopups(aliceContext, alice.email, alice.password);
    const alicePage = await aliceContext.newPage();
    await signIn(alicePage, alice.webId);
    await alicePage.getByRole("tab", { name: "Inbox view", exact: true }).click();
    const inbox = alicePage.getByRole("region", { name: "Notifications inbox" });
    const notification = inbox.getByRole("listitem").filter({ hasText: summary });
    await expect(notification).toBeVisible();
    await expect(notification.getByText("announced", { exact: true })).toBeVisible();
    await expect(notification.getByRole("link")).toHaveAttribute("href", objectIri);
    await expect(notification.locator("[title]").filter({ hasText: "From" })).toHaveAttribute("title", bob.webId);
  } finally {
    await aliceContext.close();
  }
});

test("assigning an issue in the UI delivers an Announce to Bob's inbox", async ({ browser, context, page }) => {
  test.setTimeout(180_000);
  const { alice, bob } = seededAccounts();
  handleLoginPopups(context, alice.email, alice.password);
  await signIn(page, alice.webId);
  const bobContext = await browser.newContext();
  try {
    handleLoginPopups(bobContext, bob.email, bob.password);
    const bobPage = await bobContext.newPage();
    await signIn(bobPage, bob.webId);
    await bobPage.getByRole("tab", { name: "Inbox view", exact: true }).click();
    const inbox = bobPage.getByRole("region", { name: "Notifications inbox" });
    await expect(inbox.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();

    const title = `Assigned via UI ${randomUUID()}`;
    const summary = `You were assigned to "${title}"`;
    await expect(inbox.getByText(summary, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill(title);
    await page.getByLabel(/assignee \(webid or group\)/i).fill(bob.webId);
    const created = page.waitForResponse((response) =>
      response.status() !== 401 &&
      response.request().method() === "PUT" && response.url().startsWith(alice.podRoot) &&
      /\/issues\/[^/]+\.ttl$/.test(response.url()),
    );
    const delivered = page.waitForResponse((response) =>
      response.status() !== 401 && response.request().method() === "POST" && response.url() === bob.inboxUrl,
    );
    await page.getByRole("button", { name: /create issue/i }).click();
    const issue = await created;
    expect(issue.ok()).toBe(true);
    const notificationPost = await delivered;
    expect(notificationPost.status()).toBe(201);
    expect(new URL(notificationPost.url()).origin).toBe(CSS_BASE);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Inbox is manually refreshed by design; this is not a live-board assertion.
    await inbox.getByRole("button", { name: "Refresh", exact: true }).click();
    const notification = inbox.getByRole("listitem").filter({ hasText: summary });
    await expect(notification).toBeVisible();
    await expect(notification.getByText("announced", { exact: true })).toBeVisible();
    await expect(notification.getByRole("link")).toHaveAttribute("href", issue.url());
    await expect(notification.locator("[title]").filter({ hasText: "From" })).toHaveAttribute("title", alice.webId);
  } finally {
    await bobContext.close();
  }
});
