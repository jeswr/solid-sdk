// src/node.ts
import { lookup as dnsLookupCb } from "node:dns";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import {
  classifyIpLiteral,
  createGuardedFetch,
  isLoopbackAddress,
  isPublicAddress,
  SsrfError
} from "./index.js";
import { RedirectRefusedError, refuseRedirects } from "./index.js";
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
  const tlsBase = {};
  if (options.ca !== void 0) {
    tlsBase.ca = options.ca;
  }
  const httpsConnector = buildConnector({
    ...tlsBase,
    lookup: createValidatingLookup(resolveAll, allowLoopback, false)
  });
  const httpLoopbackConnector = buildConnector({
    ...tlsBase,
    lookup: createValidatingLookup(resolveAll, allowLoopback, true)
  });
  return new Agent({
    // Custom connect (function form): undici hands us the full connect `Options`, INCLUDING
    // `protocol`, so we (a) REFUSE `http:` outright unless allowLoopback — the scheme gate that
    // fires for every connection incl. an IP-literal target undici would dial without a lookup —
    // (b) validate an IP-LITERAL host directly (the lookup is skipped for a literal), and
    // (c) pick the loopback-only connector for a permitted `http:` hop and the standard public
    // connector for `https:`. undici sets `opts.servername` to the request hostname, so TLS SNI +
    // cert validation stay against the original host while our lookup steers the (pinned) IP. The
    // dispatcher never follows redirects itself — the shared guard re-validates + re-pins each
    // `Location` hop as a fresh request through this same dispatcher.
    connect(opts, cb) {
      if (opts.protocol === "http:" && !allowLoopback) {
        cb(
          new SsrfError(
            `Connection refused \u2014 http: is permitted only under allowLoopback (dev); ${opts.hostname} is plaintext and not reachable in the default posture.`
          ),
          null
        );
        return;
      }
      if (classifyIpLiteral(opts.hostname) !== 0) {
        const literalOk = opts.protocol === "http:" ? isLoopbackAddress(opts.hostname) : isPublicAddress(opts.hostname, allowLoopback);
        if (!literalOk) {
          const why = opts.protocol === "http:" ? "is not loopback (http: requires loopback-only)" : "is a non-public address";
          cb(
            new SsrfError(`Connection refused \u2014 ${opts.hostname} ${why} (IP-literal target).`),
            null
          );
          return;
        }
      }
      const connector = opts.protocol === "http:" ? httpLoopbackConnector : httpsConnector;
      connector(opts, cb);
    }
  });
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
  RedirectRefusedError,
  createNodeGuardedFetch,
  createPinningDispatcher,
  createValidatingLookup,
  nodeGuardedFetch,
  refuseRedirects
};
//# sourceMappingURL=node.js.map
