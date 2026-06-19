// node_modules/@jeswr/guarded-fetch/dist/node.js
import { lookup as dnsLookupCb } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
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
        const wantsAll = lookupOptions?.all === true;
        if (wantsAll) {
          callback(null, addresses);
        } else {
          const first = addresses[0];
          callback(null, first.address, first.family);
        }
      },
      (err) => {
        callback(
          err instanceof Error ? err : new SsrfError(`Host did not resolve: ${hostname}.`),
          []
        );
      }
    );
  };
}
function createNodeGuardedFetch(options = {}) {
  const allowLoopback = options.allowLoopback ?? false;
  const resolveAll = options.resolveAll ?? defaultResolveAll;
  const ca = options.ca;
  const pinningFetch = async (input, init) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requireLoopbackOnly = safeIsHttp(urlStr) && allowLoopback;
    const lookup = createValidatingLookup(resolveAll, allowLoopback, requireLoopbackOnly);
    const connect = { lookup };
    if (ca !== void 0) {
      connect.ca = ca;
    }
    const agent = new Agent({ connect });
    try {
      const undiciInit = {
        ...init ?? {},
        // The guard already set redirect:"manual"; reinforce + forbid undici-level redirects.
        redirect: "manual",
        maxRedirections: 0,
        dispatcher: agent
      };
      return await undiciFetch(input, undiciInit);
    } finally {
      void agent.close().catch(() => {
      });
    }
  };
  const dnsLookup = (host) => resolveAll(host);
  return createGuardedFetch({
    ...stripNodeOnlyOptions(options),
    pinningFetch,
    requireDnsPinning: true,
    dnsLookup,
    allowLoopback
  });
}
var nodeGuardedFetch = createNodeGuardedFetch();
function stripNodeOnlyOptions(options) {
  const { resolveAll: _r, ca: _ca, allowLoopback: _al, ...rest } = options;
  return rest;
}
function safeIsHttp(u) {
  try {
    return new URL(u).protocol === "http:";
  } catch {
    return false;
  }
}

// src/node.ts
import { Agent as Agent2, buildConnector } from "undici";
import { SsrfError as SsrfError2 } from "./index.js";
var defaultResolveAll2 = (hostname) => (
  // Lazy-require node:dns so this stays a node-only concern (the module is the `./node`
  // entry, already node-only). We mirror guarded-fetch's own default resolver.
  import("node:dns").then(
    (dns) => new Promise((resolve, reject) => {
      dns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(addresses);
      });
    })
  )
);
function createPinningDispatcher(options = {}) {
  const allowLoopback = options.allowLoopback ?? false;
  const connectTimeout = options.timeoutMs ?? 1e4;
  const resolveAll = options.resolveAll ?? defaultResolveAll2;
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
  return new Agent2({
    // Custom connect (function form): undici hands us the full connect `Options`, INCLUDING
    // `protocol`, so we pick the loopback-only connector for an `http:` hop and the standard
    // public connector for `https:`. undici sets `opts.servername` to the request hostname, so
    // TLS SNI + cert validation stay against the original host while our lookup steers the
    // (pinned) IP. The Agent does NOT follow redirects on its own — the shared guard re-pins
    // each hop through a fresh request — so a 30x to a private IP is blocked at the next hop.
    connect(opts, cb) {
      if (opts.protocol === "http:" && !allowLoopback) {
        cb(new SsrfError2("http: is refused unless allowLoopback is set (dev only)."), null);
        return;
      }
      const connector = opts.protocol === "http:" ? loopbackOnlyConnector : httpsConnector;
      connector(opts, cb);
    }
  });
}
export {
  createNodeGuardedFetch,
  createPinningDispatcher,
  createValidatingLookup,
  nodeGuardedFetch
};
//# sourceMappingURL=node.js.map
