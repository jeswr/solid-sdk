import type { PodFetch } from "../config.js";
/** Options for {@link createClaudeActor}. */
export interface CreateClaudeActorOptions {
    /** The pod root the Actor may READ (its read-only scope). */
    readonly podRoot: string;
    /** The proposals container the Actor may WRITE (a distinct, single-container MCP server). */
    readonly proposalsContainer: string;
    /** A pod authed `fetch` for the read-only `pod` MCP server. */
    readonly readFetch: PodFetch;
    /** A pod authed `fetch` for the proposals-write MCP server. */
    readonly writeFetch: PodFetch;
    /** The owner's WebID (best-effort Type-Index discovery in `solid_search`). */
    readonly webId?: string;
}
/** The live conversational Actor. `run` drives the SDK `query()` loop over a chat stream. */
export interface ClaudeActor {
    /** Feed a prompt (a string or an async chat stream); yields the loop's messages. */
    run(prompt: string | AsyncIterable<unknown>): AsyncIterable<unknown>;
}
/**
 * Build the live Actor. Constructs the two pod MCP servers + the fail-closed option set;
 * the SDK itself is imported lazily on first `run`. Throws if the optional
 * `@anthropic-ai/claude-agent-sdk` peer is not installed.
 */
export declare function createClaudeActor(options: CreateClaudeActorOptions): ClaudeActor;
//# sourceMappingURL=claude-actor.d.ts.map