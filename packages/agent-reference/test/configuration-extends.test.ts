// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Claude Opus 5.5
// Brief 31 §2.9 decision: `extends` builds one configuration on another of the same layer.
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { patchDifferences } from "../src/engine/confinement.js";
import { applyIdentityNames } from "../src/engine/identity-names.js";
import { loadCase } from "../src/engine/load.js";
import { matrixExtended, matrixPrerequisite, matrixWorld } from "../src/engine/matrix.js";
import { runScenario } from "../src/engine/run.js";
import type { Scenario } from "../src/engine/schema.js";

const root = join(import.meta.dirname, "..");
type Entry = Scenario["configurations"][number];
const withEntry = (scenario: Scenario, id: string, change: Partial<Entry>) => {
  const configurations = scenario.configurations.map((entry) =>
    entry.id === id ? ({ ...entry, ...change } as Entry) : entry,
  );
  return {
    scenario: { ...scenario, configurations },
    entry: configurations.find((entry) => entry.id === id) as Entry,
  };
};

it("applies the prerequisite's, the extended configuration's and its own patch, in that order", () => {
  const { profile, scenario: loaded } = loadCase(root, "mortgage-main");
  const { scenario, entry } = withEntry(loaded, "accountability-reputation-post", {
    extends: "accountability-regulator-claim",
    world: {
      parties: {
        "post-reader": {
          id: "post-reader",
          identity: "urn:fictional:post-reader",
          name: "A fictional reader",
          role: "source",
          runs: "issuer-only",
        },
        forum: { name: "Renamed by the extending patch" },
      },
    },
  });
  expect(matrixExtended(scenario, entry)?.id).toBe("accountability-regulator-claim");
  expect(matrixPrerequisite(scenario, entry)?.id).toBe("identity-anonymous");
  const ids = matrixWorld(scenario, entry).parties.map((party) => party.id);
  // identity-anonymous (the extended configuration's prerequisite), then the regulator
  // claim, then the extending patch.
  for (const id of ["lender-register-agent", "forum", "post-reader"]) expect(ids).toContain(id);
  expect(matrixWorld(scenario, entry).parties.find((party) => party.id === "forum")?.name).toBe(
    "Renamed by the extending patch",
  );
  // C3's reference is the extended world: the rename is an edit of what it added.
  expect(patchDifferences(scenario, entry, profile).join("\n")).toMatch(/party:forum changes/);
  const replacing = withEntry(scenario, entry.id, { replaces: ["party:forum"] });
  expect(patchDifferences(replacing.scenario, replacing.entry, profile).join("\n")).toMatch(
    /party:forum was added by accountability-regulator-claim; it may not be replaced/,
  );
});

it("refuses a second-level extends", () => {
  const loaded = loadCase(root, "mortgage-main").scenario;
  const first = withEntry(loaded, "accountability-regulator-claim", {
    extends: "accountability-pod-mirror",
  });
  const { scenario, entry } = withEntry(first.scenario, "accountability-reputation-post", {
    extends: "accountability-regulator-claim",
  });
  expect(() => matrixWorld(scenario, entry)).toThrow("may not itself extend another");
});

it("refuses extends across layers, and beside requires", () => {
  const loaded = loadCase(root, "mortgage-main").scenario;
  const across = withEntry(loaded, "accountability-reputation-post", {
    extends: "identity-anonymous",
  });
  expect(() => matrixWorld(across.scenario, across.entry)).toThrow("only one of the same layer");
  const both = withEntry(loaded, "accountability-reputation-post", {
    extends: "accountability-regulator-claim",
    requires: "identity-anonymous",
  });
  expect(() => matrixWorld(both.scenario, both.entry)).toThrow("the extended one's prerequisite");
});

it("rejects a requires prerequisite that itself uses extends", () => {
  const loaded = loadCase(root, "mortgage-main").scenario;
  const { scenario, entry } = withEntry(loaded, "identity-anonymous", {
    requires: "accountability-reputation-post",
  });
  expect(() => matrixWorld(scenario, entry)).toThrow("only one prerequisite");
});

it("refuses C3 configurations that rewrite a baseline operation or add a blanket grant", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const transport = scenario.configurations.find((entry) => entry.id === "transport-email")!;
  const operation = profile.operations.find(
    ({ requiresRepresentation }) => requiresRepresentation,
  )!;
  const cases: Partial<Entry>[] = [
    { profileChange: { operations: { [operation.id]: { requiresRepresentation: false } } } },
    {
      world: {
        ...transport.world,
        mandates: {
          "sam-agent": { autonomous: [{ action: "distribute", type: "permission" }] },
        },
      },
    },
    { world: { ...transport.world, trust: { root: { delegates: [] } } } },
    {
      replaces: ["statement:income"],
      world: {
        ...transport.world,
        statements: { income: { subject: "urn:other:subject" } },
      },
    },
  ];
  for (const change of cases) {
    const changed = withEntry(scenario, transport.id, change);
    await expect(
      runScenario(profile, changed.scenario, { configuration: transport.id }),
    ).rejects.toThrow("C3 refused");
  }
});

it("refuses DID aliases for policy identifiers and refuses two parties sharing one DID", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const id = "identity-did";
  const original = scenario.configurations.find((entry) => entry.id === id)!;
  expect(patchDifferences(scenario, original, profile)).toEqual([]);
  for (const [from, to] of [
    [profile.operations[0]!.id, "did:web:forged-operation.example"],
    [scenario.trust.root!.id, "did:web:forged-register.example"],
    ["https://northbank.example/#org", "did:web:sam.identity.example"],
    ["https://northbank.example/#org", "did:web:sam.identity.example:.well-known"],
    ["urn:fictional:valuer-agent:actor", "did:web:valuer-agent-identity.identity.example"],
  ] as const) {
    const changed = withEntry(scenario, id, {
      world: {
        ...original.world,
        identityNames: {
          ...(original.world.identityNames as Record<string, string>),
          [from]: to,
        },
      },
    });
    await expect(runScenario(profile, changed.scenario, { configuration: id })).rejects.toThrow(
      /C3 refused.*identityNames/,
    );
  }
});

it("renames a terms-acceptance actor while preserving opaque values and rejecting map collisions", () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const actor = "https://agents.hostco.example/sam#agent";
  const alias = "did:web:sam-agent.identity.example";
  profile.termsAcceptance[actor] = { purposes: ["urn:test:actor-purpose"] };
  scenario.identityNames = { [actor]: alias };
  const statement = scenario.statements[0]!;
  statement.subject = actor;
  statement.value = { [actor]: actor, subject: actor };
  applyIdentityNames(profile, scenario);
  expect(profile.termsAcceptance[alias]).toEqual({ purposes: ["urn:test:actor-purpose"] });
  expect(statement.subject).toBe(alias);
  expect(statement.value).toEqual({ [actor]: actor, subject: actor });

  profile.termsAcceptance[actor] = { purposes: ["urn:test:other-purpose"] };
  expect(() => applyIdentityNames(profile, scenario)).toThrow(/collides in a policy map/);
});

it("confines Solid reference additions to the receipt field and the withdrawal permission", () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const id = "data-access-by-reference-solid";
  const entry = scenario.configurations.find((candidate) => candidate.id === id)!;
  expect(patchDifferences(scenario, entry, profile)).toEqual([]);

  const wrongVocabulary = withEntry(scenario, id, {
    profileChange: {
      vocabulary: {
        "observed.pendingReferences": { type: "number" },
        "observed.otherField": { type: "number" },
      },
    },
  });
  expect(patchDifferences(wrongVocabulary.scenario, wrongVocabulary.entry, profile)).toContain(
    "profile.vocabulary is outside the data-access layer",
  );

  const mandates = matrixWorld(scenario, entry).mandates;
  const owner = mandates.find(({ agent }) => agent === "sam-agent")!;
  const rule = owner.autonomous.find(({ id }) => id === "urn:rule:use:pod-access-withdraw")!;
  rule.action = "distribute";
  const wrongAction = withEntry(scenario, id, { world: { ...entry.world, mandates } });
  expect(patchDifferences(wrongAction.scenario, wrongAction.entry, profile)).toContain(
    "mandate:sam-agent#autonomous adds a rule outside a new operation",
  );
});
