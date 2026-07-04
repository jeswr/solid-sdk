// node_modules/@jeswr/guarded-fetch/dist/index.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
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
var require_ipaddr = __commonJS({
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
      if (typeof module !== "undefined" && module.exports) {
        module.exports = ipaddr2;
      } else {
        root.ipaddr = ipaddr2;
      }
    })(exports);
  }
});
var import_ipaddr = __toESM(require_ipaddr(), 1);
function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
function redactUserinfo(value) {
  if (typeof value !== "string") {
    return String(value);
  }
  return value.replace(/\/\/[^/?#]*@/g, "//<redacted>@");
}
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
var RedirectRefusedError = class extends Error {
  /** The request URL that returned the refused redirect (userinfo redacted). */
  url;
  /**
   * The redirect status. `0` for a browser opaque-redirect, whose real 3xx status is masked by
   * the Fetch spec's response filtering (the wrapper still refuses it).
   */
  status;
  /**
   * The `Location` header (userinfo redacted), when readable — `undefined` for a browser
   * opaque-redirect (whose headers are stripped) or a redirect with no `Location`.
   */
  location;
  constructor(message2, detail) {
    super(message2, detail.cause !== void 0 ? { cause: detail.cause } : void 0);
    this.name = "RedirectRefusedError";
    this.url = detail.url;
    this.status = detail.status;
    this.location = detail.location;
  }
};
function refuseRedirects(fetch = globalThis.fetch) {
  const wrapped = async (input, init) => {
    const res = await fetch(input, { ...init ?? {}, redirect: "manual" });
    const opaqueRedirect = res.type === "opaqueredirect";
    if (opaqueRedirect || isRedirect(res.status)) {
      const location = opaqueRedirect ? void 0 : res.headers.get("location") ?? void 0;
      try {
        await res.body?.cancel();
      } catch {
      }
      const safeUrl = redactUserinfo(requestUrlOf(input));
      const safeLocation = location !== void 0 ? redactUserinfo(location) : void 0;
      const where = opaqueRedirect ? "opaque redirect" : `status ${res.status}`;
      const to = safeLocation !== void 0 ? ` \u2192 ${safeLocation}` : "";
      throw new RedirectRefusedError(
        `Refusing to follow a redirect (${where}${to}) from ${safeUrl}: this fetch refuses redirects for credential safety. Use a follow-capable fetch if a redirect is an expected part of the protocol.`,
        { url: safeUrl, status: res.status, location: safeLocation }
      );
    }
    return res;
  };
  return wrapped;
}
function requestUrlOf(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

// node_modules/@jeswr/solid-dpop/dist/esm/authCode.js
import { createHash as createHash2, randomBytes, randomUUID as randomUUID2 } from "node:crypto";

// node_modules/@jeswr/solid-dpop/dist/esm/dpop.js
import { createHash, randomUUID } from "node:crypto";
var josePromise;
function loadJose() {
  if (!josePromise) {
    josePromise = import("jose");
  }
  return josePromise;
}
var DPOP_ALG = "ES256";
function canonicalHtu(uri) {
  const u = new URL(uri);
  u.search = "";
  u.hash = "";
  return u.toString();
}
function accessTokenHash(accessToken) {
  return createHash("sha256").update(accessToken, "ascii").digest("base64url");
}
async function toDpopKeyPair(publicKey, privateKey) {
  const { exportJWK, calculateJwkThumbprint } = await loadJose();
  const publicJwk = await exportJWK(publicKey);
  const thumbprint = await calculateJwkThumbprint(publicJwk);
  return { publicKey, privateKey, publicJwk, thumbprint };
}
async function generateDpopKeyPair() {
  const { generateKeyPair } = await loadJose();
  const { publicKey, privateKey } = await generateKeyPair(DPOP_ALG, { extractable: true });
  return toDpopKeyPair(publicKey, privateKey);
}
async function exportDpopKeyPairJwk(keyPair) {
  const { exportJWK } = await loadJose();
  return exportJWK(keyPair.privateKey);
}
async function importDpopKeyPairJwk(jwk) {
  if (!jwk.d) {
    throw new Error("importDpopKeyPairJwk: JWK has no private component (`d`); cannot reconstruct keypair.");
  }
  const { importJWK } = await loadJose();
  const { d: _d, ...publicJwkInput } = jwk;
  const privateKey = await importJWK({ ...jwk, alg: DPOP_ALG }, DPOP_ALG, {
    extractable: true
  });
  const publicKey = await importJWK({ ...publicJwkInput, alg: DPOP_ALG }, DPOP_ALG);
  return toDpopKeyPair(publicKey, privateKey);
}
async function createDpopProof(params) {
  const { keyPair, htm, htu, accessToken, nonce } = params;
  const payload = {
    htm: htm.toUpperCase(),
    htu: canonicalHtu(htu),
    jti: randomUUID()
  };
  if (accessToken !== void 0) {
    payload["ath"] = accessTokenHash(accessToken);
  }
  if (nonce !== void 0) {
    payload["nonce"] = nonce;
  }
  const { SignJWT } = await loadJose();
  return new SignJWT(payload).setProtectedHeader({
    typ: "dpop+jwt",
    alg: DPOP_ALG,
    jwk: keyPair.publicJwk
  }).setIssuedAt().sign(keyPair.privateKey);
}

// src/dpopFetch.ts
var NONCE_RETRY_LIMIT = 1;
function isLoopbackHost2(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost") {
    return true;
  }
  const unbracketed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (unbracketed === "::1") {
    return true;
  }
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(unbracketed)) {
    const octets = unbracketed.split(".").map(Number);
    return octets.every((o) => o >= 0 && o <= 255);
  }
  return false;
}
function assertSecureTransport(rawUrl, allowInsecure, makeError) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw makeError(`not a valid URL: ${rawUrl}`);
  }
  if (u.protocol === "https:") {
    return;
  }
  if (u.protocol === "http:") {
    if (allowInsecure && isLoopbackHost2(u.hostname)) {
      return;
    }
    throw makeError(
      `refusing an insecure http: URL (${rawUrl}). https is required; http: is permitted only for a loopback host with \`allowInsecure: true\`.`
    );
  }
  throw makeError(`unsupported URL scheme in ${rawUrl} (expected https:).`);
}
function effectiveUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}
function effectiveMethod(input, init) {
  const fromInit = init?.method;
  if (typeof fromInit === "string" && fromInit.length > 0) {
    return fromInit.toUpperCase();
  }
  if (typeof input !== "string" && !(input instanceof URL)) {
    return (input.method || "GET").toUpperCase();
  }
  return "GET";
}
function headerValue(headers, name) {
  if (!headers) {
    return void 0;
  }
  const target = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(target) ?? void 0;
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      if (k.toLowerCase() === target) {
        return v;
      }
    }
    return void 0;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return v;
    }
  }
  return void 0;
}
function effectiveContentType(input, init) {
  const fromInit = headerValue(init?.headers, "content-type");
  if (fromInit !== void 0) {
    return fromInit;
  }
  if (typeof input !== "string" && !(input instanceof URL)) {
    return input.headers.get("content-type") ?? void 0;
  }
  return void 0;
}
function isTokenEndpointLeg(input, init) {
  if (effectiveMethod(input, init) !== "POST") {
    return false;
  }
  const ct = effectiveContentType(input, init);
  return ct?.toLowerCase().includes("application/x-www-form-urlencoded") === true;
}
async function isUseDpopNonceChallenge(res) {
  if (res.status < 400 || res.status >= 500) {
    return false;
  }
  if (res.headers.get("dpop-nonce")) {
    return true;
  }
  try {
    const cloned = res.clone();
    const text = await cloned.text();
    if (text.length === 0) {
      return false;
    }
    const parsed = JSON.parse(text);
    return parsed.error === "use_dpop_nonce";
  } catch {
    return false;
  }
}
function buildDpopCustomFetch(keyPair, underlying, allowInsecure) {
  const tokenLegFetch = refuseRedirects(underlying);
  const dpopFetch = async (input, init) => {
    if (!isTokenEndpointLeg(input, init)) {
      return underlying(input, init);
    }
    const url = effectiveUrl(input);
    assertSecureTransport(
      url,
      allowInsecure,
      (msg) => new Error(`auth-solid customFetch: ${msg} \u2014 refusing the token request over plaintext.`)
    );
    const method = "POST";
    const send = async (nonce) => {
      const proof = await createDpopProof(
        nonce === void 0 ? { keyPair, htm: method, htu: url } : { keyPair, htm: method, htu: url, nonce }
      );
      const headers = new Headers(init?.headers ?? void 0);
      if (typeof input !== "string" && !(input instanceof URL)) {
        input.headers.forEach((v, k) => {
          if (!headers.has(k)) {
            headers.set(k, v);
          }
        });
      }
      headers.set("dpop", proof);
      return tokenLegFetch(url, { ...init ?? {}, method, headers });
    };
    const res = await send();
    if (await isUseDpopNonceChallenge(res)) {
      const serverNonce = res.headers.get("dpop-nonce");
      if (serverNonce) {
        await res.body?.cancel().catch(() => {
        });
        return send(serverNonce);
      }
    }
    return res;
  };
  return dpopFetch;
}
function resolveResourceUrl(input) {
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof input !== "string") {
    return input.url;
  }
  const g = globalThis;
  const base = g.document?.baseURI ?? g.location?.href;
  try {
    return base !== void 0 ? new URL(input, base).toString() : new URL(input).toString();
  } catch {
    throw new Error(
      `solidDpopFetch: \`${input}\` is not an absolute URL and there is no document base to resolve it against (server-side). Pass an absolute https URL.`
    );
  }
}
var DEFAULT_MAX_REPLAY_BODY_BYTES = 10 * 1024 * 1024;
function abortReason(signal) {
  const reason = signal.reason;
  if (reason !== void 0) {
    return reason;
  }
  return new DOMException("The operation was aborted.", "AbortError");
}
async function bufferStream(stream, signal, maxBytes) {
  const reader = stream.getReader();
  let removeAbortListener;
  const abortRace = signal === void 0 ? void 0 : new Promise((_resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });
  abortRace?.catch(() => {
  });
  const chunks = [];
  let total = 0;
  try {
    if (signal?.aborted) {
      throw abortReason(signal);
    }
    for (; ; ) {
      const result = abortRace ? await Promise.race([reader.read(), abortRace]) : await reader.read();
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > maxBytes) {
        throw new Error(
          `solidDpopFetch: request stream body exceeds the ${maxBytes}-byte replay buffer cap. Raise \`maxReplayBodyBytes\` to upload a larger body (it is buffered so the \xA78 DPoP-nonce retry can replay it), or pass an already-replayable body (string / Uint8Array / Blob).`
        );
      }
      chunks.push(result.value);
    }
  } catch (err) {
    void reader.cancel(err).catch(() => {
    });
    throw err;
  } finally {
    removeAbortListener?.();
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer.slice(0, total);
}
function requestTransportFields(req) {
  return {
    redirect: req.redirect,
    cache: req.cache,
    credentials: req.credentials,
    integrity: req.integrity,
    keepalive: req.keepalive,
    mode: req.mode,
    referrer: req.referrer,
    referrerPolicy: req.referrerPolicy,
    ...req.signal ? { signal: req.signal } : {}
  };
}
function buildSolidDpopFetch(state, options = {}) {
  const rawUnderlying = options.fetch ?? globalThis.fetch;
  const underlying = refuseRedirects(
    rawUnderlying
  );
  const allowInsecure = options.allowInsecure === true;
  const maxReplayBodyBytes = options.maxReplayBodyBytes ?? DEFAULT_MAX_REPLAY_BODY_BYTES;
  if (!Number.isFinite(maxReplayBodyBytes) || maxReplayBodyBytes < 0) {
    throw new Error(
      `solidDpopFetch: \`maxReplayBodyBytes\` must be a finite, non-negative number (got ${String(
        options.maxReplayBodyBytes
      )}).`
    );
  }
  const accessToken = state.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("solidDpopFetch: SolidAuthState.accessToken is missing/empty.");
  }
  const keyJwk = state.dpopKeyJwk;
  if (keyJwk === void 0 || keyJwk === null || typeof keyJwk !== "object") {
    throw new Error("solidDpopFetch: SolidAuthState.dpopKeyJwk is missing/invalid.");
  }
  let keyPairPromise;
  const getKeyPair = () => {
    if (!keyPairPromise) {
      keyPairPromise = importDpopKeyPairJwk(keyJwk);
    }
    return keyPairPromise;
  };
  return async (input, init) => {
    const url = resolveResourceUrl(input);
    assertSecureTransport(
      url,
      allowInsecure,
      (msg) => new Error(`solidDpopFetch: ${msg} \u2014 refusing to send the DPoP token over plaintext.`)
    );
    const method = effectiveMethod(input, init);
    const keyPair = await getKeyPair();
    const reqInput = typeof input !== "string" && !(input instanceof URL) ? input : void 0;
    const effectiveSignal = init && "signal" in init ? init.signal ?? void 0 : reqInput?.signal ?? void 0;
    let bufferedBody;
    if (init && "body" in init) {
      const b = init.body ?? void 0;
      bufferedBody = b instanceof ReadableStream ? await bufferStream(b, effectiveSignal, maxReplayBodyBytes) : b;
    } else if (reqInput && reqInput.body !== null) {
      bufferedBody = await bufferStream(
        reqInput.clone().body,
        effectiveSignal,
        maxReplayBodyBytes
      );
    }
    const send = async (nonce) => {
      const proof = await createDpopProof(
        nonce === void 0 ? { keyPair, htm: method, htu: url, accessToken } : { keyPair, htm: method, htu: url, accessToken, nonce }
      );
      const headers = new Headers(reqInput?.headers ?? void 0);
      if (init?.headers) {
        new Headers(init.headers).forEach((v, k) => {
          headers.set(k, v);
        });
      }
      headers.set("authorization", `DPoP ${accessToken}`);
      headers.set("dpop", proof);
      const reqInit = {
        ...reqInput ? requestTransportFields(reqInput) : {},
        ...init ?? {},
        method,
        headers
      };
      delete reqInit.body;
      if (bufferedBody !== void 0) {
        reqInit.body = bufferedBody;
      }
      return underlying(url, reqInit);
    };
    const res = await send();
    if (res.status === 401) {
      const serverNonce = res.headers.get("dpop-nonce");
      if (serverNonce) {
        await res.body?.cancel().catch(() => {
        });
        return send(serverNonce);
      }
    }
    return res;
  };
}
var DPOP_NONCE_RETRY_LIMIT = NONCE_RETRY_LIMIT;

// src/provider.ts
import { customFetch } from "@auth/core";
var DEFAULT_SCOPE2 = "openid webid offline_access";
var SOLID_CHECKS = ["pkce", "state", "nonce"];
function normalizeScope(scope) {
  if (scope === void 0 || scope.trim() === "") {
    return DEFAULT_SCOPE2;
  }
  const parts = scope.split(/\s+/).filter((s) => s.length > 0);
  if (!parts.includes("openid")) {
    parts.unshift("openid");
  }
  return [...new Set(parts)].join(" ");
}
function isHttpUri(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
function extractVerifiedWebId(claims) {
  const webidClaim = claims.webid;
  if (typeof webidClaim === "string" && isHttpUri(webidClaim)) {
    return webidClaim;
  }
  const sub = claims.sub;
  if (typeof sub === "string" && isHttpUri(sub)) {
    return sub;
  }
  throw new Error(
    "auth-solid: the Solid login produced no resolvable `webid` claim in the VERIFIED ID token; refusing to create a session without a verified WebID (fail-closed). The WebID is never trusted from an unverified access token."
  );
}
async function Solid(config) {
  if (typeof config.issuer !== "string" || config.issuer.length === 0) {
    throw new Error("Solid(): `issuer` is required (the Solid OP URL).");
  }
  if (typeof config.clientId !== "string" || config.clientId.length === 0) {
    throw new Error("Solid(): `clientId` is required.");
  }
  const allowInsecure = config.allowInsecure === true;
  assertSecureTransport(config.issuer, allowInsecure, (msg) => new Error(`Solid(): issuer ${msg}`));
  const scope = normalizeScope(config.scope);
  const dpopKeyPair = config.dpopKeyJwk ? await importDpopKeyPairJwk(config.dpopKeyJwk) : await generateDpopKeyPair();
  const underlying = globalThis.fetch;
  const dpopFetch = buildDpopCustomFetch(dpopKeyPair, underlying, allowInsecure);
  const hasSecret = typeof config.clientSecret === "string" && config.clientSecret.length > 0;
  const provider = {
    id: config.id ?? "solid",
    name: config.name ?? "Solid",
    type: "oidc",
    issuer: config.issuer,
    clientId: config.clientId,
    // A public client (Client Identifier Document) has no secret; only set it for a confidential
    // client.
    ...hasSecret ? { clientSecret: config.clientSecret } : {},
    // SECURITY (token-endpoint client auth): Auth.js does NOT default a public client to `none` — an
    // UNDEFINED `token_endpoint_auth_method` falls into its `client_secret_basic` branch, which would
    // send `Authorization: Basic base64(clientId:undefined)` and break a public Solid client (Client
    // Identifier Document). So we set the method EXPLICITLY: `none` for a public client (no secret),
    // and `client_secret_basic` for a confidential one (Auth.js's effective default, made explicit so
    // an `undefined` never silently selects basic-with-no-secret). A roborev (High) finding.
    client: { token_endpoint_auth_method: hasSecret ? "client_secret_basic" : "none" },
    // PKCE S256 + state + nonce — ALL mandatory for Solid-OIDC.
    checks: [...SOLID_CHECKS],
    authorization: { params: { scope } },
    // Keep the token fields a Solid session needs. We return ONLY these (plus the defaults Auth.js
    // keeps), so an OP's extra token-response fields are not silently persisted into the account.
    // Fields are included only when present (exactOptionalPropertyTypes: a `TokenSet` property is
    // either a value or absent, never an explicit `undefined`).
    account(account) {
      const kept = /* @__PURE__ */ new Set([
        "access_token",
        "refresh_token",
        "id_token",
        "expires_at",
        "token_type",
        "scope"
      ]);
      const out = { ...account };
      for (const key of Object.keys(out)) {
        if (!kept.has(key)) {
          delete out[key];
        }
      }
      return out;
    },
    // Map the VERIFIED `webid` claim → the Auth.js user (fail-closed). `claims` is the verified
    // ID-token claim set Auth.js passes here.
    profile(claims) {
      const record = claims;
      const webid = extractVerifiedWebId(record);
      const sub = record.sub;
      const iss = record.iss;
      const name = record.name;
      return {
        id: webid,
        webid,
        ...typeof sub === "string" ? { sub } : {},
        ...typeof iss === "string" ? { iss } : {},
        ...typeof name === "string" ? { name } : {}
      };
    },
    [customFetch]: dpopFetch,
    dpopKeyPair,
    dpopKeyJwkForPersistence: () => exportDpopKeyPairJwk(dpopKeyPair)
  };
  return provider;
}

// src/session.ts
var SOLID_JWT_KEY = "solid";
function persistSolidTokensIntoJwt(input) {
  const { account, dpopKeyJwk } = input;
  const accessToken = account.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error(
      "persistSolidTokensIntoJwt: the Auth.js account carries no `access_token`; cannot build a Solid auth state (fail-closed)."
    );
  }
  if (dpopKeyJwk === void 0 || dpopKeyJwk === null || typeof dpopKeyJwk !== "object") {
    throw new Error("persistSolidTokensIntoJwt: `dpopKeyJwk` is required (the DPoP private key).");
  }
  if (typeof dpopKeyJwk.d !== "string" || dpopKeyJwk.d.length === 0) {
    throw new Error(
      "persistSolidTokensIntoJwt: `dpopKeyJwk` has no private component (`d`); a public-only JWK cannot sign DPoP proofs after a restart (fail-closed)."
    );
  }
  const tokenType = account.token_type;
  if (typeof tokenType !== "string" || tokenType.toLowerCase() !== "dpop") {
    throw new Error(
      `persistSolidTokensIntoJwt: Solid-OIDC requires DPoP-bound (sender-constrained) tokens, but the account token_type is "${tokenType ?? "none"}". Refusing to persist a non-DPoP token (fail-closed).`
    );
  }
  return {
    accessToken,
    dpopKeyJwk,
    ...typeof account.refresh_token === "string" ? { refreshToken: account.refresh_token } : {},
    ...typeof account.id_token === "string" ? { idToken: account.id_token } : {},
    ...typeof account.expires_at === "number" ? { expiresAt: account.expires_at } : {},
    ...typeof input.webid === "string" ? { webid: input.webid } : {},
    ...typeof input.issuer === "string" ? { issuer: input.issuer } : {}
  };
}
function extractSolidAuthState(source) {
  if (source === null || source === void 0 || typeof source !== "object") {
    return void 0;
  }
  const nested = source[SOLID_JWT_KEY];
  const state = nested !== void 0 ? nested : source;
  if (state === null || typeof state !== "object") {
    return void 0;
  }
  const s = state;
  const accessToken = s.accessToken;
  const dpopKeyJwk = s.dpopKeyJwk;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return void 0;
  }
  if (dpopKeyJwk === void 0 || dpopKeyJwk === null || typeof dpopKeyJwk !== "object") {
    return void 0;
  }
  return {
    accessToken,
    dpopKeyJwk,
    ...typeof s.issuer === "string" ? { issuer: s.issuer } : {},
    ...typeof s.webid === "string" ? { webid: s.webid } : {}
  };
}
export {
  DEFAULT_MAX_REPLAY_BODY_BYTES,
  DEFAULT_SCOPE2 as DEFAULT_SCOPE,
  DPOP_NONCE_RETRY_LIMIT,
  SOLID_CHECKS,
  SOLID_JWT_KEY,
  Solid,
  buildDpopCustomFetch,
  extractSolidAuthState,
  isLoopbackHost2 as isLoopbackHost,
  persistSolidTokensIntoJwt,
  buildSolidDpopFetch as solidDpopFetch
};
//# sourceMappingURL=index.js.map
