// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `runReader` — the (thin) Reader entrypoint. It hands a {@link ChannelAdapter} (the Gmail
 * adapter, or any other) to the bridge's `importInbound`, which pulls + parses + interprets
 * each message and writes it OWNER-PRIVATE (fail-closed ACL written BEFORE any content —
 * the §7 invariant `importInbound` already enforces). The Reader has ZERO act-tools: it
 * only lands provenance-carrying RDF in the inbox. The Actor reads that RDF later.
 */
import {
  type ChannelAdapter,
  type ImportInboundResult,
  type Interpreter,
  importInbound,
} from "@jeswr/agentic-legacy-bridge";
import type { PodFetch } from "../config.js";
import { buildReaderInterpreter } from "./interpreter.js";

/** Options for {@link runReader}. */
export interface RunReaderOptions {
  /** The channel adapter to pull from (e.g. `GmailChannelAdapter`). */
  readonly adapter: ChannelAdapter;
  /** The pod authed `fetch` for the owner-private inbox writes. */
  readonly writeFetch: PodFetch;
  /** The owner-private inbox container (locked ACL-first by `importInbound`). */
  readonly inbox: string;
  /** The pod owner's WebID (granted full control by the owner-only ACL). */
  readonly ownerWebId: string;
  /** The interpreter (defaults to the deterministic-first §5 chain). */
  readonly interpreter?: Interpreter;
  /** The interpreting agent's WebID (`prov:wasAssociatedWith` on each interpretation). */
  readonly interpretingAgentWebId?: string;
  /** The ODRL mandate the interpreting agent acts under (`prov:hadPlan`). */
  readonly mandateIri?: string;
  /** "Now" for relative-date resolution (deterministic tests). */
  readonly now?: Date;
}

/** Pull a channel's inbound messages into the owner-private pod inbox. */
export async function runReader(options: RunReaderOptions): Promise<ImportInboundResult> {
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
