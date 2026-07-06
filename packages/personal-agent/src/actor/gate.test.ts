// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import { createGate, POD_READ_TOOLS, PROPOSAL_WRITE_TOOL } from "./gate.js";

const proposals = "https://pod.example/agent/proposals/";
const gate = createGate({ proposalsContainer: proposals });

describe("createGate — the Actor canUseTool fence (fail-closed)", () => {
  it("allows every read-only pod tool", () => {
    for (const tool of POD_READ_TOOLS) {
      expect(gate(tool, {}).behavior).toBe("allow");
    }
  });

  it("denies every dangerous built-in and any unknown tool", () => {
    const denied = [
      "Bash",
      "Write",
      "Edit",
      "MultiEdit",
      "Read",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch",
      "Task",
      "NotebookEdit",
      "mcp__pod__solid_write", // write on the READ-ONLY pod server is not the proposals server
      "mcp__evil__anything",
      "totally_unknown_tool",
    ];
    for (const tool of denied) {
      expect(gate(tool, { command: "rm -rf /", url: `${proposals}p.ttl` }).behavior).toBe("deny");
    }
  });

  it("allows a proposals-scoped write", () => {
    const decision = gate(PROPOSAL_WRITE_TOOL, {
      url: `${proposals}p1.ttl`,
      content: "<> a <urn:x> .",
      contentType: "text/turtle",
    });
    expect(decision.behavior).toBe("allow");
  });

  it("denies a write targeting another container or origin", () => {
    expect(
      gate(PROPOSAL_WRITE_TOOL, { url: "https://pod.example/agent/inbox/x.ttl" }).behavior,
    ).toBe("deny");
    expect(gate(PROPOSAL_WRITE_TOOL, { url: "https://evil.example/x.ttl" }).behavior).toBe("deny");
  });

  it("denies a write that resolves out of the container via ../ traversal", () => {
    expect(gate(PROPOSAL_WRITE_TOOL, { url: `${proposals}../inbox/secret.ttl` }).behavior).toBe(
      "deny",
    );
  });

  it("denies a write carrying no in-scope target URL", () => {
    expect(gate(PROPOSAL_WRITE_TOOL, { content: "x" }).behavior).toBe("deny");
    expect(gate(PROPOSAL_WRITE_TOOL, {}).behavior).toBe("deny");
  });

  it("denies a write mixing an in-scope decoy with an out-of-scope URL (ALL must be in scope)", () => {
    const decision = gate(PROPOSAL_WRITE_TOOL, {
      url: `${proposals}p1.ttl`,
      exfil: "https://evil.example/steal",
    });
    expect(decision.behavior).toBe("deny");
  });
});
