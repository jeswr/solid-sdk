// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { chromium, expect, type FullConfig } from "@playwright/test";

export default async function warmShell(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("The live CSS harness requires a suite baseURL");
  // HTTP loopback authentication needs next dev. Compile the routes before browser
  // assertions start so cold webpack work cannot hide a completed popup sign-in.
  // One worker warms feature-specific routes in beforeAll, before signing in.
  // Keep this common set small enough for the local CSS/Chromium memory budget.
  for (const path of [
    "/welcome",
    "/home",
    "/home/documents",
    "/drive",
    "/drive/search?q=warm",
    "/signin",
  ]) {
    const response = await fetch(new URL(path, baseURL), {
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status !== 200) throw new Error(`Cannot warm ${path}: HTTP ${response.status}`);
    await response.text();
  }
  // HTTP warming does not run SignIn's client-side shell preload. Finish that
  // compilation in a throwaway browser before an OIDC popup can be interrupted
  // by the resulting Fast Refresh. No test session or credentials are injected.
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(new URL("/signin", baseURL).href, { timeout: 120_000 });
    await expect(page.getByRole("button", { name: "Other provider", exact: true })).toBeEnabled({
      timeout: 60_000,
    });
    // This wait is only for the dev compiler/prefetch queue, not test assertions.
    await page.waitForLoadState("networkidle", { timeout: 120_000 });
  } finally {
    await browser.close();
  }
}
