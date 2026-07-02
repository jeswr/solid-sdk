var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/@jeswr/guarded-fetch/dist/index.js
function classifyIpLiteral(value) {
  if (isIpv4Literal(value)) {
    return 4;
  }
  if (isIpv6Literal(value)) {
    return 6;
  }
  return 0;
}
function isIpv4Literal(value) {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }
  for (const part of parts) {
    if (!IPV4_OCTET.test(part)) {
      return false;
    }
    if (Number.parseInt(part, 10) > 255) {
      return false;
    }
  }
  return true;
}
function isIpv6Literal(value) {
  const pct = value.indexOf("%");
  if (pct !== -1) {
    const zone = value.slice(pct + 1);
    if (zone.length === 0 || zone.includes("%")) {
      return false;
    }
    return isIpv6Literal(value.slice(0, pct));
  }
  if (value.length === 0 || /[^0-9a-fA-F:.]/.test(value)) {
    return false;
  }
  const compressionMatches = value.match(/::/g);
  if (compressionMatches && compressionMatches.length > 1) {
    return false;
  }
  const hasCompression = value.includes("::");
  let core = value;
  let embeddedV4Groups = 0;
  const lastColon = value.lastIndexOf(":");
  const dot = value.indexOf(".");
  if (dot !== -1) {
    if (lastColon === -1 || lastColon > dot) {
      return false;
    }
    const v4 = value.slice(lastColon + 1);
    if (!isIpv4Literal(v4)) {
      return false;
    }
    core = value.slice(0, lastColon + 1);
    embeddedV4Groups = 2;
  }
  const requiredGroups = 8 - embeddedV4Groups;
  if (hasCompression) {
    const idx = core.indexOf("::");
    const headStr = core.slice(0, idx);
    let tailStr = core.slice(idx + 2);
    if (embeddedV4Groups > 0 && tailStr.endsWith(":")) {
      tailStr = tailStr.slice(0, -1);
    }
    const head = headStr === "" ? [] : headStr.split(":");
    const tail = tailStr === "" ? [] : tailStr.split(":");
    if (!head.every(isHextet) || !tail.every(isHextet)) {
      return false;
    }
    if (head.length + tail.length >= requiredGroups) {
      return false;
    }
    return true;
  }
  let groupsStr = core;
  if (embeddedV4Groups > 0 && groupsStr.endsWith(":")) {
    groupsStr = groupsStr.slice(0, -1);
  }
  const groups = groupsStr === "" ? [] : groupsStr.split(":");
  if (groups.length !== requiredGroups) {
    return false;
  }
  return groups.every(isHextet);
}
function isHextet(group) {
  return /^[0-9a-fA-F]{1,4}$/.test(group);
}
function isPublicAddress(address, allowLoopback) {
  let addr;
  try {
    addr = import_ipaddr.default.parse(address);
  } catch {
    return false;
  }
  if (addr.kind() === "ipv4") {
    return isPublicIpv4(addr, allowLoopback);
  }
  return isPublicIpv6(addr, allowLoopback);
}
function isPublicIpv4(addr, allowLoopback) {
  const range = addr.range();
  if (range === "loopback") {
    return allowLoopback;
  }
  return range === PUBLIC_IPV4_RANGE;
}
function isPublicIpv6(addr, allowLoopback) {
  const range = addr.range();
  if (range === "loopback") {
    return allowLoopback;
  }
  if (range === "ipv4Mapped") {
    return isPublicIpv4(addr.toIPv4Address(), allowLoopback);
  }
  if (range === "6to4") {
    const v4 = embeddedV4(addr, 2);
    return v4 !== void 0 && isPublicIpv4FromBytes(v4, allowLoopback);
  }
  if (range === "rfc6052") {
    const v4 = embeddedV4(addr, 12);
    return v4 !== void 0 && isPublicIpv4FromBytes(v4, allowLoopback);
  }
  return PUBLIC_IPV6_RANGES.has(range);
}
function embeddedV4(addr, startByte) {
  const bytes = addr.toByteArray();
  if (bytes.length !== 16) {
    return void 0;
  }
  const v4Bytes = bytes.slice(startByte, startByte + 4);
  if (v4Bytes.length !== 4) {
    return void 0;
  }
  try {
    return new import_ipaddr.default.IPv4(v4Bytes);
  } catch {
    return void 0;
  }
}
function isPublicIpv4FromBytes(addr, allowLoopback) {
  const range = addr.range();
  if (range === "loopback") {
    return allowLoopback;
  }
  return range === PUBLIC_IPV4_RANGE;
}
function isLoopbackAddress(address) {
  let addr;
  try {
    addr = import_ipaddr.default.parse(address);
  } catch {
    return false;
  }
  if (addr.kind() === "ipv4") {
    return addr.range() === "loopback";
  }
  const v6 = addr;
  if (v6.range() === "loopback") {
    return true;
  }
  if (v6.range() === "ipv4Mapped") {
    return v6.toIPv4Address().range() === "loopback";
  }
  return false;
}
async function loadNodeDnsLookup() {
  let mod;
  try {
    mod = await import(
      /* @vite-ignore */
      NODE_DNS_SPECIFIER
    );
  } catch (cause) {
    throw new NodeDnsUnavailableError(`node:dns/promises is not importable: ${message(cause)}`, {
      cause
    });
  }
  return (host) => mod.lookup(host, { all: true });
}
function createGuardedFetch(options = {}) {
  const guard = new SsrfGuard(options);
  return (input, init) => guard.fetch(input, init);
}
function isDeniedHostname(hostname, denylist) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const raw of denylist) {
    const entry = raw.toLowerCase();
    if (entry.startsWith(".")) {
      if (host === entry.slice(1) || host.endsWith(entry)) {
        return true;
      }
    } else if (host === entry || host.endsWith(`.${entry}`)) {
      return true;
    }
  }
  return false;
}
function normalizeHostForClassification(hostname) {
  const stripped = hostname.replace(/^\[|\]$/g, "");
  if (classifyIpLiteral(stripped) !== 0) {
    return stripped;
  }
  try {
    const reparsed = new URL(`http://${stripped}/`).hostname.replace(/^\[|\]$/g, "");
    return reparsed.toLowerCase();
  } catch {
    return stripped.toLowerCase();
  }
}
function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
function isNullBodyStatus(status) {
  return status === 101 || status === 204 || status === 205 || status === 304;
}
function isBodyBearingStatus(status) {
  return status >= 200 && status < 300 && status !== 204 && status !== 205;
}
function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
function safeProtocol(u) {
  try {
    return new URL(u).protocol;
  } catch {
    return "";
  }
}
function rewriteInitForRedirect(init, status, crossOrigin) {
  const method = (init.method ?? "GET").toUpperCase();
  const methodChanges = status === 303 || (status === 301 || status === 302) && method !== "GET" && method !== "HEAD";
  const dropBody = methodChanges || crossOrigin;
  const headers = new Headers(init.headers ?? {});
  if (crossOrigin) {
    for (const name of CREDENTIAL_HEADERS) {
      headers.delete(name);
    }
  }
  if (dropBody) {
    for (const name of CONTENT_HEADERS) {
      headers.delete(name);
    }
  }
  const kept = {};
  headers.forEach((value, key) => {
    kept[key] = value;
  });
  const {
    body: _body,
    duplex: _duplex,
    method: _method,
    ...rest
  } = init;
  const next = { ...rest, headers: kept };
  if (methodChanges) {
    next.method = "GET";
  } else if (init.method !== void 0) {
    next.method = init.method;
    if (!dropBody && init.body !== void 0) {
      next.body = init.body;
      const duplex = init.duplex;
      if (duplex !== void 0) {
        next.duplex = duplex;
      }
    }
  }
  return next;
}
function normalizeRequest(input, init) {
  if (typeof input === "string") {
    return { url: input, init };
  }
  if (input instanceof URL) {
    return { url: input.toString(), init };
  }
  const req = input;
  const fromRequest = {
    method: req.method,
    headers: req.headers,
    credentials: req.credentials,
    redirect: req.redirect,
    ...req.signal ? { signal: req.signal } : {},
    ...req.body ? { body: req.body, duplex: "half" } : {}
  };
  return { url: req.url, init: { ...fromRequest, ...init ?? {} } };
}
function hasNodeDns() {
  return typeof process !== "undefined" && process.versions !== void 0 && process.versions.node !== void 0;
}
function isBrowserContext() {
  const g = globalThis;
  return typeof g.window !== "undefined" && g.window === globalThis && typeof g.document !== "undefined" && g.document !== null;
}
function message(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
var __create, __defProp2, __getOwnPropDesc, __getOwnPropNames2, __getProtoOf, __hasOwnProp, __commonJS, __copyProps, __toESM, require_ipaddr, import_ipaddr, IPV4_OCTET, PUBLIC_IPV4_RANGE, PUBLIC_IPV6_RANGES, SsrfError, GuardError, DEFAULT_HOSTNAME_DENYLIST, DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_REDIRECTS, NODE_DNS_SPECIFIER, NodeDnsUnavailableError, SsrfGuard, CREDENTIAL_HEADERS, CONTENT_HEADERS;
var init_dist = __esm({
  "node_modules/@jeswr/guarded-fetch/dist/index.js"() {
    __create = Object.create;
    __defProp2 = Object.defineProperty;
    __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    __getOwnPropNames2 = Object.getOwnPropertyNames;
    __getProtoOf = Object.getPrototypeOf;
    __hasOwnProp = Object.prototype.hasOwnProperty;
    __commonJS = (cb, mod) => function __require() {
      return mod || (0, cb[__getOwnPropNames2(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    };
    __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames2(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    require_ipaddr = __commonJS({
      "node_modules/ipaddr.js/lib/ipaddr.js"(exports, module) {
        (function(root) {
          "use strict";
          const ipv4Part = "(0?\\d+|0x[a-f0-9]+)";
          const ipv4Regexes = {
            fourOctet: new RegExp(`^${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}$`, "i"),
            threeOctet: new RegExp(`^${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}$`, "i"),
            twoOctet: new RegExp(`^${ipv4Part}\\.${ipv4Part}$`, "i"),
            longValue: new RegExp(`^${ipv4Part}$`, "i")
          };
          const octalRegex = new RegExp(`^0[0-7]+$`, "i");
          const hexRegex = new RegExp(`^0x[a-f0-9]+$`, "i");
          const zoneIndex = "%[0-9a-z]{1,}";
          const ipv6Part = "(?:[0-9a-f]+::?)+";
          const ipv6Regexes = {
            zoneIndex: new RegExp(zoneIndex, "i"),
            "native": new RegExp(`^(::)?(${ipv6Part})?([0-9a-f]+)?(::)?(${zoneIndex})?$`, "i"),
            deprecatedTransitional: new RegExp(`^(?:::)(${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}(${zoneIndex})?)$`, "i"),
            transitional: new RegExp(`^((?:${ipv6Part})|(?:::)(?:${ipv6Part})?)${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}(${zoneIndex})?$`, "i")
          };
          function expandIPv6(string, parts) {
            if (string.indexOf("::") !== string.lastIndexOf("::")) {
              return null;
            }
            let colonCount = 0;
            let lastColon = -1;
            let zoneId = (string.match(ipv6Regexes.zoneIndex) || [])[0];
            let replacement, replacementCount;
            if (zoneId) {
              zoneId = zoneId.substring(1);
              string = string.replace(/%.+$/, "");
            }
            while ((lastColon = string.indexOf(":", lastColon + 1)) >= 0) {
              colonCount++;
            }
            if (string.substr(0, 2) === "::") {
              colonCount--;
            }
            if (string.substr(-2, 2) === "::") {
              colonCount--;
            }
            if (colonCount > parts) {
              return null;
            }
            replacementCount = parts - colonCount;
            replacement = ":";
            while (replacementCount--) {
              replacement += "0:";
            }
            string = string.replace("::", replacement);
            if (string[0] === ":") {
              string = string.slice(1);
            }
            if (string[string.length - 1] === ":") {
              string = string.slice(0, -1);
            }
            parts = function() {
              const ref = string.split(":");
              const results = [];
              for (let i = 0; i < ref.length; i++) {
                results.push(parseInt(ref[i], 16));
              }
              return results;
            }();
            return {
              parts,
              zoneId
            };
          }
          function matchCIDR(first, second, partSize, cidrBits) {
            if (first.length !== second.length) {
              throw new Error("ipaddr: cannot match CIDR for objects with different lengths");
            }
            let part = 0;
            let shift;
            while (cidrBits > 0) {
              shift = partSize - cidrBits;
              if (shift < 0) {
                shift = 0;
              }
              if (first[part] >> shift !== second[part] >> shift) {
                return false;
              }
              cidrBits -= partSize;
              part += 1;
            }
            return true;
          }
          function parseIntAuto(string) {
            if (hexRegex.test(string)) {
              return parseInt(string, 16);
            }
            if (string[0] === "0" && !isNaN(parseInt(string[1], 10))) {
              if (octalRegex.test(string)) {
                return parseInt(string, 8);
              }
              throw new Error(`ipaddr: cannot parse ${string} as octal`);
            }
            return parseInt(string, 10);
          }
          function padPart(part, length) {
            while (part.length < length) {
              part = `0${part}`;
            }
            return part;
          }
          const ipaddr2 = {};
          ipaddr2.IPv4 = function() {
            function IPv4(octets) {
              if (octets.length !== 4) {
                throw new Error("ipaddr: ipv4 octet count should be 4");
              }
              let i, octet;
              for (i = 0; i < octets.length; i++) {
                octet = octets[i];
                if (!(0 <= octet && octet <= 255)) {
                  throw new Error("ipaddr: ipv4 octet should fit in 8 bits");
                }
              }
              this.octets = octets;
            }
            IPv4.prototype.SpecialRanges = {
              unspecified: [[new IPv4([0, 0, 0, 0]), 8]],
              broadcast: [[new IPv4([255, 255, 255, 255]), 32]],
              // RFC3171
              multicast: [[new IPv4([224, 0, 0, 0]), 4]],
              // RFC3927
              linkLocal: [[new IPv4([169, 254, 0, 0]), 16]],
              // RFC5735
              loopback: [[new IPv4([127, 0, 0, 0]), 8]],
              // RFC6598
              carrierGradeNat: [[new IPv4([100, 64, 0, 0]), 10]],
              // RFC1918
              "private": [
                [new IPv4([10, 0, 0, 0]), 8],
                [new IPv4([172, 16, 0, 0]), 12],
                [new IPv4([192, 168, 0, 0]), 16]
              ],
              // Reserved and testing-only ranges; RFCs 5735, 5737, 2544, 1700
              reserved: [
                [new IPv4([192, 0, 0, 0]), 24],
                [new IPv4([192, 0, 2, 0]), 24],
                [new IPv4([192, 88, 99, 0]), 24],
                [new IPv4([198, 18, 0, 0]), 15],
                [new IPv4([198, 51, 100, 0]), 24],
                [new IPv4([203, 0, 113, 0]), 24],
                [new IPv4([240, 0, 0, 0]), 4]
              ],
              // RFC7534, RFC7535
              as112: [
                [new IPv4([192, 175, 48, 0]), 24],
                [new IPv4([192, 31, 196, 0]), 24]
              ],
              // RFC7450
              amt: [
                [new IPv4([192, 52, 193, 0]), 24]
              ]
            };
            IPv4.prototype.kind = function() {
              return "ipv4";
            };
            IPv4.prototype.match = function(other, cidrRange) {
              let ref;
              if (cidrRange === void 0) {
                ref = other;
                other = ref[0];
                cidrRange = ref[1];
              }
              if (other.kind() !== "ipv4") {
                throw new Error("ipaddr: cannot match ipv4 address with non-ipv4 one");
              }
              return matchCIDR(this.octets, other.octets, 8, cidrRange);
            };
            IPv4.prototype.prefixLengthFromSubnetMask = function() {
              let cidr = 0;
              let stop = false;
              const zerotable = {
                0: 8,
                128: 7,
                192: 6,
                224: 5,
                240: 4,
                248: 3,
                252: 2,
                254: 1,
                255: 0
              };
              let i, octet, zeros;
              for (i = 3; i >= 0; i -= 1) {
                octet = this.octets[i];
                if (octet in zerotable) {
                  zeros = zerotable[octet];
                  if (stop && zeros !== 0) {
                    return null;
                  }
                  if (zeros !== 8) {
                    stop = true;
                  }
                  cidr += zeros;
                } else {
                  return null;
                }
              }
              return 32 - cidr;
            };
            IPv4.prototype.range = function() {
              return ipaddr2.subnetMatch(this, this.SpecialRanges);
            };
            IPv4.prototype.toByteArray = function() {
              return this.octets.slice(0);
            };
            IPv4.prototype.toIPv4MappedAddress = function() {
              return ipaddr2.IPv6.parse(`::ffff:${this.toString()}`);
            };
            IPv4.prototype.toNormalizedString = function() {
              return this.toString();
            };
            IPv4.prototype.toString = function() {
              return this.octets.join(".");
            };
            return IPv4;
          }();
          ipaddr2.IPv4.broadcastAddressFromCIDR = function(string) {
            try {
              const cidr = this.parseCIDR(string);
              const ipInterfaceOctets = cidr[0].toByteArray();
              const subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
              const octets = [];
              let i = 0;
              while (i < 4) {
                octets.push(parseInt(ipInterfaceOctets[i], 10) | parseInt(subnetMaskOctets[i], 10) ^ 255);
                i++;
              }
              return new this(octets);
            } catch (e) {
              throw new Error("ipaddr: the address does not have IPv4 CIDR format");
            }
          };
          ipaddr2.IPv4.isIPv4 = function(string) {
            return this.parser(string) !== null;
          };
          ipaddr2.IPv4.isValid = function(string) {
            try {
              new this(this.parser(string));
              return true;
            } catch (e) {
              return false;
            }
          };
          ipaddr2.IPv4.isValidCIDR = function(string) {
            try {
              this.parseCIDR(string);
              return true;
            } catch (e) {
              return false;
            }
          };
          ipaddr2.IPv4.isValidFourPartDecimal = function(string) {
            if (ipaddr2.IPv4.isValid(string) && string.match(/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){3}$/)) {
              return true;
            } else {
              return false;
            }
          };
          ipaddr2.IPv4.isValidCIDRFourPartDecimal = function(string) {
            const match = string.match(/^(.+)\/(\d+)$/);
            if (!ipaddr2.IPv4.isValidCIDR(string) || !match) {
              return false;
            }
            return ipaddr2.IPv4.isValidFourPartDecimal(match[1]);
          };
          ipaddr2.IPv4.networkAddressFromCIDR = function(string) {
            let cidr, i, ipInterfaceOctets, octets, subnetMaskOctets;
            try {
              cidr = this.parseCIDR(string);
              ipInterfaceOctets = cidr[0].toByteArray();
              subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
              octets = [];
              i = 0;
              while (i < 4) {
                octets.push(parseInt(ipInterfaceOctets[i], 10) & parseInt(subnetMaskOctets[i], 10));
                i++;
              }
              return new this(octets);
            } catch (e) {
              throw new Error("ipaddr: the address does not have IPv4 CIDR format");
            }
          };
          ipaddr2.IPv4.parse = function(string) {
            const parts = this.parser(string);
            if (parts === null) {
              throw new Error("ipaddr: string is not formatted like an IPv4 Address");
            }
            return new this(parts);
          };
          ipaddr2.IPv4.parseCIDR = function(string) {
            let match;
            if (match = string.match(/^(.+)\/(\d+)$/)) {
              const maskLength = parseInt(match[2]);
              if (maskLength >= 0 && maskLength <= 32) {
                const parsed = [this.parse(match[1]), maskLength];
                Object.defineProperty(parsed, "toString", {
                  value: function() {
                    return this.join("/");
                  }
                });
                return parsed;
              }
            }
            throw new Error("ipaddr: string is not formatted like an IPv4 CIDR range");
          };
          ipaddr2.IPv4.parser = function(string) {
            let match, part, value;
            if (match = string.match(ipv4Regexes.fourOctet)) {
              return function() {
                const ref = match.slice(1, 6);
                const results = [];
                for (let i = 0; i < ref.length; i++) {
                  part = ref[i];
                  results.push(parseIntAuto(part));
                }
                return results;
              }();
            } else if (match = string.match(ipv4Regexes.longValue)) {
              value = parseIntAuto(match[1]);
              if (value > 4294967295 || value < 0) {
                throw new Error("ipaddr: address outside defined range");
              }
              return function() {
                const results = [];
                let shift;
                for (shift = 0; shift <= 24; shift += 8) {
                  results.push(value >> shift & 255);
                }
                return results;
              }().reverse();
            } else if (match = string.match(ipv4Regexes.twoOctet)) {
              return function() {
                const ref = match.slice(1, 4);
                const results = [];
                value = parseIntAuto(ref[1]);
                if (value > 16777215 || value < 0) {
                  throw new Error("ipaddr: address outside defined range");
                }
                results.push(parseIntAuto(ref[0]));
                results.push(value >> 16 & 255);
                results.push(value >> 8 & 255);
                results.push(value & 255);
                return results;
              }();
            } else if (match = string.match(ipv4Regexes.threeOctet)) {
              return function() {
                const ref = match.slice(1, 5);
                const results = [];
                value = parseIntAuto(ref[2]);
                if (value > 65535 || value < 0) {
                  throw new Error("ipaddr: address outside defined range");
                }
                results.push(parseIntAuto(ref[0]));
                results.push(parseIntAuto(ref[1]));
                results.push(value >> 8 & 255);
                results.push(value & 255);
                return results;
              }();
            } else {
              return null;
            }
          };
          ipaddr2.IPv4.subnetMaskFromPrefixLength = function(prefix) {
            prefix = parseInt(prefix);
            if (prefix < 0 || prefix > 32) {
              throw new Error("ipaddr: invalid IPv4 prefix length");
            }
            const octets = [0, 0, 0, 0];
            let j = 0;
            const filledOctetCount = Math.floor(prefix / 8);
            while (j < filledOctetCount) {
              octets[j] = 255;
              j++;
            }
            if (filledOctetCount < 4) {
              octets[filledOctetCount] = Math.pow(2, prefix % 8) - 1 << 8 - prefix % 8;
            }
            return new this(octets);
          };
          ipaddr2.IPv6 = function() {
            function IPv6(parts, zoneId) {
              let i, part;
              if (parts.length === 16) {
                this.parts = [];
                for (i = 0; i <= 14; i += 2) {
                  this.parts.push(parts[i] << 8 | parts[i + 1]);
                }
              } else if (parts.length === 8) {
                this.parts = parts;
              } else {
                throw new Error("ipaddr: ipv6 part count should be 8 or 16");
              }
              for (i = 0; i < this.parts.length; i++) {
                part = this.parts[i];
                if (!(0 <= part && part <= 65535)) {
                  throw new Error("ipaddr: ipv6 part should fit in 16 bits");
                }
              }
              if (zoneId) {
                this.zoneId = zoneId;
              }
            }
            IPv6.prototype.SpecialRanges = {
              // RFC4291, here and after
              unspecified: [new IPv6([0, 0, 0, 0, 0, 0, 0, 0]), 128],
              linkLocal: [new IPv6([65152, 0, 0, 0, 0, 0, 0, 0]), 10],
              multicast: [new IPv6([65280, 0, 0, 0, 0, 0, 0, 0]), 8],
              loopback: [new IPv6([0, 0, 0, 0, 0, 0, 0, 1]), 128],
              uniqueLocal: [new IPv6([64512, 0, 0, 0, 0, 0, 0, 0]), 7],
              ipv4Mapped: [new IPv6([0, 0, 0, 0, 0, 65535, 0, 0]), 96],
              // RFC3879
              deprecatedSiteLocal: [new IPv6([65216, 0, 0, 0, 0, 0, 0, 0]), 10],
              // RFC6666
              discard: [new IPv6([256, 0, 0, 0, 0, 0, 0, 0]), 64],
              // RFC6145
              rfc6145: [new IPv6([0, 0, 0, 0, 65535, 0, 0, 0]), 96],
              rfc6052: [
                // RFC6052
                [new IPv6([100, 65435, 0, 0, 0, 0, 0, 0]), 96],
                // RFC8215
                [new IPv6([100, 65435, 1, 0, 0, 0, 0, 0]), 48]
              ],
              // RFC3056
              "6to4": [new IPv6([8194, 0, 0, 0, 0, 0, 0, 0]), 16],
              // RFC6052, RFC6146
              teredo: [new IPv6([8193, 0, 0, 0, 0, 0, 0, 0]), 32],
              // RFC5180
              benchmarking: [new IPv6([8193, 2, 0, 0, 0, 0, 0, 0]), 48],
              // RFC7450
              amt: [new IPv6([8193, 3, 0, 0, 0, 0, 0, 0]), 32],
              as112v6: [
                // RFC7535
                [new IPv6([8193, 4, 274, 0, 0, 0, 0, 0]), 48],
                // RFC7534
                [new IPv6([9760, 79, 32768, 0, 0, 0, 0, 0]), 48]
              ],
              // RFC4843
              deprecatedOrchid: [new IPv6([8193, 16, 0, 0, 0, 0, 0, 0]), 28],
              // RFC7343
              orchid2: [new IPv6([8193, 32, 0, 0, 0, 0, 0, 0]), 28],
              // RFC9374
              droneRemoteIdProtocolEntityTags: [new IPv6([8193, 48, 0, 0, 0, 0, 0, 0]), 28],
              // RFC9602
              segmentRouting: [new IPv6([24320, 0, 0, 0, 0, 0, 0, 0]), 16],
              reserved: [
                // RFC3849
                [new IPv6([8193, 0, 0, 0, 0, 0, 0, 0]), 23],
                // RFC2928
                [new IPv6([8193, 3512, 0, 0, 0, 0, 0, 0]), 32],
                // RFC9637
                [new IPv6([16383, 0, 0, 0, 0, 0, 0, 0]), 20]
              ]
            };
            IPv6.prototype.isIPv4MappedAddress = function() {
              return this.range() === "ipv4Mapped";
            };
            IPv6.prototype.kind = function() {
              return "ipv6";
            };
            IPv6.prototype.match = function(other, cidrRange) {
              let ref;
              if (cidrRange === void 0) {
                ref = other;
                other = ref[0];
                cidrRange = ref[1];
              }
              if (other.kind() !== "ipv6") {
                throw new Error("ipaddr: cannot match ipv6 address with non-ipv6 one");
              }
              return matchCIDR(this.parts, other.parts, 16, cidrRange);
            };
            IPv6.prototype.prefixLengthFromSubnetMask = function() {
              let cidr = 0;
              let stop = false;
              const zerotable = {
                0: 16,
                32768: 15,
                49152: 14,
                57344: 13,
                61440: 12,
                63488: 11,
                64512: 10,
                65024: 9,
                65280: 8,
                65408: 7,
                65472: 6,
                65504: 5,
                65520: 4,
                65528: 3,
                65532: 2,
                65534: 1,
                65535: 0
              };
              let part, zeros;
              for (let i = 7; i >= 0; i -= 1) {
                part = this.parts[i];
                if (part in zerotable) {
                  zeros = zerotable[part];
                  if (stop && zeros !== 0) {
                    return null;
                  }
                  if (zeros !== 16) {
                    stop = true;
                  }
                  cidr += zeros;
                } else {
                  return null;
                }
              }
              return 128 - cidr;
            };
            IPv6.prototype.range = function() {
              return ipaddr2.subnetMatch(this, this.SpecialRanges);
            };
            IPv6.prototype.toByteArray = function() {
              let part;
              const bytes = [];
              const ref = this.parts;
              for (let i = 0; i < ref.length; i++) {
                part = ref[i];
                bytes.push(part >> 8);
                bytes.push(part & 255);
              }
              return bytes;
            };
            IPv6.prototype.toFixedLengthString = function() {
              const addr = function() {
                const results = [];
                for (let i = 0; i < this.parts.length; i++) {
                  results.push(padPart(this.parts[i].toString(16), 4));
                }
                return results;
              }.call(this).join(":");
              let suffix = "";
              if (this.zoneId) {
                suffix = `%${this.zoneId}`;
              }
              return addr + suffix;
            };
            IPv6.prototype.toIPv4Address = function() {
              if (!this.isIPv4MappedAddress()) {
                throw new Error("ipaddr: trying to convert a generic ipv6 address to ipv4");
              }
              const ref = this.parts.slice(-2);
              const high = ref[0];
              const low = ref[1];
              return new ipaddr2.IPv4([high >> 8, high & 255, low >> 8, low & 255]);
            };
            IPv6.prototype.toNormalizedString = function() {
              const addr = function() {
                const results = [];
                for (let i = 0; i < this.parts.length; i++) {
                  results.push(this.parts[i].toString(16));
                }
                return results;
              }.call(this).join(":");
              let suffix = "";
              if (this.zoneId) {
                suffix = `%${this.zoneId}`;
              }
              return addr + suffix;
            };
            IPv6.prototype.toRFC5952String = function() {
              const regex = /((^|:)(0(:|$)){2,})/g;
              const string = this.toNormalizedString();
              let bestMatchIndex = 0;
              let bestMatchLength = -1;
              let match;
              while (match = regex.exec(string)) {
                if (match[0].length > bestMatchLength) {
                  bestMatchIndex = match.index;
                  bestMatchLength = match[0].length;
                }
              }
              if (bestMatchLength < 0) {
                return string;
              }
              return `${string.substring(0, bestMatchIndex)}::${string.substring(bestMatchIndex + bestMatchLength)}`;
            };
            IPv6.prototype.toString = function() {
              return this.toRFC5952String();
            };
            return IPv6;
          }();
          ipaddr2.IPv6.broadcastAddressFromCIDR = function(string) {
            try {
              const cidr = this.parseCIDR(string);
              const ipInterfaceOctets = cidr[0].toByteArray();
              const subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
              const octets = [];
              let i = 0;
              while (i < 16) {
                octets.push(parseInt(ipInterfaceOctets[i], 10) | parseInt(subnetMaskOctets[i], 10) ^ 255);
                i++;
              }
              return new this(octets);
            } catch (e) {
              throw new Error(`ipaddr: the address does not have IPv6 CIDR format (${e})`);
            }
          };
          ipaddr2.IPv6.isIPv6 = function(string) {
            return this.parser(string) !== null;
          };
          ipaddr2.IPv6.isValid = function(string) {
            if (typeof string === "string" && string.indexOf(":") === -1) {
              return false;
            }
            try {
              const addr = this.parser(string);
              new this(addr.parts, addr.zoneId);
              return true;
            } catch (e) {
              return false;
            }
          };
          ipaddr2.IPv6.isValidCIDR = function(string) {
            if (typeof string === "string" && string.indexOf(":") === -1) {
              return false;
            }
            try {
              this.parseCIDR(string);
              return true;
            } catch (e) {
              return false;
            }
          };
          ipaddr2.IPv6.networkAddressFromCIDR = function(string) {
            let cidr, i, ipInterfaceOctets, octets, subnetMaskOctets;
            try {
              cidr = this.parseCIDR(string);
              ipInterfaceOctets = cidr[0].toByteArray();
              subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
              octets = [];
              i = 0;
              while (i < 16) {
                octets.push(parseInt(ipInterfaceOctets[i], 10) & parseInt(subnetMaskOctets[i], 10));
                i++;
              }
              return new this(octets);
            } catch (e) {
              throw new Error(`ipaddr: the address does not have IPv6 CIDR format (${e})`);
            }
          };
          ipaddr2.IPv6.parse = function(string) {
            const addr = this.parser(string);
            if (addr.parts === null) {
              throw new Error("ipaddr: string is not formatted like an IPv6 Address");
            }
            return new this(addr.parts, addr.zoneId);
          };
          ipaddr2.IPv6.parseCIDR = function(string) {
            let maskLength, match, parsed;
            if (match = string.match(/^(.+)\/(\d+)$/)) {
              maskLength = parseInt(match[2]);
              if (maskLength >= 0 && maskLength <= 128) {
                parsed = [this.parse(match[1]), maskLength];
                Object.defineProperty(parsed, "toString", {
                  value: function() {
                    return this.join("/");
                  }
                });
                return parsed;
              }
            }
            throw new Error("ipaddr: string is not formatted like an IPv6 CIDR range");
          };
          ipaddr2.IPv6.parser = function(string) {
            let addr, i, match, octet, octets, zoneId;
            if (match = string.match(ipv6Regexes.deprecatedTransitional)) {
              return this.parser(`::ffff:${match[1]}`);
            }
            if (ipv6Regexes.native.test(string)) {
              return expandIPv6(string, 8);
            }
            if (match = string.match(ipv6Regexes.transitional)) {
              zoneId = match[6] || "";
              addr = match[1];
              if (!match[1].endsWith("::")) {
                addr = addr.slice(0, -1);
              }
              addr = expandIPv6(addr + zoneId, 6);
              if (addr.parts) {
                octets = [
                  parseInt(match[2]),
                  parseInt(match[3]),
                  parseInt(match[4]),
                  parseInt(match[5])
                ];
                for (i = 0; i < octets.length; i++) {
                  octet = octets[i];
                  if (!(0 <= octet && octet <= 255)) {
                    return null;
                  }
                }
                addr.parts.push(octets[0] << 8 | octets[1]);
                addr.parts.push(octets[2] << 8 | octets[3]);
                return {
                  parts: addr.parts,
                  zoneId: addr.zoneId
                };
              }
            }
            return null;
          };
          ipaddr2.IPv6.subnetMaskFromPrefixLength = function(prefix) {
            prefix = parseInt(prefix);
            if (prefix < 0 || prefix > 128) {
              throw new Error("ipaddr: invalid IPv6 prefix length");
            }
            const octets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            let j = 0;
            const filledOctetCount = Math.floor(prefix / 8);
            while (j < filledOctetCount) {
              octets[j] = 255;
              j++;
            }
            if (filledOctetCount < 16) {
              octets[filledOctetCount] = Math.pow(2, prefix % 8) - 1 << 8 - prefix % 8;
            }
            return new this(octets);
          };
          ipaddr2.fromByteArray = function(bytes) {
            const length = bytes.length;
            if (length === 4) {
              return new ipaddr2.IPv4(bytes);
            } else if (length === 16) {
              return new ipaddr2.IPv6(bytes);
            } else {
              throw new Error("ipaddr: the binary input is neither an IPv6 nor IPv4 address");
            }
          };
          ipaddr2.isValid = function(string) {
            return ipaddr2.IPv6.isValid(string) || ipaddr2.IPv4.isValid(string);
          };
          ipaddr2.isValidCIDR = function(string) {
            return ipaddr2.IPv6.isValidCIDR(string) || ipaddr2.IPv4.isValidCIDR(string);
          };
          ipaddr2.parse = function(string) {
            if (ipaddr2.IPv6.isValid(string)) {
              return ipaddr2.IPv6.parse(string);
            } else if (ipaddr2.IPv4.isValid(string)) {
              return ipaddr2.IPv4.parse(string);
            } else {
              throw new Error("ipaddr: the address has neither IPv6 nor IPv4 format");
            }
          };
          ipaddr2.parseCIDR = function(string) {
            try {
              return ipaddr2.IPv6.parseCIDR(string);
            } catch (e) {
              try {
                return ipaddr2.IPv4.parseCIDR(string);
              } catch (e2) {
                throw new Error("ipaddr: the address has neither IPv6 nor IPv4 CIDR format");
              }
            }
          };
          ipaddr2.process = function(string) {
            const addr = this.parse(string);
            if (addr.kind() === "ipv6" && addr.isIPv4MappedAddress()) {
              return addr.toIPv4Address();
            } else {
              return addr;
            }
          };
          ipaddr2.subnetMatch = function(address, rangeList, defaultName) {
            let i, rangeName, rangeSubnets, subnet;
            if (defaultName === void 0 || defaultName === null) {
              defaultName = "unicast";
            }
            for (rangeName in rangeList) {
              if (Object.prototype.hasOwnProperty.call(rangeList, rangeName)) {
                rangeSubnets = rangeList[rangeName];
                if (rangeSubnets[0] && !(rangeSubnets[0] instanceof Array)) {
                  rangeSubnets = [rangeSubnets];
                }
                for (i = 0; i < rangeSubnets.length; i++) {
                  subnet = rangeSubnets[i];
                  if (address.kind() === subnet[0].kind() && address.match.apply(address, subnet)) {
                    return rangeName;
                  }
                }
              }
            }
            return defaultName;
          };
          if (typeof module !== "undefined" && module.exports) {
            module.exports = ipaddr2;
          } else {
            root.ipaddr = ipaddr2;
          }
        })(exports);
      }
    });
    import_ipaddr = __toESM(require_ipaddr(), 1);
    IPV4_OCTET = /^(?:0|[1-9]\d{0,2})$/;
    PUBLIC_IPV4_RANGE = "unicast";
    PUBLIC_IPV6_RANGES = /* @__PURE__ */ new Set(["unicast", "reserved"]);
    SsrfError = class extends Error {
      constructor(message2, options) {
        super(message2, options);
        this.name = "SsrfError";
      }
    };
    GuardError = class extends Error {
      constructor(message2, options) {
        super(message2, options);
        this.name = "GuardError";
      }
    };
    DEFAULT_HOSTNAME_DENYLIST = Object.freeze([
      "metadata.google.internal",
      "metadata.goog",
      ".internal",
      ".svc.cluster.local",
      ".cluster.local",
      ".vercel-internal.com"
    ]);
    DEFAULT_MAX_BYTES = 1024 * 1024;
    DEFAULT_TIMEOUT_MS = 1e4;
    DEFAULT_MAX_REDIRECTS = 5;
    NODE_DNS_SPECIFIER = ["node:dns", "promises"].join("/");
    NodeDnsUnavailableError = class extends Error {
    };
    SsrfGuard = class {
      fetcher;
      injectedLookup;
      maxBytes;
      timeoutMs;
      maxRedirects;
      allowLoopback;
      allowUnresolvedHosts;
      requireDnsPinning;
      havePinningFetch;
      isBrowser;
      usingDefaultNodeLookup;
      hostnameDenylist;
      allowedContentTypes;
      enforcePortGate;
      defaultLookup;
      constructor(options) {
        this.havePinningFetch = options.pinningFetch !== void 0;
        this.isBrowser = isBrowserContext();
        this.fetcher = options.pinningFetch ?? options.fetch ?? globalThis.fetch;
        this.injectedLookup = options.dnsLookup === null ? void 0 : options.dnsLookup ?? void 0;
        this.usingDefaultNodeLookup = options.dnsLookup === void 0 && hasNodeDns();
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
        this.allowLoopback = options.allowLoopback ?? false;
        this.allowUnresolvedHosts = options.allowUnresolvedHosts ?? false;
        this.requireDnsPinning = options.requireDnsPinning ?? false;
        this.hostnameDenylist = options.hostnameDenylist ?? DEFAULT_HOSTNAME_DENYLIST;
        this.allowedContentTypes = options.allowedContentTypes ? options.allowedContentTypes.map((t) => t.toLowerCase()) : void 0;
        this.enforcePortGate = options.enforcePortGate ?? true;
      }
      async fetch(input, init) {
        const { url: startUrl, init: effectiveInit } = normalizeRequest(input, init);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const callerSignal = effectiveInit?.signal ?? void 0;
        const onCallerAbort = () => controller.abort();
        if (callerSignal) {
          if (callerSignal.aborted) {
            controller.abort();
          } else {
            callerSignal.addEventListener("abort", onCallerAbort, { once: true });
          }
        }
        try {
          return await this.fetchGuarded(startUrl, effectiveInit, controller);
        } finally {
          clearTimeout(timer);
          callerSignal?.removeEventListener("abort", onCallerAbort);
        }
      }
      async fetchGuarded(startUrl, init, controller) {
        let currentUrl = startUrl;
        let currentInit = { ...init ?? {} };
        let prevWasHttps = false;
        const seen = /* @__PURE__ */ new Set();
        for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
          if (seen.has(currentUrl)) {
            throw new SsrfError(`Redirect loop detected at ${currentUrl}.`);
          }
          seen.add(currentUrl);
          await this.assertAllowed(currentUrl, prevWasHttps);
          let res;
          try {
            res = await this.fetcher(currentUrl, {
              ...currentInit,
              // We re-validate every hop ourselves, so the underlying fetch must NOT auto-follow.
              redirect: "manual",
              signal: controller.signal
            });
          } catch (cause) {
            if (controller.signal.aborted) {
              throw new SsrfError(`Fetch timed out for ${currentUrl} (${this.timeoutMs}ms).`, {
                cause
              });
            }
            throw new SsrfError(`Fetch failed for ${currentUrl}: ${message(cause)}`, { cause });
          }
          if (!isRedirect(res.status)) {
            return await this.finalize(res, currentUrl, controller);
          }
          const location = res.headers.get("location");
          if (!location) {
            return await this.finalize(res, currentUrl, controller);
          }
          let nextUrl;
          try {
            nextUrl = new URL(location, currentUrl).toString();
          } catch {
            throw new SsrfError(`Redirect to a malformed Location (${location}) from ${currentUrl}.`);
          }
          currentInit = rewriteInitForRedirect(
            currentInit,
            res.status,
            !sameOrigin(currentUrl, nextUrl)
          );
          try {
            await res.body?.cancel();
          } catch {
          }
          prevWasHttps = safeProtocol(currentUrl) === "https:";
          currentUrl = nextUrl;
        }
        throw new SsrfError(`Too many redirects (> ${this.maxRedirects}) starting from ${startUrl}.`);
      }
      /** Enforce the content-type allowlist (when configured) then cap the body. */
      async finalize(res, url, controller) {
        if (this.allowedContentTypes && isBodyBearingStatus(res.status)) {
          const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
          if (!contentType || !this.allowedContentTypes.includes(contentType)) {
            try {
              await res.body?.cancel();
            } catch {
            }
            throw new GuardError(
              `Disallowed content-type "${contentType || "(none)"}" for ${url}; expected one of ${this.allowedContentTypes.join(", ")}.`
            );
          }
        }
        return await this.capBody(res, url, controller);
      }
      async capBody(res, url, controller) {
        const declared = Number(res.headers.get("content-length") ?? Number.NaN);
        if (!Number.isNaN(declared) && declared > this.maxBytes) {
          controller.abort();
          throw new SsrfError(
            `Response body for ${url} exceeds cap (Content-Length ${declared} > ${this.maxBytes}).`
          );
        }
        const bytes = await this.readCapped(res, url, controller);
        const body = isNullBodyStatus(res.status) ? null : bytes.buffer;
        const out = new Response(body, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers
        });
        const finalUrl = res.url || url;
        try {
          Object.defineProperty(out, "url", { value: finalUrl, configurable: true });
        } catch {
        }
        return out;
      }
      async readCapped(res, url, controller) {
        const body = res.body;
        if (!body) {
          return new Uint8Array(new ArrayBuffer(0));
        }
        const reader = body.getReader();
        const chunks = [];
        let total = 0;
        try {
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            if (value) {
              total += value.byteLength;
              if (total > this.maxBytes) {
                controller.abort();
                throw new SsrfError(
                  `Response body for ${url} exceeds cap (${total} bytes > ${this.maxBytes}).`
                );
              }
              chunks.push(value);
            }
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
          }
        }
        const out = new Uint8Array(new ArrayBuffer(total));
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return out;
      }
      /**
       * Refuse `rawUrl` unless it is an https (or, under `allowLoopback`, http-to-loopback) URL
       * with no userinfo, an allowed port, a non-denied host, and a host allowed by the active
       * branch. `prevWasHttps` rejects a scheme-downgrade redirect (https → http).
       */
      async assertAllowed(rawUrl, prevWasHttps = false) {
        let url;
        try {
          url = new URL(rawUrl);
        } catch {
          throw new SsrfError(`URL is malformed: ${rawUrl}.`);
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          throw new SsrfError(
            `URL must be https: (got ${url.protocol} for ${rawUrl}). Only http(s) is fetched.`
          );
        }
        if (url.protocol === "http:" && !this.allowLoopback) {
          throw new SsrfError(
            `URL must be https: (got http: ${url.host}). http: is permitted only under allowLoopback (dev).`
          );
        }
        if (prevWasHttps && url.protocol === "http:") {
          throw new SsrfError(`Refusing redirect scheme downgrade (https \u2192 http): ${url.host}.`);
        }
        if (url.username || url.password) {
          throw new SsrfError(`URL must not carry userinfo (credentials): ${url.host}.`);
        }
        this.assertPortAllowed(url);
        const rawHostname = url.hostname.replace(/^\[|\]$/g, "");
        if (isDeniedHostname(rawHostname, this.hostnameDenylist)) {
          throw new SsrfError(`Host is on the cloud-internal denylist: ${rawHostname}.`);
        }
        const hostname = normalizeHostForClassification(url.hostname);
        if (isDeniedHostname(hostname, this.hostnameDenylist)) {
          throw new SsrfError(`Host is on the cloud-internal denylist: ${hostname}.`);
        }
        const literalKind = classifyIpLiteral(hostname);
        if (literalKind !== 0) {
          this.assertResolvedAddressesAllowed(url, hostname, [
            { address: hostname, family: literalKind }
          ]);
          return;
        }
        let lookup;
        if (this.injectedLookup) {
          lookup = this.injectedLookup;
        } else if (this.usingDefaultNodeLookup) {
          try {
            lookup = await this.resolveDefaultLookup();
          } catch (cause) {
            if (cause instanceof NodeDnsUnavailableError) {
              this.assertDnslessHostnameAllowed(url.protocol, hostname);
              return;
            }
            throw new SsrfError(`node:dns probe failed for ${hostname}: ${message(cause)}`, { cause });
          }
        } else {
          this.assertDnslessHostnameAllowed(url.protocol, hostname);
          return;
        }
        if (this.requireDnsPinning && !this.havePinningFetch) {
          throw new SsrfError(
            `URL refused \u2014 requireDnsPinning is set and "${hostname}" is a hostname, which cannot be DNS-pinned without an explicit pinningFetch. Pass a pinningFetch (asserted to pin DNS), or use an IP literal.`
          );
        }
        let resolved;
        try {
          resolved = await lookup(hostname);
        } catch (cause) {
          throw new SsrfError(`Host did not resolve: ${hostname}: ${message(cause)}`, { cause });
        }
        if (resolved.length === 0) {
          throw new SsrfError(`Host resolved to no addresses: ${hostname}.`);
        }
        this.assertResolvedAddressesAllowed(url, hostname, resolved);
      }
      /** Port gate: in production an explicit port must be 443 (https). Inert under allowLoopback. */
      assertPortAllowed(url) {
        if (!this.enforcePortGate || this.allowLoopback) {
          return;
        }
        if (url.port === "") {
          return;
        }
        const port = Number(url.port);
        if (!(url.protocol === "https:" && port === 443)) {
          throw new GuardError(
            `URL port not allowed (${url.port}) for ${url.host}; only 443 (https) is permitted in production.`
          );
        }
      }
      resolveDefaultLookup() {
        if (this.defaultLookup === void 0) {
          this.defaultLookup = loadNodeDnsLookup();
        }
        return this.defaultLookup;
      }
      /** DNS-LESS branch hostname guard (no resolver). The IP-literal cases are handled by the caller. */
      assertDnslessHostnameAllowed(protocol, hostname) {
        const lower = hostname.toLowerCase().replace(/\.$/, "");
        if (this.requireDnsPinning && !this.allowUnresolvedHosts) {
          throw new SsrfError(
            `URL refused \u2014 requireDnsPinning is set but no DNS resolver is available in this runtime to pin "${hostname}". A browser cannot pin a socket; set allowUnresolvedHosts to accept the residual, or run on Node with a pinningFetch.`
          );
        }
        if (lower === "local" || lower.endsWith(".local")) {
          throw new SsrfError(
            `URL refused \u2014 "${hostname}" is an mDNS/link-local (.local) name denoting a private LAN target. Use a public https host.`
          );
        }
        if (lower === "localhost" || lower.endsWith(".localhost")) {
          if (this.allowLoopback) {
            return;
          }
          throw new SsrfError(
            `URL refused \u2014 "${hostname}" is a loopback name (localhost/*.localhost), which denotes a private target. Use a public https host.`
          );
        }
        if (protocol === "http:") {
          throw new SsrfError(
            `URL refused \u2014 http: is allowed only for a loopback name (localhost/*.localhost) in this runtime; "${hostname}" is not loopback. Use https:.`
          );
        }
        if (this.isBrowser || this.allowUnresolvedHosts) {
          return;
        }
        throw new SsrfError(
          `URL refused \u2014 no DNS resolver is available in this runtime to classify "${hostname}", and this is not a positively-identified browser context. Set allowUnresolvedHosts to accept that hostname targets cannot be classified here (you trust the URL source), or run on Node where the full DNS-resolve guard applies.`
        );
      }
      /**
       * Enforce the address-level policy on a set of resolved (or literal) addresses: under
       * `allowLoopback` an http: URL must resolve to loopback ONLY, and EVERY address must be
       * public (or loopback when allowLoopback) — one private record fails the whole request
       * (rebinding mitigation).
       */
      assertResolvedAddressesAllowed(url, hostname, resolved) {
        if (url.protocol === "http:" && this.allowLoopback) {
          for (const r of resolved) {
            if (!isLoopbackAddress(r.address)) {
              throw new SsrfError(
                `URL refused \u2014 http: is allowed only when every resolved address is loopback (got ${r.address} for ${hostname}). Use https:.`
              );
            }
          }
        }
        for (const r of resolved) {
          if (!isPublicAddress(r.address, this.allowLoopback)) {
            throw new SsrfError(
              `URL refused \u2014 ${hostname} resolves to a non-public address (${r.address}).`
            );
          }
        }
      }
    };
    CREDENTIAL_HEADERS = /* @__PURE__ */ new Set([
      "authorization",
      "cookie",
      "proxy-authorization",
      "www-authenticate",
      "dpop"
    ]);
    CONTENT_HEADERS = /* @__PURE__ */ new Set([
      "content-length",
      "content-type",
      "content-encoding",
      "content-language",
      "content-location"
    ]);
  }
});

// node_modules/@jeswr/guarded-fetch/dist/node.js
var node_exports = {};
__export(node_exports, {
  createNodeGuardedFetch: () => createNodeGuardedFetch,
  createPinningDispatcher: () => createPinningDispatcher,
  createValidatingLookup: () => createValidatingLookup,
  nodeGuardedFetch: () => nodeGuardedFetch
});
import { lookup as dnsLookupCb } from "node:dns";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
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
var defaultResolveAll, nodeGuardedFetch;
var init_node = __esm({
  "node_modules/@jeswr/guarded-fetch/dist/node.js"() {
    init_dist();
    defaultResolveAll = (hostname) => new Promise((resolve, reject) => {
      dnsLookupCb(hostname, { all: true }, (err, addresses) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(addresses);
      });
    });
    nodeGuardedFetch = createNodeGuardedFetch();
  }
});

// src/core.ts
import { createHash } from "node:crypto";
import {
  calculateJwkThumbprint,
  createRemoteJWKSet,
  EmbeddedJWK,
  jwtVerify
} from "jose";
import * as oauth from "oauth4webapi";
var SOLID_OIDC_ISSUER = "http://www.w3.org/ns/solid/terms#oidcIssuer";
var SIGNING_ALGS = [
  "ES256",
  "ES384",
  "ES512",
  "PS256",
  "PS384",
  "PS512",
  "RS256",
  "RS384",
  "RS512"
];
var DPOP_ALGS = SIGNING_ALGS;
var ACCESS_TOKEN_TYP = "at+jwt";
var DPOP_PROOF_TYP = "dpop+jwt";
var DPOP_PROOF_MAX_AGE_SEC = 300;
var DEFAULT_CLOCK_TOLERANCE_SEC = 5;
function toHeaders(input) {
  if (input instanceof Headers) {
    return input;
  }
  const headers = new Headers();
  if (typeof input[Symbol.iterator] === "function") {
    for (const [name, value] of input) {
      headers.append(name, value);
    }
    return headers;
  }
  for (const [name, value] of Object.entries(input)) {
    if (value === void 0 || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, String(item));
      }
    } else {
      headers.set(name, String(value));
    }
  }
  return headers;
}
function normalizeRequest2(request) {
  return {
    headers: toHeaders(request.headers),
    method: request.method,
    url: request.url
  };
}
var ApiAuthError = class extends Error {
  statusCode;
  /** The `WWW-Authenticate` header value, or undefined (403/429/503 need no challenge). */
  wwwAuthenticate;
  constructor(message2, statusCode = 401, wwwAuthenticate) {
    super(message2);
    this.name = "ApiAuthError";
    this.statusCode = statusCode;
    if (wwwAuthenticate !== void 0) {
      this.wwwAuthenticate = wwwAuthenticate;
    }
  }
};
var InProcessReplayStore = class {
  seen = /* @__PURE__ */ new Map();
  now;
  maxEntries;
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 1e5;
  }
  async mark(jti, ttlSeconds) {
    const now = this.now();
    this.prune(now);
    const existingExpiry = this.seen.get(jti);
    if (existingExpiry !== void 0 && existingExpiry > now) {
      return "replay";
    }
    const ttlMs = ttlSeconds * 1e3;
    if (ttlMs > 0) {
      if (this.seen.size >= this.maxEntries) {
        const oldest = this.seen.keys().next().value;
        if (oldest !== void 0) {
          this.seen.delete(oldest);
        }
      }
      this.seen.set(jti, now + ttlMs);
    }
    return "new";
  }
  /** Drop expired entries (lazy — bounded work: only when the map has grown). */
  prune(now) {
    if (this.seen.size === 0) {
      return;
    }
    for (const [jti, expiry] of this.seen) {
      if (expiry <= now) {
        this.seen.delete(jti);
      }
    }
  }
};
var TokenBucketRateLimiter = class {
  buckets = /* @__PURE__ */ new Map();
  capacity;
  refillPerSec;
  now;
  maxKeys;
  /**
   * @param options.capacity     max burst (and the count restored per full window).
   * @param options.refillPerSec tokens restored per second (e.g. `capacity / 60` = `capacity`/min).
   */
  constructor(options) {
    this.capacity = Math.max(1, options.capacity);
    this.refillPerSec = Math.max(0, options.refillPerSec);
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? 1e4;
  }
  /**
   * Attempt to consume one token for `key`. Returns `true` when allowed (a token was
   * available), `false` when the bucket is empty (rate-limited → the caller returns 429).
   */
  tryRemove(key) {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (bucket === void 0) {
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== void 0) {
          this.buckets.delete(oldest);
        }
      }
      bucket = { tokens: this.capacity, last: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsedSec = Math.max(0, (now - bucket.last) / 1e3);
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
      bucket.last = now;
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }
};
function isLoopbackHttp(issuer) {
  let url;
  try {
    url = new URL(issuer);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") {
    return false;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
var DpopApiVerifier = class {
  trustedIssuers;
  ownerWebId;
  webidClaim;
  clockToleranceSec;
  bidirectionalMode;
  allowInsecureLoopback;
  resolveIssuer;
  replayStore;
  injectedWebidFetch;
  now;
  log;
  /** Cached per-issuer keys (the promise, so concurrent first-requests share discovery). */
  issuerKeys = /* @__PURE__ */ new Map();
  /** Lazily-built guarded fetch (undici DNS-pinning) — created on first bidirectional check. */
  lazyWebidFetch;
  constructor(options) {
    if (options.trustedIssuers.length === 0) {
      throw new Error("DpopApiVerifier requires at least one trusted issuer.");
    }
    this.trustedIssuers = options.trustedIssuers;
    this.ownerWebId = options.ownerWebId && options.ownerWebId.length > 0 ? options.ownerWebId : void 0;
    this.webidClaim = options.webidClaim ?? "webid";
    this.clockToleranceSec = options.clockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC;
    this.allowInsecureLoopback = options.allowInsecureLoopback ?? false;
    this.resolveIssuer = options.resolveIssuer ?? ((issuer) => this.discoverIssuer(issuer));
    this.replayStore = options.replayStore ?? new InProcessReplayStore({ now: options.now });
    this.injectedWebidFetch = options.webidFetch;
    this.now = options.now ?? Date.now;
    const baseLog = options.log;
    this.log = {
      warn: baseLog?.warn ?? (() => {
      }),
      info: baseLog?.info ?? (() => {
      })
    };
    const explicit = options.bidirectionalMode;
    const allLoopback = this.trustedIssuers.every((iss) => isLoopbackHttp(iss));
    this.bidirectionalMode = explicit ?? (allLoopback ? "warn" : "strict");
  }
  /**
   * Verify the request's DPoP-bound token WITHOUT the owner check — returns the caller's
   * verified {@link ApiCredentials}. Throws {@link ApiAuthError} on any failure. Use
   * {@link authorizeOwner} for the full write gate. Accepts any {@link RequestLike} (a web
   * `Request` included).
   */
  async authenticate(request) {
    const normalized = normalizeRequest2(request);
    const authorization = normalized.headers.get("authorization") ?? void 0;
    const dpopHeader = normalized.headers.get("dpop") ?? void 0;
    const parsed = parseAuthorization(authorization);
    if (!parsed) {
      throw this.challenge("invalid_request", "Authentication required.");
    }
    if (parsed.scheme === "bearer") {
      throw this.challenge("invalid_request", "DPoP-bound token required; Bearer not accepted.");
    }
    if (parsed.scheme !== "dpop") {
      throw this.challenge(
        "invalid_request",
        `Unsupported Authorization scheme: ${parsed.scheme}.`
      );
    }
    if (dpopHeader === void 0) {
      throw this.challenge("invalid_request", "Missing DPoP proof header.");
    }
    const claimedIssuer = peekIssuer(parsed.token);
    if (!this.trustedIssuers.includes(claimedIssuer)) {
      throw this.challenge("invalid_token", "Token issuer is not trusted.");
    }
    const claims = await this.verifyAccessToken(parsed.token, claimedIssuer);
    const cnfJkt = extractCnfJkt(claims);
    if (cnfJkt === void 0) {
      throw this.challenge(
        "invalid_token",
        "Access token is not DPoP-bound (no cnf.jkt confirmation claim)."
      );
    }
    const proofJti = await this.verifyDpopProof(normalized, dpopHeader, parsed.token, cnfJkt);
    const webId = this.extractWebId(claims);
    await this.checkReplay(proofJti);
    await this.checkBidirectionalIssuer(webId, claimedIssuer);
    return {
      webId,
      issuer: claimedIssuer,
      ...typeof claims.client_id === "string" ? { clientId: claims.client_id } : {}
    };
  }
  /**
   * The full write gate: {@link authenticate} + `webid === ownerWebId`. FAIL-CLOSED when
   * `ownerWebId` is unset (503). Wrong WebID → 403.
   */
  async authorizeOwner(request) {
    if (this.ownerWebId === void 0) {
      throw new ApiAuthError(
        "This server is not configured to accept writes (owner WebID is unset).",
        503
      );
    }
    const credentials = await this.authenticate(request);
    if (credentials.webId !== this.ownerWebId) {
      throw new ApiAuthError("You are not authorized to perform this action.", 403);
    }
    return credentials;
  }
  /**
   * Verify the access-token JWS with `jose`: asymmetric alg, `typ=at+jwt`, trusted `iss`,
   * temporal within tolerance. The `aud` is intentionally NOT checked (see the module header —
   * the token's audience is the pod, and the DPoP proof re-binds it to this request). Requires a
   * `sub` as basic sanity.
   */
  async verifyAccessToken(token, claimedIssuer) {
    let claims;
    try {
      const keys = await this.keysFor(claimedIssuer);
      const { payload } = await jwtVerify(token, keys.jwks, {
        typ: ACCESS_TOKEN_TYP,
        algorithms: SIGNING_ALGS,
        issuer: claimedIssuer,
        clockTolerance: this.clockToleranceSec,
        // FAIL-CLOSED temporal enforcement: `jose` validates `exp`/`nbf` only when the claim is
        // PRESENT — a token that OMITS `exp`/`iat` would otherwise pass with no expiry at all.
        // `requiredClaims` makes their absence a hard rejection (401), so a never-expiring /
        // undated token is refused. `cnf` (DPoP binding) + the WebID claim are required here too
        // so a token missing either is rejected before we read it.
        requiredClaims: ["exp", "iat", "cnf", this.webidClaim]
      });
      claims = payload;
    } catch (error) {
      throw this.challenge("invalid_token", `Access token verification failed: ${reason(error)}`);
    }
    if (typeof claims.sub !== "string" || claims.sub.length === 0) {
      throw this.challenge("invalid_token", "Access token is missing the 'sub' claim.");
    }
    return claims;
  }
  /**
   * Verify the DPoP proof (RFC 9449) with `jose`, returning its `jti`. Mirrors the pod
   * resource-server checks: `typ=dpop+jwt`, an asymmetric alg, an embedded PUBLIC JWK verifying
   * the proof signature, `htm`==method, `htu`==reconstructed URL, `iat` fresh, `ath`==access-
   * token hash, and `jkt(jwk)==cnf.jkt`. `jti` presence is asserted here; the caller consumes it
   * against the replay store.
   */
  async verifyDpopProof(request, proof, accessToken, cnfJkt) {
    let payload;
    let header;
    try {
      const result = await jwtVerify(
        proof,
        async (protectedHeader, tok) => EmbeddedJWK(protectedHeader, tok),
        {
          typ: DPOP_PROOF_TYP,
          algorithms: SIGNING_ALGS,
          clockTolerance: this.clockToleranceSec
        }
      );
      payload = result.payload;
      header = result.protectedHeader;
    } catch (error) {
      throw this.challenge(
        "invalid_token",
        `DPoP proof verification failed: ${reason(error)}`,
        true
      );
    }
    if (!isJsonObject(header.jwk)) {
      throw this.challenge("invalid_token", "DPoP proof jwk header must be a JSON object.", true);
    }
    if (payload.htm !== request.method) {
      throw this.challenge("invalid_token", "DPoP proof htm mismatch.", true);
    }
    const expectedHtu = reconstructRequestUrl(request);
    if (typeof payload.htu !== "string" || normalizeHtu(payload.htu) !== expectedHtu) {
      throw this.challenge("invalid_token", "DPoP proof htu mismatch.", true);
    }
    if (typeof payload.iat !== "number") {
      throw this.challenge("invalid_token", "DPoP proof is missing iat.", true);
    }
    const nowSec = Math.floor(this.now() / 1e3);
    if (Math.abs(nowSec - payload.iat) > DPOP_PROOF_MAX_AGE_SEC + this.clockToleranceSec) {
      throw this.challenge("invalid_token", "DPoP proof iat is not recent enough.", true);
    }
    if (typeof payload.jti !== "string" || payload.jti.length === 0) {
      throw this.challenge("invalid_token", "DPoP proof is missing a jti.", true);
    }
    const expectedAth = createHash("sha256").update(accessToken).digest("base64url");
    if (payload.ath !== expectedAth) {
      throw this.challenge(
        "invalid_token",
        "DPoP proof ath does not match the access token.",
        true
      );
    }
    const proofJkt = await calculateJwkThumbprint(header.jwk, "sha256");
    if (proofJkt !== cnfJkt) {
      throw this.challenge(
        "invalid_token",
        "DPoP proof key does not match the access token confirmation (cnf.jkt).",
        true
      );
    }
    return payload.jti;
  }
  /** Consume the proof's `jti` against the replay store (a repeat within the window = replay). */
  async checkReplay(jti) {
    const ttlSeconds = DPOP_PROOF_MAX_AGE_SEC + this.clockToleranceSec;
    const result = await this.replayStore.mark(jti, ttlSeconds);
    if (result === "replay") {
      this.log.warn({ event: "api-auth.replay.detected" }, "DPoP jti replay detected \u2014 rejecting.");
      throw this.challenge("invalid_token", "DPoP proof has already been used (replay).", true);
    }
  }
  /** The `webid` claim — must be present and an `https:` URL without userinfo. */
  extractWebId(claims) {
    const raw = claims[this.webidClaim];
    if (typeof raw !== "string" || raw.length === 0) {
      throw this.challenge("invalid_token", `Token is missing the '${this.webidClaim}' claim.`);
    }
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw this.challenge("invalid_token", "WebID claim is not a valid URL.");
    }
    if (url.protocol !== "https:") {
      throw this.challenge("invalid_token", "WebID claim must be an https: URL.");
    }
    if (url.username || url.password) {
      throw this.challenge("invalid_token", "WebID claim must not include userinfo.");
    }
    return raw;
  }
  /**
   * Bidirectional WebID↔issuer check: dereference the WebID profile (SSRF-guarded) and confirm
   * it lists `issuer` via `solid:oidcIssuer`. `strict` → any mismatch or fetch failure is a 401;
   * `warn` → log + accept; `off` → skip. The client-facing message is constant so this cannot be
   * used as a network-reconnaissance oracle.
   */
  async checkBidirectionalIssuer(webId, issuer) {
    if (this.bidirectionalMode === "off") {
      return;
    }
    let listed = false;
    let internalReason;
    try {
      const issuers = await this.fetchWebIdIssuers(webId);
      listed = issuers.has(issuer);
      if (!listed) {
        internalReason = `WebID does not list issuer ${issuer} in solid:oidcIssuer.`;
      }
    } catch (error) {
      internalReason = `WebID profile resolution failed: ${reason(error)}`;
    }
    if (listed) {
      return;
    }
    this.log.warn(
      { webId, issuer, mode: this.bidirectionalMode, reason: internalReason },
      "Bidirectional WebID check failed."
    );
    if (this.bidirectionalMode === "strict") {
      throw this.challenge("invalid_token", "WebID issuer check failed.");
    }
  }
  /**
   * Fetch the WebID profile through the SSRF-guarded fetch and extract its `solid:oidcIssuer`
   * object set. The WebID is user-influenced, so this NEVER uses a bare `fetch` — it uses
   * `@jeswr/guarded-fetch/node` (DNS-pinned; closes the rebinding TOCTOU) via `@jeswr/fetch-rdf`.
   */
  async fetchWebIdIssuers(webId) {
    const fetchImpl = await this.webidFetch();
    const { fetchRdf } = await import("@jeswr/fetch-rdf");
    const { dataset } = await fetchRdf(webId, { fetch: fetchImpl });
    const profileUrl = stripFragment(webId);
    const issuers = /* @__PURE__ */ new Set();
    for (const quad of dataset) {
      if (quad.predicate.value !== SOLID_OIDC_ISSUER) {
        continue;
      }
      if (quad.subject.value !== webId && quad.subject.value !== profileUrl) {
        continue;
      }
      if (quad.object.termType === "NamedNode") {
        issuers.add(quad.object.value);
      }
    }
    return issuers;
  }
  /** The SSRF-guarded fetch for WebID profiles (injected in tests; built lazily otherwise). */
  async webidFetch() {
    if (this.injectedWebidFetch) {
      return this.injectedWebidFetch;
    }
    if (this.lazyWebidFetch === void 0) {
      const { createNodeGuardedFetch: createNodeGuardedFetch2 } = await Promise.resolve().then(() => (init_node(), node_exports));
      this.lazyWebidFetch = createNodeGuardedFetch2({ allowLoopback: this.allowInsecureLoopback });
    }
    return this.lazyWebidFetch;
  }
  /** Get (or cache) an issuer's verification keys; a rejected discovery is evicted so it can retry. */
  async keysFor(issuer) {
    let pending = this.issuerKeys.get(issuer);
    if (!pending) {
      pending = Promise.resolve(this.resolveIssuer(issuer));
      this.issuerKeys.set(issuer, pending);
    }
    try {
      return await pending;
    } catch (error) {
      this.issuerKeys.delete(issuer);
      throw error;
    }
  }
  /**
   * The default issuer resolver: OIDC discovery (`${issuer}/.well-known/openid-configuration`,
   * issuer cross-checked) via `oauth4webapi`, then a cached remote JWKS over the discovered
   * `jwks_uri`. The issuer is operator-configured (a trusted-list entry), NOT user-influenced,
   * so discovery does not need the SSRF guard (unlike the WebID fetch, which does).
   */
  async discoverIssuer(issuer) {
    const issuerUrl = new URL(issuer);
    const allowInsecure = this.allowInsecureLoopback && isLoopbackHttp(issuer);
    const res = await oauth.discoveryRequest(issuerUrl, {
      algorithm: "oidc",
      ...allowInsecure ? { [oauth.allowInsecureRequests]: true } : {}
    });
    const as = await oauth.processDiscoveryResponse(issuerUrl, res);
    if (as.issuer !== issuer) {
      throw new Error(`OIDC discovery issuer mismatch for ${issuer} (got ${as.issuer}).`);
    }
    if (typeof as.jwks_uri !== "string" || as.jwks_uri.length === 0) {
      throw new Error(`OIDC discovery for ${issuer} has no jwks_uri.`);
    }
    return {
      jwks: createRemoteJWKSet(new URL(as.jwks_uri)),
      allowInsecureRequests: allowInsecure
    };
  }
  /** Build an {@link ApiAuthError} (401) with an RFC 6750 / 9449-style `WWW-Authenticate`. */
  challenge(error, description, dpop = true) {
    const params = [
      `error="${error}"`,
      `error_description="${escapeQuoted(description)}"`,
      `scope="webid"`,
      `issuer="${escapeQuoted(this.trustedIssuers.join(" "))}"`
    ];
    if (dpop) {
      params.push(`algs="${DPOP_ALGS.join(" ")}"`);
    }
    return new ApiAuthError(description, 401, `DPoP ${params.join(", ")}`);
  }
};
async function verifyRequest(headers, method, url, opts) {
  const request = { headers, method, url };
  if (opts.assertSameOrigin === true) {
    assertSameOrigin(request);
  }
  const credentials = opts.requireOwner === false ? await opts.verifier.authenticate(request) : await opts.verifier.authorizeOwner(request);
  if (opts.rateLimiter) {
    const key = opts.rateLimitKey ? opts.rateLimitKey(credentials) : credentials.webId;
    if (!opts.rateLimiter.tryRemove(key)) {
      throw new ApiAuthError("Rate limit exceeded. Please try again later.", 429);
    }
  }
  return credentials;
}
function parseAuthorization(header) {
  if (!header) {
    return void 0;
  }
  const trimmed = header.trim();
  const sp = trimmed.indexOf(" ");
  if (sp === -1) {
    return void 0;
  }
  const scheme = trimmed.slice(0, sp).toLowerCase();
  const token = trimmed.slice(sp + 1).trim();
  if (!token) {
    return void 0;
  }
  return { scheme, token };
}
function reconstructRequestUrl(request) {
  const normalized = normalizeRequest2(request);
  const raw = new URL(normalized.url);
  const forwardedProto = firstForwardedValue(normalized.headers.get("x-forwarded-proto"));
  const forwardedHost = firstForwardedValue(normalized.headers.get("x-forwarded-host"));
  const hostHeader = normalized.headers.get("host") ?? void 0;
  const proto = forwardedProto ?? raw.protocol.replace(/:$/, "");
  const host = forwardedHost ?? hostHeader ?? raw.host;
  const rebuilt = new URL(`${proto}://${host}`);
  rebuilt.pathname = raw.pathname;
  rebuilt.search = "";
  rebuilt.hash = "";
  return rebuilt.href;
}
function firstForwardedValue(header) {
  if (!header) {
    return void 0;
  }
  const first = header.split(",")[0]?.trim();
  return first && first.length > 0 ? first : void 0;
}
function assertSameOrigin(request) {
  const normalized = normalizeRequest2(request);
  const expectedOrigin = new URL(reconstructRequestUrl(normalized)).origin;
  const origin = normalized.headers.get("origin");
  if (origin !== null && origin !== "null") {
    if (safeOrigin(origin) !== expectedOrigin) {
      throw new ApiAuthError("Cross-origin request refused.", 403);
    }
    return;
  }
  const referer = normalized.headers.get("referer");
  if (referer !== null && referer.length > 0) {
    if (safeOrigin(referer) !== expectedOrigin) {
      throw new ApiAuthError("Cross-origin request refused.", 403);
    }
  }
}
function safeOrigin(raw) {
  try {
    const origin = new URL(raw).origin;
    return origin === "null" ? void 0 : origin;
  } catch {
    return void 0;
  }
}
function decodeClaims(token) {
  const parts = token.split(".");
  const claimsSegment = parts.length === 3 ? parts[1] : void 0;
  if (claimsSegment === void 0) {
    return void 0;
  }
  try {
    const json = Buffer.from(claimsSegment, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return isJsonObject(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function peekIssuer(token) {
  const claims = decodeClaims(token);
  const iss = claims?.iss;
  if (typeof iss !== "string" || iss.length === 0) {
    throw new ApiAuthError("Malformed access token (no issuer).", 401);
  }
  return iss;
}
function extractCnfJkt(claims) {
  const cnf = claims.cnf;
  if (!isJsonObject(cnf)) {
    return void 0;
  }
  const jkt = cnf.jkt;
  return typeof jkt === "string" && jkt.length > 0 ? jkt : void 0;
}
function normalizeHtu(htu) {
  const url = new URL(htu);
  url.search = "";
  url.hash = "";
  return url.href;
}
function stripFragment(webId) {
  try {
    const url = new URL(webId);
    url.hash = "";
    return url.toString();
  } catch {
    return webId.split("#")[0] ?? webId;
  }
}
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function reason(error) {
  return error instanceof Error ? error.message : "unknown error";
}
function escapeQuoted(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
var sharedVerifier;
function parseTrustedIssuers(raw) {
  if (!raw) {
    return [];
  }
  return raw.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}
function optionsFromEnv(env = process.env) {
  const mode = env.PSS_BIDIRECTIONAL_WEBID_MODE;
  const bidirectionalMode = mode === "strict" || mode === "warn" || mode === "off" ? mode : void 0;
  const tolerance = Number(env.PSS_CLOCK_TOLERANCE_SEC);
  return {
    trustedIssuers: parseTrustedIssuers(env.PSS_TRUSTED_ISSUERS),
    ownerWebId: env.OWNER_WEBID,
    webidClaim: env.PSS_WEBID_CLAIM || "webid",
    ...bidirectionalMode ? { bidirectionalMode } : {},
    allowInsecureLoopback: env.PSS_AUTH_ALLOW_INSECURE_LOOPBACK === "1" || env.PSS_AUTH_ALLOW_INSECURE_LOOPBACK === "true",
    ...Number.isFinite(tolerance) && tolerance >= 0 ? { clockToleranceSec: tolerance } : {},
    log: { warn: (o, m) => console.warn(m ?? "", o) }
  };
}
function getVerifier() {
  if (sharedVerifier === void 0) {
    sharedVerifier = new DpopApiVerifier(optionsFromEnv());
  }
  return sharedVerifier;
}
function __resetVerifierForTests() {
  sharedVerifier = void 0;
}
var sharedRateLimiter;
var DEFAULT_SCAN_RATE_PER_MIN = 10;
function getScanRateLimiter() {
  if (sharedRateLimiter === void 0) {
    const parsed = Number(process.env.PSS_SCAN_RATE_PER_MIN);
    const perMin = Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_SCAN_RATE_PER_MIN;
    sharedRateLimiter = new TokenBucketRateLimiter({
      capacity: perMin,
      refillPerSec: perMin / 60
    });
  }
  return sharedRateLimiter;
}
function __resetRateLimiterForTests() {
  sharedRateLimiter = void 0;
}
export {
  ApiAuthError,
  DpopApiVerifier,
  InProcessReplayStore,
  TokenBucketRateLimiter,
  __resetRateLimiterForTests,
  __resetVerifierForTests,
  assertSameOrigin,
  getScanRateLimiter,
  getVerifier,
  isLoopbackHttp,
  optionsFromEnv,
  parseAuthorization,
  parseTrustedIssuers,
  reconstructRequestUrl,
  verifyRequest
};
//# sourceMappingURL=index.js.map
