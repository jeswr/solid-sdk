import { type NodePinningOptions } from "@jeswr/guarded-fetch/node";
import { type Dispatcher } from "undici";
export { type ConnectLookup, createNodeGuardedFetch, createValidatingLookup, type NodePinningOptions, nodeGuardedFetch, type ResolveAll, } from "@jeswr/guarded-fetch/node";
/**
 * Build an `undici.Agent` that PINS each connection to a freshly-resolved, validated IP — the
 * rebinding-closing dispatcher. PROTOCOL-AWARE, restoring this package's prior posture
 * (roborev Medium): an `http:` connect uses a LOOPBACK-ONLY validating lookup so that, even
 * under `allowLoopback: true`, a plaintext `http:` request can only ever reach a loopback IP at
 * connect time — never a public host; an `https:` connect uses the standard
 * `isPublicAddress`-based lookup. Both keep TLS cert validation ON (we never pass
 * `rejectUnauthorized: false`) and forward the optional private-`ca`.
 *
 * The returned dispatcher is suitable to pass as `fetch(url, { dispatcher })` (undici), but
 * prefer {@link createNodeGuardedFetch}, which wires this together with the full SSRF guard
 * (scheme/userinfo/literal checks, redirect re-validation, body + time caps). Use this directly
 * only if you are composing your own request pipeline and already apply those checks. The Agent
 * never re-resolves a hostname for connection: our `lookup` is the sole resolver and returns
 * only pre-validated addresses, so the socket is pinned to the validated IP.
 */
export declare function createPinningDispatcher(options?: NodePinningOptions): Dispatcher;
//# sourceMappingURL=node.d.ts.map