// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";
import {
  loadedRecords,
  readControl,
  readHeartbeat,
  readOutbox,
} from "../../src/apps/agent/lib/readers";
import { createAgentVerifier } from "../../src/apps/agent/lib/verify";
import { DEMO_WEBID } from "../../src/lib/demo-pod/constants";
import { daemonDouble } from "./daemon-double";
import { setupAgentKey } from "./helpers";

test("settings and status menu stop every queued action; Resume confirms, signs, and returns focus", async ({
  page,
}) => {
  await setupAgentKey(page);
  const daemon = daemonDouble(page);
  const verifier = createAgentVerifier({ fetch: daemon.fetch, webId: DEMO_WEBID });
  const proposals = await Promise.all([
    daemon.propose("kill-first"),
    daemon.propose("kill-second"),
  ]);
  const stop = page.getByRole("button", { name: "Stop the agent", exact: true });
  await stop.click();
  let dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Stop the agent", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Agent status: Stopped", exact: true }),
  ).toBeVisible();
  expect(loadedRecords(await readControl(daemon.client, verifier))).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "Halt", verification: "verified" })]),
  );
  for (const proposal of proposals) expect(await daemon.tick(proposal)).toBe("halted");
  for (const proposal of proposals) {
    const transmission = loadedRecords(await readOutbox(daemon.client)).find(
      (t) => t.proposal === proposal.id,
    );
    expect(transmission?.status).toBe("refused");
    expect(transmission?.externalId).toBeUndefined();
  }

  const resume = page.getByRole("button", { name: "Resume", exact: true });
  await resume.click();
  dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Resume", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(resume).toBeFocused();
  expect(
    loadedRecords(await readControl(daemon.client, verifier)).filter(
      (c) => c.kind === "Resume" && c.verification === "verified",
    ),
  ).toHaveLength(0);
  await resume.click();
  await dialog.getByRole("textbox", { name: "Type RESUME to confirm", exact: true }).fill("RESUME");
  await dialog.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(stop).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Agent status: Agent running", exact: true }),
  ).toBeVisible();
  expect(loadedRecords(await readControl(daemon.client, verifier))).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "Resume", verification: "verified" })]),
  );
  await page.getByRole("button", { name: "Agent status: Agent running", exact: true }).click();
  await page.getByRole("menuitem", { name: "Stop the agent", exact: true }).click();
  await dialog.getByRole("button", { name: "Stop the agent", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Agent status: Stopped", exact: true }),
  ).toBeVisible();
  const first = proposals[0];
  await expect(
    page.getByRole("button", { name: "Agent status: Stopped", exact: true }),
  ).toBeFocused();
  if (!first) throw new Error("Missing proposal fixture");
  expect(await daemon.tick(first)).toBe("halted");
});

test("the labelled demo agent keeps its heartbeat fresh beyond the offline threshold", async ({
  page,
}) => {
  await setupAgentKey(page);
  await expect(page.getByText("Demo agent", { exact: true })).toBeVisible();
  const daemon = daemonDouble(page);
  await page.clock.install();
  for (let minute = 0; minute < 4; minute++) {
    await page.clock.fastForward(60_000);
    await expect
      .poll(async () => {
        const at = loadedRecords(await readHeartbeat(daemon.client))[0]?.at;
        return at ? (await page.evaluate(() => Date.now())) - Date.parse(at) : Infinity;
      })
      .toBeLessThanOrEqual(60_000);
    await expect(
      page.getByRole("button", { name: "Agent status: Agent running", exact: true }),
    ).toBeVisible();
  }
});
