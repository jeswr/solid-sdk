// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The LIVE Actor — the §3.3 Claude Agent SDK `query()` loop, wired to the pod through two
 * `@jeswr/solid-mcp` servers: a READ-ONLY `pod` server and a single WRITE `proposals`
 * server scoped to the proposals container (§10.2 — a second single-container instance, not
 * a global `readOnly:false`). It runs under {@link buildActorOptions}: `permissionMode:
 * "dontAsk"` + the tool allowlist + the programmatic {@link createGate}. The Actor reads
 * typed RDF and PROPOSES; it holds NO channel send tokens.
 *
 * CREDENTIAL SEAM: running this needs a billed Anthropic API key (`@anthropic-ai/claude-
 * agent-sdk` reads it) + the owner's authed pod `fetch`. It is lazily imported so the
 * package builds, typechecks, and tests WITHOUT the SDK or a key (the deterministic pass in
 * `run.ts` is the tested path). This adapter's public surface is SDK-type-free so consumers
 * that never run the live loop need no SDK dependency.
 */
import { createSolidMcpServer } from "@jeswr/solid-mcp";
import { buildActorOptions } from "./options.js";
/**
 * Build the live Actor. Constructs the two pod MCP servers + the fail-closed option set;
 * the SDK itself is imported lazily on first `run`. Throws if the optional
 * `@anthropic-ai/claude-agent-sdk` peer is not installed.
 */
export function createClaudeActor(options) {
    const podServer = createSolidMcpServer({
        fetch: options.readFetch,
        podRoot: options.podRoot,
        readOnly: true,
        ...(options.webId ? { webId: options.webId } : {}),
    });
    const proposalsServer = createSolidMcpServer({
        fetch: options.writeFetch,
        podRoot: options.proposalsContainer,
        readOnly: false,
    });
    // `{ type: "sdk", name, instance }` is the Agent SDK's in-process MCP server config.
    const mcpServers = {
        pod: { type: "sdk", name: "pod", instance: podServer },
        proposals: { type: "sdk", name: "proposals", instance: proposalsServer },
    };
    const actorOptions = buildActorOptions({
        proposalsContainer: options.proposalsContainer,
        mcpServers,
    });
    return {
        run(prompt) {
            return (async function* run() {
                const sdk = (await import("@anthropic-ai/claude-agent-sdk"));
                const iterator = sdk.query({ prompt, options: actorOptions });
                for await (const message of iterator)
                    yield message;
            })();
        },
    };
}
//# sourceMappingURL=claude-actor.js.map