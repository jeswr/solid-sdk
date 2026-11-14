// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("uses only scoped own-list keys, confines the mortgage, and withholds the stranger returned by the index", async () => {
  const { profile, scenario } = loadCase(new URL("../", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]!.trace!;
  const entry = scenario.configurations.find((c) => c.id === "trust-pinned-list")!;
  entry.world.branches = scenario.branches
    .filter((branch) => branch.onlyUnder === entry.id)
    .filter((b) => b.id === "stranger");
  const paths = await runScenario(profile, scenario, { configuration: "trust-pinned-list" });
  expect(paths.every((p) => !p.blocked)).toBe(true);
  expect(confinementDifferences(baseline, paths[0]!.trace!, "trust")).toEqual([]);
  const main = paths[0]!.trace!.events;
  expect(
    main
      .flatMap((e) => e.resolution?.path ?? [])
      .some((p) => p.kind === "register" || p.kind === "root"),
  ).toBe(false);
  const events = paths.find((p) => p.path === "stranger")!.trace!.events;
  expect(
    events.some(
      (e) =>
        e.agent === "sams-agent" &&
        e.check === "source" &&
        e.reason === "source-unknown" &&
        e.verdict === "fail",
    ),
  ).toBe(true);
  expect(
    events.some(
      (e) =>
        e.agent === "sams-agent" && e.kind === "ask-principal" && e.reason === "source-unknown",
    ),
  ).toBe(true);
  expect(
    events.some(
      (e) => e.agent === "sams-agent" && e.kind === "store" && e.caption.includes("Willow"),
    ),
  ).toBe(false);
}, 180_000);
it("never consults a configured register when the own list is missing, expired, blocked or out of scope", async () => {
  const { TrustResolver } = await import("../src/trust/resolver.js");
  const { TrustStore } = await import("../src/mechanisms/trust.js");
  const root = {
    id: "urn:root",
    name: "Fictional root",
    delegates: [
      {
        id: "urn:register",
        name: "Fictional register",
        answersFor: "lenders",
        answerTtlMs: 60000,
        entries: [
          {
            party: "urn:lender",
            authorizedFor: ["urn:op"],
            claimTypes: ["mortgage.product"],
            status: "authorized" as const,
            id: "urn:entry",
          },
        ],
      },
    ],
  };
  for (const ownList of [
    [],
    [{ party: "urn:lender", tasks: ["urn:other"] }],
    [{ party: "urn:lender", tasks: ["urn:op"], expiresAt: "2026-01-01T00:00:00Z" }],
    [{ party: "urn:lender", tasks: ["urn:op"], block: true }],
  ]) {
    const resolver = new TrustResolver({
      principal: "Sam",
      trust: TrustStore.empty("urn:sam"),
      name: () => "A fictional lender",
      root,
      ownList,
      ownListOnly: true,
    });
    expect(
      resolver.resolveRecipient({
        party: "urn:lender",
        task: "urn:op",
        taskLabel: "this mortgage",
        at: "2026-11-13T09:00:00Z",
      }).outcome,
    ).not.toBe("accepted");
    expect(
      resolver.resolveSource({
        evaluator: "urn:agent",
        source: "urn:lender",
        claimType: "mortgage.product",
        at: "2026-11-13T09:00:00Z",
      }).outcome,
    ).not.toBe("accepted");
  }
});
