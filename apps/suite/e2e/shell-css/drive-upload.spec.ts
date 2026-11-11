// AUTHORED-BY Claude Opus 5.5
// sst-2vvz: Community Solid Server answers both the empty placeholder PUT (201) and the
// content PUT (205) without an ETag. A Drive upload must still finish against it.
import { expect, test } from "./fixtures";

test("Drive uploads a file to a real Community Solid Server pod", async ({ page }, testInfo) => {
  // Projects share one CSS account, so each uploads its own file.
  const name = `upload-${testInfo.project.name}.txt`;
  await page.goto("/drive");
  await expect(page.getByRole("heading", { level: 2, name: "My Drive", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  // Wait for a real listing (empty or not) before uploading into it.
  await expect(
    page
      .getByRole("grid", { name: "My Drive", exact: true })
      .or(page.getByRole("heading", { name: "Your Drive is empty", exact: true })),
  ).toBeVisible({ timeout: 30_000 });
  const puts: { status: number; ifMatch?: string | undefined; etag?: string | undefined }[] = [];
  page.on("response", async (response) => {
    const request = response.request();
    if (request.method() !== "PUT" || !request.url().endsWith(`/${name}`)) return;
    // The session retries each request after an unauthenticated 401; count the real ones.
    if (response.status() === 401) return;
    puts.push({
      status: response.status(),
      ifMatch: (await request.allHeaders())["if-match"],
      etag: response.headers().etag,
    });
  });
  await page.getByTestId("drive-upload-input").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from("Meeting notes"),
  });
  const dock = page.getByRole("region", { name: "Uploads", exact: true });
  await expect(dock.getByRole("heading", { name: "1 upload complete", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  // The server gives no validator on either PUT; the bytes still go in conditionally.
  await expect.poll(() => puts.length).toBe(2);
  expect(puts[0]).toMatchObject({ status: 201, ifMatch: undefined, etag: undefined });
  expect(puts[1]?.status).toBeLessThan(300);
  expect(puts[1]?.ifMatch).toMatch(/^"/);
  expect(puts[1]?.etag).toBeUndefined();
  await page.reload();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
});
