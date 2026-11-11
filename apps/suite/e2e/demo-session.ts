// AUTHORED-BY Claude Opus 5.5
import type { Page } from "@playwright/test";
import { DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/constants";

/**
 * Real app routes sit behind the shell's session guard, so fixture specs that deep-link into
 * Home or Drive start with the demo account remembered. The script only seeds an absent key:
 * a spec that clears storage or signs out keeps the state it chose.
 */
export async function seedDemoSession(page: Page) {
  const state = {
    accounts: [
      { id: "demo", webId: DEMO_WEBID, name: "Alice Wilder", storageUrl: DEMO_ROOT, kind: "demo" },
    ],
    activeId: "demo",
  };
  await page.addInitScript((value) => {
    try {
      if (localStorage.getItem("suite.accounts.v1") === null)
        localStorage.setItem("suite.accounts.v1", value);
    } catch {}
  }, JSON.stringify(state));
}
