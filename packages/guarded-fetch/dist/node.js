// src/node.ts
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
function createPinningDispatcher(options = {}) {
  const allowLoopback = options.allowLoopback ?? false;
  const resolveAll = options.resolveAll ?? defaultResolveAll;
  const lookup = createValidatingLookup(resolveAll, allowLoopback, false);
  const connect = { lookup };
  if (options.ca !== void 0) {
    connect.ca = options.ca;
  }
  return new Agent({ connect });
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
export {
  createNodeGuardedFetch,
  createPinningDispatcher,
  createValidatingLookup,
  nodeGuardedFetch
};
//# sourceMappingURL=node.js.map
