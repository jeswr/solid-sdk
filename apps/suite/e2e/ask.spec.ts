// AUTHORED-BY Codex (GPT-6.1 Sol)
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("asks the demo pod, follows citations and handles scoped empty retrieval accessibly", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/ask") calls.push(request.url());
  });
  await page.goto("/ask");
  const question = page.getByRole("textbox", { name: "Your question", exact: true });
  await expect(question).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole("switch", { name: "Answer from my pod only (no AI)" })).toBeChecked();
  await question.fill("When does my passport expire?");
  await question.press("Enter");
  const answer = page.getByRole("region", { name: "Answer", exact: true });
  await expect(answer).toContainText("18 September 2028");
  const citation = answer.getByRole("link", { name: /Source \d+: Passport renewal/ });
  await expect(citation).toHaveAttribute("href", /^\/notes\/n\//);
  await page.getByText("Which data was used", { exact: true }).click();
  await expect(
    page.getByText("Nothing was sent to an AI provider.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open raw resource: Passport renewal/ }),
  ).toHaveAttribute("href", /ask-sample-passport\.ttl#it$/);
  await expect(
    page
      .getByRole("group", { name: "Search scope" })
      .getByRole("button", { name: "Notes", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Search scope" })
    .getByRole("button", { name: "Notes", exact: true })
    .click();
  await question.fill("What did I agree with Rowan about the garden?");
  await question.press("Enter");
  await expect(answer).toContainText("lavender");
  await question.fill("unicorn astrophysics");
  await question.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Nothing in your pod matches; try other words" }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Search scope" })
    .getByRole("button", { name: "All apps" })
    .click();
  await question.fill("passport");
  await question.press("Enter");
  await expect(answer).toContainText("2028");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(calls).toEqual([]);
  const destination = await citation.getAttribute("href");
  expect(destination).toBeTruthy();
  await citation.click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue(
    "Passport renewal",
  );
  await expect(page).toHaveURL(
    new RegExp((destination as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});
