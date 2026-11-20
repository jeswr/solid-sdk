// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { objectTerms } from "@jeswr/rdf-serialize/wrapper";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { beforeAll, expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { matrixConfiguration, matrixPrerequisite } from "../src/engine/matrix.js";
import { type PathResult, runScenario } from "../src/engine/run.js";
import { type AccessPointer, isAccessPointer } from "../src/mechanisms/access-pointer.js";
import {
  type TranslationTerms,
  translateTerms,
  withinTerms,
} from "../src/mechanisms/access-translation.js";
import { testKey } from "../src/reference/keys.js";
import { scenarioRegistry } from "../src/suites/scenario.js";
import { inspectEvidenceJws } from "../src/wire/evidence-jws.js";

const root = new URL("..", import.meta.url).pathname;
const configuration = "usage-control-solid-access-control";
const prerequisite = "data-access-by-reference-solid";
const load = () => loadCase(root, "mortgage-main");
const share = "https://w3id.org/jeswr/awp#terms/harbourbank-deposit#share";
type Hook = NonNullable<NonNullable<Parameters<typeof runScenario>[2]>["beforeSolidStep"]>;
type Fixture = Parameters<Hook>[0];
let main: PathResult;
let first: Fixture;
let last: Fixture;
let branch: PathResult;
let stopped: Fixture;
let beforeBranch: number;
let pointer: AccessPointer;

beforeAll(async () => {
  const { profile, scenario } = load();
  const paths = await runScenario(profile, scenario, {
    configuration,
    testOnly: true,
    beforeSolidStep(fixture) {
      if (fixture.path === "main") {
        last = fixture;
        if (fixture.step.id === "evidence-arrives") {
          first = fixture;
          const evidence = fixture.queued.find((out) => out.kind === "deliver")?.message.evidence;
          const access = evidence?.find(isAccessPointer);
          expect(access).toBeDefined();
          pointer = inspectEvidenceJws(access!.value).payload as unknown as AccessPointer;
        }
      } else if (fixture.path === "translation-grants-more" && fixture.step.id === "terms-arrive") {
        stopped = fixture;
        beforeBranch = fixture.pod.storage.accessLog.length;
      }
    },
  });
  main = paths.find((path) => path.path === "main")!;
  branch = paths.find((path) => path.path === "translation-grants-more")!;
}, 300_000);

it("every access rule names the policies it was translated from", async () => {
  const aclUrl = pointer.resource + ".acl";
  const response = await first.pod.storage.client(
    pointer.issuer,
    await testKey("engine/sam-agent/actor"),
  )(aclUrl);
  const dataset = await parseRdf(await response.text(), "text/turtle", { baseIRI: aclUrl });
  const rules = [...new AclResource(dataset, DataFactory).authorizations].filter((rule) =>
    rule.agent.has(pointer.reader.actor),
  );
  expect(rules).toHaveLength(1);
  const ids = [...objectTerms(rules[0]!, "http://www.w3.org/ns/prov#wasDerivedFrom")]
    .map((term) => term.value)
    .sort();
  expect(ids).toEqual([share, pointer.agreement + "#read-for-purpose"].sort());
  expect(pointer.policies?.toSorted()).toEqual(ids);
  expect(
    last.ledgers
      .get("sam-agent")
      ?.entries()
      .find((e) => e.record.type === "access-granted")?.record.policies,
  ).toEqual(pointer.policies);
});

it("translation-grants-more stops at data-terms before any grant", () => {
  expect(branch.actual).toMatchObject({
    check: "data-terms",
    reason: "prohibited",
    outcome: "stop",
  });
  expect(branch.disagrees).toBe(false);
  const events = branch.trace!.events;
  const failure = events.findIndex(
    (e) => e.check === "data-terms" && e.verdict === "fail" && e.reason === "prohibited",
  );
  const runStart = events
    .slice(0, failure)
    .findLastIndex(
      (e) => e.agent === "sams-agent" && e.part === "outbound-gate" && e.kind === "decision",
    );
  expect(events.slice(runStart + 1, failure)).toContainEqual(
    expect.objectContaining({
      agent: "sams-agent",
      check: "disclosure",
      verdict: "pass",
    }),
  );
  expect(events.slice(failure).some((e) => e.kind === "message-out")).toBe(false);
  expect(
    stopped.pod.storage.accessLog
      .slice(beforeBranch)
      .filter((e) => e.method === "PUT" && e.url.endsWith(".acl")),
  ).toEqual([]);
  expect(
    stopped.ledgers
      .get("sam-agent")
      ?.entries()
      .some((e) => e.record.type === "access-grant-intended" || e.record.type === "access-granted"),
  ).toBe(false);
});

it("a rule that names no policy, or a policy not in the terms, is prohibited", () => {
  const mandate = {
    type: "permission",
    action: "distribute",
    target: "urn:op:disclosure",
  } as const;
  const terms: TranslationTerms = {
    supplier: pointer.terms.supplier.policy,
    grant: pointer.terms.grant,
    mandate,
    item: pointer.item.id,
    resource: pointer.resource,
    agent: pointer.reader.actor,
    recipient: pointer.reader.party,
    purpose: pointer.purpose,
    mandateTarget: mandate.target,
    at: pointer.validFrom,
    until: pointer.validUntil,
  };
  const { rule } = translateTerms(terms);
  expect(rule).toBeDefined();
  expect(withinTerms(rule!, terms)).toBe(true);
  for (const wider of [
    { policies: [] },
    { policies: [share] },
    { policies: [...rule!.policies, "urn:policy:unknown"] },
    { until: new Date(Date.parse(pointer.validUntil) + 1).toISOString() },
    { agent: "https://another.example/#reader" },
    { resource: "https://another.example/resource" },
    { modes: ["Read", "Write"] as const },
    { public: true },
    { authenticated: true },
    { defaults: true },
    { agentGroup: "urn:group:unapproved" },
  ])
    expect(withinTerms({ ...rule!, ...wider }, terms)).toBe(false);
  const earlier = new Date(Date.parse(pointer.validUntil) - 1000).toISOString();
  const constrained: TranslationTerms = {
    ...terms,
    mandate: {
      ...mandate,
      constraints: [{ leftOperand: "dateTime", operator: "lteq", rightOperand: earlier }],
    },
  };
  expect(translateTerms(constrained).rule?.until).toBe(earlier);
  expect(withinTerms(rule!, constrained)).toBe(false);
});

it("validates the translated interval against a restriction in the agreement", () => {
  const at = Date.parse(pointer.validFrom);
  const until = new Date(at + 20).toISOString();
  const cutoff = new Date(at + 10).toISOString();
  const terms: TranslationTerms = {
    supplier: pointer.terms.supplier.policy,
    grant: pointer.terms.grant,
    mandate: { type: "permission", action: "distribute", target: "urn:op:disclosure" },
    item: pointer.item.id,
    resource: pointer.resource,
    agent: pointer.reader.actor,
    recipient: pointer.reader.party,
    purpose: pointer.purpose,
    mandateTarget: "urn:op:disclosure",
    at: pointer.validFrom,
    until,
  };
  const { rule } = translateTerms(terms);
  if (!rule) throw new Error("The fixture must permit Read");
  const withRestriction: TranslationTerms = {
    ...terms,
    grant: {
      ...terms.grant,
      prohibitions: [
        {
          type: "prohibition",
          action: "read",
          target: `${pointer.agreement}#evidence`,
          constraints: [{ leftOperand: "dateTime", operator: "gteq", rightOperand: cutoff }],
        },
      ],
    },
  };
  expect(translateTerms(withRestriction).rule).toBeUndefined();
  expect(withinTerms(rule, withRestriction)).toBe(false);
  expect(withinTerms({ ...rule, until: cutoff }, withRestriction)).toBe(true);
});

it("what access rules cannot say still travels as terms", () => {
  expect(pointer.remainder?.join(" ")).toMatch(/purpose.*onward.*deletion/i);
  const fact = last.runtimes
    .get("north-agent")!
    .admittedStatements()
    .find((s) => s.id === pointer.item.id);
  expect(fact?.terms).toEqual(pointer.terms.supplier);
  expect(main.trace!.events).toContainEqual(
    expect.objectContaining({
      agent: "sams-agent",
      check: "data-terms",
      verdict: "pass",
      caption: expect.stringContaining("access rule was translated"),
    }),
  );
});

it("it runs on the by-reference world", () => {
  const { scenario } = load();
  const dependent = scenario.configurations.find((entry) => entry.id === configuration)!;
  const required = matrixPrerequisite(scenario, dependent);
  expect(required?.id).toBe(prerequisite);
  const configured = matrixConfiguration(dependent, scenarioRegistry(), required);
  expect(configured.layers).toMatchObject({
    "data-access": "by-reference-solid",
    "usage-control": "solid-access-control",
  });
  expect(() => matrixConfiguration(dependent, scenarioRegistry())).toThrow(
    /solid-access-control-needs-reference/,
  );
});
