// AUTHORED-BY Codex GPT-6
import { expect, test } from "@playwright/test";
import { seedDemoSession } from "./demo-session";

test("/share saves a native fixture file through Drive and deletes the batch after upload", async ({
  page,
}) => {
  await seedDemoSession(page);
  await page.addInitScript(() => {
    const fixtureState = {
      acknowledged: sessionStorage.getItem("suite.share.fixture.acked") === "1",
      reads: 0,
    };
    const bridge = {
      getPending: async () => ({
        batches: fixtureState.acknowledged
          ? []
          : [
              {
                id: "incoming-share-1",
                receivedAt: "2026-11-10T12:00:00Z",
                items: [
                  { kind: "file", name: "incoming-share.txt", mimeType: "text/plain", size: 17 },
                ],
              },
            ],
      }),
      readChunk: async ({ offset, length }: { offset: number; length: number }) => {
        fixtureState.reads += 1;
        const bytes = "From another app!".slice(offset, offset + length);
        return { data: btoa(bytes), eof: offset + bytes.length === 17 };
      },
      acknowledge: async () => {
        fixtureState.acknowledged = true;
        sessionStorage.setItem("suite.share.fixture.acked", "1");
      },
      addListener: async () => ({ remove: async () => {} }),
    };
    Object.assign(window, {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" },
      suiteShareIntakeFixture: bridge,
      shareFixtureState: fixtureState,
    });
  });
  await page.goto("/share");
  await expect(page.getByText("incoming-share.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("Save files in: My Drive", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { shareFixtureState: { reads: number } }).shareFixtureState.reads,
    ),
  ).toBe(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { shareFixtureState: { acknowledged: boolean } }).shareFixtureState
          .acknowledged,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Save to Drive", exact: true }).click();
  await expect(page.getByText("Nothing to save", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { shareFixtureState: { acknowledged: boolean } }).shareFixtureState
          .acknowledged,
    ),
  ).toBe(true);
  await page.goto("/drive/my");
  await expect(page.getByRole("heading", { name: "My Drive", exact: true })).toBeVisible();
  await expect(
    page.locator("tbody .drv-name").filter({ hasText: "incoming-share.txt" }),
  ).toHaveText("incoming-share.txt");
});
