"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// nodes/Solid/Solid.node.ts
var Solid_node_exports = {};
__export(Solid_node_exports, {
  Solid: () => Solid
});
module.exports = __toCommonJS(Solid_node_exports);
var import_n8n_workflow = require("n8n-workflow");

// node_modules/@jeswr/fetch-rdf/dist/parse.js
var import_content_type = __toESM(require("content-type"), 1);
var import_n3 = require("n3");
var import_jsonld_streaming_parser = require("jsonld-streaming-parser");

// node_modules/@jeswr/fetch-rdf/dist/errors.js
var RdfFetchError = class extends Error {
  /** The original cause, if any (e.g. a network error or parser exception). */
  cause;
  /** HTTP status code from a non-2xx response, if applicable. */
  status;
  /** The final request URL (after redirects), if known. */
  url;
  /** Raw `Content-Type` header from the response, if known. */
  contentType;
  constructor(message, options = {}) {
    super(message);
    this.name = "RdfFetchError";
    if (options.cause !== void 0)
      this.cause = options.cause;
    if (options.status !== void 0)
      this.status = options.status;
    if (options.url !== void 0)
      this.url = options.url;
    if (options.contentType !== void 0)
      this.contentType = options.contentType;
  }
};

// node_modules/@jeswr/fetch-rdf/dist/parse.js
var SUPPORTED_RDF_MEDIA_TYPES = [
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/ld+json"
];
var N3_FAMILY = /* @__PURE__ */ new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig"
]);
var JSON_LD_FAMILY = /* @__PURE__ */ new Set([
  "application/ld+json"
]);
async function parseRdf(body, contentTypeHeader, options = {}) {
  const rawHeader = contentTypeHeader ?? "text/turtle";
  let mediaType;
  try {
    mediaType = import_content_type.default.parse(rawHeader).type;
  } catch (cause) {
    throw new RdfFetchError(`Invalid Content-Type header: "${rawHeader}".`, { cause, contentType: rawHeader });
  }
  const baseIRI = options.baseIRI;
  let parser;
  if (N3_FAMILY.has(mediaType)) {
    parser = new import_n3.StreamParser({
      format: mediaType,
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else if (JSON_LD_FAMILY.has(mediaType)) {
    parser = new import_jsonld_streaming_parser.JsonLdParser({
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else {
    throw new RdfFetchError(`Unsupported RDF media type: "${mediaType}". Supported: ${SUPPORTED_RDF_MEDIA_TYPES.join(", ")}.`, { contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
  const storePromise = collectIntoStore(parser);
  try {
    await pumpBody(parser, body);
    return await storePromise;
  } catch (cause) {
    if (cause instanceof RdfFetchError)
      throw cause;
    throw new RdfFetchError(`Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`, { cause, contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
}
function collectIntoStore(parser) {
  return new Promise((resolve, reject) => {
    const store = new import_n3.Store();
    parser.on("data", (quad) => {
      store.addQuad(quad);
    });
    parser.on("error", reject);
    parser.on("end", () => {
      resolve(store);
    });
  });
}
async function pumpBody(parser, body) {
  if (typeof body === "string") {
    parser.end(body);
    return;
  }
  let parserError = null;
  const onParserError = (err) => {
    parserError = err;
  };
  parser.on("error", onParserError);
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    for (; ; ) {
      if (parserError)
        throw parserError;
      const { done, value } = await reader.read();
      if (done)
        break;
      if (value === void 0)
        continue;
      const text = decoder.decode(value, { stream: true });
      if (text.length === 0)
        continue;
      if (!parser.write(text))
        await waitForDrain(parser);
    }
    if (parserError)
      throw parserError;
    const tail = decoder.decode();
    if (tail.length > 0)
      parser.write(tail);
    parser.end();
  } catch (err) {
    parser.destroy(err instanceof Error ? err : new Error(String(err)));
    try {
      await reader.cancel();
    } catch {
    }
    throw err;
  } finally {
    parser.off("error", onParserError);
    reader.releaseLock();
  }
}
function waitForDrain(parser) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      parser.off("drain", onDrain);
      parser.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    parser.once("drain", onDrain);
    parser.once("error", onError);
  });
}

// node_modules/@jeswr/guarded-fetch/dist/index.js
var __create2 = Object.create;
var __defProp2 = Object.defineProperty;
var __getOwnPropDesc2 = Object.getOwnPropertyDescriptor;
var __getOwnPropNames2 = Object.getOwnPropertyNames;
var __getProtoOf2 = Object.getPrototypeOf;
var __hasOwnProp2 = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames2(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps2 = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames2(from))
      if (!__hasOwnProp2.call(to, key) && key !== except)
        __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc2(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM2 = (mod, isNodeMode, target) => (target = mod != null ? __create2(__getProtoOf2(mod)) : {}, __copyProps2(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var require_ipaddr = __commonJS({
  "node_modules/ipaddr.js/lib/ipaddr.js"(exports2, module2) {
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
        parts = (function() {
          const ref = string.split(":");
          const results = [];
          for (let i = 0; i < ref.length; i++) {
            results.push(parseInt(ref[i], 16));
          }
          return results;
        })();
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
      ipaddr2.IPv4 = (function() {
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
      })();
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
          return (function() {
            const ref = match.slice(1, 6);
            const results = [];
            for (let i = 0; i < ref.length; i++) {
              part = ref[i];
              results.push(parseIntAuto(part));
            }
            return results;
          })();
        } else if (match = string.match(ipv4Regexes.longValue)) {
          value = parseIntAuto(match[1]);
          if (value > 4294967295 || value < 0) {
            throw new Error("ipaddr: address outside defined range");
          }
          return (function() {
            const results = [];
            let shift;
            for (shift = 0; shift <= 24; shift += 8) {
              results.push(value >> shift & 255);
            }
            return results;
          })().reverse();
        } else if (match = string.match(ipv4Regexes.twoOctet)) {
          return (function() {
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
          })();
        } else if (match = string.match(ipv4Regexes.threeOctet)) {
          return (function() {
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
          })();
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
      ipaddr2.IPv6 = (function() {
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
          const addr = (function() {
            const results = [];
            for (let i = 0; i < this.parts.length; i++) {
              results.push(padPart(this.parts[i].toString(16), 4));
            }
            return results;
          }).call(this).join(":");
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
          const addr = (function() {
            const results = [];
            for (let i = 0; i < this.parts.length; i++) {
              results.push(this.parts[i].toString(16));
            }
            return results;
          }).call(this).join(":");
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
      })();
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
      if (typeof module2 !== "undefined" && module2.exports) {
        module2.exports = ipaddr2;
      } else {
        root.ipaddr = ipaddr2;
      }
    })(exports2);
  }
});
var import_ipaddr = __toESM2(require_ipaddr(), 1);
var DEFAULT_HOSTNAME_DENYLIST = Object.freeze([
  "metadata.google.internal",
  "metadata.goog",
  ".internal",
  ".svc.cluster.local",
  ".cluster.local",
  ".vercel-internal.com"
]);
var DEFAULT_MAX_BYTES = 1024 * 1024;
var NODE_DNS_SPECIFIER = ["node:dns", "promises"].join("/");
var PodScopeError = class extends Error {
  constructor(message2, options) {
    super(message2, options);
    this.name = "PodScopeError";
  }
};
var ENCODED_DELIMITER = /%2f|%5c/i;
function redactUserinfo(value) {
  if (typeof value !== "string") {
    return String(value);
  }
  return value.replace(/\/\/[^/?#]*@/g, "//<redacted>@");
}
function normalizePodBase(base) {
  if (typeof base !== "string" || base.trim().length === 0) {
    throw new PodScopeError("pod base URL must be a non-empty string.");
  }
  let url;
  try {
    url = new URL(base.trim());
  } catch {
    throw new PodScopeError(
      `pod base URL must be an absolute http(s) URL, got: ${redactUserinfo(base)}`
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PodScopeError(`pod base URL must be http(s), got protocol: ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new PodScopeError("pod base URL must not embed credentials (user:pass@).");
  }
  if (ENCODED_DELIMITER.test(url.pathname)) {
    throw new PodScopeError(
      `pod base URL contains an encoded path delimiter (%2F/%5C): ${redactUserinfo(base)}`
    );
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}
function assertWithinPodScope(base, url, options) {
  const root = normalizePodBase(base);
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new PodScopeError("target URL must be a non-empty string.");
  }
  const trimmed = url.trim();
  if (trimmed.startsWith("//")) {
    throw new PodScopeError(
      `target URL must not be scheme-relative ("//..."): ${redactUserinfo(url)} (refused)`
    );
  }
  let resolved;
  try {
    resolved = new URL(trimmed, root);
  } catch {
    throw new PodScopeError(`target URL is invalid: ${redactUserinfo(url)}`);
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new PodScopeError(
      `target URL must be http(s), got protocol: ${resolved.protocol} (refused)`
    );
  }
  if (resolved.username !== "" || resolved.password !== "") {
    throw new PodScopeError("target URL must not embed credentials (user:pass@) (refused)");
  }
  const b = new URL(root);
  if (resolved.origin !== b.origin) {
    throw new PodScopeError(
      `target URL ${redactUserinfo(resolved.toString())} escapes pod origin ${b.origin} (refused)`
    );
  }
  if (ENCODED_DELIMITER.test(resolved.pathname)) {
    throw new PodScopeError(
      `target URL ${redactUserinfo(resolved.toString())} contains an encoded path delimiter (%2F/%5C) (refused)`
    );
  }
  const basePath = b.pathname;
  const isRoot = resolved.pathname === basePath || basePath !== "/" && resolved.pathname === basePath.slice(0, -1);
  if (!isRoot && !resolved.pathname.startsWith(basePath)) {
    throw new PodScopeError(
      `target URL ${redactUserinfo(resolved.toString())} escapes pod path ${basePath} (refused)`
    );
  }
  if (isRoot && options?.allowRoot === false) {
    throw new PodScopeError(
      `target URL ${redactUserinfo(resolved.toString())} is the pod base itself, not a resource under it (refused; allowRoot is false)`
    );
  }
  return resolved.toString();
}
function podScopedUrl(base, url, options) {
  try {
    return assertWithinPodScope(base, url, options);
  } catch {
    return void 0;
  }
}
function isContainerUrl(url) {
  try {
    return new URL(url).pathname.endsWith("/");
  } catch {
    return url.endsWith("/");
  }
}

// node_modules/@rdfjs/wrapper/dist/TermWrapper.js
var TermWrapper = class {
  original;
  _dataset;
  _factory;
  constructor(term, dataset, factory) {
    this.original = typeof term === "string" ? factory.namedNode(term) : term;
    this._dataset = dataset;
    this._factory = factory;
  }
  /**
   * The dataset that contains this term.
   *
   * This accessor provides access to the underlying RDF graph that is the containing context of a node mapped to JavaScript by instances of this class.
   *
   * @remarks
   * RDF/JS, like many other RDF frameworks, keeps terms and datasets separate. This means that terms do not hold a reference to a dataset they reside in (or were found in). This, in turn, means that a dataset must always be available, separate from the term, if either changes to the underlying data or further traversal of the underlying data is called for. In an object-oriented context however, where property chaining is idiomatic (i.e. `instance.property1.property2`), there is no way to supply the dataset when dereferencing a link in the chain.
   *
   * This property solves the problem by keeping a reference to the dataset.
   *
   * @exmaple
   * Using the dataset to modify information related to this node in the underlying data:
   * ```ts
   * class Book extends TermWrapper {
   *   set author(value: string) {
   *     const subject = this as Quad_Subject
   *     const predicate = this.factory.namedNode("http://example.com/author")
   *     const object = this.factory.literal(value)
   *     const oldAuthors = this.factory.quad(subject, predicate)
   *     const newAuthor = this.factory.quad(subject, predicate, object)
   *
   *     this.dataset.delete(oldAuthors)
   *     this.dataset.add(newAuthor)
   *   }
   * }
   * ```
   * Note: The above example operates on a low level to explain this property. Library users are more likely to interact with {@link OptionalAs}, {@link RequiredAs} and {@link LiteralFrom} for a better experience.
   *
   * @exmaple
   * Using the dataset to modify data related to this node in the underlying data:
   * ```ts
   * class Container extends TermWrapper {
   *   add(something: string) {
   *     const subject = this as Quad_Subject
   *     const predicate = this.factory.namedNode("http://example.com/contains")
   *     const object = this.factory.literal(something)
   *     const quad = this.factory.quad(subject, predicate, object)
   *
   *     this.dataset.add(quad)
   *   }
   * }
   * ```
   */
  get dataset() {
    return this._dataset;
  }
  /**
   * The data factory this instance was instantiated with. A collection of methods that can be used to create terms by this or subsequent wrappers.
   *
   * @exmaple
   * Using the factory to create a literal term from the current date and time:
   * ```ts
   * class Calendar extends TermWrapper {
   *   get currentDate(): Literal {
   *     const date = new Date().toISOString()
   *     const xsdDateTime = this.factory.namedNode("http://www.w3.org/2001/XMLSchema#dateTime")
   *
   *     return this.factory.literal(date, xsdDateTime)
   *   }
   * }
   * ```
   *
   * @exmaple
   * Using the factory to create a quad:
   * ```ts
   * class Container extends TermWrapper {
   *   add(something: string) {
   *     const subject = this as Quad_Subject
   *     const predicate = this.factory.namedNode("http://example.com/contains")
   *     const object = this.factory.literal(something)
   *     const quad = this.factory.quad(subject, predicate, object)
   *
   *     this.dataset.add(quad)
   *   }
   * }
   * ```
   */
  get factory() {
    return this._factory;
  }
  /**
   * The well-known property containing a string that represents the type of this object.
   */
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
  //#region Implementation of RDF/JS Term
  get termType() {
    return this.original.termType;
  }
  get value() {
    return this.original.value;
  }
  equals(other) {
    return this.original.equals(other);
  }
  //#region Implementation of RDF/JS Literal
  get language() {
    return this.original.language;
  }
  get direction() {
    return this.original.direction;
  }
  get datatype() {
    return this.original.datatype;
  }
  //#endregion
  //#region Implementation of RDF/JS Quad
  get subject() {
    return this.original.subject;
  }
  get predicate() {
    return this.original.predicate;
  }
  get object() {
    return this.original.object;
  }
  get graph() {
    return this.original.graph;
  }
};

// node_modules/@rdfjs/wrapper/dist/IndexerInterceptor.js
var IndexerInterceptor = class {
  get(target, property, receiver) {
    if (notNumeric(property)) {
      return Reflect.get(target, property, receiver);
    }
    return target.at(Number.parseInt(property));
  }
  set(target, property, value, receiver) {
    if (notNumeric(property)) {
      return Reflect.set(target, property, value, receiver);
    }
    const i = Number.parseInt(property);
    target.fill(value, i, i + 1);
    return true;
  }
  deleteProperty(target, property) {
    if (notNumeric(property)) {
      return Reflect.deleteProperty(target, property);
    }
    return false;
  }
};
function notNumeric(property) {
  return typeof property === "symbol" || isNaN(parseInt(property));
}

// node_modules/@rdfjs/wrapper/dist/vocabulary/RDF.js
var RDF = {
  langString: "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
  type: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
  first: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
  rest: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
  nil: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil"
};

// node_modules/@rdfjs/wrapper/dist/mapping/TermFrom.js
var TermFrom;
(function(TermFrom2) {
  function instance(value, factory) {
    return itself(value, factory);
  }
  TermFrom2.instance = instance;
  function itself(value, _) {
    return value;
  }
  TermFrom2.itself = itself;
})(TermFrom || (TermFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/RequiredFrom.js
var RequiredFrom;
(function(RequiredFrom2) {
  function subjectPredicate(anchor1, p, termAs) {
    if (termAs === void 0) {
      throw new Error();
    }
    const anchor2 = anchor1.factory.namedNode(p);
    const matches = anchor1.dataset.match(anchor1, anchor2)[Symbol.iterator]();
    const { value: first, done: none } = matches.next();
    if (none) {
      throw new Error(`No value found for predicate ${p} on term ${anchor1.value}`);
    }
    if (!matches.next().done) {
      throw new Error(`More than one value for predicate ${p} on term ${anchor1.value}`);
    }
    return termAs(new TermWrapper(first.object, anchor1.dataset, anchor1.factory));
  }
  RequiredFrom2.subjectPredicate = subjectPredicate;
})(RequiredFrom || (RequiredFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/OptionalFrom.js
var OptionalFrom;
(function(OptionalFrom2) {
  function subjectPredicate(anchor, p, termAs) {
    if (termAs === void 0) {
      throw new Error();
    }
    const predicate = anchor.factory.namedNode(p);
    for (const q of anchor.dataset.match(anchor, predicate)) {
      return termAs(new TermWrapper(q.object, anchor.dataset, anchor.factory));
    }
    return void 0;
  }
  OptionalFrom2.subjectPredicate = subjectPredicate;
})(OptionalFrom || (OptionalFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/OptionalAs.js
var OptionalAs;
(function(OptionalAs2) {
  function object(anchor, p, value, termFrom) {
    if (termFrom === void 0) {
      throw new Error();
    }
    const predicate = anchor.factory.namedNode(p);
    for (const q2 of anchor.dataset.match(anchor, predicate)) {
      anchor.dataset.delete(q2);
    }
    if (value === void 0) {
      return;
    }
    if (!isQuadSubject(anchor)) {
      return;
    }
    const o = termFrom(value, anchor.factory);
    if (o === void 0) {
      return;
    }
    if (!isQuadObject(o)) {
      return;
    }
    const q = anchor.factory.quad(anchor, predicate, o);
    anchor.dataset.add(q);
  }
  OptionalAs2.object = object;
})(OptionalAs || (OptionalAs = {}));
function isQuadSubject(term) {
  return ["NamedNode", "BlankNode", "Quad", "Variable"].includes(term.termType);
}
function isQuadObject(term) {
  return ["NamedNode", "Literal", "BlankNode", "Quad", "Variable"].includes(term.termType);
}

// node_modules/@rdfjs/wrapper/dist/mapping/RequiredAs.js
var RequiredAs;
(function(RequiredAs2) {
  function object(anchor, p, value, termFrom) {
    if (value === void 0) {
      throw new Error("value cannot be undefined");
    }
    OptionalAs.object(anchor, p, value, termFrom);
  }
  RequiredAs2.object = object;
})(RequiredAs || (RequiredAs = {}));

// node_modules/@rdfjs/wrapper/dist/ListItem.js
var ListItem = class _ListItem extends TermWrapper {
  termAs;
  termFrom;
  constructor(term, dataset, factory, termAs, termFrom) {
    super(term, dataset, factory);
    this.termAs = termAs;
    this.termFrom = termFrom;
  }
  get firstRaw() {
    return OptionalFrom.subjectPredicate(this, RDF.first, TermAs.term);
  }
  set firstRaw(value) {
    OptionalAs.object(this, RDF.first, value, TermFrom.itself);
  }
  get restRaw() {
    return OptionalFrom.subjectPredicate(this, RDF.rest, TermAs.term);
  }
  set restRaw(value) {
    OptionalAs.object(this, RDF.rest, value, TermFrom.itself);
  }
  get isListItem() {
    return this.firstRaw !== void 0 && this.restRaw !== void 0;
  }
  get isNil() {
    return this.equals(this.factory.namedNode(RDF.nil));
  }
  get first() {
    return RequiredFrom.subjectPredicate(this, RDF.first, this.termAs);
  }
  set first(value) {
    RequiredAs.object(this, RDF.first, value, this.termFrom);
  }
  get rest() {
    return RequiredFrom.subjectPredicate(this, RDF.rest, (w) => new _ListItem(w, w.dataset, w.factory, this.termAs, this.termFrom));
  }
  set rest(value) {
    RequiredAs.object(this, RDF.rest, value, TermFrom.instance);
  }
  pop() {
    try {
      return this.first;
    } finally {
      this.firstRaw = void 0;
      this.restRaw = this.factory.namedNode(RDF.nil);
    }
  }
  *items() {
    if (this.firstRaw === void 0) {
      return;
    }
    yield this;
    for (const more of this.rest.items()) {
      yield more;
    }
  }
};

// node_modules/@rdfjs/wrapper/dist/Overwriter.js
var Overwriter = class extends TermWrapper {
  p;
  constructor(subject, p) {
    super(subject, subject.dataset, subject.factory);
    this.p = p;
  }
  set listNode(object) {
    RequiredAs.object(this, this.p, object, TermFrom.instance);
  }
};

// node_modules/@rdfjs/wrapper/dist/RdfList.js
var RdfList = class {
  subject;
  predicate;
  termAs;
  termFrom;
  root;
  constructor(root, subject, predicate, termAs, termFrom) {
    this.subject = subject;
    this.predicate = predicate;
    this.termAs = termAs;
    this.termFrom = termFrom;
    this.root = new ListItem(root, this.subject.dataset, this.subject.factory, termAs, termFrom);
    return new Proxy(this, new IndexerInterceptor());
  }
  get [Symbol.unscopables]() {
    return Array.prototype[Symbol.unscopables];
  }
  get length() {
    return [...this.items].length;
  }
  set length(_) {
    throw new Error("this array is based on an RDF Collection. Its length cannot be modified like this.");
  }
  [Symbol.iterator]() {
    return this.values();
  }
  at(index) {
    return [...this.items].at(index)?.first;
  }
  concat(...items) {
    return [...this].concat(...items);
  }
  copyWithin(target, start, end) {
    throw new Error("not implemented");
  }
  entries() {
    return [...this].entries();
  }
  every(predicate, thisArg) {
    return [...this].every(predicate, thisArg);
  }
  fill(value, start, end) {
    throw new Error("not implemented");
  }
  filter(predicate, thisArg) {
    return [...this].filter(predicate, thisArg);
  }
  find(predicate, thisArg) {
    return [...this].find(predicate, thisArg);
  }
  findIndex(predicate, thisArg) {
    return [...this].findIndex(predicate, thisArg);
  }
  flat(depth) {
    throw new Error("not implemented");
  }
  flatMap(callback, thisArg) {
    return [...this].flatMap(callback, thisArg);
  }
  forEach(callback, thisArg) {
    [...this].forEach(callback, thisArg);
  }
  includes(searchElement, fromIndex) {
    return [...this].includes(searchElement, fromIndex);
  }
  indexOf(searchElement, fromIndex) {
    return [...this].indexOf(searchElement, fromIndex);
  }
  join(separator) {
    return [...this].join(separator);
  }
  keys() {
    return [...this.items].keys();
  }
  lastIndexOf(searchElement, fromIndex) {
    return [...this].lastIndexOf(searchElement, fromIndex);
  }
  map(callback, thisArg) {
    return [...this].map(callback, thisArg);
  }
  pop() {
    return [...this.items].at(-1)?.pop();
  }
  push(...items) {
    const nil = this.subject.factory.namedNode(RDF.nil);
    for (const item of items) {
      const newNode = new ListItem(this.subject.factory.blankNode(), this.subject.dataset, this.subject.factory, this.termAs, this.termFrom);
      const lastNode = this.root.isNil ? (
        // The statement representing an empty list is replaced by a new one whose object is the new node
        // The representation of the first item (root, currently rdf:nil, the empty list) is overwritten by the new node
        this.root = new Overwriter(this.subject, this.predicate).listNode = newNode
      ) : (
        // replace rest of current last with new and return is because it's the new last
        [...this.items].at(-1).rest = newNode
      );
      lastNode.first = item;
      lastNode.restRaw = nil;
    }
    return this.length;
  }
  reduce(callback, initialValue) {
    return [...this].reduce(callback, initialValue);
  }
  reduceRight(callback, initialValue) {
    return [...this].reduceRight(callback, initialValue);
  }
  reverse() {
    throw new Error("not implemented");
  }
  shift() {
    if (this.root.isNil) {
      return void 0;
    }
    const value = this.root.first;
    if (this.root.rest.isNil) {
      new Overwriter(this.subject, this.predicate).listNode = this.root.rest;
      this.root.firstRaw = void 0;
      this.root.restRaw = void 0;
    } else {
      this.root.firstRaw = this.root.rest.firstRaw;
      this.root.restRaw = this.root.rest.restRaw;
    }
    return value;
  }
  slice(start, end) {
    return [...this].slice(start, end);
  }
  some(predicate, thisArg) {
    return [...this].some(predicate, thisArg);
  }
  sort(compareFn) {
    throw new Error("not implemented");
  }
  splice(start, deleteCount, ...items) {
    throw new Error("not implemented");
  }
  unshift(...items) {
    for (const item of items.reverse()) {
      const firstNode = this.root;
      this.root = new Overwriter(this.subject, this.predicate).listNode = new ListItem(this.subject.factory.blankNode(), this.subject.dataset, this.subject.factory, this.termAs, this.termFrom);
      this.root.first = item;
      this.root.rest = firstNode;
    }
    return this.length;
  }
  *values() {
    for (const item of this.items) {
      yield item.first;
    }
  }
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
  get items() {
    return this.root.items();
  }
};

// node_modules/@rdfjs/wrapper/dist/errors/WrapperError.js
var WrapperError = class extends Error {
  /**
   * Creates a new instance of {@link WrapperError}.
   *
   * @param message - A human-readable description of the error.
   * @param cause - The specific original cause of the error.
   */
  constructor(message, cause) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
  //#region Ignore in documentation
  /** @ignore */
  static captureStackTrace(targetObject, constructorOpt) {
    super.captureStackTrace(targetObject, constructorOpt);
  }
  /** @ignore */
  static prepareStackTrace(err, stackTraces) {
    super.prepareStackTrace(err, stackTraces);
  }
  /** @ignore */
  static get stackTraceLimit() {
    return super.stackTraceLimit;
  }
  /** @ignore */
  static set stackTraceLimit(value) {
    super.stackTraceLimit = value;
  }
};

// node_modules/@rdfjs/wrapper/dist/errors/TermError.js
var TermError = class extends WrapperError {
  term;
  /**
   * Creates a new instance of {@link TermError}.
   *
   * @param term - The term associated with this error.
   * @param message - A human-readable description of the error.
   * @param cause - The specific original cause of the error.
   */
  constructor(term, message, cause) {
    super(message, cause);
    this.term = term;
  }
};

// node_modules/@rdfjs/wrapper/dist/errors/TermTypeError.js
var TermTypeError = class extends TermError {
  termType;
  /**
   * Creates a new instance of {@link TermTypeError}.
   *
   * @param term - The term associated with this error.
   * @param termType - The expected term type.
   * @param cause - The specific original cause of the error.
   */
  constructor(term, termType, cause) {
    super(term, `Term type must be ${termType} but was ${term.termType}`, cause);
    this.termType = termType;
  }
};

// node_modules/@rdfjs/wrapper/dist/errors/LiteralDatatypeError.js
var LiteralDatatypeError = class extends TermError {
  datatypes;
  /**
   * Creates a new instance of {@link LiteralDatatypeError}.
   *
   * @param literal - The literal associated with this error.
   * @param datatypes - The expected datatypes.
   * @param cause - The specific original cause of the error.
   */
  constructor(literal, datatypes, cause) {
    super(literal, `Datatype must be one of ${[...datatypes].join()} but was ${literal.datatype}`, cause);
    this.datatypes = datatypes;
  }
};

// node_modules/@rdfjs/wrapper/dist/errors/ListRootError.js
var ListRootError = class extends TermError {
  constructor(term, cause) {
    super(term, `List root must be rdf:nil or a BlankNode but was ${term.value}`, cause);
  }
};

// node_modules/@rdfjs/wrapper/dist/ensure.js
function ensurePresent(object) {
  if (object !== void 0 && object !== null) {
    return;
  }
  throw new ReferenceError("Object must not be undefined or null");
}
function ensureIs(object, type) {
  if (object instanceof type) {
    return;
  }
  throw new TypeError(`Object must be a ${type}`);
}
function ensureTermType(term, type) {
  if (term.termType === type) {
    return;
  }
  throw new TermTypeError(term, type);
}
function ensureDatatype(term, ...datatypes) {
  if (datatypes.includes(term.datatype.value)) {
    return;
  }
  throw new LiteralDatatypeError(term, datatypes);
}
function ensureListRoot(term) {
  if (term.termType === "NamedNode" && term.value === RDF.nil) {
    return;
  }
  if (term.termType === "BlankNode") {
    return;
  }
  throw new ListRootError(term);
}

// node_modules/@rdfjs/wrapper/dist/mapping/TermAs.js
var TermAs;
(function(TermAs2) {
  function instance(constructor) {
    return (term2) => {
      ensurePresent(term2);
      ensureIs(term2, TermWrapper);
      return new constructor(term2, term2.dataset, term2.factory);
    };
  }
  TermAs2.instance = instance;
  function is(term2) {
    return term2;
  }
  TermAs2.is = is;
  function list(subject, predicate, termAs, termFrom) {
    return (term2) => {
      ensurePresent(term2);
      ensureIs(term2, TermWrapper);
      ensureListRoot(term2);
      return new RdfList(term2, subject, predicate, termAs, termFrom);
    };
  }
  TermAs2.list = list;
  function term(term2) {
    return term2;
  }
  TermAs2.term = term;
})(TermAs || (TermAs = {}));

// node_modules/@rdfjs/wrapper/dist/vocabulary/XSD.js
var XSD = {
  anyURI: "http://www.w3.org/2001/XMLSchema#anyURI",
  base64Binary: "http://www.w3.org/2001/XMLSchema#base64Binary",
  boolean: "http://www.w3.org/2001/XMLSchema#boolean",
  byte: "http://www.w3.org/2001/XMLSchema#byte",
  date: "http://www.w3.org/2001/XMLSchema#date",
  dateTime: "http://www.w3.org/2001/XMLSchema#dateTime",
  decimal: "http://www.w3.org/2001/XMLSchema#decimal",
  double: "http://www.w3.org/2001/XMLSchema#double",
  float: "http://www.w3.org/2001/XMLSchema#float",
  hexBinary: "http://www.w3.org/2001/XMLSchema#hexBinary",
  int: "http://www.w3.org/2001/XMLSchema#int",
  integer: "http://www.w3.org/2001/XMLSchema#integer",
  long: "http://www.w3.org/2001/XMLSchema#long",
  negativeInteger: "http://www.w3.org/2001/XMLSchema#negativeInteger",
  nonNegativeInteger: "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
  nonPositiveInteger: "http://www.w3.org/2001/XMLSchema#nonPositiveInteger",
  positiveInteger: "http://www.w3.org/2001/XMLSchema#positiveInteger",
  short: "http://www.w3.org/2001/XMLSchema#short",
  string: "http://www.w3.org/2001/XMLSchema#string",
  unsignedByte: "http://www.w3.org/2001/XMLSchema#unsignedByte",
  unsignedInt: "http://www.w3.org/2001/XMLSchema#unsignedInt",
  unsignedLong: "http://www.w3.org/2001/XMLSchema#unsignedLong",
  unsignedShort: "http://www.w3.org/2001/XMLSchema#unsignedShort"
};

// node_modules/@rdfjs/wrapper/dist/mapping/LiteralAs.js
var LiteralAs;
(function(LiteralAs2) {
  function bigint(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, ...integerDatatypes);
    return BigInt(term.value);
  }
  LiteralAs2.bigint = bigint;
  function boolean(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, XSD.boolean);
    return term.value === "true" || term.value === "1";
  }
  LiteralAs2.boolean = boolean;
  function date(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, ...dateDatatypes);
    return new Date(term.value);
  }
  LiteralAs2.date = date;
  function langString(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, RDF.langString);
    return { lang: term.language, string: term.value };
  }
  LiteralAs2.langString = langString;
  function number(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, ...numericDatatypes);
    if (term.value === "INF") {
      return Number.POSITIVE_INFINITY;
    }
    if (term.value === "-INF") {
      return Number.NEGATIVE_INFINITY;
    }
    if (term.value === "NaN") {
      return Number.NaN;
    }
    return Number(term.value);
  }
  LiteralAs2.number = number;
  function string(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    return term.value;
  }
  LiteralAs2.string = string;
  function symbol(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    return Symbol.for(term.value);
  }
  LiteralAs2.symbol = symbol;
  function uInt8Array(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, ...byteArrayDatatypes);
    switch (term.datatype.value) {
      case XSD.hexBinary:
        return Uint8Array.from(Buffer.from(term.value, "hex"));
      default:
      case XSD.base64Binary:
        return Uint8Array.from(Buffer.from(term.value, "base64"));
    }
  }
  LiteralAs2.uInt8Array = uInt8Array;
  function url(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, XSD.anyURI);
    return new URL(term.value);
  }
  LiteralAs2.url = url;
  function langTuple(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, RDF.langString);
    return [term.language, term.value];
  }
  LiteralAs2.langTuple = langTuple;
  function datatypeTuple(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    return [term.datatype.value, term.value];
  }
  LiteralAs2.datatypeTuple = datatypeTuple;
})(LiteralAs || (LiteralAs = {}));
var byteArrayDatatypes = [
  XSD.base64Binary,
  XSD.hexBinary
];
var integerDatatypes = [
  XSD.integer,
  XSD.nonPositiveInteger,
  XSD.long,
  XSD.nonNegativeInteger,
  XSD.negativeInteger,
  XSD.int,
  XSD.unsignedLong,
  XSD.positiveInteger,
  XSD.short,
  XSD.unsignedInt,
  XSD.byte,
  XSD.unsignedShort,
  XSD.unsignedByte
];
var numericDatatypes = integerDatatypes.concat([
  XSD.decimal,
  XSD.float,
  XSD.double
]);
var dateDatatypes = [
  XSD.date,
  XSD.dateTime
];

// node_modules/@rdfjs/wrapper/dist/mapping/LiteralFrom.js
var LiteralFrom;
(function(LiteralFrom2) {
  function anyUriString(value, factory) {
    return factory.literal(value, factory.namedNode(XSD.anyURI));
  }
  LiteralFrom2.anyUriString = anyUriString;
  function anyUriUrl(value, factory) {
    return anyUriString(value.toString(), factory);
  }
  LiteralFrom2.anyUriUrl = anyUriUrl;
  function base64(value, factory) {
    return factory.literal(value.toBase64(), factory.namedNode(XSD.base64Binary));
  }
  LiteralFrom2.base64 = base64;
  function boolean(value, factory) {
    return factory.literal(value.toString(), factory.namedNode(XSD.boolean));
  }
  LiteralFrom2.boolean = boolean;
  function date(value, factory) {
    return factory.literal(value.toISOString(), factory.namedNode(XSD.date));
  }
  LiteralFrom2.date = date;
  function dateTime(value, factory) {
    return factory.literal(value.toISOString(), factory.namedNode(XSD.dateTime));
  }
  LiteralFrom2.dateTime = dateTime;
  function double(value, factory) {
    return factory.literal(value.toString(), factory.namedNode(XSD.double));
  }
  LiteralFrom2.double = double;
  function integer(value, factory) {
    return factory.literal(value.toString(), factory.namedNode(XSD.integer));
  }
  LiteralFrom2.integer = integer;
  function hex(value, factory) {
    return factory.literal(value.toHex(), factory.namedNode(XSD.hexBinary));
  }
  LiteralFrom2.hex = hex;
  function langString(value, factory) {
    return factory.literal(value.string, { language: value.lang });
  }
  LiteralFrom2.langString = langString;
  function string(value, factory) {
    return factory.literal(value);
  }
  LiteralFrom2.string = string;
  function langTuple([key, value], factory) {
    return factory.literal(value, key);
  }
  LiteralFrom2.langTuple = langTuple;
  function datatypeTuple([key, value], factory) {
    return factory.literal(value, factory.namedNode(key));
  }
  LiteralFrom2.datatypeTuple = datatypeTuple;
})(LiteralFrom || (LiteralFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/NamedNodeFrom.js
var NamedNodeFrom;
(function(NamedNodeFrom2) {
  function string(value, factory) {
    return factory.namedNode(value);
  }
  NamedNodeFrom2.string = string;
  function url(value, factory) {
    return string(value.toString(), factory);
  }
  NamedNodeFrom2.url = url;
})(NamedNodeFrom || (NamedNodeFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/NamedNodeAs.js
var NamedNodeAs;
(function(NamedNodeAs2) {
  function string(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "NamedNode");
    return term.value;
  }
  NamedNodeAs2.string = string;
  function url(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "NamedNode");
    return new URL(term.value);
  }
  NamedNodeAs2.url = url;
})(NamedNodeAs || (NamedNodeAs = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/BlankNodeFrom.js
var BlankNodeFrom;
(function(BlankNodeFrom2) {
  function string(value, factory) {
    return factory.blankNode(value);
  }
  BlankNodeFrom2.string = string;
})(BlankNodeFrom || (BlankNodeFrom = {}));

// node_modules/@rdfjs/wrapper/dist/WrappingMap.js
var WrappingMap = class {
  subject;
  predicate;
  termAs;
  termFrom;
  constructor(subject, predicate, termAs, termFrom) {
    this.subject = subject;
    this.predicate = predicate;
    this.termAs = termAs;
    this.termFrom = termFrom;
  }
  clear() {
    for (const q of this.matches) {
      this.subject.dataset.delete(q);
    }
  }
  delete(k) {
    const p = this.subject.factory.namedNode(this.predicate);
    for (const entry of this) {
      if (entry[0] !== k) {
        continue;
      }
      this.subject.dataset.delete(this.subject.factory.quad(this.subject, p, this.termFrom(entry, this.subject.factory)));
      return true;
    }
    return false;
  }
  forEach(callback, thisArg) {
    for (const [key, value] of this) {
      callback.call(thisArg, value, key, this);
    }
  }
  get(k) {
    for (const [key, value] of this) {
      if (key !== k) {
        continue;
      }
      return value;
    }
    return void 0;
  }
  has(k) {
    return this.get(k) !== void 0;
  }
  set(k, v) {
    this.delete(k);
    this.add(k, v);
    return this;
  }
  get size() {
    return [...this.matches].length;
  }
  set size(_) {
    throw new Error("not supported");
  }
  *entries() {
    for (const quad of this.matches) {
      yield this.termAs(new TermWrapper(quad.object, this.subject.dataset, this.subject.factory));
    }
  }
  *keys() {
    for (const [key] of this) {
      yield key;
    }
  }
  *values() {
    for (const [, value] of this) {
      yield value;
    }
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
  get matches() {
    const p = this.subject.factory.namedNode(this.predicate);
    return this.subject.dataset.match(this.subject, p);
  }
  add(k, v) {
    const p = this.subject.factory.namedNode(this.predicate);
    this.subject.dataset.add(this.subject.factory.quad(this.subject, p, this.termFrom([k, v], this.subject.factory)));
  }
};

// node_modules/@rdfjs/wrapper/dist/mapping/Mapping.js
var Mapping;
(function(Mapping2) {
  function languageDictionary(anchor, p, termAs, termFrom) {
    if (termAs === void 0) {
      throw new Error();
    }
    if (termFrom === void 0) {
      throw new Error();
    }
    return new WrappingMap(anchor, p, termAs, termFrom);
  }
  Mapping2.languageDictionary = languageDictionary;
})(Mapping || (Mapping = {}));

// node_modules/@rdfjs/wrapper/dist/WrappingSet.js
var WrappingSet = class {
  subject;
  predicate;
  termAs;
  termFrom;
  // TODO: Direction
  constructor(subject, predicate, termAs, termFrom) {
    this.subject = subject;
    this.predicate = predicate;
    this.termAs = termAs;
    this.termFrom = termFrom;
  }
  add(value) {
    this.subject.dataset.add(this.quad(value));
    return this;
  }
  clear() {
    for (const q of this.matches) {
      this.subject.dataset.delete(q);
    }
  }
  delete(value) {
    if (!this.has(value)) {
      return false;
    }
    const o = this.termFrom(value, this.subject.factory);
    const p = this.subject.factory.namedNode(this.predicate);
    for (const q of this.subject.dataset.match(this.subject, p, o)) {
      this.subject.dataset.delete(q);
    }
    return true;
  }
  forEach(cb, thisArg) {
    for (const item of this) {
      cb.call(thisArg, item, item, this);
    }
  }
  has(value) {
    return this.subject.dataset.has(this.quad(value));
  }
  get size() {
    return this.matches.size;
  }
  [Symbol.iterator]() {
    return this.values();
  }
  *entries() {
    for (const v of this) {
      yield [v, v];
    }
  }
  keys() {
    return this.values();
  }
  *values() {
    for (const q of this.matches) {
      yield this.termAs(new TermWrapper(q.object, this.subject.dataset, this.subject.factory));
    }
  }
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
  quad(value) {
    const s = this.subject;
    const p = this.subject.factory.namedNode(this.predicate);
    const o = this.termFrom(value, this.subject.factory);
    const q = this.subject.factory.quad(s, p, o);
    return q;
  }
  get matches() {
    const p = this.subject.factory.namedNode(this.predicate);
    return this.subject.dataset.match(this.subject, p);
  }
};

// node_modules/@rdfjs/wrapper/dist/mapping/SetFrom.js
var SetFrom;
(function(SetFrom2) {
  function subjectPredicate(anchor, p, termAs, termFrom) {
    if (termAs === void 0) {
      throw new Error();
    }
    if (termFrom === void 0) {
      throw new Error();
    }
    return new WrappingSet(anchor, p, termAs, termFrom);
  }
  SetFrom2.subjectPredicate = subjectPredicate;
})(SetFrom || (SetFrom = {}));

// node_modules/@rdfjs/wrapper/dist/DatasetWrapper.js
var DatasetWrapper = class {
  dataset;
  factory;
  //#region DatasetCore
  constructor(dataset, factory) {
    this.dataset = dataset;
    this.factory = factory;
  }
  get size() {
    return this.dataset.size;
  }
  *[Symbol.iterator]() {
    yield* this.dataset;
  }
  add(quad) {
    this.dataset.add(quad);
    return this;
  }
  delete(quad) {
    this.dataset.delete(quad);
    return this;
  }
  has(quad) {
    return this.dataset.has(quad);
  }
  match(subject, predicate, object, graph) {
    return this.dataset.match(subject, predicate, object, graph);
  }
  //#endregion
  //#region Utilities
  subjectsOf(predicate, termWrapper) {
    return this.matchSubjectsOf(termWrapper, this.factory.namedNode(predicate));
  }
  objectsOf(predicate, termWrapper) {
    return this.matchObjectsOf(termWrapper, void 0, this.factory.namedNode(predicate));
  }
  instancesOf(klass, constructor) {
    return this.matchSubjectsOf(constructor, this.factory.namedNode(RDF.type), this.factory.namedNode(klass));
  }
  named(graph, klass) {
    const g = typeof graph === "string" ? this.factory.namedNode(graph) : graph;
    return new klass(g, this.dataset, this.factory);
  }
  *matchSubjectsOf(termWrapper, predicate, object, graph) {
    for (const q of this.match(void 0, predicate, object, graph)) {
      yield new termWrapper(q.subject, this, this.factory);
    }
  }
  *matchObjectsOf(termWrapper, subject, predicate, graph) {
    for (const q of this.match(subject, predicate, void 0, graph)) {
      yield new termWrapper(q.object, this, this.factory);
    }
  }
  //#endregion
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
};

// node_modules/@solid/object/dist/vocabulary/dc.js
var DC = {
  modified: "http://purl.org/dc/terms/modified",
  title: "http://purl.org/dc/terms/title"
};

// node_modules/@solid/object/dist/vocabulary/ldp.js
var LDP = {
  contains: "http://www.w3.org/ns/ldp#contains"
};

// node_modules/@solid/object/dist/vocabulary/posix.js
var POSIX = {
  size: "http://www.w3.org/ns/posix/stat#size",
  mtime: "http://www.w3.org/ns/posix/stat#mtime"
};

// node_modules/@solid/object/dist/vocabulary/rdf.js
var RDF2 = {
  type: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
};

// node_modules/@solid/object/dist/vocabulary/rdfs.js
var RDFS = {
  label: "http://www.w3.org/2000/01/rdf-schema#label"
};

// node_modules/@solid/object/dist/solid/Resource.js
var Resource = class extends TermWrapper {
  #ianaMediaTypePattern = /^http:\/\/www\.w3\.org\/ns\/iana\/media-types\/(.+)#Resource$/;
  get id() {
    return this.value;
  }
  get isContainer() {
    return this.id.endsWith("/");
  }
  get fileType() {
    return this.isContainer ? "folder" : "file";
  }
  get title() {
    return OptionalFrom.subjectPredicate(this, DC.title, LiteralAs.string);
  }
  get label() {
    return OptionalFrom.subjectPredicate(this, RDFS.label, LiteralAs.string);
  }
  get name() {
    return this.title ?? this.label ?? this.extractNameFromUrl(this.id);
  }
  get modified() {
    return OptionalFrom.subjectPredicate(this, DC.modified, LiteralAs.date);
  }
  get mtime() {
    return OptionalFrom.subjectPredicate(this, POSIX.mtime, LiteralAs.date);
  }
  get lastModified() {
    return this.modified ?? this.mtime;
  }
  get size() {
    return OptionalFrom.subjectPredicate(this, POSIX.size, LiteralAs.number);
  }
  get type() {
    return SetFrom.subjectPredicate(this, RDF2.type, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get mimeType() {
    const matches = [...this.type].map((t) => this.#ianaMediaTypePattern.exec(t)).filter((results) => results !== null).map((results) => results[0]);
    for (const match of matches) {
      return match;
    }
    return;
  }
  toString() {
    return this.id;
  }
  // TODO: review implementation of this
  extractNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      let name = pathParts[pathParts.length - 1] || urlObj.hostname;
      try {
        name = decodeURIComponent(name);
      } catch (e) {
      }
      return name;
    } catch (e) {
      const parts = url.split("/").filter(Boolean);
      const lastPart = parts[parts.length - 1] || url;
      try {
        return decodeURIComponent(lastPart);
      } catch {
        return lastPart;
      }
    }
  }
};

// node_modules/@solid/object/dist/solid/Container.js
var Container = class extends Resource {
  get contains() {
    return SetFrom.subjectPredicate(this, LDP.contains, TermAs.instance(Resource), TermFrom.instance);
  }
};

// node_modules/@solid/object/dist/solid/ContainerDataset.js
var ContainerDataset = class extends DatasetWrapper {
  // TODO: Consider that this might be undefined if there are no contained resources. We might need different matching.
  get container() {
    for (const s of this.subjectsOf(LDP.contains, Container)) {
      return s;
    }
    return;
  }
};

// src/container.ts
var import_n32 = require("n3");

// src/scope.ts
function resolveTarget(base, target, options) {
  if (typeof target !== "string" || target.trim().length === 0) {
    throw new Error("[n8n-nodes-solid] target must be a non-empty string");
  }
  const trimmed = target.trim();
  if (trimmed.startsWith("//")) {
    throw new Error(
      `[n8n-nodes-solid] target must not be scheme-relative ("//..."): ${redactUserinfo(target)} (refused)`
    );
  }
  const ref = /^https?:\/\//i.test(trimmed) ? trimmed : trimmed.replace(/^\/+/, "");
  const url = assertWithinPodScope(base, ref, { allowRoot: options?.allowRoot ?? true });
  return { url, container: isContainerUrl(url) };
}

// src/container.ts
async function parseContainerListing(body, contentType2, containerUrl, base) {
  const dataset = await parseRdf(body, contentType2, { baseIRI: containerUrl });
  const container = new ContainerDataset(dataset, import_n32.DataFactory).container;
  if (!container) {
    return [];
  }
  const containerUrlNoSlash = containerUrl.endsWith("/") ? containerUrl.slice(0, -1) : containerUrl;
  const members = [];
  for (const resource of container.contains) {
    const absolute = new URL(resource.id, containerUrl).toString();
    const scoped = podScopedUrl(base, absolute, { allowRoot: true });
    if (scoped === void 0) {
      continue;
    }
    if (scoped === containerUrl || scoped === containerUrlNoSlash) {
      continue;
    }
    members.push({ url: scoped, container: isContainerUrl(scoped) });
  }
  return members;
}

// nodes/Solid/operations.ts
var ACCEPT_RDF = "text/turtle, application/ld+json;q=0.9";
function httpError(op, url, res) {
  return new Error(`[n8n-nodes-solid] ${op} ${url} failed: HTTP ${res.statusCode}`);
}
function assertNotRedirect(op, url, res) {
  if (res.statusCode >= 300 && res.statusCode < 400) {
    const location = res.headers.location;
    const to = location ? ` to ${redactUserinfo(location)}` : "";
    throw new Error(
      `[n8n-nodes-solid] ${op} ${url} answered a redirect (HTTP ${res.statusCode}${to}) \u2014 refused: an authenticated pod request never follows redirects (token-leak / pod-escape guard)`
    );
  }
}
function scopedTarget(podBaseUrl, target, options) {
  const base = normalizePodBase(podBaseUrl);
  return resolveTarget(base, target, options);
}
async function readResource(input) {
  const { url } = scopedTarget(input.podBaseUrl, input.target);
  const res = await input.request({ method: "GET", url, headers: {} });
  assertNotRedirect("read", url, res);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("read", url, res);
  }
  return {
    url,
    body: res.body,
    contentType: res.headers["content-type"] ?? null,
    etag: res.headers.etag ?? null,
    statusCode: res.statusCode
  };
}
async function createResource(input) {
  const { url, container } = scopedTarget(input.podBaseUrl, input.target, { allowRoot: false });
  if (container) {
    throw new Error(
      `[n8n-nodes-solid] create target ${url} is a container (trailing slash); use a resource path`
    );
  }
  const res = await input.request({
    method: "PUT",
    url,
    headers: {
      "content-type": input.contentType,
      "if-none-match": "*"
    },
    body: input.content
  });
  assertNotRedirect("create", url, res);
  if (res.statusCode === 412) {
    throw new Error(
      `[n8n-nodes-solid] create ${url} failed: resource already exists (412). Use Update to overwrite.`
    );
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("create", url, res);
  }
  return { url, created: true, statusCode: res.statusCode, etag: res.headers.etag ?? null };
}
async function updateResource(input) {
  const { url, container } = scopedTarget(input.podBaseUrl, input.target, { allowRoot: false });
  if (container) {
    throw new Error(
      `[n8n-nodes-solid] update target ${url} is a container (trailing slash); use a resource path`
    );
  }
  const headers = { "content-type": input.contentType };
  if (input.ifMatch && input.ifMatch.trim().length > 0) {
    headers["if-match"] = input.ifMatch.trim();
  }
  const res = await input.request({ method: "PUT", url, headers, body: input.content });
  assertNotRedirect("update", url, res);
  if (res.statusCode === 412) {
    throw new Error(
      `[n8n-nodes-solid] update ${url} failed: precondition failed (412 \u2014 the resource changed since the supplied ETag).`
    );
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("update", url, res);
  }
  return { url, updated: true, statusCode: res.statusCode, etag: res.headers.etag ?? null };
}
async function deleteResource(input) {
  const { url } = scopedTarget(input.podBaseUrl, input.target, { allowRoot: false });
  const res = await input.request({ method: "DELETE", url, headers: {} });
  assertNotRedirect("delete", url, res);
  if (res.statusCode === 404 || res.statusCode === 410) {
    return { url, deleted: false, notFound: true, statusCode: res.statusCode };
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("delete", url, res);
  }
  return { url, deleted: true, statusCode: res.statusCode };
}
async function listContainer(input) {
  const base = normalizePodBase(input.podBaseUrl);
  const { url, container } = resolveTarget(base, input.target);
  const containerUrl = container ? url : resolveTarget(base, `${input.target.replace(/\/+$/, "")}/`).url;
  const res = await input.request({
    method: "GET",
    url: containerUrl,
    headers: { accept: ACCEPT_RDF }
  });
  assertNotRedirect("list", containerUrl, res);
  if (res.statusCode === 404 || res.statusCode === 410) {
    return { members: [], containerUrl };
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpError("list", containerUrl, res);
  }
  const members = await parseContainerListing(
    res.body,
    res.headers["content-type"] ?? null,
    containerUrl,
    base
  );
  return {
    containerUrl,
    members: members.map((m) => ({
      url: m.url,
      container: m.container,
      name: memberName(containerUrl, m.url)
    }))
  };
}
function memberName(containerUrl, memberUrl) {
  try {
    const c = new URL(containerUrl);
    const m = new URL(memberUrl);
    let path = m.pathname;
    if (path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    const rel = path.startsWith(c.pathname) ? path.slice(c.pathname.length) : path;
    const seg = rel.split("/").filter((s) => s.length > 0).pop() ?? rel;
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  } catch {
    return memberUrl;
  }
}

// nodes/Solid/Solid.node.ts
var Solid = class {
  description = {
    displayName: "Solid",
    name: "solid",
    icon: "file:solid.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Read and write a Solid pod over LDP",
    defaults: { name: "Solid" },
    inputs: [import_n8n_workflow.NodeConnectionTypes.Main],
    outputs: [import_n8n_workflow.NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: "solidApi", required: true }],
    properties: [
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Resource",
            value: "resource",
            description: "A single LDP resource (a document)"
          },
          { name: "Container", value: "container", description: "An LDP container (a folder)" }
        ],
        default: "resource"
      },
      // --- Resource operations ---
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["resource"] } },
        options: [
          {
            name: "Read",
            value: "read",
            action: "Read a resource",
            description: "Get a resource's contents"
          },
          {
            name: "Create",
            value: "create",
            action: "Create a resource",
            description: "Create a new resource (fails if it already exists)"
          },
          {
            name: "Update",
            value: "update",
            action: "Update a resource",
            description: "Create or overwrite a resource"
          },
          {
            name: "Delete",
            value: "delete",
            action: "Delete a resource",
            description: "Delete a resource"
          }
        ],
        default: "read"
      },
      // --- Container operations ---
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["container"] } },
        options: [
          {
            name: "List",
            value: "list",
            action: "List a container",
            description: "List the direct members of a container (ldp:contains)"
          }
        ],
        default: "list"
      },
      // --- Target (all operations) ---
      {
        displayName: "Target",
        name: "target",
        type: "string",
        default: "",
        required: true,
        placeholder: "notes/today.ttl  (or an absolute URL under the pod base)",
        description: "The resource or container to act on. Either an absolute http(s) URL under the pod base, or a path relative to the pod base. Confined to the pod base \u2014 a target that escapes it is refused."
      },
      // --- Body (Create / Update) ---
      {
        displayName: "Content",
        name: "content",
        type: "string",
        typeOptions: { rows: 5 },
        default: "",
        displayOptions: { show: { resource: ["resource"], operation: ["create", "update"] } },
        description: "The resource body to write"
      },
      {
        displayName: "Content Type",
        name: "contentType",
        type: "string",
        default: "text/turtle",
        displayOptions: { show: { resource: ["resource"], operation: ["create", "update"] } },
        description: "The Content-Type to store the body as (e.g. text/turtle, application/json, text/plain)"
      },
      // --- Conditional update (Update only) ---
      {
        displayName: "If-Match ETag",
        name: "ifMatch",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["resource"], operation: ["update"] } },
        description: "Optional. An ETag (from a prior Read) for a conditional, lost-update-safe write. If set and the resource changed, the update fails with 412."
      }
    ]
  };
  async execute() {
    const items = this.getInputData();
    const out = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter("resource", i);
        const operation = this.getNodeParameter("operation", i);
        const target = this.getNodeParameter("target", i);
        const credentials = await this.getCredentials("solidApi", i);
        const podBaseUrl = String(credentials.podBaseUrl ?? "");
        const request = async (req) => {
          const options = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            returnFullResponse: true,
            ignoreHttpStatusErrors: true,
            // SECURITY (wave-3 review): NEVER follow redirects on an
            // authenticated pod request. n8n's axios transport follows them by
            // default AND forwards credentials on cross-origin redirects
            // (`sendCredentialsOnCrossOriginRedirect` defaults to true), so a
            // poisoned in-pod resource answering `302 Location: https://evil…`
            // would exfiltrate the Bearer token. The 3xx comes back to the
            // operations, which refuse it fail-closed (assertNotRedirect).
            disableFollowRedirect: true,
            // Defence in depth: even if redirect-following is ever re-enabled,
            // never forward the credential across origins.
            sendCredentialsOnCrossOriginRedirect: false,
            // Always treat the body as raw text — Solid resources are opaque
            // bytes/RDF; we never want n8n to JSON-parse the body.
            json: false,
            ...req.body !== void 0 ? { body: req.body } : {}
          };
          const response = await this.helpers.httpRequestWithAuthentication.call(
            this,
            "solidApi",
            options
          );
          return {
            statusCode: response.statusCode,
            headers: normalizeHeaders(response.headers),
            body: bodyToString(response.body)
          };
        };
        const base = { podBaseUrl, target, request };
        if (resource === "resource") {
          if (operation === "read") {
            pushOne(out, await readResource(base), i);
          } else if (operation === "create") {
            pushOne(
              out,
              await createResource({
                ...base,
                content: this.getNodeParameter("content", i, ""),
                contentType: this.getNodeParameter("contentType", i, "text/turtle")
              }),
              i
            );
          } else if (operation === "update") {
            pushOne(
              out,
              await updateResource({
                ...base,
                content: this.getNodeParameter("content", i, ""),
                contentType: this.getNodeParameter("contentType", i, "text/turtle"),
                ifMatch: this.getNodeParameter("ifMatch", i, "")
              }),
              i
            );
          } else if (operation === "delete") {
            pushOne(out, await deleteResource(base), i);
          } else {
            throw new import_n8n_workflow.NodeOperationError(
              this.getNode(),
              `Unknown resource operation: ${operation}`,
              {
                itemIndex: i
              }
            );
          }
        } else if (resource === "container") {
          if (operation === "list") {
            const { members, containerUrl } = await listContainer(base);
            if (members.length === 0) {
              pushOne(out, { containerUrl, members: [] }, i);
            } else {
              for (const m of members) {
                pushOne(out, m, i);
              }
            }
          } else {
            throw new import_n8n_workflow.NodeOperationError(
              this.getNode(),
              `Unknown container operation: ${operation}`,
              {
                itemIndex: i
              }
            );
          }
        } else {
          throw new import_n8n_workflow.NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, {
            itemIndex: i
          });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({
            json: { error: error.message },
            pairedItem: { item: i }
          });
          continue;
        }
        if (error instanceof import_n8n_workflow.NodeOperationError) {
          throw error;
        }
        throw new import_n8n_workflow.NodeOperationError(this.getNode(), error, { itemIndex: i });
      }
    }
    return [out];
  }
};
function pushOne(out, json, itemIndex) {
  out.push({ json, pairedItem: { item: itemIndex } });
}
function normalizeHeaders(headers) {
  const out = {};
  if (!headers) {
    return out;
  }
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}
function bodyToString(body) {
  if (typeof body === "string") {
    return body;
  }
  if (body == null) {
    return "";
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString("utf8");
  }
  if (typeof body === "object") {
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }
  return String(body);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Solid
});
//# sourceMappingURL=Solid.node.js.map
