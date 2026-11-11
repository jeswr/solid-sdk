// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";

test("guided interview taps a scale, confirms read-back and submits", async ({ page }) => {
  let count = 0;
  await page.addInitScript(() =>
    localStorage.setItem("suite.walkthrough.v1", JSON.stringify({ done: ["drive"] })),
  );
  await page.route("**/api/feedback/turn", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { hosted: true } });
      return;
    }
    const body = route.request().postDataJSON();
    count++;
    if (count === 1)
      await route.fulfill({
        json: {
          reply: "Overall, how easy or difficult was Drive?",
          answers: { ...body.answers, apps: ["drive"] },
          question: {
            id: "seq_drive",
            type: "scale",
            max: 7,
            stage: 2,
            text: "Overall, how easy or difficult was Drive?",
            minLabel: "Very difficult",
            maxLabel: "Very easy",
          },
          done: false,
        },
      });
    else if (count === 2) {
      expect(body.answers.seq_drive).toBe(6);
      await route.fulfill({
        json: {
          reply: "• You use files.\n• Drive felt good.\n• You rated it 6.\nDid I get that right?",
          answers: { ...body.answers, summary: "Drive felt good" },
          question: {
            id: "confirmed",
            type: "choice",
            stage: 7,
            text: "Did I get that right?",
            options: [{ value: "yes", label: "Yes, that's right" }],
          },
          done: false,
        },
      });
    } else
      await route.fulfill({
        json: { reply: "Thank you. Ready to submit.", answers: { ...body.answers }, done: true },
      });
  });
  await page.route("**/api/feedback/submit", async (route) => {
    const body = route.request().postData() ?? "";
    expect(body).toContain('"seq_drive":6');
    expect(body).toContain('"walkthrough":["drive"]');
    expect(body).toContain('"confirmed":"yes"');
    await route.fulfill({ json: { reference: 12 } });
  });
  await page.goto("/feedback");
  await expect(page.getByRole("heading", { name: "Give feedback" })).toBeVisible();
  await page.getByRole("button", { name: "Guided interview", exact: true }).click();
  await page.getByLabel("Your answer", { exact: true }).fill("I use files");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await page.getByRole("button", { name: "6 out of 7" }).click();
  await page.getByRole("button", { name: "Yes, that's right", exact: true }).click();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Thanks, your reference is #12");
});
test("unhosted quick feedback offers a ZIP after storage is unavailable", async ({ page }) => {
  await page.route("**/api/feedback/turn", (route) => route.fulfill({ json: { hosted: false } }));
  await page.route("**/api/feedback/submit", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Storage isn't switched on yet. Download your feedback." },
    }),
  );
  await page.goto("/feedback");
  await expect(
    page.getByText("The interviewer isn't switched on yet", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Just tell us", exact: true }).click();
  await page.getByLabel("Your answer", { exact: true }).fill("Drive sorting confused me.");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await page.getByRole("button", { name: "Yes, that's right", exact: true }).click();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Download your feedback");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my feedback" }).click();
  expect((await downloading).suggestedFilename()).toBe("solid-suite-feedback.zip");
});
test("voice without dictation is attached to its turn and included on submit", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: undefined,
    });
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable?: (e: { data: Blob }) => void;
      onstop?: () => void;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])], {
            type: "audio/webm",
          }),
        });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
  });
  await page.route("**/api/feedback/turn", (route) => route.fulfill({ json: { hosted: false } }));
  await page.route("**/api/feedback/submit", async (route) => {
    const body = route.request().postData() ?? "";
    expect(body).toContain('"audio":[0]');
    expect(body).toContain("voice answer recorded; no transcript");
    expect(body).toContain('name="audio"');
    await route.fulfill({ json: { reference: 13 } });
  });
  await page.goto("/feedback");
  await page.getByRole("button", { name: "Just tell us", exact: true }).click();
  await page.getByRole("button", { name: "Speak your answer", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await expect(page.getByText("Your recording will be attached", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await page.getByRole("button", { name: "Submit what I've said so far", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Thanks" })).toContainText("#13");
});
