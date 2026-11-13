// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  applyChanges,
  DATA_ROOT,
  loadProfile,
  loadScenario,
  OutlineMismatch,
  runScenario,
  runScenarioPaths,
  scenarioIds,
} from "../src/engine/run.js";
import { profileSchema, scenarioSchema, validateScenario } from "../src/engine/schema.js";

describe("executable scenario data", () => {
  it("validates every file with its published JSON Schema", () => {
    for (const [directory, file] of [["profiles", "agent-profile"], ["scenarios", "agent-scenario"]] as const) {
      const validator = z.fromJSONSchema(JSON.parse(readFileSync(join(DATA_ROOT, "schemas", `${file}.schema.json`), "utf8")));
      for (const name of readdirSync(join(DATA_ROOT, directory))) validator.parse(JSON.parse(readFileSync(join(DATA_ROOT, directory, name), "utf8")));
    }
    const profile = loadProfile("mortgage");
    const input = {...profile, purposes: profile.purposes.map(({partial: _partial, ...purpose}) => purpose)};
    expect(profileSchema.safeParse(input).success).toBe(true);
    const published = z.fromJSONSchema(JSON.parse(readFileSync(join(DATA_ROOT, "schemas/agent-profile.schema.json"), "utf8")));
    expect(published.safeParse(input).success).toBe(true);
  });
  it("rejects backward clocks and step numbers", () => {
    const s = loadScenario("mortgage-core");
    expect(() => validateScenario({...s, script:s.script.map((c,i) => i===0 ? {...c,at:"2026-11-12T00:00:00Z"} : c)})).toThrow(/nondecreasing/);
    expect(() => validateScenario({...s, script:s.script.map((c,i) => i===1 ? {...c,step:1} : c)})).toThrow(/nondecreasing/);
  });
  it("runs a new clinic operation from two JSON values and an authored outline", async () => {
    const scenario = loadScenario("mortgage-core");
    const operation = "urn:care:ask", purpose = "urn:care:referral";
    const sender = scenario.parties.find(p => p.id === "sam")?.identity;
    const peer = scenario.parties.find(p => p.id === "northbank-intake")?.identity;
    if (!sender || !peer) throw new Error("missing fixture identities");
    const profile = profileSchema.parse({schema:"agent-profile/0.1", id:"care",
      claims:[{kind:"referral.status",sources:[peer.party],methods:["recorded-by-authority"],maxAgeDays:1}],
      purposes:[{id:purpose,claims:[]}],rules:[],personDecisions:[],readingSteps:[],
      reliance:{id:"urn:care:reliance",rules:[{id:"urn:care:quality",claimType:"referral.status",methods:["recorded-by-authority"],maxAgeDays:1,text:"A current clinic record"}]},
      operations:{[operation]:{input:{type:"object",properties:{topic:{type:"string"}},required:["topic"],additionalProperties:false}}}});
    scenario.id="care-referral"; scenario.profile=profile.id; scenario.title="Ask a clinic";
    scenario.names[sender.party]="Alex"; scenario.names[peer.party]="The clinic";
    const mandate = scenario.mandates.sam;
    if (!mandate) throw new Error("missing mandate");
    mandate.autonomous={id:"urn:care:policy",type:"Set",permissions:[{id:"urn:care:permission",type:"permission",action:"use",target:operation,constraints:[{leftOperand:"purpose",operator:"eq",rightOperand:purpose}]}]};
    mandate.withApproval={id:"urn:care:approval",type:"Set"};
    const trust = scenario.trust.sam;
    if (!trust) throw new Error("missing trust list");
    trust.ownList=[{party:peer.party,tasks:[operation]}];
    scenario.core={sam:[{description:{id:operation,version:"0.1",label:"Ask the clinic",pattern:"invoke",access:"represented",roles:["initiator"],models:[],purposes:[purpose],effects:[],outcomes:[]},requiresRepresentation:false,
      hooks:{intentForInvoke:[{result:{operation,action:"use",target:operation,purpose,recipient:peer.party,parameters:{},conversation:"urn:care:task"}}]}}],"northbank-intake":[]};
    scenario.statements=[]; scenario.inject=[]; scenario.branches=[]; scenario.steps={"1":"Ask the clinic"};
    scenario.script=[{id:"ask",by:"sam",method:"startInvocation",at:scenario.start,step:1,args:[{conversation:"urn:care:task",peer:{actor:peer.actor,party:peer.party},operation:{id:operation,version:"0.1"},input:{topic:"referral"},basis:{kind:"represented"},purpose,models:[],discover:false,configuration:scenario.configuration.pilotConfiguration}]}];
    scenario.expect=[
      {agent:"sams-agent",part:"outbound-gate",kind:"check",check:"mandate",verdict:"pass",reason:"within-mandate"},
      {agent:"sams-agent",part:"outbound-gate",kind:"check",check:"recipient",verdict:"pass",reason:"recipient-established"},
      {agent:"sams-agent",part:"outbound-gate",kind:"check",check:"disclosure",verdict:"not-applicable",reason:"no-personal-data"},
      {agent:"sams-agent",part:"outbound-gate",kind:"check",check:"data-terms",verdict:"not-applicable",reason:"no-personal-data"},
      {agent:"sams-agent",part:"outbound-gate",kind:"check",check:"limits-approval",verdict:"pass",reason:"within-limits"},
      {agent:"sams-agent",part:"outbound-gate",kind:"check",check:"evidence",verdict:"pass",reason:"evidence-complete"},
      {agent:"sams-agent",part:"outbound-gate",kind:"decision",verdict:"pass"},
      {agent:"sams-agent",part:"transport",kind:"message-out"},
    ];
    expect((await runScenario(profile, scenario)).scenario.id).toBe("care-referral");
  });
  it("requires actual hook inputs and declared domain schemas", async () => {
    const s=loadScenario("mortgage-core"), p=loadProfile(s.profile);
    const malformed=structuredClone(s);
    const opening=malformed.script[1]?.args[0] as {terms: {loanAmount: unknown}};
    opening.terms.loanAmount="not an amount";
    await expect(runScenario(p,malformed)).rejects.toThrow(/script input mismatch/);
    p.operations={}; await expect(runScenario(p,s)).rejects.toThrow(/missing domain schema/);
  });
  it("applies profile source restrictions to the real source checks", async () => {
    const s=loadScenario("mortgage-core"), p=loadProfile(s.profile);
    p.claims=p.claims.map(claim => ({...claim,sources:["urn:unaccepted:source"]}));
    try { await runScenario(p,s); throw new Error("should reject"); } catch (error) {
      expect(error).toBeInstanceOf(OutlineMismatch);
      expect((error as OutlineMismatch).trace.events.some(e=>e.check==="source"&&e.verdict==="fail")).toBe(true);
    }
  });
  it("does not substitute a signature for a proof or joint computation", async () => {
    for (const assurance of ["proved","joint"]) {
      const s=loadScenario("mortgage-core"), p=loadProfile(s.profile);
      const statement=s.statements[0]; if (!statement) throw new Error("missing statement fixture");
      statement.value.derivation={rule:"deposit-total",assurance};
      await expect(runScenario(p,s)).rejects.toThrow(assurance==="proved" ? "needs the proof system" : "needs the joint computation");
    }
  });
  it("validates every profile and scenario and pins the published JSON Schemas", () => {
    for (const file of readdirSync(join(DATA_ROOT, "profiles")))
      profileSchema.parse(JSON.parse(readFileSync(join(DATA_ROOT, "profiles", file), "utf8")));
    for (const id of scenarioIds()) validateScenario(loadScenario(id));
    for (const [name, schema] of [
      ["agent-profile", profileSchema],
      ["agent-scenario", scenarioSchema],
    ] as const)
      expect(
        JSON.parse(readFileSync(join(DATA_ROOT, "schemas", `${name}.schema.json`), "utf8")),
        // biome-ignore lint/style/useNamingConvention: JSON Schema keyword
      ).toEqual({
        $comment: "AUTHORED-BY Codex GPT-6.1-Sol",
        ...z.toJSONSchema(schema, { io: "input" }),
      });
  });
  it("rejects malformed and duplicate identities, unknown principals, and unsafe paths", () => {
    const s = loadScenario("mortgage-core");
    expect(() => validateScenario({ ...s, schema: "agent-scenario/99" })).toThrow();
    expect(() => validateScenario({ ...s, parties: [...s.parties, s.parties[0]] })).toThrow(
      /duplicate party/,
    );
    expect(() =>
      validateScenario({ ...s, parties: s.parties.map((p) => ({ ...p, actsFor: "missing" })) }),
    ).toThrow(/unknown principal/);
    expect(() => applyChanges(s, [{ path: "/expect", value: [] }])).toThrow(
      /invalid scenario change path/,
    );
    expect(() => applyChanges(s, [{ path: "/core/__proto__/polluted", value: true }])).toThrow();
    expect(() => loadScenario("../mortgage-core")).toThrow(/invalid data identifier/);
  });
  it("runs named changes through the same engine and compares each branch outline", async () => {
    const scenario = loadScenario("mortgage-core");
    const over = loadScenario("mortgage-over-ask");
    scenario.branches.push({
      id: "over-ask",
      title: over.title,
      outcome: "stop",
      check: "mandate",
      reason: "not-authorised",
      expect: over.expect,
      changes: [
        { path: "/core", value: over.core },
        { path: "/script", value: over.script },
        { path: "/statements", value: over.statements },
      ],
    });
    const traces = await runScenarioPaths(loadProfile(scenario.profile), scenario);
    expect([...traces.keys()]).toEqual([scenario.id, `${scenario.id}-over-ask`]);
    expect(traces.get(`${scenario.id}-over-ask`)?.events.some((e) => e.outcome === "stop")).toBe(
      true,
    );
  });
  it("rejects an unsupported configuration instead of claiming a run", async () => {
    const s = loadScenario("mortgage-core");
    s.configuration.layers["data-access"] = "zk-query-proof";
    await expect(runScenario(loadProfile(s.profile), s)).rejects.toThrow(/not runnable/);
  });
  it("cannot satisfy an outline by changing expected verdicts", async () => {
    const s = loadScenario("mortgage-over-ask");
    s.expect = [];
    await expect(runScenario(loadProfile(s.profile), s)).rejects.toThrow(/outline mismatch/);
  });
  it("is byte reproducible for every main path", async () => {
    for (const id of scenarioIds()) {
      const scenario = loadScenario(id),
        profile = loadProfile(scenario.profile);
      expect(JSON.stringify(await runScenario(profile, scenario))).toBe(
        JSON.stringify(await runScenario(profile, scenario)),
      );
    }
  });
});
