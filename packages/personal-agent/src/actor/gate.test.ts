// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { PodFetch } from "../config.js";
import { parseProposal, serializeProposal } from "../pod/proposals.js";
import { createGate, POD_READ_TOOLS, PROPOSAL_WRITE_TOOL } from "./gate.js";
import { buildActorOptions } from "./options.js";
import { createProposalsServer } from "./proposals-server.js";

const proposals = "https://pod.example/agent/proposals/";
const target = `${proposals}p1.ttl`;
const LDP = "http://www.w3.org/ns/ldp#";
const ACP = "http://www.w3.org/ns/solid/acp#accessControl";

async function writeInput() {
  return {
    url: target,
    contentType: "text/turtle",
    content: await serializeProposal(
      {
        id: "p1",
        channel: "email",
        recipient: "alice@example.com",
        odrlAction: "distribute",
        status: "pending",
        friction: "low",
        bodyText: "Hello",
        proposedAt: "2026-10-25T10:00:00Z",
      },
      { resourceUrl: target },
    ),
  };
}

function discovery(
  options: {
    containerLink?: string;
    resourceLink?: string;
    containerBody?: string;
    resourceBody?: string;
    status?: number;
    contentType?: string;
  } = {},
) {
  return vi.fn<PodFetch>(async (input, init) => {
    expect(init?.redirect).toBe("manual");
    const container = String(input) === proposals;
    return new Response(container ? (options.containerBody ?? "") : (options.resourceBody ?? ""), {
      status: options.status ?? (container || options.resourceBody !== undefined ? 200 : 404),
      headers: {
        "content-type": options.contentType ?? "text/turtle",
        link: (container ? options.containerLink : options.resourceLink) ?? "",
      },
    });
  });
}

describe("createGate — validated proposals without control rights", () => {
  it("allows pod reads and denies built-ins and unknown tools", async () => {
    const gate = createGate({ proposalsContainer: proposals });
    for (const tool of POD_READ_TOOLS) expect((await gate(tool, {})).behavior).toBe("allow");
    for (const tool of [
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
      "mcp__pod__solid_write",
      "unknown",
    ]) {
      expect((await gate(tool, await writeInput())).behavior).toBe("deny");
    }
  });

  it("allows a validated proposal and serializes only that record", async () => {
    const fetch = discovery();
    const gate = createGate({ proposalsContainer: proposals, discoveryFetch: fetch });
    const input = await writeInput();
    input.content += '\n<urn:unrelated> <urn:predicate> "discard" .';
    const verdict = await gate(PROPOSAL_WRITE_TOOL, input);
    expect(verdict.behavior).toBe("allow");
    if (verdict.behavior !== "allow") throw new Error("expected allow");
    const written = await parseRdf(String(verdict.updatedInput?.content), "text/turtle", {
      baseIRI: target,
    });
    expect(parseProposal(written)?.id).toBe("p1");
    expect(verdict.updatedInput?.content).not.toContain("urn:unrelated");
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([proposals, target]);
  });

  it.each([
    ".acl",
    ".acr",
    ".ACL",
    "%2eacl",
    ".acr?x=1",
    ".acl#it",
  ])("denies an access-control path ending %s", async (suffix) => {
    const fetch = discovery();
    const gate = createGate({ proposalsContainer: proposals, discoveryFetch: fetch });
    expect(
      (await gate(PROPOSAL_WRITE_TOOL, { ...(await writeInput()), url: target + suffix })).behavior,
    ).toBe("deny");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "container",
    "resource",
  ] as const)("denies a nonstandard Link acl target discovered on the %s", async (source) => {
    const link = '<p1.ttl>; title="ACL, unusual name"; rel="alternate acl"';
    const fetch = discovery(
      source === "container" ? { containerLink: link } : { resourceLink: link },
    );
    const gate = createGate({ proposalsContainer: proposals, discoveryFetch: fetch });
    expect((await gate(PROPOSAL_WRITE_TOOL, await writeInput())).behavior).toBe("deny");
  });

  it.each([
    "container",
    "resource",
  ] as const)("denies an ACP accessControl link discovered on the %s", async (source) => {
    const link = `<p1.ttl>; rel="${ACP}"`;
    const fetch = discovery(
      source === "container" ? { containerLink: link } : { resourceLink: link },
    );
    expect(
      (
        await createGate({ proposalsContainer: proposals, discoveryFetch: fetch })(
          PROPOSAL_WRITE_TOOL,
          await writeInput(),
        )
      ).behavior,
    ).toBe("deny");
  });

  it.each([
    "container",
    "resource",
  ] as const)("denies an ACP RDF target discovered on the %s", async (source) => {
    const body = `<> <${ACP}> <p1.ttl> .`;
    const fetch = discovery(
      source === "container" ? { containerBody: body } : { resourceBody: body },
    );
    expect(
      (
        await createGate({ proposalsContainer: proposals, discoveryFetch: fetch })(
          PROPOSAL_WRITE_TOOL,
          await writeInput(),
        )
      ).behavior,
    ).toBe("deny");
  });

  it("denies non-RDF, malformed RDF, arbitrary RDF, and a proposal at the wrong URL", async () => {
    const gate = createGate({ proposalsContainer: proposals, discoveryFetch: discovery() });
    const valid = await writeInput();
    for (const input of [
      { ...valid, contentType: "text/plain" },
      { ...valid, content: "malformed" },
      { ...valid, content: "<> a <urn:x> ." },
      { ...valid, url: `${proposals}other.ttl` },
      { url: target },
      {},
      { content: "x" },
    ])
      expect((await gate(PROPOSAL_WRITE_TOOL, input)).behavior).toBe("deny");
  });

  it("denies container URLs, container RDF, and existing containers with resource-like URLs", async () => {
    const gate = createGate({ proposalsContainer: proposals, discoveryFetch: discovery() });
    const valid = await writeInput();
    expect((await gate(PROPOSAL_WRITE_TOOL, { ...valid, url: proposals })).behavior).toBe("deny");
    expect(
      (await gate(PROPOSAL_WRITE_TOOL, { ...valid, url: `${proposals}nested/` })).behavior,
    ).toBe("deny");
    for (const type of ["Container", "BasicContainer", "DirectContainer", "IndirectContainer"]) {
      const body = `<> a <${LDP}${type}> .`;
      expect(
        (await gate(PROPOSAL_WRITE_TOOL, { ...valid, content: valid.content + body })).behavior,
      ).toBe("deny");
      for (const fetch of [
        discovery({ resourceBody: body }),
        discovery({ resourceLink: `<${LDP}${type}>; rel="type"` }),
      ]) {
        expect(
          (
            await createGate({ proposalsContainer: proposals, discoveryFetch: fetch })(
              PROPOSAL_WRITE_TOOL,
              valid,
            )
          ).behavior,
        ).toBe("deny");
      }
    }
  });

  it("denies outside scope, traversal, decoys, and nested outside URLs", async () => {
    const gate = createGate({ proposalsContainer: proposals, discoveryFetch: discovery() });
    const valid = await writeInput();
    for (const input of [
      { ...valid, url: "https://pod.example/agent/inbox/x.ttl" },
      { ...valid, url: "https://evil.example/x.ttl" },
      { ...valid, url: `${proposals}../inbox/x.ttl` },
      { ...valid, decoy: "https://evil.example/x" },
      { ...valid, meta: { links: ["https://evil.example/x"] } },
    ])
      expect((await gate(PROPOSAL_WRITE_TOOL, input)).behavior).toBe("deny");
  });

  it("fails closed without discovery or when discovery fails", async () => {
    const valid = await writeInput();
    const unavailable: PodFetch = async () => {
      throw new Error("offline");
    };
    for (const fetch of [
      undefined,
      unavailable,
      discovery({ status: 403 }),
      discovery({ status: 302 }),
      discovery({ contentType: "text/html" }),
      discovery({ containerBody: "invalid" }),
    ]) {
      expect(
        (
          await createGate({ proposalsContainer: proposals, discoveryFetch: fetch })(
            PROPOSAL_WRITE_TOOL,
            valid,
          )
        ).behavior,
      ).toBe("deny");
    }
  });

  it("wires discovery into the SDK callback", async () => {
    const options = buildActorOptions({
      proposalsContainer: proposals,
      mcpServers: {},
      discoveryFetch: discovery(),
    });
    expect((await options.canUseTool(PROPOSAL_WRITE_TOOL, await writeInput())).behavior).toBe(
      "allow",
    );
  });

  it("validates before SDK pre-approval and again inside the real MCP write handler", async () => {
    const writeFetch = vi.fn<PodFetch>(async () => new Response(null, { status: 201 }));
    const readFetch = discovery();
    const options = buildActorOptions({
      proposalsContainer: proposals,
      mcpServers: {},
      discoveryFetch: readFetch,
    });
    expect(options.allowedTools).not.toContain(PROPOSAL_WRITE_TOOL);
    const permission = vi.spyOn(options, "canUseTool");
    const server = createProposalsServer({ proposalsContainer: proposals, readFetch, writeFetch });
    const client = new Client({ name: "actor-test", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    // SDK order: PreToolUse → pre-approval → canUseTool → dispatch. Simulate an
    // extra pre-approval so canUseTool is skipped, as in the original vulnerability.
    const dispatch = async (input: Record<string, unknown>, runHook = true) => {
      if (runHook) {
        const hook = options.hooks.PreToolUse[0]?.hooks[0];
        if (!hook) throw new Error("mandatory PreToolUse hook missing");
        const { hookSpecificOutput: verdict } = await hook({
          tool_name: PROPOSAL_WRITE_TOOL,
          tool_input: input,
        });
        if (verdict.permissionDecision === "deny") return { isError: true };
        input = verdict.updatedInput ?? input;
      }
      const preapproved = [...options.allowedTools, PROPOSAL_WRITE_TOOL];
      if (!preapproved.includes(PROPOSAL_WRITE_TOOL))
        await options.canUseTool(PROPOSAL_WRITE_TOOL, input);
      return client.callTool({ name: "solid_write", arguments: input });
    };
    try {
      const valid = await writeInput();
      for (const input of [
        { ...valid, url: `${target}.acl` },
        { ...valid, url: "https://evil.example/p1.ttl" },
        { ...valid, content: "invalid" },
        { ...valid, content: `${valid.content}\n<> a <${LDP}Container> .` },
      ]) {
        expect((await dispatch(input)).isError).toBe(true);
        // Even a client bypassing all SDK permissions must hit the implementation gate.
        expect((await dispatch(input, false)).isError).toBe(true);
      }
      expect(writeFetch).not.toHaveBeenCalled();
      expect(
        (await dispatch({ ...valid, content: `${valid.content}\n<urn:extra> <urn:p> "discard" .` }))
          .isError,
      ).not.toBe(true);
      expect(writeFetch).toHaveBeenCalledTimes(1);
      expect(writeFetch.mock.calls[0]?.[1]?.body).not.toContain("urn:extra");
      expect(permission).not.toHaveBeenCalled();
      expect((await dispatch(valid, false)).isError).not.toBe(true);
      expect(writeFetch).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
