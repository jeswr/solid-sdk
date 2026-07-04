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

// node_modules/ipaddr.js/lib/ipaddr.js
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

// src/addresses.ts
var import_ipaddr = __toESM(require_ipaddr(), 1);
var IPV4_OCTET = /^(?:0|[1-9]\d{0,2})$/;
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
var PUBLIC_IPV4_RANGE = "unicast";
var PUBLIC_IPV6_RANGES = /* @__PURE__ */ new Set(["unicast", "reserved"]);
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

// src/redirect.ts
function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
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
var CREDENTIAL_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "www-authenticate",
  "dpop"
]);
var CONTENT_HEADERS = /* @__PURE__ */ new Set([
  "content-length",
  "content-type",
  "content-encoding",
  "content-language",
  "content-location"
]);
function rewriteInitForRedirect(init, status, crossOrigin) {
  const method = (init.method ?? "GET").toUpperCase();
  const methodChanges = (status === 301 || status === 302) && method === "POST" || status === 303 && method !== "GET" && method !== "HEAD";
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

// src/guard.ts
var SsrfError = class extends Error {
  constructor(message2, options) {
    super(message2, options);
    this.name = "SsrfError";
  }
};
var GuardError = class extends Error {
  constructor(message2, options) {
    super(message2, options);
    this.name = "GuardError";
  }
};
var DEFAULT_HOSTNAME_DENYLIST = Object.freeze([
  "metadata.google.internal",
  "metadata.goog",
  ".internal",
  ".svc.cluster.local",
  ".cluster.local",
  ".vercel-internal.com"
]);
var DEFAULT_MAX_BYTES = 1024 * 1024;
var DEFAULT_TIMEOUT_MS = 1e4;
var DEFAULT_MAX_REDIRECTS = 5;
var NODE_DNS_SPECIFIER = ["node:dns", "promises"].join("/");
var NodeDnsUnavailableError = class extends Error {
};
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
  return ((input, init) => guard.fetch(input, init));
}
function guardedFetch(input, init) {
  return new SsrfGuard(init ?? {}).fetch(input, init);
}
async function assertSafeUrl(rawUrl, options = {}) {
  await new SsrfGuard(options).assertAllowed(rawUrl);
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
var SsrfGuard = class {
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
function isNullBodyStatus(status) {
  return status === 101 || status === 204 || status === 205 || status === 304;
}
function isBodyBearingStatus(status) {
  return status >= 200 && status < 300 && status !== 204 && status !== 205;
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

// src/podScope.ts
var PodScopeError = class extends Error {
  constructor(message2, options) {
    super(message2, options);
    this.name = "PodScopeError";
  }
};
var DEFAULT_MAX_REDIRECTS2 = 5;
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
function isWithinPodScope(base, url, options) {
  try {
    assertWithinPodScope(base, url, options);
    return true;
  } catch {
    return false;
  }
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
function createPodScopedFetch(base, options = {}) {
  const root = normalizePodBase(base);
  const fetcher = options.fetch ?? globalThis.fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS2;
  const scopeOptions = { allowRoot: options.allowRoot ?? true };
  const scoped = async (input, init) => {
    const { url: startUrl, init: effectiveInit } = normalizeRequest(input, init);
    let currentUrl = assertWithinPodScope(root, startUrl, scopeOptions);
    let currentInit = { ...effectiveInit ?? {} };
    const seen = /* @__PURE__ */ new Set();
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (seen.has(currentUrl)) {
        throw new PodScopeError(`redirect loop detected at ${currentUrl}.`);
      }
      seen.add(currentUrl);
      const res = await fetcher(currentUrl, {
        ...currentInit,
        // Every hop is re-checked by US, so the underlying fetch must NOT auto-follow.
        redirect: "manual"
      });
      if (!isRedirect(res.status)) {
        return res;
      }
      const location = res.headers.get("location");
      if (!location) {
        return res;
      }
      if (location.trim().startsWith("//")) {
        throw new PodScopeError(
          `redirect Location must not be scheme-relative ("//..."): ${redactUserinfo(location)} (refused)`
        );
      }
      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new PodScopeError(
          `redirect to a malformed Location (${redactUserinfo(location)}) from ${currentUrl} (refused)`
        );
      }
      const checkedNext = assertWithinPodScope(root, nextUrl, scopeOptions);
      currentInit = rewriteInitForRedirect(
        currentInit,
        res.status,
        !sameOrigin(currentUrl, checkedNext)
      );
      try {
        await res.body?.cancel();
      } catch {
      }
      currentUrl = checkedNext;
    }
    throw new PodScopeError(`too many redirects (> ${maxRedirects}) within pod scope ${root}.`);
  };
  return scoped;
}
export {
  DEFAULT_HOSTNAME_DENYLIST,
  GuardError,
  PodScopeError,
  SsrfError,
  assertSafeUrl,
  assertWithinPodScope,
  classifyIpLiteral,
  createGuardedFetch,
  createPodScopedFetch,
  guardedFetch,
  isContainerUrl,
  isDeniedHostname,
  isLoopbackAddress,
  isPublicAddress,
  isWithinPodScope,
  normalizeHostForClassification,
  normalizePodBase,
  podScopedUrl,
  redactUserinfo
};
//# sourceMappingURL=index.js.map
