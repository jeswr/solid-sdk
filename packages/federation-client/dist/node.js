// src/node.ts
import { lookup as dnsLookupCb } from "node:dns";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import {
  createGuardedFetch,
  isLoopbackAddress,
  isPublicAddress,
  SsrfError
} from "./index.js";
var defaultResolveAll = (hostname) => new Promise((resolve, reject) => {
  dnsLookupCb(hostname, { all: true }, (err, addresses) => {
    if (err) {
      reject(err);
      return;
    }
    resolve(addresses);
  });
});
function createValidatingLookup(resolveAll, allowLoopback, requireLoopbackOnly) {
  return (hostname, lookupOptions, callback) => {
    resolveAll(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(
            new SsrfError(`Host resolved to no addresses: ${hostname}.`),
            []
          );
          return;
        }
        for (const a of addresses) {
          const ok = requireLoopbackOnly ? isLoopbackAddress(a.address) : isPublicAddress(a.address, allowLoopback);
          if (!ok) {
            const why = requireLoopbackOnly ? "is not loopback (http: requires loopback-only)" : "is a non-public address";
            callback(
              new SsrfError(
                `Connection refused \u2014 ${hostname} resolves to an address that ${why} (${a.address}).`
              ),
              []
            );
            return;
          }
        }
        const first = addresses[0];
        if (lookupOptions?.all === true) {
          callback(null, addresses);
          return;
        }
        callback(null, first.address, first.family);
      },
      (err) => {
        callback(
          new SsrfError(`Host did not resolve: ${hostname}: ${message(err)}`, {
            cause: err
          }),
          []
        );
      }
    );
  };
}
function createPinningDispatcher(options = {}) {
  const allowLoopback = options.allowLoopback ?? false;
  const connectTimeout = options.timeoutMs ?? 1e4;
  const resolveAll = options.resolveAll ?? defaultResolveAll;
  const makeLookup = (requireLoopbackOnly) => createValidatingLookup(resolveAll, allowLoopback, requireLoopbackOnly);
  const tlsBase = {
    timeout: connectTimeout,
    ...options.ca !== void 0 ? { ca: options.ca } : {}
  };
  const httpsConnector = buildConnector({ ...tlsBase, lookup: makeLookup(false) });
  const loopbackOnlyConnector = buildConnector({
    ...tlsBase,
    lookup: makeLookup(true)
  });
  return new Agent({
    // NOTE on redirects: the Agent dispatcher does NOT follow redirects on its own —
    // undici's `fetch` honours the request `redirect` mode, and the shared guard sets
    // `redirect: "manual"` on every request it issues through us, then re-validates +
    // re-pins each `Location` hop as a fresh request through this same dispatcher. So a
    // 30x to a private IP is blocked at the next hop's lookup, never auto-followed.
    //
    // Custom connect (function form): undici hands us the full connect `Options`,
    // INCLUDING `protocol`, so we pick the loopback-only connector for an `http:` hop and
    // the standard public connector for `https:`. undici sets `opts.servername` to the
    // request hostname, so TLS SNI + cert validation stay against the original host while
    // our lookup steers the (pinned) IP.
    connect(opts, cb) {
      const connector = opts.protocol === "http:" ? loopbackOnlyConnector : httpsConnector;
      connector(opts, cb);
    }
  });
}
function createNodeGuardedFetch(options = {}) {
  const resolveAll = options.resolveAll ?? defaultResolveAll;
  const dispatcher = createPinningDispatcher({ ...options, resolveAll });
  const pinningFetch = (input, init) => {
    const undiciInit = {
      ...init,
      dispatcher
    };
    return undiciFetch(
      input,
      undiciInit
    );
  };
  return createGuardedFetch({
    ...options,
    // Share ONE resolver across both layers: the guard's URL-level DNS classification AND
    // the connect-time pin use the same `resolveAll`, so the host the guard validated is
    // the host the socket pins to (no divergent resolver could disagree). Defaults to
    // `node:dns` — identical to the guard's own Node branch — and is injectable for tests.
    dnsLookup: resolveAll,
    // The guard re-resolves + re-classifies the host on the initial request AND each
    // redirect hop, then issues the validated request through `pinningFetch`, which
    // re-resolves + validates + PINS at connect time. Two independent resolutions, both
    // validated — the second one pins, closing the gap the first cannot.
    pinningFetch,
    // Strict posture: a hostname is allowed ONLY because we supplied a branded
    // pinningFetch. A plain fetch could never satisfy this — so the rebinding window can
    // never be silently re-opened by swapping the fetch.
    requireDnsPinning: true
  });
}
var nodeGuardedFetch = createNodeGuardedFetch();
function message(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
export {
  createNodeGuardedFetch,
  createPinningDispatcher,
  createValidatingLookup,
  nodeGuardedFetch
};
//# sourceMappingURL=node.js.map
