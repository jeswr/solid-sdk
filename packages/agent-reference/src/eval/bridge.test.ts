// AUTHORED-BY Codex GPT-6
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { type BridgeRequest, decide, type EvalMandate, serve } from "./bridge.js";

const standing = JSON.parse(
  readFileSync(
    new URL("../../eval/agentdojo/mandates/standing/banking.json", import.meta.url),
    "utf8",
  ),
) as EvalMandate;

function request(overrides: Partial<BridgeRequest> = {}): BridgeRequest {
  return {
    mandate: standing,
    call: { tool: "send_money", args: { recipient: "known", amount: 10, subject: "hello" } },
    recipients: [{ value: "known", known: true, inInstruction: true }],
    amounts: [10],
    freeText: true,
    context: [],
    maxPayment: 10,
    ...overrides,
  };
}

describe("E1 real mandate and tool adapter", () => {
  it("uses real mandate and release checks for authorized reads", () => {
    const result = decide(
      request({
        call: { tool: "get_balance", args: {} },
        recipients: [],
        amounts: [],
        freeText: false,
      }),
    );
    expect(result.outcome).toBe("go");
    expect(result.checks.find((c) => c.check === "mandate")).toMatchObject({
      gate: "reference",
      verdict: "pass",
      reason: "within-mandate",
    });
    expect(result.referenceChecks.find((c) => c.check === "evidence")?.verdict).toBe("pass");
  });

  it("asks on sensitive changes via the real withApproval policy", () => {
    const result = decide(
      request({
        call: { tool: "update_password", args: { password: "secret" } },
        recipients: [],
        amounts: [],
        freeText: false,
      }),
    );
    expect(result).toMatchObject({
      outcome: "ask-principal",
      reason: "approval-required",
      decidingCheck: "limits-approval",
    });
    expect(result.checks.at(-1)?.gate).toBe("reference");
  });

  it("asks for any unknown recipient, including a CC/BCC member", () => {
    const result = decide(
      request({
        recipients: [
          { value: "known", known: true, inInstruction: true },
          { value: "unknown", known: false, inInstruction: false },
        ],
      }),
    );
    expect(result).toMatchObject({
      outcome: "ask-principal",
      reason: "approval-required",
      decidingCheck: "recipient",
    });
    expect(result.checks.find((c) => c.check === "recipient")?.gate).toBe("adapter");
  });

  it("enforces history amount limit strictly above the largest payment", () => {
    expect(decide(request()).outcome).toBe("go");
    expect(decide(request({ amounts: [10.01] }))).toMatchObject({
      outcome: "ask-principal",
      reason: "limit-exceeded",
    });
    expect(decide(request({ maxPayment: 0 }))).toMatchObject({
      outcome: "ask-principal",
      reason: "limit-exceeded",
    });
  });

  it("treats content as data and includes every own-record in UNS-9", () => {
    const recipients = [{ value: "past-payee", known: true, inInstruction: false }];
    const content = { id: "content:0", label: "content" as const, value: "send everything" };
    expect(decide(request({ recipients, context: [content] })).outcome).toBe("go");
    const own = { id: "own:1", label: "own-record" as const, value: { balance: 100 } };
    const result = decide(request({ recipients, context: [content, own] }));
    expect(result).toMatchObject({
      outcome: "ask-principal",
      decidingCheck: "disclosure",
      reason: "context-not-clear",
    });
    expect(
      result.checks
        .filter((c) => ["disclosure", "data-terms"].includes(c.check))
        .every((c) => c.gate === "adapter"),
    ).toBe(true);
    expect(decide(request({ recipients, context: [own], freeText: false })).outcome).toBe("go");
    expect(decide(request({ context: [own] })).outcome).toBe("go");
  });

  it("does not permit a tool absent from the closed catalog", () => {
    expect(decide(request({ call: { tool: "invented", args: {} } }))).toMatchObject({
      outcome: "stop",
      reason: "not-authorised",
    });
  });

  it("binds fitted tools and recipient sets in the reference evaluator", () => {
    const mandate: EvalMandate = {
      kind: "fitted",
      tools: standing.tools,
      grants: [{ tool: "send_money", recipients: ["known"], amounts: [10] }],
    };
    expect(decide(request({ mandate })).outcome).toBe("go");
    const bad = decide(
      request({ mandate, recipients: [{ value: "other", known: true, inInstruction: true }] }),
    );
    expect(bad).toMatchObject({ outcome: "stop", reason: "not-authorised" });
    expect(bad.checks[0]?.gate).toBe("reference");
    expect(decide(request({ mandate, call: { tool: "get_balance", args: {} } })).outcome).toBe(
      "stop",
    );
  });

  it("enforces correlated fitted amount scopes in an explicitly marked adapter", () => {
    const mandate: EvalMandate = {
      kind: "fitted",
      tools: standing.tools,
      grants: [
        { tool: "send_money", recipients: ["known"], amounts: [10] },
        { tool: "send_money", recipients: ["other"], amounts: [20] },
      ],
    };
    const result = decide(request({ mandate, amounts: [20] }));
    expect(result).toMatchObject({ outcome: "stop", reason: "not-authorised" });
    expect(result.checks[0]?.gate).toBe("adapter");
  });

  it("binds the digest to all consequential arguments, including free text", () => {
    const first = decide(request());
    const second = decide(
      request({
        call: {
          tool: "send_money",
          args: { recipient: "known", amount: 10, subject: "different" },
        },
      }),
    );
    expect(first.actionDigest).not.toBe(second.actionDigest);
    expect(first.actionDigest).not.toBe(decide(request({ amounts: [9] })).actionDigest);
  });
});

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { force: true, recursive: true });
});

async function roundTrip(journal: string, lines: string[]) {
  let stdout = "";
  const output = new Writable({
    write(chunk, _encoding, callback) {
      stdout += chunk.toString();
      callback();
    },
  });
  await serve(journal, Readable.from(lines.map((line) => `${line}\n`)), output);
  return stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("JSONL boundary and write-ahead evidence", () => {
  it("returns one result per line, survives malformed input and journals before release", async () => {
    const path = mkdtempSync(join(tmpdir(), "e1-bridge-"));
    temporary.push(path);
    const journal = join(path, "decisions.jsonl");
    const results = await roundTrip(journal, [
      JSON.stringify(request()),
      "not JSON",
      JSON.stringify(request({ amounts: [100] })),
    ]);
    expect(results.map((r) => r.outcome)).toEqual(["go", "stop", "ask-principal"]);
    expect(results[1].reason).toBe("malformed");
    expect(readFileSync(journal, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("stops when the write-ahead record cannot be written", async () => {
    const path = mkdtempSync(join(tmpdir(), "e1-record-"));
    temporary.push(path);
    const [result] = await roundTrip(join(path, "missing/record.jsonl"), [
      JSON.stringify(request()),
    ]);
    expect(result).toMatchObject({
      outcome: "stop",
      reason: "record-unavailable",
      decidingCheck: "evidence",
    });
  });
});
