import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./cli.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function run(args: string[]): Promise<{ code: number; json: Record<string, unknown> }> {
  let out = "";
  const code = await main(args, { stdout: (s) => (out += s) });
  return {
    code,
    json: out.trim().startsWith("{") ? (JSON.parse(out) as Record<string, unknown>) : {},
  };
}

describe("awp-pilot CLI (file interface; nothing is sent)", () => {
  it("negotiates between two separately initialised agents via Gmail payload files", async () => {
    const root = mkdtempSync(join(tmpdir(), "awp-cli-"));
    dirs.push(root);
    const now = "2026-10-19T08:00:00Z";
    const common = ["--dir", root, "--now", now];
    const a = await run([
      "init",
      "--policy-engine=solid-odrl",
      "--name",
      "alice",
      "--party",
      "https://alice.example/#me",
      "--actor",
      "https://agents.alice.example/personal#agent",
      "--email",
      "alice.awp@example.com",
      "--timezone",
      "Europe/London",
      "--known-party",
      "https://bob.example/#me",
      ...common,
    ]);
    const b = await run([
      "init",
      "--policy-engine=solid-odrl",
      "--name",
      "bob",
      "--party",
      "https://bob.example/#me",
      "--actor",
      "https://agents.hostco.example/bob#agent",
      "--operator",
      "https://hostco.example/#org",
      "--email",
      "bob.awp@example.com",
      "--timezone",
      "America/New_York",
      "--known-party",
      "https://alice.example/#me",
      ...common,
    ]);
    expect(a.code).toBe(0);
    expect(statSync(join(root, "alice", "keys", "actor.private.jwk.json")).mode & 0o777).toBe(
      0o600,
    );
    writeFileSync(
      join(root, "alice.card.json"),
      JSON.stringify((await run(["card", "--name", "alice", ...common])).json),
    );
    writeFileSync(
      join(root, "bob.card.json"),
      JSON.stringify((await run(["card", "--name", "bob", ...common])).json),
    );
    // Wrong thumbprint → refused; correct thumbprints → pinned.
    await expect(
      run([
        "pin",
        "--name",
        "alice",
        "--card",
        join(root, "bob.card.json"),
        "--party-kid",
        "wrong",
        "--actor-kid",
        "wrong",
        ...common,
      ]),
    ).rejects.toThrow(/thumbprints/);
    expect(
      (
        await run([
          "pin",
          "--name",
          "alice",
          "--card",
          join(root, "bob.card.json"),
          `--party-kid=${String(b.json.partyKid)}`,
          `--actor-kid=${String(b.json.actorKid)}`,
          ...common,
        ])
      ).code,
    ).toBe(0);
    expect(
      (
        await run([
          "pin",
          "--name",
          "bob",
          "--card",
          join(root, "alice.card.json"),
          `--party-kid=${String(a.json.partyKid)}`,
          `--actor-kid=${String(a.json.actorKid)}`,
          ...common,
        ])
      ).code,
    ).toBe(0);

    const out0 = join(root, "out-0");
    const p = await run([
      "propose-meeting",
      "--name",
      "alice",
      "--peer-actor",
      "https://agents.hostco.example/bob#agent",
      "--peer-party",
      "https://bob.example/#me",
      "--window-start",
      "2026-10-20T08:00:00Z",
      "--window-end",
      "2026-10-23T17:00:00Z",
      "--out",
      out0,
      ...common,
    ]);
    expect(p.code).toBe(0);
    let pending: Array<{ to: string; file: string }> = readdirSync(out0)
      .filter((f) => f.endsWith(".gmail-send.json"))
      .map((f) => ({ to: "bob", file: join(out0, f) }));
    let hop = 0;
    while (pending.length > 0 && hop < 20) {
      const next: typeof pending = [];
      for (const item of pending) {
        const outDir = join(root, `out-${++hop}`);
        const r = await run([
          "process",
          "--name",
          item.to,
          "--input",
          item.file,
          "--format",
          "gmail-json",
          "--out",
          outDir,
          ...common,
        ]);
        expect(r.code).toBe(0);
        const other = item.to === "bob" ? "alice" : "bob";
        for (const f of readdirSync(outDir).filter((x) => x.endsWith(".gmail-send.json")))
          next.push({ to: other, file: join(outDir, f) });
      }
      pending = next;
    }
    const statusA = (await run(["status", "--name", "alice", ...common])).json as {
      conversations: Array<{ phase: string }>;
      holds: object;
    };
    const statusB = (await run(["status", "--name", "bob", ...common])).json as {
      conversations: Array<{ phase: string }>;
      holds: object;
    };
    expect(statusA.conversations.map((c) => c.phase)).toEqual(["completed"]);
    expect(statusB.conversations.map((c) => c.phase)).toEqual(["completed"]);
    expect(Object.keys(statusA.holds)).toHaveLength(1);
    expect((await run(["verify-ledger", "--name", "bob", ...common])).json.ok).toBe(true);

    // The long-running service path: a replayed provider message dropped into the spool is
    // processed once, recognised as a duplicate, and moved to done/.
    const spool = join(root, "spool");
    mkdirSync(join(spool, "in"), { recursive: true });
    const first = readdirSync(out0).find((f) => f.endsWith(".gmail-send.json")) as string;
    copyFileSync(join(out0, first), join(spool, "in", "replayed.gmail.json"));
    let serveOut = "";
    const code = await main(["serve", "--name", "bob", "--spool", spool, "--once", ...common], {
      stdout: (s) => (serveOut += s),
    });
    expect(code).toBe(0);
    const lines = serveOut
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ ready: true, name: "bob" });
    expect(lines[1]).toMatchObject({ file: "replayed.gmail.json", disposition: "duplicate" });
    expect(readdirSync(join(spool, "done"))).toEqual(["replayed.gmail.json"]);
    const report = JSON.parse(
      readFileSync(join(spool, "out", "replayed.gmail.json", "report.json"), "utf8"),
    );
    expect(report.step.disposition).toBe("duplicate");
  });
});
