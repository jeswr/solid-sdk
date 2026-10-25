// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `runReader` — the (thin) Reader entrypoint. It hands a {@link ChannelAdapter} (the Gmail
 * adapter, or any other) to the bridge's `importInbound`, which pulls + parses + interprets
 * each message and writes it OWNER-PRIVATE (fail-closed ACL written BEFORE any content —
 * the §7 invariant `importInbound` already enforces). The Reader has ZERO act-tools: it
 * only lands provenance-carrying RDF in the inbox. The Actor reads that RDF later.
 */
import { importInbound, } from "@jeswr/agentic-legacy-bridge";
import { buildReaderInterpreter } from "./interpreter.js";
/** Pull a channel's inbound messages into the owner-private pod inbox. */
export async function runReader(options) {
    return importInbound({
        adapter: options.adapter,
        writeFetch: options.writeFetch,
        container: options.inbox,
        ownerWebId: options.ownerWebId,
        interpreter: options.interpreter ?? buildReaderInterpreter(),
        ...(options.interpretingAgentWebId
            ? { interpretingAgentWebId: options.interpretingAgentWebId }
            : {}),
        ...(options.mandateIri ? { mandateIri: options.mandateIri } : {}),
        ...(options.now ? { now: options.now } : {}),
    });
}
//# sourceMappingURL=run.js.map