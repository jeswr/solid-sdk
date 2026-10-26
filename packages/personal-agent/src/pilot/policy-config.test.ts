/**
 * The recorded policy module: SPARQ by default, probed and pinned at `init`, fail closed when
 * the pinned binary is missing or changed, never a fallback to solid-odrl.
 *
 * The executables here are STAND-INS (small node scripts speaking the adapter protocol), NOT
 * the sparq-policy evaluator: they exercise the recording/probing/pinning boundary only. The
 * real Rust binary is exercised by `npm run pilot:sparq-cases`, the SPARQ demo and the
 * separate-process integration workflow.
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./cli.js";
import { POLICY_ENGINE_FILE, policyEngineForAgent } from "./policy-config.js";
import { CONFIG_ED25519, CONFIGURATIONS, POLICY_PROFILE } from "./profile/configurations.js";
import { AWP } from "./profile/vocabulary.js";
import { descriptionToRdf } from "./rdf/evidence.js";
import { fixedClock, londonCalendar, provisionPair, startAgent } from "./scenarios/personal.js";
import { FileStateStore } from "./store/state.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/**
 * Stand-in adapter: `indeterminate` for the init probe's purpose-gated prohibition (as the
 * real evaluator answers when the purpose is missing), else `permit` — or always `permit`
 * with `naive` (a binary without three-valued semantics).
 */
function standIn(dir: string, opts: { naive?: boolean } = {}): string {
  const path = join(dir, "sparq-policy-decide");
  const body = `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
const gated=${opts.naive ? "false" : 'JSON.parse(s).policy.text.includes("urn:awp:probe:prohibit")'};
process.stdout.write(JSON.stringify({api:"sparq-policy-decide/1",effect:gated?"indeterminate":"permit",
matchedRules:[],reasons:[],unresolved:gated?[{rule:"r",leftOperand:"purpose",kind:"missing-context"}]:[],
evaluator:{crate:"sparq-policy",version:"0.0.0-stand-in",function:"decide"}}));});`;
  writeFileSync(path, `#!${process.execPath}\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

async function run(args: string[]): Promise<{ code: number; json: Record<string, unknown> }> {
  let out = "";
  const code = await main(args, { stdout: (s) => (out += s) });
  return {
    code,
    json: out.trim().startsWith("{") ? (JSON.parse(out) as Record<string, unknown>) : {},
  };
}

const initArgs = (root: string, name = "alice") => [
  "init",
  "--name",
  name,
  "--party",
  `https://${name}.example/#me`,
  "--actor",
  `https://agents.${name}.example/personal#agent`,
  "--dir",
  root,
  "--now",
  "2026-10-19T08:00:00Z",
];

describe("recorded policy module (stand-in executables, not the evaluator)", () => {
  it("SPARQ is the default: init without a binary fails with instructions and writes nothing", async () => {
    const root = temp("awp-pm-");
    const saved = process.env.AWP_SPARQ_POLICY_BIN;
    delete process.env.AWP_SPARQ_POLICY_BIN;
    try {
      await expect(run(initArgs(root))).rejects.toThrow(
        /SPARQ is the default policy module.*--sparq-bin.*--policy-engine=solid-odrl/s,
      );
      await expect(run([...initArgs(root), "--sparq-bin", join(root, "nope")])).rejects.toThrow(
        /no sparq-policy-decide binary at/,
      );
      expect(existsSync(join(root, "alice"))).toBe(false);
    } finally {
      if (saved !== undefined) process.env.AWP_SPARQ_POLICY_BIN = saved;
    }
  });

  it("init probes the binary: one without three-valued semantics is refused", async () => {
    const root = temp("awp-pm-");
    const naive = standIn(root, { naive: true });
    await expect(run([...initArgs(root), `--sparq-bin=${naive}`])).rejects.toThrow(
      /possibly applicable prohibition must be indeterminate/,
    );
    expect(existsSync(join(root, "alice"))).toBe(false);
  });

  it("records and pins the probed binary; a changed or missing binary fails closed", async () => {
    const root = temp("awp-pm-");
    const bin = standIn(root);
    const init = await run([...initArgs(root), `--sparq-bin=${bin}`]);
    expect(init.json.policyModule).toMatchObject({
      engine: "sparq",
      binary: bin,
      evaluator: "sparq-policy@0.0.0-stand-in decide() via sparq-policy-decide/1",
    });
    const record = JSON.parse(readFileSync(join(root, "alice", POLICY_ENGINE_FILE), "utf8"));
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
    const common = ["--dir", root, "--now", "2026-10-19T08:00:00Z"];
    expect((await run(["policy-engine", "--name", "alice", ...common])).json).toMatchObject({
      module: "sparq",
      source: "recorded",
      status: "ready",
    });
    const status = await run(["status", "--name", "alice", ...common]);
    expect(status.json.policyModule).toEqual({
      module: "sparq",
      source: "recorded",
      status: "ready",
    });

    // The binary changes after the probe: every decision is indeterminate until re-pinned.
    writeFileSync(bin, `${readFileSync(bin, "utf8")}\n// modified\n`);
    const changed = await run(["policy-engine", "--name", "alice", ...common]);
    expect(changed.code).toBe(2);
    expect(String(changed.json.status)).toMatch(/^unavailable: .*changed since it was probed/);
    const resolved = policyEngineForAgent(join(root, "alice"), {}, { recordRequired: true });
    const verdict = resolved.engine.evaluate(
      { id: "urn:awp:p", type: "Set", permissions: [{ type: "permission", action: "use" }] },
      { agent: "urn:awp:a", action: "use", target: "urn:awp:t", at: "2026-10-19T08:00:00Z" },
    );
    expect(verdict.effect).toBe("indeterminate");

    // Explicit re-pin (operator action) restores it and keeps what it replaced.
    const repin = await run(["policy-engine", "--name", "alice", `--sparq-bin=${bin}`, ...common]);
    expect(repin.json).toMatchObject({ module: "sparq", status: "ready" });
    expect(
      JSON.parse(readFileSync(join(root, "alice", POLICY_ENGINE_FILE), "utf8")).replaced,
    ).toMatchObject({ engine: "sparq" });

    // Missing binary: unavailable; missing record in a recorded directory: unavailable too.
    unlinkSync(bin);
    expect((await run(["policy-engine", "--name", "alice", ...common])).code).toBe(2);
    unlinkSync(join(root, "alice", POLICY_ENGINE_FILE));
    const status2 = await run(["status", "--name", "alice", ...common]);
    expect(status2.json.policyModule).toMatchObject({
      module: "missing-record",
      status: expect.stringMatching(/^unavailable: policy-engine\.json is missing/),
    });
  });

  it("an unavailable module stops a proposal: nothing is produced to send", async () => {
    const root = temp("awp-pm-");
    const bin = standIn(root);
    const common = ["--dir", root, "--now", "2026-10-19T08:00:00Z"];
    const a = await run([
      ...initArgs(root, "alice"),
      `--sparq-bin=${bin}`,
      "--known-party",
      "https://bob.example/#me",
    ]);
    const b = await run([
      ...initArgs(root, "bob"),
      "--policy-engine=solid-odrl",
      "--known-party",
      "https://alice.example/#me",
    ]);
    for (const [who, peer, card] of [
      ["alice", "bob", b],
      ["bob", "alice", a],
    ] as const) {
      writeFileSync(
        join(root, `${peer}.card.json`),
        JSON.stringify((await run(["card", "--name", peer, ...common])).json),
      );
      await run([
        "pin",
        "--name",
        who,
        "--card",
        join(root, `${peer}.card.json`),
        `--party-kid=${String(card.json.partyKid)}`,
        `--actor-kid=${String(card.json.actorKid)}`,
        ...common,
      ]);
    }
    const envelopes = (out: string, kind: string) =>
      existsSync(join(root, out))
        ? readdirSync(join(root, out))
            .filter((f) => f.includes(`-${kind}-`) && f.endsWith(".envelope.json"))
            .map((f) => join(root, out, f))
        : [];
    /** Discovery, then the proposal decision — which the recorded module makes for Alice. */
    const toProposal = async (tag: string) => {
      await run([
        "propose-meeting",
        "--name",
        "alice",
        "--peer-actor",
        "https://agents.bob.example/personal#agent",
        "--peer-party",
        "https://bob.example/#me",
        "--window-start",
        "2026-10-20T08:00:00Z",
        "--window-end",
        "2026-10-20T17:00:00Z",
        "--out",
        join(root, `${tag}-0`),
        ...common,
      ]);
      const [describe] = envelopes(`${tag}-0`, "describe");
      const bobOut = `${tag}-1`;
      await run([
        "process",
        "--name",
        "bob",
        "--input",
        describe as string,
        "--format",
        "envelope",
        "--out",
        join(root, bobOut),
        ...common,
      ]);
      const [description] = envelopes(bobOut, "description");
      return run([
        "process",
        "--name",
        "alice",
        "--input",
        description as string,
        "--format",
        "envelope",
        "--out",
        join(root, `${tag}-2`),
        ...common,
      ]);
    };
    // Module ready: the stand-in permits the mandate's scheduling action → a proposal.
    await toProposal("ready");
    expect(envelopes("ready-2", "propose")).toHaveLength(1);
    // Binary changed after the probe: the same decision is indeterminate → no proposal.
    writeFileSync(bin, `${readFileSync(bin, "utf8")}\n// modified\n`);
    const refused = await toProposal("changed");
    expect(envelopes("changed-2", "propose")).toHaveLength(0);
    expect(JSON.stringify(refused.json)).toMatch(/policy module unavailable/);
  });

  it("AWP_POLICY_ENGINE must agree with the record; a legacy directory keeps its explicit selection", async () => {
    const root = temp("awp-pm-");
    await run([...initArgs(root), "--policy-engine=solid-odrl"]);
    expect(() =>
      policyEngineForAgent(
        join(root, "alice"),
        { AWP_POLICY_ENGINE: "sparq" },
        { recordRequired: true },
      ),
    ).toThrow(/conflicts with the recorded policy module solid-odrl/);
    const legacy = temp("awp-legacy-");
    expect(policyEngineForAgent(legacy, {})).toMatchObject({
      module: "solid-odrl",
      source: "legacy-unrecorded",
    });
  });
});

describe("phase-4 review — long-running pin, consistent inspection, described module", () => {
  it("finding 1: the SAME resolved engine re-checks the pin before every decision", async () => {
    const root = temp("awp-pm-");
    const bin = standIn(root);
    await run([...initArgs(root), `--sparq-bin=${bin}`]);
    // Resolve ONCE, as a long-running service does, and keep using that engine.
    const resolved = policyEngineForAgent(join(root, "alice"), {}, { recordRequired: true });
    const policy = {
      id: "urn:awp:p",
      type: "Set" as const,
      permissions: [{ type: "permission" as const, action: "use" as const }],
    };
    const request = {
      agent: "urn:awp:a",
      action: "use",
      target: "urn:awp:t",
      at: "2026-10-19T08:00:00Z",
    };
    expect(resolved.engine.evaluate(policy, request).effect).toBe("permit");
    expect(resolved.engine.availability?.()).toEqual({ status: "ready" });
    // Replace the executable in place with one claiming a different evaluator that permits.
    writeFileSync(
      bin,
      `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({api:"sparq-policy-decide/1",effect:"permit",matchedRules:[],reasons:[],unresolved:[],evaluator:{crate:"sparq-policy",version:"unreviewed-replacement",function:"decide"}})));\n`,
    );
    chmodSync(bin, 0o755);
    const after = resolved.engine.evaluate(policy, request);
    expect(after.effect).toBe("indeterminate");
    expect(after.reason).toMatch(/policy module unavailable: .*changed since it was probed/);
    expect(after.evaluator).toBeUndefined(); // the replacement was never executed
    expect(resolved.engine.availability?.()).toMatchObject({ status: "unavailable" });
    // Removed entirely: still indeterminate, never a fallback.
    unlinkSync(bin);
    expect(resolved.engine.evaluate(policy, request).reason).toMatch(/is missing/);
  });

  it("finding 1: a running runtime reports current module availability", async () => {
    const root = temp("awp-pm-");
    const bin = standIn(root);
    await run([...initArgs(root), `--sparq-bin=${bin}`]);
    const resolved = policyEngineForAgent(join(root, "alice"), {}, { recordRequired: true });
    const { alice } = await provisionPair({ now: fixedClock().now });
    const a = await startAgent(alice, londonCalendar(), {
      now: fixedClock().now,
      accepted: [CONFIG_ED25519],
      runtime: { policyEngine: resolved.engine },
    });
    expect(a.runtime.policyModule()).toMatchObject({ status: "ready" });
    writeFileSync(bin, `${readFileSync(bin, "utf8")}\n// upgraded while running\n`);
    expect(a.runtime.policyModule()).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/changed since it was probed/),
    });
    // Peers see only the status — no local path, digest or reason.
    const described = a.runtime.description().policyModule;
    expect(described).toEqual({
      policyProfile: POLICY_PROFILE,
      evaluator: {
        name: "sparq-policy",
        version: "0.0.0-stand-in",
        interface: "decide() via sparq-policy-decide/1 (local process)",
      },
      status: "unavailable",
    });
    expect(JSON.stringify(a.runtime.description())).not.toContain(root);
  });

  it("finding 2: inspection uses the runtime's resolution; re-pin is locked and audited", async () => {
    const root = temp("awp-pm-");
    const bin = standIn(root);
    const common = ["--dir", root, "--now", "2026-10-19T08:00:00Z"];
    await run([...initArgs(root), `--sparq-bin=${bin}`]);
    // While another owner holds the agent's lock, re-pinning is refused.
    const holder = new FileStateStore(join(root, "alice", "state.json"));
    await expect(
      run(["policy-engine", "--name", "alice", `--sparq-bin=${bin}`, ...common]),
    ).rejects.toThrow(/state is locked/);
    holder.close();
    const repin = await run(["policy-engine", "--name", "alice", `--sparq-bin=${bin}`, ...common]);
    expect(repin.code).toBe(0);
    const ledger = readFileSync(join(root, "alice", "ledger.jsonl"), "utf8");
    expect(ledger).toContain('"type":"policy-module-recorded"');
    // Deleting the record: inspection now agrees with runtime opening (unavailable).
    unlinkSync(join(root, "alice", POLICY_ENGINE_FILE));
    const inspected = await run(["policy-engine", "--name", "alice", ...common]);
    expect(inspected.code).toBe(2);
    expect(inspected.json).toMatchObject({
      module: "missing-record",
      status: expect.stringMatching(/^unavailable: policy-engine\.json is missing/),
    });
  });

  it("finding 3: configurations name the policy profile, not an evaluator; RDF keeps them apart", () => {
    for (const c of Object.values(CONFIGURATIONS))
      expect(JSON.stringify(c)).not.toMatch(/solid-odrl|sparq/i);
    expect(CONFIGURATIONS[CONFIG_ED25519]?.policyProfile).toBe(POLICY_PROFILE);
    const quads = descriptionToRdf(
      {
        describes: "https://agents.alice.example/personal#agent",
        policyModule: {
          policyProfile: POLICY_PROFILE,
          evaluator: { name: "sparq-policy", version: "0.1.0", interface: "local process" },
          status: "ready",
        },
      },
      "urn:awp:description:test",
    );
    const types = quads
      .filter((q) => q.predicate.value.endsWith("#type"))
      .map((q) => [q.subject.value, q.object.value]);
    expect(types).toContainEqual([POLICY_PROFILE, `${AWP}PolicyProfile`]);
    const module = types.find(([, t]) => t === `${AWP}PolicyModule`)?.[0];
    expect(module).toMatch(/^urn:awp:policy-module:/);
    expect(module).not.toBe(POLICY_PROFILE);
  });
});
