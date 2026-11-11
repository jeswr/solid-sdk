// AUTHORED-BY Codex GPT-6.1-Sol
import { serialize } from "@jeswr/rdf-serialize";
import { expect, test } from "@playwright/test";
import { AGENT, metadataNode, PROV } from "../../src/apps/agent/lib/paths";
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
    page.getByRole("button", { name: "Agent status: Stopped (demo)", exact: true }),
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
    page.getByRole("button", { name: "Agent status: Agent running (demo)", exact: true }),
  ).toBeVisible();
  expect(loadedRecords(await readControl(daemon.client, verifier))).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "Resume", verification: "verified" })]),
  );
  await page
    .getByRole("button", { name: "Agent status: Agent running (demo)", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Stop the agent", exact: true }).click();
  await dialog.getByRole("button", { name: "Stop the agent", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Agent status: Stopped (demo)", exact: true }),
  ).toBeVisible();
  const first = proposals[0];
  await expect(
    page.getByRole("button", { name: "Agent status: Stopped (demo)", exact: true }),
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
      page.getByRole("button", { name: "Agent status: Agent running (demo)", exact: true }),
    ).toBeVisible();
  }
});

test("an unsigned stopped heartbeat changes the live label while Stop remains available", async ({
  page,
}) => {
  await setupAgentKey(page);
  await page.clock.install();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const daemon = daemonDouble(page);
  const heartbeat = await daemon.client.graph(daemon.client.paths.heartbeat);
  const node = metadataNode(heartbeat.dataset, daemon.client.paths.heartbeat);
  node.setText(`${AGENT}state`, "stopped");
  node.setText(
    `${PROV}generatedAtTime`,
    new Date(await page.evaluate(() => Date.now())).toISOString(),
  );
  await daemon.client.replace(
    daemon.client.paths.heartbeat,
    await serialize([...heartbeat.dataset], { format: "text/turtle" }),
    heartbeat.etag as string,
  );
  await page.clock.runFor(500);
  const trigger = page.getByRole("button", { name: "Agent status: Stopped (demo)", exact: true });
  await expect(trigger).toBeVisible();
  await expect(trigger.getByRole("status")).toHaveText("Stopped");
  await expect(trigger.locator('[aria-live="polite"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop the agent", exact: true })).toBeVisible();
  await page.clock.resume();
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Stop the agent", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Resume", exact: true })).toHaveCount(0);
});
