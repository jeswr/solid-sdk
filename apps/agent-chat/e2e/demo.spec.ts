// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { expect, type Locator, type Page, test } from "@playwright/test";

async function holdUntil(page: Page, name: RegExp, ready: Locator) {
  const button = page.getByRole("button", { name }).last();
  await button.focus();
  await page.keyboard.down("Space");
  try {
    await expect(ready).toBeVisible();
  } finally {
    await page.keyboard.up("Space");
  }
}

async function confirmDemo(page: Page) {
  const verification = page.getByRole("dialog", { name: "Confirm it is you" });
  await expect(verification.getByText("Demo: Face ID simulated")).toBeVisible();
  await verification.getByRole("button", { name: "Confirm simulated Face ID" }).click();
}

async function send(page: Page, text: string) {
  const box = page.getByRole("textbox").first();
  await box.fill(text);
  await box.press("Enter");
}

test("shopping: blocked upsell, set a limit, buy inside it, ask when over it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "Find me running sneakers under $25" }).first().click();
  await page.getByRole("button", { name: "Choose" }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Buy Roadrunner Lite for $20?" })).toBeVisible();
  await expect(page.getByText("I ignored an instruction that was not from you")).toBeVisible();
  await sheet.getByRole("button", { name: "Set a spending limit" }).click();
  await expect(
    sheet.getByText(/can spend up to \$100 a month at Stride & Co without asking/),
  ).toBeVisible();
  await holdUntil(page, /Hold to set limit/, page.getByText(/This demo signs fictional approvals/));
  await confirmDemo(page);
  await expect(page.getByText(/New rule: up to \$100\/month at Stride & Co/)).toBeVisible();
  await send(page, "Reorder my usual socks");
  await expect(page.locator(".limit-chip").last()).toContainText("$32 of $100");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await send(page, "Get the Stormshell jacket too");
  await expect(
    page.getByRole("heading", { name: /This goes over your \$100 a month at Stride & Co by \$17/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).last().click();
  await expect(page.getByText(/Nothing was charged/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("mortgage: share only what is needed, face check, signed decision", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "Get a mortgage decision in principle" }).first().click();
  await page.getByRole("button", { name: "Go with North Bank" }).click();
  await expect(
    page.getByRole("heading", { name: "Share 3 things with North Bank?" }),
  ).toBeVisible();
  await expect(page.getByText("3 years of bank transactions")).toBeVisible();
  await holdUntil(page, /^Share 3/, page.getByText(/This demo signs fictional approvals/));
  await confirmDemo(page);
  await expect(
    page.getByRole("heading", { name: /Harbour Bank needs a face check/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start face check" }).click();
  await confirmDemo(page);
  await expect(page.getByText("up to $285,000")).toBeVisible({ timeout: 20_000 });
});

test("stop cancels a pending approval", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Find me running sneakers under $25" }).first().click();
  await page.getByRole("button", { name: "Choose" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator(".topbar").getByRole("button", { name: /^Stop/ }).click();
  await expect(page.getByText(/Cancelled by stop/)).toBeVisible();
});

async function virtualPasskey(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

test("platform WebAuthn registers and asserts before signing the selected terms", async ({
  page,
}) => {
  const { cdp, authenticatorId } = await virtualPasskey(page);
  await page.goto("/");
  await send(page, "buy socks");
  await page.getByRole("button", { name: "Set a spending limit" }).click();
  await page.getByLabel("Up to, per month").fill("43");
  await holdUntil(page, /Hold to set limit/, page.getByText(/New rule: up to \$43/));
  await expect(page.locator(".receipt-head")).toHaveCount(1);
  const registered = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(registered.credentials).toHaveLength(1);

  await send(page, "buy jacket");
  await holdUntil(page, /Just this once/, page.locator(".receipt-head").nth(1));
  await expect(page.locator(".receipt-head")).toHaveCount(2);
  const asserted = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(asserted.credentials).toHaveLength(1);
  expect(asserted.credentials[0]?.credentialId).toBe(registered.credentials[0]?.credentialId);
  expect(asserted.credentials[0]?.signCount).toBeGreaterThan(
    registered.credentials[0]?.signCount ?? 0,
  );
  await expect(page.getByText("Demo: Face ID simulated")).toHaveCount(0);
});

test("cancelled platform verification leaves the edited terms unsigned and restores the controls", async ({
  page,
}) => {
  const { cdp, authenticatorId } = await virtualPasskey(page);
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false });
  await page.goto("/");
  await send(page, "buy socks");
  await page.getByRole("button", { name: "Set a spending limit" }).click();
  const amount = page.locator("#amount");
  await amount.fill("43");
  await holdUntil(
    page,
    /Hold to set limit/,
    page.getByText("Confirm with Face ID", { exact: true }),
  );
  await expect(amount).toBeDisabled();
  await expect(page.locator(".receipt-head")).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel verification" }).click();
  await expect(page.getByRole("alert")).toContainText("Nothing was approved");
  await expect(amount).toBeEnabled();
  await expect(amount).toHaveValue("43");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByText(/Nothing was charged/)).toBeVisible();
  await expect(page.locator(".receipt-head, .rule-change")).toHaveCount(0);
  expect((await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials).toHaveLength(
    0,
  );
});

test("a denied frame policy fails closed and the explorer demo requires opt-in", async ({
  page,
}) => {
  await virtualPasskey(page);
  await page.route("**/explorer-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: {
        "Permissions-Policy": "publickey-credentials-create=(), publickey-credentials-get=()",
      },
      body: '<iframe title="Errand demo" src="/app/" style="width:100%;height:95vh"></iframe>',
    }),
  );
  await page.goto("/explorer-test");
  const frame = page.frameLocator("iframe");
  const box = frame.getByRole("textbox").first();
  await box.fill("buy socks");
  await box.press("Enter");
  await frame.getByRole("button", { name: "Approve once" }).click();
  await expect(frame.getByRole("alert")).toContainText("without passkey permission");
  await expect(frame.locator(".receipt-head")).toHaveCount(0);
  await expect(frame.getByText("Demo: Face ID simulated")).toHaveCount(0);

  await frame.getByRole("link", { name: "Try with simulated Face ID" }).click();
  await expect(frame.getByText("Demo: Face ID simulated")).toBeVisible();
  await box.fill("buy socks");
  await box.press("Enter");
  await frame.getByRole("button", { name: "Approve once" }).click();
  const prompt = frame.getByRole("dialog", { name: "Confirm it is you" });
  await expect(prompt.getByText("Demo: Face ID simulated")).toBeVisible();
  await expect(frame.locator(".receipt-head")).toHaveCount(0);
  await prompt.getByRole("button", { name: "Confirm simulated Face ID" }).click();
  await expect(frame.locator(".receipt-head")).toHaveCount(1);
});
