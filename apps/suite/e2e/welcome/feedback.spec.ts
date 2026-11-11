// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";
import { createFeedbackHandlers } from "../../src/feedback/server";
import { createGithubStore } from "../../src/feedback/store";
import { feedbackGithub } from "../../test/helpers/feedback-github";

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
    expect(route.request().postDataJSON().submissionId).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
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
for (const outcome of ["success", "failure", "cooldown"] as const)
  test(`voice upload ${outcome}: keeps audio and submission identity`, async ({ page }) => {
    const fails = outcome !== "success";
    const limited = outcome === "cooldown";
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
    let submissionId = "";
    let releaseUploads = () => {};
    const allowUploads = new Promise<void>((resolve) => {
      releaseUploads = resolve;
    });
    await page.route("**/api/feedback/audio?*", async (route) => {
      uploads++;
      const id = new URL(route.request().url()).searchParams.get("submissionId");
      expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      if (submissionId) expect(id).toBe(submissionId);
      else submissionId = id ?? "";
      await allowUploads;
      expect(route.request().headers()["content-type"]).toBe("audio/webm");
      expect(route.request().postDataBuffer()?.length).toBe(12);
      if (limited) {
        await route.fulfill({
          status: 503,
          headers: { "Retry-After": "90" },
          json: { error: "RAW_AUDIO_ERROR" },
        });
      } else if (uploads === 1 || fails) {
        await route.fulfill({ status: 413, contentType: "text/plain", body: "RAW_AUDIO_ERROR" });
      } else {
        await route.fulfill({
          json: {
            submissionId,
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
      expect(route.request().postDataJSON().submissionId).toBe(submissionId);
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
        limited ? "try again later" : "couldn't save that recording",
      );
      await expect(page.getByRole("main")).not.toContainText("RAW_AUDIO_ERROR");
      expect(uploads).toBe(limited ? 1 : 2);
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

test("a GitHub cooldown asks the participant to try later and preserves their download", async ({
  page,
}) => {
  await page.route("**/api/feedback/turn", (route) => route.fulfill({ json: { hosted: false } }));
  let submits = 0;
  await page.route("**/api/feedback/submit", (route) => {
    submits++;
    return route.fulfill({
      status: 503,
      headers: { "Retry-After": "90" },
      json: { error: "RAW_GITHUB_ERROR" },
    });
  });
  await page.goto("/feedback");
  await page.getByRole("button", { name: "Just tell us", exact: true }).click();
  await page.getByLabel("Your answer", { exact: true }).fill("Alice found the demo confusing.");
  await page.getByRole("button", { name: "Submit what I've said so far", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("try again later");
  await expect(page.getByRole("main")).not.toContainText("RAW_GITHUB_ERROR");
  expect(submits).toBe(1);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my feedback" }).click();
  const path = await (await downloading).path();
  if (!path) throw new Error("Feedback download is unavailable.");
  const { readFile } = await import("node:fs/promises");
  const { unzipSync } = await import("fflate");
  const archive = unzipSync(await readFile(path));
  expect(new TextDecoder().decode(archive["submission.json"])).toContain(
    "Alice found the demo confusing.",
  );
});

for (const outcome of ["lost response", "low final budget"] as const)
  test(`GitHub ${outcome} preserves one submission and its reference`, async ({ page }) => {
    const github = feedbackGithub();
    const env = { FEEDBACK_GITHUB_TOKEN: "secret", FEEDBACK_GITHUB_REPO: "private/feedback" };
    let submits = 0;
    let submissionId = "";
    if (outcome === "lost response") github.loseIssueResponse();
    else github.lowBudget();
    await page.route("**/api/feedback/turn", (route) => route.fulfill({ json: { hosted: false } }));
    await page.route("**/api/feedback/submit", async (route) => {
      const payload = route.request().postDataJSON();
      if (submissionId) expect(payload.submissionId).toBe(submissionId);
      submissionId = payload.submissionId;
      submits++;
      // Exercise the real handlers/store over an injected GitHub transport.
      const handlers = createFeedbackHandlers({
        env,
        store: createGithubStore(env, github.transport),
        limiter: () => undefined,
      });
      const response = await handlers.submit(
        new Request(route.request().url(), {
          method: "POST",
          headers: {
            Origin: new URL(route.request().url()).origin,
            "Content-Type": "application/json",
          },
          body: route.request().postData(),
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });
    await page.goto("/feedback");
    await page.getByRole("button", { name: "Just tell us", exact: true }).click();
    await page.getByLabel("Your answer", { exact: true }).fill("Alice found the demo confusing.");
    await page.getByRole("button", { name: "Submit what I've said so far", exact: true }).click();
    if (outcome === "lost response") {
      await expect(page.getByRole("main").getByRole("alert")).toContainText("Download my feedback");
      await page.getByRole("button", { name: "Submit what I've said so far", exact: true }).click();
    }
    await expect(page.getByRole("status").filter({ hasText: "Thanks" })).toContainText(`#${123}`);
    expect(submits).toBe(outcome === "lost response" ? 2 : 1);
    expect(github.records).toHaveLength(1);
    expect(github.records[0]?.record.id).toBe(submissionId);
    expect(github.issues).toHaveLength(1);
  });
