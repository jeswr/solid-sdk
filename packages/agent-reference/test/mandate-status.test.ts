// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { MandateStatusLists } from "../src/mechanisms/mandate-status.js";
import { testKey } from "../src/reference/keys.js";

it("verifies signed lists, suspension, resumption, revocation and unavailable status", async () => {
  let at = "2026-11-13T09:00:00.000Z";
  const lists = new MandateStatusLists(
    "https://sam.example/#me",
    await testKey("status-owner"),
    () => at,
  );
  await lists.setup();
  expect(await lists.check()).toBeUndefined();
  await lists.set("suspension", true);
  expect(lists.current()).toBe("mandate-withdrawn");
  expect(await lists.check()).toBe("mandate-withdrawn");
  await lists.set("suspension", false);
  expect(await lists.check()).toBeUndefined();
  await lists.set("revocation", true);
  expect(await lists.check()).toBe("mandate-withdrawn");
  await expect(lists.set("revocation", false)).rejects.toThrow("permanent");
  expect(await lists.check([lists.entries[0]!])).toBe("representation-invalid");
  lists.available = false;
  expect(await lists.check()).toBe("lookup-failed");
  at = "2026-11-13T09:01:00.000Z";
  expect(lists.current()).toBe("lookup-failed");
});

it("runs the credential mortgage, confines it and stops a suspended mandate", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]?.trace;
  const paths = await runScenario(profile, scenario, {
    configuration: "authority-mandate-credential",
  });
  const main = paths.find((p) => p.path === "main"),
    failure = paths.find((p) => p.path === "mandate-suspended");
  if (!baseline || !main?.trace || !failure?.trace)
    throw new Error(JSON.stringify(paths.map((p) => ({ path: p.path, blocked: p.blocked }))));
  expect(confinementDifferences(baseline, main.trace, "authority")).toEqual([]);
  expect(failure.disagrees).not.toBe(true);
  expect(
    failure.trace.events.some(
      (e) => e.check === "mandate" && e.reason === "mandate-withdrawn" && e.verdict === "fail",
    ),
  ).toBe(true);
  expect(
    main.trace.events.some((e) =>
      e.packet?.rdf?.includes("https://www.w3.org/ns/credentials/status#"),
    ),
  ).toBe(true);
  const ownStop = failure.trace.events.find(
    (e) => e.check === "mandate" && e.reason === "mandate-withdrawn",
  );
  const remoteStop = failure.trace.events.find(
    (e) => e.check === "authority" && e.reason === "mandate-withdrawn" && e.verdict === "fail",
  );
  expect(remoteStop).toBeDefined();
  expect(ownStop!.seq).toBeLessThan(remoteStop!.seq);
  expect(
    failure.trace.events.filter(
      (e) => e.agent === ownStop!.agent && e.seq > ownStop!.seq && e.kind === "message-out",
    ),
  ).toEqual([]);
  for (const trace of [main.trace, failure.trace])
    for (const e of trace.events) {
      expect(`${e.caption} ${e.rule?.text ?? ""} ${e.chat?.text ?? ""}`).not.toMatch(
        /https?:\/\/|urn:|did:/,
      );
    }
  expect(
    main.trace.events.some((e) => e.caption.includes("status lists are current and clear")),
  ).toBe(true);
}, 180000);
