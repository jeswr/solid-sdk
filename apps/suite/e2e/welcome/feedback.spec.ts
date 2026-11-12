// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";

test("guided feedback includes Agent and its debrief", async ({ page }) => {
  await page.route("**/api/feedback/turn", (route) => route.fulfill({ json: { hosted: false } }));
  await page.goto("/feedback");
  await page.getByRole("button", { name: "Guided interview", exact: true }).click();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Skip", exact: true }).click();
  const agent = page.getByRole("button", { name: "Agent", exact: true });
  await agent.click();
  await expect(agent).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continue with these apps", exact: true }).click();
  await page.getByRole("button", { name: "Demo pod", exact: true }).click();
  await expect(
    page
      .getByText("Thinking back to Agent, tell me what you did first, and then what.", {
        exact: true,
      })
      .last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(
    page.getByRole("group", {
      name: "Overall, how easy or difficult was what you tried in Agent?",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "6 out of 7", exact: true }).click();
  await expect(page.getByLabel("Your answer", { exact: true })).toBeVisible();
});

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
test("unhosted quick feedback offers a ZIP after a platform rejects submission", async ({
  page,
}) => {
  await page.route("**/api/feedback/turn", (route) => route.fulfill({ json: { hosted: false } }));
  await page.route("**/api/feedback/submit", (route) =>
    route.fulfill({
      status: 413,
      contentType: "text/plain",
      body: "RAW_PLATFORM_ERROR",
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Download my feedback");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my feedback" }).click();
  expect((await downloading).suggestedFilename()).toBe("solid-suite-feedback.zip");
});
for (const fails of [false, true])
  test(`voice upload ${fails ? "failure keeps raw audio for download" : "retries and submits a receipt"}`, async ({
    page,
  }) => {
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
    let uploads = 0;
    let releaseUploads = () => {};
    const allowUploads = new Promise<void>((resolve) => {
      releaseUploads = resolve;
    });
    await page.route("**/api/feedback/audio", async (route) => {
      uploads++;
      await allowUploads;
      expect(route.request().headers()["content-type"]).toBe("audio/webm");
      expect(route.request().postDataBuffer()?.length).toBe(12);
      if (uploads === 1 || fails) {
        await route.fulfill({ status: 413, contentType: "text/plain", body: "RAW_AUDIO_ERROR" });
      } else {
        await route.fulfill({
          json: {
            sha: "a".repeat(40),
            size: 12,
            ext: "webm",
            sig: `${Date.now() + 7200000}.${"b".repeat(64)}`,
          },
        });
      }
    });
    await page.route("**/api/feedback/submit", async (route) => {
      const body = route.request().postData() ?? "";
      expect(body).toContain('"audio":[0]');
      expect(body).toContain("voice answer recorded; no transcript");
      expect(route.request().headers()["content-type"]).toBe("application/json");
      expect(route.request().postDataJSON().receipts).toEqual([
        expect.objectContaining({ sha: "a".repeat(40), size: 12, ext: "webm" }),
      ]);
      await route.fulfill({ json: { reference: 13 } });
    });
    await page.goto("/feedback");
    await page.getByRole("button", { name: "Just tell us", exact: true }).click();
    await page.getByRole("button", { name: "Speak your answer", exact: true }).click();
    await page.getByRole("button", { name: "Stop recording", exact: true }).click();
    await expect(page.getByText("Your recording will be attached", { exact: false })).toBeVisible();
    await expect(page.getByText("Saving recording...", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit what I've said so far", exact: true }),
    ).toBeDisabled();
    releaseUploads();
    if (fails) {
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "couldn't save that recording",
      );
      await expect(page.getByRole("main")).not.toContainText("RAW_AUDIO_ERROR");
      expect(uploads).toBe(2);
      const downloading = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download my feedback" }).click();
      const path = await (await downloading).path();
      const { readFile } = await import("node:fs/promises");
      const { unzipSync } = await import("fflate");
      if (!path) throw new Error("Feedback download is unavailable.");
      const archive = unzipSync(await readFile(path));
      expect(archive["audio-1.webm"]).toHaveLength(12);
      return;
    }
    await expect(page.getByText("Saving recording...", { exact: true })).not.toBeVisible();
    expect(uploads).toBe(2);
    await page.getByRole("button", { name: "Send answer", exact: true }).click();
    await page.getByRole("button", { name: "Submit what I've said so far", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Thanks" })).toContainText("#13");
  });

test("non-JSON turn failures and unsafe submit errors produce only friendly messages", async ({
  page,
}) => {
  await page.route("**/api/feedback/turn", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { hosted: true } })
      : route.fulfill({ status: 502, contentType: "text/html", body: "RAW_TURN_ERROR" }),
  );
  let submits = 0;
  await page.route("**/api/feedback/submit", (route) => {
    submits++;
    return submits === 1
      ? route.fulfill({ status: 502, json: { error: "RAW_SUBMIT_ERROR" } })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "malformed JSON RAW_PARSE_ERROR",
        });
  });
  await page.goto("/feedback");
  await page.getByRole("button", { name: "Just tell us", exact: true }).click();
  await page.getByLabel("Your answer", { exact: true }).fill("Sorting confused me.");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Your answer has been kept",
  );
  await expect(page.getByRole("main")).not.toContainText("RAW_TURN_ERROR");
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Submit what I've said so far", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Download my feedback");
    await expect(page.getByRole("main")).not.toContainText("RAW_SUBMIT_ERROR");
    await expect(page.getByRole("main")).not.toContainText("RAW_PARSE_ERROR");
  }
});
