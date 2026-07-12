var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
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

// node_modules/content-type/index.js
var require_content_type = __commonJS({
  "node_modules/content-type/index.js"(exports) {
    "use strict";
    var PARAM_REGEXP = /; *([!#$%&'*+.^_`|~0-9A-Za-z-]+) *= *("(?:[\u000b\u0020\u0021\u0023-\u005b\u005d-\u007e\u0080-\u00ff]|\\[\u000b\u0020-\u00ff])*"|[!#$%&'*+.^_`|~0-9A-Za-z-]+) */g;
    var TEXT_REGEXP = /^[\u000b\u0020-\u007e\u0080-\u00ff]+$/;
    var TOKEN_REGEXP = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
    var QESC_REGEXP = /\\([\u000b\u0020-\u00ff])/g;
    var QUOTE_REGEXP = /([\\"])/g;
    var TYPE_REGEXP = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
    exports.format = format;
    exports.parse = parse;
    function format(obj) {
      if (!obj || typeof obj !== "object") {
        throw new TypeError("argument obj is required");
      }
      var parameters = obj.parameters;
      var type = obj.type;
      if (!type || !TYPE_REGEXP.test(type)) {
        throw new TypeError("invalid type");
      }
      var string = type;
      if (parameters && typeof parameters === "object") {
        var param;
        var params = Object.keys(parameters).sort();
        for (var i = 0; i < params.length; i++) {
          param = params[i];
          if (!TOKEN_REGEXP.test(param)) {
            throw new TypeError("invalid parameter name");
          }
          string += "; " + param + "=" + qstring(parameters[param]);
        }
      }
      return string;
    }
    function parse(string) {
      if (!string) {
        throw new TypeError("argument string is required");
      }
      var header = typeof string === "object" ? getcontenttype(string) : string;
      if (typeof header !== "string") {
        throw new TypeError("argument string is required to be a string");
      }
      var index = header.indexOf(";");
      var type = index !== -1 ? header.slice(0, index).trim() : header.trim();
      if (!TYPE_REGEXP.test(type)) {
        throw new TypeError("invalid media type");
      }
      var obj = new ContentType(type.toLowerCase());
      if (index !== -1) {
        var key;
        var match;
        var value;
        PARAM_REGEXP.lastIndex = index;
        while (match = PARAM_REGEXP.exec(header)) {
          if (match.index !== index) {
            throw new TypeError("invalid parameter format");
          }
          index += match[0].length;
          key = match[1].toLowerCase();
          value = match[2];
          if (value.charCodeAt(0) === 34) {
            value = value.slice(1, -1);
            if (value.indexOf("\\") !== -1) {
              value = value.replace(QESC_REGEXP, "$1");
            }
          }
          obj.parameters[key] = value;
        }
        if (index !== header.length) {
          throw new TypeError("invalid parameter format");
        }
      }
      return obj;
    }
    function getcontenttype(obj) {
      var header;
      if (typeof obj.getHeader === "function") {
        header = obj.getHeader("content-type");
      } else if (typeof obj.headers === "object") {
        header = obj.headers && obj.headers["content-type"];
      }
      if (typeof header !== "string") {
        throw new TypeError("content-type header is missing from object");
      }
      return header;
    }
    function qstring(val) {
      var str = String(val);
      if (TOKEN_REGEXP.test(str)) {
        return str;
      }
      if (str.length > 0 && !TEXT_REGEXP.test(str)) {
        throw new TypeError("invalid parameter value");
      }
      return '"' + str.replace(QUOTE_REGEXP, "\\$1") + '"';
    }
    function ContentType(type) {
      this.parameters = /* @__PURE__ */ Object.create(null);
      this.type = type;
    }
  }
});

// node_modules/base64-js/index.js
var require_base64_js = __commonJS({
  "node_modules/base64-js/index.js"(exports) {
    "use strict";
    exports.byteLength = byteLength;
    exports.toByteArray = toByteArray;
    exports.fromByteArray = fromByteArray;
    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
    var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i = 0, len = code.length; i < len; ++i) {
      lookup[i] = code[i];
      revLookup[code.charCodeAt(i)] = i;
    }
    var i;
    var len;
    revLookup["-".charCodeAt(0)] = 62;
    revLookup["_".charCodeAt(0)] = 63;
    function getLens(b64) {
      var len2 = b64.length;
      if (len2 % 4 > 0) {
        throw new Error("Invalid string. Length must be a multiple of 4");
      }
      var validLen = b64.indexOf("=");
      if (validLen === -1) validLen = len2;
      var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
      return [validLen, placeHoldersLen];
    }
    function byteLength(b64) {
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function _byteLength(b64, validLen, placeHoldersLen) {
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function toByteArray(b64) {
      var tmp;
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
      var curByte = 0;
      var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
      var i2;
      for (i2 = 0; i2 < len2; i2 += 4) {
        tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
        arr[curByte++] = tmp >> 16 & 255;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 2) {
        tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 1) {
        tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      return arr;
    }
    function tripletToBase64(num) {
      return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
    }
    function encodeChunk(uint8, start, end) {
      var tmp;
      var output = [];
      for (var i2 = start; i2 < end; i2 += 3) {
        tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
        output.push(tripletToBase64(tmp));
      }
      return output.join("");
    }
    function fromByteArray(uint8) {
      var tmp;
      var len2 = uint8.length;
      var extraBytes = len2 % 3;
      var parts = [];
      var maxChunkLength = 16383;
      for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
        parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
      }
      if (extraBytes === 1) {
        tmp = uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
        );
      } else if (extraBytes === 2) {
        tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
        );
      }
      return parts.join("");
    }
  }
});

// node_modules/ieee754/index.js
var require_ieee754 = __commonJS({
  "node_modules/ieee754/index.js"(exports) {
    exports.read = function(buffer, offset, isLE, mLen, nBytes) {
      var e, m;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var nBits = -7;
      var i = isLE ? nBytes - 1 : 0;
      var d = isLE ? -1 : 1;
      var s = buffer[offset + i];
      i += d;
      e = s & (1 << -nBits) - 1;
      s >>= -nBits;
      nBits += eLen;
      for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      m = e & (1 << -nBits) - 1;
      e >>= -nBits;
      nBits += mLen;
      for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      if (e === 0) {
        e = 1 - eBias;
      } else if (e === eMax) {
        return m ? NaN : (s ? -1 : 1) * Infinity;
      } else {
        m = m + Math.pow(2, mLen);
        e = e - eBias;
      }
      return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
    };
    exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
      var e, m, c;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
      var i = isLE ? 0 : nBytes - 1;
      var d = isLE ? 1 : -1;
      var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
      value = Math.abs(value);
      if (isNaN(value) || value === Infinity) {
        m = isNaN(value) ? 1 : 0;
        e = eMax;
      } else {
        e = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c = Math.pow(2, -e)) < 1) {
          e--;
          c *= 2;
        }
        if (e + eBias >= 1) {
          value += rt / c;
        } else {
          value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c >= 2) {
          e++;
          c /= 2;
        }
        if (e + eBias >= eMax) {
          m = 0;
          e = eMax;
        } else if (e + eBias >= 1) {
          m = (value * c - 1) * Math.pow(2, mLen);
          e = e + eBias;
        } else {
          m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
          e = 0;
        }
      }
      for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {
      }
      e = e << mLen | m;
      eLen += mLen;
      for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {
      }
      buffer[offset + i - d] |= s * 128;
    };
  }
});

// node_modules/buffer/index.js
var require_buffer = __commonJS({
  "node_modules/buffer/index.js"(exports) {
    "use strict";
    var base64 = require_base64_js();
    var ieee754 = require_ieee754();
    var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
    exports.Buffer = Buffer3;
    exports.SlowBuffer = SlowBuffer;
    exports.INSPECT_MAX_BYTES = 50;
    var K_MAX_LENGTH = 2147483647;
    exports.kMaxLength = K_MAX_LENGTH;
    Buffer3.TYPED_ARRAY_SUPPORT = typedArraySupport();
    if (!Buffer3.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
      console.error(
        "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
      );
    }
    function typedArraySupport() {
      try {
        const arr = new Uint8Array(1);
        const proto = { foo: function() {
          return 42;
        } };
        Object.setPrototypeOf(proto, Uint8Array.prototype);
        Object.setPrototypeOf(arr, proto);
        return arr.foo() === 42;
      } catch (e) {
        return false;
      }
    }
    Object.defineProperty(Buffer3.prototype, "parent", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.buffer;
      }
    });
    Object.defineProperty(Buffer3.prototype, "offset", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.byteOffset;
      }
    });
    function createBuffer(length) {
      if (length > K_MAX_LENGTH) {
        throw new RangeError('The value "' + length + '" is invalid for option "size"');
      }
      const buf = new Uint8Array(length);
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function Buffer3(arg, encodingOrOffset, length) {
      if (typeof arg === "number") {
        if (typeof encodingOrOffset === "string") {
          throw new TypeError(
            'The "string" argument must be of type string. Received type number'
          );
        }
        return allocUnsafe(arg);
      }
      return from(arg, encodingOrOffset, length);
    }
    Buffer3.poolSize = 8192;
    function from(value, encodingOrOffset, length) {
      if (typeof value === "string") {
        return fromString(value, encodingOrOffset);
      }
      if (ArrayBuffer.isView(value)) {
        return fromArrayView(value);
      }
      if (value == null) {
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
        );
      }
      if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value, SharedArrayBuffer) || value && isInstance(value.buffer, SharedArrayBuffer))) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof value === "number") {
        throw new TypeError(
          'The "value" argument must not be of type number. Received type number'
        );
      }
      const valueOf = value.valueOf && value.valueOf();
      if (valueOf != null && valueOf !== value) {
        return Buffer3.from(valueOf, encodingOrOffset, length);
      }
      const b = fromObject(value);
      if (b) return b;
      if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === "function") {
        return Buffer3.from(value[Symbol.toPrimitive]("string"), encodingOrOffset, length);
      }
      throw new TypeError(
        "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
      );
    }
    Buffer3.from = function(value, encodingOrOffset, length) {
      return from(value, encodingOrOffset, length);
    };
    Object.setPrototypeOf(Buffer3.prototype, Uint8Array.prototype);
    Object.setPrototypeOf(Buffer3, Uint8Array);
    function assertSize(size) {
      if (typeof size !== "number") {
        throw new TypeError('"size" argument must be of type number');
      } else if (size < 0) {
        throw new RangeError('The value "' + size + '" is invalid for option "size"');
      }
    }
    function alloc(size, fill, encoding) {
      assertSize(size);
      if (size <= 0) {
        return createBuffer(size);
      }
      if (fill !== void 0) {
        return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
      }
      return createBuffer(size);
    }
    Buffer3.alloc = function(size, fill, encoding) {
      return alloc(size, fill, encoding);
    };
    function allocUnsafe(size) {
      assertSize(size);
      return createBuffer(size < 0 ? 0 : checked(size) | 0);
    }
    Buffer3.allocUnsafe = function(size) {
      return allocUnsafe(size);
    };
    Buffer3.allocUnsafeSlow = function(size) {
      return allocUnsafe(size);
    };
    function fromString(string, encoding) {
      if (typeof encoding !== "string" || encoding === "") {
        encoding = "utf8";
      }
      if (!Buffer3.isEncoding(encoding)) {
        throw new TypeError("Unknown encoding: " + encoding);
      }
      const length = byteLength(string, encoding) | 0;
      let buf = createBuffer(length);
      const actual = buf.write(string, encoding);
      if (actual !== length) {
        buf = buf.slice(0, actual);
      }
      return buf;
    }
    function fromArrayLike(array) {
      const length = array.length < 0 ? 0 : checked(array.length) | 0;
      const buf = createBuffer(length);
      for (let i = 0; i < length; i += 1) {
        buf[i] = array[i] & 255;
      }
      return buf;
    }
    function fromArrayView(arrayView) {
      if (isInstance(arrayView, Uint8Array)) {
        const copy = new Uint8Array(arrayView);
        return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
      }
      return fromArrayLike(arrayView);
    }
    function fromArrayBuffer(array, byteOffset, length) {
      if (byteOffset < 0 || array.byteLength < byteOffset) {
        throw new RangeError('"offset" is outside of buffer bounds');
      }
      if (array.byteLength < byteOffset + (length || 0)) {
        throw new RangeError('"length" is outside of buffer bounds');
      }
      let buf;
      if (byteOffset === void 0 && length === void 0) {
        buf = new Uint8Array(array);
      } else if (length === void 0) {
        buf = new Uint8Array(array, byteOffset);
      } else {
        buf = new Uint8Array(array, byteOffset, length);
      }
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function fromObject(obj) {
      if (Buffer3.isBuffer(obj)) {
        const len = checked(obj.length) | 0;
        const buf = createBuffer(len);
        if (buf.length === 0) {
          return buf;
        }
        obj.copy(buf, 0, 0, len);
        return buf;
      }
      if (obj.length !== void 0) {
        if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
          return createBuffer(0);
        }
        return fromArrayLike(obj);
      }
      if (obj.type === "Buffer" && Array.isArray(obj.data)) {
        return fromArrayLike(obj.data);
      }
    }
    function checked(length) {
      if (length >= K_MAX_LENGTH) {
        throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
      }
      return length | 0;
    }
    function SlowBuffer(length) {
      if (+length != length) {
        length = 0;
      }
      return Buffer3.alloc(+length);
    }
    Buffer3.isBuffer = function isBuffer(b) {
      return b != null && b._isBuffer === true && b !== Buffer3.prototype;
    };
    Buffer3.compare = function compare(a, b) {
      if (isInstance(a, Uint8Array)) a = Buffer3.from(a, a.offset, a.byteLength);
      if (isInstance(b, Uint8Array)) b = Buffer3.from(b, b.offset, b.byteLength);
      if (!Buffer3.isBuffer(a) || !Buffer3.isBuffer(b)) {
        throw new TypeError(
          'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
        );
      }
      if (a === b) return 0;
      let x = a.length;
      let y = b.length;
      for (let i = 0, len = Math.min(x, y); i < len; ++i) {
        if (a[i] !== b[i]) {
          x = a[i];
          y = b[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    };
    Buffer3.isEncoding = function isEncoding(encoding) {
      switch (String(encoding).toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "latin1":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return true;
        default:
          return false;
      }
    };
    Buffer3.concat = function concat(list, length) {
      if (!Array.isArray(list)) {
        throw new TypeError('"list" argument must be an Array of Buffers');
      }
      if (list.length === 0) {
        return Buffer3.alloc(0);
      }
      let i;
      if (length === void 0) {
        length = 0;
        for (i = 0; i < list.length; ++i) {
          length += list[i].length;
        }
      }
      const buffer = Buffer3.allocUnsafe(length);
      let pos = 0;
      for (i = 0; i < list.length; ++i) {
        let buf = list[i];
        if (isInstance(buf, Uint8Array)) {
          if (pos + buf.length > buffer.length) {
            if (!Buffer3.isBuffer(buf)) buf = Buffer3.from(buf);
            buf.copy(buffer, pos);
          } else {
            Uint8Array.prototype.set.call(
              buffer,
              buf,
              pos
            );
          }
        } else if (!Buffer3.isBuffer(buf)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        } else {
          buf.copy(buffer, pos);
        }
        pos += buf.length;
      }
      return buffer;
    };
    function byteLength(string, encoding) {
      if (Buffer3.isBuffer(string)) {
        return string.length;
      }
      if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
        return string.byteLength;
      }
      if (typeof string !== "string") {
        throw new TypeError(
          'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
        );
      }
      const len = string.length;
      const mustMatch = arguments.length > 2 && arguments[2] === true;
      if (!mustMatch && len === 0) return 0;
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "ascii":
          case "latin1":
          case "binary":
            return len;
          case "utf8":
          case "utf-8":
            return utf8ToBytes(string).length;
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return len * 2;
          case "hex":
            return len >>> 1;
          case "base64":
            return base64ToBytes(string).length;
          default:
            if (loweredCase) {
              return mustMatch ? -1 : utf8ToBytes(string).length;
            }
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.byteLength = byteLength;
    function slowToString(encoding, start, end) {
      let loweredCase = false;
      if (start === void 0 || start < 0) {
        start = 0;
      }
      if (start > this.length) {
        return "";
      }
      if (end === void 0 || end > this.length) {
        end = this.length;
      }
      if (end <= 0) {
        return "";
      }
      end >>>= 0;
      start >>>= 0;
      if (end <= start) {
        return "";
      }
      if (!encoding) encoding = "utf8";
      while (true) {
        switch (encoding) {
          case "hex":
            return hexSlice(this, start, end);
          case "utf8":
          case "utf-8":
            return utf8Slice(this, start, end);
          case "ascii":
            return asciiSlice(this, start, end);
          case "latin1":
          case "binary":
            return latin1Slice(this, start, end);
          case "base64":
            return base64Slice(this, start, end);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return utf16leSlice(this, start, end);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = (encoding + "").toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.prototype._isBuffer = true;
    function swap(b, n, m) {
      const i = b[n];
      b[n] = b[m];
      b[m] = i;
    }
    Buffer3.prototype.swap16 = function swap16() {
      const len = this.length;
      if (len % 2 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 16-bits");
      }
      for (let i = 0; i < len; i += 2) {
        swap(this, i, i + 1);
      }
      return this;
    };
    Buffer3.prototype.swap32 = function swap32() {
      const len = this.length;
      if (len % 4 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 32-bits");
      }
      for (let i = 0; i < len; i += 4) {
        swap(this, i, i + 3);
        swap(this, i + 1, i + 2);
      }
      return this;
    };
    Buffer3.prototype.swap64 = function swap64() {
      const len = this.length;
      if (len % 8 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 64-bits");
      }
      for (let i = 0; i < len; i += 8) {
        swap(this, i, i + 7);
        swap(this, i + 1, i + 6);
        swap(this, i + 2, i + 5);
        swap(this, i + 3, i + 4);
      }
      return this;
    };
    Buffer3.prototype.toString = function toString() {
      const length = this.length;
      if (length === 0) return "";
      if (arguments.length === 0) return utf8Slice(this, 0, length);
      return slowToString.apply(this, arguments);
    };
    Buffer3.prototype.toLocaleString = Buffer3.prototype.toString;
    Buffer3.prototype.equals = function equals(b) {
      if (!Buffer3.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
      if (this === b) return true;
      return Buffer3.compare(this, b) === 0;
    };
    Buffer3.prototype.inspect = function inspect() {
      let str = "";
      const max = exports.INSPECT_MAX_BYTES;
      str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
      if (this.length > max) str += " ... ";
      return "<Buffer " + str + ">";
    };
    if (customInspectSymbol) {
      Buffer3.prototype[customInspectSymbol] = Buffer3.prototype.inspect;
    }
    Buffer3.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
      if (isInstance(target, Uint8Array)) {
        target = Buffer3.from(target, target.offset, target.byteLength);
      }
      if (!Buffer3.isBuffer(target)) {
        throw new TypeError(
          'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
        );
      }
      if (start === void 0) {
        start = 0;
      }
      if (end === void 0) {
        end = target ? target.length : 0;
      }
      if (thisStart === void 0) {
        thisStart = 0;
      }
      if (thisEnd === void 0) {
        thisEnd = this.length;
      }
      if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
        throw new RangeError("out of range index");
      }
      if (thisStart >= thisEnd && start >= end) {
        return 0;
      }
      if (thisStart >= thisEnd) {
        return -1;
      }
      if (start >= end) {
        return 1;
      }
      start >>>= 0;
      end >>>= 0;
      thisStart >>>= 0;
      thisEnd >>>= 0;
      if (this === target) return 0;
      let x = thisEnd - thisStart;
      let y = end - start;
      const len = Math.min(x, y);
      const thisCopy = this.slice(thisStart, thisEnd);
      const targetCopy = target.slice(start, end);
      for (let i = 0; i < len; ++i) {
        if (thisCopy[i] !== targetCopy[i]) {
          x = thisCopy[i];
          y = targetCopy[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    };
    function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
      if (buffer.length === 0) return -1;
      if (typeof byteOffset === "string") {
        encoding = byteOffset;
        byteOffset = 0;
      } else if (byteOffset > 2147483647) {
        byteOffset = 2147483647;
      } else if (byteOffset < -2147483648) {
        byteOffset = -2147483648;
      }
      byteOffset = +byteOffset;
      if (numberIsNaN(byteOffset)) {
        byteOffset = dir ? 0 : buffer.length - 1;
      }
      if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
      if (byteOffset >= buffer.length) {
        if (dir) return -1;
        else byteOffset = buffer.length - 1;
      } else if (byteOffset < 0) {
        if (dir) byteOffset = 0;
        else return -1;
      }
      if (typeof val === "string") {
        val = Buffer3.from(val, encoding);
      }
      if (Buffer3.isBuffer(val)) {
        if (val.length === 0) {
          return -1;
        }
        return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
      } else if (typeof val === "number") {
        val = val & 255;
        if (typeof Uint8Array.prototype.indexOf === "function") {
          if (dir) {
            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
          } else {
            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
          }
        }
        return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
      }
      throw new TypeError("val must be string, number or Buffer");
    }
    function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
      let indexSize = 1;
      let arrLength = arr.length;
      let valLength = val.length;
      if (encoding !== void 0) {
        encoding = String(encoding).toLowerCase();
        if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
          if (arr.length < 2 || val.length < 2) {
            return -1;
          }
          indexSize = 2;
          arrLength /= 2;
          valLength /= 2;
          byteOffset /= 2;
        }
      }
      function read(buf, i2) {
        if (indexSize === 1) {
          return buf[i2];
        } else {
          return buf.readUInt16BE(i2 * indexSize);
        }
      }
      let i;
      if (dir) {
        let foundIndex = -1;
        for (i = byteOffset; i < arrLength; i++) {
          if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
            if (foundIndex === -1) foundIndex = i;
            if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
          } else {
            if (foundIndex !== -1) i -= i - foundIndex;
            foundIndex = -1;
          }
        }
      } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
        for (i = byteOffset; i >= 0; i--) {
          let found = true;
          for (let j = 0; j < valLength; j++) {
            if (read(arr, i + j) !== read(val, j)) {
              found = false;
              break;
            }
          }
          if (found) return i;
        }
      }
      return -1;
    }
    Buffer3.prototype.includes = function includes(val, byteOffset, encoding) {
      return this.indexOf(val, byteOffset, encoding) !== -1;
    };
    Buffer3.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
    };
    Buffer3.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
    };
    function hexWrite(buf, string, offset, length) {
      offset = Number(offset) || 0;
      const remaining = buf.length - offset;
      if (!length) {
        length = remaining;
      } else {
        length = Number(length);
        if (length > remaining) {
          length = remaining;
        }
      }
      const strLen = string.length;
      if (length > strLen / 2) {
        length = strLen / 2;
      }
      let i;
      for (i = 0; i < length; ++i) {
        const parsed = parseInt(string.substr(i * 2, 2), 16);
        if (numberIsNaN(parsed)) return i;
        buf[offset + i] = parsed;
      }
      return i;
    }
    function utf8Write(buf, string, offset, length) {
      return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
    }
    function asciiWrite(buf, string, offset, length) {
      return blitBuffer(asciiToBytes(string), buf, offset, length);
    }
    function base64Write(buf, string, offset, length) {
      return blitBuffer(base64ToBytes(string), buf, offset, length);
    }
    function ucs2Write(buf, string, offset, length) {
      return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
    }
    Buffer3.prototype.write = function write(string, offset, length, encoding) {
      if (offset === void 0) {
        encoding = "utf8";
        length = this.length;
        offset = 0;
      } else if (length === void 0 && typeof offset === "string") {
        encoding = offset;
        length = this.length;
        offset = 0;
      } else if (isFinite(offset)) {
        offset = offset >>> 0;
        if (isFinite(length)) {
          length = length >>> 0;
          if (encoding === void 0) encoding = "utf8";
        } else {
          encoding = length;
          length = void 0;
        }
      } else {
        throw new Error(
          "Buffer.write(string, encoding, offset[, length]) is no longer supported"
        );
      }
      const remaining = this.length - offset;
      if (length === void 0 || length > remaining) length = remaining;
      if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
        throw new RangeError("Attempt to write outside buffer bounds");
      }
      if (!encoding) encoding = "utf8";
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "hex":
            return hexWrite(this, string, offset, length);
          case "utf8":
          case "utf-8":
            return utf8Write(this, string, offset, length);
          case "ascii":
          case "latin1":
          case "binary":
            return asciiWrite(this, string, offset, length);
          case "base64":
            return base64Write(this, string, offset, length);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return ucs2Write(this, string, offset, length);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    };
    Buffer3.prototype.toJSON = function toJSON() {
      return {
        type: "Buffer",
        data: Array.prototype.slice.call(this._arr || this, 0)
      };
    };
    function base64Slice(buf, start, end) {
      if (start === 0 && end === buf.length) {
        return base64.fromByteArray(buf);
      } else {
        return base64.fromByteArray(buf.slice(start, end));
      }
    }
    function utf8Slice(buf, start, end) {
      end = Math.min(buf.length, end);
      const res = [];
      let i = start;
      while (i < end) {
        const firstByte = buf[i];
        let codePoint = null;
        let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
        if (i + bytesPerSequence <= end) {
          let secondByte, thirdByte, fourthByte, tempCodePoint;
          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 128) {
                codePoint = firstByte;
              }
              break;
            case 2:
              secondByte = buf[i + 1];
              if ((secondByte & 192) === 128) {
                tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                if (tempCodePoint > 127) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 3:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 4:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              fourthByte = buf[i + 3];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                  codePoint = tempCodePoint;
                }
              }
          }
        }
        if (codePoint === null) {
          codePoint = 65533;
          bytesPerSequence = 1;
        } else if (codePoint > 65535) {
          codePoint -= 65536;
          res.push(codePoint >>> 10 & 1023 | 55296);
          codePoint = 56320 | codePoint & 1023;
        }
        res.push(codePoint);
        i += bytesPerSequence;
      }
      return decodeCodePointsArray(res);
    }
    var MAX_ARGUMENTS_LENGTH = 4096;
    function decodeCodePointsArray(codePoints) {
      const len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints);
      }
      let res = "";
      let i = 0;
      while (i < len) {
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
        );
      }
      return res;
    }
    function asciiSlice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i] & 127);
      }
      return ret;
    }
    function latin1Slice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i]);
      }
      return ret;
    }
    function hexSlice(buf, start, end) {
      const len = buf.length;
      if (!start || start < 0) start = 0;
      if (!end || end < 0 || end > len) end = len;
      let out = "";
      for (let i = start; i < end; ++i) {
        out += hexSliceLookupTable[buf[i]];
      }
      return out;
    }
    function utf16leSlice(buf, start, end) {
      const bytes = buf.slice(start, end);
      let res = "";
      for (let i = 0; i < bytes.length - 1; i += 2) {
        res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
      }
      return res;
    }
    Buffer3.prototype.slice = function slice(start, end) {
      const len = this.length;
      start = ~~start;
      end = end === void 0 ? len : ~~end;
      if (start < 0) {
        start += len;
        if (start < 0) start = 0;
      } else if (start > len) {
        start = len;
      }
      if (end < 0) {
        end += len;
        if (end < 0) end = 0;
      } else if (end > len) {
        end = len;
      }
      if (end < start) end = start;
      const newBuf = this.subarray(start, end);
      Object.setPrototypeOf(newBuf, Buffer3.prototype);
      return newBuf;
    };
    function checkOffset(offset, ext, length) {
      if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
      if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
    }
    Buffer3.prototype.readUintLE = Buffer3.prototype.readUIntLE = function readUIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUintBE = Buffer3.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        checkOffset(offset, byteLength2, this.length);
      }
      let val = this[offset + --byteLength2];
      let mul = 1;
      while (byteLength2 > 0 && (mul *= 256)) {
        val += this[offset + --byteLength2] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUint8 = Buffer3.prototype.readUInt8 = function readUInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      return this[offset];
    };
    Buffer3.prototype.readUint16LE = Buffer3.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] | this[offset + 1] << 8;
    };
    Buffer3.prototype.readUint16BE = Buffer3.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] << 8 | this[offset + 1];
    };
    Buffer3.prototype.readUint32LE = Buffer3.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
    };
    Buffer3.prototype.readUint32BE = Buffer3.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
    };
    Buffer3.prototype.readBigUInt64LE = defineBigIntMethod(function readBigUInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const lo = first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24;
      const hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
      return BigInt(lo) + (BigInt(hi) << BigInt(32));
    });
    Buffer3.prototype.readBigUInt64BE = defineBigIntMethod(function readBigUInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const hi = first * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      const lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
      return (BigInt(hi) << BigInt(32)) + BigInt(lo);
    });
    Buffer3.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let i = byteLength2;
      let mul = 1;
      let val = this[offset + --i];
      while (i > 0 && (mul *= 256)) {
        val += this[offset + --i] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readInt8 = function readInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      if (!(this[offset] & 128)) return this[offset];
      return (255 - this[offset] + 1) * -1;
    };
    Buffer3.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset] | this[offset + 1] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset + 1] | this[offset] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
    };
    Buffer3.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
    };
    Buffer3.prototype.readBigInt64LE = defineBigIntMethod(function readBigInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
      return (BigInt(val) << BigInt(32)) + BigInt(first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
    });
    Buffer3.prototype.readBigInt64BE = defineBigIntMethod(function readBigInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = (first << 24) + // Overflow
      this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      return (BigInt(val) << BigInt(32)) + BigInt(this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last);
    });
    Buffer3.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, true, 23, 4);
    };
    Buffer3.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, false, 23, 4);
    };
    Buffer3.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, true, 52, 8);
    };
    Buffer3.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, false, 52, 8);
    };
    function checkInt(buf, value, offset, ext, max, min) {
      if (!Buffer3.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
      if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
    }
    Buffer3.prototype.writeUintLE = Buffer3.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let mul = 1;
      let i = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUintBE = Buffer3.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let i = byteLength2 - 1;
      let mul = 1;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUint8 = Buffer3.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeUint16LE = Buffer3.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeUint16BE = Buffer3.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeUint32LE = Buffer3.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset + 3] = value >>> 24;
      this[offset + 2] = value >>> 16;
      this[offset + 1] = value >>> 8;
      this[offset] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeUint32BE = Buffer3.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    function wrtBigUInt64LE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      return offset;
    }
    function wrtBigUInt64BE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset + 7] = lo;
      lo = lo >> 8;
      buf[offset + 6] = lo;
      lo = lo >> 8;
      buf[offset + 5] = lo;
      lo = lo >> 8;
      buf[offset + 4] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset + 3] = hi;
      hi = hi >> 8;
      buf[offset + 2] = hi;
      hi = hi >> 8;
      buf[offset + 1] = hi;
      hi = hi >> 8;
      buf[offset] = hi;
      return offset + 8;
    }
    Buffer3.prototype.writeBigUInt64LE = defineBigIntMethod(function writeBigUInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeBigUInt64BE = defineBigIntMethod(function writeBigUInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeIntLE = function writeIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = 0;
      let mul = 1;
      let sub = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeIntBE = function writeIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = byteLength2 - 1;
      let mul = 1;
      let sub = 0;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
      if (value < 0) value = 255 + value + 1;
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      this[offset + 2] = value >>> 16;
      this[offset + 3] = value >>> 24;
      return offset + 4;
    };
    Buffer3.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      if (value < 0) value = 4294967295 + value + 1;
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeBigInt64LE = defineBigIntMethod(function writeBigInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    Buffer3.prototype.writeBigInt64BE = defineBigIntMethod(function writeBigInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    function checkIEEE754(buf, value, offset, ext, max, min) {
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
      if (offset < 0) throw new RangeError("Index out of range");
    }
    function writeFloat(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22);
      }
      ieee754.write(buf, value, offset, littleEndian, 23, 4);
      return offset + 4;
    }
    Buffer3.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
      return writeFloat(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
      return writeFloat(this, value, offset, false, noAssert);
    };
    function writeDouble(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292);
      }
      ieee754.write(buf, value, offset, littleEndian, 52, 8);
      return offset + 8;
    }
    Buffer3.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
      return writeDouble(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
      return writeDouble(this, value, offset, false, noAssert);
    };
    Buffer3.prototype.copy = function copy(target, targetStart, start, end) {
      if (!Buffer3.isBuffer(target)) throw new TypeError("argument should be a Buffer");
      if (!start) start = 0;
      if (!end && end !== 0) end = this.length;
      if (targetStart >= target.length) targetStart = target.length;
      if (!targetStart) targetStart = 0;
      if (end > 0 && end < start) end = start;
      if (end === start) return 0;
      if (target.length === 0 || this.length === 0) return 0;
      if (targetStart < 0) {
        throw new RangeError("targetStart out of bounds");
      }
      if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
      if (end < 0) throw new RangeError("sourceEnd out of bounds");
      if (end > this.length) end = this.length;
      if (target.length - targetStart < end - start) {
        end = target.length - targetStart + start;
      }
      const len = end - start;
      if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
        this.copyWithin(targetStart, start, end);
      } else {
        Uint8Array.prototype.set.call(
          target,
          this.subarray(start, end),
          targetStart
        );
      }
      return len;
    };
    Buffer3.prototype.fill = function fill(val, start, end, encoding) {
      if (typeof val === "string") {
        if (typeof start === "string") {
          encoding = start;
          start = 0;
          end = this.length;
        } else if (typeof end === "string") {
          encoding = end;
          end = this.length;
        }
        if (encoding !== void 0 && typeof encoding !== "string") {
          throw new TypeError("encoding must be a string");
        }
        if (typeof encoding === "string" && !Buffer3.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        if (val.length === 1) {
          const code = val.charCodeAt(0);
          if (encoding === "utf8" && code < 128 || encoding === "latin1") {
            val = code;
          }
        }
      } else if (typeof val === "number") {
        val = val & 255;
      } else if (typeof val === "boolean") {
        val = Number(val);
      }
      if (start < 0 || this.length < start || this.length < end) {
        throw new RangeError("Out of range index");
      }
      if (end <= start) {
        return this;
      }
      start = start >>> 0;
      end = end === void 0 ? this.length : end >>> 0;
      if (!val) val = 0;
      let i;
      if (typeof val === "number") {
        for (i = start; i < end; ++i) {
          this[i] = val;
        }
      } else {
        const bytes = Buffer3.isBuffer(val) ? val : Buffer3.from(val, encoding);
        const len = bytes.length;
        if (len === 0) {
          throw new TypeError('The value "' + val + '" is invalid for argument "value"');
        }
        for (i = 0; i < end - start; ++i) {
          this[i + start] = bytes[i % len];
        }
      }
      return this;
    };
    var errors = {};
    function E(sym, getMessage, Base) {
      errors[sym] = class NodeError extends Base {
        constructor() {
          super();
          Object.defineProperty(this, "message", {
            value: getMessage.apply(this, arguments),
            writable: true,
            configurable: true
          });
          this.name = `${this.name} [${sym}]`;
          this.stack;
          delete this.name;
        }
        get code() {
          return sym;
        }
        set code(value) {
          Object.defineProperty(this, "code", {
            configurable: true,
            enumerable: true,
            value,
            writable: true
          });
        }
        toString() {
          return `${this.name} [${sym}]: ${this.message}`;
        }
      };
    }
    E(
      "ERR_BUFFER_OUT_OF_BOUNDS",
      function(name) {
        if (name) {
          return `${name} is outside of buffer bounds`;
        }
        return "Attempt to access memory outside buffer bounds";
      },
      RangeError
    );
    E(
      "ERR_INVALID_ARG_TYPE",
      function(name, actual) {
        return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
      },
      TypeError
    );
    E(
      "ERR_OUT_OF_RANGE",
      function(str, range, input) {
        let msg = `The value of "${str}" is out of range.`;
        let received = input;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
          received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
          received = String(input);
          if (input > BigInt(2) ** BigInt(32) || input < -(BigInt(2) ** BigInt(32))) {
            received = addNumericalSeparator(received);
          }
          received += "n";
        }
        msg += ` It must be ${range}. Received ${received}`;
        return msg;
      },
      RangeError
    );
    function addNumericalSeparator(val) {
      let res = "";
      let i = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i >= start + 4; i -= 3) {
        res = `_${val.slice(i - 3, i)}${res}`;
      }
      return `${val.slice(0, i)}${res}`;
    }
    function checkBounds(buf, offset, byteLength2) {
      validateNumber(offset, "offset");
      if (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) {
        boundsError(offset, buf.length - (byteLength2 + 1));
      }
    }
    function checkIntBI(value, min, max, buf, offset, byteLength2) {
      if (value > max || value < min) {
        const n = typeof min === "bigint" ? "n" : "";
        let range;
        if (byteLength2 > 3) {
          if (min === 0 || min === BigInt(0)) {
            range = `>= 0${n} and < 2${n} ** ${(byteLength2 + 1) * 8}${n}`;
          } else {
            range = `>= -(2${n} ** ${(byteLength2 + 1) * 8 - 1}${n}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n}`;
          }
        } else {
          range = `>= ${min}${n} and <= ${max}${n}`;
        }
        throw new errors.ERR_OUT_OF_RANGE("value", range, value);
      }
      checkBounds(buf, offset, byteLength2);
    }
    function validateNumber(value, name) {
      if (typeof value !== "number") {
        throw new errors.ERR_INVALID_ARG_TYPE(name, "number", value);
      }
    }
    function boundsError(value, length, type) {
      if (Math.floor(value) !== value) {
        validateNumber(value, type);
        throw new errors.ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
      }
      if (length < 0) {
        throw new errors.ERR_BUFFER_OUT_OF_BOUNDS();
      }
      throw new errors.ERR_OUT_OF_RANGE(
        type || "offset",
        `>= ${type ? 1 : 0} and <= ${length}`,
        value
      );
    }
    var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
    function base64clean(str) {
      str = str.split("=")[0];
      str = str.trim().replace(INVALID_BASE64_RE, "");
      if (str.length < 2) return "";
      while (str.length % 4 !== 0) {
        str = str + "=";
      }
      return str;
    }
    function utf8ToBytes(string, units) {
      units = units || Infinity;
      let codePoint;
      const length = string.length;
      let leadSurrogate = null;
      const bytes = [];
      for (let i = 0; i < length; ++i) {
        codePoint = string.charCodeAt(i);
        if (codePoint > 55295 && codePoint < 57344) {
          if (!leadSurrogate) {
            if (codePoint > 56319) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            } else if (i + 1 === length) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            }
            leadSurrogate = codePoint;
            continue;
          }
          if (codePoint < 56320) {
            if ((units -= 3) > -1) bytes.push(239, 191, 189);
            leadSurrogate = codePoint;
            continue;
          }
          codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
        } else if (leadSurrogate) {
          if ((units -= 3) > -1) bytes.push(239, 191, 189);
        }
        leadSurrogate = null;
        if (codePoint < 128) {
          if ((units -= 1) < 0) break;
          bytes.push(codePoint);
        } else if (codePoint < 2048) {
          if ((units -= 2) < 0) break;
          bytes.push(
            codePoint >> 6 | 192,
            codePoint & 63 | 128
          );
        } else if (codePoint < 65536) {
          if ((units -= 3) < 0) break;
          bytes.push(
            codePoint >> 12 | 224,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else if (codePoint < 1114112) {
          if ((units -= 4) < 0) break;
          bytes.push(
            codePoint >> 18 | 240,
            codePoint >> 12 & 63 | 128,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else {
          throw new Error("Invalid code point");
        }
      }
      return bytes;
    }
    function asciiToBytes(str) {
      const byteArray = [];
      for (let i = 0; i < str.length; ++i) {
        byteArray.push(str.charCodeAt(i) & 255);
      }
      return byteArray;
    }
    function utf16leToBytes(str, units) {
      let c, hi, lo;
      const byteArray = [];
      for (let i = 0; i < str.length; ++i) {
        if ((units -= 2) < 0) break;
        c = str.charCodeAt(i);
        hi = c >> 8;
        lo = c % 256;
        byteArray.push(lo);
        byteArray.push(hi);
      }
      return byteArray;
    }
    function base64ToBytes(str) {
      return base64.toByteArray(base64clean(str));
    }
    function blitBuffer(src, dst, offset, length) {
      let i;
      for (i = 0; i < length; ++i) {
        if (i + offset >= dst.length || i >= src.length) break;
        dst[i + offset] = src[i];
      }
      return i;
    }
    function isInstance(obj, type) {
      return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
    }
    function numberIsNaN(obj) {
      return obj !== obj;
    }
    var hexSliceLookupTable = (function() {
      const alphabet = "0123456789abcdef";
      const table = new Array(256);
      for (let i = 0; i < 16; ++i) {
        const i16 = i * 16;
        for (let j = 0; j < 16; ++j) {
          table[i16 + j] = alphabet[i] + alphabet[j];
        }
      }
      return table;
    })();
    function defineBigIntMethod(fn) {
      return typeof BigInt === "undefined" ? BufferBigIntNotDefined : fn;
    }
    function BufferBigIntNotDefined() {
      throw new Error("BigInt not supported");
    }
  }
});

// node_modules/readable-stream/lib/ours/primordials.js
var require_primordials = __commonJS({
  "node_modules/readable-stream/lib/ours/primordials.js"(exports, module) {
    "use strict";
    var AggregateError = class extends Error {
      constructor(errors) {
        if (!Array.isArray(errors)) {
          throw new TypeError(`Expected input to be an Array, got ${typeof errors}`);
        }
        let message = "";
        for (let i = 0; i < errors.length; i++) {
          message += `    ${errors[i].stack}
`;
        }
        super(message);
        this.name = "AggregateError";
        this.errors = errors;
      }
    };
    module.exports = {
      AggregateError,
      ArrayIsArray(self2) {
        return Array.isArray(self2);
      },
      ArrayPrototypeIncludes(self2, el) {
        return self2.includes(el);
      },
      ArrayPrototypeIndexOf(self2, el) {
        return self2.indexOf(el);
      },
      ArrayPrototypeJoin(self2, sep) {
        return self2.join(sep);
      },
      ArrayPrototypeMap(self2, fn) {
        return self2.map(fn);
      },
      ArrayPrototypePop(self2, el) {
        return self2.pop(el);
      },
      ArrayPrototypePush(self2, el) {
        return self2.push(el);
      },
      ArrayPrototypeSlice(self2, start, end) {
        return self2.slice(start, end);
      },
      Error,
      FunctionPrototypeCall(fn, thisArgs, ...args) {
        return fn.call(thisArgs, ...args);
      },
      FunctionPrototypeSymbolHasInstance(self2, instance) {
        return Function.prototype[Symbol.hasInstance].call(self2, instance);
      },
      MathFloor: Math.floor,
      Number,
      NumberIsInteger: Number.isInteger,
      NumberIsNaN: Number.isNaN,
      NumberMAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
      NumberMIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
      NumberParseInt: Number.parseInt,
      ObjectDefineProperties(self2, props) {
        return Object.defineProperties(self2, props);
      },
      ObjectDefineProperty(self2, name, prop) {
        return Object.defineProperty(self2, name, prop);
      },
      ObjectGetOwnPropertyDescriptor(self2, name) {
        return Object.getOwnPropertyDescriptor(self2, name);
      },
      ObjectKeys(obj) {
        return Object.keys(obj);
      },
      ObjectSetPrototypeOf(target, proto) {
        return Object.setPrototypeOf(target, proto);
      },
      Promise,
      PromisePrototypeCatch(self2, fn) {
        return self2.catch(fn);
      },
      PromisePrototypeThen(self2, thenFn, catchFn) {
        return self2.then(thenFn, catchFn);
      },
      PromiseReject(err) {
        return Promise.reject(err);
      },
      PromiseResolve(val) {
        return Promise.resolve(val);
      },
      ReflectApply: Reflect.apply,
      RegExpPrototypeTest(self2, value) {
        return self2.test(value);
      },
      SafeSet: Set,
      String,
      StringPrototypeSlice(self2, start, end) {
        return self2.slice(start, end);
      },
      StringPrototypeToLowerCase(self2) {
        return self2.toLowerCase();
      },
      StringPrototypeToUpperCase(self2) {
        return self2.toUpperCase();
      },
      StringPrototypeTrim(self2) {
        return self2.trim();
      },
      Symbol,
      SymbolFor: Symbol.for,
      SymbolAsyncIterator: Symbol.asyncIterator,
      SymbolHasInstance: Symbol.hasInstance,
      SymbolIterator: Symbol.iterator,
      SymbolDispose: Symbol.dispose || Symbol("Symbol.dispose"),
      SymbolAsyncDispose: Symbol.asyncDispose || Symbol("Symbol.asyncDispose"),
      TypedArrayPrototypeSet(self2, buf, len) {
        return self2.set(buf, len);
      },
      Boolean,
      Uint8Array
    };
  }
});

// node_modules/readable-stream/lib/ours/util/inspect.js
var require_inspect = __commonJS({
  "node_modules/readable-stream/lib/ours/util/inspect.js"(exports, module) {
    "use strict";
    module.exports = {
      format(format, ...args) {
        return format.replace(/%([sdifj])/g, function(...[_unused, type]) {
          const replacement = args.shift();
          if (type === "f") {
            return replacement.toFixed(6);
          } else if (type === "j") {
            return JSON.stringify(replacement);
          } else if (type === "s" && typeof replacement === "object") {
            const ctor = replacement.constructor !== Object ? replacement.constructor.name : "";
            return `${ctor} {}`.trim();
          } else {
            return replacement.toString();
          }
        });
      },
      inspect(value) {
        switch (typeof value) {
          case "string":
            if (value.includes("'")) {
              if (!value.includes('"')) {
                return `"${value}"`;
              } else if (!value.includes("`") && !value.includes("${")) {
                return `\`${value}\``;
              }
            }
            return `'${value}'`;
          case "number":
            if (isNaN(value)) {
              return "NaN";
            } else if (Object.is(value, -0)) {
              return String(value);
            }
            return value;
          case "bigint":
            return `${String(value)}n`;
          case "boolean":
          case "undefined":
            return String(value);
          case "object":
            return "{}";
        }
      }
    };
  }
});

// node_modules/readable-stream/lib/ours/errors.js
var require_errors = __commonJS({
  "node_modules/readable-stream/lib/ours/errors.js"(exports, module) {
    "use strict";
    var { format, inspect } = require_inspect();
    var { AggregateError: CustomAggregateError } = require_primordials();
    var AggregateError = globalThis.AggregateError || CustomAggregateError;
    var kIsNodeError = Symbol("kIsNodeError");
    var kTypes = [
      "string",
      "function",
      "number",
      "object",
      // Accept 'Function' and 'Object' as alternative to the lower cased version.
      "Function",
      "Object",
      "boolean",
      "bigint",
      "symbol"
    ];
    var classRegExp = /^([A-Z][a-z0-9]*)+$/;
    var nodeInternalPrefix = "__node_internal_";
    var codes = {};
    function assert(value, message) {
      if (!value) {
        throw new codes.ERR_INTERNAL_ASSERTION(message);
      }
    }
    function addNumericalSeparator(val) {
      let res = "";
      let i = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i >= start + 4; i -= 3) {
        res = `_${val.slice(i - 3, i)}${res}`;
      }
      return `${val.slice(0, i)}${res}`;
    }
    function getMessage(key, msg, args) {
      if (typeof msg === "function") {
        assert(
          msg.length <= args.length,
          // Default options do not count.
          `Code: ${key}; The provided arguments length (${args.length}) does not match the required ones (${msg.length}).`
        );
        return msg(...args);
      }
      const expectedLength = (msg.match(/%[dfijoOs]/g) || []).length;
      assert(
        expectedLength === args.length,
        `Code: ${key}; The provided arguments length (${args.length}) does not match the required ones (${expectedLength}).`
      );
      if (args.length === 0) {
        return msg;
      }
      return format(msg, ...args);
    }
    function E(code, message, Base) {
      if (!Base) {
        Base = Error;
      }
      class NodeError extends Base {
        constructor(...args) {
          super(getMessage(code, message, args));
        }
        toString() {
          return `${this.name} [${code}]: ${this.message}`;
        }
      }
      Object.defineProperties(NodeError.prototype, {
        name: {
          value: Base.name,
          writable: true,
          enumerable: false,
          configurable: true
        },
        toString: {
          value() {
            return `${this.name} [${code}]: ${this.message}`;
          },
          writable: true,
          enumerable: false,
          configurable: true
        }
      });
      NodeError.prototype.code = code;
      NodeError.prototype[kIsNodeError] = true;
      codes[code] = NodeError;
    }
    function hideStackFrames(fn) {
      const hidden = nodeInternalPrefix + fn.name;
      Object.defineProperty(fn, "name", {
        value: hidden
      });
      return fn;
    }
    function aggregateTwoErrors(innerError, outerError) {
      if (innerError && outerError && innerError !== outerError) {
        if (Array.isArray(outerError.errors)) {
          outerError.errors.push(innerError);
          return outerError;
        }
        const err = new AggregateError([outerError, innerError], outerError.message);
        err.code = outerError.code;
        return err;
      }
      return innerError || outerError;
    }
    var AbortError = class extends Error {
      constructor(message = "The operation was aborted", options = void 0) {
        if (options !== void 0 && typeof options !== "object") {
          throw new codes.ERR_INVALID_ARG_TYPE("options", "Object", options);
        }
        super(message, options);
        this.code = "ABORT_ERR";
        this.name = "AbortError";
      }
    };
    E("ERR_ASSERTION", "%s", Error);
    E(
      "ERR_INVALID_ARG_TYPE",
      (name, expected, actual) => {
        assert(typeof name === "string", "'name' must be a string");
        if (!Array.isArray(expected)) {
          expected = [expected];
        }
        let msg = "The ";
        if (name.endsWith(" argument")) {
          msg += `${name} `;
        } else {
          msg += `"${name}" ${name.includes(".") ? "property" : "argument"} `;
        }
        msg += "must be ";
        const types = [];
        const instances = [];
        const other = [];
        for (const value of expected) {
          assert(typeof value === "string", "All expected entries have to be of type string");
          if (kTypes.includes(value)) {
            types.push(value.toLowerCase());
          } else if (classRegExp.test(value)) {
            instances.push(value);
          } else {
            assert(value !== "object", 'The value "object" should be written as "Object"');
            other.push(value);
          }
        }
        if (instances.length > 0) {
          const pos = types.indexOf("object");
          if (pos !== -1) {
            types.splice(types, pos, 1);
            instances.push("Object");
          }
        }
        if (types.length > 0) {
          switch (types.length) {
            case 1:
              msg += `of type ${types[0]}`;
              break;
            case 2:
              msg += `one of type ${types[0]} or ${types[1]}`;
              break;
            default: {
              const last = types.pop();
              msg += `one of type ${types.join(", ")}, or ${last}`;
            }
          }
          if (instances.length > 0 || other.length > 0) {
            msg += " or ";
          }
        }
        if (instances.length > 0) {
          switch (instances.length) {
            case 1:
              msg += `an instance of ${instances[0]}`;
              break;
            case 2:
              msg += `an instance of ${instances[0]} or ${instances[1]}`;
              break;
            default: {
              const last = instances.pop();
              msg += `an instance of ${instances.join(", ")}, or ${last}`;
            }
          }
          if (other.length > 0) {
            msg += " or ";
          }
        }
        switch (other.length) {
          case 0:
            break;
          case 1:
            if (other[0].toLowerCase() !== other[0]) {
              msg += "an ";
            }
            msg += `${other[0]}`;
            break;
          case 2:
            msg += `one of ${other[0]} or ${other[1]}`;
            break;
          default: {
            const last = other.pop();
            msg += `one of ${other.join(", ")}, or ${last}`;
          }
        }
        if (actual == null) {
          msg += `. Received ${actual}`;
        } else if (typeof actual === "function" && actual.name) {
          msg += `. Received function ${actual.name}`;
        } else if (typeof actual === "object") {
          var _actual$constructor;
          if ((_actual$constructor = actual.constructor) !== null && _actual$constructor !== void 0 && _actual$constructor.name) {
            msg += `. Received an instance of ${actual.constructor.name}`;
          } else {
            const inspected = inspect(actual, {
              depth: -1
            });
            msg += `. Received ${inspected}`;
          }
        } else {
          let inspected = inspect(actual, {
            colors: false
          });
          if (inspected.length > 25) {
            inspected = `${inspected.slice(0, 25)}...`;
          }
          msg += `. Received type ${typeof actual} (${inspected})`;
        }
        return msg;
      },
      TypeError
    );
    E(
      "ERR_INVALID_ARG_VALUE",
      (name, value, reason = "is invalid") => {
        let inspected = inspect(value);
        if (inspected.length > 128) {
          inspected = inspected.slice(0, 128) + "...";
        }
        const type = name.includes(".") ? "property" : "argument";
        return `The ${type} '${name}' ${reason}. Received ${inspected}`;
      },
      TypeError
    );
    E(
      "ERR_INVALID_RETURN_VALUE",
      (input, name, value) => {
        var _value$constructor;
        const type = value !== null && value !== void 0 && (_value$constructor = value.constructor) !== null && _value$constructor !== void 0 && _value$constructor.name ? `instance of ${value.constructor.name}` : `type ${typeof value}`;
        return `Expected ${input} to be returned from the "${name}" function but got ${type}.`;
      },
      TypeError
    );
    E(
      "ERR_MISSING_ARGS",
      (...args) => {
        assert(args.length > 0, "At least one arg needs to be specified");
        let msg;
        const len = args.length;
        args = (Array.isArray(args) ? args : [args]).map((a) => `"${a}"`).join(" or ");
        switch (len) {
          case 1:
            msg += `The ${args[0]} argument`;
            break;
          case 2:
            msg += `The ${args[0]} and ${args[1]} arguments`;
            break;
          default:
            {
              const last = args.pop();
              msg += `The ${args.join(", ")}, and ${last} arguments`;
            }
            break;
        }
        return `${msg} must be specified`;
      },
      TypeError
    );
    E(
      "ERR_OUT_OF_RANGE",
      (str, range, input) => {
        assert(range, 'Missing "range" argument');
        let received;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
          received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
          received = String(input);
          const limit = BigInt(2) ** BigInt(32);
          if (input > limit || input < -limit) {
            received = addNumericalSeparator(received);
          }
          received += "n";
        } else {
          received = inspect(input);
        }
        return `The value of "${str}" is out of range. It must be ${range}. Received ${received}`;
      },
      RangeError
    );
    E("ERR_MULTIPLE_CALLBACK", "Callback called multiple times", Error);
    E("ERR_METHOD_NOT_IMPLEMENTED", "The %s method is not implemented", Error);
    E("ERR_STREAM_ALREADY_FINISHED", "Cannot call %s after a stream was finished", Error);
    E("ERR_STREAM_CANNOT_PIPE", "Cannot pipe, not readable", Error);
    E("ERR_STREAM_DESTROYED", "Cannot call %s after a stream was destroyed", Error);
    E("ERR_STREAM_NULL_VALUES", "May not write null values to stream", TypeError);
    E("ERR_STREAM_PREMATURE_CLOSE", "Premature close", Error);
    E("ERR_STREAM_PUSH_AFTER_EOF", "stream.push() after EOF", Error);
    E("ERR_STREAM_UNSHIFT_AFTER_END_EVENT", "stream.unshift() after end event", Error);
    E("ERR_STREAM_WRITE_AFTER_END", "write after end", Error);
    E("ERR_UNKNOWN_ENCODING", "Unknown encoding: %s", TypeError);
    module.exports = {
      AbortError,
      aggregateTwoErrors: hideStackFrames(aggregateTwoErrors),
      hideStackFrames,
      codes
    };
  }
});

// node_modules/abort-controller/browser.js
var require_browser = __commonJS({
  "node_modules/abort-controller/browser.js"(exports, module) {
    "use strict";
    var { AbortController, AbortSignal } = typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : (
      /* otherwise */
      void 0
    );
    module.exports = AbortController;
    module.exports.AbortSignal = AbortSignal;
    module.exports.default = AbortController;
  }
});

// node_modules/events/events.js
var require_events = __commonJS({
  "node_modules/events/events.js"(exports, module) {
    "use strict";
    var R = typeof Reflect === "object" ? Reflect : null;
    var ReflectApply = R && typeof R.apply === "function" ? R.apply : function ReflectApply2(target, receiver, args) {
      return Function.prototype.apply.call(target, receiver, args);
    };
    var ReflectOwnKeys;
    if (R && typeof R.ownKeys === "function") {
      ReflectOwnKeys = R.ownKeys;
    } else if (Object.getOwnPropertySymbols) {
      ReflectOwnKeys = function ReflectOwnKeys2(target) {
        return Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
      };
    } else {
      ReflectOwnKeys = function ReflectOwnKeys2(target) {
        return Object.getOwnPropertyNames(target);
      };
    }
    function ProcessEmitWarning(warning) {
      if (console && console.warn) console.warn(warning);
    }
    var NumberIsNaN = Number.isNaN || function NumberIsNaN2(value) {
      return value !== value;
    };
    function EventEmitter() {
      EventEmitter.init.call(this);
    }
    module.exports = EventEmitter;
    module.exports.once = once;
    EventEmitter.EventEmitter = EventEmitter;
    EventEmitter.prototype._events = void 0;
    EventEmitter.prototype._eventsCount = 0;
    EventEmitter.prototype._maxListeners = void 0;
    var defaultMaxListeners = 10;
    function checkListener(listener) {
      if (typeof listener !== "function") {
        throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
      }
    }
    Object.defineProperty(EventEmitter, "defaultMaxListeners", {
      enumerable: true,
      get: function() {
        return defaultMaxListeners;
      },
      set: function(arg) {
        if (typeof arg !== "number" || arg < 0 || NumberIsNaN(arg)) {
          throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + ".");
        }
        defaultMaxListeners = arg;
      }
    });
    EventEmitter.init = function() {
      if (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) {
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
      }
      this._maxListeners = this._maxListeners || void 0;
    };
    EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
      if (typeof n !== "number" || n < 0 || NumberIsNaN(n)) {
        throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + ".");
      }
      this._maxListeners = n;
      return this;
    };
    function _getMaxListeners(that) {
      if (that._maxListeners === void 0)
        return EventEmitter.defaultMaxListeners;
      return that._maxListeners;
    }
    EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
      return _getMaxListeners(this);
    };
    EventEmitter.prototype.emit = function emit(type) {
      var args = [];
      for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
      var doError = type === "error";
      var events = this._events;
      if (events !== void 0)
        doError = doError && events.error === void 0;
      else if (!doError)
        return false;
      if (doError) {
        var er;
        if (args.length > 0)
          er = args[0];
        if (er instanceof Error) {
          throw er;
        }
        var err = new Error("Unhandled error." + (er ? " (" + er.message + ")" : ""));
        err.context = er;
        throw err;
      }
      var handler = events[type];
      if (handler === void 0)
        return false;
      if (typeof handler === "function") {
        ReflectApply(handler, this, args);
      } else {
        var len = handler.length;
        var listeners = arrayClone(handler, len);
        for (var i = 0; i < len; ++i)
          ReflectApply(listeners[i], this, args);
      }
      return true;
    };
    function _addListener(target, type, listener, prepend) {
      var m;
      var events;
      var existing;
      checkListener(listener);
      events = target._events;
      if (events === void 0) {
        events = target._events = /* @__PURE__ */ Object.create(null);
        target._eventsCount = 0;
      } else {
        if (events.newListener !== void 0) {
          target.emit(
            "newListener",
            type,
            listener.listener ? listener.listener : listener
          );
          events = target._events;
        }
        existing = events[type];
      }
      if (existing === void 0) {
        existing = events[type] = listener;
        ++target._eventsCount;
      } else {
        if (typeof existing === "function") {
          existing = events[type] = prepend ? [listener, existing] : [existing, listener];
        } else if (prepend) {
          existing.unshift(listener);
        } else {
          existing.push(listener);
        }
        m = _getMaxListeners(target);
        if (m > 0 && existing.length > m && !existing.warned) {
          existing.warned = true;
          var w = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + String(type) + " listeners added. Use emitter.setMaxListeners() to increase limit");
          w.name = "MaxListenersExceededWarning";
          w.emitter = target;
          w.type = type;
          w.count = existing.length;
          ProcessEmitWarning(w);
        }
      }
      return target;
    }
    EventEmitter.prototype.addListener = function addListener(type, listener) {
      return _addListener(this, type, listener, false);
    };
    EventEmitter.prototype.on = EventEmitter.prototype.addListener;
    EventEmitter.prototype.prependListener = function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };
    function onceWrapper() {
      if (!this.fired) {
        this.target.removeListener(this.type, this.wrapFn);
        this.fired = true;
        if (arguments.length === 0)
          return this.listener.call(this.target);
        return this.listener.apply(this.target, arguments);
      }
    }
    function _onceWrap(target, type, listener) {
      var state = { fired: false, wrapFn: void 0, target, type, listener };
      var wrapped = onceWrapper.bind(state);
      wrapped.listener = listener;
      state.wrapFn = wrapped;
      return wrapped;
    }
    EventEmitter.prototype.once = function once2(type, listener) {
      checkListener(listener);
      this.on(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter.prototype.prependOnceListener = function prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter.prototype.removeListener = function removeListener(type, listener) {
      var list, events, position, i, originalListener;
      checkListener(listener);
      events = this._events;
      if (events === void 0)
        return this;
      list = events[type];
      if (list === void 0)
        return this;
      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = /* @__PURE__ */ Object.create(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit("removeListener", type, list.listener || listener);
        }
      } else if (typeof list !== "function") {
        position = -1;
        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }
        if (position < 0)
          return this;
        if (position === 0)
          list.shift();
        else {
          spliceOne(list, position);
        }
        if (list.length === 1)
          events[type] = list[0];
        if (events.removeListener !== void 0)
          this.emit("removeListener", type, originalListener || listener);
      }
      return this;
    };
    EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
    EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
      var listeners, events, i;
      events = this._events;
      if (events === void 0)
        return this;
      if (events.removeListener === void 0) {
        if (arguments.length === 0) {
          this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
        } else if (events[type] !== void 0) {
          if (--this._eventsCount === 0)
            this._events = /* @__PURE__ */ Object.create(null);
          else
            delete events[type];
        }
        return this;
      }
      if (arguments.length === 0) {
        var keys = Object.keys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === "removeListener") continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners("removeListener");
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
        return this;
      }
      listeners = events[type];
      if (typeof listeners === "function") {
        this.removeListener(type, listeners);
      } else if (listeners !== void 0) {
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }
      return this;
    };
    function _listeners(target, type, unwrap) {
      var events = target._events;
      if (events === void 0)
        return [];
      var evlistener = events[type];
      if (evlistener === void 0)
        return [];
      if (typeof evlistener === "function")
        return unwrap ? [evlistener.listener || evlistener] : [evlistener];
      return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
    }
    EventEmitter.prototype.listeners = function listeners(type) {
      return _listeners(this, type, true);
    };
    EventEmitter.prototype.rawListeners = function rawListeners(type) {
      return _listeners(this, type, false);
    };
    EventEmitter.listenerCount = function(emitter, type) {
      if (typeof emitter.listenerCount === "function") {
        return emitter.listenerCount(type);
      } else {
        return listenerCount.call(emitter, type);
      }
    };
    EventEmitter.prototype.listenerCount = listenerCount;
    function listenerCount(type) {
      var events = this._events;
      if (events !== void 0) {
        var evlistener = events[type];
        if (typeof evlistener === "function") {
          return 1;
        } else if (evlistener !== void 0) {
          return evlistener.length;
        }
      }
      return 0;
    }
    EventEmitter.prototype.eventNames = function eventNames() {
      return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
    };
    function arrayClone(arr, n) {
      var copy = new Array(n);
      for (var i = 0; i < n; ++i)
        copy[i] = arr[i];
      return copy;
    }
    function spliceOne(list, index) {
      for (; index + 1 < list.length; index++)
        list[index] = list[index + 1];
      list.pop();
    }
    function unwrapListeners(arr) {
      var ret = new Array(arr.length);
      for (var i = 0; i < ret.length; ++i) {
        ret[i] = arr[i].listener || arr[i];
      }
      return ret;
    }
    function once(emitter, name) {
      return new Promise(function(resolve, reject) {
        function errorListener(err) {
          emitter.removeListener(name, resolver);
          reject(err);
        }
        function resolver() {
          if (typeof emitter.removeListener === "function") {
            emitter.removeListener("error", errorListener);
          }
          resolve([].slice.call(arguments));
        }
        ;
        eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
        if (name !== "error") {
          addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
        }
      });
    }
    function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
      if (typeof emitter.on === "function") {
        eventTargetAgnosticAddListener(emitter, "error", handler, flags);
      }
    }
    function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
      if (typeof emitter.on === "function") {
        if (flags.once) {
          emitter.once(name, listener);
        } else {
          emitter.on(name, listener);
        }
      } else if (typeof emitter.addEventListener === "function") {
        emitter.addEventListener(name, function wrapListener(arg) {
          if (flags.once) {
            emitter.removeEventListener(name, wrapListener);
          }
          listener(arg);
        });
      } else {
        throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
      }
    }
  }
});

// node_modules/readable-stream/lib/ours/util.js
var require_util = __commonJS({
  "node_modules/readable-stream/lib/ours/util.js"(exports, module) {
    "use strict";
    var bufferModule = require_buffer();
    var { format, inspect } = require_inspect();
    var {
      codes: { ERR_INVALID_ARG_TYPE }
    } = require_errors();
    var { kResistStopPropagation, AggregateError, SymbolDispose } = require_primordials();
    var AbortSignal = globalThis.AbortSignal || require_browser().AbortSignal;
    var AbortController = globalThis.AbortController || require_browser().AbortController;
    var AsyncFunction = Object.getPrototypeOf(async function() {
    }).constructor;
    var Blob = globalThis.Blob || bufferModule.Blob;
    var isBlob = typeof Blob !== "undefined" ? function isBlob2(b) {
      return b instanceof Blob;
    } : function isBlob2(b) {
      return false;
    };
    var validateAbortSignal = (signal, name) => {
      if (signal !== void 0 && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
      }
    };
    var validateFunction = (value, name) => {
      if (typeof value !== "function") {
        throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
      }
    };
    module.exports = {
      AggregateError,
      kEmptyObject: Object.freeze({}),
      once(callback) {
        let called = false;
        return function(...args) {
          if (called) {
            return;
          }
          called = true;
          callback.apply(this, args);
        };
      },
      createDeferredPromise: function() {
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return {
          promise,
          resolve,
          reject
        };
      },
      promisify(fn) {
        return new Promise((resolve, reject) => {
          fn((err, ...args) => {
            if (err) {
              return reject(err);
            }
            return resolve(...args);
          });
        });
      },
      debuglog() {
        return function() {
        };
      },
      format,
      inspect,
      types: {
        isAsyncFunction(fn) {
          return fn instanceof AsyncFunction;
        },
        isArrayBufferView(arr) {
          return ArrayBuffer.isView(arr);
        }
      },
      isBlob,
      deprecate(fn, message) {
        return fn;
      },
      addAbortListener: require_events().addAbortListener || function addAbortListener(signal, listener) {
        if (signal === void 0) {
          throw new ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
        }
        validateAbortSignal(signal, "signal");
        validateFunction(listener, "listener");
        let removeEventListener;
        if (signal.aborted) {
          queueMicrotask(() => listener());
        } else {
          signal.addEventListener("abort", listener, {
            __proto__: null,
            once: true,
            [kResistStopPropagation]: true
          });
          removeEventListener = () => {
            signal.removeEventListener("abort", listener);
          };
        }
        return {
          __proto__: null,
          [SymbolDispose]() {
            var _removeEventListener;
            (_removeEventListener = removeEventListener) === null || _removeEventListener === void 0 ? void 0 : _removeEventListener();
          }
        };
      },
      AbortSignalAny: AbortSignal.any || function AbortSignalAny(signals) {
        if (signals.length === 1) {
          return signals[0];
        }
        const ac = new AbortController();
        const abort = () => ac.abort();
        signals.forEach((signal) => {
          validateAbortSignal(signal, "signals");
          signal.addEventListener("abort", abort, {
            once: true
          });
        });
        ac.signal.addEventListener(
          "abort",
          () => {
            signals.forEach((signal) => signal.removeEventListener("abort", abort));
          },
          {
            once: true
          }
        );
        return ac.signal;
      }
    };
    module.exports.promisify.custom = Symbol.for("nodejs.util.promisify.custom");
  }
});

// node_modules/readable-stream/lib/internal/validators.js
var require_validators = __commonJS({
  "node_modules/readable-stream/lib/internal/validators.js"(exports, module) {
    "use strict";
    var {
      ArrayIsArray,
      ArrayPrototypeIncludes,
      ArrayPrototypeJoin,
      ArrayPrototypeMap,
      NumberIsInteger,
      NumberIsNaN,
      NumberMAX_SAFE_INTEGER,
      NumberMIN_SAFE_INTEGER,
      NumberParseInt,
      ObjectPrototypeHasOwnProperty,
      RegExpPrototypeExec,
      String: String2,
      StringPrototypeToUpperCase,
      StringPrototypeTrim
    } = require_primordials();
    var {
      hideStackFrames,
      codes: { ERR_SOCKET_BAD_PORT, ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE, ERR_OUT_OF_RANGE, ERR_UNKNOWN_SIGNAL }
    } = require_errors();
    var { normalizeEncoding } = require_util();
    var { isAsyncFunction, isArrayBufferView } = require_util().types;
    var signals = {};
    function isInt32(value) {
      return value === (value | 0);
    }
    function isUint32(value) {
      return value === value >>> 0;
    }
    var octalReg = /^[0-7]+$/;
    var modeDesc = "must be a 32-bit unsigned integer or an octal string";
    function parseFileMode(value, name, def) {
      if (typeof value === "undefined") {
        value = def;
      }
      if (typeof value === "string") {
        if (RegExpPrototypeExec(octalReg, value) === null) {
          throw new ERR_INVALID_ARG_VALUE(name, value, modeDesc);
        }
        value = NumberParseInt(value, 8);
      }
      validateUint32(value, name);
      return value;
    }
    var validateInteger = hideStackFrames((value, name, min = NumberMIN_SAFE_INTEGER, max = NumberMAX_SAFE_INTEGER) => {
      if (typeof value !== "number") throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      if (!NumberIsInteger(value)) throw new ERR_OUT_OF_RANGE(name, "an integer", value);
      if (value < min || value > max) throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
    });
    var validateInt32 = hideStackFrames((value, name, min = -2147483648, max = 2147483647) => {
      if (typeof value !== "number") {
        throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      }
      if (!NumberIsInteger(value)) {
        throw new ERR_OUT_OF_RANGE(name, "an integer", value);
      }
      if (value < min || value > max) {
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
      }
    });
    var validateUint32 = hideStackFrames((value, name, positive = false) => {
      if (typeof value !== "number") {
        throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      }
      if (!NumberIsInteger(value)) {
        throw new ERR_OUT_OF_RANGE(name, "an integer", value);
      }
      const min = positive ? 1 : 0;
      const max = 4294967295;
      if (value < min || value > max) {
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
      }
    });
    function validateString(value, name) {
      if (typeof value !== "string") throw new ERR_INVALID_ARG_TYPE(name, "string", value);
    }
    function validateNumber(value, name, min = void 0, max) {
      if (typeof value !== "number") throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      if (min != null && value < min || max != null && value > max || (min != null || max != null) && NumberIsNaN(value)) {
        throw new ERR_OUT_OF_RANGE(
          name,
          `${min != null ? `>= ${min}` : ""}${min != null && max != null ? " && " : ""}${max != null ? `<= ${max}` : ""}`,
          value
        );
      }
    }
    var validateOneOf = hideStackFrames((value, name, oneOf) => {
      if (!ArrayPrototypeIncludes(oneOf, value)) {
        const allowed = ArrayPrototypeJoin(
          ArrayPrototypeMap(oneOf, (v) => typeof v === "string" ? `'${v}'` : String2(v)),
          ", "
        );
        const reason = "must be one of: " + allowed;
        throw new ERR_INVALID_ARG_VALUE(name, value, reason);
      }
    });
    function validateBoolean(value, name) {
      if (typeof value !== "boolean") throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
    }
    function getOwnPropertyValueOrDefault(options, key, defaultValue) {
      return options == null || !ObjectPrototypeHasOwnProperty(options, key) ? defaultValue : options[key];
    }
    var validateObject = hideStackFrames((value, name, options = null) => {
      const allowArray = getOwnPropertyValueOrDefault(options, "allowArray", false);
      const allowFunction = getOwnPropertyValueOrDefault(options, "allowFunction", false);
      const nullable = getOwnPropertyValueOrDefault(options, "nullable", false);
      if (!nullable && value === null || !allowArray && ArrayIsArray(value) || typeof value !== "object" && (!allowFunction || typeof value !== "function")) {
        throw new ERR_INVALID_ARG_TYPE(name, "Object", value);
      }
    });
    var validateDictionary = hideStackFrames((value, name) => {
      if (value != null && typeof value !== "object" && typeof value !== "function") {
        throw new ERR_INVALID_ARG_TYPE(name, "a dictionary", value);
      }
    });
    var validateArray = hideStackFrames((value, name, minLength = 0) => {
      if (!ArrayIsArray(value)) {
        throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
      }
      if (value.length < minLength) {
        const reason = `must be longer than ${minLength}`;
        throw new ERR_INVALID_ARG_VALUE(name, value, reason);
      }
    });
    function validateStringArray(value, name) {
      validateArray(value, name);
      for (let i = 0; i < value.length; i++) {
        validateString(value[i], `${name}[${i}]`);
      }
    }
    function validateBooleanArray(value, name) {
      validateArray(value, name);
      for (let i = 0; i < value.length; i++) {
        validateBoolean(value[i], `${name}[${i}]`);
      }
    }
    function validateAbortSignalArray(value, name) {
      validateArray(value, name);
      for (let i = 0; i < value.length; i++) {
        const signal = value[i];
        const indexedName = `${name}[${i}]`;
        if (signal == null) {
          throw new ERR_INVALID_ARG_TYPE(indexedName, "AbortSignal", signal);
        }
        validateAbortSignal(signal, indexedName);
      }
    }
    function validateSignalName(signal, name = "signal") {
      validateString(signal, name);
      if (signals[signal] === void 0) {
        if (signals[StringPrototypeToUpperCase(signal)] !== void 0) {
          throw new ERR_UNKNOWN_SIGNAL(signal + " (signals must use all capital letters)");
        }
        throw new ERR_UNKNOWN_SIGNAL(signal);
      }
    }
    var validateBuffer = hideStackFrames((buffer, name = "buffer") => {
      if (!isArrayBufferView(buffer)) {
        throw new ERR_INVALID_ARG_TYPE(name, ["Buffer", "TypedArray", "DataView"], buffer);
      }
    });
    function validateEncoding(data, encoding) {
      const normalizedEncoding = normalizeEncoding(encoding);
      const length = data.length;
      if (normalizedEncoding === "hex" && length % 2 !== 0) {
        throw new ERR_INVALID_ARG_VALUE("encoding", encoding, `is invalid for data of length ${length}`);
      }
    }
    function validatePort(port, name = "Port", allowZero = true) {
      if (typeof port !== "number" && typeof port !== "string" || typeof port === "string" && StringPrototypeTrim(port).length === 0 || +port !== +port >>> 0 || port > 65535 || port === 0 && !allowZero) {
        throw new ERR_SOCKET_BAD_PORT(name, port, allowZero);
      }
      return port | 0;
    }
    var validateAbortSignal = hideStackFrames((signal, name) => {
      if (signal !== void 0 && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
      }
    });
    var validateFunction = hideStackFrames((value, name) => {
      if (typeof value !== "function") throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
    });
    var validatePlainFunction = hideStackFrames((value, name) => {
      if (typeof value !== "function" || isAsyncFunction(value)) throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
    });
    var validateUndefined = hideStackFrames((value, name) => {
      if (value !== void 0) throw new ERR_INVALID_ARG_TYPE(name, "undefined", value);
    });
    function validateUnion(value, name, union) {
      if (!ArrayPrototypeIncludes(union, value)) {
        throw new ERR_INVALID_ARG_TYPE(name, `('${ArrayPrototypeJoin(union, "|")}')`, value);
      }
    }
    var linkValueRegExp = /^(?:<[^>]*>)(?:\s*;\s*[^;"\s]+(?:=(")?[^;"\s]*\1)?)*$/;
    function validateLinkHeaderFormat(value, name) {
      if (typeof value === "undefined" || !RegExpPrototypeExec(linkValueRegExp, value)) {
        throw new ERR_INVALID_ARG_VALUE(
          name,
          value,
          'must be an array or string of format "</styles.css>; rel=preload; as=style"'
        );
      }
    }
    function validateLinkHeaderValue(hints) {
      if (typeof hints === "string") {
        validateLinkHeaderFormat(hints, "hints");
        return hints;
      } else if (ArrayIsArray(hints)) {
        const hintsLength = hints.length;
        let result = "";
        if (hintsLength === 0) {
          return result;
        }
        for (let i = 0; i < hintsLength; i++) {
          const link = hints[i];
          validateLinkHeaderFormat(link, "hints");
          result += link;
          if (i !== hintsLength - 1) {
            result += ", ";
          }
        }
        return result;
      }
      throw new ERR_INVALID_ARG_VALUE(
        "hints",
        hints,
        'must be an array or string of format "</styles.css>; rel=preload; as=style"'
      );
    }
    module.exports = {
      isInt32,
      isUint32,
      parseFileMode,
      validateArray,
      validateStringArray,
      validateBooleanArray,
      validateAbortSignalArray,
      validateBoolean,
      validateBuffer,
      validateDictionary,
      validateEncoding,
      validateFunction,
      validateInt32,
      validateInteger,
      validateNumber,
      validateObject,
      validateOneOf,
      validatePlainFunction,
      validatePort,
      validateSignalName,
      validateString,
      validateUint32,
      validateUndefined,
      validateUnion,
      validateAbortSignal,
      validateLinkHeaderValue
    };
  }
});

// node_modules/process/browser.js
var require_browser2 = __commonJS({
  "node_modules/process/browser.js"(exports, module) {
    var process = module.exports = {};
    var cachedSetTimeout;
    var cachedClearTimeout;
    function defaultSetTimout() {
      throw new Error("setTimeout has not been defined");
    }
    function defaultClearTimeout() {
      throw new Error("clearTimeout has not been defined");
    }
    (function() {
      try {
        if (typeof setTimeout === "function") {
          cachedSetTimeout = setTimeout;
        } else {
          cachedSetTimeout = defaultSetTimout;
        }
      } catch (e) {
        cachedSetTimeout = defaultSetTimout;
      }
      try {
        if (typeof clearTimeout === "function") {
          cachedClearTimeout = clearTimeout;
        } else {
          cachedClearTimeout = defaultClearTimeout;
        }
      } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
      }
    })();
    function runTimeout(fun) {
      if (cachedSetTimeout === setTimeout) {
        return setTimeout(fun, 0);
      }
      if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
      }
      try {
        return cachedSetTimeout(fun, 0);
      } catch (e) {
        try {
          return cachedSetTimeout.call(null, fun, 0);
        } catch (e2) {
          return cachedSetTimeout.call(this, fun, 0);
        }
      }
    }
    function runClearTimeout(marker) {
      if (cachedClearTimeout === clearTimeout) {
        return clearTimeout(marker);
      }
      if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
      }
      try {
        return cachedClearTimeout(marker);
      } catch (e) {
        try {
          return cachedClearTimeout.call(null, marker);
        } catch (e2) {
          return cachedClearTimeout.call(this, marker);
        }
      }
    }
    var queue = [];
    var draining = false;
    var currentQueue;
    var queueIndex = -1;
    function cleanUpNextTick() {
      if (!draining || !currentQueue) {
        return;
      }
      draining = false;
      if (currentQueue.length) {
        queue = currentQueue.concat(queue);
      } else {
        queueIndex = -1;
      }
      if (queue.length) {
        drainQueue();
      }
    }
    function drainQueue() {
      if (draining) {
        return;
      }
      var timeout = runTimeout(cleanUpNextTick);
      draining = true;
      var len = queue.length;
      while (len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
          if (currentQueue) {
            currentQueue[queueIndex].run();
          }
        }
        queueIndex = -1;
        len = queue.length;
      }
      currentQueue = null;
      draining = false;
      runClearTimeout(timeout);
    }
    process.nextTick = function(fun) {
      var args = new Array(arguments.length - 1);
      if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
          args[i - 1] = arguments[i];
        }
      }
      queue.push(new Item(fun, args));
      if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
      }
    };
    function Item(fun, array) {
      this.fun = fun;
      this.array = array;
    }
    Item.prototype.run = function() {
      this.fun.apply(null, this.array);
    };
    process.title = "browser";
    process.browser = true;
    process.env = {};
    process.argv = [];
    process.version = "";
    process.versions = {};
    function noop2() {
    }
    process.on = noop2;
    process.addListener = noop2;
    process.once = noop2;
    process.off = noop2;
    process.removeListener = noop2;
    process.removeAllListeners = noop2;
    process.emit = noop2;
    process.prependListener = noop2;
    process.prependOnceListener = noop2;
    process.listeners = function(name) {
      return [];
    };
    process.binding = function(name) {
      throw new Error("process.binding is not supported");
    };
    process.cwd = function() {
      return "/";
    };
    process.chdir = function(dir) {
      throw new Error("process.chdir is not supported");
    };
    process.umask = function() {
      return 0;
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/utils.js
var require_utils = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/utils.js"(exports, module) {
    "use strict";
    var { SymbolAsyncIterator, SymbolIterator, SymbolFor } = require_primordials();
    var kIsDestroyed = SymbolFor("nodejs.stream.destroyed");
    var kIsErrored = SymbolFor("nodejs.stream.errored");
    var kIsReadable = SymbolFor("nodejs.stream.readable");
    var kIsWritable = SymbolFor("nodejs.stream.writable");
    var kIsDisturbed = SymbolFor("nodejs.stream.disturbed");
    var kIsClosedPromise = SymbolFor("nodejs.webstream.isClosedPromise");
    var kControllerErrorFunction = SymbolFor("nodejs.webstream.controllerErrorFunction");
    function isReadableNodeStream(obj, strict = false) {
      var _obj$_readableState;
      return !!(obj && typeof obj.pipe === "function" && typeof obj.on === "function" && (!strict || typeof obj.pause === "function" && typeof obj.resume === "function") && (!obj._writableState || ((_obj$_readableState = obj._readableState) === null || _obj$_readableState === void 0 ? void 0 : _obj$_readableState.readable) !== false) && // Duplex
      (!obj._writableState || obj._readableState));
    }
    function isWritableNodeStream(obj) {
      var _obj$_writableState;
      return !!(obj && typeof obj.write === "function" && typeof obj.on === "function" && (!obj._readableState || ((_obj$_writableState = obj._writableState) === null || _obj$_writableState === void 0 ? void 0 : _obj$_writableState.writable) !== false));
    }
    function isDuplexNodeStream(obj) {
      return !!(obj && typeof obj.pipe === "function" && obj._readableState && typeof obj.on === "function" && typeof obj.write === "function");
    }
    function isNodeStream(obj) {
      return obj && (obj._readableState || obj._writableState || typeof obj.write === "function" && typeof obj.on === "function" || typeof obj.pipe === "function" && typeof obj.on === "function");
    }
    function isReadableStream(obj) {
      return !!(obj && !isNodeStream(obj) && typeof obj.pipeThrough === "function" && typeof obj.getReader === "function" && typeof obj.cancel === "function");
    }
    function isWritableStream(obj) {
      return !!(obj && !isNodeStream(obj) && typeof obj.getWriter === "function" && typeof obj.abort === "function");
    }
    function isTransformStream(obj) {
      return !!(obj && !isNodeStream(obj) && typeof obj.readable === "object" && typeof obj.writable === "object");
    }
    function isWebStream(obj) {
      return isReadableStream(obj) || isWritableStream(obj) || isTransformStream(obj);
    }
    function isIterable(obj, isAsync) {
      if (obj == null) return false;
      if (isAsync === true) return typeof obj[SymbolAsyncIterator] === "function";
      if (isAsync === false) return typeof obj[SymbolIterator] === "function";
      return typeof obj[SymbolAsyncIterator] === "function" || typeof obj[SymbolIterator] === "function";
    }
    function isDestroyed(stream) {
      if (!isNodeStream(stream)) return null;
      const wState = stream._writableState;
      const rState = stream._readableState;
      const state = wState || rState;
      return !!(stream.destroyed || stream[kIsDestroyed] || state !== null && state !== void 0 && state.destroyed);
    }
    function isWritableEnded(stream) {
      if (!isWritableNodeStream(stream)) return null;
      if (stream.writableEnded === true) return true;
      const wState = stream._writableState;
      if (wState !== null && wState !== void 0 && wState.errored) return false;
      if (typeof (wState === null || wState === void 0 ? void 0 : wState.ended) !== "boolean") return null;
      return wState.ended;
    }
    function isWritableFinished(stream, strict) {
      if (!isWritableNodeStream(stream)) return null;
      if (stream.writableFinished === true) return true;
      const wState = stream._writableState;
      if (wState !== null && wState !== void 0 && wState.errored) return false;
      if (typeof (wState === null || wState === void 0 ? void 0 : wState.finished) !== "boolean") return null;
      return !!(wState.finished || strict === false && wState.ended === true && wState.length === 0);
    }
    function isReadableEnded(stream) {
      if (!isReadableNodeStream(stream)) return null;
      if (stream.readableEnded === true) return true;
      const rState = stream._readableState;
      if (!rState || rState.errored) return false;
      if (typeof (rState === null || rState === void 0 ? void 0 : rState.ended) !== "boolean") return null;
      return rState.ended;
    }
    function isReadableFinished(stream, strict) {
      if (!isReadableNodeStream(stream)) return null;
      const rState = stream._readableState;
      if (rState !== null && rState !== void 0 && rState.errored) return false;
      if (typeof (rState === null || rState === void 0 ? void 0 : rState.endEmitted) !== "boolean") return null;
      return !!(rState.endEmitted || strict === false && rState.ended === true && rState.length === 0);
    }
    function isReadable(stream) {
      if (stream && stream[kIsReadable] != null) return stream[kIsReadable];
      if (typeof (stream === null || stream === void 0 ? void 0 : stream.readable) !== "boolean") return null;
      if (isDestroyed(stream)) return false;
      return isReadableNodeStream(stream) && stream.readable && !isReadableFinished(stream);
    }
    function isWritable(stream) {
      if (stream && stream[kIsWritable] != null) return stream[kIsWritable];
      if (typeof (stream === null || stream === void 0 ? void 0 : stream.writable) !== "boolean") return null;
      if (isDestroyed(stream)) return false;
      return isWritableNodeStream(stream) && stream.writable && !isWritableEnded(stream);
    }
    function isFinished(stream, opts) {
      if (!isNodeStream(stream)) {
        return null;
      }
      if (isDestroyed(stream)) {
        return true;
      }
      if ((opts === null || opts === void 0 ? void 0 : opts.readable) !== false && isReadable(stream)) {
        return false;
      }
      if ((opts === null || opts === void 0 ? void 0 : opts.writable) !== false && isWritable(stream)) {
        return false;
      }
      return true;
    }
    function isWritableErrored(stream) {
      var _stream$_writableStat, _stream$_writableStat2;
      if (!isNodeStream(stream)) {
        return null;
      }
      if (stream.writableErrored) {
        return stream.writableErrored;
      }
      return (_stream$_writableStat = (_stream$_writableStat2 = stream._writableState) === null || _stream$_writableStat2 === void 0 ? void 0 : _stream$_writableStat2.errored) !== null && _stream$_writableStat !== void 0 ? _stream$_writableStat : null;
    }
    function isReadableErrored(stream) {
      var _stream$_readableStat, _stream$_readableStat2;
      if (!isNodeStream(stream)) {
        return null;
      }
      if (stream.readableErrored) {
        return stream.readableErrored;
      }
      return (_stream$_readableStat = (_stream$_readableStat2 = stream._readableState) === null || _stream$_readableStat2 === void 0 ? void 0 : _stream$_readableStat2.errored) !== null && _stream$_readableStat !== void 0 ? _stream$_readableStat : null;
    }
    function isClosed(stream) {
      if (!isNodeStream(stream)) {
        return null;
      }
      if (typeof stream.closed === "boolean") {
        return stream.closed;
      }
      const wState = stream._writableState;
      const rState = stream._readableState;
      if (typeof (wState === null || wState === void 0 ? void 0 : wState.closed) === "boolean" || typeof (rState === null || rState === void 0 ? void 0 : rState.closed) === "boolean") {
        return (wState === null || wState === void 0 ? void 0 : wState.closed) || (rState === null || rState === void 0 ? void 0 : rState.closed);
      }
      if (typeof stream._closed === "boolean" && isOutgoingMessage(stream)) {
        return stream._closed;
      }
      return null;
    }
    function isOutgoingMessage(stream) {
      return typeof stream._closed === "boolean" && typeof stream._defaultKeepAlive === "boolean" && typeof stream._removedConnection === "boolean" && typeof stream._removedContLen === "boolean";
    }
    function isServerResponse(stream) {
      return typeof stream._sent100 === "boolean" && isOutgoingMessage(stream);
    }
    function isServerRequest(stream) {
      var _stream$req;
      return typeof stream._consuming === "boolean" && typeof stream._dumped === "boolean" && ((_stream$req = stream.req) === null || _stream$req === void 0 ? void 0 : _stream$req.upgradeOrConnect) === void 0;
    }
    function willEmitClose(stream) {
      if (!isNodeStream(stream)) return null;
      const wState = stream._writableState;
      const rState = stream._readableState;
      const state = wState || rState;
      return !state && isServerResponse(stream) || !!(state && state.autoDestroy && state.emitClose && state.closed === false);
    }
    function isDisturbed(stream) {
      var _stream$kIsDisturbed;
      return !!(stream && ((_stream$kIsDisturbed = stream[kIsDisturbed]) !== null && _stream$kIsDisturbed !== void 0 ? _stream$kIsDisturbed : stream.readableDidRead || stream.readableAborted));
    }
    function isErrored(stream) {
      var _ref, _ref2, _ref3, _ref4, _ref5, _stream$kIsErrored, _stream$_readableStat3, _stream$_writableStat3, _stream$_readableStat4, _stream$_writableStat4;
      return !!(stream && ((_ref = (_ref2 = (_ref3 = (_ref4 = (_ref5 = (_stream$kIsErrored = stream[kIsErrored]) !== null && _stream$kIsErrored !== void 0 ? _stream$kIsErrored : stream.readableErrored) !== null && _ref5 !== void 0 ? _ref5 : stream.writableErrored) !== null && _ref4 !== void 0 ? _ref4 : (_stream$_readableStat3 = stream._readableState) === null || _stream$_readableStat3 === void 0 ? void 0 : _stream$_readableStat3.errorEmitted) !== null && _ref3 !== void 0 ? _ref3 : (_stream$_writableStat3 = stream._writableState) === null || _stream$_writableStat3 === void 0 ? void 0 : _stream$_writableStat3.errorEmitted) !== null && _ref2 !== void 0 ? _ref2 : (_stream$_readableStat4 = stream._readableState) === null || _stream$_readableStat4 === void 0 ? void 0 : _stream$_readableStat4.errored) !== null && _ref !== void 0 ? _ref : (_stream$_writableStat4 = stream._writableState) === null || _stream$_writableStat4 === void 0 ? void 0 : _stream$_writableStat4.errored));
    }
    module.exports = {
      isDestroyed,
      kIsDestroyed,
      isDisturbed,
      kIsDisturbed,
      isErrored,
      kIsErrored,
      isReadable,
      kIsReadable,
      kIsClosedPromise,
      kControllerErrorFunction,
      kIsWritable,
      isClosed,
      isDuplexNodeStream,
      isFinished,
      isIterable,
      isReadableNodeStream,
      isReadableStream,
      isReadableEnded,
      isReadableFinished,
      isReadableErrored,
      isNodeStream,
      isWebStream,
      isWritable,
      isWritableNodeStream,
      isWritableStream,
      isWritableEnded,
      isWritableFinished,
      isWritableErrored,
      isServerRequest,
      isServerResponse,
      willEmitClose,
      isTransformStream
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/end-of-stream.js
var require_end_of_stream = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/end-of-stream.js"(exports, module) {
    "use strict";
    var process = require_browser2();
    var { AbortError, codes } = require_errors();
    var { ERR_INVALID_ARG_TYPE, ERR_STREAM_PREMATURE_CLOSE } = codes;
    var { kEmptyObject, once } = require_util();
    var { validateAbortSignal, validateFunction, validateObject, validateBoolean } = require_validators();
    var { Promise: Promise2, PromisePrototypeThen, SymbolDispose } = require_primordials();
    var {
      isClosed,
      isReadable,
      isReadableNodeStream,
      isReadableStream,
      isReadableFinished,
      isReadableErrored,
      isWritable,
      isWritableNodeStream,
      isWritableStream,
      isWritableFinished,
      isWritableErrored,
      isNodeStream,
      willEmitClose: _willEmitClose,
      kIsClosedPromise
    } = require_utils();
    var addAbortListener;
    function isRequest(stream) {
      return stream.setHeader && typeof stream.abort === "function";
    }
    var nop = () => {
    };
    function eos(stream, options, callback) {
      var _options$readable, _options$writable;
      if (arguments.length === 2) {
        callback = options;
        options = kEmptyObject;
      } else if (options == null) {
        options = kEmptyObject;
      } else {
        validateObject(options, "options");
      }
      validateFunction(callback, "callback");
      validateAbortSignal(options.signal, "options.signal");
      callback = once(callback);
      if (isReadableStream(stream) || isWritableStream(stream)) {
        return eosWeb(stream, options, callback);
      }
      if (!isNodeStream(stream)) {
        throw new ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
      }
      const readable = (_options$readable = options.readable) !== null && _options$readable !== void 0 ? _options$readable : isReadableNodeStream(stream);
      const writable = (_options$writable = options.writable) !== null && _options$writable !== void 0 ? _options$writable : isWritableNodeStream(stream);
      const wState = stream._writableState;
      const rState = stream._readableState;
      const onlegacyfinish = () => {
        if (!stream.writable) {
          onfinish();
        }
      };
      let willEmitClose = _willEmitClose(stream) && isReadableNodeStream(stream) === readable && isWritableNodeStream(stream) === writable;
      let writableFinished = isWritableFinished(stream, false);
      const onfinish = () => {
        writableFinished = true;
        if (stream.destroyed) {
          willEmitClose = false;
        }
        if (willEmitClose && (!stream.readable || readable)) {
          return;
        }
        if (!readable || readableFinished) {
          callback.call(stream);
        }
      };
      let readableFinished = isReadableFinished(stream, false);
      const onend = () => {
        readableFinished = true;
        if (stream.destroyed) {
          willEmitClose = false;
        }
        if (willEmitClose && (!stream.writable || writable)) {
          return;
        }
        if (!writable || writableFinished) {
          callback.call(stream);
        }
      };
      const onerror = (err) => {
        callback.call(stream, err);
      };
      let closed = isClosed(stream);
      const onclose = () => {
        closed = true;
        const errored = isWritableErrored(stream) || isReadableErrored(stream);
        if (errored && typeof errored !== "boolean") {
          return callback.call(stream, errored);
        }
        if (readable && !readableFinished && isReadableNodeStream(stream, true)) {
          if (!isReadableFinished(stream, false)) return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
        }
        if (writable && !writableFinished) {
          if (!isWritableFinished(stream, false)) return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
        }
        callback.call(stream);
      };
      const onclosed = () => {
        closed = true;
        const errored = isWritableErrored(stream) || isReadableErrored(stream);
        if (errored && typeof errored !== "boolean") {
          return callback.call(stream, errored);
        }
        callback.call(stream);
      };
      const onrequest = () => {
        stream.req.on("finish", onfinish);
      };
      if (isRequest(stream)) {
        stream.on("complete", onfinish);
        if (!willEmitClose) {
          stream.on("abort", onclose);
        }
        if (stream.req) {
          onrequest();
        } else {
          stream.on("request", onrequest);
        }
      } else if (writable && !wState) {
        stream.on("end", onlegacyfinish);
        stream.on("close", onlegacyfinish);
      }
      if (!willEmitClose && typeof stream.aborted === "boolean") {
        stream.on("aborted", onclose);
      }
      stream.on("end", onend);
      stream.on("finish", onfinish);
      if (options.error !== false) {
        stream.on("error", onerror);
      }
      stream.on("close", onclose);
      if (closed) {
        process.nextTick(onclose);
      } else if (wState !== null && wState !== void 0 && wState.errorEmitted || rState !== null && rState !== void 0 && rState.errorEmitted) {
        if (!willEmitClose) {
          process.nextTick(onclosed);
        }
      } else if (!readable && (!willEmitClose || isReadable(stream)) && (writableFinished || isWritable(stream) === false)) {
        process.nextTick(onclosed);
      } else if (!writable && (!willEmitClose || isWritable(stream)) && (readableFinished || isReadable(stream) === false)) {
        process.nextTick(onclosed);
      } else if (rState && stream.req && stream.aborted) {
        process.nextTick(onclosed);
      }
      const cleanup = () => {
        callback = nop;
        stream.removeListener("aborted", onclose);
        stream.removeListener("complete", onfinish);
        stream.removeListener("abort", onclose);
        stream.removeListener("request", onrequest);
        if (stream.req) stream.req.removeListener("finish", onfinish);
        stream.removeListener("end", onlegacyfinish);
        stream.removeListener("close", onlegacyfinish);
        stream.removeListener("finish", onfinish);
        stream.removeListener("end", onend);
        stream.removeListener("error", onerror);
        stream.removeListener("close", onclose);
      };
      if (options.signal && !closed) {
        const abort = () => {
          const endCallback = callback;
          cleanup();
          endCallback.call(
            stream,
            new AbortError(void 0, {
              cause: options.signal.reason
            })
          );
        };
        if (options.signal.aborted) {
          process.nextTick(abort);
        } else {
          addAbortListener = addAbortListener || require_util().addAbortListener;
          const disposable = addAbortListener(options.signal, abort);
          const originalCallback = callback;
          callback = once((...args) => {
            disposable[SymbolDispose]();
            originalCallback.apply(stream, args);
          });
        }
      }
      return cleanup;
    }
    function eosWeb(stream, options, callback) {
      let isAborted = false;
      let abort = nop;
      if (options.signal) {
        abort = () => {
          isAborted = true;
          callback.call(
            stream,
            new AbortError(void 0, {
              cause: options.signal.reason
            })
          );
        };
        if (options.signal.aborted) {
          process.nextTick(abort);
        } else {
          addAbortListener = addAbortListener || require_util().addAbortListener;
          const disposable = addAbortListener(options.signal, abort);
          const originalCallback = callback;
          callback = once((...args) => {
            disposable[SymbolDispose]();
            originalCallback.apply(stream, args);
          });
        }
      }
      const resolverFn = (...args) => {
        if (!isAborted) {
          process.nextTick(() => callback.apply(stream, args));
        }
      };
      PromisePrototypeThen(stream[kIsClosedPromise].promise, resolverFn, resolverFn);
      return nop;
    }
    function finished(stream, opts) {
      var _opts;
      let autoCleanup = false;
      if (opts === null) {
        opts = kEmptyObject;
      }
      if ((_opts = opts) !== null && _opts !== void 0 && _opts.cleanup) {
        validateBoolean(opts.cleanup, "cleanup");
        autoCleanup = opts.cleanup;
      }
      return new Promise2((resolve, reject) => {
        const cleanup = eos(stream, opts, (err) => {
          if (autoCleanup) {
            cleanup();
          }
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
    module.exports = eos;
    module.exports.finished = finished;
  }
});

// node_modules/readable-stream/lib/internal/streams/destroy.js
var require_destroy = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/destroy.js"(exports, module) {
    "use strict";
    var process = require_browser2();
    var {
      aggregateTwoErrors,
      codes: { ERR_MULTIPLE_CALLBACK },
      AbortError
    } = require_errors();
    var { Symbol: Symbol2 } = require_primordials();
    var { kIsDestroyed, isDestroyed, isFinished, isServerRequest } = require_utils();
    var kDestroy = Symbol2("kDestroy");
    var kConstruct = Symbol2("kConstruct");
    function checkError(err, w, r) {
      if (err) {
        err.stack;
        if (w && !w.errored) {
          w.errored = err;
        }
        if (r && !r.errored) {
          r.errored = err;
        }
      }
    }
    function destroy(err, cb) {
      const r = this._readableState;
      const w = this._writableState;
      const s = w || r;
      if (w !== null && w !== void 0 && w.destroyed || r !== null && r !== void 0 && r.destroyed) {
        if (typeof cb === "function") {
          cb();
        }
        return this;
      }
      checkError(err, w, r);
      if (w) {
        w.destroyed = true;
      }
      if (r) {
        r.destroyed = true;
      }
      if (!s.constructed) {
        this.once(kDestroy, function(er) {
          _destroy(this, aggregateTwoErrors(er, err), cb);
        });
      } else {
        _destroy(this, err, cb);
      }
      return this;
    }
    function _destroy(self2, err, cb) {
      let called = false;
      function onDestroy(err2) {
        if (called) {
          return;
        }
        called = true;
        const r = self2._readableState;
        const w = self2._writableState;
        checkError(err2, w, r);
        if (w) {
          w.closed = true;
        }
        if (r) {
          r.closed = true;
        }
        if (typeof cb === "function") {
          cb(err2);
        }
        if (err2) {
          process.nextTick(emitErrorCloseNT, self2, err2);
        } else {
          process.nextTick(emitCloseNT, self2);
        }
      }
      try {
        self2._destroy(err || null, onDestroy);
      } catch (err2) {
        onDestroy(err2);
      }
    }
    function emitErrorCloseNT(self2, err) {
      emitErrorNT(self2, err);
      emitCloseNT(self2);
    }
    function emitCloseNT(self2) {
      const r = self2._readableState;
      const w = self2._writableState;
      if (w) {
        w.closeEmitted = true;
      }
      if (r) {
        r.closeEmitted = true;
      }
      if (w !== null && w !== void 0 && w.emitClose || r !== null && r !== void 0 && r.emitClose) {
        self2.emit("close");
      }
    }
    function emitErrorNT(self2, err) {
      const r = self2._readableState;
      const w = self2._writableState;
      if (w !== null && w !== void 0 && w.errorEmitted || r !== null && r !== void 0 && r.errorEmitted) {
        return;
      }
      if (w) {
        w.errorEmitted = true;
      }
      if (r) {
        r.errorEmitted = true;
      }
      self2.emit("error", err);
    }
    function undestroy() {
      const r = this._readableState;
      const w = this._writableState;
      if (r) {
        r.constructed = true;
        r.closed = false;
        r.closeEmitted = false;
        r.destroyed = false;
        r.errored = null;
        r.errorEmitted = false;
        r.reading = false;
        r.ended = r.readable === false;
        r.endEmitted = r.readable === false;
      }
      if (w) {
        w.constructed = true;
        w.destroyed = false;
        w.closed = false;
        w.closeEmitted = false;
        w.errored = null;
        w.errorEmitted = false;
        w.finalCalled = false;
        w.prefinished = false;
        w.ended = w.writable === false;
        w.ending = w.writable === false;
        w.finished = w.writable === false;
      }
    }
    function errorOrDestroy(stream, err, sync) {
      const r = stream._readableState;
      const w = stream._writableState;
      if (w !== null && w !== void 0 && w.destroyed || r !== null && r !== void 0 && r.destroyed) {
        return this;
      }
      if (r !== null && r !== void 0 && r.autoDestroy || w !== null && w !== void 0 && w.autoDestroy)
        stream.destroy(err);
      else if (err) {
        err.stack;
        if (w && !w.errored) {
          w.errored = err;
        }
        if (r && !r.errored) {
          r.errored = err;
        }
        if (sync) {
          process.nextTick(emitErrorNT, stream, err);
        } else {
          emitErrorNT(stream, err);
        }
      }
    }
    function construct(stream, cb) {
      if (typeof stream._construct !== "function") {
        return;
      }
      const r = stream._readableState;
      const w = stream._writableState;
      if (r) {
        r.constructed = false;
      }
      if (w) {
        w.constructed = false;
      }
      stream.once(kConstruct, cb);
      if (stream.listenerCount(kConstruct) > 1) {
        return;
      }
      process.nextTick(constructNT, stream);
    }
    function constructNT(stream) {
      let called = false;
      function onConstruct(err) {
        if (called) {
          errorOrDestroy(stream, err !== null && err !== void 0 ? err : new ERR_MULTIPLE_CALLBACK());
          return;
        }
        called = true;
        const r = stream._readableState;
        const w = stream._writableState;
        const s = w || r;
        if (r) {
          r.constructed = true;
        }
        if (w) {
          w.constructed = true;
        }
        if (s.destroyed) {
          stream.emit(kDestroy, err);
        } else if (err) {
          errorOrDestroy(stream, err, true);
        } else {
          process.nextTick(emitConstructNT, stream);
        }
      }
      try {
        stream._construct((err) => {
          process.nextTick(onConstruct, err);
        });
      } catch (err) {
        process.nextTick(onConstruct, err);
      }
    }
    function emitConstructNT(stream) {
      stream.emit(kConstruct);
    }
    function isRequest(stream) {
      return (stream === null || stream === void 0 ? void 0 : stream.setHeader) && typeof stream.abort === "function";
    }
    function emitCloseLegacy(stream) {
      stream.emit("close");
    }
    function emitErrorCloseLegacy(stream, err) {
      stream.emit("error", err);
      process.nextTick(emitCloseLegacy, stream);
    }
    function destroyer(stream, err) {
      if (!stream || isDestroyed(stream)) {
        return;
      }
      if (!err && !isFinished(stream)) {
        err = new AbortError();
      }
      if (isServerRequest(stream)) {
        stream.socket = null;
        stream.destroy(err);
      } else if (isRequest(stream)) {
        stream.abort();
      } else if (isRequest(stream.req)) {
        stream.req.abort();
      } else if (typeof stream.destroy === "function") {
        stream.destroy(err);
      } else if (typeof stream.close === "function") {
        stream.close();
      } else if (err) {
        process.nextTick(emitErrorCloseLegacy, stream, err);
      } else {
        process.nextTick(emitCloseLegacy, stream);
      }
      if (!stream.destroyed) {
        stream[kIsDestroyed] = true;
      }
    }
    module.exports = {
      construct,
      destroyer,
      destroy,
      undestroy,
      errorOrDestroy
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/legacy.js
var require_legacy = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/legacy.js"(exports, module) {
    "use strict";
    var { ArrayIsArray, ObjectSetPrototypeOf } = require_primordials();
    var { EventEmitter: EE } = require_events();
    function Stream(opts) {
      EE.call(this, opts);
    }
    ObjectSetPrototypeOf(Stream.prototype, EE.prototype);
    ObjectSetPrototypeOf(Stream, EE);
    Stream.prototype.pipe = function(dest, options) {
      const source = this;
      function ondata(chunk) {
        if (dest.writable && dest.write(chunk) === false && source.pause) {
          source.pause();
        }
      }
      source.on("data", ondata);
      function ondrain() {
        if (source.readable && source.resume) {
          source.resume();
        }
      }
      dest.on("drain", ondrain);
      if (!dest._isStdio && (!options || options.end !== false)) {
        source.on("end", onend);
        source.on("close", onclose);
      }
      let didOnEnd = false;
      function onend() {
        if (didOnEnd) return;
        didOnEnd = true;
        dest.end();
      }
      function onclose() {
        if (didOnEnd) return;
        didOnEnd = true;
        if (typeof dest.destroy === "function") dest.destroy();
      }
      function onerror(er) {
        cleanup();
        if (EE.listenerCount(this, "error") === 0) {
          this.emit("error", er);
        }
      }
      prependListener(source, "error", onerror);
      prependListener(dest, "error", onerror);
      function cleanup() {
        source.removeListener("data", ondata);
        dest.removeListener("drain", ondrain);
        source.removeListener("end", onend);
        source.removeListener("close", onclose);
        source.removeListener("error", onerror);
        dest.removeListener("error", onerror);
        source.removeListener("end", cleanup);
        source.removeListener("close", cleanup);
        dest.removeListener("close", cleanup);
      }
      source.on("end", cleanup);
      source.on("close", cleanup);
      dest.on("close", cleanup);
      dest.emit("pipe", source);
      return dest;
    };
    function prependListener(emitter, event, fn) {
      if (typeof emitter.prependListener === "function") return emitter.prependListener(event, fn);
      if (!emitter._events || !emitter._events[event]) emitter.on(event, fn);
      else if (ArrayIsArray(emitter._events[event])) emitter._events[event].unshift(fn);
      else emitter._events[event] = [fn, emitter._events[event]];
    }
    module.exports = {
      Stream,
      prependListener
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/add-abort-signal.js
var require_add_abort_signal = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/add-abort-signal.js"(exports, module) {
    "use strict";
    var { SymbolDispose } = require_primordials();
    var { AbortError, codes } = require_errors();
    var { isNodeStream, isWebStream, kControllerErrorFunction } = require_utils();
    var eos = require_end_of_stream();
    var { ERR_INVALID_ARG_TYPE } = codes;
    var addAbortListener;
    var validateAbortSignal = (signal, name) => {
      if (typeof signal !== "object" || !("aborted" in signal)) {
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
      }
    };
    module.exports.addAbortSignal = function addAbortSignal(signal, stream) {
      validateAbortSignal(signal, "signal");
      if (!isNodeStream(stream) && !isWebStream(stream)) {
        throw new ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
      }
      return module.exports.addAbortSignalNoValidate(signal, stream);
    };
    module.exports.addAbortSignalNoValidate = function(signal, stream) {
      if (typeof signal !== "object" || !("aborted" in signal)) {
        return stream;
      }
      const onAbort = isNodeStream(stream) ? () => {
        stream.destroy(
          new AbortError(void 0, {
            cause: signal.reason
          })
        );
      } : () => {
        stream[kControllerErrorFunction](
          new AbortError(void 0, {
            cause: signal.reason
          })
        );
      };
      if (signal.aborted) {
        onAbort();
      } else {
        addAbortListener = addAbortListener || require_util().addAbortListener;
        const disposable = addAbortListener(signal, onAbort);
        eos(stream, disposable[SymbolDispose]);
      }
      return stream;
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/buffer_list.js
var require_buffer_list = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/buffer_list.js"(exports, module) {
    "use strict";
    var { StringPrototypeSlice, SymbolIterator, TypedArrayPrototypeSet, Uint8Array: Uint8Array2 } = require_primordials();
    var { Buffer: Buffer3 } = require_buffer();
    var { inspect } = require_util();
    module.exports = class BufferList {
      constructor() {
        this.head = null;
        this.tail = null;
        this.length = 0;
      }
      push(v) {
        const entry = {
          data: v,
          next: null
        };
        if (this.length > 0) this.tail.next = entry;
        else this.head = entry;
        this.tail = entry;
        ++this.length;
      }
      unshift(v) {
        const entry = {
          data: v,
          next: this.head
        };
        if (this.length === 0) this.tail = entry;
        this.head = entry;
        ++this.length;
      }
      shift() {
        if (this.length === 0) return;
        const ret = this.head.data;
        if (this.length === 1) this.head = this.tail = null;
        else this.head = this.head.next;
        --this.length;
        return ret;
      }
      clear() {
        this.head = this.tail = null;
        this.length = 0;
      }
      join(s) {
        if (this.length === 0) return "";
        let p = this.head;
        let ret = "" + p.data;
        while ((p = p.next) !== null) ret += s + p.data;
        return ret;
      }
      concat(n) {
        if (this.length === 0) return Buffer3.alloc(0);
        const ret = Buffer3.allocUnsafe(n >>> 0);
        let p = this.head;
        let i = 0;
        while (p) {
          TypedArrayPrototypeSet(ret, p.data, i);
          i += p.data.length;
          p = p.next;
        }
        return ret;
      }
      // Consumes a specified amount of bytes or characters from the buffered data.
      consume(n, hasStrings) {
        const data = this.head.data;
        if (n < data.length) {
          const slice = data.slice(0, n);
          this.head.data = data.slice(n);
          return slice;
        }
        if (n === data.length) {
          return this.shift();
        }
        return hasStrings ? this._getString(n) : this._getBuffer(n);
      }
      first() {
        return this.head.data;
      }
      *[SymbolIterator]() {
        for (let p = this.head; p; p = p.next) {
          yield p.data;
        }
      }
      // Consumes a specified amount of characters from the buffered data.
      _getString(n) {
        let ret = "";
        let p = this.head;
        let c = 0;
        do {
          const str = p.data;
          if (n > str.length) {
            ret += str;
            n -= str.length;
          } else {
            if (n === str.length) {
              ret += str;
              ++c;
              if (p.next) this.head = p.next;
              else this.head = this.tail = null;
            } else {
              ret += StringPrototypeSlice(str, 0, n);
              this.head = p;
              p.data = StringPrototypeSlice(str, n);
            }
            break;
          }
          ++c;
        } while ((p = p.next) !== null);
        this.length -= c;
        return ret;
      }
      // Consumes a specified amount of bytes from the buffered data.
      _getBuffer(n) {
        const ret = Buffer3.allocUnsafe(n);
        const retLen = n;
        let p = this.head;
        let c = 0;
        do {
          const buf = p.data;
          if (n > buf.length) {
            TypedArrayPrototypeSet(ret, buf, retLen - n);
            n -= buf.length;
          } else {
            if (n === buf.length) {
              TypedArrayPrototypeSet(ret, buf, retLen - n);
              ++c;
              if (p.next) this.head = p.next;
              else this.head = this.tail = null;
            } else {
              TypedArrayPrototypeSet(ret, new Uint8Array2(buf.buffer, buf.byteOffset, n), retLen - n);
              this.head = p;
              p.data = buf.slice(n);
            }
            break;
          }
          ++c;
        } while ((p = p.next) !== null);
        this.length -= c;
        return ret;
      }
      // Make sure the linked list only shows the minimal necessary information.
      [Symbol.for("nodejs.util.inspect.custom")](_, options) {
        return inspect(this, {
          ...options,
          // Only inspect one level.
          depth: 0,
          // It should not recurse.
          customInspect: false
        });
      }
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/state.js
var require_state = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/state.js"(exports, module) {
    "use strict";
    var { MathFloor, NumberIsInteger } = require_primordials();
    var { validateInteger } = require_validators();
    var { ERR_INVALID_ARG_VALUE } = require_errors().codes;
    var defaultHighWaterMarkBytes = 16 * 1024;
    var defaultHighWaterMarkObjectMode = 16;
    function highWaterMarkFrom(options, isDuplex, duplexKey) {
      return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
    }
    function getDefaultHighWaterMark(objectMode) {
      return objectMode ? defaultHighWaterMarkObjectMode : defaultHighWaterMarkBytes;
    }
    function setDefaultHighWaterMark(objectMode, value) {
      validateInteger(value, "value", 0);
      if (objectMode) {
        defaultHighWaterMarkObjectMode = value;
      } else {
        defaultHighWaterMarkBytes = value;
      }
    }
    function getHighWaterMark(state, options, duplexKey, isDuplex) {
      const hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
      if (hwm != null) {
        if (!NumberIsInteger(hwm) || hwm < 0) {
          const name = isDuplex ? `options.${duplexKey}` : "options.highWaterMark";
          throw new ERR_INVALID_ARG_VALUE(name, hwm);
        }
        return MathFloor(hwm);
      }
      return getDefaultHighWaterMark(state.objectMode);
    }
    module.exports = {
      getHighWaterMark,
      getDefaultHighWaterMark,
      setDefaultHighWaterMark
    };
  }
});

// node_modules/safe-buffer/index.js
var require_safe_buffer = __commonJS({
  "node_modules/safe-buffer/index.js"(exports, module) {
    var buffer = require_buffer();
    var Buffer3 = buffer.Buffer;
    function copyProps(src, dst) {
      for (var key in src) {
        dst[key] = src[key];
      }
    }
    if (Buffer3.from && Buffer3.alloc && Buffer3.allocUnsafe && Buffer3.allocUnsafeSlow) {
      module.exports = buffer;
    } else {
      copyProps(buffer, exports);
      exports.Buffer = SafeBuffer;
    }
    function SafeBuffer(arg, encodingOrOffset, length) {
      return Buffer3(arg, encodingOrOffset, length);
    }
    SafeBuffer.prototype = Object.create(Buffer3.prototype);
    copyProps(Buffer3, SafeBuffer);
    SafeBuffer.from = function(arg, encodingOrOffset, length) {
      if (typeof arg === "number") {
        throw new TypeError("Argument must not be a number");
      }
      return Buffer3(arg, encodingOrOffset, length);
    };
    SafeBuffer.alloc = function(size, fill, encoding) {
      if (typeof size !== "number") {
        throw new TypeError("Argument must be a number");
      }
      var buf = Buffer3(size);
      if (fill !== void 0) {
        if (typeof encoding === "string") {
          buf.fill(fill, encoding);
        } else {
          buf.fill(fill);
        }
      } else {
        buf.fill(0);
      }
      return buf;
    };
    SafeBuffer.allocUnsafe = function(size) {
      if (typeof size !== "number") {
        throw new TypeError("Argument must be a number");
      }
      return Buffer3(size);
    };
    SafeBuffer.allocUnsafeSlow = function(size) {
      if (typeof size !== "number") {
        throw new TypeError("Argument must be a number");
      }
      return buffer.SlowBuffer(size);
    };
  }
});

// node_modules/string_decoder/lib/string_decoder.js
var require_string_decoder = __commonJS({
  "node_modules/string_decoder/lib/string_decoder.js"(exports) {
    "use strict";
    var Buffer3 = require_safe_buffer().Buffer;
    var isEncoding = Buffer3.isEncoding || function(encoding) {
      encoding = "" + encoding;
      switch (encoding && encoding.toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
        case "raw":
          return true;
        default:
          return false;
      }
    };
    function _normalizeEncoding(enc) {
      if (!enc) return "utf8";
      var retried;
      while (true) {
        switch (enc) {
          case "utf8":
          case "utf-8":
            return "utf8";
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return "utf16le";
          case "latin1":
          case "binary":
            return "latin1";
          case "base64":
          case "ascii":
          case "hex":
            return enc;
          default:
            if (retried) return;
            enc = ("" + enc).toLowerCase();
            retried = true;
        }
      }
    }
    function normalizeEncoding(enc) {
      var nenc = _normalizeEncoding(enc);
      if (typeof nenc !== "string" && (Buffer3.isEncoding === isEncoding || !isEncoding(enc))) throw new Error("Unknown encoding: " + enc);
      return nenc || enc;
    }
    exports.StringDecoder = StringDecoder;
    function StringDecoder(encoding) {
      this.encoding = normalizeEncoding(encoding);
      var nb;
      switch (this.encoding) {
        case "utf16le":
          this.text = utf16Text;
          this.end = utf16End;
          nb = 4;
          break;
        case "utf8":
          this.fillLast = utf8FillLast;
          nb = 4;
          break;
        case "base64":
          this.text = base64Text;
          this.end = base64End;
          nb = 3;
          break;
        default:
          this.write = simpleWrite;
          this.end = simpleEnd;
          return;
      }
      this.lastNeed = 0;
      this.lastTotal = 0;
      this.lastChar = Buffer3.allocUnsafe(nb);
    }
    StringDecoder.prototype.write = function(buf) {
      if (buf.length === 0) return "";
      var r;
      var i;
      if (this.lastNeed) {
        r = this.fillLast(buf);
        if (r === void 0) return "";
        i = this.lastNeed;
        this.lastNeed = 0;
      } else {
        i = 0;
      }
      if (i < buf.length) return r ? r + this.text(buf, i) : this.text(buf, i);
      return r || "";
    };
    StringDecoder.prototype.end = utf8End;
    StringDecoder.prototype.text = utf8Text;
    StringDecoder.prototype.fillLast = function(buf) {
      if (this.lastNeed <= buf.length) {
        buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
        return this.lastChar.toString(this.encoding, 0, this.lastTotal);
      }
      buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
      this.lastNeed -= buf.length;
    };
    function utf8CheckByte(byte) {
      if (byte <= 127) return 0;
      else if (byte >> 5 === 6) return 2;
      else if (byte >> 4 === 14) return 3;
      else if (byte >> 3 === 30) return 4;
      return byte >> 6 === 2 ? -1 : -2;
    }
    function utf8CheckIncomplete(self2, buf, i) {
      var j = buf.length - 1;
      if (j < i) return 0;
      var nb = utf8CheckByte(buf[j]);
      if (nb >= 0) {
        if (nb > 0) self2.lastNeed = nb - 1;
        return nb;
      }
      if (--j < i || nb === -2) return 0;
      nb = utf8CheckByte(buf[j]);
      if (nb >= 0) {
        if (nb > 0) self2.lastNeed = nb - 2;
        return nb;
      }
      if (--j < i || nb === -2) return 0;
      nb = utf8CheckByte(buf[j]);
      if (nb >= 0) {
        if (nb > 0) {
          if (nb === 2) nb = 0;
          else self2.lastNeed = nb - 3;
        }
        return nb;
      }
      return 0;
    }
    function utf8CheckExtraBytes(self2, buf, p) {
      if ((buf[0] & 192) !== 128) {
        self2.lastNeed = 0;
        return "\uFFFD";
      }
      if (self2.lastNeed > 1 && buf.length > 1) {
        if ((buf[1] & 192) !== 128) {
          self2.lastNeed = 1;
          return "\uFFFD";
        }
        if (self2.lastNeed > 2 && buf.length > 2) {
          if ((buf[2] & 192) !== 128) {
            self2.lastNeed = 2;
            return "\uFFFD";
          }
        }
      }
    }
    function utf8FillLast(buf) {
      var p = this.lastTotal - this.lastNeed;
      var r = utf8CheckExtraBytes(this, buf, p);
      if (r !== void 0) return r;
      if (this.lastNeed <= buf.length) {
        buf.copy(this.lastChar, p, 0, this.lastNeed);
        return this.lastChar.toString(this.encoding, 0, this.lastTotal);
      }
      buf.copy(this.lastChar, p, 0, buf.length);
      this.lastNeed -= buf.length;
    }
    function utf8Text(buf, i) {
      var total = utf8CheckIncomplete(this, buf, i);
      if (!this.lastNeed) return buf.toString("utf8", i);
      this.lastTotal = total;
      var end = buf.length - (total - this.lastNeed);
      buf.copy(this.lastChar, 0, end);
      return buf.toString("utf8", i, end);
    }
    function utf8End(buf) {
      var r = buf && buf.length ? this.write(buf) : "";
      if (this.lastNeed) return r + "\uFFFD";
      return r;
    }
    function utf16Text(buf, i) {
      if ((buf.length - i) % 2 === 0) {
        var r = buf.toString("utf16le", i);
        if (r) {
          var c = r.charCodeAt(r.length - 1);
          if (c >= 55296 && c <= 56319) {
            this.lastNeed = 2;
            this.lastTotal = 4;
            this.lastChar[0] = buf[buf.length - 2];
            this.lastChar[1] = buf[buf.length - 1];
            return r.slice(0, -1);
          }
        }
        return r;
      }
      this.lastNeed = 1;
      this.lastTotal = 2;
      this.lastChar[0] = buf[buf.length - 1];
      return buf.toString("utf16le", i, buf.length - 1);
    }
    function utf16End(buf) {
      var r = buf && buf.length ? this.write(buf) : "";
      if (this.lastNeed) {
        var end = this.lastTotal - this.lastNeed;
        return r + this.lastChar.toString("utf16le", 0, end);
      }
      return r;
    }
    function base64Text(buf, i) {
      var n = (buf.length - i) % 3;
      if (n === 0) return buf.toString("base64", i);
      this.lastNeed = 3 - n;
      this.lastTotal = 3;
      if (n === 1) {
        this.lastChar[0] = buf[buf.length - 1];
      } else {
        this.lastChar[0] = buf[buf.length - 2];
        this.lastChar[1] = buf[buf.length - 1];
      }
      return buf.toString("base64", i, buf.length - n);
    }
    function base64End(buf) {
      var r = buf && buf.length ? this.write(buf) : "";
      if (this.lastNeed) return r + this.lastChar.toString("base64", 0, 3 - this.lastNeed);
      return r;
    }
    function simpleWrite(buf) {
      return buf.toString(this.encoding);
    }
    function simpleEnd(buf) {
      return buf && buf.length ? this.write(buf) : "";
    }
  }
});

// node_modules/readable-stream/lib/internal/streams/from.js
var require_from = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/from.js"(exports, module) {
    "use strict";
    var process = require_browser2();
    var { PromisePrototypeThen, SymbolAsyncIterator, SymbolIterator } = require_primordials();
    var { Buffer: Buffer3 } = require_buffer();
    var { ERR_INVALID_ARG_TYPE, ERR_STREAM_NULL_VALUES } = require_errors().codes;
    function from(Readable, iterable, opts) {
      let iterator;
      if (typeof iterable === "string" || iterable instanceof Buffer3) {
        return new Readable({
          objectMode: true,
          ...opts,
          read() {
            this.push(iterable);
            this.push(null);
          }
        });
      }
      let isAsync;
      if (iterable && iterable[SymbolAsyncIterator]) {
        isAsync = true;
        iterator = iterable[SymbolAsyncIterator]();
      } else if (iterable && iterable[SymbolIterator]) {
        isAsync = false;
        iterator = iterable[SymbolIterator]();
      } else {
        throw new ERR_INVALID_ARG_TYPE("iterable", ["Iterable"], iterable);
      }
      const readable = new Readable({
        objectMode: true,
        highWaterMark: 1,
        // TODO(ronag): What options should be allowed?
        ...opts
      });
      let reading = false;
      readable._read = function() {
        if (!reading) {
          reading = true;
          next();
        }
      };
      readable._destroy = function(error, cb) {
        PromisePrototypeThen(
          close(error),
          () => process.nextTick(cb, error),
          // nextTick is here in case cb throws
          (e) => process.nextTick(cb, e || error)
        );
      };
      async function close(error) {
        const hadError = error !== void 0 && error !== null;
        const hasThrow = typeof iterator.throw === "function";
        if (hadError && hasThrow) {
          const { value, done } = await iterator.throw(error);
          await value;
          if (done) {
            return;
          }
        }
        if (typeof iterator.return === "function") {
          const { value } = await iterator.return();
          await value;
        }
      }
      async function next() {
        for (; ; ) {
          try {
            const { value, done } = isAsync ? await iterator.next() : iterator.next();
            if (done) {
              readable.push(null);
            } else {
              const res = value && typeof value.then === "function" ? await value : value;
              if (res === null) {
                reading = false;
                throw new ERR_STREAM_NULL_VALUES();
              } else if (readable.push(res)) {
                continue;
              } else {
                reading = false;
              }
            }
          } catch (err) {
            readable.destroy(err);
          }
          break;
        }
      }
      return readable;
    }
    module.exports = from;
  }
});

// node_modules/readable-stream/lib/internal/streams/readable.js
var require_readable = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/readable.js"(exports, module) {
    "use strict";
    var process = require_browser2();
    var {
      ArrayPrototypeIndexOf,
      NumberIsInteger,
      NumberIsNaN,
      NumberParseInt,
      ObjectDefineProperties,
      ObjectKeys,
      ObjectSetPrototypeOf,
      Promise: Promise2,
      SafeSet,
      SymbolAsyncDispose,
      SymbolAsyncIterator,
      Symbol: Symbol2
    } = require_primordials();
    module.exports = Readable;
    Readable.ReadableState = ReadableState;
    var { EventEmitter: EE } = require_events();
    var { Stream, prependListener } = require_legacy();
    var { Buffer: Buffer3 } = require_buffer();
    var { addAbortSignal } = require_add_abort_signal();
    var eos = require_end_of_stream();
    var debug = require_util().debuglog("stream", (fn) => {
      debug = fn;
    });
    var BufferList = require_buffer_list();
    var destroyImpl = require_destroy();
    var { getHighWaterMark, getDefaultHighWaterMark } = require_state();
    var {
      aggregateTwoErrors,
      codes: {
        ERR_INVALID_ARG_TYPE,
        ERR_METHOD_NOT_IMPLEMENTED,
        ERR_OUT_OF_RANGE,
        ERR_STREAM_PUSH_AFTER_EOF,
        ERR_STREAM_UNSHIFT_AFTER_END_EVENT
      },
      AbortError
    } = require_errors();
    var { validateObject } = require_validators();
    var kPaused = Symbol2("kPaused");
    var { StringDecoder } = require_string_decoder();
    var from = require_from();
    ObjectSetPrototypeOf(Readable.prototype, Stream.prototype);
    ObjectSetPrototypeOf(Readable, Stream);
    var nop = () => {
    };
    var { errorOrDestroy } = destroyImpl;
    var kObjectMode = 1 << 0;
    var kEnded = 1 << 1;
    var kEndEmitted = 1 << 2;
    var kReading = 1 << 3;
    var kConstructed = 1 << 4;
    var kSync = 1 << 5;
    var kNeedReadable = 1 << 6;
    var kEmittedReadable = 1 << 7;
    var kReadableListening = 1 << 8;
    var kResumeScheduled = 1 << 9;
    var kErrorEmitted = 1 << 10;
    var kEmitClose = 1 << 11;
    var kAutoDestroy = 1 << 12;
    var kDestroyed = 1 << 13;
    var kClosed = 1 << 14;
    var kCloseEmitted = 1 << 15;
    var kMultiAwaitDrain = 1 << 16;
    var kReadingMore = 1 << 17;
    var kDataEmitted = 1 << 18;
    function makeBitMapDescriptor(bit) {
      return {
        enumerable: false,
        get() {
          return (this.state & bit) !== 0;
        },
        set(value) {
          if (value) this.state |= bit;
          else this.state &= ~bit;
        }
      };
    }
    ObjectDefineProperties(ReadableState.prototype, {
      objectMode: makeBitMapDescriptor(kObjectMode),
      ended: makeBitMapDescriptor(kEnded),
      endEmitted: makeBitMapDescriptor(kEndEmitted),
      reading: makeBitMapDescriptor(kReading),
      // Stream is still being constructed and cannot be
      // destroyed until construction finished or failed.
      // Async construction is opt in, therefore we start as
      // constructed.
      constructed: makeBitMapDescriptor(kConstructed),
      // A flag to be able to tell if the event 'readable'/'data' is emitted
      // immediately, or on a later tick.  We set this to true at first, because
      // any actions that shouldn't happen until "later" should generally also
      // not happen before the first read call.
      sync: makeBitMapDescriptor(kSync),
      // Whenever we return null, then we set a flag to say
      // that we're awaiting a 'readable' event emission.
      needReadable: makeBitMapDescriptor(kNeedReadable),
      emittedReadable: makeBitMapDescriptor(kEmittedReadable),
      readableListening: makeBitMapDescriptor(kReadableListening),
      resumeScheduled: makeBitMapDescriptor(kResumeScheduled),
      // True if the error was already emitted and should not be thrown again.
      errorEmitted: makeBitMapDescriptor(kErrorEmitted),
      emitClose: makeBitMapDescriptor(kEmitClose),
      autoDestroy: makeBitMapDescriptor(kAutoDestroy),
      // Has it been destroyed.
      destroyed: makeBitMapDescriptor(kDestroyed),
      // Indicates whether the stream has finished destroying.
      closed: makeBitMapDescriptor(kClosed),
      // True if close has been emitted or would have been emitted
      // depending on emitClose.
      closeEmitted: makeBitMapDescriptor(kCloseEmitted),
      multiAwaitDrain: makeBitMapDescriptor(kMultiAwaitDrain),
      // If true, a maybeReadMore has been scheduled.
      readingMore: makeBitMapDescriptor(kReadingMore),
      dataEmitted: makeBitMapDescriptor(kDataEmitted)
    });
    function ReadableState(options, stream, isDuplex) {
      if (typeof isDuplex !== "boolean") isDuplex = stream instanceof require_duplex();
      this.state = kEmitClose | kAutoDestroy | kConstructed | kSync;
      if (options && options.objectMode) this.state |= kObjectMode;
      if (isDuplex && options && options.readableObjectMode) this.state |= kObjectMode;
      this.highWaterMark = options ? getHighWaterMark(this, options, "readableHighWaterMark", isDuplex) : getDefaultHighWaterMark(false);
      this.buffer = new BufferList();
      this.length = 0;
      this.pipes = [];
      this.flowing = null;
      this[kPaused] = null;
      if (options && options.emitClose === false) this.state &= ~kEmitClose;
      if (options && options.autoDestroy === false) this.state &= ~kAutoDestroy;
      this.errored = null;
      this.defaultEncoding = options && options.defaultEncoding || "utf8";
      this.awaitDrainWriters = null;
      this.decoder = null;
      this.encoding = null;
      if (options && options.encoding) {
        this.decoder = new StringDecoder(options.encoding);
        this.encoding = options.encoding;
      }
    }
    function Readable(options) {
      if (!(this instanceof Readable)) return new Readable(options);
      const isDuplex = this instanceof require_duplex();
      this._readableState = new ReadableState(options, this, isDuplex);
      if (options) {
        if (typeof options.read === "function") this._read = options.read;
        if (typeof options.destroy === "function") this._destroy = options.destroy;
        if (typeof options.construct === "function") this._construct = options.construct;
        if (options.signal && !isDuplex) addAbortSignal(options.signal, this);
      }
      Stream.call(this, options);
      destroyImpl.construct(this, () => {
        if (this._readableState.needReadable) {
          maybeReadMore(this, this._readableState);
        }
      });
    }
    Readable.prototype.destroy = destroyImpl.destroy;
    Readable.prototype._undestroy = destroyImpl.undestroy;
    Readable.prototype._destroy = function(err, cb) {
      cb(err);
    };
    Readable.prototype[EE.captureRejectionSymbol] = function(err) {
      this.destroy(err);
    };
    Readable.prototype[SymbolAsyncDispose] = function() {
      let error;
      if (!this.destroyed) {
        error = this.readableEnded ? null : new AbortError();
        this.destroy(error);
      }
      return new Promise2((resolve, reject) => eos(this, (err) => err && err !== error ? reject(err) : resolve(null)));
    };
    Readable.prototype.push = function(chunk, encoding) {
      return readableAddChunk(this, chunk, encoding, false);
    };
    Readable.prototype.unshift = function(chunk, encoding) {
      return readableAddChunk(this, chunk, encoding, true);
    };
    function readableAddChunk(stream, chunk, encoding, addToFront) {
      debug("readableAddChunk", chunk);
      const state = stream._readableState;
      let err;
      if ((state.state & kObjectMode) === 0) {
        if (typeof chunk === "string") {
          encoding = encoding || state.defaultEncoding;
          if (state.encoding !== encoding) {
            if (addToFront && state.encoding) {
              chunk = Buffer3.from(chunk, encoding).toString(state.encoding);
            } else {
              chunk = Buffer3.from(chunk, encoding);
              encoding = "";
            }
          }
        } else if (chunk instanceof Buffer3) {
          encoding = "";
        } else if (Stream._isUint8Array(chunk)) {
          chunk = Stream._uint8ArrayToBuffer(chunk);
          encoding = "";
        } else if (chunk != null) {
          err = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
        }
      }
      if (err) {
        errorOrDestroy(stream, err);
      } else if (chunk === null) {
        state.state &= ~kReading;
        onEofChunk(stream, state);
      } else if ((state.state & kObjectMode) !== 0 || chunk && chunk.length > 0) {
        if (addToFront) {
          if ((state.state & kEndEmitted) !== 0) errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());
          else if (state.destroyed || state.errored) return false;
          else addChunk(stream, state, chunk, true);
        } else if (state.ended) {
          errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF());
        } else if (state.destroyed || state.errored) {
          return false;
        } else {
          state.state &= ~kReading;
          if (state.decoder && !encoding) {
            chunk = state.decoder.write(chunk);
            if (state.objectMode || chunk.length !== 0) addChunk(stream, state, chunk, false);
            else maybeReadMore(stream, state);
          } else {
            addChunk(stream, state, chunk, false);
          }
        }
      } else if (!addToFront) {
        state.state &= ~kReading;
        maybeReadMore(stream, state);
      }
      return !state.ended && (state.length < state.highWaterMark || state.length === 0);
    }
    function addChunk(stream, state, chunk, addToFront) {
      if (state.flowing && state.length === 0 && !state.sync && stream.listenerCount("data") > 0) {
        if ((state.state & kMultiAwaitDrain) !== 0) {
          state.awaitDrainWriters.clear();
        } else {
          state.awaitDrainWriters = null;
        }
        state.dataEmitted = true;
        stream.emit("data", chunk);
      } else {
        state.length += state.objectMode ? 1 : chunk.length;
        if (addToFront) state.buffer.unshift(chunk);
        else state.buffer.push(chunk);
        if ((state.state & kNeedReadable) !== 0) emitReadable(stream);
      }
      maybeReadMore(stream, state);
    }
    Readable.prototype.isPaused = function() {
      const state = this._readableState;
      return state[kPaused] === true || state.flowing === false;
    };
    Readable.prototype.setEncoding = function(enc) {
      const decoder = new StringDecoder(enc);
      this._readableState.decoder = decoder;
      this._readableState.encoding = this._readableState.decoder.encoding;
      const buffer = this._readableState.buffer;
      let content = "";
      for (const data of buffer) {
        content += decoder.write(data);
      }
      buffer.clear();
      if (content !== "") buffer.push(content);
      this._readableState.length = content.length;
      return this;
    };
    var MAX_HWM = 1073741824;
    function computeNewHighWaterMark(n) {
      if (n > MAX_HWM) {
        throw new ERR_OUT_OF_RANGE("size", "<= 1GiB", n);
      } else {
        n--;
        n |= n >>> 1;
        n |= n >>> 2;
        n |= n >>> 4;
        n |= n >>> 8;
        n |= n >>> 16;
        n++;
      }
      return n;
    }
    function howMuchToRead(n, state) {
      if (n <= 0 || state.length === 0 && state.ended) return 0;
      if ((state.state & kObjectMode) !== 0) return 1;
      if (NumberIsNaN(n)) {
        if (state.flowing && state.length) return state.buffer.first().length;
        return state.length;
      }
      if (n <= state.length) return n;
      return state.ended ? state.length : 0;
    }
    Readable.prototype.read = function(n) {
      debug("read", n);
      if (n === void 0) {
        n = NaN;
      } else if (!NumberIsInteger(n)) {
        n = NumberParseInt(n, 10);
      }
      const state = this._readableState;
      const nOrig = n;
      if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
      if (n !== 0) state.state &= ~kEmittedReadable;
      if (n === 0 && state.needReadable && ((state.highWaterMark !== 0 ? state.length >= state.highWaterMark : state.length > 0) || state.ended)) {
        debug("read: emitReadable", state.length, state.ended);
        if (state.length === 0 && state.ended) endReadable(this);
        else emitReadable(this);
        return null;
      }
      n = howMuchToRead(n, state);
      if (n === 0 && state.ended) {
        if (state.length === 0) endReadable(this);
        return null;
      }
      let doRead = (state.state & kNeedReadable) !== 0;
      debug("need readable", doRead);
      if (state.length === 0 || state.length - n < state.highWaterMark) {
        doRead = true;
        debug("length less than watermark", doRead);
      }
      if (state.ended || state.reading || state.destroyed || state.errored || !state.constructed) {
        doRead = false;
        debug("reading, ended or constructing", doRead);
      } else if (doRead) {
        debug("do read");
        state.state |= kReading | kSync;
        if (state.length === 0) state.state |= kNeedReadable;
        try {
          this._read(state.highWaterMark);
        } catch (err) {
          errorOrDestroy(this, err);
        }
        state.state &= ~kSync;
        if (!state.reading) n = howMuchToRead(nOrig, state);
      }
      let ret;
      if (n > 0) ret = fromList(n, state);
      else ret = null;
      if (ret === null) {
        state.needReadable = state.length <= state.highWaterMark;
        n = 0;
      } else {
        state.length -= n;
        if (state.multiAwaitDrain) {
          state.awaitDrainWriters.clear();
        } else {
          state.awaitDrainWriters = null;
        }
      }
      if (state.length === 0) {
        if (!state.ended) state.needReadable = true;
        if (nOrig !== n && state.ended) endReadable(this);
      }
      if (ret !== null && !state.errorEmitted && !state.closeEmitted) {
        state.dataEmitted = true;
        this.emit("data", ret);
      }
      return ret;
    };
    function onEofChunk(stream, state) {
      debug("onEofChunk");
      if (state.ended) return;
      if (state.decoder) {
        const chunk = state.decoder.end();
        if (chunk && chunk.length) {
          state.buffer.push(chunk);
          state.length += state.objectMode ? 1 : chunk.length;
        }
      }
      state.ended = true;
      if (state.sync) {
        emitReadable(stream);
      } else {
        state.needReadable = false;
        state.emittedReadable = true;
        emitReadable_(stream);
      }
    }
    function emitReadable(stream) {
      const state = stream._readableState;
      debug("emitReadable", state.needReadable, state.emittedReadable);
      state.needReadable = false;
      if (!state.emittedReadable) {
        debug("emitReadable", state.flowing);
        state.emittedReadable = true;
        process.nextTick(emitReadable_, stream);
      }
    }
    function emitReadable_(stream) {
      const state = stream._readableState;
      debug("emitReadable_", state.destroyed, state.length, state.ended);
      if (!state.destroyed && !state.errored && (state.length || state.ended)) {
        stream.emit("readable");
        state.emittedReadable = false;
      }
      state.needReadable = !state.flowing && !state.ended && state.length <= state.highWaterMark;
      flow(stream);
    }
    function maybeReadMore(stream, state) {
      if (!state.readingMore && state.constructed) {
        state.readingMore = true;
        process.nextTick(maybeReadMore_, stream, state);
      }
    }
    function maybeReadMore_(stream, state) {
      while (!state.reading && !state.ended && (state.length < state.highWaterMark || state.flowing && state.length === 0)) {
        const len = state.length;
        debug("maybeReadMore read 0");
        stream.read(0);
        if (len === state.length)
          break;
      }
      state.readingMore = false;
    }
    Readable.prototype._read = function(n) {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_read()");
    };
    Readable.prototype.pipe = function(dest, pipeOpts) {
      const src = this;
      const state = this._readableState;
      if (state.pipes.length === 1) {
        if (!state.multiAwaitDrain) {
          state.multiAwaitDrain = true;
          state.awaitDrainWriters = new SafeSet(state.awaitDrainWriters ? [state.awaitDrainWriters] : []);
        }
      }
      state.pipes.push(dest);
      debug("pipe count=%d opts=%j", state.pipes.length, pipeOpts);
      const doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;
      const endFn = doEnd ? onend : unpipe;
      if (state.endEmitted) process.nextTick(endFn);
      else src.once("end", endFn);
      dest.on("unpipe", onunpipe);
      function onunpipe(readable, unpipeInfo) {
        debug("onunpipe");
        if (readable === src) {
          if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
            unpipeInfo.hasUnpiped = true;
            cleanup();
          }
        }
      }
      function onend() {
        debug("onend");
        dest.end();
      }
      let ondrain;
      let cleanedUp = false;
      function cleanup() {
        debug("cleanup");
        dest.removeListener("close", onclose);
        dest.removeListener("finish", onfinish);
        if (ondrain) {
          dest.removeListener("drain", ondrain);
        }
        dest.removeListener("error", onerror);
        dest.removeListener("unpipe", onunpipe);
        src.removeListener("end", onend);
        src.removeListener("end", unpipe);
        src.removeListener("data", ondata);
        cleanedUp = true;
        if (ondrain && state.awaitDrainWriters && (!dest._writableState || dest._writableState.needDrain)) ondrain();
      }
      function pause() {
        if (!cleanedUp) {
          if (state.pipes.length === 1 && state.pipes[0] === dest) {
            debug("false write response, pause", 0);
            state.awaitDrainWriters = dest;
            state.multiAwaitDrain = false;
          } else if (state.pipes.length > 1 && state.pipes.includes(dest)) {
            debug("false write response, pause", state.awaitDrainWriters.size);
            state.awaitDrainWriters.add(dest);
          }
          src.pause();
        }
        if (!ondrain) {
          ondrain = pipeOnDrain(src, dest);
          dest.on("drain", ondrain);
        }
      }
      src.on("data", ondata);
      function ondata(chunk) {
        debug("ondata");
        const ret = dest.write(chunk);
        debug("dest.write", ret);
        if (ret === false) {
          pause();
        }
      }
      function onerror(er) {
        debug("onerror", er);
        unpipe();
        dest.removeListener("error", onerror);
        if (dest.listenerCount("error") === 0) {
          const s = dest._writableState || dest._readableState;
          if (s && !s.errorEmitted) {
            errorOrDestroy(dest, er);
          } else {
            dest.emit("error", er);
          }
        }
      }
      prependListener(dest, "error", onerror);
      function onclose() {
        dest.removeListener("finish", onfinish);
        unpipe();
      }
      dest.once("close", onclose);
      function onfinish() {
        debug("onfinish");
        dest.removeListener("close", onclose);
        unpipe();
      }
      dest.once("finish", onfinish);
      function unpipe() {
        debug("unpipe");
        src.unpipe(dest);
      }
      dest.emit("pipe", src);
      if (dest.writableNeedDrain === true) {
        pause();
      } else if (!state.flowing) {
        debug("pipe resume");
        src.resume();
      }
      return dest;
    };
    function pipeOnDrain(src, dest) {
      return function pipeOnDrainFunctionResult() {
        const state = src._readableState;
        if (state.awaitDrainWriters === dest) {
          debug("pipeOnDrain", 1);
          state.awaitDrainWriters = null;
        } else if (state.multiAwaitDrain) {
          debug("pipeOnDrain", state.awaitDrainWriters.size);
          state.awaitDrainWriters.delete(dest);
        }
        if ((!state.awaitDrainWriters || state.awaitDrainWriters.size === 0) && src.listenerCount("data")) {
          src.resume();
        }
      };
    }
    Readable.prototype.unpipe = function(dest) {
      const state = this._readableState;
      const unpipeInfo = {
        hasUnpiped: false
      };
      if (state.pipes.length === 0) return this;
      if (!dest) {
        const dests = state.pipes;
        state.pipes = [];
        this.pause();
        for (let i = 0; i < dests.length; i++)
          dests[i].emit("unpipe", this, {
            hasUnpiped: false
          });
        return this;
      }
      const index = ArrayPrototypeIndexOf(state.pipes, dest);
      if (index === -1) return this;
      state.pipes.splice(index, 1);
      if (state.pipes.length === 0) this.pause();
      dest.emit("unpipe", this, unpipeInfo);
      return this;
    };
    Readable.prototype.on = function(ev, fn) {
      const res = Stream.prototype.on.call(this, ev, fn);
      const state = this._readableState;
      if (ev === "data") {
        state.readableListening = this.listenerCount("readable") > 0;
        if (state.flowing !== false) this.resume();
      } else if (ev === "readable") {
        if (!state.endEmitted && !state.readableListening) {
          state.readableListening = state.needReadable = true;
          state.flowing = false;
          state.emittedReadable = false;
          debug("on readable", state.length, state.reading);
          if (state.length) {
            emitReadable(this);
          } else if (!state.reading) {
            process.nextTick(nReadingNextTick, this);
          }
        }
      }
      return res;
    };
    Readable.prototype.addListener = Readable.prototype.on;
    Readable.prototype.removeListener = function(ev, fn) {
      const res = Stream.prototype.removeListener.call(this, ev, fn);
      if (ev === "readable") {
        process.nextTick(updateReadableListening, this);
      }
      return res;
    };
    Readable.prototype.off = Readable.prototype.removeListener;
    Readable.prototype.removeAllListeners = function(ev) {
      const res = Stream.prototype.removeAllListeners.apply(this, arguments);
      if (ev === "readable" || ev === void 0) {
        process.nextTick(updateReadableListening, this);
      }
      return res;
    };
    function updateReadableListening(self2) {
      const state = self2._readableState;
      state.readableListening = self2.listenerCount("readable") > 0;
      if (state.resumeScheduled && state[kPaused] === false) {
        state.flowing = true;
      } else if (self2.listenerCount("data") > 0) {
        self2.resume();
      } else if (!state.readableListening) {
        state.flowing = null;
      }
    }
    function nReadingNextTick(self2) {
      debug("readable nexttick read 0");
      self2.read(0);
    }
    Readable.prototype.resume = function() {
      const state = this._readableState;
      if (!state.flowing) {
        debug("resume");
        state.flowing = !state.readableListening;
        resume(this, state);
      }
      state[kPaused] = false;
      return this;
    };
    function resume(stream, state) {
      if (!state.resumeScheduled) {
        state.resumeScheduled = true;
        process.nextTick(resume_, stream, state);
      }
    }
    function resume_(stream, state) {
      debug("resume", state.reading);
      if (!state.reading) {
        stream.read(0);
      }
      state.resumeScheduled = false;
      stream.emit("resume");
      flow(stream);
      if (state.flowing && !state.reading) stream.read(0);
    }
    Readable.prototype.pause = function() {
      debug("call pause flowing=%j", this._readableState.flowing);
      if (this._readableState.flowing !== false) {
        debug("pause");
        this._readableState.flowing = false;
        this.emit("pause");
      }
      this._readableState[kPaused] = true;
      return this;
    };
    function flow(stream) {
      const state = stream._readableState;
      debug("flow", state.flowing);
      while (state.flowing && stream.read() !== null) ;
    }
    Readable.prototype.wrap = function(stream) {
      let paused = false;
      stream.on("data", (chunk) => {
        if (!this.push(chunk) && stream.pause) {
          paused = true;
          stream.pause();
        }
      });
      stream.on("end", () => {
        this.push(null);
      });
      stream.on("error", (err) => {
        errorOrDestroy(this, err);
      });
      stream.on("close", () => {
        this.destroy();
      });
      stream.on("destroy", () => {
        this.destroy();
      });
      this._read = () => {
        if (paused && stream.resume) {
          paused = false;
          stream.resume();
        }
      };
      const streamKeys = ObjectKeys(stream);
      for (let j = 1; j < streamKeys.length; j++) {
        const i = streamKeys[j];
        if (this[i] === void 0 && typeof stream[i] === "function") {
          this[i] = stream[i].bind(stream);
        }
      }
      return this;
    };
    Readable.prototype[SymbolAsyncIterator] = function() {
      return streamToAsyncIterator(this);
    };
    Readable.prototype.iterator = function(options) {
      if (options !== void 0) {
        validateObject(options, "options");
      }
      return streamToAsyncIterator(this, options);
    };
    function streamToAsyncIterator(stream, options) {
      if (typeof stream.read !== "function") {
        stream = Readable.wrap(stream, {
          objectMode: true
        });
      }
      const iter = createAsyncIterator(stream, options);
      iter.stream = stream;
      return iter;
    }
    async function* createAsyncIterator(stream, options) {
      let callback = nop;
      function next(resolve) {
        if (this === stream) {
          callback();
          callback = nop;
        } else {
          callback = resolve;
        }
      }
      stream.on("readable", next);
      let error;
      const cleanup = eos(
        stream,
        {
          writable: false
        },
        (err) => {
          error = err ? aggregateTwoErrors(error, err) : null;
          callback();
          callback = nop;
        }
      );
      try {
        while (true) {
          const chunk = stream.destroyed ? null : stream.read();
          if (chunk !== null) {
            yield chunk;
          } else if (error) {
            throw error;
          } else if (error === null) {
            return;
          } else {
            await new Promise2(next);
          }
        }
      } catch (err) {
        error = aggregateTwoErrors(error, err);
        throw error;
      } finally {
        if ((error || (options === null || options === void 0 ? void 0 : options.destroyOnReturn) !== false) && (error === void 0 || stream._readableState.autoDestroy)) {
          destroyImpl.destroyer(stream, null);
        } else {
          stream.off("readable", next);
          cleanup();
        }
      }
    }
    ObjectDefineProperties(Readable.prototype, {
      readable: {
        __proto__: null,
        get() {
          const r = this._readableState;
          return !!r && r.readable !== false && !r.destroyed && !r.errorEmitted && !r.endEmitted;
        },
        set(val) {
          if (this._readableState) {
            this._readableState.readable = !!val;
          }
        }
      },
      readableDidRead: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return this._readableState.dataEmitted;
        }
      },
      readableAborted: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return !!(this._readableState.readable !== false && (this._readableState.destroyed || this._readableState.errored) && !this._readableState.endEmitted);
        }
      },
      readableHighWaterMark: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return this._readableState.highWaterMark;
        }
      },
      readableBuffer: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return this._readableState && this._readableState.buffer;
        }
      },
      readableFlowing: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return this._readableState.flowing;
        },
        set: function(state) {
          if (this._readableState) {
            this._readableState.flowing = state;
          }
        }
      },
      readableLength: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState.length;
        }
      },
      readableObjectMode: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.objectMode : false;
        }
      },
      readableEncoding: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.encoding : null;
        }
      },
      errored: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.errored : null;
        }
      },
      closed: {
        __proto__: null,
        get() {
          return this._readableState ? this._readableState.closed : false;
        }
      },
      destroyed: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.destroyed : false;
        },
        set(value) {
          if (!this._readableState) {
            return;
          }
          this._readableState.destroyed = value;
        }
      },
      readableEnded: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.endEmitted : false;
        }
      }
    });
    ObjectDefineProperties(ReadableState.prototype, {
      // Legacy getter for `pipesCount`.
      pipesCount: {
        __proto__: null,
        get() {
          return this.pipes.length;
        }
      },
      // Legacy property for `paused`.
      paused: {
        __proto__: null,
        get() {
          return this[kPaused] !== false;
        },
        set(value) {
          this[kPaused] = !!value;
        }
      }
    });
    Readable._fromList = fromList;
    function fromList(n, state) {
      if (state.length === 0) return null;
      let ret;
      if (state.objectMode) ret = state.buffer.shift();
      else if (!n || n >= state.length) {
        if (state.decoder) ret = state.buffer.join("");
        else if (state.buffer.length === 1) ret = state.buffer.first();
        else ret = state.buffer.concat(state.length);
        state.buffer.clear();
      } else {
        ret = state.buffer.consume(n, state.decoder);
      }
      return ret;
    }
    function endReadable(stream) {
      const state = stream._readableState;
      debug("endReadable", state.endEmitted);
      if (!state.endEmitted) {
        state.ended = true;
        process.nextTick(endReadableNT, state, stream);
      }
    }
    function endReadableNT(state, stream) {
      debug("endReadableNT", state.endEmitted, state.length);
      if (!state.errored && !state.closeEmitted && !state.endEmitted && state.length === 0) {
        state.endEmitted = true;
        stream.emit("end");
        if (stream.writable && stream.allowHalfOpen === false) {
          process.nextTick(endWritableNT, stream);
        } else if (state.autoDestroy) {
          const wState = stream._writableState;
          const autoDestroy = !wState || wState.autoDestroy && // We don't expect the writable to ever 'finish'
          // if writable is explicitly set to false.
          (wState.finished || wState.writable === false);
          if (autoDestroy) {
            stream.destroy();
          }
        }
      }
    }
    function endWritableNT(stream) {
      const writable = stream.writable && !stream.writableEnded && !stream.destroyed;
      if (writable) {
        stream.end();
      }
    }
    Readable.from = function(iterable, opts) {
      return from(Readable, iterable, opts);
    };
    var webStreamsAdapters;
    function lazyWebStreams() {
      if (webStreamsAdapters === void 0) webStreamsAdapters = {};
      return webStreamsAdapters;
    }
    Readable.fromWeb = function(readableStream, options) {
      return lazyWebStreams().newStreamReadableFromReadableStream(readableStream, options);
    };
    Readable.toWeb = function(streamReadable, options) {
      return lazyWebStreams().newReadableStreamFromStreamReadable(streamReadable, options);
    };
    Readable.wrap = function(src, options) {
      var _ref, _src$readableObjectMo;
      return new Readable({
        objectMode: (_ref = (_src$readableObjectMo = src.readableObjectMode) !== null && _src$readableObjectMo !== void 0 ? _src$readableObjectMo : src.objectMode) !== null && _ref !== void 0 ? _ref : true,
        ...options,
        destroy(err, callback) {
          destroyImpl.destroyer(src, err);
          callback(err);
        }
      }).wrap(src);
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/writable.js
var require_writable = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/writable.js"(exports, module) {
    "use strict";
    var process = require_browser2();
    var {
      ArrayPrototypeSlice,
      Error: Error2,
      FunctionPrototypeSymbolHasInstance,
      ObjectDefineProperty,
      ObjectDefineProperties,
      ObjectSetPrototypeOf,
      StringPrototypeToLowerCase,
      Symbol: Symbol2,
      SymbolHasInstance
    } = require_primordials();
    module.exports = Writable;
    Writable.WritableState = WritableState;
    var { EventEmitter: EE } = require_events();
    var Stream = require_legacy().Stream;
    var { Buffer: Buffer3 } = require_buffer();
    var destroyImpl = require_destroy();
    var { addAbortSignal } = require_add_abort_signal();
    var { getHighWaterMark, getDefaultHighWaterMark } = require_state();
    var {
      ERR_INVALID_ARG_TYPE,
      ERR_METHOD_NOT_IMPLEMENTED,
      ERR_MULTIPLE_CALLBACK,
      ERR_STREAM_CANNOT_PIPE,
      ERR_STREAM_DESTROYED,
      ERR_STREAM_ALREADY_FINISHED,
      ERR_STREAM_NULL_VALUES,
      ERR_STREAM_WRITE_AFTER_END,
      ERR_UNKNOWN_ENCODING
    } = require_errors().codes;
    var { errorOrDestroy } = destroyImpl;
    ObjectSetPrototypeOf(Writable.prototype, Stream.prototype);
    ObjectSetPrototypeOf(Writable, Stream);
    function nop() {
    }
    var kOnFinished = Symbol2("kOnFinished");
    function WritableState(options, stream, isDuplex) {
      if (typeof isDuplex !== "boolean") isDuplex = stream instanceof require_duplex();
      this.objectMode = !!(options && options.objectMode);
      if (isDuplex) this.objectMode = this.objectMode || !!(options && options.writableObjectMode);
      this.highWaterMark = options ? getHighWaterMark(this, options, "writableHighWaterMark", isDuplex) : getDefaultHighWaterMark(false);
      this.finalCalled = false;
      this.needDrain = false;
      this.ending = false;
      this.ended = false;
      this.finished = false;
      this.destroyed = false;
      const noDecode = !!(options && options.decodeStrings === false);
      this.decodeStrings = !noDecode;
      this.defaultEncoding = options && options.defaultEncoding || "utf8";
      this.length = 0;
      this.writing = false;
      this.corked = 0;
      this.sync = true;
      this.bufferProcessing = false;
      this.onwrite = onwrite.bind(void 0, stream);
      this.writecb = null;
      this.writelen = 0;
      this.afterWriteTickInfo = null;
      resetBuffer(this);
      this.pendingcb = 0;
      this.constructed = true;
      this.prefinished = false;
      this.errorEmitted = false;
      this.emitClose = !options || options.emitClose !== false;
      this.autoDestroy = !options || options.autoDestroy !== false;
      this.errored = null;
      this.closed = false;
      this.closeEmitted = false;
      this[kOnFinished] = [];
    }
    function resetBuffer(state) {
      state.buffered = [];
      state.bufferedIndex = 0;
      state.allBuffers = true;
      state.allNoop = true;
    }
    WritableState.prototype.getBuffer = function getBuffer() {
      return ArrayPrototypeSlice(this.buffered, this.bufferedIndex);
    };
    ObjectDefineProperty(WritableState.prototype, "bufferedRequestCount", {
      __proto__: null,
      get() {
        return this.buffered.length - this.bufferedIndex;
      }
    });
    function Writable(options) {
      const isDuplex = this instanceof require_duplex();
      if (!isDuplex && !FunctionPrototypeSymbolHasInstance(Writable, this)) return new Writable(options);
      this._writableState = new WritableState(options, this, isDuplex);
      if (options) {
        if (typeof options.write === "function") this._write = options.write;
        if (typeof options.writev === "function") this._writev = options.writev;
        if (typeof options.destroy === "function") this._destroy = options.destroy;
        if (typeof options.final === "function") this._final = options.final;
        if (typeof options.construct === "function") this._construct = options.construct;
        if (options.signal) addAbortSignal(options.signal, this);
      }
      Stream.call(this, options);
      destroyImpl.construct(this, () => {
        const state = this._writableState;
        if (!state.writing) {
          clearBuffer(this, state);
        }
        finishMaybe(this, state);
      });
    }
    ObjectDefineProperty(Writable, SymbolHasInstance, {
      __proto__: null,
      value: function(object) {
        if (FunctionPrototypeSymbolHasInstance(this, object)) return true;
        if (this !== Writable) return false;
        return object && object._writableState instanceof WritableState;
      }
    });
    Writable.prototype.pipe = function() {
      errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE());
    };
    function _write(stream, chunk, encoding, cb) {
      const state = stream._writableState;
      if (typeof encoding === "function") {
        cb = encoding;
        encoding = state.defaultEncoding;
      } else {
        if (!encoding) encoding = state.defaultEncoding;
        else if (encoding !== "buffer" && !Buffer3.isEncoding(encoding)) throw new ERR_UNKNOWN_ENCODING(encoding);
        if (typeof cb !== "function") cb = nop;
      }
      if (chunk === null) {
        throw new ERR_STREAM_NULL_VALUES();
      } else if (!state.objectMode) {
        if (typeof chunk === "string") {
          if (state.decodeStrings !== false) {
            chunk = Buffer3.from(chunk, encoding);
            encoding = "buffer";
          }
        } else if (chunk instanceof Buffer3) {
          encoding = "buffer";
        } else if (Stream._isUint8Array(chunk)) {
          chunk = Stream._uint8ArrayToBuffer(chunk);
          encoding = "buffer";
        } else {
          throw new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
        }
      }
      let err;
      if (state.ending) {
        err = new ERR_STREAM_WRITE_AFTER_END();
      } else if (state.destroyed) {
        err = new ERR_STREAM_DESTROYED("write");
      }
      if (err) {
        process.nextTick(cb, err);
        errorOrDestroy(stream, err, true);
        return err;
      }
      state.pendingcb++;
      return writeOrBuffer(stream, state, chunk, encoding, cb);
    }
    Writable.prototype.write = function(chunk, encoding, cb) {
      return _write(this, chunk, encoding, cb) === true;
    };
    Writable.prototype.cork = function() {
      this._writableState.corked++;
    };
    Writable.prototype.uncork = function() {
      const state = this._writableState;
      if (state.corked) {
        state.corked--;
        if (!state.writing) clearBuffer(this, state);
      }
    };
    Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
      if (typeof encoding === "string") encoding = StringPrototypeToLowerCase(encoding);
      if (!Buffer3.isEncoding(encoding)) throw new ERR_UNKNOWN_ENCODING(encoding);
      this._writableState.defaultEncoding = encoding;
      return this;
    };
    function writeOrBuffer(stream, state, chunk, encoding, callback) {
      const len = state.objectMode ? 1 : chunk.length;
      state.length += len;
      const ret = state.length < state.highWaterMark;
      if (!ret) state.needDrain = true;
      if (state.writing || state.corked || state.errored || !state.constructed) {
        state.buffered.push({
          chunk,
          encoding,
          callback
        });
        if (state.allBuffers && encoding !== "buffer") {
          state.allBuffers = false;
        }
        if (state.allNoop && callback !== nop) {
          state.allNoop = false;
        }
      } else {
        state.writelen = len;
        state.writecb = callback;
        state.writing = true;
        state.sync = true;
        stream._write(chunk, encoding, state.onwrite);
        state.sync = false;
      }
      return ret && !state.errored && !state.destroyed;
    }
    function doWrite(stream, state, writev, len, chunk, encoding, cb) {
      state.writelen = len;
      state.writecb = cb;
      state.writing = true;
      state.sync = true;
      if (state.destroyed) state.onwrite(new ERR_STREAM_DESTROYED("write"));
      else if (writev) stream._writev(chunk, state.onwrite);
      else stream._write(chunk, encoding, state.onwrite);
      state.sync = false;
    }
    function onwriteError(stream, state, er, cb) {
      --state.pendingcb;
      cb(er);
      errorBuffer(state);
      errorOrDestroy(stream, er);
    }
    function onwrite(stream, er) {
      const state = stream._writableState;
      const sync = state.sync;
      const cb = state.writecb;
      if (typeof cb !== "function") {
        errorOrDestroy(stream, new ERR_MULTIPLE_CALLBACK());
        return;
      }
      state.writing = false;
      state.writecb = null;
      state.length -= state.writelen;
      state.writelen = 0;
      if (er) {
        er.stack;
        if (!state.errored) {
          state.errored = er;
        }
        if (stream._readableState && !stream._readableState.errored) {
          stream._readableState.errored = er;
        }
        if (sync) {
          process.nextTick(onwriteError, stream, state, er, cb);
        } else {
          onwriteError(stream, state, er, cb);
        }
      } else {
        if (state.buffered.length > state.bufferedIndex) {
          clearBuffer(stream, state);
        }
        if (sync) {
          if (state.afterWriteTickInfo !== null && state.afterWriteTickInfo.cb === cb) {
            state.afterWriteTickInfo.count++;
          } else {
            state.afterWriteTickInfo = {
              count: 1,
              cb,
              stream,
              state
            };
            process.nextTick(afterWriteTick, state.afterWriteTickInfo);
          }
        } else {
          afterWrite(stream, state, 1, cb);
        }
      }
    }
    function afterWriteTick({ stream, state, count, cb }) {
      state.afterWriteTickInfo = null;
      return afterWrite(stream, state, count, cb);
    }
    function afterWrite(stream, state, count, cb) {
      const needDrain = !state.ending && !stream.destroyed && state.length === 0 && state.needDrain;
      if (needDrain) {
        state.needDrain = false;
        stream.emit("drain");
      }
      while (count-- > 0) {
        state.pendingcb--;
        cb();
      }
      if (state.destroyed) {
        errorBuffer(state);
      }
      finishMaybe(stream, state);
    }
    function errorBuffer(state) {
      if (state.writing) {
        return;
      }
      for (let n = state.bufferedIndex; n < state.buffered.length; ++n) {
        var _state$errored;
        const { chunk, callback } = state.buffered[n];
        const len = state.objectMode ? 1 : chunk.length;
        state.length -= len;
        callback(
          (_state$errored = state.errored) !== null && _state$errored !== void 0 ? _state$errored : new ERR_STREAM_DESTROYED("write")
        );
      }
      const onfinishCallbacks = state[kOnFinished].splice(0);
      for (let i = 0; i < onfinishCallbacks.length; i++) {
        var _state$errored2;
        onfinishCallbacks[i](
          (_state$errored2 = state.errored) !== null && _state$errored2 !== void 0 ? _state$errored2 : new ERR_STREAM_DESTROYED("end")
        );
      }
      resetBuffer(state);
    }
    function clearBuffer(stream, state) {
      if (state.corked || state.bufferProcessing || state.destroyed || !state.constructed) {
        return;
      }
      const { buffered, bufferedIndex, objectMode } = state;
      const bufferedLength = buffered.length - bufferedIndex;
      if (!bufferedLength) {
        return;
      }
      let i = bufferedIndex;
      state.bufferProcessing = true;
      if (bufferedLength > 1 && stream._writev) {
        state.pendingcb -= bufferedLength - 1;
        const callback = state.allNoop ? nop : (err) => {
          for (let n = i; n < buffered.length; ++n) {
            buffered[n].callback(err);
          }
        };
        const chunks = state.allNoop && i === 0 ? buffered : ArrayPrototypeSlice(buffered, i);
        chunks.allBuffers = state.allBuffers;
        doWrite(stream, state, true, state.length, chunks, "", callback);
        resetBuffer(state);
      } else {
        do {
          const { chunk, encoding, callback } = buffered[i];
          buffered[i++] = null;
          const len = objectMode ? 1 : chunk.length;
          doWrite(stream, state, false, len, chunk, encoding, callback);
        } while (i < buffered.length && !state.writing);
        if (i === buffered.length) {
          resetBuffer(state);
        } else if (i > 256) {
          buffered.splice(0, i);
          state.bufferedIndex = 0;
        } else {
          state.bufferedIndex = i;
        }
      }
      state.bufferProcessing = false;
    }
    Writable.prototype._write = function(chunk, encoding, cb) {
      if (this._writev) {
        this._writev(
          [
            {
              chunk,
              encoding
            }
          ],
          cb
        );
      } else {
        throw new ERR_METHOD_NOT_IMPLEMENTED("_write()");
      }
    };
    Writable.prototype._writev = null;
    Writable.prototype.end = function(chunk, encoding, cb) {
      const state = this._writableState;
      if (typeof chunk === "function") {
        cb = chunk;
        chunk = null;
        encoding = null;
      } else if (typeof encoding === "function") {
        cb = encoding;
        encoding = null;
      }
      let err;
      if (chunk !== null && chunk !== void 0) {
        const ret = _write(this, chunk, encoding);
        if (ret instanceof Error2) {
          err = ret;
        }
      }
      if (state.corked) {
        state.corked = 1;
        this.uncork();
      }
      if (err) {
      } else if (!state.errored && !state.ending) {
        state.ending = true;
        finishMaybe(this, state, true);
        state.ended = true;
      } else if (state.finished) {
        err = new ERR_STREAM_ALREADY_FINISHED("end");
      } else if (state.destroyed) {
        err = new ERR_STREAM_DESTROYED("end");
      }
      if (typeof cb === "function") {
        if (err || state.finished) {
          process.nextTick(cb, err);
        } else {
          state[kOnFinished].push(cb);
        }
      }
      return this;
    };
    function needFinish(state) {
      return state.ending && !state.destroyed && state.constructed && state.length === 0 && !state.errored && state.buffered.length === 0 && !state.finished && !state.writing && !state.errorEmitted && !state.closeEmitted;
    }
    function callFinal(stream, state) {
      let called = false;
      function onFinish(err) {
        if (called) {
          errorOrDestroy(stream, err !== null && err !== void 0 ? err : ERR_MULTIPLE_CALLBACK());
          return;
        }
        called = true;
        state.pendingcb--;
        if (err) {
          const onfinishCallbacks = state[kOnFinished].splice(0);
          for (let i = 0; i < onfinishCallbacks.length; i++) {
            onfinishCallbacks[i](err);
          }
          errorOrDestroy(stream, err, state.sync);
        } else if (needFinish(state)) {
          state.prefinished = true;
          stream.emit("prefinish");
          state.pendingcb++;
          process.nextTick(finish, stream, state);
        }
      }
      state.sync = true;
      state.pendingcb++;
      try {
        stream._final(onFinish);
      } catch (err) {
        onFinish(err);
      }
      state.sync = false;
    }
    function prefinish(stream, state) {
      if (!state.prefinished && !state.finalCalled) {
        if (typeof stream._final === "function" && !state.destroyed) {
          state.finalCalled = true;
          callFinal(stream, state);
        } else {
          state.prefinished = true;
          stream.emit("prefinish");
        }
      }
    }
    function finishMaybe(stream, state, sync) {
      if (needFinish(state)) {
        prefinish(stream, state);
        if (state.pendingcb === 0) {
          if (sync) {
            state.pendingcb++;
            process.nextTick(
              (stream2, state2) => {
                if (needFinish(state2)) {
                  finish(stream2, state2);
                } else {
                  state2.pendingcb--;
                }
              },
              stream,
              state
            );
          } else if (needFinish(state)) {
            state.pendingcb++;
            finish(stream, state);
          }
        }
      }
    }
    function finish(stream, state) {
      state.pendingcb--;
      state.finished = true;
      const onfinishCallbacks = state[kOnFinished].splice(0);
      for (let i = 0; i < onfinishCallbacks.length; i++) {
        onfinishCallbacks[i]();
      }
      stream.emit("finish");
      if (state.autoDestroy) {
        const rState = stream._readableState;
        const autoDestroy = !rState || rState.autoDestroy && // We don't expect the readable to ever 'end'
        // if readable is explicitly set to false.
        (rState.endEmitted || rState.readable === false);
        if (autoDestroy) {
          stream.destroy();
        }
      }
    }
    ObjectDefineProperties(Writable.prototype, {
      closed: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.closed : false;
        }
      },
      destroyed: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.destroyed : false;
        },
        set(value) {
          if (this._writableState) {
            this._writableState.destroyed = value;
          }
        }
      },
      writable: {
        __proto__: null,
        get() {
          const w = this._writableState;
          return !!w && w.writable !== false && !w.destroyed && !w.errored && !w.ending && !w.ended;
        },
        set(val) {
          if (this._writableState) {
            this._writableState.writable = !!val;
          }
        }
      },
      writableFinished: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.finished : false;
        }
      },
      writableObjectMode: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.objectMode : false;
        }
      },
      writableBuffer: {
        __proto__: null,
        get() {
          return this._writableState && this._writableState.getBuffer();
        }
      },
      writableEnded: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.ending : false;
        }
      },
      writableNeedDrain: {
        __proto__: null,
        get() {
          const wState = this._writableState;
          if (!wState) return false;
          return !wState.destroyed && !wState.ending && wState.needDrain;
        }
      },
      writableHighWaterMark: {
        __proto__: null,
        get() {
          return this._writableState && this._writableState.highWaterMark;
        }
      },
      writableCorked: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.corked : 0;
        }
      },
      writableLength: {
        __proto__: null,
        get() {
          return this._writableState && this._writableState.length;
        }
      },
      errored: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._writableState ? this._writableState.errored : null;
        }
      },
      writableAborted: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return !!(this._writableState.writable !== false && (this._writableState.destroyed || this._writableState.errored) && !this._writableState.finished);
        }
      }
    });
    var destroy = destroyImpl.destroy;
    Writable.prototype.destroy = function(err, cb) {
      const state = this._writableState;
      if (!state.destroyed && (state.bufferedIndex < state.buffered.length || state[kOnFinished].length)) {
        process.nextTick(errorBuffer, state);
      }
      destroy.call(this, err, cb);
      return this;
    };
    Writable.prototype._undestroy = destroyImpl.undestroy;
    Writable.prototype._destroy = function(err, cb) {
      cb(err);
    };
    Writable.prototype[EE.captureRejectionSymbol] = function(err) {
      this.destroy(err);
    };
    var webStreamsAdapters;
    function lazyWebStreams() {
      if (webStreamsAdapters === void 0) webStreamsAdapters = {};
      return webStreamsAdapters;
    }
    Writable.fromWeb = function(writableStream, options) {
      return lazyWebStreams().newStreamWritableFromWritableStream(writableStream, options);
    };
    Writable.toWeb = function(streamWritable) {
      return lazyWebStreams().newWritableStreamFromStreamWritable(streamWritable);
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/duplexify.js
var require_duplexify = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/duplexify.js"(exports, module) {
    var process = require_browser2();
    var bufferModule = require_buffer();
    var {
      isReadable,
      isWritable,
      isIterable,
      isNodeStream,
      isReadableNodeStream,
      isWritableNodeStream,
      isDuplexNodeStream,
      isReadableStream,
      isWritableStream
    } = require_utils();
    var eos = require_end_of_stream();
    var {
      AbortError,
      codes: { ERR_INVALID_ARG_TYPE, ERR_INVALID_RETURN_VALUE }
    } = require_errors();
    var { destroyer } = require_destroy();
    var Duplex = require_duplex();
    var Readable = require_readable();
    var Writable = require_writable();
    var { createDeferredPromise } = require_util();
    var from = require_from();
    var Blob = globalThis.Blob || bufferModule.Blob;
    var isBlob = typeof Blob !== "undefined" ? function isBlob2(b) {
      return b instanceof Blob;
    } : function isBlob2(b) {
      return false;
    };
    var AbortController = globalThis.AbortController || require_browser().AbortController;
    var { FunctionPrototypeCall } = require_primordials();
    var Duplexify = class extends Duplex {
      constructor(options) {
        super(options);
        if ((options === null || options === void 0 ? void 0 : options.readable) === false) {
          this._readableState.readable = false;
          this._readableState.ended = true;
          this._readableState.endEmitted = true;
        }
        if ((options === null || options === void 0 ? void 0 : options.writable) === false) {
          this._writableState.writable = false;
          this._writableState.ending = true;
          this._writableState.ended = true;
          this._writableState.finished = true;
        }
      }
    };
    module.exports = function duplexify(body, name) {
      if (isDuplexNodeStream(body)) {
        return body;
      }
      if (isReadableNodeStream(body)) {
        return _duplexify({
          readable: body
        });
      }
      if (isWritableNodeStream(body)) {
        return _duplexify({
          writable: body
        });
      }
      if (isNodeStream(body)) {
        return _duplexify({
          writable: false,
          readable: false
        });
      }
      if (isReadableStream(body)) {
        return _duplexify({
          readable: Readable.fromWeb(body)
        });
      }
      if (isWritableStream(body)) {
        return _duplexify({
          writable: Writable.fromWeb(body)
        });
      }
      if (typeof body === "function") {
        const { value, write, final, destroy } = fromAsyncGen(body);
        if (isIterable(value)) {
          return from(Duplexify, value, {
            // TODO (ronag): highWaterMark?
            objectMode: true,
            write,
            final,
            destroy
          });
        }
        const then2 = value === null || value === void 0 ? void 0 : value.then;
        if (typeof then2 === "function") {
          let d;
          const promise = FunctionPrototypeCall(
            then2,
            value,
            (val) => {
              if (val != null) {
                throw new ERR_INVALID_RETURN_VALUE("nully", "body", val);
              }
            },
            (err) => {
              destroyer(d, err);
            }
          );
          return d = new Duplexify({
            // TODO (ronag): highWaterMark?
            objectMode: true,
            readable: false,
            write,
            final(cb) {
              final(async () => {
                try {
                  await promise;
                  process.nextTick(cb, null);
                } catch (err) {
                  process.nextTick(cb, err);
                }
              });
            },
            destroy
          });
        }
        throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or AsyncFunction", name, value);
      }
      if (isBlob(body)) {
        return duplexify(body.arrayBuffer());
      }
      if (isIterable(body)) {
        return from(Duplexify, body, {
          // TODO (ronag): highWaterMark?
          objectMode: true,
          writable: false
        });
      }
      if (isReadableStream(body === null || body === void 0 ? void 0 : body.readable) && isWritableStream(body === null || body === void 0 ? void 0 : body.writable)) {
        return Duplexify.fromWeb(body);
      }
      if (typeof (body === null || body === void 0 ? void 0 : body.writable) === "object" || typeof (body === null || body === void 0 ? void 0 : body.readable) === "object") {
        const readable = body !== null && body !== void 0 && body.readable ? isReadableNodeStream(body === null || body === void 0 ? void 0 : body.readable) ? body === null || body === void 0 ? void 0 : body.readable : duplexify(body.readable) : void 0;
        const writable = body !== null && body !== void 0 && body.writable ? isWritableNodeStream(body === null || body === void 0 ? void 0 : body.writable) ? body === null || body === void 0 ? void 0 : body.writable : duplexify(body.writable) : void 0;
        return _duplexify({
          readable,
          writable
        });
      }
      const then = body === null || body === void 0 ? void 0 : body.then;
      if (typeof then === "function") {
        let d;
        FunctionPrototypeCall(
          then,
          body,
          (val) => {
            if (val != null) {
              d.push(val);
            }
            d.push(null);
          },
          (err) => {
            destroyer(d, err);
          }
        );
        return d = new Duplexify({
          objectMode: true,
          writable: false,
          read() {
          }
        });
      }
      throw new ERR_INVALID_ARG_TYPE(
        name,
        [
          "Blob",
          "ReadableStream",
          "WritableStream",
          "Stream",
          "Iterable",
          "AsyncIterable",
          "Function",
          "{ readable, writable } pair",
          "Promise"
        ],
        body
      );
    };
    function fromAsyncGen(fn) {
      let { promise, resolve } = createDeferredPromise();
      const ac = new AbortController();
      const signal = ac.signal;
      const value = fn(
        (async function* () {
          while (true) {
            const _promise = promise;
            promise = null;
            const { chunk, done, cb } = await _promise;
            process.nextTick(cb);
            if (done) return;
            if (signal.aborted)
              throw new AbortError(void 0, {
                cause: signal.reason
              });
            ({ promise, resolve } = createDeferredPromise());
            yield chunk;
          }
        })(),
        {
          signal
        }
      );
      return {
        value,
        write(chunk, encoding, cb) {
          const _resolve = resolve;
          resolve = null;
          _resolve({
            chunk,
            done: false,
            cb
          });
        },
        final(cb) {
          const _resolve = resolve;
          resolve = null;
          _resolve({
            done: true,
            cb
          });
        },
        destroy(err, cb) {
          ac.abort();
          cb(err);
        }
      };
    }
    function _duplexify(pair) {
      const r = pair.readable && typeof pair.readable.read !== "function" ? Readable.wrap(pair.readable) : pair.readable;
      const w = pair.writable;
      let readable = !!isReadable(r);
      let writable = !!isWritable(w);
      let ondrain;
      let onfinish;
      let onreadable;
      let onclose;
      let d;
      function onfinished(err) {
        const cb = onclose;
        onclose = null;
        if (cb) {
          cb(err);
        } else if (err) {
          d.destroy(err);
        }
      }
      d = new Duplexify({
        // TODO (ronag): highWaterMark?
        readableObjectMode: !!(r !== null && r !== void 0 && r.readableObjectMode),
        writableObjectMode: !!(w !== null && w !== void 0 && w.writableObjectMode),
        readable,
        writable
      });
      if (writable) {
        eos(w, (err) => {
          writable = false;
          if (err) {
            destroyer(r, err);
          }
          onfinished(err);
        });
        d._write = function(chunk, encoding, callback) {
          if (w.write(chunk, encoding)) {
            callback();
          } else {
            ondrain = callback;
          }
        };
        d._final = function(callback) {
          w.end();
          onfinish = callback;
        };
        w.on("drain", function() {
          if (ondrain) {
            const cb = ondrain;
            ondrain = null;
            cb();
          }
        });
        w.on("finish", function() {
          if (onfinish) {
            const cb = onfinish;
            onfinish = null;
            cb();
          }
        });
      }
      if (readable) {
        eos(r, (err) => {
          readable = false;
          if (err) {
            destroyer(r, err);
          }
          onfinished(err);
        });
        r.on("readable", function() {
          if (onreadable) {
            const cb = onreadable;
            onreadable = null;
            cb();
          }
        });
        r.on("end", function() {
          d.push(null);
        });
        d._read = function() {
          while (true) {
            const buf = r.read();
            if (buf === null) {
              onreadable = d._read;
              return;
            }
            if (!d.push(buf)) {
              return;
            }
          }
        };
      }
      d._destroy = function(err, callback) {
        if (!err && onclose !== null) {
          err = new AbortError();
        }
        onreadable = null;
        ondrain = null;
        onfinish = null;
        if (onclose === null) {
          callback(err);
        } else {
          onclose = callback;
          destroyer(w, err);
          destroyer(r, err);
        }
      };
      return d;
    }
  }
});

// node_modules/readable-stream/lib/internal/streams/duplex.js
var require_duplex = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/duplex.js"(exports, module) {
    "use strict";
    var {
      ObjectDefineProperties,
      ObjectGetOwnPropertyDescriptor,
      ObjectKeys,
      ObjectSetPrototypeOf
    } = require_primordials();
    module.exports = Duplex;
    var Readable = require_readable();
    var Writable = require_writable();
    ObjectSetPrototypeOf(Duplex.prototype, Readable.prototype);
    ObjectSetPrototypeOf(Duplex, Readable);
    {
      const keys = ObjectKeys(Writable.prototype);
      for (let i = 0; i < keys.length; i++) {
        const method = keys[i];
        if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
      }
    }
    function Duplex(options) {
      if (!(this instanceof Duplex)) return new Duplex(options);
      Readable.call(this, options);
      Writable.call(this, options);
      if (options) {
        this.allowHalfOpen = options.allowHalfOpen !== false;
        if (options.readable === false) {
          this._readableState.readable = false;
          this._readableState.ended = true;
          this._readableState.endEmitted = true;
        }
        if (options.writable === false) {
          this._writableState.writable = false;
          this._writableState.ending = true;
          this._writableState.ended = true;
          this._writableState.finished = true;
        }
      } else {
        this.allowHalfOpen = true;
      }
    }
    ObjectDefineProperties(Duplex.prototype, {
      writable: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writable")
      },
      writableHighWaterMark: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableHighWaterMark")
      },
      writableObjectMode: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableObjectMode")
      },
      writableBuffer: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableBuffer")
      },
      writableLength: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableLength")
      },
      writableFinished: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableFinished")
      },
      writableCorked: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableCorked")
      },
      writableEnded: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableEnded")
      },
      writableNeedDrain: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableNeedDrain")
      },
      destroyed: {
        __proto__: null,
        get() {
          if (this._readableState === void 0 || this._writableState === void 0) {
            return false;
          }
          return this._readableState.destroyed && this._writableState.destroyed;
        },
        set(value) {
          if (this._readableState && this._writableState) {
            this._readableState.destroyed = value;
            this._writableState.destroyed = value;
          }
        }
      }
    });
    var webStreamsAdapters;
    function lazyWebStreams() {
      if (webStreamsAdapters === void 0) webStreamsAdapters = {};
      return webStreamsAdapters;
    }
    Duplex.fromWeb = function(pair, options) {
      return lazyWebStreams().newStreamDuplexFromReadableWritablePair(pair, options);
    };
    Duplex.toWeb = function(duplex) {
      return lazyWebStreams().newReadableWritablePairFromDuplex(duplex);
    };
    var duplexify;
    Duplex.from = function(body) {
      if (!duplexify) {
        duplexify = require_duplexify();
      }
      return duplexify(body, "body");
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/transform.js
var require_transform = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/transform.js"(exports, module) {
    "use strict";
    var { ObjectSetPrototypeOf, Symbol: Symbol2 } = require_primordials();
    module.exports = Transform;
    var { ERR_METHOD_NOT_IMPLEMENTED } = require_errors().codes;
    var Duplex = require_duplex();
    var { getHighWaterMark } = require_state();
    ObjectSetPrototypeOf(Transform.prototype, Duplex.prototype);
    ObjectSetPrototypeOf(Transform, Duplex);
    var kCallback = Symbol2("kCallback");
    function Transform(options) {
      if (!(this instanceof Transform)) return new Transform(options);
      const readableHighWaterMark = options ? getHighWaterMark(this, options, "readableHighWaterMark", true) : null;
      if (readableHighWaterMark === 0) {
        options = {
          ...options,
          highWaterMark: null,
          readableHighWaterMark,
          // TODO (ronag): 0 is not optimal since we have
          // a "bug" where we check needDrain before calling _write and not after.
          // Refs: https://github.com/nodejs/node/pull/32887
          // Refs: https://github.com/nodejs/node/pull/35941
          writableHighWaterMark: options.writableHighWaterMark || 0
        };
      }
      Duplex.call(this, options);
      this._readableState.sync = false;
      this[kCallback] = null;
      if (options) {
        if (typeof options.transform === "function") this._transform = options.transform;
        if (typeof options.flush === "function") this._flush = options.flush;
      }
      this.on("prefinish", prefinish);
    }
    function final(cb) {
      if (typeof this._flush === "function" && !this.destroyed) {
        this._flush((er, data) => {
          if (er) {
            if (cb) {
              cb(er);
            } else {
              this.destroy(er);
            }
            return;
          }
          if (data != null) {
            this.push(data);
          }
          this.push(null);
          if (cb) {
            cb();
          }
        });
      } else {
        this.push(null);
        if (cb) {
          cb();
        }
      }
    }
    function prefinish() {
      if (this._final !== final) {
        final.call(this);
      }
    }
    Transform.prototype._final = final;
    Transform.prototype._transform = function(chunk, encoding, callback) {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_transform()");
    };
    Transform.prototype._write = function(chunk, encoding, callback) {
      const rState = this._readableState;
      const wState = this._writableState;
      const length = rState.length;
      this._transform(chunk, encoding, (err, val) => {
        if (err) {
          callback(err);
          return;
        }
        if (val != null) {
          this.push(val);
        }
        if (wState.ended || // Backwards compat.
        length === rState.length || // Backwards compat.
        rState.length < rState.highWaterMark) {
          callback();
        } else {
          this[kCallback] = callback;
        }
      });
    };
    Transform.prototype._read = function() {
      if (this[kCallback]) {
        const callback = this[kCallback];
        this[kCallback] = null;
        callback();
      }
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/passthrough.js
var require_passthrough = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/passthrough.js"(exports, module) {
    "use strict";
    var { ObjectSetPrototypeOf } = require_primordials();
    module.exports = PassThrough;
    var Transform = require_transform();
    ObjectSetPrototypeOf(PassThrough.prototype, Transform.prototype);
    ObjectSetPrototypeOf(PassThrough, Transform);
    function PassThrough(options) {
      if (!(this instanceof PassThrough)) return new PassThrough(options);
      Transform.call(this, options);
    }
    PassThrough.prototype._transform = function(chunk, encoding, cb) {
      cb(null, chunk);
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/pipeline.js
var require_pipeline = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/pipeline.js"(exports, module) {
    var process = require_browser2();
    var { ArrayIsArray, Promise: Promise2, SymbolAsyncIterator, SymbolDispose } = require_primordials();
    var eos = require_end_of_stream();
    var { once } = require_util();
    var destroyImpl = require_destroy();
    var Duplex = require_duplex();
    var {
      aggregateTwoErrors,
      codes: {
        ERR_INVALID_ARG_TYPE,
        ERR_INVALID_RETURN_VALUE,
        ERR_MISSING_ARGS,
        ERR_STREAM_DESTROYED,
        ERR_STREAM_PREMATURE_CLOSE
      },
      AbortError
    } = require_errors();
    var { validateFunction, validateAbortSignal } = require_validators();
    var {
      isIterable,
      isReadable,
      isReadableNodeStream,
      isNodeStream,
      isTransformStream,
      isWebStream,
      isReadableStream,
      isReadableFinished
    } = require_utils();
    var AbortController = globalThis.AbortController || require_browser().AbortController;
    var PassThrough;
    var Readable;
    var addAbortListener;
    function destroyer(stream, reading, writing) {
      let finished = false;
      stream.on("close", () => {
        finished = true;
      });
      const cleanup = eos(
        stream,
        {
          readable: reading,
          writable: writing
        },
        (err) => {
          finished = !err;
        }
      );
      return {
        destroy: (err) => {
          if (finished) return;
          finished = true;
          destroyImpl.destroyer(stream, err || new ERR_STREAM_DESTROYED("pipe"));
        },
        cleanup
      };
    }
    function popCallback(streams) {
      validateFunction(streams[streams.length - 1], "streams[stream.length - 1]");
      return streams.pop();
    }
    function makeAsyncIterable(val) {
      if (isIterable(val)) {
        return val;
      } else if (isReadableNodeStream(val)) {
        return fromReadable(val);
      }
      throw new ERR_INVALID_ARG_TYPE("val", ["Readable", "Iterable", "AsyncIterable"], val);
    }
    async function* fromReadable(val) {
      if (!Readable) {
        Readable = require_readable();
      }
      yield* Readable.prototype[SymbolAsyncIterator].call(val);
    }
    async function pumpToNode(iterable, writable, finish, { end }) {
      let error;
      let onresolve = null;
      const resume = (err) => {
        if (err) {
          error = err;
        }
        if (onresolve) {
          const callback = onresolve;
          onresolve = null;
          callback();
        }
      };
      const wait = () => new Promise2((resolve, reject) => {
        if (error) {
          reject(error);
        } else {
          onresolve = () => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          };
        }
      });
      writable.on("drain", resume);
      const cleanup = eos(
        writable,
        {
          readable: false
        },
        resume
      );
      try {
        if (writable.writableNeedDrain) {
          await wait();
        }
        for await (const chunk of iterable) {
          if (!writable.write(chunk)) {
            await wait();
          }
        }
        if (end) {
          writable.end();
          await wait();
        }
        finish();
      } catch (err) {
        finish(error !== err ? aggregateTwoErrors(error, err) : err);
      } finally {
        cleanup();
        writable.off("drain", resume);
      }
    }
    async function pumpToWeb(readable, writable, finish, { end }) {
      if (isTransformStream(writable)) {
        writable = writable.writable;
      }
      const writer = writable.getWriter();
      try {
        for await (const chunk of readable) {
          await writer.ready;
          writer.write(chunk).catch(() => {
          });
        }
        await writer.ready;
        if (end) {
          await writer.close();
        }
        finish();
      } catch (err) {
        try {
          await writer.abort(err);
          finish(err);
        } catch (err2) {
          finish(err2);
        }
      }
    }
    function pipeline(...streams) {
      return pipelineImpl(streams, once(popCallback(streams)));
    }
    function pipelineImpl(streams, callback, opts) {
      if (streams.length === 1 && ArrayIsArray(streams[0])) {
        streams = streams[0];
      }
      if (streams.length < 2) {
        throw new ERR_MISSING_ARGS("streams");
      }
      const ac = new AbortController();
      const signal = ac.signal;
      const outerSignal = opts === null || opts === void 0 ? void 0 : opts.signal;
      const lastStreamCleanup = [];
      validateAbortSignal(outerSignal, "options.signal");
      function abort() {
        finishImpl(new AbortError());
      }
      addAbortListener = addAbortListener || require_util().addAbortListener;
      let disposable;
      if (outerSignal) {
        disposable = addAbortListener(outerSignal, abort);
      }
      let error;
      let value;
      const destroys = [];
      let finishCount = 0;
      function finish(err) {
        finishImpl(err, --finishCount === 0);
      }
      function finishImpl(err, final) {
        var _disposable;
        if (err && (!error || error.code === "ERR_STREAM_PREMATURE_CLOSE")) {
          error = err;
        }
        if (!error && !final) {
          return;
        }
        while (destroys.length) {
          destroys.shift()(error);
        }
        ;
        (_disposable = disposable) === null || _disposable === void 0 ? void 0 : _disposable[SymbolDispose]();
        ac.abort();
        if (final) {
          if (!error) {
            lastStreamCleanup.forEach((fn) => fn());
          }
          process.nextTick(callback, error, value);
        }
      }
      let ret;
      for (let i = 0; i < streams.length; i++) {
        const stream = streams[i];
        const reading = i < streams.length - 1;
        const writing = i > 0;
        const end = reading || (opts === null || opts === void 0 ? void 0 : opts.end) !== false;
        const isLastStream = i === streams.length - 1;
        if (isNodeStream(stream)) {
          let onError2 = function(err) {
            if (err && err.name !== "AbortError" && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
              finish(err);
            }
          };
          var onError = onError2;
          if (end) {
            const { destroy, cleanup } = destroyer(stream, reading, writing);
            destroys.push(destroy);
            if (isReadable(stream) && isLastStream) {
              lastStreamCleanup.push(cleanup);
            }
          }
          stream.on("error", onError2);
          if (isReadable(stream) && isLastStream) {
            lastStreamCleanup.push(() => {
              stream.removeListener("error", onError2);
            });
          }
        }
        if (i === 0) {
          if (typeof stream === "function") {
            ret = stream({
              signal
            });
            if (!isIterable(ret)) {
              throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or Stream", "source", ret);
            }
          } else if (isIterable(stream) || isReadableNodeStream(stream) || isTransformStream(stream)) {
            ret = stream;
          } else {
            ret = Duplex.from(stream);
          }
        } else if (typeof stream === "function") {
          if (isTransformStream(ret)) {
            var _ret;
            ret = makeAsyncIterable((_ret = ret) === null || _ret === void 0 ? void 0 : _ret.readable);
          } else {
            ret = makeAsyncIterable(ret);
          }
          ret = stream(ret, {
            signal
          });
          if (reading) {
            if (!isIterable(ret, true)) {
              throw new ERR_INVALID_RETURN_VALUE("AsyncIterable", `transform[${i - 1}]`, ret);
            }
          } else {
            var _ret2;
            if (!PassThrough) {
              PassThrough = require_passthrough();
            }
            const pt = new PassThrough({
              objectMode: true
            });
            const then = (_ret2 = ret) === null || _ret2 === void 0 ? void 0 : _ret2.then;
            if (typeof then === "function") {
              finishCount++;
              then.call(
                ret,
                (val) => {
                  value = val;
                  if (val != null) {
                    pt.write(val);
                  }
                  if (end) {
                    pt.end();
                  }
                  process.nextTick(finish);
                },
                (err) => {
                  pt.destroy(err);
                  process.nextTick(finish, err);
                }
              );
            } else if (isIterable(ret, true)) {
              finishCount++;
              pumpToNode(ret, pt, finish, {
                end
              });
            } else if (isReadableStream(ret) || isTransformStream(ret)) {
              const toRead = ret.readable || ret;
              finishCount++;
              pumpToNode(toRead, pt, finish, {
                end
              });
            } else {
              throw new ERR_INVALID_RETURN_VALUE("AsyncIterable or Promise", "destination", ret);
            }
            ret = pt;
            const { destroy, cleanup } = destroyer(ret, false, true);
            destroys.push(destroy);
            if (isLastStream) {
              lastStreamCleanup.push(cleanup);
            }
          }
        } else if (isNodeStream(stream)) {
          if (isReadableNodeStream(ret)) {
            finishCount += 2;
            const cleanup = pipe(ret, stream, finish, {
              end
            });
            if (isReadable(stream) && isLastStream) {
              lastStreamCleanup.push(cleanup);
            }
          } else if (isTransformStream(ret) || isReadableStream(ret)) {
            const toRead = ret.readable || ret;
            finishCount++;
            pumpToNode(toRead, stream, finish, {
              end
            });
          } else if (isIterable(ret)) {
            finishCount++;
            pumpToNode(ret, stream, finish, {
              end
            });
          } else {
            throw new ERR_INVALID_ARG_TYPE(
              "val",
              ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
              ret
            );
          }
          ret = stream;
        } else if (isWebStream(stream)) {
          if (isReadableNodeStream(ret)) {
            finishCount++;
            pumpToWeb(makeAsyncIterable(ret), stream, finish, {
              end
            });
          } else if (isReadableStream(ret) || isIterable(ret)) {
            finishCount++;
            pumpToWeb(ret, stream, finish, {
              end
            });
          } else if (isTransformStream(ret)) {
            finishCount++;
            pumpToWeb(ret.readable, stream, finish, {
              end
            });
          } else {
            throw new ERR_INVALID_ARG_TYPE(
              "val",
              ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
              ret
            );
          }
          ret = stream;
        } else {
          ret = Duplex.from(stream);
        }
      }
      if (signal !== null && signal !== void 0 && signal.aborted || outerSignal !== null && outerSignal !== void 0 && outerSignal.aborted) {
        process.nextTick(abort);
      }
      return ret;
    }
    function pipe(src, dst, finish, { end }) {
      let ended = false;
      dst.on("close", () => {
        if (!ended) {
          finish(new ERR_STREAM_PREMATURE_CLOSE());
        }
      });
      src.pipe(dst, {
        end: false
      });
      if (end) {
        let endFn2 = function() {
          ended = true;
          dst.end();
        };
        var endFn = endFn2;
        if (isReadableFinished(src)) {
          process.nextTick(endFn2);
        } else {
          src.once("end", endFn2);
        }
      } else {
        finish();
      }
      eos(
        src,
        {
          readable: true,
          writable: false
        },
        (err) => {
          const rState = src._readableState;
          if (err && err.code === "ERR_STREAM_PREMATURE_CLOSE" && rState && rState.ended && !rState.errored && !rState.errorEmitted) {
            src.once("end", finish).once("error", finish);
          } else {
            finish(err);
          }
        }
      );
      return eos(
        dst,
        {
          readable: false,
          writable: true
        },
        finish
      );
    }
    module.exports = {
      pipelineImpl,
      pipeline
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/compose.js
var require_compose = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/compose.js"(exports, module) {
    "use strict";
    var { pipeline } = require_pipeline();
    var Duplex = require_duplex();
    var { destroyer } = require_destroy();
    var {
      isNodeStream,
      isReadable,
      isWritable,
      isWebStream,
      isTransformStream,
      isWritableStream,
      isReadableStream
    } = require_utils();
    var {
      AbortError,
      codes: { ERR_INVALID_ARG_VALUE, ERR_MISSING_ARGS }
    } = require_errors();
    var eos = require_end_of_stream();
    module.exports = function compose(...streams) {
      if (streams.length === 0) {
        throw new ERR_MISSING_ARGS("streams");
      }
      if (streams.length === 1) {
        return Duplex.from(streams[0]);
      }
      const orgStreams = [...streams];
      if (typeof streams[0] === "function") {
        streams[0] = Duplex.from(streams[0]);
      }
      if (typeof streams[streams.length - 1] === "function") {
        const idx = streams.length - 1;
        streams[idx] = Duplex.from(streams[idx]);
      }
      for (let n = 0; n < streams.length; ++n) {
        if (!isNodeStream(streams[n]) && !isWebStream(streams[n])) {
          continue;
        }
        if (n < streams.length - 1 && !(isReadable(streams[n]) || isReadableStream(streams[n]) || isTransformStream(streams[n]))) {
          throw new ERR_INVALID_ARG_VALUE(`streams[${n}]`, orgStreams[n], "must be readable");
        }
        if (n > 0 && !(isWritable(streams[n]) || isWritableStream(streams[n]) || isTransformStream(streams[n]))) {
          throw new ERR_INVALID_ARG_VALUE(`streams[${n}]`, orgStreams[n], "must be writable");
        }
      }
      let ondrain;
      let onfinish;
      let onreadable;
      let onclose;
      let d;
      function onfinished(err) {
        const cb = onclose;
        onclose = null;
        if (cb) {
          cb(err);
        } else if (err) {
          d.destroy(err);
        } else if (!readable && !writable) {
          d.destroy();
        }
      }
      const head = streams[0];
      const tail = pipeline(streams, onfinished);
      const writable = !!(isWritable(head) || isWritableStream(head) || isTransformStream(head));
      const readable = !!(isReadable(tail) || isReadableStream(tail) || isTransformStream(tail));
      d = new Duplex({
        // TODO (ronag): highWaterMark?
        writableObjectMode: !!(head !== null && head !== void 0 && head.writableObjectMode),
        readableObjectMode: !!(tail !== null && tail !== void 0 && tail.readableObjectMode),
        writable,
        readable
      });
      if (writable) {
        if (isNodeStream(head)) {
          d._write = function(chunk, encoding, callback) {
            if (head.write(chunk, encoding)) {
              callback();
            } else {
              ondrain = callback;
            }
          };
          d._final = function(callback) {
            head.end();
            onfinish = callback;
          };
          head.on("drain", function() {
            if (ondrain) {
              const cb = ondrain;
              ondrain = null;
              cb();
            }
          });
        } else if (isWebStream(head)) {
          const writable2 = isTransformStream(head) ? head.writable : head;
          const writer = writable2.getWriter();
          d._write = async function(chunk, encoding, callback) {
            try {
              await writer.ready;
              writer.write(chunk).catch(() => {
              });
              callback();
            } catch (err) {
              callback(err);
            }
          };
          d._final = async function(callback) {
            try {
              await writer.ready;
              writer.close().catch(() => {
              });
              onfinish = callback;
            } catch (err) {
              callback(err);
            }
          };
        }
        const toRead = isTransformStream(tail) ? tail.readable : tail;
        eos(toRead, () => {
          if (onfinish) {
            const cb = onfinish;
            onfinish = null;
            cb();
          }
        });
      }
      if (readable) {
        if (isNodeStream(tail)) {
          tail.on("readable", function() {
            if (onreadable) {
              const cb = onreadable;
              onreadable = null;
              cb();
            }
          });
          tail.on("end", function() {
            d.push(null);
          });
          d._read = function() {
            while (true) {
              const buf = tail.read();
              if (buf === null) {
                onreadable = d._read;
                return;
              }
              if (!d.push(buf)) {
                return;
              }
            }
          };
        } else if (isWebStream(tail)) {
          const readable2 = isTransformStream(tail) ? tail.readable : tail;
          const reader = readable2.getReader();
          d._read = async function() {
            while (true) {
              try {
                const { value, done } = await reader.read();
                if (!d.push(value)) {
                  return;
                }
                if (done) {
                  d.push(null);
                  return;
                }
              } catch {
                return;
              }
            }
          };
        }
      }
      d._destroy = function(err, callback) {
        if (!err && onclose !== null) {
          err = new AbortError();
        }
        onreadable = null;
        ondrain = null;
        onfinish = null;
        if (onclose === null) {
          callback(err);
        } else {
          onclose = callback;
          if (isNodeStream(tail)) {
            destroyer(tail, err);
          }
        }
      };
      return d;
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/operators.js
var require_operators = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/operators.js"(exports, module) {
    "use strict";
    var AbortController = globalThis.AbortController || require_browser().AbortController;
    var {
      codes: { ERR_INVALID_ARG_VALUE, ERR_INVALID_ARG_TYPE, ERR_MISSING_ARGS, ERR_OUT_OF_RANGE },
      AbortError
    } = require_errors();
    var { validateAbortSignal, validateInteger, validateObject } = require_validators();
    var kWeakHandler = require_primordials().Symbol("kWeak");
    var kResistStopPropagation = require_primordials().Symbol("kResistStopPropagation");
    var { finished } = require_end_of_stream();
    var staticCompose = require_compose();
    var { addAbortSignalNoValidate } = require_add_abort_signal();
    var { isWritable, isNodeStream } = require_utils();
    var { deprecate } = require_util();
    var {
      ArrayPrototypePush,
      Boolean: Boolean2,
      MathFloor,
      Number: Number2,
      NumberIsNaN,
      Promise: Promise2,
      PromiseReject,
      PromiseResolve,
      PromisePrototypeThen,
      Symbol: Symbol2
    } = require_primordials();
    var kEmpty = Symbol2("kEmpty");
    var kEof = Symbol2("kEof");
    function compose(stream, options) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      if (isNodeStream(stream) && !isWritable(stream)) {
        throw new ERR_INVALID_ARG_VALUE("stream", stream, "must be writable");
      }
      const composedStream = staticCompose(this, stream);
      if (options !== null && options !== void 0 && options.signal) {
        addAbortSignalNoValidate(options.signal, composedStream);
      }
      return composedStream;
    }
    function map(fn, options) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      let concurrency = 1;
      if ((options === null || options === void 0 ? void 0 : options.concurrency) != null) {
        concurrency = MathFloor(options.concurrency);
      }
      let highWaterMark = concurrency - 1;
      if ((options === null || options === void 0 ? void 0 : options.highWaterMark) != null) {
        highWaterMark = MathFloor(options.highWaterMark);
      }
      validateInteger(concurrency, "options.concurrency", 1);
      validateInteger(highWaterMark, "options.highWaterMark", 0);
      highWaterMark += concurrency;
      return async function* map2() {
        const signal = require_util().AbortSignalAny(
          [options === null || options === void 0 ? void 0 : options.signal].filter(Boolean2)
        );
        const stream = this;
        const queue = [];
        const signalOpt = {
          signal
        };
        let next;
        let resume;
        let done = false;
        let cnt = 0;
        function onCatch() {
          done = true;
          afterItemProcessed();
        }
        function afterItemProcessed() {
          cnt -= 1;
          maybeResume();
        }
        function maybeResume() {
          if (resume && !done && cnt < concurrency && queue.length < highWaterMark) {
            resume();
            resume = null;
          }
        }
        async function pump() {
          try {
            for await (let val of stream) {
              if (done) {
                return;
              }
              if (signal.aborted) {
                throw new AbortError();
              }
              try {
                val = fn(val, signalOpt);
                if (val === kEmpty) {
                  continue;
                }
                val = PromiseResolve(val);
              } catch (err) {
                val = PromiseReject(err);
              }
              cnt += 1;
              PromisePrototypeThen(val, afterItemProcessed, onCatch);
              queue.push(val);
              if (next) {
                next();
                next = null;
              }
              if (!done && (queue.length >= highWaterMark || cnt >= concurrency)) {
                await new Promise2((resolve) => {
                  resume = resolve;
                });
              }
            }
            queue.push(kEof);
          } catch (err) {
            const val = PromiseReject(err);
            PromisePrototypeThen(val, afterItemProcessed, onCatch);
            queue.push(val);
          } finally {
            done = true;
            if (next) {
              next();
              next = null;
            }
          }
        }
        pump();
        try {
          while (true) {
            while (queue.length > 0) {
              const val = await queue[0];
              if (val === kEof) {
                return;
              }
              if (signal.aborted) {
                throw new AbortError();
              }
              if (val !== kEmpty) {
                yield val;
              }
              queue.shift();
              maybeResume();
            }
            await new Promise2((resolve) => {
              next = resolve;
            });
          }
        } finally {
          done = true;
          if (resume) {
            resume();
            resume = null;
          }
        }
      }.call(this);
    }
    function asIndexedPairs(options = void 0) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      return async function* asIndexedPairs2() {
        let index = 0;
        for await (const val of this) {
          var _options$signal;
          if (options !== null && options !== void 0 && (_options$signal = options.signal) !== null && _options$signal !== void 0 && _options$signal.aborted) {
            throw new AbortError({
              cause: options.signal.reason
            });
          }
          yield [index++, val];
        }
      }.call(this);
    }
    async function some(fn, options = void 0) {
      for await (const unused of filter.call(this, fn, options)) {
        return true;
      }
      return false;
    }
    async function every(fn, options = void 0) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      return !await some.call(
        this,
        async (...args) => {
          return !await fn(...args);
        },
        options
      );
    }
    async function find(fn, options) {
      for await (const result of filter.call(this, fn, options)) {
        return result;
      }
      return void 0;
    }
    async function forEach(fn, options) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      async function forEachFn(value, options2) {
        await fn(value, options2);
        return kEmpty;
      }
      for await (const unused of map.call(this, forEachFn, options)) ;
    }
    function filter(fn, options) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      async function filterFn(value, options2) {
        if (await fn(value, options2)) {
          return value;
        }
        return kEmpty;
      }
      return map.call(this, filterFn, options);
    }
    var ReduceAwareErrMissingArgs = class extends ERR_MISSING_ARGS {
      constructor() {
        super("reduce");
        this.message = "Reduce of an empty stream requires an initial value";
      }
    };
    async function reduce(reducer, initialValue, options) {
      var _options$signal2;
      if (typeof reducer !== "function") {
        throw new ERR_INVALID_ARG_TYPE("reducer", ["Function", "AsyncFunction"], reducer);
      }
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      let hasInitialValue = arguments.length > 1;
      if (options !== null && options !== void 0 && (_options$signal2 = options.signal) !== null && _options$signal2 !== void 0 && _options$signal2.aborted) {
        const err = new AbortError(void 0, {
          cause: options.signal.reason
        });
        this.once("error", () => {
        });
        await finished(this.destroy(err));
        throw err;
      }
      const ac = new AbortController();
      const signal = ac.signal;
      if (options !== null && options !== void 0 && options.signal) {
        const opts = {
          once: true,
          [kWeakHandler]: this,
          [kResistStopPropagation]: true
        };
        options.signal.addEventListener("abort", () => ac.abort(), opts);
      }
      let gotAnyItemFromStream = false;
      try {
        for await (const value of this) {
          var _options$signal3;
          gotAnyItemFromStream = true;
          if (options !== null && options !== void 0 && (_options$signal3 = options.signal) !== null && _options$signal3 !== void 0 && _options$signal3.aborted) {
            throw new AbortError();
          }
          if (!hasInitialValue) {
            initialValue = value;
            hasInitialValue = true;
          } else {
            initialValue = await reducer(initialValue, value, {
              signal
            });
          }
        }
        if (!gotAnyItemFromStream && !hasInitialValue) {
          throw new ReduceAwareErrMissingArgs();
        }
      } finally {
        ac.abort();
      }
      return initialValue;
    }
    async function toArray(options) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      const result = [];
      for await (const val of this) {
        var _options$signal4;
        if (options !== null && options !== void 0 && (_options$signal4 = options.signal) !== null && _options$signal4 !== void 0 && _options$signal4.aborted) {
          throw new AbortError(void 0, {
            cause: options.signal.reason
          });
        }
        ArrayPrototypePush(result, val);
      }
      return result;
    }
    function flatMap(fn, options) {
      const values = map.call(this, fn, options);
      return async function* flatMap2() {
        for await (const val of values) {
          yield* val;
        }
      }.call(this);
    }
    function toIntegerOrInfinity(number) {
      number = Number2(number);
      if (NumberIsNaN(number)) {
        return 0;
      }
      if (number < 0) {
        throw new ERR_OUT_OF_RANGE("number", ">= 0", number);
      }
      return number;
    }
    function drop(number, options = void 0) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      number = toIntegerOrInfinity(number);
      return async function* drop2() {
        var _options$signal5;
        if (options !== null && options !== void 0 && (_options$signal5 = options.signal) !== null && _options$signal5 !== void 0 && _options$signal5.aborted) {
          throw new AbortError();
        }
        for await (const val of this) {
          var _options$signal6;
          if (options !== null && options !== void 0 && (_options$signal6 = options.signal) !== null && _options$signal6 !== void 0 && _options$signal6.aborted) {
            throw new AbortError();
          }
          if (number-- <= 0) {
            yield val;
          }
        }
      }.call(this);
    }
    function take(number, options = void 0) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      number = toIntegerOrInfinity(number);
      return async function* take2() {
        var _options$signal7;
        if (options !== null && options !== void 0 && (_options$signal7 = options.signal) !== null && _options$signal7 !== void 0 && _options$signal7.aborted) {
          throw new AbortError();
        }
        for await (const val of this) {
          var _options$signal8;
          if (options !== null && options !== void 0 && (_options$signal8 = options.signal) !== null && _options$signal8 !== void 0 && _options$signal8.aborted) {
            throw new AbortError();
          }
          if (number-- > 0) {
            yield val;
          }
          if (number <= 0) {
            return;
          }
        }
      }.call(this);
    }
    module.exports.streamReturningOperators = {
      asIndexedPairs: deprecate(asIndexedPairs, "readable.asIndexedPairs will be removed in a future version."),
      drop,
      filter,
      flatMap,
      map,
      take,
      compose
    };
    module.exports.promiseReturningOperators = {
      every,
      forEach,
      reduce,
      toArray,
      some,
      find
    };
  }
});

// node_modules/readable-stream/lib/stream/promises.js
var require_promises = __commonJS({
  "node_modules/readable-stream/lib/stream/promises.js"(exports, module) {
    "use strict";
    var { ArrayPrototypePop, Promise: Promise2 } = require_primordials();
    var { isIterable, isNodeStream, isWebStream } = require_utils();
    var { pipelineImpl: pl } = require_pipeline();
    var { finished } = require_end_of_stream();
    require_stream();
    function pipeline(...streams) {
      return new Promise2((resolve, reject) => {
        let signal;
        let end;
        const lastArg = streams[streams.length - 1];
        if (lastArg && typeof lastArg === "object" && !isNodeStream(lastArg) && !isIterable(lastArg) && !isWebStream(lastArg)) {
          const options = ArrayPrototypePop(streams);
          signal = options.signal;
          end = options.end;
        }
        pl(
          streams,
          (err, value) => {
            if (err) {
              reject(err);
            } else {
              resolve(value);
            }
          },
          {
            signal,
            end
          }
        );
      });
    }
    module.exports = {
      finished,
      pipeline
    };
  }
});

// node_modules/readable-stream/lib/stream.js
var require_stream = __commonJS({
  "node_modules/readable-stream/lib/stream.js"(exports, module) {
    "use strict";
    var { Buffer: Buffer3 } = require_buffer();
    var { ObjectDefineProperty, ObjectKeys, ReflectApply } = require_primordials();
    var {
      promisify: { custom: customPromisify }
    } = require_util();
    var { streamReturningOperators, promiseReturningOperators } = require_operators();
    var {
      codes: { ERR_ILLEGAL_CONSTRUCTOR }
    } = require_errors();
    var compose = require_compose();
    var { setDefaultHighWaterMark, getDefaultHighWaterMark } = require_state();
    var { pipeline } = require_pipeline();
    var { destroyer } = require_destroy();
    var eos = require_end_of_stream();
    var promises = require_promises();
    var utils = require_utils();
    var Stream = module.exports = require_legacy().Stream;
    Stream.isDestroyed = utils.isDestroyed;
    Stream.isDisturbed = utils.isDisturbed;
    Stream.isErrored = utils.isErrored;
    Stream.isReadable = utils.isReadable;
    Stream.isWritable = utils.isWritable;
    Stream.Readable = require_readable();
    for (const key of ObjectKeys(streamReturningOperators)) {
      let fn = function(...args) {
        if (new.target) {
          throw ERR_ILLEGAL_CONSTRUCTOR();
        }
        return Stream.Readable.from(ReflectApply(op, this, args));
      };
      const op = streamReturningOperators[key];
      ObjectDefineProperty(fn, "name", {
        __proto__: null,
        value: op.name
      });
      ObjectDefineProperty(fn, "length", {
        __proto__: null,
        value: op.length
      });
      ObjectDefineProperty(Stream.Readable.prototype, key, {
        __proto__: null,
        value: fn,
        enumerable: false,
        configurable: true,
        writable: true
      });
    }
    for (const key of ObjectKeys(promiseReturningOperators)) {
      let fn = function(...args) {
        if (new.target) {
          throw ERR_ILLEGAL_CONSTRUCTOR();
        }
        return ReflectApply(op, this, args);
      };
      const op = promiseReturningOperators[key];
      ObjectDefineProperty(fn, "name", {
        __proto__: null,
        value: op.name
      });
      ObjectDefineProperty(fn, "length", {
        __proto__: null,
        value: op.length
      });
      ObjectDefineProperty(Stream.Readable.prototype, key, {
        __proto__: null,
        value: fn,
        enumerable: false,
        configurable: true,
        writable: true
      });
    }
    Stream.Writable = require_writable();
    Stream.Duplex = require_duplex();
    Stream.Transform = require_transform();
    Stream.PassThrough = require_passthrough();
    Stream.pipeline = pipeline;
    var { addAbortSignal } = require_add_abort_signal();
    Stream.addAbortSignal = addAbortSignal;
    Stream.finished = eos;
    Stream.destroy = destroyer;
    Stream.compose = compose;
    Stream.setDefaultHighWaterMark = setDefaultHighWaterMark;
    Stream.getDefaultHighWaterMark = getDefaultHighWaterMark;
    ObjectDefineProperty(Stream, "promises", {
      __proto__: null,
      configurable: true,
      enumerable: true,
      get() {
        return promises;
      }
    });
    ObjectDefineProperty(pipeline, customPromisify, {
      __proto__: null,
      enumerable: true,
      get() {
        return promises.pipeline;
      }
    });
    ObjectDefineProperty(eos, customPromisify, {
      __proto__: null,
      enumerable: true,
      get() {
        return promises.finished;
      }
    });
    Stream.Stream = Stream;
    Stream._isUint8Array = function isUint8Array(value) {
      return value instanceof Uint8Array;
    };
    Stream._uint8ArrayToBuffer = function _uint8ArrayToBuffer(chunk) {
      return Buffer3.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    };
  }
});

// node_modules/readable-stream/lib/ours/browser.js
var require_browser3 = __commonJS({
  "node_modules/readable-stream/lib/ours/browser.js"(exports, module) {
    "use strict";
    var CustomStream = require_stream();
    var promises = require_promises();
    var originalDestroy = CustomStream.Readable.destroy;
    module.exports = CustomStream.Readable;
    module.exports._uint8ArrayToBuffer = CustomStream._uint8ArrayToBuffer;
    module.exports._isUint8Array = CustomStream._isUint8Array;
    module.exports.isDisturbed = CustomStream.isDisturbed;
    module.exports.isErrored = CustomStream.isErrored;
    module.exports.isReadable = CustomStream.isReadable;
    module.exports.Readable = CustomStream.Readable;
    module.exports.Writable = CustomStream.Writable;
    module.exports.Duplex = CustomStream.Duplex;
    module.exports.Transform = CustomStream.Transform;
    module.exports.PassThrough = CustomStream.PassThrough;
    module.exports.addAbortSignal = CustomStream.addAbortSignal;
    module.exports.finished = CustomStream.finished;
    module.exports.destroy = CustomStream.destroy;
    module.exports.destroy = originalDestroy;
    module.exports.pipeline = CustomStream.pipeline;
    module.exports.compose = CustomStream.compose;
    Object.defineProperty(CustomStream, "promises", {
      configurable: true,
      enumerable: true,
      get() {
        return promises;
      }
    });
    module.exports.Stream = CustomStream.Stream;
    module.exports.default = module.exports;
  }
});

// node_modules/@bergos/jsonparse/jsonparse.js
var require_jsonparse = __commonJS({
  "node_modules/@bergos/jsonparse/jsonparse.js"(exports, module) {
    var { Buffer: Buffer3 } = require_buffer();
    var C = {};
    var LEFT_BRACE = C.LEFT_BRACE = 1;
    var RIGHT_BRACE = C.RIGHT_BRACE = 2;
    var LEFT_BRACKET = C.LEFT_BRACKET = 3;
    var RIGHT_BRACKET = C.RIGHT_BRACKET = 4;
    var COLON = C.COLON = 5;
    var COMMA = C.COMMA = 6;
    var TRUE = C.TRUE = 7;
    var FALSE = C.FALSE = 8;
    var NULL = C.NULL = 9;
    var STRING = C.STRING = 10;
    var NUMBER = C.NUMBER = 11;
    var START = C.START = 17;
    var STOP = C.STOP = 18;
    var TRUE1 = C.TRUE1 = 33;
    var TRUE2 = C.TRUE2 = 34;
    var TRUE3 = C.TRUE3 = 35;
    var FALSE1 = C.FALSE1 = 49;
    var FALSE2 = C.FALSE2 = 50;
    var FALSE3 = C.FALSE3 = 51;
    var FALSE4 = C.FALSE4 = 52;
    var NULL1 = C.NULL1 = 65;
    var NULL2 = C.NULL2 = 66;
    var NULL3 = C.NULL3 = 67;
    var NUMBER1 = C.NUMBER1 = 81;
    var NUMBER3 = C.NUMBER3 = 83;
    var STRING1 = C.STRING1 = 97;
    var STRING2 = C.STRING2 = 98;
    var STRING3 = C.STRING3 = 99;
    var STRING4 = C.STRING4 = 100;
    var STRING5 = C.STRING5 = 101;
    var STRING6 = C.STRING6 = 102;
    var VALUE = C.VALUE = 113;
    var KEY = C.KEY = 114;
    var OBJECT = C.OBJECT = 129;
    var ARRAY = C.ARRAY = 130;
    var BACK_SLASH = "\\".charCodeAt(0);
    var FORWARD_SLASH = "/".charCodeAt(0);
    var BACKSPACE = "\b".charCodeAt(0);
    var FORM_FEED = "\f".charCodeAt(0);
    var NEWLINE = "\n".charCodeAt(0);
    var CARRIAGE_RETURN = "\r".charCodeAt(0);
    var TAB = "	".charCodeAt(0);
    var STRING_BUFFER_SIZE = 64 * 1024;
    function alloc(size) {
      return Buffer3.alloc ? Buffer3.alloc(size) : new Buffer3(size);
    }
    function Parser() {
      this.tState = START;
      this.value = void 0;
      this.string = void 0;
      this.stringBuffer = alloc(STRING_BUFFER_SIZE);
      this.stringBufferOffset = 0;
      this.unicode = void 0;
      this.highSurrogate = void 0;
      this.key = void 0;
      this.mode = void 0;
      this.stack = [];
      this.state = VALUE;
      this.bytes_remaining = 0;
      this.bytes_in_sequence = 0;
      this.temp_buffs = { "2": alloc(2), "3": alloc(3), "4": alloc(4) };
      this.offset = -1;
    }
    Parser.toknam = function(code) {
      var keys = Object.keys(C);
      for (var i = 0, l = keys.length; i < l; i++) {
        var key = keys[i];
        if (C[key] === code) {
          return key;
        }
      }
      return code && "0x" + code.toString(16);
    };
    var proto = Parser.prototype;
    proto.onError = function(err) {
      throw err;
    };
    proto.charError = function(buffer, i) {
      this.tState = STOP;
      this.onError(new Error("Unexpected " + JSON.stringify(String.fromCharCode(buffer[i])) + " at position " + i + " in state " + Parser.toknam(this.tState)));
    };
    proto.appendStringChar = function(char) {
      if (this.stringBufferOffset >= STRING_BUFFER_SIZE) {
        this.string += this.stringBuffer.toString("utf8");
        this.stringBufferOffset = 0;
      }
      this.stringBuffer[this.stringBufferOffset++] = char;
    };
    proto.appendStringBuf = function(buf, start, end) {
      var size = buf.length;
      if (typeof start === "number") {
        if (typeof end === "number") {
          if (end < 0) {
            size = buf.length - start + end;
          } else {
            size = end - start;
          }
        } else {
          size = buf.length - start;
        }
      }
      if (size < 0) {
        size = 0;
      }
      if (this.stringBufferOffset + size > STRING_BUFFER_SIZE) {
        this.string += this.stringBuffer.toString("utf8", 0, this.stringBufferOffset);
        this.stringBufferOffset = 0;
      }
      buf.copy(this.stringBuffer, this.stringBufferOffset, start, end);
      this.stringBufferOffset += size;
    };
    proto.write = function(buffer) {
      if (typeof buffer === "string") buffer = new Buffer3(buffer);
      var n;
      for (var i = 0, l = buffer.length; i < l; i++) {
        if (this.tState === START) {
          n = buffer[i];
          this.offset++;
          if (n === 123) {
            this.onToken(LEFT_BRACE, "{");
          } else if (n === 125) {
            this.onToken(RIGHT_BRACE, "}");
          } else if (n === 91) {
            this.onToken(LEFT_BRACKET, "[");
          } else if (n === 93) {
            this.onToken(RIGHT_BRACKET, "]");
          } else if (n === 58) {
            this.onToken(COLON, ":");
          } else if (n === 44) {
            this.onToken(COMMA, ",");
          } else if (n === 116) {
            this.tState = TRUE1;
          } else if (n === 102) {
            this.tState = FALSE1;
          } else if (n === 110) {
            this.tState = NULL1;
          } else if (n === 34) {
            this.string = "";
            this.stringBufferOffset = 0;
            this.tState = STRING1;
          } else if (n === 45) {
            this.string = "-";
            this.tState = NUMBER1;
          } else {
            if (n >= 48 && n < 64) {
              this.string = String.fromCharCode(n);
              this.tState = NUMBER3;
            } else if (n === 32 || n === 9 || n === 10 || n === 13) {
            } else {
              return this.charError(buffer, i);
            }
          }
        } else if (this.tState === STRING1) {
          n = buffer[i];
          if (this.bytes_remaining > 0) {
            for (var j = 0; j < this.bytes_remaining; j++) {
              this.temp_buffs[this.bytes_in_sequence][this.bytes_in_sequence - this.bytes_remaining + j] = buffer[j];
            }
            this.appendStringBuf(this.temp_buffs[this.bytes_in_sequence]);
            this.bytes_in_sequence = this.bytes_remaining = 0;
            i = i + j - 1;
          } else if (this.bytes_remaining === 0 && n >= 128) {
            if (n <= 193 || n > 244) {
              return this.onError(new Error("Invalid UTF-8 character at position " + i + " in state " + Parser.toknam(this.tState)));
            }
            if (n >= 194 && n <= 223) this.bytes_in_sequence = 2;
            if (n >= 224 && n <= 239) this.bytes_in_sequence = 3;
            if (n >= 240 && n <= 244) this.bytes_in_sequence = 4;
            if (this.bytes_in_sequence + i > buffer.length) {
              for (var k = 0; k <= buffer.length - 1 - i; k++) {
                this.temp_buffs[this.bytes_in_sequence][k] = buffer[i + k];
              }
              this.bytes_remaining = i + this.bytes_in_sequence - buffer.length;
              i = buffer.length - 1;
            } else {
              this.appendStringBuf(buffer, i, i + this.bytes_in_sequence);
              i = i + this.bytes_in_sequence - 1;
            }
          } else if (n === 34) {
            this.tState = START;
            this.string += this.stringBuffer.toString("utf8", 0, this.stringBufferOffset);
            this.stringBufferOffset = 0;
            this.onToken(STRING, this.string);
            this.offset += Buffer3.byteLength(this.string, "utf8") + 1;
            this.string = void 0;
          } else if (n === 92) {
            this.tState = STRING2;
          } else if (n >= 32) {
            this.appendStringChar(n);
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === STRING2) {
          n = buffer[i];
          if (n === 34) {
            this.appendStringChar(n);
            this.tState = STRING1;
          } else if (n === 92) {
            this.appendStringChar(BACK_SLASH);
            this.tState = STRING1;
          } else if (n === 47) {
            this.appendStringChar(FORWARD_SLASH);
            this.tState = STRING1;
          } else if (n === 98) {
            this.appendStringChar(BACKSPACE);
            this.tState = STRING1;
          } else if (n === 102) {
            this.appendStringChar(FORM_FEED);
            this.tState = STRING1;
          } else if (n === 110) {
            this.appendStringChar(NEWLINE);
            this.tState = STRING1;
          } else if (n === 114) {
            this.appendStringChar(CARRIAGE_RETURN);
            this.tState = STRING1;
          } else if (n === 116) {
            this.appendStringChar(TAB);
            this.tState = STRING1;
          } else if (n === 117) {
            this.unicode = "";
            this.tState = STRING3;
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === STRING3 || this.tState === STRING4 || this.tState === STRING5 || this.tState === STRING6) {
          n = buffer[i];
          if (n >= 48 && n < 64 || n > 64 && n <= 70 || n > 96 && n <= 102) {
            this.unicode += String.fromCharCode(n);
            if (this.tState++ === STRING6) {
              var intVal = parseInt(this.unicode, 16);
              this.unicode = void 0;
              if (this.highSurrogate !== void 0 && intVal >= 56320 && intVal < 57343 + 1) {
                this.appendStringBuf(new Buffer3(String.fromCharCode(this.highSurrogate, intVal)));
                this.highSurrogate = void 0;
              } else if (this.highSurrogate === void 0 && intVal >= 55296 && intVal < 56319 + 1) {
                this.highSurrogate = intVal;
              } else {
                if (this.highSurrogate !== void 0) {
                  this.appendStringBuf(new Buffer3(String.fromCharCode(this.highSurrogate)));
                  this.highSurrogate = void 0;
                }
                this.appendStringBuf(new Buffer3(String.fromCharCode(intVal)));
              }
              this.tState = STRING1;
            }
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === NUMBER1 || this.tState === NUMBER3) {
          n = buffer[i];
          switch (n) {
            case 48:
            // 0
            case 49:
            // 1
            case 50:
            // 2
            case 51:
            // 3
            case 52:
            // 4
            case 53:
            // 5
            case 54:
            // 6
            case 55:
            // 7
            case 56:
            // 8
            case 57:
            // 9
            case 46:
            // .
            case 101:
            // e
            case 69:
            // E
            case 43:
            // +
            case 45:
              this.string += String.fromCharCode(n);
              this.tState = NUMBER3;
              break;
            default:
              this.tState = START;
              var error = this.numberReviver(this.string, buffer, i);
              if (error) {
                return error;
              }
              this.offset += this.string.length - 1;
              this.string = void 0;
              i--;
              break;
          }
        } else if (this.tState === TRUE1) {
          if (buffer[i] === 114) {
            this.tState = TRUE2;
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === TRUE2) {
          if (buffer[i] === 117) {
            this.tState = TRUE3;
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === TRUE3) {
          if (buffer[i] === 101) {
            this.tState = START;
            this.onToken(TRUE, true);
            this.offset += 3;
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === FALSE1) {
          if (buffer[i] === 97) {
            this.tState = FALSE2;
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === FALSE2) {
          if (buffer[i] === 108) {
            this.tState = FALSE3;
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === FALSE3) {
          if (buffer[i] === 115) {
            this.tState = FALSE4;
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === FALSE4) {
          if (buffer[i] === 101) {
            this.tState = START;
            this.onToken(FALSE, false);
            this.offset += 4;
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === NULL1) {
          if (buffer[i] === 117) {
            this.tState = NULL2;
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === NULL2) {
          if (buffer[i] === 108) {
            this.tState = NULL3;
          } else {
            return this.charError(buffer, i);
          }
        } else if (this.tState === NULL3) {
          if (buffer[i] === 108) {
            this.tState = START;
            this.onToken(NULL, null);
            this.offset += 3;
          } else {
            return this.charError(buffer, i);
          }
        }
      }
    };
    proto.onToken = function(token, value) {
    };
    proto.parseError = function(token, value) {
      this.tState = STOP;
      this.onError(new Error("Unexpected " + Parser.toknam(token) + (value ? "(" + JSON.stringify(value) + ")" : "") + " in state " + Parser.toknam(this.state)));
    };
    proto.push = function() {
      this.stack.push({ value: this.value, key: this.key, mode: this.mode });
    };
    proto.pop = function() {
      var value = this.value;
      var parent = this.stack.pop();
      this.value = parent.value;
      this.key = parent.key;
      this.mode = parent.mode;
      this.emit(value);
      if (!this.mode) {
        this.state = VALUE;
      }
    };
    proto.emit = function(value) {
      if (this.mode) {
        this.state = COMMA;
      }
      this.onValue(value);
    };
    proto.onValue = function(value) {
    };
    proto.onToken = function(token, value) {
      if (this.state === VALUE) {
        if (token === STRING || token === NUMBER || token === TRUE || token === FALSE || token === NULL) {
          if (this.value) {
            this.value[this.key] = value;
          }
          this.emit(value);
        } else if (token === LEFT_BRACE) {
          this.push();
          if (this.value) {
            this.value = this.value[this.key] = {};
          } else {
            this.value = {};
          }
          this.key = void 0;
          this.state = KEY;
          this.mode = OBJECT;
        } else if (token === LEFT_BRACKET) {
          this.push();
          if (this.value) {
            this.value = this.value[this.key] = [];
          } else {
            this.value = [];
          }
          this.key = 0;
          this.mode = ARRAY;
          this.state = VALUE;
        } else if (token === RIGHT_BRACE) {
          if (this.mode === OBJECT) {
            this.pop();
          } else {
            return this.parseError(token, value);
          }
        } else if (token === RIGHT_BRACKET) {
          if (this.mode === ARRAY) {
            this.pop();
          } else {
            return this.parseError(token, value);
          }
        } else {
          return this.parseError(token, value);
        }
      } else if (this.state === KEY) {
        if (token === STRING) {
          this.key = value;
          this.state = COLON;
        } else if (token === RIGHT_BRACE) {
          this.pop();
        } else {
          return this.parseError(token, value);
        }
      } else if (this.state === COLON) {
        if (token === COLON) {
          this.state = VALUE;
        } else {
          return this.parseError(token, value);
        }
      } else if (this.state === COMMA) {
        if (token === COMMA) {
          if (this.mode === ARRAY) {
            this.key++;
            this.state = VALUE;
          } else if (this.mode === OBJECT) {
            this.state = KEY;
          }
        } else if (token === RIGHT_BRACKET && this.mode === ARRAY || token === RIGHT_BRACE && this.mode === OBJECT) {
          this.pop();
        } else {
          return this.parseError(token, value);
        }
      } else {
        return this.parseError(token, value);
      }
    };
    proto.numberReviver = function(text, buffer, i) {
      var result = Number(text);
      if (isNaN(result)) {
        return this.charError(buffer, i);
      }
      if (text.match(/[0-9]+/) == text && result.toString() != text) {
        this.onToken(STRING, text);
      } else {
        this.onToken(NUMBER, result);
      }
    };
    Parser.C = C;
    module.exports = Parser;
  }
});

// node_modules/relative-to-absolute-iri/lib/Resolve.js
var require_Resolve = __commonJS({
  "node_modules/relative-to-absolute-iri/lib/Resolve.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.removeDotSegmentsOfPath = exports.removeDotSegments = exports.resolve = void 0;
    function resolve(relativeIRI, baseIRI) {
      baseIRI = baseIRI || "";
      const baseFragmentPos = baseIRI.indexOf("#");
      if (baseFragmentPos > 0) {
        baseIRI = baseIRI.substr(0, baseFragmentPos);
      }
      if (!relativeIRI.length) {
        if (baseIRI.indexOf(":") < 0) {
          throw new Error(`Found invalid baseIRI '${baseIRI}' for value '${relativeIRI}'`);
        }
        return baseIRI;
      }
      if (relativeIRI.startsWith("?")) {
        const baseQueryPos = baseIRI.indexOf("?");
        if (baseQueryPos > 0) {
          baseIRI = baseIRI.substr(0, baseQueryPos);
        }
        return baseIRI + relativeIRI;
      }
      if (relativeIRI.startsWith("#")) {
        return baseIRI + relativeIRI;
      }
      if (!baseIRI.length) {
        const relativeColonPos = relativeIRI.indexOf(":");
        if (relativeColonPos < 0) {
          throw new Error(`Found invalid relative IRI '${relativeIRI}' for a missing baseIRI`);
        }
        return removeDotSegmentsOfPath(relativeIRI, relativeColonPos);
      }
      const valueColonPos = relativeIRI.indexOf(":");
      if (valueColonPos >= 0) {
        const valueSlashPos = relativeIRI.indexOf("/");
        if (valueSlashPos < 0 || valueColonPos < valueSlashPos) {
          return removeDotSegmentsOfPath(relativeIRI, valueColonPos);
        }
      }
      const baseColonPos = baseIRI.indexOf(":");
      if (baseColonPos < 0) {
        throw new Error(`Found invalid baseIRI '${baseIRI}' for value '${relativeIRI}'`);
      }
      const baseIRIScheme = baseIRI.substr(0, baseColonPos + 1);
      if (relativeIRI.indexOf("//") === 0) {
        return baseIRIScheme + removeDotSegmentsOfPath(relativeIRI, valueColonPos);
      }
      let baseSlashAfterColonPos;
      if (baseIRI.indexOf("//", baseColonPos) === baseColonPos + 1) {
        baseSlashAfterColonPos = baseIRI.indexOf("/", baseColonPos + 3);
        if (baseSlashAfterColonPos < 0) {
          if (baseIRI.length > baseColonPos + 3) {
            return baseIRI + "/" + removeDotSegmentsOfPath(relativeIRI, valueColonPos);
          } else {
            return baseIRIScheme + removeDotSegmentsOfPath(relativeIRI, valueColonPos);
          }
        }
      } else {
        baseSlashAfterColonPos = baseIRI.indexOf("/", baseColonPos + 1);
        if (baseSlashAfterColonPos < 0) {
          return baseIRIScheme + removeDotSegmentsOfPath(relativeIRI, valueColonPos);
        }
      }
      if (relativeIRI.indexOf("/") === 0) {
        return baseIRI.substr(0, baseSlashAfterColonPos) + removeDotSegments(relativeIRI);
      }
      let baseIRIPath = baseIRI.substr(baseSlashAfterColonPos);
      const baseIRILastSlashPos = baseIRIPath.lastIndexOf("/");
      if (baseIRILastSlashPos >= 0 && baseIRILastSlashPos < baseIRIPath.length - 1) {
        baseIRIPath = baseIRIPath.substr(0, baseIRILastSlashPos + 1);
        if (relativeIRI[0] === "." && relativeIRI[1] !== "." && relativeIRI[1] !== "/" && relativeIRI[2]) {
          relativeIRI = relativeIRI.substr(1);
        }
      }
      relativeIRI = baseIRIPath + relativeIRI;
      relativeIRI = removeDotSegments(relativeIRI);
      return baseIRI.substr(0, baseSlashAfterColonPos) + relativeIRI;
    }
    exports.resolve = resolve;
    function removeDotSegments(path) {
      const segmentBuffers = [];
      let i = 0;
      while (i < path.length) {
        switch (path[i]) {
          case "/":
            if (path[i + 1] === ".") {
              if (path[i + 2] === ".") {
                if (!isCharacterAllowedAfterRelativePathSegment(path[i + 3])) {
                  segmentBuffers.push([]);
                  i++;
                  break;
                }
                segmentBuffers.pop();
                if (!path[i + 3]) {
                  segmentBuffers.push([]);
                }
                i += 3;
              } else {
                if (!isCharacterAllowedAfterRelativePathSegment(path[i + 2])) {
                  segmentBuffers.push([]);
                  i++;
                  break;
                }
                if (!path[i + 2]) {
                  segmentBuffers.push([]);
                }
                i += 2;
              }
            } else {
              segmentBuffers.push([]);
              i++;
            }
            break;
          case "#":
          case "?":
            if (!segmentBuffers.length) {
              segmentBuffers.push([]);
            }
            segmentBuffers[segmentBuffers.length - 1].push(path.substr(i));
            i = path.length;
            break;
          default:
            if (!segmentBuffers.length) {
              segmentBuffers.push([]);
            }
            segmentBuffers[segmentBuffers.length - 1].push(path[i]);
            i++;
            break;
        }
      }
      return "/" + segmentBuffers.map((buffer) => buffer.join("")).join("/");
    }
    exports.removeDotSegments = removeDotSegments;
    function removeDotSegmentsOfPath(iri, colonPosition) {
      let searchOffset = colonPosition + 1;
      if (colonPosition >= 0) {
        if (iri[colonPosition + 1] === "/" && iri[colonPosition + 2] === "/") {
          searchOffset = colonPosition + 3;
        }
      } else {
        if (iri[0] === "/" && iri[1] === "/") {
          searchOffset = 2;
        }
      }
      const pathSeparator = iri.indexOf("/", searchOffset);
      if (pathSeparator < 0) {
        return iri;
      }
      const base = iri.substr(0, pathSeparator);
      const path = iri.substr(pathSeparator);
      return base + removeDotSegments(path);
    }
    exports.removeDotSegmentsOfPath = removeDotSegmentsOfPath;
    function isCharacterAllowedAfterRelativePathSegment(character) {
      return !character || character === "#" || character === "?" || character === "/";
    }
  }
});

// node_modules/relative-to-absolute-iri/index.js
var require_relative_to_absolute_iri = __commonJS({
  "node_modules/relative-to-absolute-iri/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_Resolve(), exports);
  }
});

// node_modules/jsonld-context-parser/lib/ErrorCoded.js
var require_ErrorCoded = __commonJS({
  "node_modules/jsonld-context-parser/lib/ErrorCoded.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ERROR_CODES = exports.ErrorCoded = void 0;
    var ErrorCoded = class extends Error {
      /* istanbul ignore next */
      constructor(message, code) {
        super(message);
        this.code = code;
      }
    };
    exports.ErrorCoded = ErrorCoded;
    var ERROR_CODES;
    (function(ERROR_CODES2) {
      ERROR_CODES2["COLLIDING_KEYWORDS"] = "colliding keywords";
      ERROR_CODES2["CONFLICTING_INDEXES"] = "conflicting indexes";
      ERROR_CODES2["CYCLIC_IRI_MAPPING"] = "cyclic IRI mapping";
      ERROR_CODES2["INVALID_ID_VALUE"] = "invalid @id value";
      ERROR_CODES2["INVALID_INDEX_VALUE"] = "invalid @index value";
      ERROR_CODES2["INVALID_NEST_VALUE"] = "invalid @nest value";
      ERROR_CODES2["INVALID_PREFIX_VALUE"] = "invalid @prefix value";
      ERROR_CODES2["INVALID_PROPAGATE_VALUE"] = "invalid @propagate value";
      ERROR_CODES2["INVALID_REVERSE_VALUE"] = "invalid @reverse value";
      ERROR_CODES2["INVALID_IMPORT_VALUE"] = "invalid @import value";
      ERROR_CODES2["INVALID_VERSION_VALUE"] = "invalid @version value";
      ERROR_CODES2["INVALID_BASE_IRI"] = "invalid base IRI";
      ERROR_CODES2["INVALID_CONTAINER_MAPPING"] = "invalid container mapping";
      ERROR_CODES2["INVALID_CONTEXT_ENTRY"] = "invalid context entry";
      ERROR_CODES2["INVALID_CONTEXT_NULLIFICATION"] = "invalid context nullification";
      ERROR_CODES2["INVALID_DEFAULT_LANGUAGE"] = "invalid default language";
      ERROR_CODES2["INVALID_INCLUDED_VALUE"] = "invalid @included value";
      ERROR_CODES2["INVALID_IRI_MAPPING"] = "invalid IRI mapping";
      ERROR_CODES2["INVALID_JSON_LITERAL"] = "invalid JSON literal";
      ERROR_CODES2["INVALID_KEYWORD_ALIAS"] = "invalid keyword alias";
      ERROR_CODES2["INVALID_LANGUAGE_MAP_VALUE"] = "invalid language map value";
      ERROR_CODES2["INVALID_LANGUAGE_MAPPING"] = "invalid language mapping";
      ERROR_CODES2["INVALID_LANGUAGE_TAGGED_STRING"] = "invalid language-tagged string";
      ERROR_CODES2["INVALID_LANGUAGE_TAGGED_VALUE"] = "invalid language-tagged value";
      ERROR_CODES2["INVALID_LOCAL_CONTEXT"] = "invalid local context";
      ERROR_CODES2["INVALID_REMOTE_CONTEXT"] = "invalid remote context";
      ERROR_CODES2["INVALID_REVERSE_PROPERTY"] = "invalid reverse property";
      ERROR_CODES2["INVALID_REVERSE_PROPERTY_MAP"] = "invalid reverse property map";
      ERROR_CODES2["INVALID_REVERSE_PROPERTY_VALUE"] = "invalid reverse property value";
      ERROR_CODES2["INVALID_SCOPED_CONTEXT"] = "invalid scoped context";
      ERROR_CODES2["INVALID_SCRIPT_ELEMENT"] = "invalid script element";
      ERROR_CODES2["INVALID_SET_OR_LIST_OBJECT"] = "invalid set or list object";
      ERROR_CODES2["INVALID_TERM_DEFINITION"] = "invalid term definition";
      ERROR_CODES2["INVALID_TYPE_MAPPING"] = "invalid type mapping";
      ERROR_CODES2["INVALID_TYPE_VALUE"] = "invalid type value";
      ERROR_CODES2["INVALID_TYPED_VALUE"] = "invalid typed value";
      ERROR_CODES2["INVALID_VALUE_OBJECT"] = "invalid value object";
      ERROR_CODES2["INVALID_VALUE_OBJECT_VALUE"] = "invalid value object value";
      ERROR_CODES2["INVALID_VOCAB_MAPPING"] = "invalid vocab mapping";
      ERROR_CODES2["IRI_CONFUSED_WITH_PREFIX"] = "IRI confused with prefix";
      ERROR_CODES2["KEYWORD_REDEFINITION"] = "keyword redefinition";
      ERROR_CODES2["LOADING_DOCUMENT_FAILED"] = "loading document failed";
      ERROR_CODES2["LOADING_REMOTE_CONTEXT_FAILED"] = "loading remote context failed";
      ERROR_CODES2["MULTIPLE_CONTEXT_LINK_HEADERS"] = "multiple context link headers";
      ERROR_CODES2["PROCESSING_MODE_CONFLICT"] = "processing mode conflict";
      ERROR_CODES2["PROTECTED_TERM_REDEFINITION"] = "protected term redefinition";
      ERROR_CODES2["CONTEXT_OVERFLOW"] = "context overflow";
      ERROR_CODES2["INVALID_BASE_DIRECTION"] = "invalid base direction";
      ERROR_CODES2["RECURSIVE_CONTEXT_INCLUSION"] = "recursive context inclusion";
      ERROR_CODES2["INVALID_STREAMING_KEY_ORDER"] = "invalid streaming key order";
      ERROR_CODES2["INVALID_EMBEDDED_NODE"] = "invalid embedded node";
      ERROR_CODES2["INVALID_ANNOTATION"] = "invalid annotation";
    })(ERROR_CODES = exports.ERROR_CODES || (exports.ERROR_CODES = {}));
  }
});

// node_modules/http-link-header/lib/link.js
var require_link = __commonJS({
  "node_modules/http-link-header/lib/link.js"(exports, module) {
    "use strict";
    var COMPATIBLE_ENCODING_PATTERN = /^utf-?8|ascii|utf-?16-?le|ucs-?2|base-?64|latin-?1$/i;
    var WS_TRIM_PATTERN = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g;
    var WS_CHAR_PATTERN = /\s|\uFEFF|\xA0/;
    var WS_FOLD_PATTERN = /\r?\n[\x20\x09]+/g;
    var DELIMITER_PATTERN = /[;,"]/;
    var WS_DELIMITER_PATTERN = /[;,"]|\s/;
    var TOKEN_PATTERN = /^[!#$%&'*+\-\.^_`|~\da-zA-Z]+$/;
    var STATE = {
      IDLE: 1 << 0,
      URI: 1 << 1,
      ATTR: 1 << 2
    };
    function trim(value) {
      return value.replace(WS_TRIM_PATTERN, "");
    }
    function hasWhitespace(value) {
      return WS_CHAR_PATTERN.test(value);
    }
    function skipWhitespace(value, offset) {
      while (hasWhitespace(value[offset])) {
        offset++;
      }
      return offset;
    }
    function needsQuotes(value) {
      return WS_DELIMITER_PATTERN.test(value) || !TOKEN_PATTERN.test(value);
    }
    function shallowCompareObjects(object1, object2) {
      return Object.keys(object1).length === Object.keys(object2).length && Object.keys(object1).every(
        (key) => key in object2 && object1[key] === object2[key]
      );
    }
    var Link = class _Link {
      /**
       * Link
       * @constructor
       * @param {String} [value]
       * @returns {Link}
       */
      constructor(value) {
        this.refs = [];
        if (value) {
          this.parse(value);
        }
      }
      /**
       * Get refs with given relation type
       * @param {String} value
       * @returns {Array<Object>}
       */
      rel(value) {
        var links = [];
        var type = value.toLowerCase();
        for (var i = 0; i < this.refs.length; i++) {
          if (typeof this.refs[i].rel === "string" && this.refs[i].rel.toLowerCase() === type) {
            links.push(this.refs[i]);
          }
        }
        return links;
      }
      /**
       * Get refs where given attribute has a given value
       * @param {String} attr
       * @param {String} value
       * @returns {Array<Object>}
       */
      get(attr, value) {
        attr = attr.toLowerCase();
        value = value.toLowerCase();
        var links = [];
        for (var i = 0; i < this.refs.length; i++) {
          if (typeof this.refs[i][attr] === "string" && this.refs[i][attr].toLowerCase() === value) {
            links.push(this.refs[i]);
          }
        }
        return links;
      }
      /** Sets a reference. */
      set(link) {
        this.refs.push(link);
        return this;
      }
      /**
       * Sets a reference if a reference with similar properties isn’t already set.
       */
      setUnique(link) {
        if (!this.refs.some((ref) => shallowCompareObjects(ref, link))) {
          this.refs.push(link);
        }
        return this;
      }
      has(attr, value) {
        attr = attr.toLowerCase();
        value = value.toLowerCase();
        for (var i = 0; i < this.refs.length; i++) {
          if (typeof this.refs[i][attr] === "string" && this.refs[i][attr].toLowerCase() === value) {
            return true;
          }
        }
        return false;
      }
      parse(value, offset) {
        offset = offset || 0;
        value = offset ? value.slice(offset) : value;
        value = trim(value).replace(WS_FOLD_PATTERN, "");
        var state = STATE.IDLE;
        var length = value.length;
        var offset = 0;
        var ref = null;
        while (offset < length) {
          if (state === STATE.IDLE) {
            if (hasWhitespace(value[offset])) {
              offset++;
              continue;
            } else if (value[offset] === "<") {
              if (ref != null) {
                ref.rel != null ? this.refs.push(..._Link.expandRelations(ref)) : this.refs.push(ref);
              }
              var end = value.indexOf(">", offset);
              if (end === -1) throw new Error("Expected end of URI delimiter at offset " + offset);
              ref = { uri: value.slice(offset + 1, end) };
              offset = end;
              state = STATE.URI;
            } else {
              throw new Error('Unexpected character "' + value[offset] + '" at offset ' + offset);
            }
            offset++;
          } else if (state === STATE.URI) {
            if (hasWhitespace(value[offset])) {
              offset++;
              continue;
            } else if (value[offset] === ";") {
              state = STATE.ATTR;
              offset++;
            } else if (value[offset] === ",") {
              state = STATE.IDLE;
              offset++;
            } else {
              throw new Error('Unexpected character "' + value[offset] + '" at offset ' + offset);
            }
          } else if (state === STATE.ATTR) {
            if (value[offset] === ";" || hasWhitespace(value[offset])) {
              offset++;
              continue;
            }
            var end = value.indexOf("=", offset);
            if (end === -1) end = value.indexOf(";", offset);
            if (end === -1) end = value.length;
            var attr = trim(value.slice(offset, end)).toLowerCase();
            var attrValue = "";
            offset = end + 1;
            offset = skipWhitespace(value, offset);
            if (value[offset] === '"') {
              offset++;
              while (offset < length) {
                if (value[offset] === '"') {
                  offset++;
                  break;
                }
                if (value[offset] === "\\") {
                  offset++;
                }
                attrValue += value[offset];
                offset++;
              }
            } else {
              var end = offset + 1;
              while (!DELIMITER_PATTERN.test(value[end]) && end < length) {
                end++;
              }
              attrValue = value.slice(offset, end);
              offset = end;
            }
            if (ref[attr] && _Link.isSingleOccurenceAttr(attr)) {
            } else if (attr[attr.length - 1] === "*") {
              ref[attr] = _Link.parseExtendedValue(attrValue);
            } else {
              attrValue = attr === "type" ? attrValue.toLowerCase() : attrValue;
              if (ref[attr] != null) {
                if (Array.isArray(ref[attr])) {
                  ref[attr].push(attrValue);
                } else {
                  ref[attr] = [ref[attr], attrValue];
                }
              } else {
                ref[attr] = attrValue;
              }
            }
            switch (value[offset]) {
              case ",":
                state = STATE.IDLE;
                break;
              case ";":
                state = STATE.ATTR;
                break;
            }
            offset++;
          } else {
            throw new Error('Unknown parser state "' + state + '"');
          }
        }
        if (ref != null) {
          ref.rel != null ? this.refs.push(..._Link.expandRelations(ref)) : this.refs.push(ref);
        }
        ref = null;
        return this;
      }
      toString() {
        var refs = [];
        var link = "";
        var ref = null;
        for (var i = 0; i < this.refs.length; i++) {
          ref = this.refs[i];
          link = Object.keys(this.refs[i]).reduce(function(link2, attr) {
            if (attr === "uri") return link2;
            return link2 + "; " + _Link.formatAttribute(attr, ref[attr]);
          }, "<" + ref.uri + ">");
          refs.push(link);
        }
        return refs.join(", ");
      }
    };
    Link.isCompatibleEncoding = function(value) {
      return COMPATIBLE_ENCODING_PATTERN.test(value);
    };
    Link.parse = function(value, offset) {
      return new Link().parse(value, offset);
    };
    Link.isSingleOccurenceAttr = function(attr) {
      return attr === "rel" || attr === "type" || attr === "media" || attr === "title" || attr === "title*";
    };
    Link.isTokenAttr = function(attr) {
      return attr === "rel" || attr === "type" || attr === "anchor";
    };
    Link.escapeQuotes = function(value) {
      return value.replace(/"/g, '\\"');
    };
    Link.expandRelations = function(ref) {
      var rels = ref.rel.split(" ");
      return rels.map(function(rel) {
        var value = Object.assign({}, ref);
        value.rel = rel;
        return value;
      });
    };
    Link.parseExtendedValue = function(value) {
      var parts = /([^']+)?(?:'([^']*)')?(.+)/.exec(value);
      return {
        language: parts[2].toLowerCase(),
        encoding: Link.isCompatibleEncoding(parts[1]) ? null : parts[1].toLowerCase(),
        value: Link.isCompatibleEncoding(parts[1]) ? decodeURIComponent(parts[3]) : parts[3]
      };
    };
    Link.formatExtendedAttribute = function(attr, data) {
      var encoding = (data.encoding || "utf-8").toUpperCase();
      var language = data.language || "en";
      var encodedValue = "";
      if (Buffer.isBuffer(data.value) && Link.isCompatibleEncoding(encoding)) {
        encodedValue = data.value.toString(encoding);
      } else if (Buffer.isBuffer(data.value)) {
        encodedValue = data.value.toString("hex").replace(/[0-9a-f]{2}/gi, "%$1");
      } else {
        encodedValue = encodeURIComponent(data.value);
      }
      return attr + "=" + encoding + "'" + language + "'" + encodedValue;
    };
    Link.formatAttribute = function(attr, value) {
      if (Array.isArray(value)) {
        return value.map((item) => {
          return Link.formatAttribute(attr, item);
        }).join("; ");
      }
      if (attr[attr.length - 1] === "*" || typeof value !== "string") {
        return Link.formatExtendedAttribute(attr, value);
      }
      if (Link.isTokenAttr(attr)) {
        value = needsQuotes(value) ? '"' + Link.escapeQuotes(value) + '"' : Link.escapeQuotes(value);
      } else if (needsQuotes(value)) {
        value = encodeURIComponent(value);
        value = value.replace(/%20/g, " ").replace(/%2C/g, ",").replace(/%3B/g, ";");
        value = '"' + value + '"';
      }
      return attr + "=" + value;
    };
    module.exports = Link;
  }
});

// node_modules/jsonld-context-parser/lib/FetchDocumentLoader.js
var require_FetchDocumentLoader = __commonJS({
  "node_modules/jsonld-context-parser/lib/FetchDocumentLoader.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FetchDocumentLoader = void 0;
    var ErrorCoded_1 = require_ErrorCoded();
    var http_link_header_1 = require_link();
    var relative_to_absolute_iri_1 = require_relative_to_absolute_iri();
    var FetchDocumentLoader = class {
      constructor(fetcher) {
        this.fetcher = fetcher;
      }
      async load(url) {
        const response = await (this.fetcher || fetch)(url, { headers: new Headers({ accept: "application/ld+json" }) });
        if (response.ok && response.headers) {
          let mediaType = response.headers.get("Content-Type");
          if (mediaType) {
            const colonPos = mediaType.indexOf(";");
            if (colonPos > 0) {
              mediaType = mediaType.substr(0, colonPos);
            }
          }
          if (mediaType === "application/ld+json") {
            return await response.json();
          } else {
            if (response.headers.has("Link")) {
              let alternateUrl;
              response.headers.forEach((value, key) => {
                if (key === "link") {
                  const linkHeader = (0, http_link_header_1.parse)(value);
                  for (const link of linkHeader.get("type", "application/ld+json")) {
                    if (link.rel === "alternate") {
                      if (alternateUrl) {
                        throw new Error("Multiple JSON-LD alternate links were found on " + url);
                      }
                      alternateUrl = (0, relative_to_absolute_iri_1.resolve)(link.uri, url);
                    }
                  }
                }
              });
              if (alternateUrl) {
                return this.load(alternateUrl);
              }
            }
            throw new ErrorCoded_1.ErrorCoded(`Unsupported JSON-LD media type ${mediaType}`, ErrorCoded_1.ERROR_CODES.LOADING_DOCUMENT_FAILED);
          }
        } else {
          throw new Error(response.statusText || `Status code: ${response.status}`);
        }
      }
    };
    exports.FetchDocumentLoader = FetchDocumentLoader;
  }
});

// node_modules/jsonld-context-parser/lib/Util.js
var require_Util = __commonJS({
  "node_modules/jsonld-context-parser/lib/Util.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Util = void 0;
    var Util = class _Util {
      /**
       * Check if the given term is a valid compact IRI.
       * Otherwise, it may be an IRI.
       * @param {string} term A term.
       * @return {boolean} If it is a compact IRI.
       */
      static isCompactIri(term) {
        return term.indexOf(":") > 0 && !(term && term[0] === "#");
      }
      /**
       * Get the prefix from the given term.
       * @see https://json-ld.org/spec/latest/json-ld/#compact-iris
       * @param {string} term A term that is an URL or a prefixed URL.
       * @param {IJsonLdContextNormalizedRaw} context A context.
       * @return {string} The prefix or null.
       */
      static getPrefix(term, context) {
        if (term && term[0] === "#") {
          return null;
        }
        const separatorPos = term.indexOf(":");
        if (separatorPos >= 0) {
          if (term.length > separatorPos + 1 && term.charAt(separatorPos + 1) === "/" && term.charAt(separatorPos + 2) === "/") {
            return null;
          }
          const prefix = term.substr(0, separatorPos);
          if (prefix === "_") {
            return null;
          }
          if (context[prefix]) {
            return prefix;
          }
        }
        return null;
      }
      /**
       * From a given context entry value, get the string value, or the @id field.
       * @param contextValue A value for a term in a context.
       * @return {string} The id value, or null.
       */
      static getContextValueId(contextValue) {
        if (contextValue === null || typeof contextValue === "string") {
          return contextValue;
        }
        const id = contextValue["@id"];
        return id ? id : null;
      }
      /**
       * Check if the given simple term definition (string-based value of a context term)
       * should be considered a prefix.
       * @param value A simple term definition value.
       * @param options Options that define the way how expansion must be done.
       */
      static isSimpleTermDefinitionPrefix(value, options) {
        return !_Util.isPotentialKeyword(value) && (options.allowPrefixNonGenDelims || typeof value === "string" && (value[0] === "_" || _Util.isPrefixIriEndingWithGenDelim(value)));
      }
      /**
       * Check if the given keyword is of the keyword format "@"1*ALPHA.
       * @param {string} keyword A potential keyword.
       * @return {boolean} If the given keyword is of the keyword format.
       */
      static isPotentialKeyword(keyword) {
        return typeof keyword === "string" && _Util.KEYWORD_REGEX.test(keyword);
      }
      /**
       * Check if the given prefix ends with a gen-delim character.
       * @param {string} prefixIri A prefix IRI.
       * @return {boolean} If the given prefix IRI is valid.
       */
      static isPrefixIriEndingWithGenDelim(prefixIri) {
        return _Util.ENDS_WITH_GEN_DELIM.test(prefixIri);
      }
      /**
       * Check if the given context value can be a prefix value.
       * @param value A context value.
       * @return {boolean} If it can be a prefix value.
       */
      static isPrefixValue(value) {
        return value && (typeof value === "string" || value && typeof value === "object");
      }
      /**
       * Check if the given IRI is valid.
       * @param {string} iri A potential IRI.
       * @return {boolean} If the given IRI is valid.
       */
      static isValidIri(iri) {
        return Boolean(iri && _Util.IRI_REGEX.test(iri));
      }
      /**
       * Check if the given IRI is valid, this includes the possibility of being a relative IRI.
       * @param {string} iri A potential IRI.
       * @return {boolean} If the given IRI is valid.
       */
      static isValidIriWeak(iri) {
        return !!iri && iri[0] !== ":" && _Util.IRI_REGEX_WEAK.test(iri);
      }
      /**
       * Check if the given keyword is a defined according to the JSON-LD specification.
       * @param {string} keyword A potential keyword.
       * @return {boolean} If the given keyword is valid.
       */
      static isValidKeyword(keyword) {
        return _Util.VALID_KEYWORDS[keyword];
      }
      /**
       * Check if the given term is protected in the context.
       * @param {IJsonLdContextNormalizedRaw} context A context.
       * @param {string} key A context term.
       * @return {boolean} If the given term has an @protected flag.
       */
      static isTermProtected(context, key) {
        const value = context[key];
        return !(typeof value === "string") && value && value["@protected"];
      }
      /**
       * Check if the given context has at least one protected term.
       * @param context A context.
       * @return If the context has a protected term.
       */
      static hasProtectedTerms(context) {
        for (const key of Object.keys(context)) {
          if (_Util.isTermProtected(context, key)) {
            return true;
          }
        }
        return false;
      }
      /**
       * Check if the given key is an internal reserved keyword.
       * @param key A context key.
       */
      static isReservedInternalKeyword(key) {
        return key.startsWith("@__");
      }
      /**
       * Check if two objects are deepEqual to on another.
       * @param object1 The first object to test.
       * @param object2 The second object to test.
       */
      static deepEqual(object1, object2) {
        const objKeys1 = Object.keys(object1);
        const objKeys2 = Object.keys(object2);
        if (objKeys1.length !== objKeys2.length)
          return false;
        return objKeys1.every((key) => {
          const value1 = object1[key];
          const value2 = object2[key];
          return value1 === value2 || value1 !== null && value2 !== null && typeof value1 === "object" && typeof value2 === "object" && this.deepEqual(value1, value2);
        });
      }
    };
    Util.IRI_REGEX = /^([A-Za-z][A-Za-z0-9+-.]*|_):[^ "<>{}|\\\[\]`#]*(#[^#]*)?$/;
    Util.IRI_REGEX_WEAK = /(?::[^:])|\//;
    Util.KEYWORD_REGEX = /^@[a-z]+$/i;
    Util.ENDS_WITH_GEN_DELIM = /[:/?#\[\]@]$/;
    Util.REGEX_LANGUAGE_TAG = /^[a-zA-Z]+(-[a-zA-Z0-9]+)*$/;
    Util.REGEX_DIRECTION_TAG = /^(ltr)|(rtl)$/;
    Util.VALID_KEYWORDS = {
      "@annotation": true,
      "@base": true,
      "@container": true,
      "@context": true,
      "@direction": true,
      "@graph": true,
      "@id": true,
      "@import": true,
      "@included": true,
      "@index": true,
      "@json": true,
      "@language": true,
      "@list": true,
      "@nest": true,
      "@none": true,
      "@prefix": true,
      "@propagate": true,
      "@protected": true,
      "@reverse": true,
      "@set": true,
      "@type": true,
      "@value": true,
      "@version": true,
      "@vocab": true
    };
    Util.EXPAND_KEYS_BLACKLIST = [
      "@base",
      "@vocab",
      "@language",
      "@version",
      "@direction"
    ];
    Util.ALIAS_DOMAIN_BLACKLIST = [
      "@container",
      "@graph",
      "@id",
      "@index",
      "@list",
      "@nest",
      "@none",
      "@prefix",
      "@reverse",
      "@set",
      "@type",
      "@value",
      "@version"
    ];
    Util.ALIAS_RANGE_BLACKLIST = [
      "@context",
      "@preserve"
    ];
    Util.CONTAINERS = [
      "@list",
      "@set",
      "@index",
      "@language",
      "@graph",
      "@id",
      "@type"
    ];
    Util.CONTAINERS_1_0 = [
      "@list",
      "@set",
      "@index"
    ];
    exports.Util = Util;
  }
});

// node_modules/jsonld-context-parser/lib/JsonLdContextNormalized.js
var require_JsonLdContextNormalized = __commonJS({
  "node_modules/jsonld-context-parser/lib/JsonLdContextNormalized.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.defaultExpandOptions = exports.JsonLdContextNormalized = void 0;
    var relative_to_absolute_iri_1 = require_relative_to_absolute_iri();
    var ErrorCoded_1 = require_ErrorCoded();
    var Util_1 = require_Util();
    var JsonLdContextNormalized = class {
      constructor(contextRaw) {
        this.contextRaw = contextRaw;
      }
      /**
       * @return The raw inner context.
       */
      getContextRaw() {
        return this.contextRaw;
      }
      /**
       * Expand the term or prefix of the given term if it has one,
       * otherwise return the term as-is.
       *
       * This will try to expand the IRI as much as possible.
       *
       * Iff in vocab-mode, then other references to other terms in the context can be used,
       * such as to `myTerm`:
       * ```
       * {
       *   "myTerm": "http://example.org/myLongTerm"
       * }
       * ```
       *
       * @param {string} term A term that is an URL or a prefixed URL.
       * @param {boolean} expandVocab If the term is a predicate or type and should be expanded based on @vocab,
       *                              otherwise it is considered a regular term that is expanded based on @base.
       * @param {IExpandOptions} options Options that define the way how expansion must be done.
       * @return {string} The expanded term, the term as-is, or null if it was explicitly disabled in the context.
       * @throws If the term is aliased to an invalid value (not a string, IRI or keyword).
       */
      expandTerm(term, expandVocab, options = exports.defaultExpandOptions) {
        const contextValue = this.contextRaw[term];
        if (contextValue === null || contextValue && contextValue["@id"] === null) {
          return null;
        }
        let validIriMapping = true;
        if (contextValue && expandVocab) {
          const value = Util_1.Util.getContextValueId(contextValue);
          if (value && value !== term) {
            if (typeof value !== "string" || !Util_1.Util.isValidIri(value) && !Util_1.Util.isValidKeyword(value)) {
              if (!Util_1.Util.isPotentialKeyword(value)) {
                validIriMapping = false;
              }
            } else {
              return value;
            }
          }
        }
        const prefix = Util_1.Util.getPrefix(term, this.contextRaw);
        const vocab = this.contextRaw["@vocab"];
        const vocabRelative = (!!vocab || vocab === "") && vocab.indexOf(":") < 0;
        const base = this.contextRaw["@base"];
        const potentialKeyword = Util_1.Util.isPotentialKeyword(term);
        if (prefix) {
          const contextPrefixValue = this.contextRaw[prefix];
          const value = Util_1.Util.getContextValueId(contextPrefixValue);
          if (value) {
            if (typeof contextPrefixValue === "string" || !options.allowPrefixForcing) {
              if (!Util_1.Util.isSimpleTermDefinitionPrefix(value, options)) {
                return term;
              }
            } else {
              if (value[0] !== "_" && !potentialKeyword && !contextPrefixValue["@prefix"] && !(term in this.contextRaw)) {
                return term;
              }
            }
            return value + term.substr(prefix.length + 1);
          }
        } else if (expandVocab && (vocab || vocab === "" || options.allowVocabRelativeToBase && (base && vocabRelative)) && !potentialKeyword && !Util_1.Util.isCompactIri(term)) {
          if (vocabRelative) {
            if (options.allowVocabRelativeToBase) {
              return (vocab || base ? (0, relative_to_absolute_iri_1.resolve)(vocab, base) : "") + term;
            } else {
              throw new ErrorCoded_1.ErrorCoded(`Relative vocab expansion for term '${term}' with vocab '${vocab}' is not allowed.`, ErrorCoded_1.ERROR_CODES.INVALID_VOCAB_MAPPING);
            }
          } else {
            return vocab + term;
          }
        } else if (!expandVocab && base && !potentialKeyword && !Util_1.Util.isCompactIri(term)) {
          return (0, relative_to_absolute_iri_1.resolve)(term, base);
        }
        if (validIriMapping) {
          return term;
        } else {
          throw new ErrorCoded_1.ErrorCoded(`Invalid IRI mapping found for context entry '${term}': '${JSON.stringify(contextValue)}'`, ErrorCoded_1.ERROR_CODES.INVALID_IRI_MAPPING);
        }
      }
      /**
       * Compact the given term using @base, @vocab, an aliased term, or a prefixed term.
       *
       * This will try to compact the IRI as much as possible.
       *
       * @param {string} iri An IRI to compact.
       * @param {boolean} vocab If the term is a predicate or type and should be compacted based on @vocab,
       *                        otherwise it is considered a regular term that is compacted based on @base.
       * @return {string} The compacted term or the IRI as-is.
       */
      compactIri(iri, vocab) {
        if (vocab && this.contextRaw["@vocab"] && iri.startsWith(this.contextRaw["@vocab"])) {
          return iri.substr(this.contextRaw["@vocab"].length);
        }
        if (!vocab && this.contextRaw["@base"] && iri.startsWith(this.contextRaw["@base"])) {
          return iri.substr(this.contextRaw["@base"].length);
        }
        const shortestPrefixing = { prefix: "", suffix: iri };
        for (const key in this.contextRaw) {
          const value = this.contextRaw[key];
          if (value && !Util_1.Util.isPotentialKeyword(key)) {
            const contextIri = Util_1.Util.getContextValueId(value);
            if (iri.startsWith(contextIri)) {
              const suffix = iri.substr(contextIri.length);
              if (!suffix) {
                if (vocab) {
                  return key;
                }
              } else if (suffix.length < shortestPrefixing.suffix.length) {
                shortestPrefixing.prefix = key;
                shortestPrefixing.suffix = suffix;
              }
            }
          }
        }
        if (shortestPrefixing.prefix) {
          return shortestPrefixing.prefix + ":" + shortestPrefixing.suffix;
        }
        return iri;
      }
    };
    exports.JsonLdContextNormalized = JsonLdContextNormalized;
    exports.defaultExpandOptions = {
      allowPrefixForcing: true,
      allowPrefixNonGenDelims: false,
      allowVocabRelativeToBase: true
    };
  }
});

// node_modules/jsonld-context-parser/lib/ContextParser.js
var require_ContextParser = __commonJS({
  "node_modules/jsonld-context-parser/lib/ContextParser.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ContextParser = void 0;
    var relative_to_absolute_iri_1 = require_relative_to_absolute_iri();
    var ErrorCoded_1 = require_ErrorCoded();
    var FetchDocumentLoader_1 = require_FetchDocumentLoader();
    var JsonLdContextNormalized_1 = require_JsonLdContextNormalized();
    var Util_1 = require_Util();
    var ContextParser = class _ContextParser {
      constructor(options) {
        options = options || {};
        this.documentLoader = options.documentLoader || new FetchDocumentLoader_1.FetchDocumentLoader();
        this.documentCache = {};
        this.validateContext = !options.skipValidation;
        this.expandContentTypeToBase = !!options.expandContentTypeToBase;
        this.remoteContextsDepthLimit = options.remoteContextsDepthLimit || 32;
        this.redirectSchemaOrgHttps = "redirectSchemaOrgHttps" in options ? !!options.redirectSchemaOrgHttps : true;
      }
      /**
       * Validate the given @language value.
       * An error will be thrown if it is invalid.
       * @param value An @language value.
       * @param {boolean} strictRange If the string value should be strictly checked against a regex.
       * @param {string} errorCode The error code to emit on errors.
       * @return {boolean} If validation passed.
       *                   Can only be false if strictRange is false and the string value did not pass the regex.
       */
      static validateLanguage(value, strictRange, errorCode) {
        if (typeof value !== "string") {
          throw new ErrorCoded_1.ErrorCoded(`The value of an '@language' must be a string, got '${JSON.stringify(value)}'`, errorCode);
        }
        if (!Util_1.Util.REGEX_LANGUAGE_TAG.test(value)) {
          if (strictRange) {
            throw new ErrorCoded_1.ErrorCoded(`The value of an '@language' must be a valid language tag, got '${JSON.stringify(value)}'`, errorCode);
          } else {
            return false;
          }
        }
        return true;
      }
      /**
       * Validate the given @direction value.
       * An error will be thrown if it is invalid.
       * @param value An @direction value.
       * @param {boolean} strictValues If the string value should be strictly checked against a regex.
       * @return {boolean} If validation passed.
       *                   Can only be false if strictRange is false and the string value did not pass the regex.
       */
      static validateDirection(value, strictValues) {
        if (typeof value !== "string") {
          throw new ErrorCoded_1.ErrorCoded(`The value of an '@direction' must be a string, got '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.INVALID_BASE_DIRECTION);
        }
        if (!Util_1.Util.REGEX_DIRECTION_TAG.test(value)) {
          if (strictValues) {
            throw new ErrorCoded_1.ErrorCoded(`The value of an '@direction' must be 'ltr' or 'rtl', got '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.INVALID_BASE_DIRECTION);
          } else {
            return false;
          }
        }
        return true;
      }
      /**
       * Add an @id term for all @reverse terms.
       * @param {IJsonLdContextNormalizedRaw} context A context.
       * @return {IJsonLdContextNormalizedRaw} The mutated input context.
       */
      idifyReverseTerms(context) {
        for (const key of Object.keys(context)) {
          let value = context[key];
          if (value && typeof value === "object") {
            if (value["@reverse"] && !value["@id"]) {
              if (typeof value["@reverse"] !== "string" || Util_1.Util.isValidKeyword(value["@reverse"])) {
                throw new ErrorCoded_1.ErrorCoded(`Invalid @reverse value, must be absolute IRI or blank node: '${value["@reverse"]}'`, ErrorCoded_1.ERROR_CODES.INVALID_IRI_MAPPING);
              }
              value = context[key] = Object.assign(Object.assign({}, value), { "@id": value["@reverse"] });
              value["@id"] = value["@reverse"];
              if (Util_1.Util.isPotentialKeyword(value["@reverse"])) {
                delete value["@reverse"];
              } else {
                value["@reverse"] = true;
              }
            }
          }
        }
        return context;
      }
      /**
       * Expand all prefixed terms in the given context.
       * @param {IJsonLdContextNormalizedRaw} context A context.
       * @param {boolean} expandContentTypeToBase If @type inside the context may be expanded
       *                                          via @base if @vocab is set to null.
       * @param {string[]} keys Optional set of keys from the context to expand. If left undefined, all
       * keys in the context will be expanded.
       */
      expandPrefixedTerms(context, expandContentTypeToBase, keys) {
        const contextRaw = context.getContextRaw();
        for (const key of keys || Object.keys(contextRaw)) {
          if (Util_1.Util.EXPAND_KEYS_BLACKLIST.indexOf(key) < 0 && !Util_1.Util.isReservedInternalKeyword(key)) {
            const keyValue = contextRaw[key];
            if (Util_1.Util.isPotentialKeyword(key) && Util_1.Util.ALIAS_DOMAIN_BLACKLIST.indexOf(key) >= 0) {
              if (key !== "@type" || typeof contextRaw[key] === "object" && !(contextRaw[key]["@protected"] || contextRaw[key]["@container"] === "@set")) {
                throw new ErrorCoded_1.ErrorCoded(`Keywords can not be aliased to something else.
Tried mapping ${key} to ${JSON.stringify(keyValue)}`, ErrorCoded_1.ERROR_CODES.KEYWORD_REDEFINITION);
              }
            }
            if (Util_1.Util.ALIAS_RANGE_BLACKLIST.indexOf(Util_1.Util.getContextValueId(keyValue)) >= 0) {
              throw new ErrorCoded_1.ErrorCoded(`Aliasing to certain keywords is not allowed.
Tried mapping ${key} to ${JSON.stringify(keyValue)}`, ErrorCoded_1.ERROR_CODES.INVALID_KEYWORD_ALIAS);
            }
            if (keyValue && Util_1.Util.isPotentialKeyword(Util_1.Util.getContextValueId(keyValue)) && keyValue["@prefix"] === true) {
              throw new ErrorCoded_1.ErrorCoded(`Tried to use keyword aliases as prefix: '${key}': '${JSON.stringify(keyValue)}'`, ErrorCoded_1.ERROR_CODES.INVALID_TERM_DEFINITION);
            }
            while (Util_1.Util.isPrefixValue(contextRaw[key])) {
              const value = contextRaw[key];
              let changed = false;
              if (typeof value === "string") {
                contextRaw[key] = context.expandTerm(value, true);
                changed = changed || value !== contextRaw[key];
              } else {
                const id = value["@id"];
                const type = value["@type"];
                const canAddIdEntry = !("@prefix" in value) || Util_1.Util.isValidIri(key);
                if ("@id" in value) {
                  if (id !== void 0 && id !== null && typeof id === "string") {
                    contextRaw[key] = Object.assign(Object.assign({}, contextRaw[key]), { "@id": context.expandTerm(id, true) });
                    changed = changed || id !== contextRaw[key]["@id"];
                  }
                } else if (!Util_1.Util.isPotentialKeyword(key) && canAddIdEntry) {
                  const newId = context.expandTerm(key, true);
                  if (newId !== key) {
                    contextRaw[key] = Object.assign(Object.assign({}, contextRaw[key]), { "@id": newId });
                    changed = true;
                  }
                }
                if (type && typeof type === "string" && type !== "@vocab" && (!value["@container"] || !value["@container"]["@type"]) && canAddIdEntry) {
                  let expandedType = context.expandTerm(type, true);
                  if (expandContentTypeToBase && type === expandedType) {
                    expandedType = context.expandTerm(type, false);
                  }
                  if (expandedType !== type) {
                    changed = true;
                    contextRaw[key] = Object.assign(Object.assign({}, contextRaw[key]), { "@type": expandedType });
                  }
                }
              }
              if (!changed) {
                break;
              }
            }
          }
        }
      }
      /**
       * Normalize the @language entries in the given context to lowercase.
       * @param {IJsonLdContextNormalizedRaw} context A context.
       * @param {IParseOptions} parseOptions The parsing options.
       */
      normalize(context, { processingMode, normalizeLanguageTags }) {
        if (normalizeLanguageTags || processingMode === 1) {
          for (const key of Object.keys(context)) {
            if (key === "@language" && typeof context[key] === "string") {
              context[key] = context[key].toLowerCase();
            } else {
              const value = context[key];
              if (value && typeof value === "object") {
                if (typeof value["@language"] === "string") {
                  const lowercase = value["@language"].toLowerCase();
                  if (lowercase !== value["@language"]) {
                    context[key] = Object.assign(Object.assign({}, value), { "@language": lowercase });
                  }
                }
              }
            }
          }
        }
      }
      /**
       * Convert all @container strings and array values to hash-based values.
       * @param {IJsonLdContextNormalizedRaw} context A context.
       */
      containersToHash(context) {
        for (const key of Object.keys(context)) {
          const value = context[key];
          if (value && typeof value === "object") {
            if (typeof value["@container"] === "string") {
              context[key] = Object.assign(Object.assign({}, value), { "@container": { [value["@container"]]: true } });
            } else if (Array.isArray(value["@container"])) {
              const newValue = {};
              for (const containerValue of value["@container"]) {
                newValue[containerValue] = true;
              }
              context[key] = Object.assign(Object.assign({}, value), { "@container": newValue });
            }
          }
        }
      }
      /**
       * Normalize and apply context-level @protected terms onto each term separately.
       * @param {IJsonLdContextNormalizedRaw} context A context.
       * @param {number} processingMode The processing mode.
       */
      applyScopedProtected(context, { processingMode }, expandOptions) {
        if (processingMode && processingMode >= 1.1) {
          if (context["@protected"]) {
            for (const key of Object.keys(context)) {
              if (Util_1.Util.isReservedInternalKeyword(key)) {
                continue;
              }
              if (!Util_1.Util.isPotentialKeyword(key) && !Util_1.Util.isTermProtected(context, key)) {
                const value = context[key];
                if (value && typeof value === "object") {
                  if (!("@protected" in context[key])) {
                    context[key] = Object.assign(Object.assign({}, context[key]), { "@protected": true });
                  }
                } else {
                  context[key] = {
                    "@id": value,
                    "@protected": true
                  };
                  if (Util_1.Util.isSimpleTermDefinitionPrefix(value, expandOptions)) {
                    context[key] = Object.assign(Object.assign({}, context[key]), { "@prefix": true });
                  }
                }
              }
            }
            delete context["@protected"];
          }
        }
      }
      /**
       * Check if the given context inheritance does not contain any overrides of protected terms.
       * @param {IJsonLdContextNormalizedRaw} contextBefore The context that may contain some protected terms.
       * @param {IJsonLdContextNormalizedRaw} contextAfter A new context that is being applied on the first one.
       * @param {IExpandOptions} expandOptions Options that are needed for any expansions during this validation.
       * @param {string[]} keys Optional set of keys from the context to validate. If left undefined, all
       * keys defined in contextAfter will be checked.
       */
      validateKeywordRedefinitions(contextBefore, contextAfter, expandOptions, keys) {
        for (const key of keys !== null && keys !== void 0 ? keys : Object.keys(contextAfter)) {
          if (Util_1.Util.isTermProtected(contextBefore, key)) {
            if (typeof contextAfter[key] === "string") {
              contextAfter[key] = { "@id": contextAfter[key], "@protected": true };
            } else {
              contextAfter[key] = Object.assign(Object.assign({}, contextAfter[key]), { "@protected": true });
            }
            if (!Util_1.Util.deepEqual(contextBefore[key], contextAfter[key])) {
              throw new ErrorCoded_1.ErrorCoded(`Attempted to override the protected keyword ${key} from ${JSON.stringify(Util_1.Util.getContextValueId(contextBefore[key]))} to ${JSON.stringify(Util_1.Util.getContextValueId(contextAfter[key]))}`, ErrorCoded_1.ERROR_CODES.PROTECTED_TERM_REDEFINITION);
            }
          }
        }
      }
      /**
       * Validate the entries of the given context.
       * @param {IJsonLdContextNormalizedRaw} context A context.
       * @param {IParseOptions} options The parse options.
       */
      validate(context, { processingMode }) {
        for (const key of Object.keys(context)) {
          if (Util_1.Util.isReservedInternalKeyword(key)) {
            continue;
          }
          if (key === "") {
            throw new ErrorCoded_1.ErrorCoded(`The empty term is not allowed, got: '${key}': '${JSON.stringify(context[key])}'`, ErrorCoded_1.ERROR_CODES.INVALID_TERM_DEFINITION);
          }
          const value = context[key];
          const valueType = typeof value;
          if (Util_1.Util.isPotentialKeyword(key)) {
            switch (key.substr(1)) {
              case "vocab":
                if (value !== null && valueType !== "string") {
                  throw new ErrorCoded_1.ErrorCoded(`Found an invalid @vocab IRI: ${value}`, ErrorCoded_1.ERROR_CODES.INVALID_VOCAB_MAPPING);
                }
                break;
              case "base":
                if (value !== null && valueType !== "string") {
                  throw new ErrorCoded_1.ErrorCoded(`Found an invalid @base IRI: ${context[key]}`, ErrorCoded_1.ERROR_CODES.INVALID_BASE_IRI);
                }
                break;
              case "language":
                if (value !== null) {
                  _ContextParser.validateLanguage(value, true, ErrorCoded_1.ERROR_CODES.INVALID_DEFAULT_LANGUAGE);
                }
                break;
              case "version":
                if (value !== null && valueType !== "number") {
                  throw new ErrorCoded_1.ErrorCoded(`Found an invalid @version number: ${value}`, ErrorCoded_1.ERROR_CODES.INVALID_VERSION_VALUE);
                }
                break;
              case "direction":
                if (value !== null) {
                  _ContextParser.validateDirection(value, true);
                }
                break;
              case "propagate":
                if (processingMode === 1) {
                  throw new ErrorCoded_1.ErrorCoded(`Found an illegal @propagate keyword: ${value}`, ErrorCoded_1.ERROR_CODES.INVALID_CONTEXT_ENTRY);
                }
                if (value !== null && valueType !== "boolean") {
                  throw new ErrorCoded_1.ErrorCoded(`Found an invalid @propagate value: ${value}`, ErrorCoded_1.ERROR_CODES.INVALID_PROPAGATE_VALUE);
                }
                break;
            }
            if (Util_1.Util.isValidKeyword(key) && Util_1.Util.isValidKeyword(Util_1.Util.getContextValueId(value))) {
              throw new ErrorCoded_1.ErrorCoded(`Illegal keyword alias in term value, found: '${key}': '${Util_1.Util.getContextValueId(value)}'`, ErrorCoded_1.ERROR_CODES.KEYWORD_REDEFINITION);
            }
            continue;
          }
          if (value !== null) {
            switch (valueType) {
              case "string":
                if (Util_1.Util.getPrefix(value, context) === key) {
                  throw new ErrorCoded_1.ErrorCoded(`Detected cyclical IRI mapping in context entry: '${key}': '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.CYCLIC_IRI_MAPPING);
                }
                if (Util_1.Util.isValidIriWeak(key)) {
                  if (value === "@type") {
                    throw new ErrorCoded_1.ErrorCoded(`IRIs can not be mapped to @type, found: '${key}': '${value}'`, ErrorCoded_1.ERROR_CODES.INVALID_IRI_MAPPING);
                  } else if (Util_1.Util.isValidIri(value) && value !== new JsonLdContextNormalized_1.JsonLdContextNormalized(context).expandTerm(key)) {
                    throw new ErrorCoded_1.ErrorCoded(`IRIs can not be mapped to other IRIs, found: '${key}': '${value}'`, ErrorCoded_1.ERROR_CODES.INVALID_IRI_MAPPING);
                  }
                }
                break;
              case "object":
                if (!Util_1.Util.isCompactIri(key) && !("@id" in value) && (value["@type"] === "@id" ? !context["@base"] : !context["@vocab"])) {
                  throw new ErrorCoded_1.ErrorCoded(`Missing @id in context entry: '${key}': '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.INVALID_IRI_MAPPING);
                }
                for (const objectKey of Object.keys(value)) {
                  const objectValue = value[objectKey];
                  if (!objectValue) {
                    continue;
                  }
                  switch (objectKey) {
                    case "@id":
                      if (Util_1.Util.isValidKeyword(objectValue) && objectValue !== "@type" && objectValue !== "@id" && objectValue !== "@graph" && objectValue !== "@nest") {
                        throw new ErrorCoded_1.ErrorCoded(`Illegal keyword alias in term value, found: '${key}': '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.INVALID_IRI_MAPPING);
                      }
                      if (Util_1.Util.isValidIriWeak(key)) {
                        if (objectValue === "@type") {
                          throw new ErrorCoded_1.ErrorCoded(`IRIs can not be mapped to @type, found: '${key}': '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.INVALID_IRI_MAPPING);
                        } else if (Util_1.Util.isValidIri(objectValue) && objectValue !== new JsonLdContextNormalized_1.JsonLdContextNormalized(context).expandTerm(key)) {
                          throw new ErrorCoded_1.ErrorCoded(`IRIs can not be mapped to other IRIs, found: '${key}': '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.INVALID_IRI_MAPPING);
                        }
                      }
                      if (typeof objectValue !== "string") {
                        throw new ErrorCoded_1.ErrorCoded(`Detected non-string @id in context entry: '${key}': '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.INVALID_IRI_MAPPING);
                      }
                      if (Util_1.Util.getPrefix(objectValue, context) === key) {
                        throw new ErrorCoded_1.ErrorCoded(`Detected cyclical IRI mapping in context entry: '${key}': '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.CYCLIC_IRI_MAPPING);
                      }
                      break;
                    case "@type":
                      if (value["@container"] === "@type" && objectValue !== "@id" && objectValue !== "@vocab") {
                        throw new ErrorCoded_1.ErrorCoded(`@container: @type only allows @type: @id or @vocab, but got: '${key}': '${objectValue}'`, ErrorCoded_1.ERROR_CODES.INVALID_TYPE_MAPPING);
                      }
                      if (typeof objectValue !== "string") {
                        throw new ErrorCoded_1.ErrorCoded(`The value of an '@type' must be a string, got '${JSON.stringify(valueType)}'`, ErrorCoded_1.ERROR_CODES.INVALID_TYPE_MAPPING);
                      }
                      if (objectValue !== "@id" && objectValue !== "@vocab" && (processingMode === 1 || objectValue !== "@json") && (processingMode === 1 || objectValue !== "@none") && (objectValue[0] === "_" || !Util_1.Util.isValidIri(objectValue))) {
                        throw new ErrorCoded_1.ErrorCoded(`A context @type must be an absolute IRI, found: '${key}': '${objectValue}'`, ErrorCoded_1.ERROR_CODES.INVALID_TYPE_MAPPING);
                      }
                      break;
                    case "@reverse":
                      if (typeof objectValue === "string" && value["@id"] && value["@id"] !== objectValue) {
                        throw new ErrorCoded_1.ErrorCoded(`Found non-matching @id and @reverse term values in '${key}':'${objectValue}' and '${value["@id"]}'`, ErrorCoded_1.ERROR_CODES.INVALID_REVERSE_PROPERTY);
                      }
                      if ("@nest" in value) {
                        throw new ErrorCoded_1.ErrorCoded(`@nest is not allowed in the reverse property '${key}'`, ErrorCoded_1.ERROR_CODES.INVALID_REVERSE_PROPERTY);
                      }
                      break;
                    case "@container":
                      if (processingMode === 1) {
                        if (Object.keys(objectValue).length > 1 || Util_1.Util.CONTAINERS_1_0.indexOf(Object.keys(objectValue)[0]) < 0) {
                          throw new ErrorCoded_1.ErrorCoded(`Invalid term @container for '${key}' ('${Object.keys(objectValue)}') in 1.0, must be only one of ${Util_1.Util.CONTAINERS_1_0.join(", ")}`, ErrorCoded_1.ERROR_CODES.INVALID_CONTAINER_MAPPING);
                        }
                      }
                      for (const containerValue of Object.keys(objectValue)) {
                        if (containerValue === "@list" && value["@reverse"]) {
                          throw new ErrorCoded_1.ErrorCoded(`Term value can not be @container: @list and @reverse at the same time on '${key}'`, ErrorCoded_1.ERROR_CODES.INVALID_REVERSE_PROPERTY);
                        }
                        if (Util_1.Util.CONTAINERS.indexOf(containerValue) < 0) {
                          throw new ErrorCoded_1.ErrorCoded(`Invalid term @container for '${key}' ('${containerValue}'), must be one of ${Util_1.Util.CONTAINERS.join(", ")}`, ErrorCoded_1.ERROR_CODES.INVALID_CONTAINER_MAPPING);
                        }
                      }
                      break;
                    case "@language":
                      _ContextParser.validateLanguage(objectValue, true, ErrorCoded_1.ERROR_CODES.INVALID_LANGUAGE_MAPPING);
                      break;
                    case "@direction":
                      _ContextParser.validateDirection(objectValue, true);
                      break;
                    case "@prefix":
                      if (objectValue !== null && typeof objectValue !== "boolean") {
                        throw new ErrorCoded_1.ErrorCoded(`Found an invalid term @prefix boolean in: '${key}': '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.INVALID_PREFIX_VALUE);
                      }
                      if (!("@id" in value) && !Util_1.Util.isValidIri(key)) {
                        throw new ErrorCoded_1.ErrorCoded(`Invalid @prefix definition for '${key}' ('${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.INVALID_TERM_DEFINITION);
                      }
                      break;
                    case "@index":
                      if (processingMode === 1 || !value["@container"] || !value["@container"]["@index"]) {
                        throw new ErrorCoded_1.ErrorCoded(`Attempt to add illegal key to value object: '${key}': '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.INVALID_TERM_DEFINITION);
                      }
                      break;
                    case "@nest":
                      if (Util_1.Util.isPotentialKeyword(objectValue) && objectValue !== "@nest") {
                        throw new ErrorCoded_1.ErrorCoded(`Found an invalid term @nest value in: '${key}': '${JSON.stringify(value)}'`, ErrorCoded_1.ERROR_CODES.INVALID_NEST_VALUE);
                      }
                  }
                }
                break;
              default:
                throw new ErrorCoded_1.ErrorCoded(`Found an invalid term value: '${key}': '${value}'`, ErrorCoded_1.ERROR_CODES.INVALID_TERM_DEFINITION);
            }
          }
        }
      }
      /**
       * Apply the @base context entry to the given context under certain circumstances.
       * @param context A context.
       * @param options Parsing options.
       * @param inheritFromParent If the @base value from the parent context can be inherited.
       * @return The given context.
       */
      applyBaseEntry(context, options, inheritFromParent) {
        if (typeof context === "string") {
          return context;
        }
        if (inheritFromParent && !("@base" in context) && options.parentContext && typeof options.parentContext === "object" && "@base" in options.parentContext) {
          context["@base"] = options.parentContext["@base"];
          if (options.parentContext["@__baseDocument"]) {
            context["@__baseDocument"] = true;
          }
        }
        if (options.baseIRI && !options.external) {
          if (!("@base" in context)) {
            context["@base"] = options.baseIRI;
            context["@__baseDocument"] = true;
          } else if (context["@base"] !== null && typeof context["@base"] === "string" && !Util_1.Util.isValidIri(context["@base"])) {
            context["@base"] = (0, relative_to_absolute_iri_1.resolve)(context["@base"], options.parentContext && options.parentContext["@base"] || options.baseIRI);
          }
        }
        return context;
      }
      /**
       * Resolve relative context IRIs, or return full IRIs as-is.
       * @param {string} contextIri A context IRI.
       * @param {string} baseIRI A base IRI.
       * @return {string} The normalized context IRI.
       */
      normalizeContextIri(contextIri, baseIRI) {
        if (!Util_1.Util.isValidIri(contextIri)) {
          try {
            contextIri = (0, relative_to_absolute_iri_1.resolve)(contextIri, baseIRI);
          } catch (_a) {
            throw new Error(`Invalid context IRI: ${contextIri}`);
          }
        }
        if (this.redirectSchemaOrgHttps && contextIri.startsWith("http://schema.org")) {
          contextIri = "https://schema.org/";
        }
        return contextIri;
      }
      /**
       * Parse scoped contexts in the given context.
       * @param {IJsonLdContextNormalizedRaw} context A context.
       * @param {IParseOptions} options Parsing options.
       * @return {IJsonLdContextNormalizedRaw} The mutated input context.
       * @param {string[]} keys Optional set of keys from the context to parseInnerContexts of. If left undefined, all
       * keys in the context will be iterated over.
       */
      async parseInnerContexts(context, options, keys) {
        for (const key of keys !== null && keys !== void 0 ? keys : Object.keys(context)) {
          const value = context[key];
          if (value && typeof value === "object") {
            if ("@context" in value && value["@context"] !== null && !options.ignoreScopedContexts) {
              if (this.validateContext) {
                try {
                  const parentContext = Object.assign(Object.assign({}, context), { [key]: Object.assign({}, context[key]) });
                  delete parentContext[key]["@context"];
                  await this.parse(value["@context"], Object.assign(Object.assign({}, options), { external: false, parentContext, ignoreProtection: true, ignoreRemoteScopedContexts: true, ignoreScopedContexts: true }));
                } catch (e) {
                  throw new ErrorCoded_1.ErrorCoded(e.message, ErrorCoded_1.ERROR_CODES.INVALID_SCOPED_CONTEXT);
                }
              }
              context[key] = Object.assign(Object.assign({}, value), { "@context": (await this.parse(value["@context"], Object.assign(Object.assign({}, options), { external: false, minimalProcessing: true, ignoreRemoteScopedContexts: true, parentContext: context }))).getContextRaw() });
            }
          }
        }
        return context;
      }
      async parse(context, options = {}, internalOptions = {}) {
        const { baseIRI, parentContext, external, processingMode = _ContextParser.DEFAULT_PROCESSING_MODE, normalizeLanguageTags, ignoreProtection, minimalProcessing } = options;
        const remoteContexts = options.remoteContexts || {};
        if (Object.keys(remoteContexts).length >= this.remoteContextsDepthLimit) {
          throw new ErrorCoded_1.ErrorCoded("Detected an overflow in remote context inclusions: " + Object.keys(remoteContexts), ErrorCoded_1.ERROR_CODES.CONTEXT_OVERFLOW);
        }
        if (context === null || context === void 0) {
          if (!ignoreProtection && parentContext && Util_1.Util.hasProtectedTerms(parentContext)) {
            throw new ErrorCoded_1.ErrorCoded("Illegal context nullification when terms are protected", ErrorCoded_1.ERROR_CODES.INVALID_CONTEXT_NULLIFICATION);
          }
          return new JsonLdContextNormalized_1.JsonLdContextNormalized(this.applyBaseEntry({}, options, false));
        } else if (typeof context === "string") {
          const contextIri = this.normalizeContextIri(context, baseIRI);
          const overriddenLoad = this.getOverriddenLoad(contextIri, options);
          if (overriddenLoad) {
            return new JsonLdContextNormalized_1.JsonLdContextNormalized(overriddenLoad);
          }
          const parsedStringContext = await this.parse(await this.load(contextIri), Object.assign(Object.assign({}, options), { baseIRI: contextIri, external: true, remoteContexts: Object.assign(Object.assign({}, remoteContexts), { [contextIri]: true }) }));
          this.applyBaseEntry(parsedStringContext.getContextRaw(), options, true);
          return parsedStringContext;
        } else if (Array.isArray(context)) {
          const contextIris = [];
          const contexts = await Promise.all(context.map((subContext, i) => {
            if (typeof subContext === "string") {
              const contextIri = this.normalizeContextIri(subContext, baseIRI);
              contextIris[i] = contextIri;
              const overriddenLoad = this.getOverriddenLoad(contextIri, options);
              if (overriddenLoad) {
                return overriddenLoad;
              }
              return this.load(contextIri);
            } else {
              return subContext;
            }
          }));
          if (minimalProcessing) {
            return new JsonLdContextNormalized_1.JsonLdContextNormalized(contexts);
          }
          const reducedContexts = await contexts.reduce((accContextPromise, contextEntry, i) => accContextPromise.then((accContext) => this.parse(
            contextEntry,
            Object.assign(Object.assign({}, options), { baseIRI: contextIris[i] || options.baseIRI, external: !!contextIris[i] || options.external, parentContext: accContext.getContextRaw(), remoteContexts: contextIris[i] ? Object.assign(Object.assign({}, remoteContexts), { [contextIris[i]]: true }) : remoteContexts }),
            // @ts-expect-error: This third argument causes a type error because we have hidden it from consumers
            {
              skipValidation: i < contexts.length - 1
            }
          )), Promise.resolve(new JsonLdContextNormalized_1.JsonLdContextNormalized(parentContext || {})));
          this.applyBaseEntry(reducedContexts.getContextRaw(), options, true);
          return reducedContexts;
        } else if (typeof context === "object") {
          if ("@context" in context) {
            if (options === null || options === void 0 ? void 0 : options.disallowDirectlyNestedContext) {
              throw new ErrorCoded_1.ErrorCoded(`Keywords can not be aliased to something else.
Tried mapping @context to ${JSON.stringify(context["@context"])}`, ErrorCoded_1.ERROR_CODES.KEYWORD_REDEFINITION);
            }
            return await this.parse(context["@context"], options);
          }
          context = Object.assign({}, context);
          if (external) {
            delete context["@base"];
          }
          this.applyBaseEntry(context, options, true);
          this.containersToHash(context);
          if (minimalProcessing) {
            return new JsonLdContextNormalized_1.JsonLdContextNormalized(context);
          }
          let importContext = {};
          if ("@import" in context) {
            if (processingMode >= 1.1) {
              if (typeof context["@import"] !== "string") {
                throw new ErrorCoded_1.ErrorCoded("An @import value must be a string, but got " + typeof context["@import"], ErrorCoded_1.ERROR_CODES.INVALID_IMPORT_VALUE);
              }
              importContext = await this.loadImportContext(this.normalizeContextIri(context["@import"], baseIRI));
              delete context["@import"];
            } else {
              throw new ErrorCoded_1.ErrorCoded("Context importing is not supported in JSON-LD 1.0", ErrorCoded_1.ERROR_CODES.INVALID_CONTEXT_ENTRY);
            }
          }
          this.applyScopedProtected(importContext, { processingMode }, JsonLdContextNormalized_1.defaultExpandOptions);
          const newContext = Object.assign(importContext, context);
          this.idifyReverseTerms(newContext);
          this.normalize(newContext, { processingMode, normalizeLanguageTags });
          this.applyScopedProtected(newContext, { processingMode }, JsonLdContextNormalized_1.defaultExpandOptions);
          const keys = Object.keys(newContext);
          const overlappingKeys = [];
          if (typeof parentContext === "object") {
            for (const key in parentContext) {
              if (key in newContext) {
                overlappingKeys.push(key);
              } else {
                newContext[key] = parentContext[key];
              }
            }
          }
          await this.parseInnerContexts(newContext, options, keys);
          const newContextWrapped = new JsonLdContextNormalized_1.JsonLdContextNormalized(newContext);
          if ((newContext && newContext["@version"] || _ContextParser.DEFAULT_PROCESSING_MODE) >= 1.1 && (context["@vocab"] && typeof context["@vocab"] === "string" || context["@vocab"] === "")) {
            if (parentContext && "@vocab" in parentContext && context["@vocab"].indexOf(":") < 0) {
              newContext["@vocab"] = parentContext["@vocab"] + context["@vocab"];
            } else if (Util_1.Util.isCompactIri(context["@vocab"]) || context["@vocab"] in newContext) {
              newContext["@vocab"] = newContextWrapped.expandTerm(context["@vocab"], true);
            }
          }
          this.expandPrefixedTerms(newContextWrapped, this.expandContentTypeToBase, keys);
          if (!ignoreProtection && parentContext && processingMode >= 1.1) {
            this.validateKeywordRedefinitions(parentContext, newContext, JsonLdContextNormalized_1.defaultExpandOptions, overlappingKeys);
          }
          if (this.validateContext && !internalOptions.skipValidation) {
            this.validate(newContext, { processingMode });
          }
          return newContextWrapped;
        } else {
          throw new ErrorCoded_1.ErrorCoded(`Tried parsing a context that is not a string, array or object, but got ${context}`, ErrorCoded_1.ERROR_CODES.INVALID_LOCAL_CONTEXT);
        }
      }
      /**
       * Fetch the given URL as a raw JSON-LD context.
       * @param url An URL.
       * @return A promise resolving to a raw JSON-LD context.
       */
      async load(url) {
        const cached = this.documentCache[url];
        if (cached) {
          return cached;
        }
        let document;
        try {
          document = await this.documentLoader.load(url);
        } catch (e) {
          throw new ErrorCoded_1.ErrorCoded(`Failed to load remote context ${url}: ${e.message}`, ErrorCoded_1.ERROR_CODES.LOADING_REMOTE_CONTEXT_FAILED);
        }
        if (!("@context" in document)) {
          throw new ErrorCoded_1.ErrorCoded(`Missing @context in remote context at ${url}`, ErrorCoded_1.ERROR_CODES.INVALID_REMOTE_CONTEXT);
        }
        return this.documentCache[url] = document["@context"];
      }
      /**
       * Override the given context that may be loaded.
       *
       * This will check whether or not the url is recursively being loaded.
       * @param url An URL.
       * @param options Parsing options.
       * @return An overridden context, or null.
       *         Optionally an error can be thrown if a cyclic context is detected.
       */
      getOverriddenLoad(url, options) {
        if (url in (options.remoteContexts || {})) {
          if (options.ignoreRemoteScopedContexts) {
            return url;
          } else {
            throw new ErrorCoded_1.ErrorCoded("Detected a cyclic context inclusion of " + url, ErrorCoded_1.ERROR_CODES.RECURSIVE_CONTEXT_INCLUSION);
          }
        }
        return null;
      }
      /**
       * Load an @import'ed context.
       * @param importContextIri The full URI of an @import value.
       */
      async loadImportContext(importContextIri) {
        let importContext = await this.load(importContextIri);
        if (typeof importContext !== "object" || Array.isArray(importContext)) {
          throw new ErrorCoded_1.ErrorCoded("An imported context must be a single object: " + importContextIri, ErrorCoded_1.ERROR_CODES.INVALID_REMOTE_CONTEXT);
        }
        if ("@import" in importContext) {
          throw new ErrorCoded_1.ErrorCoded("An imported context can not import another context: " + importContextIri, ErrorCoded_1.ERROR_CODES.INVALID_CONTEXT_ENTRY);
        }
        importContext = Object.assign({}, importContext);
        this.containersToHash(importContext);
        return importContext;
      }
    };
    ContextParser.DEFAULT_PROCESSING_MODE = 1.1;
    exports.ContextParser = ContextParser;
  }
});

// node_modules/jsonld-context-parser/lib/IDocumentLoader.js
var require_IDocumentLoader = __commonJS({
  "node_modules/jsonld-context-parser/lib/IDocumentLoader.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/jsonld-context-parser/lib/JsonLdContext.js
var require_JsonLdContext = __commonJS({
  "node_modules/jsonld-context-parser/lib/JsonLdContext.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/jsonld-context-parser/index.js
var require_jsonld_context_parser = __commonJS({
  "node_modules/jsonld-context-parser/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_ContextParser(), exports);
    __exportStar(require_ErrorCoded(), exports);
    __exportStar(require_FetchDocumentLoader(), exports);
    __exportStar(require_IDocumentLoader(), exports);
    __exportStar(require_JsonLdContext(), exports);
    __exportStar(require_JsonLdContextNormalized(), exports);
    __exportStar(require_Util(), exports);
  }
});

// node_modules/rdf-data-factory/lib/BlankNode.js
var require_BlankNode = __commonJS({
  "node_modules/rdf-data-factory/lib/BlankNode.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BlankNode = void 0;
    var BlankNode2 = class {
      constructor(value) {
        this.termType = "BlankNode";
        this.value = value;
      }
      equals(other) {
        return !!other && other.termType === "BlankNode" && other.value === this.value;
      }
    };
    exports.BlankNode = BlankNode2;
  }
});

// node_modules/rdf-data-factory/lib/DefaultGraph.js
var require_DefaultGraph = __commonJS({
  "node_modules/rdf-data-factory/lib/DefaultGraph.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DefaultGraph = void 0;
    var DefaultGraph2 = class {
      constructor() {
        this.termType = "DefaultGraph";
        this.value = "";
      }
      equals(other) {
        return !!other && other.termType === "DefaultGraph";
      }
    };
    exports.DefaultGraph = DefaultGraph2;
    DefaultGraph2.INSTANCE = new DefaultGraph2();
  }
});

// node_modules/rdf-data-factory/lib/NamedNode.js
var require_NamedNode = __commonJS({
  "node_modules/rdf-data-factory/lib/NamedNode.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NamedNode = void 0;
    var NamedNode2 = class {
      constructor(value) {
        this.termType = "NamedNode";
        this.value = value;
      }
      equals(other) {
        return !!other && other.termType === "NamedNode" && other.value === this.value;
      }
    };
    exports.NamedNode = NamedNode2;
  }
});

// node_modules/rdf-data-factory/lib/Literal.js
var require_Literal = __commonJS({
  "node_modules/rdf-data-factory/lib/Literal.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Literal = void 0;
    var NamedNode_1 = require_NamedNode();
    var Literal2 = class _Literal {
      constructor(value, languageOrDatatype) {
        this.termType = "Literal";
        this.value = value;
        if (typeof languageOrDatatype === "string") {
          this.language = languageOrDatatype;
          this.datatype = _Literal.RDF_LANGUAGE_STRING;
          this.direction = "";
        } else if (languageOrDatatype) {
          if ("termType" in languageOrDatatype) {
            this.language = "";
            this.datatype = languageOrDatatype;
            this.direction = "";
          } else {
            this.language = languageOrDatatype.language;
            this.datatype = languageOrDatatype.direction ? _Literal.RDF_DIRECTIONAL_LANGUAGE_STRING : _Literal.RDF_LANGUAGE_STRING;
            this.direction = languageOrDatatype.direction || "";
          }
        } else {
          this.language = "";
          this.datatype = _Literal.XSD_STRING;
          this.direction = "";
        }
      }
      equals(other) {
        return !!other && other.termType === "Literal" && other.value === this.value && other.language === this.language && (other.direction === this.direction || !other.direction && this.direction === "") && this.datatype.equals(other.datatype);
      }
    };
    exports.Literal = Literal2;
    Literal2.RDF_LANGUAGE_STRING = new NamedNode_1.NamedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString");
    Literal2.RDF_DIRECTIONAL_LANGUAGE_STRING = new NamedNode_1.NamedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString");
    Literal2.XSD_STRING = new NamedNode_1.NamedNode("http://www.w3.org/2001/XMLSchema#string");
  }
});

// node_modules/rdf-data-factory/lib/Quad.js
var require_Quad = __commonJS({
  "node_modules/rdf-data-factory/lib/Quad.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Quad = void 0;
    var Quad2 = class {
      constructor(subject, predicate, object, graph) {
        this.termType = "Quad";
        this.value = "";
        this.subject = subject;
        this.predicate = predicate;
        this.object = object;
        this.graph = graph;
      }
      equals(other) {
        return !!other && (other.termType === "Quad" || !other.termType) && this.subject.equals(other.subject) && this.predicate.equals(other.predicate) && this.object.equals(other.object) && this.graph.equals(other.graph);
      }
    };
    exports.Quad = Quad2;
  }
});

// node_modules/rdf-data-factory/lib/Variable.js
var require_Variable = __commonJS({
  "node_modules/rdf-data-factory/lib/Variable.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Variable = void 0;
    var Variable2 = class {
      constructor(value) {
        this.termType = "Variable";
        this.value = value;
      }
      equals(other) {
        return !!other && other.termType === "Variable" && other.value === this.value;
      }
    };
    exports.Variable = Variable2;
  }
});

// node_modules/rdf-data-factory/lib/DataFactory.js
var require_DataFactory = __commonJS({
  "node_modules/rdf-data-factory/lib/DataFactory.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DataFactory = void 0;
    var BlankNode_1 = require_BlankNode();
    var DefaultGraph_1 = require_DefaultGraph();
    var Literal_1 = require_Literal();
    var NamedNode_1 = require_NamedNode();
    var Quad_1 = require_Quad();
    var Variable_1 = require_Variable();
    var dataFactoryCounter = 0;
    var DataFactory2 = class {
      constructor(options) {
        this.blankNodeCounter = 0;
        options = options || {};
        this.blankNodePrefix = options.blankNodePrefix || `df_${dataFactoryCounter++}_`;
      }
      /**
       * @param value The IRI for the named node.
       * @return A new instance of NamedNode.
       * @see NamedNode
       */
      namedNode(value) {
        return new NamedNode_1.NamedNode(value);
      }
      /**
       * @param value The optional blank node identifier.
       * @return A new instance of BlankNode.
       *         If the `value` parameter is undefined a new identifier
       *         for the blank node is generated for each call.
       * @see BlankNode
       */
      blankNode(value) {
        return new BlankNode_1.BlankNode(value || `${this.blankNodePrefix}${this.blankNodeCounter++}`);
      }
      /**
       * @param value              The literal value.
       * @param languageOrDatatype The optional language, datatype, or directional language.
       *                           If `languageOrDatatype` is a NamedNode,
       *                           then it is used for the value of `NamedNode.datatype`.
       *                           If `languageOrDatatype` is a NamedNode, it is used for the value
       *                           of `NamedNode.language`.
       *                           Otherwise, it is used as a directional language,
       *                           from which the language is set to `languageOrDatatype.language`
       *                           and the direction to `languageOrDatatype.direction`.
       * @return A new instance of Literal.
       * @see Literal
       */
      literal(value, languageOrDatatype) {
        return new Literal_1.Literal(value, languageOrDatatype);
      }
      /**
       * This method is optional.
       * @param value The variable name
       * @return A new instance of Variable.
       * @see Variable
       */
      variable(value) {
        return new Variable_1.Variable(value);
      }
      /**
       * @return An instance of DefaultGraph.
       */
      defaultGraph() {
        return DefaultGraph_1.DefaultGraph.INSTANCE;
      }
      /**
       * @param subject   The quad subject term.
       * @param predicate The quad predicate term.
       * @param object    The quad object term.
       * @param graph     The quad graph term.
       * @return A new instance of Quad.
       * @see Quad
       */
      quad(subject, predicate, object, graph) {
        return new Quad_1.Quad(subject, predicate, object, graph || this.defaultGraph());
      }
      /**
       * Create a deep copy of the given term using this data factory.
       * @param original An RDF term.
       * @return A deep copy of the given term.
       */
      fromTerm(original) {
        switch (original.termType) {
          case "NamedNode":
            return this.namedNode(original.value);
          case "BlankNode":
            return this.blankNode(original.value);
          case "Literal":
            if (original.language) {
              return this.literal(original.value, original.language);
            }
            if (!original.datatype.equals(Literal_1.Literal.XSD_STRING)) {
              return this.literal(original.value, this.fromTerm(original.datatype));
            }
            return this.literal(original.value);
          case "Variable":
            return this.variable(original.value);
          case "DefaultGraph":
            return this.defaultGraph();
          case "Quad":
            return this.quad(this.fromTerm(original.subject), this.fromTerm(original.predicate), this.fromTerm(original.object), this.fromTerm(original.graph));
        }
      }
      /**
       * Create a deep copy of the given quad using this data factory.
       * @param original An RDF quad.
       * @return A deep copy of the given quad.
       */
      fromQuad(original) {
        return this.fromTerm(original);
      }
      /**
       * Reset the internal blank node counter.
       */
      resetBlankNodeCounter() {
        this.blankNodeCounter = 0;
      }
    };
    exports.DataFactory = DataFactory2;
  }
});

// node_modules/rdf-data-factory/index.js
var require_rdf_data_factory = __commonJS({
  "node_modules/rdf-data-factory/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_BlankNode(), exports);
    __exportStar(require_DataFactory(), exports);
    __exportStar(require_DefaultGraph(), exports);
    __exportStar(require_Literal(), exports);
    __exportStar(require_NamedNode(), exports);
    __exportStar(require_Quad(), exports);
    __exportStar(require_Variable(), exports);
  }
});

// node_modules/jsonld-streaming-parser/lib/containerhandler/ContainerHandlerIdentifier.js
var require_ContainerHandlerIdentifier = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/containerhandler/ContainerHandlerIdentifier.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ContainerHandlerIdentifier = void 0;
    var ContainerHandlerIdentifier = class {
      canCombineWithGraph() {
        return true;
      }
      async handle(containers, parsingContext, util, keys, value, depth) {
        let id;
        if (parsingContext.emittedStack[depth + 1] && parsingContext.idStack[depth + 1]) {
          id = parsingContext.idStack[depth + 1][0];
        } else {
          const keyUnaliased = await util.getContainerKey(keys[depth], keys, depth);
          const maybeId = keyUnaliased !== null ? await util.resourceToTerm(await parsingContext.getContext(keys), keys[depth]) : util.dataFactory.blankNode();
          if (!maybeId) {
            parsingContext.emittedStack[depth] = false;
            return;
          }
          id = maybeId;
          parsingContext.idStack[depth + 1] = [id];
        }
        let ids = parsingContext.idStack[depth];
        if (!ids) {
          ids = parsingContext.idStack[depth] = [];
        }
        if (!ids.some((term) => term.equals(id))) {
          ids.push(id);
        }
        if (!await parsingContext.handlePendingContainerFlushBuffers()) {
          parsingContext.emittedStack[depth] = false;
        }
      }
    };
    exports.ContainerHandlerIdentifier = ContainerHandlerIdentifier;
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/EntryHandlerPredicate.js
var require_EntryHandlerPredicate = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/EntryHandlerPredicate.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerPredicate = void 0;
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var Util_1 = require_Util2();
    var EntryHandlerPredicate = class _EntryHandlerPredicate {
      /**
       * Handle the given predicate-object by either emitting it,
       * or by placing it in the appropriate stack for later emission when no @graph and/or @id has been defined.
       * @param {ParsingContext} parsingContext A parsing context.
       * @param {Util} util A utility instance.
       * @param {any[]} keys A stack of keys.
       * @param {number} depth The current depth.
       * @param {Term} predicate The predicate.
       * @param {Term} object The object.
       * @param {boolean} reverse If the property is reversed.
       * @param {boolean} isEmbedded If the property exists in an embedded node as direct child.
       * @param {boolean} isAnnotation If the property exists in an annotation object.
       * @return {Promise<void>} A promise resolving when handling is done.
       */
      static async handlePredicateObject(parsingContext, util, keys, depth, predicate, object, reverse, isEmbedded, isAnnotation) {
        const depthProperties = await util.getPropertiesDepth(keys, depth);
        const depthOffsetGraph = await util.getDepthOffsetGraph(depth, keys);
        const depthPropertiesGraph = depth - depthOffsetGraph;
        const subjects = parsingContext.idStack[depthProperties];
        if (subjects && !isAnnotation) {
          for (const subject of subjects) {
            const atGraph = depthOffsetGraph >= 0;
            if (atGraph) {
              const graphs = parsingContext.idStack[depthPropertiesGraph - 1];
              if (graphs) {
                for (const graph of graphs) {
                  util.emitQuadChecked(depth, subject, predicate, object, graph, reverse, isEmbedded);
                }
              } else {
                if (reverse) {
                  util.validateReverseSubject(object);
                  parsingContext.getUnidentifiedGraphBufferSafe(depthPropertiesGraph - 1).push({ subject: object, predicate, object: subject, isEmbedded });
                } else {
                  parsingContext.getUnidentifiedGraphBufferSafe(depthPropertiesGraph - 1).push({ subject, predicate, object, isEmbedded });
                }
              }
            } else {
              const graph = await util.getGraphContainerValue(keys, depthProperties);
              util.emitQuadChecked(depth, subject, predicate, object, graph, reverse, isEmbedded);
            }
          }
        } else {
          if (reverse) {
            util.validateReverseSubject(object);
          }
          if (isAnnotation) {
            if (parsingContext.rdfstar) {
              if (parsingContext.idStack[depth]) {
                parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found an illegal @id inside an annotation: ${parsingContext.idStack[depth][0].value}`, jsonld_context_parser_1.ERROR_CODES.INVALID_ANNOTATION));
              }
              for (let i = 0; i < depth; i++) {
                if (await util.unaliasKeyword(keys[i], keys, i) === "@id") {
                  parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found an illegal annotation inside an embedded node`, jsonld_context_parser_1.ERROR_CODES.INVALID_ANNOTATION));
                }
              }
              const annotationsBuffer = parsingContext.getAnnotationsBufferSafe(depthProperties);
              const newAnnotation = { predicate, object, reverse, nestedAnnotations: [], depth: depthProperties };
              annotationsBuffer.push(newAnnotation);
              for (let i = annotationsBuffer.length - 2; i >= 0; i--) {
                const existingAnnotation = annotationsBuffer[i];
                if (existingAnnotation.depth > depthProperties) {
                  newAnnotation.nestedAnnotations.push(existingAnnotation);
                  annotationsBuffer.splice(i, 1);
                }
              }
            }
          } else {
            parsingContext.getUnidentifiedValueBufferSafe(depthProperties).push({ predicate, object, reverse, isEmbedded });
          }
        }
      }
      isPropertyHandler() {
        return true;
      }
      isStackProcessor() {
        return true;
      }
      async validate(parsingContext, util, keys, depth, inProperty) {
        const key = keys[depth];
        if (key) {
          const context = await parsingContext.getContext(keys);
          if (!parsingContext.jsonLiteralStack[depth] && await util.predicateToTerm(context, keys[depth])) {
            if (Util_1.Util.getContextValueType(context, key) === "@json") {
              parsingContext.jsonLiteralStack[depth + 1] = true;
            }
            return true;
          }
        }
        return false;
      }
      async test(parsingContext, util, key, keys, depth) {
        return keys[depth];
      }
      async handle(parsingContext, util, key, keys, value, depth, testResult) {
        const keyOriginal = keys[depth];
        const context = await parsingContext.getContext(keys);
        const predicate = await util.predicateToTerm(context, key);
        if (predicate) {
          const objects = await util.valueToTerm(context, key, value, depth, keys);
          if (objects.length) {
            for (let object of objects) {
              let parentKey = await util.unaliasKeywordParent(keys, depth);
              const reverse = Util_1.Util.isPropertyReverse(context, keyOriginal, parentKey);
              let parentDepthOffset = 0;
              while (parentKey === "@reverse" || typeof parentKey === "number") {
                if (typeof parentKey === "number") {
                  parentDepthOffset++;
                } else {
                  depth--;
                }
                parentKey = await util.unaliasKeywordParent(keys, depth - parentDepthOffset);
              }
              const isEmbedded = Util_1.Util.isPropertyInEmbeddedNode(parentKey);
              util.validateReverseInEmbeddedNode(key, reverse, isEmbedded);
              const isAnnotation = Util_1.Util.isPropertyInAnnotationObject(parentKey);
              if (value) {
                const listValueContainer = "@list" in Util_1.Util.getContextValueContainer(context, key);
                if (listValueContainer || value["@list"]) {
                  if ((listValueContainer && !Array.isArray(value) && !value["@list"] || value["@list"] && !Array.isArray(value["@list"])) && object !== util.rdfNil) {
                    const listPointer = util.dataFactory.blankNode();
                    parsingContext.emitQuad(depth, util.dataFactory.quad(listPointer, util.rdfRest, util.rdfNil, util.getDefaultGraph()));
                    parsingContext.emitQuad(depth, util.dataFactory.quad(listPointer, util.rdfFirst, object, util.getDefaultGraph()));
                    object = listPointer;
                  }
                  if (reverse && !parsingContext.allowSubjectList) {
                    throw new jsonld_context_parser_1.ErrorCoded(`Found illegal list value in subject position at ${key}`, jsonld_context_parser_1.ERROR_CODES.INVALID_REVERSE_PROPERTY_VALUE);
                  }
                }
              }
              await _EntryHandlerPredicate.handlePredicateObject(parsingContext, util, keys, depth, predicate, object, reverse, isEmbedded, isAnnotation);
            }
          }
        }
      }
    };
    exports.EntryHandlerPredicate = EntryHandlerPredicate;
  }
});

// node_modules/jsonld-streaming-parser/lib/containerhandler/ContainerHandlerIndex.js
var require_ContainerHandlerIndex = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/containerhandler/ContainerHandlerIndex.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ContainerHandlerIndex = void 0;
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var EntryHandlerPredicate_1 = require_EntryHandlerPredicate();
    var Util_1 = require_Util2();
    var ContainerHandlerIndex = class {
      canCombineWithGraph() {
        return true;
      }
      async handle(containers, parsingContext, util, keys, value, depth) {
        if (!Array.isArray(value)) {
          const graphContainer = "@graph" in containers;
          const context = await parsingContext.getContext(keys);
          const indexKey = keys[depth - 1];
          const indexPropertyRaw = Util_1.Util.getContextValueIndex(context, indexKey);
          if (indexPropertyRaw) {
            if (jsonld_context_parser_1.Util.isPotentialKeyword(indexPropertyRaw)) {
              throw new jsonld_context_parser_1.ErrorCoded(`Keywords can not be used as @index value, got: ${indexPropertyRaw}`, jsonld_context_parser_1.ERROR_CODES.INVALID_TERM_DEFINITION);
            }
            if (typeof indexPropertyRaw !== "string") {
              throw new jsonld_context_parser_1.ErrorCoded(`@index values must be strings, got: ${indexPropertyRaw}`, jsonld_context_parser_1.ERROR_CODES.INVALID_TERM_DEFINITION);
            }
            if (typeof value !== "object") {
              if (Util_1.Util.getContextValueType(context, indexKey) !== "@id") {
                throw new jsonld_context_parser_1.ErrorCoded(`Property-based index containers require nodes as values or strings with @type: @id, but got: ${value}`, jsonld_context_parser_1.ERROR_CODES.INVALID_VALUE_OBJECT);
              }
              const id = util.resourceToTerm(context, value);
              if (id) {
                parsingContext.idStack[depth + 1] = [id];
              }
            }
            const indexProperty = util.createVocabOrBaseTerm(context, indexPropertyRaw);
            if (indexProperty) {
              const indexValues = await util.valueToTerm(context, indexPropertyRaw, await util.getContainerKey(keys[depth], keys, depth), depth, keys);
              if (graphContainer) {
                const graphId = await util.getGraphContainerValue(keys, depth + 1);
                for (const indexValue of indexValues) {
                  parsingContext.emitQuad(depth, util.dataFactory.quad(graphId, indexProperty, indexValue, util.getDefaultGraph()));
                }
              } else {
                for (const indexValue of indexValues) {
                  await EntryHandlerPredicate_1.EntryHandlerPredicate.handlePredicateObject(parsingContext, util, keys, depth + 1, indexProperty, indexValue, false, false, false);
                }
              }
            }
          }
          const depthOffset = graphContainer ? 2 : 1;
          await parsingContext.newOnValueJob(keys.slice(0, keys.length - depthOffset), value, depth - depthOffset, true);
          await parsingContext.handlePendingContainerFlushBuffers();
        }
        parsingContext.emittedStack[depth] = false;
      }
    };
    exports.ContainerHandlerIndex = ContainerHandlerIndex;
  }
});

// node_modules/jsonld-streaming-parser/lib/containerhandler/ContainerHandlerLanguage.js
var require_ContainerHandlerLanguage = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/containerhandler/ContainerHandlerLanguage.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ContainerHandlerLanguage = void 0;
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var ContainerHandlerLanguage = class {
      canCombineWithGraph() {
        return false;
      }
      async handle(containers, parsingContext, util, keys, value, depth) {
        const language = await util.getContainerKey(keys[depth], keys, depth);
        if (Array.isArray(value)) {
          value = value.map((subValue) => ({ "@value": subValue, "@language": language }));
        } else {
          if (typeof value !== "string") {
            throw new jsonld_context_parser_1.ErrorCoded(`Got invalid language map value, got '${JSON.stringify(value)}', but expected string`, jsonld_context_parser_1.ERROR_CODES.INVALID_LANGUAGE_MAP_VALUE);
          }
          value = { "@value": value, "@language": language };
        }
        await parsingContext.newOnValueJob(keys.slice(0, keys.length - 1), value, depth - 1, true);
        parsingContext.emittedStack[depth] = false;
      }
    };
    exports.ContainerHandlerLanguage = ContainerHandlerLanguage;
  }
});

// node_modules/jsonld-streaming-parser/lib/containerhandler/ContainerHandlerType.js
var require_ContainerHandlerType = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/containerhandler/ContainerHandlerType.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ContainerHandlerType = void 0;
    var EntryHandlerPredicate_1 = require_EntryHandlerPredicate();
    var Util_1 = require_Util2();
    var ContainerHandlerType = class {
      canCombineWithGraph() {
        return false;
      }
      async handle(containers, parsingContext, util, keys, value, depth) {
        if (!Array.isArray(value)) {
          if (typeof value === "string") {
            const context = await parsingContext.getContext(keys);
            const containerTypeType = Util_1.Util.getContextValueType(context, keys[depth - 1]);
            const id = containerTypeType === "@vocab" ? await util.createVocabOrBaseTerm(context, value) : await util.resourceToTerm(context, value);
            if (id) {
              const subValue = { "@id": id.termType === "NamedNode" ? id.value : value };
              await parsingContext.newOnValueJob(keys.slice(0, keys.length - 1), subValue, depth - 1, true);
              parsingContext.idStack[depth + 1] = [id];
            }
          } else {
            const entryHasIdentifier = !!parsingContext.idStack[depth + 1];
            if (!entryHasIdentifier) {
              delete parsingContext.idStack[depth];
            }
            await parsingContext.newOnValueJob(keys.slice(0, keys.length - 1), value, depth - 1, true);
            if (!entryHasIdentifier) {
              parsingContext.idStack[depth + 1] = parsingContext.idStack[depth];
            }
          }
          const keyOriginal = await util.getContainerKey(keys[depth], keys, depth);
          const type = keyOriginal !== null ? util.createVocabOrBaseTerm(await parsingContext.getContext(keys), keyOriginal) : null;
          if (type) {
            await EntryHandlerPredicate_1.EntryHandlerPredicate.handlePredicateObject(parsingContext, util, keys, depth + 1, util.rdfType, type, false, false, false);
          }
          await parsingContext.handlePendingContainerFlushBuffers();
        }
        parsingContext.emittedStack[depth] = false;
      }
    };
    exports.ContainerHandlerType = ContainerHandlerType;
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/EntryHandlerContainer.js
var require_EntryHandlerContainer = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/EntryHandlerContainer.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerContainer = void 0;
    var ContainerHandlerIdentifier_1 = require_ContainerHandlerIdentifier();
    var ContainerHandlerIndex_1 = require_ContainerHandlerIndex();
    var ContainerHandlerLanguage_1 = require_ContainerHandlerLanguage();
    var ContainerHandlerType_1 = require_ContainerHandlerType();
    var Util_1 = require_Util2();
    var EntryHandlerContainer = class _EntryHandlerContainer {
      /**
       * Check fit the given container is a simple @graph container.
       * Concretely, it will check if no @index or @id is active as well.
       * @param containers A container hash.
       */
      static isSimpleGraphContainer(containers) {
        return "@graph" in containers && ("@set" in containers && Object.keys(containers).length === 2 || Object.keys(containers).length === 1);
      }
      /**
       * Check fit the given container is a complex @graph container.
       * Concretely, it will check if @index or @id is active as well next to @graph.
       * @param containers A container hash.
       */
      static isComplexGraphContainer(containers) {
        return "@graph" in containers && ("@set" in containers && Object.keys(containers).length > 2 || !("@set" in containers) && Object.keys(containers).length > 1);
      }
      /**
       * Create an graph container index that can be used for identifying a graph term inside the graphContainerTermStack.
       * @param containers The applicable containers.
       * @param depth The container depth.
       * @param keys The array of keys.
       * @return The graph index.
       */
      static getContainerGraphIndex(containers, depth, keys) {
        let isSimpleGraphContainer = _EntryHandlerContainer.isSimpleGraphContainer(containers);
        let index = "";
        for (let i = depth; i < keys.length; i++) {
          if (!isSimpleGraphContainer || typeof keys[i] === "number") {
            index += ":" + keys[i];
          }
          if (!isSimpleGraphContainer && typeof keys[i] !== "number") {
            isSimpleGraphContainer = true;
          }
        }
        return index;
      }
      /**
       * Return the applicable container type at the given depth.
       *
       * This will ignore any arrays in the key chain.
       *
       * @param {ParsingContext} parsingContext A parsing context.
       * @param {any[]} keys The array of keys.
       * @param {number} depth The current depth.
       * @return {Promise<{ containers: {[typeName: string]: boolean}, depth: number, fallback: boolean }>}
       *          All applicable containers for the given depth,
       *          the `depth` of the container root (can change when arrays are in the key chain),
       *          and the `fallback` flag that indicates if the default container type was returned
       *            (i.e., no dedicated container type is defined).
       */
      static async getContainerHandler(parsingContext, keys, depth) {
        const fallback = {
          containers: { "@set": true },
          depth,
          fallback: true
        };
        let checkGraphContainer = false;
        const context = await parsingContext.getContext(keys, 2);
        for (let i = depth - 1; i >= 0; i--) {
          if (typeof keys[i] !== "number") {
            const containersSelf = Util_1.Util.getContextValue(context, "@container", keys[i], false);
            if (containersSelf && _EntryHandlerContainer.isSimpleGraphContainer(containersSelf)) {
              return {
                containers: containersSelf,
                depth: i + 1,
                fallback: false
              };
            }
            const containersParent = Util_1.Util.getContextValue(context, "@container", keys[i - 1], false);
            if (!containersParent) {
              if (checkGraphContainer) {
                return fallback;
              }
              checkGraphContainer = true;
            } else {
              const graphContainer = "@graph" in containersParent;
              for (const containerHandleName in _EntryHandlerContainer.CONTAINER_HANDLERS) {
                if (containersParent[containerHandleName]) {
                  if (graphContainer) {
                    if (_EntryHandlerContainer.CONTAINER_HANDLERS[containerHandleName].canCombineWithGraph()) {
                      return {
                        containers: containersParent,
                        depth: i,
                        fallback: false
                      };
                    } else {
                      return fallback;
                    }
                  } else {
                    if (checkGraphContainer) {
                      return fallback;
                    } else {
                      return {
                        containers: containersParent,
                        depth: i,
                        fallback: false
                      };
                    }
                  }
                }
              }
              return fallback;
            }
          }
        }
        return fallback;
      }
      /**
       * Check if we are handling a value at the given depth
       * that is part of something that should be handled as a container,
       * AND if this container should be buffered, so that it can be handled by a dedicated container handler.
       *
       * For instance, any container with @graph will NOT be buffered.
       *
       * This will ignore any arrays in the key chain.
       *
       * @param {ParsingContext} parsingContext A parsing context.
       * @param {any[]} keys The array of keys.
       * @param {number} depth The current depth.
       * @return {Promise<boolean>} If we are in the scope of a container handler.
       */
      static async isBufferableContainerHandler(parsingContext, keys, depth) {
        const handler = await _EntryHandlerContainer.getContainerHandler(parsingContext, keys, depth);
        return !handler.fallback && !("@graph" in handler.containers);
      }
      isPropertyHandler() {
        return false;
      }
      isStackProcessor() {
        return true;
      }
      async validate(parsingContext, util, keys, depth, inProperty) {
        return !!await this.test(parsingContext, util, null, keys, depth);
      }
      async test(parsingContext, util, key, keys, depth) {
        const containers = Util_1.Util.getContextValueContainer(await parsingContext.getContext(keys, 2), keys[depth - 1]);
        for (const containerName in _EntryHandlerContainer.CONTAINER_HANDLERS) {
          if (containers[containerName]) {
            return {
              containers,
              handler: _EntryHandlerContainer.CONTAINER_HANDLERS[containerName]
            };
          }
        }
        return null;
      }
      async handle(parsingContext, util, key, keys, value, depth, testResult) {
        return testResult.handler.handle(testResult.containers, parsingContext, util, keys, value, depth);
      }
    };
    exports.EntryHandlerContainer = EntryHandlerContainer;
    EntryHandlerContainer.CONTAINER_HANDLERS = {
      "@id": new ContainerHandlerIdentifier_1.ContainerHandlerIdentifier(),
      "@index": new ContainerHandlerIndex_1.ContainerHandlerIndex(),
      "@language": new ContainerHandlerLanguage_1.ContainerHandlerLanguage(),
      "@type": new ContainerHandlerType_1.ContainerHandlerType()
    };
  }
});

// node_modules/jsonld-streaming-parser/node_modules/canonicalize/lib/canonicalize.js
var require_canonicalize = __commonJS({
  "node_modules/jsonld-streaming-parser/node_modules/canonicalize/lib/canonicalize.js"(exports, module) {
    "use strict";
    module.exports = function serialize(object) {
      if (object === null || typeof object !== "object" || object.toJSON != null) {
        return JSON.stringify(object);
      }
      if (Array.isArray(object)) {
        return "[" + object.reduce((t, cv, ci) => {
          const comma = ci === 0 ? "" : ",";
          const value = cv === void 0 || typeof cv === "symbol" ? null : cv;
          return t + comma + serialize(value);
        }, "") + "]";
      }
      return "{" + Object.keys(object).sort().reduce((t, cv, ci) => {
        if (object[cv] === void 0 || typeof object[cv] === "symbol") {
          return t;
        }
        const comma = t.length === 0 ? "" : ",";
        return t + comma + serialize(cv) + ":" + serialize(object[cv]);
      }, "") + "}";
    };
  }
});

// node_modules/jsonld-streaming-parser/lib/Util.js
var require_Util2 = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/Util.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Util = void 0;
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var rdf_data_factory_1 = require_rdf_data_factory();
    var EntryHandlerContainer_1 = require_EntryHandlerContainer();
    var canonicalizeJson = require_canonicalize();
    var Util = class _Util {
      constructor(options) {
        this.parsingContext = options.parsingContext;
        this.dataFactory = options.dataFactory || new rdf_data_factory_1.DataFactory();
        this.rdfFirst = this.dataFactory.namedNode(_Util.RDF + "first");
        this.rdfRest = this.dataFactory.namedNode(_Util.RDF + "rest");
        this.rdfNil = this.dataFactory.namedNode(_Util.RDF + "nil");
        this.rdfType = this.dataFactory.namedNode(_Util.RDF + "type");
        this.rdfJson = this.dataFactory.namedNode(_Util.RDF + "JSON");
      }
      /**
       * Helper function to get the value of a context entry,
       * or fallback to a certain value.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param {string} contextKey A pre-defined JSON-LD key in context entries.
       * @param {string} key A context entry key.
       * @param {string} fallback A fallback value for when the given contextKey
       *                          could not be found in the value with the given key.
       * @return {string} The value of the given contextKey in the entry behind key in the given context,
       *                  or the given fallback value.
       */
      static getContextValue(context, contextKey, key, fallback) {
        const entry = context.getContextRaw()[key];
        if (!entry) {
          return fallback;
        }
        const type = entry[contextKey];
        return type === void 0 ? fallback : type;
      }
      /**
       * Get the container type of the given key in the context.
       *
       * Should any context-scoping bugs should occur related to this in the future,
       * it may be required to increase the offset from the depth at which the context is retrieved by one (to 2).
       * This is because containers act 2 levels deep.
       *
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param {string} key A context entry key.
       * @return {string} The container type.
       */
      static getContextValueContainer(context, key) {
        return _Util.getContextValue(context, "@container", key, { "@set": true });
      }
      /**
       * Get the value type of the given key in the context.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param {string} key A context entry key.
       * @return {string} The node type.
       */
      static getContextValueType(context, key) {
        const valueType = _Util.getContextValue(context, "@type", key, null);
        if (valueType === "@none") {
          return null;
        }
        return valueType;
      }
      /**
       * Get the language of the given key in the context.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param {string} key A context entry key.
       * @return {string} The node type.
       */
      static getContextValueLanguage(context, key) {
        return _Util.getContextValue(context, "@language", key, context.getContextRaw()["@language"] || null);
      }
      /**
       * Get the direction of the given key in the context.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param {string} key A context entry key.
       * @return {string} The node type.
       */
      static getContextValueDirection(context, key) {
        return _Util.getContextValue(context, "@direction", key, context.getContextRaw()["@direction"] || null);
      }
      /**
       * Check if the given key in the context is a reversed property.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param {string} key A context entry key.
       * @return {boolean} If the context value has a @reverse key.
       */
      static isContextValueReverse(context, key) {
        return !!_Util.getContextValue(context, "@reverse", key, null);
      }
      /**
       * Get the @index of the given key in the context.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param {string} key A context entry key.
       * @return {string} The index.
       */
      static getContextValueIndex(context, key) {
        return _Util.getContextValue(context, "@index", key, context.getContextRaw()["@index"] || null);
      }
      /**
       * Check if the given key refers to a reversed property.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param {string} key The property key.
       * @param {string} parentKey The parent key.
       * @return {boolean} If the property must be reversed.
       */
      static isPropertyReverse(context, key, parentKey) {
        return parentKey === "@reverse" !== _Util.isContextValueReverse(context, key);
      }
      /**
       * Check if the given key exists inside an embedded node as direct child.
       * @param {string} parentKey The parent key.
       * @return {boolean} If the property is embedded.
       */
      static isPropertyInEmbeddedNode(parentKey) {
        return parentKey === "@id";
      }
      /**
       * Check if the given key exists inside an annotation object as direct child.
       * @param {string} parentKey The parent key.
       * @return {boolean} If the property is an annotation.
       */
      static isPropertyInAnnotationObject(parentKey) {
        return parentKey === "@annotation";
      }
      /**
       * Check if the given IRI is valid.
       * @param {string} iri A potential IRI.
       * @return {boolean} If the given IRI is valid.
       */
      static isValidIri(iri) {
        return iri !== null && jsonld_context_parser_1.Util.isValidIri(iri);
      }
      /**
       * Check if the given first array (needle) is a prefix of the given second array (haystack).
       * @param needle An array to check if it is a prefix.
       * @param haystack An array to look in.
       */
      static isPrefixArray(needle, haystack) {
        if (needle.length > haystack.length) {
          return false;
        }
        for (let i = 0; i < needle.length; i++) {
          if (needle[i] !== haystack[i]) {
            return false;
          }
        }
        return true;
      }
      /**
       * Make sure that @id-@index pairs are equal over all array values.
       * Reject otherwise.
       * @param {any[]} value An array value.
       * @return {Promise<void>} A promise rejecting if conflicts are present.
       */
      async validateValueIndexes(value) {
        if (this.parsingContext.validateValueIndexes) {
          const indexHashes = {};
          for (const entry of value) {
            if (entry && typeof entry === "object") {
              const id = entry["@id"];
              const index = entry["@index"];
              if (id && index) {
                const existingIndexValue = indexHashes[id];
                if (existingIndexValue && existingIndexValue !== index) {
                  throw new jsonld_context_parser_1.ErrorCoded(`Conflicting @index value for ${id}`, jsonld_context_parser_1.ERROR_CODES.CONFLICTING_INDEXES);
                }
                indexHashes[id] = index;
              }
            }
          }
        }
      }
      /**
       * Convert a given JSON value to an RDF term.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param {string} key The current JSON key.
       * @param value A JSON value.
       * @param {number} depth The depth the value is at.
       * @param {string[]} keys The path of keys.
       * @return {Promise<RDF.Term[]>} An RDF term array.
       */
      async valueToTerm(context, key, value, depth, keys) {
        if (_Util.getContextValueType(context, key) === "@json") {
          return [this.dataFactory.literal(this.valueToJsonString(value), this.rdfJson)];
        }
        const type = typeof value;
        switch (type) {
          case "object":
            if (value === null || value === void 0) {
              return [];
            }
            if (Array.isArray(value)) {
              if ("@list" in _Util.getContextValueContainer(context, key)) {
                if (value.length === 0) {
                  return [this.rdfNil];
                } else {
                  return this.parsingContext.idStack[depth + 1] || [];
                }
              }
              await this.validateValueIndexes(value);
              return [];
            }
            context = await this.getContextSelfOrPropertyScoped(context, key);
            if ("@context" in value) {
              context = await this.parsingContext.parseContext(value["@context"], (await this.parsingContext.getContext(keys, 0)).getContextRaw());
            }
            value = await this.unaliasKeywords(value, keys, depth, context);
            if ("@value" in value) {
              let val;
              let valueLanguage;
              let valueDirection;
              let valueType;
              let valueIndex;
              for (key in value) {
                const subValue = value[key];
                switch (key) {
                  case "@value":
                    val = subValue;
                    break;
                  case "@language":
                    valueLanguage = subValue;
                    break;
                  case "@direction":
                    valueDirection = subValue;
                    break;
                  case "@type":
                    valueType = subValue;
                    break;
                  case "@index":
                    valueIndex = subValue;
                    break;
                  case "@annotation":
                    break;
                  default:
                    if (key.startsWith("@")) {
                      throw new jsonld_context_parser_1.ErrorCoded(`Unknown value entry '${key}' in @value: ${JSON.stringify(value)}`, jsonld_context_parser_1.ERROR_CODES.INVALID_VALUE_OBJECT);
                    }
                }
              }
              if (await this.unaliasKeyword(valueType, keys, depth, true, context) === "@json") {
                return [this.dataFactory.literal(this.valueToJsonString(val), this.rdfJson)];
              }
              if (val === null) {
                return [];
              }
              if (typeof val === "object") {
                throw new jsonld_context_parser_1.ErrorCoded(`The value of an '@value' can not be an object, got '${JSON.stringify(val)}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_VALUE_OBJECT_VALUE);
              }
              if (this.parsingContext.validateValueIndexes && valueIndex && typeof valueIndex !== "string") {
                throw new jsonld_context_parser_1.ErrorCoded(`The value of an '@index' must be a string, got '${JSON.stringify(valueIndex)}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_INDEX_VALUE);
              }
              if (valueLanguage) {
                if (typeof val !== "string") {
                  throw new jsonld_context_parser_1.ErrorCoded(`When an '@language' is set, the value of '@value' must be a string, got '${JSON.stringify(val)}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_LANGUAGE_TAGGED_VALUE);
                }
                if (!jsonld_context_parser_1.ContextParser.validateLanguage(valueLanguage, this.parsingContext.strictValues, jsonld_context_parser_1.ERROR_CODES.INVALID_LANGUAGE_TAGGED_STRING)) {
                  return [];
                }
                if (this.parsingContext.normalizeLanguageTags || this.parsingContext.activeProcessingMode === 1) {
                  valueLanguage = valueLanguage.toLowerCase();
                }
              }
              if (valueDirection) {
                if (typeof val !== "string") {
                  throw new Error(`When an '@direction' is set, the value of '@value' must be a string, got '${JSON.stringify(val)}'`);
                }
                if (!jsonld_context_parser_1.ContextParser.validateDirection(valueDirection, this.parsingContext.strictValues)) {
                  return [];
                }
              }
              if (valueLanguage && valueDirection) {
                if (valueType) {
                  throw new jsonld_context_parser_1.ErrorCoded(`Can not have '@language', '@direction' and '@type' in a value: '${JSON.stringify(value)}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_VALUE_OBJECT);
                }
                return this.nullableTermToArray(this.createLanguageDirectionLiteral(depth, val, valueLanguage, valueDirection));
              } else if (valueLanguage) {
                if (valueType) {
                  throw new jsonld_context_parser_1.ErrorCoded(`Can not have both '@language' and '@type' in a value: '${JSON.stringify(value)}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_VALUE_OBJECT);
                }
                return [this.dataFactory.literal(val, valueLanguage)];
              } else if (valueDirection) {
                if (valueType) {
                  throw new jsonld_context_parser_1.ErrorCoded(`Can not have both '@direction' and '@type' in a value: '${JSON.stringify(value)}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_VALUE_OBJECT);
                }
                return this.nullableTermToArray(this.createLanguageDirectionLiteral(depth, val, valueLanguage, valueDirection));
              } else if (valueType) {
                if (typeof valueType !== "string") {
                  throw new jsonld_context_parser_1.ErrorCoded(`The value of an '@type' must be a string, got '${JSON.stringify(valueType)}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_TYPED_VALUE);
                }
                const typeTerm = this.createVocabOrBaseTerm(context, valueType);
                if (!typeTerm) {
                  throw new jsonld_context_parser_1.ErrorCoded(`Invalid '@type' value, got '${JSON.stringify(valueType)}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_TYPED_VALUE);
                }
                if (typeTerm.termType !== "NamedNode") {
                  throw new jsonld_context_parser_1.ErrorCoded(`Illegal value type (${typeTerm.termType}): ${valueType}`, jsonld_context_parser_1.ERROR_CODES.INVALID_TYPED_VALUE);
                }
                return [this.dataFactory.literal(val, typeTerm)];
              }
              return await this.valueToTerm(new jsonld_context_parser_1.JsonLdContextNormalized({}), key, val, depth, keys);
            } else if ("@set" in value) {
              if (Object.keys(value).length > 1) {
                throw new jsonld_context_parser_1.ErrorCoded(`Found illegal neighbouring entries next to @set for key: '${key}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_SET_OR_LIST_OBJECT);
              }
              return [];
            } else if ("@list" in value) {
              if (Object.keys(value).length > 1) {
                throw new jsonld_context_parser_1.ErrorCoded(`Found illegal neighbouring entries next to @list for key: '${key}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_SET_OR_LIST_OBJECT);
              }
              const listValue = value["@list"];
              if (Array.isArray(listValue)) {
                if (listValue.length === 0) {
                  return [this.rdfNil];
                } else {
                  return this.parsingContext.idStack[depth + 1] || [];
                }
              } else {
                return await this.valueToTerm(await this.parsingContext.getContext(keys), key, listValue, depth - 1, keys.slice(0, -1));
              }
            } else if ("@reverse" in value && typeof value["@reverse"] === "boolean") {
              return [];
            } else if ("@graph" in _Util.getContextValueContainer(await this.parsingContext.getContext(keys), key)) {
              const graphContainerEntries = this.parsingContext.graphContainerTermStack[depth + 1];
              return graphContainerEntries ? Object.values(graphContainerEntries) : [this.dataFactory.blankNode()];
            } else if ("@id" in value) {
              if (Object.keys(value).length > 1) {
                context = await this.parsingContext.getContext(keys, 0);
              }
              if ("@context" in value) {
                context = await this.parsingContext.parseContext(value["@context"], context.getContextRaw());
              }
              if (value["@type"] === "@vocab") {
                return this.nullableTermToArray(this.createVocabOrBaseTerm(context, value["@id"]));
              } else {
                const valueId = value["@id"];
                let valueTerm;
                if (typeof valueId === "object") {
                  if (this.parsingContext.rdfstar) {
                    valueTerm = this.parsingContext.idStack[depth + 1][0];
                  } else {
                    throw new jsonld_context_parser_1.ErrorCoded(`Found illegal @id '${value}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_ID_VALUE);
                  }
                } else {
                  valueTerm = this.resourceToTerm(context, valueId);
                }
                return this.nullableTermToArray(valueTerm);
              }
            } else {
              if (this.parsingContext.emittedStack[depth + 1] || value && typeof value === "object" && Object.keys(value).length === 0) {
                return this.parsingContext.idStack[depth + 1] || (this.parsingContext.idStack[depth + 1] = [this.dataFactory.blankNode()]);
              } else {
                return [];
              }
            }
          case "string":
            return this.nullableTermToArray(this.stringValueToTerm(depth, await this.getContextSelfOrPropertyScoped(context, key), key, value, null));
          case "boolean":
            return this.nullableTermToArray(this.stringValueToTerm(depth, await this.getContextSelfOrPropertyScoped(context, key), key, Boolean(value).toString(), this.dataFactory.namedNode(_Util.XSD_BOOLEAN)));
          case "number":
            return this.nullableTermToArray(this.stringValueToTerm(depth, await this.getContextSelfOrPropertyScoped(context, key), key, value, this.dataFactory.namedNode(value % 1 === 0 && value < 1e21 ? _Util.XSD_INTEGER : _Util.XSD_DOUBLE)));
          default:
            this.parsingContext.emitError(new Error(`Could not determine the RDF type of a ${type}`));
            return [];
        }
      }
      /**
       * If the context defines a property-scoped context for the given key,
       * that context will be returned.
       * Otherwise, the given context will be returned as-is.
       *
       * This should be used for valueToTerm cases that are not objects.
       * @param context A context.
       * @param key A JSON key.
       */
      async getContextSelfOrPropertyScoped(context, key) {
        const contextKeyEntry = context.getContextRaw()[key];
        if (contextKeyEntry && typeof contextKeyEntry === "object" && "@context" in contextKeyEntry) {
          context = await this.parsingContext.parseContext(contextKeyEntry, context.getContextRaw(), true, true);
        }
        return context;
      }
      /**
       * If the given term is null, return an empty array, otherwise return an array with the single given term.
       * @param term A term.
       */
      nullableTermToArray(term) {
        return term ? [term] : [];
      }
      /**
       * Convert a given JSON key to an RDF predicate term,
       * based on @vocab.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param key A JSON key.
       * @return {RDF.NamedNode} An RDF named node.
       */
      predicateToTerm(context, key) {
        const expanded = context.expandTerm(key, true, this.parsingContext.getExpandOptions());
        if (!expanded) {
          return null;
        }
        if (expanded[0] === "_" && expanded[1] === ":") {
          if (this.parsingContext.produceGeneralizedRdf) {
            return this.dataFactory.blankNode(expanded.substr(2));
          } else {
            return null;
          }
        }
        if (_Util.isValidIri(expanded)) {
          return this.dataFactory.namedNode(expanded);
        } else {
          if (expanded && this.parsingContext.strictValues) {
            this.parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Invalid predicate IRI: ${expanded}`, jsonld_context_parser_1.ERROR_CODES.INVALID_IRI_MAPPING));
          } else {
            return null;
          }
        }
        return null;
      }
      /**
       * Convert a given JSON key to an RDF resource term or blank node,
       * based on @base.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param key A JSON key.
       * @return {RDF.NamedNode} An RDF named node or null.
       */
      resourceToTerm(context, key) {
        if (key.startsWith("_:")) {
          return this.dataFactory.blankNode(key.substr(2));
        }
        const iri = context.expandTerm(key, false, this.parsingContext.getExpandOptions());
        if (!_Util.isValidIri(iri)) {
          if (iri && this.parsingContext.strictValues) {
            this.parsingContext.emitError(new Error(`Invalid resource IRI: ${iri}`));
          } else {
            return null;
          }
        }
        return this.dataFactory.namedNode(iri);
      }
      /**
       * Convert a given JSON key to an RDF resource term.
       * It will do this based on the @vocab,
       * and fallback to @base.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param key A JSON key.
       * @return {RDF.NamedNode} An RDF named node or null.
       */
      createVocabOrBaseTerm(context, key) {
        if (key.startsWith("_:")) {
          return this.dataFactory.blankNode(key.substr(2));
        }
        const expandOptions = this.parsingContext.getExpandOptions();
        let expanded = context.expandTerm(key, true, expandOptions);
        if (expanded === key) {
          expanded = context.expandTerm(key, false, expandOptions);
        }
        if (!_Util.isValidIri(expanded)) {
          if (expanded && this.parsingContext.strictValues && !expanded.startsWith("@")) {
            this.parsingContext.emitError(new Error(`Invalid term IRI: ${expanded}`));
          } else {
            return null;
          }
        }
        return this.dataFactory.namedNode(expanded);
      }
      /**
       * Ensure that the given value becomes a string.
       * @param {string | number} value A string or number.
       * @param {NamedNode} datatype The intended datatype.
       * @return {string} The returned string.
       */
      intToString(value, datatype) {
        if (typeof value === "number") {
          if (Number.isFinite(value)) {
            const isInteger = value % 1 === 0;
            if (isInteger && (!datatype || datatype.value !== _Util.XSD_DOUBLE)) {
              return Number(value).toString();
            } else {
              return value.toExponential(15).replace(/(\d)0*e\+?/, "$1E");
            }
          } else {
            return value > 0 ? "INF" : "-INF";
          }
        } else {
          return value;
        }
      }
      /**
       * Convert a given JSON string value to an RDF term.
       * @param {number} depth The current stack depth.
       * @param {JsonLdContextNormalized} context A JSON-LD context.
       * @param {string} key The current JSON key.
       * @param {string} value A JSON value.
       * @param {NamedNode} defaultDatatype The default datatype for the given value.
       * @return {RDF.Term} An RDF term or null.
       */
      stringValueToTerm(depth, context, key, value, defaultDatatype) {
        const contextType = _Util.getContextValueType(context, key);
        if (contextType) {
          if (contextType === "@id") {
            if (!defaultDatatype) {
              return this.resourceToTerm(context, this.intToString(value, defaultDatatype));
            }
          } else if (contextType === "@vocab") {
            if (!defaultDatatype) {
              return this.createVocabOrBaseTerm(context, this.intToString(value, defaultDatatype));
            }
          } else {
            defaultDatatype = this.dataFactory.namedNode(contextType);
          }
        }
        if (!defaultDatatype) {
          const contextLanguage = _Util.getContextValueLanguage(context, key);
          const contextDirection = _Util.getContextValueDirection(context, key);
          if (contextDirection && this.parsingContext.rdfDirection !== "disabled") {
            return this.createLanguageDirectionLiteral(depth, this.intToString(value, defaultDatatype), contextLanguage, contextDirection);
          } else {
            return this.dataFactory.literal(this.intToString(value, defaultDatatype), contextLanguage);
          }
        }
        return this.dataFactory.literal(this.intToString(value, defaultDatatype), defaultDatatype);
      }
      /**
       * Create a literal for the given value with the given language and direction.
       * Auxiliary quads may be emitted.
       * @param {number} depth The current stack depth.
       * @param {string} value A string value.
       * @param {string} language A language tag.
       * @param {string} direction A direction.
       * @return {Term} An RDF term.
       */
      createLanguageDirectionLiteral(depth, value, language, direction) {
        if (this.parsingContext.rdfDirection === "i18n-datatype") {
          if (!language) {
            language = "";
          }
          return this.dataFactory.literal(value, this.dataFactory.namedNode(`https://www.w3.org/ns/i18n#${language}_${direction}`));
        } else if (this.parsingContext.rdfDirection === "compound-literal") {
          const valueNode = this.dataFactory.blankNode();
          const graph = this.getDefaultGraph();
          this.parsingContext.emitQuad(depth, this.dataFactory.quad(valueNode, this.dataFactory.namedNode(_Util.RDF + "value"), this.dataFactory.literal(value), graph));
          if (language) {
            this.parsingContext.emitQuad(depth, this.dataFactory.quad(valueNode, this.dataFactory.namedNode(_Util.RDF + "language"), this.dataFactory.literal(language), graph));
          }
          this.parsingContext.emitQuad(depth, this.dataFactory.quad(valueNode, this.dataFactory.namedNode(_Util.RDF + "direction"), this.dataFactory.literal(direction), graph));
          return valueNode;
        } else {
          return this.dataFactory.literal(value, { language: language || "", direction });
        }
      }
      /**
       * Stringify the given JSON object to a canonical JSON string.
       * @param value Any valid JSON value.
       * @return {string} A canonical JSON string.
       */
      valueToJsonString(value) {
        return canonicalizeJson(value);
      }
      /**
       * If the key is not a keyword, try to check if it is an alias for a keyword,
       * and if so, un-alias it.
       * @param {string} key A key, can be falsy.
       * @param {string[]} keys The path of keys.
       * @param {number} depth The depth to
       * @param {boolean} disableCache If the cache should be disabled
       * @param {JsonLdContextNormalized} context A context to unalias with,
       *                                           will fallback to retrieving the context for the given keys.
       * @return {Promise<string>} A promise resolving to the key itself, or another key.
       */
      async unaliasKeyword(key, keys, depth, disableCache, context) {
        if (Number.isInteger(key)) {
          return key;
        }
        if (!disableCache) {
          const cachedUnaliasedKeyword = this.parsingContext.unaliasedKeywordCacheStack[depth];
          if (cachedUnaliasedKeyword) {
            return cachedUnaliasedKeyword;
          }
        }
        if (!jsonld_context_parser_1.Util.isPotentialKeyword(key)) {
          context = context || await this.parsingContext.getContext(keys);
          let unliased = context.getContextRaw()[key];
          if (unliased && typeof unliased === "object") {
            unliased = unliased["@id"];
          }
          if (jsonld_context_parser_1.Util.isValidKeyword(unliased)) {
            key = unliased;
          }
        }
        return disableCache ? key : this.parsingContext.unaliasedKeywordCacheStack[depth] = key;
      }
      /**
       * Unalias the keyword of the parent.
       * This adds a safety check if no parent exist.
       * @param {any[]} keys A stack of keys.
       * @param {number} depth The current depth.
       * @return {Promise<any>} A promise resolving to the parent key, or another key.
       */
      async unaliasKeywordParent(keys, depth) {
        return await this.unaliasKeyword(depth > 0 && keys[depth - 1], keys, depth - 1);
      }
      /**
       * Un-alias all keywords in the given hash.
       * @param {{[p: string]: any}} hash A hash object.
       * @param {string[]} keys The path of keys.
       * @param {number} depth The depth.
       * @param {JsonLdContextNormalized} context A context to unalias with,
       *                                           will fallback to retrieving the context for the given keys.
       * @return {Promise<{[p: string]: any}>} A promise resolving to the new hash.
       */
      async unaliasKeywords(hash, keys, depth, context) {
        const newHash = {};
        for (const key in hash) {
          newHash[await this.unaliasKeyword(key, keys, depth + 1, true, context)] = hash[key];
        }
        return newHash;
      }
      /**
       * Check if we are processing a literal (including JSON literals) at the given depth.
       * This will also check higher levels,
       * because if a parent is a literal,
       * then the deeper levels are definitely a literal as well.
       * @param {any[]} keys The keys.
       * @param {number} depth The depth.
       * @return {boolean} If we are processing a literal.
       */
      async isLiteral(keys, depth) {
        for (let i = depth; i >= 0; i--) {
          if (await this.unaliasKeyword(keys[i], keys, i) === "@annotation") {
            return false;
          }
          if (this.parsingContext.literalStack[i] || this.parsingContext.jsonLiteralStack[i]) {
            return true;
          }
        }
        return false;
      }
      /**
       * Check how many parents should be skipped for checking the @graph for the given node.
       *
       * @param {number} depth The depth of the node.
       * @param {any[]} keys An array of keys.
       * @return {number} The graph depth offset.
       */
      async getDepthOffsetGraph(depth, keys) {
        for (let i = depth - 1; i > 0; i--) {
          if (await this.unaliasKeyword(keys[i], keys, i) === "@graph") {
            const containers = (await EntryHandlerContainer_1.EntryHandlerContainer.getContainerHandler(this.parsingContext, keys, i)).containers;
            if (EntryHandlerContainer_1.EntryHandlerContainer.isComplexGraphContainer(containers)) {
              return -1;
            }
            return depth - i - 1;
          }
        }
        return -1;
      }
      /**
       * Check if the given subject is of a valid type.
       * This should be called when applying @reverse'd properties.
       * @param {Term} subject A subject.
       */
      validateReverseSubject(subject) {
        if (subject.termType === "Literal") {
          throw new jsonld_context_parser_1.ErrorCoded(`Found illegal literal in subject position: ${subject.value}`, jsonld_context_parser_1.ERROR_CODES.INVALID_REVERSE_PROPERTY_VALUE);
        }
      }
      /**
       * Get the default graph.
       * @return {Term} An RDF term.
       */
      getDefaultGraph() {
        return this.parsingContext.defaultGraph || this.dataFactory.defaultGraph();
      }
      /**
       * Get the current graph, while taking into account a graph that can be defined via @container: @graph.
       * If not within a graph container, the default graph will be returned.
       * @param keys The current keys.
       * @param depth The current depth.
       */
      async getGraphContainerValue(keys, depth) {
        let graph = this.getDefaultGraph();
        const { containers, depth: depthContainer } = await EntryHandlerContainer_1.EntryHandlerContainer.getContainerHandler(this.parsingContext, keys, depth);
        if ("@graph" in containers) {
          const graphContainerIndex = EntryHandlerContainer_1.EntryHandlerContainer.getContainerGraphIndex(containers, depthContainer, keys);
          const entry = this.parsingContext.graphContainerTermStack[depthContainer];
          graph = entry ? entry[graphContainerIndex] : null;
          if (!graph) {
            let graphId = null;
            if ("@id" in containers) {
              const keyUnaliased = await this.getContainerKey(keys[depthContainer], keys, depthContainer);
              if (keyUnaliased !== null) {
                graphId = await this.resourceToTerm(await this.parsingContext.getContext(keys), keyUnaliased);
              }
            }
            if (!graphId) {
              graphId = this.dataFactory.blankNode();
            }
            if (!this.parsingContext.graphContainerTermStack[depthContainer]) {
              this.parsingContext.graphContainerTermStack[depthContainer] = {};
            }
            graph = this.parsingContext.graphContainerTermStack[depthContainer][graphContainerIndex] = graphId;
          }
        }
        return graph;
      }
      /**
       * Get the properties depth for retrieving properties.
       *
       * Typically, the properties depth will be identical to the given depth.
       *
       * The following exceptions apply:
       * * When the parent is @reverse, the depth is decremented by one.
       * * When @nest parents are found, the depth is decremented by the number of @nest parents.
       * If in combination with the exceptions above an intermediary array is discovered,
       * the depth is also decremented by this number of arrays.
       *
       * @param keys The current key chain.
       * @param depth The current depth.
       */
      async getPropertiesDepth(keys, depth) {
        let lastValidDepth = depth;
        for (let i = depth - 1; i > 0; i--) {
          if (typeof keys[i] !== "number") {
            const parentKey = await this.unaliasKeyword(keys[i], keys, i);
            if (parentKey === "@reverse") {
              return i;
            } else if (parentKey === "@nest") {
              lastValidDepth = i;
            } else {
              return lastValidDepth;
            }
          }
        }
        return lastValidDepth;
      }
      /**
       * Get the key for the current container entry.
       * @param key A key, can be falsy.
       * @param keys The key chain.
       * @param depth The current depth to get the key from.
       * @return Promise resolving to the key.
       *         Null will be returned for @none entries, with aliasing taken into account.
       */
      async getContainerKey(key, keys, depth) {
        const keyUnaliased = await this.unaliasKeyword(key, keys, depth);
        return keyUnaliased === "@none" ? null : keyUnaliased;
      }
      /**
       * Check if no reverse properties are present in embedded nodes.
       * @param key The current key.
       * @param reverse If a reverse property is active.
       * @param isEmbedded If we're in an embedded node.
       */
      validateReverseInEmbeddedNode(key, reverse, isEmbedded) {
        if (isEmbedded && reverse && !this.parsingContext.rdfstarReverseInEmbedded) {
          throw new jsonld_context_parser_1.ErrorCoded(`Illegal reverse property in embedded node in ${key}`, jsonld_context_parser_1.ERROR_CODES.INVALID_EMBEDDED_NODE);
        }
      }
      /**
       * Emit a quad, with checks.
       * @param depth The current depth.
       * @param subject S
       * @param predicate P
       * @param object O
       * @param graph G
       * @param reverse If a reverse property is active.
       * @param isEmbedded If we're in an embedded node.
       */
      emitQuadChecked(depth, subject, predicate, object, graph, reverse, isEmbedded) {
        let quad2;
        if (reverse) {
          this.validateReverseSubject(object);
          quad2 = this.dataFactory.quad(object, predicate, subject, graph);
        } else {
          quad2 = this.dataFactory.quad(subject, predicate, object, graph);
        }
        if (isEmbedded) {
          if (quad2.graph.termType !== "DefaultGraph") {
            quad2 = this.dataFactory.quad(quad2.subject, quad2.predicate, quad2.object);
          }
          if (this.parsingContext.idStack[depth - 1]) {
            throw new jsonld_context_parser_1.ErrorCoded(`Illegal multiple properties in an embedded node`, jsonld_context_parser_1.ERROR_CODES.INVALID_EMBEDDED_NODE);
          }
          this.parsingContext.idStack[depth - 1] = [quad2];
        } else {
          this.parsingContext.emitQuad(depth, quad2);
        }
        const annotationsBuffer = this.parsingContext.annotationsBuffer[depth];
        if (annotationsBuffer) {
          for (const annotation of annotationsBuffer) {
            this.emitAnnotation(depth, quad2, annotation);
          }
          delete this.parsingContext.annotationsBuffer[depth];
        }
      }
      // This is a separate function to enable recursion
      emitAnnotation(depth, quad2, annotation) {
        let annotationQuad;
        if (annotation.reverse) {
          this.validateReverseSubject(annotation.object);
          annotationQuad = this.dataFactory.quad(annotation.object, annotation.predicate, quad2);
        } else {
          annotationQuad = this.dataFactory.quad(quad2, annotation.predicate, annotation.object);
        }
        this.parsingContext.emitQuad(depth, annotationQuad);
        for (const nestedAnnotation of annotation.nestedAnnotations) {
          this.emitAnnotation(depth, annotationQuad, nestedAnnotation);
        }
      }
    };
    exports.Util = Util;
    Util.XSD = "http://www.w3.org/2001/XMLSchema#";
    Util.XSD_BOOLEAN = Util.XSD + "boolean";
    Util.XSD_INTEGER = Util.XSD + "integer";
    Util.XSD_DOUBLE = Util.XSD + "double";
    Util.RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/EntryHandlerArrayValue.js
var require_EntryHandlerArrayValue = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/EntryHandlerArrayValue.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerArrayValue = void 0;
    var Util_1 = require_Util2();
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var EntryHandlerArrayValue = class {
      isPropertyHandler() {
        return false;
      }
      isStackProcessor() {
        return true;
      }
      async validate(parsingContext, util, keys, depth, inProperty) {
        return this.test(parsingContext, util, null, keys, depth);
      }
      async test(parsingContext, util, key, keys, depth) {
        return typeof keys[depth] === "number";
      }
      async handle(parsingContext, util, key, keys, value, depth) {
        let parentKey = await util.unaliasKeywordParent(keys, depth);
        if (parentKey === "@list") {
          let listRootKey = null;
          let listRootDepth = 0;
          for (let i = depth - 2; i > 0; i--) {
            const keyOption = keys[i];
            if (typeof keyOption === "string" || typeof keyOption === "number") {
              listRootDepth = i;
              listRootKey = keyOption;
              break;
            }
          }
          if (listRootKey !== null) {
            const values = await util.valueToTerm(await parsingContext.getContext(keys), listRootKey, value, depth, keys);
            for (const object of values) {
              await this.handleListElement(parsingContext, util, object, value, depth, keys.slice(0, listRootDepth), listRootDepth);
            }
            if (values.length === 0) {
              await this.handleListElement(parsingContext, util, null, value, depth, keys.slice(0, listRootDepth), listRootDepth);
            }
          }
        } else if (parentKey === "@set") {
          await parsingContext.newOnValueJob(keys.slice(0, -2), value, depth - 2, false);
        } else if (parentKey !== void 0 && parentKey !== "@type") {
          for (let i = depth - 1; i > 0; i--) {
            if (typeof keys[i] !== "number") {
              parentKey = await util.unaliasKeyword(keys[i], keys, i);
              break;
            }
          }
          const parentContext = await parsingContext.getContext(keys.slice(0, -1));
          if ("@list" in Util_1.Util.getContextValueContainer(parentContext, parentKey)) {
            parsingContext.emittedStack[depth + 1] = true;
            const values = await util.valueToTerm(await parsingContext.getContext(keys), parentKey, value, depth, keys);
            for (const object of values) {
              await this.handleListElement(parsingContext, util, object, value, depth, keys.slice(0, -1), depth - 1);
            }
            if (values.length === 0) {
              await this.handleListElement(parsingContext, util, null, value, depth, keys.slice(0, -1), depth - 1);
            }
          } else {
            parsingContext.shiftStack(depth, 1);
            await parsingContext.newOnValueJob(keys.slice(0, -1), value, depth - 1, false);
            parsingContext.contextTree.removeContext(keys.slice(0, -1));
          }
        }
      }
      async handleListElement(parsingContext, util, value, valueOriginal, depth, listRootKeys, listRootDepth) {
        let listPointer = parsingContext.listPointerStack[depth];
        if (valueOriginal !== null && (await util.unaliasKeywords(valueOriginal, listRootKeys, depth))["@value"] !== null) {
          if (!listPointer || !listPointer.value) {
            const linkTerm = util.dataFactory.blankNode();
            listPointer = { value: linkTerm, listRootDepth, listId: linkTerm };
          } else {
            const newLinkTerm = util.dataFactory.blankNode();
            parsingContext.emitQuad(depth, util.dataFactory.quad(listPointer.value, util.rdfRest, newLinkTerm, util.getDefaultGraph()));
            listPointer.value = newLinkTerm;
          }
          if (value) {
            parsingContext.emitQuad(depth, util.dataFactory.quad(listPointer.value, util.rdfFirst, value, util.getDefaultGraph()));
          }
        } else {
          if (!listPointer) {
            listPointer = { listRootDepth, listId: util.rdfNil };
          }
        }
        parsingContext.listPointerStack[depth] = listPointer;
        if (parsingContext.rdfstar && parsingContext.annotationsBuffer[depth]) {
          parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found an illegal annotation inside a list`, jsonld_context_parser_1.ERROR_CODES.INVALID_ANNOTATION));
        }
      }
    };
    exports.EntryHandlerArrayValue = EntryHandlerArrayValue;
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/EntryHandlerInvalidFallback.js
var require_EntryHandlerInvalidFallback = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/EntryHandlerInvalidFallback.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerInvalidFallback = void 0;
    var EntryHandlerInvalidFallback = class {
      isPropertyHandler() {
        return false;
      }
      isStackProcessor() {
        return true;
      }
      async validate(parsingContext, util, keys, depth, inProperty) {
        return false;
      }
      async test(parsingContext, util, key, keys, depth) {
        return true;
      }
      async handle(parsingContext, util, key, keys, value, depth) {
        parsingContext.emittedStack[depth] = false;
      }
    };
    exports.EntryHandlerInvalidFallback = EntryHandlerInvalidFallback;
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeyword.js
var require_EntryHandlerKeyword = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeyword.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerKeyword = void 0;
    var EntryHandlerKeyword = class {
      constructor(keyword) {
        this.keyword = keyword;
      }
      isPropertyHandler() {
        return false;
      }
      isStackProcessor() {
        return true;
      }
      async validate(parsingContext, util, keys, depth, inProperty) {
        return false;
      }
      async test(parsingContext, util, key, keys, depth) {
        return key === this.keyword;
      }
    };
    exports.EntryHandlerKeyword = EntryHandlerKeyword;
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordContext.js
var require_EntryHandlerKeywordContext = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordContext.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerKeywordContext = void 0;
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var EntryHandlerKeyword_1 = require_EntryHandlerKeyword();
    var EntryHandlerKeywordContext = class extends EntryHandlerKeyword_1.EntryHandlerKeyword {
      constructor() {
        super("@context");
      }
      isStackProcessor() {
        return false;
      }
      async handle(parsingContext, util, key, keys, value, depth) {
        if (parsingContext.streamingProfile && (parsingContext.processingStack[depth] || parsingContext.processingType[depth] || parsingContext.idStack[depth] !== void 0)) {
          parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded("Found an out-of-order context, while streaming is enabled.(disable `streamingProfile`)", jsonld_context_parser_1.ERROR_CODES.INVALID_STREAMING_KEY_ORDER));
        }
        const parentContext = parsingContext.getContext(keys);
        const context = parsingContext.parseContext(value, (await parentContext).getContextRaw());
        parsingContext.contextTree.setContext(keys.slice(0, -1), context);
        parsingContext.emitContext(value);
        await parsingContext.validateContext(await context);
      }
    };
    exports.EntryHandlerKeywordContext = EntryHandlerKeywordContext;
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordGraph.js
var require_EntryHandlerKeywordGraph = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordGraph.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerKeywordGraph = void 0;
    var EntryHandlerKeyword_1 = require_EntryHandlerKeyword();
    var EntryHandlerKeywordGraph = class extends EntryHandlerKeyword_1.EntryHandlerKeyword {
      constructor() {
        super("@graph");
      }
      async handle(parsingContext, util, key, keys, value, depth) {
        parsingContext.graphStack[depth + 1] = true;
      }
    };
    exports.EntryHandlerKeywordGraph = EntryHandlerKeywordGraph;
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordId.js
var require_EntryHandlerKeywordId = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordId.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerKeywordId = void 0;
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var EntryHandlerKeyword_1 = require_EntryHandlerKeyword();
    var EntryHandlerKeywordId = class extends EntryHandlerKeyword_1.EntryHandlerKeyword {
      constructor() {
        super("@id");
      }
      isStackProcessor() {
        return false;
      }
      async handle(parsingContext, util, key, keys, value, depth) {
        if (typeof value !== "string") {
          if (parsingContext.rdfstar && typeof value === "object") {
            const valueKeys = Object.keys(value);
            if (valueKeys.length === 1 && valueKeys[0] === "@id") {
              parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Invalid embedded node without property with @id ${value["@id"]}`, jsonld_context_parser_1.ERROR_CODES.INVALID_EMBEDDED_NODE));
            }
          } else {
            parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found illegal @id '${value}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_ID_VALUE));
          }
          return;
        }
        const depthProperties = await util.getPropertiesDepth(keys, depth);
        if (parsingContext.idStack[depthProperties] !== void 0) {
          if (parsingContext.idStack[depthProperties][0].listHead) {
            parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found illegal neighbouring entries next to @list for key: '${keys[depth - 1]}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_SET_OR_LIST_OBJECT));
          } else {
            parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found duplicate @ids '${parsingContext.idStack[depthProperties][0].value}' and '${value}'`, jsonld_context_parser_1.ERROR_CODES.COLLIDING_KEYWORDS));
          }
        }
        if (parsingContext.rdfstar && parsingContext.annotationsBuffer[depth]) {
          for (const annotation of parsingContext.annotationsBuffer[depth]) {
            if (annotation.depth === depth) {
              parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found an illegal @id inside an annotation: ${value}`, jsonld_context_parser_1.ERROR_CODES.INVALID_ANNOTATION));
            }
          }
        }
        parsingContext.idStack[depthProperties] = util.nullableTermToArray(await util.resourceToTerm(await parsingContext.getContext(keys), value));
      }
    };
    exports.EntryHandlerKeywordId = EntryHandlerKeywordId;
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordIncluded.js
var require_EntryHandlerKeywordIncluded = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordIncluded.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerKeywordIncluded = void 0;
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var EntryHandlerKeyword_1 = require_EntryHandlerKeyword();
    var EntryHandlerKeywordIncluded = class extends EntryHandlerKeyword_1.EntryHandlerKeyword {
      constructor() {
        super("@included");
      }
      async handle(parsingContext, util, key, keys, value, depth) {
        if (typeof value !== "object") {
          parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found illegal @included '${value}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_INCLUDED_VALUE));
        }
        const valueUnliased = await util.unaliasKeywords(value, keys, depth, await parsingContext.getContext(keys));
        if ("@value" in valueUnliased) {
          parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found an illegal @included @value node '${JSON.stringify(value)}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_INCLUDED_VALUE));
        }
        if ("@list" in valueUnliased) {
          parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found an illegal @included @list node '${JSON.stringify(value)}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_INCLUDED_VALUE));
        }
        parsingContext.emittedStack[depth] = false;
      }
    };
    exports.EntryHandlerKeywordIncluded = EntryHandlerKeywordIncluded;
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordNest.js
var require_EntryHandlerKeywordNest = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordNest.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerKeywordNest = void 0;
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var EntryHandlerKeyword_1 = require_EntryHandlerKeyword();
    var EntryHandlerKeywordNest = class extends EntryHandlerKeyword_1.EntryHandlerKeyword {
      constructor() {
        super("@nest");
      }
      async handle(parsingContext, util, key, keys, value, depth) {
        if (typeof value !== "object") {
          parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found invalid @nest entry for '${key}': '${value}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_NEST_VALUE));
        }
        if ("@value" in await util.unaliasKeywords(value, keys, depth, await parsingContext.getContext(keys))) {
          parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found an invalid @value node for '${key}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_NEST_VALUE));
        }
        parsingContext.emittedStack[depth] = false;
      }
    };
    exports.EntryHandlerKeywordNest = EntryHandlerKeywordNest;
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordType.js
var require_EntryHandlerKeywordType = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordType.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerKeywordType = void 0;
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var Util_1 = require_Util2();
    var EntryHandlerPredicate_1 = require_EntryHandlerPredicate();
    var EntryHandlerKeyword_1 = require_EntryHandlerKeyword();
    var EntryHandlerKeywordType = class extends EntryHandlerKeyword_1.EntryHandlerKeyword {
      constructor() {
        super("@type");
      }
      isStackProcessor() {
        return false;
      }
      async handle(parsingContext, util, key, keys, value, depth) {
        const keyOriginal = keys[depth];
        const context = await parsingContext.getContext(keys);
        const predicate = util.rdfType;
        const parentKey = await util.unaliasKeywordParent(keys, depth);
        const reverse = Util_1.Util.isPropertyReverse(context, keyOriginal, parentKey);
        const isEmbedded = Util_1.Util.isPropertyInEmbeddedNode(parentKey);
        util.validateReverseInEmbeddedNode(key, reverse, isEmbedded);
        const isAnnotation = Util_1.Util.isPropertyInAnnotationObject(parentKey);
        const elements = Array.isArray(value) ? value : [value];
        for (const element of elements) {
          if (typeof element !== "string") {
            parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found illegal @type '${element}'`, jsonld_context_parser_1.ERROR_CODES.INVALID_TYPE_VALUE));
          }
          const type = util.createVocabOrBaseTerm(context, element);
          if (type) {
            await EntryHandlerPredicate_1.EntryHandlerPredicate.handlePredicateObject(parsingContext, util, keys, depth, predicate, type, reverse, isEmbedded, isAnnotation);
          }
        }
        let scopedContext = Promise.resolve(context);
        let hasTypedScopedContext = false;
        for (const element of elements.sort()) {
          const typeContext = Util_1.Util.getContextValue(context, "@context", element, null);
          if (typeContext) {
            hasTypedScopedContext = true;
            scopedContext = scopedContext.then((c) => parsingContext.parseContext(typeContext, c.getContextRaw()));
          }
        }
        if (parsingContext.streamingProfile && (hasTypedScopedContext || !parsingContext.streamingProfileAllowOutOfOrderPlainType) && (parsingContext.processingStack[depth] || parsingContext.idStack[depth])) {
          parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded("Found an out-of-order type-scoped context, while streaming is enabled.(disable `streamingProfile`)", jsonld_context_parser_1.ERROR_CODES.INVALID_STREAMING_KEY_ORDER));
        }
        if (hasTypedScopedContext) {
          scopedContext = scopedContext.then((c) => {
            if (c.getContextRaw()["@propagate"] !== true) {
              return new jsonld_context_parser_1.JsonLdContextNormalized(Object.assign(Object.assign({}, c.getContextRaw()), { "@propagate": false, "@__propagateFallback": context.getContextRaw() }));
            }
            return c;
          });
          parsingContext.contextTree.setContext(keys.slice(0, keys.length - 1), scopedContext);
        }
        parsingContext.processingType[depth] = true;
      }
    };
    exports.EntryHandlerKeywordType = EntryHandlerKeywordType;
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordUnknownFallback.js
var require_EntryHandlerKeywordUnknownFallback = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordUnknownFallback.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerKeywordUnknownFallback = void 0;
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var EntryHandlerKeywordUnknownFallback = class _EntryHandlerKeywordUnknownFallback {
      isPropertyHandler() {
        return false;
      }
      isStackProcessor() {
        return true;
      }
      async validate(parsingContext, util, keys, depth, inProperty) {
        const key = await util.unaliasKeyword(keys[depth], keys, depth);
        if (jsonld_context_parser_1.Util.isPotentialKeyword(key)) {
          if (!inProperty) {
            if (key === "@list") {
              return false;
            }
          }
          return true;
        }
        return false;
      }
      async test(parsingContext, util, key, keys, depth) {
        return jsonld_context_parser_1.Util.isPotentialKeyword(key);
      }
      async handle(parsingContext, util, key, keys, value, depth) {
        const keywordType = _EntryHandlerKeywordUnknownFallback.VALID_KEYWORDS_TYPES[key];
        if (keywordType !== void 0) {
          if (keywordType && typeof value !== keywordType.type) {
            parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Invalid value type for '${key}' with value '${value}'`, keywordType.errorCode));
          }
        } else if (parsingContext.strictValues) {
          parsingContext.emitError(new Error(`Unknown keyword '${key}' with value '${value}'`));
        }
        parsingContext.emittedStack[depth] = false;
      }
    };
    exports.EntryHandlerKeywordUnknownFallback = EntryHandlerKeywordUnknownFallback;
    EntryHandlerKeywordUnknownFallback.VALID_KEYWORDS_TYPES = {
      "@index": { type: "string", errorCode: jsonld_context_parser_1.ERROR_CODES.INVALID_INDEX_VALUE },
      "@list": null,
      "@reverse": { type: "object", errorCode: jsonld_context_parser_1.ERROR_CODES.INVALID_REVERSE_VALUE },
      "@set": null,
      "@value": null
    };
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordValue.js
var require_EntryHandlerKeywordValue = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordValue.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerKeywordValue = void 0;
    var EntryHandlerKeyword_1 = require_EntryHandlerKeyword();
    var EntryHandlerKeywordValue = class extends EntryHandlerKeyword_1.EntryHandlerKeyword {
      constructor() {
        super("@value");
      }
      async validate(parsingContext, util, keys, depth, inProperty) {
        const key = keys[depth];
        if (key && !parsingContext.literalStack[depth] && await this.test(parsingContext, util, key, keys, depth)) {
          parsingContext.literalStack[depth] = true;
        }
        return super.validate(parsingContext, util, keys, depth, inProperty);
      }
      async test(parsingContext, util, key, keys, depth) {
        return await util.unaliasKeyword(keys[depth], keys.slice(0, keys.length - 1), depth - 1, true) === "@value";
      }
      async handle(parsingContext, util, key, keys, value, depth) {
        parsingContext.literalStack[depth] = true;
        delete parsingContext.unidentifiedValuesBuffer[depth];
        delete parsingContext.unidentifiedGraphsBuffer[depth];
        parsingContext.emittedStack[depth] = false;
      }
    };
    exports.EntryHandlerKeywordValue = EntryHandlerKeywordValue;
  }
});

// node_modules/jsonld-streaming-parser/lib/ContextTree.js
var require_ContextTree = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/ContextTree.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ContextTree = void 0;
    var ContextTree = class _ContextTree {
      constructor() {
        this.subTrees = {};
      }
      getContext(keys) {
        if (keys.length > 0) {
          const [head, ...tail] = keys;
          const subTree = this.subTrees[head];
          if (subTree) {
            const subContext = subTree.getContext(tail);
            if (subContext) {
              return subContext.then(({ context, depth }) => ({ context, depth: depth + 1 }));
            }
          }
        }
        return this.context ? this.context.then((context) => ({ context, depth: 0 })) : null;
      }
      setContext(keys, context) {
        if (keys.length === 0) {
          this.context = context;
        } else {
          const [head, ...tail] = keys;
          let subTree = this.subTrees[head];
          if (!subTree) {
            subTree = this.subTrees[head] = new _ContextTree();
          }
          subTree.setContext(tail, context);
        }
      }
      removeContext(path) {
        this.setContext(path, null);
      }
    };
    exports.ContextTree = ContextTree;
  }
});

// node_modules/jsonld-streaming-parser/lib/ParsingContext.js
var require_ParsingContext = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/ParsingContext.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ParsingContext = void 0;
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var ErrorCoded_1 = require_ErrorCoded();
    var ContextTree_1 = require_ContextTree();
    var JsonLdParser_1 = require_JsonLdParser();
    var ParsingContext = class _ParsingContext {
      constructor(options) {
        this.contextParser = new jsonld_context_parser_1.ContextParser({ documentLoader: options.documentLoader, skipValidation: options.skipContextValidation });
        this.streamingProfile = !!options.streamingProfile;
        this.baseIRI = options.baseIRI;
        this.produceGeneralizedRdf = !!options.produceGeneralizedRdf;
        this.allowSubjectList = !!options.allowSubjectList;
        this.processingMode = options.processingMode || JsonLdParser_1.JsonLdParser.DEFAULT_PROCESSING_MODE;
        this.strictValues = !!options.strictValues;
        this.validateValueIndexes = !!options.validateValueIndexes;
        this.defaultGraph = options.defaultGraph;
        this.rdfDirection = options.rdfDirection;
        this.normalizeLanguageTags = options.normalizeLanguageTags;
        this.streamingProfileAllowOutOfOrderPlainType = options.streamingProfileAllowOutOfOrderPlainType;
        this.rdfstar = options.rdfstar !== false;
        this.rdfstarReverseInEmbedded = options.rdfstarReverseInEmbedded;
        this.topLevelProperties = false;
        this.activeProcessingMode = parseFloat(this.processingMode);
        this.processingStack = [];
        this.processingType = [];
        this.emittedStack = [];
        this.idStack = [];
        this.graphStack = [];
        this.graphContainerTermStack = [];
        this.listPointerStack = [];
        this.contextTree = new ContextTree_1.ContextTree();
        this.literalStack = [];
        this.validationStack = [];
        this.unaliasedKeywordCacheStack = [];
        this.jsonLiteralStack = [];
        this.unidentifiedValuesBuffer = [];
        this.unidentifiedGraphsBuffer = [];
        this.annotationsBuffer = [];
        this.pendingContainerFlushBuffers = [];
        this.parser = options.parser;
        if (options.context) {
          this.rootContext = this.parseContext(options.context, void 0, void 0, true);
          this.rootContext.then((context) => this.validateContext(context));
        } else {
          this.rootContext = Promise.resolve(new jsonld_context_parser_1.JsonLdContextNormalized(this.baseIRI ? { "@base": this.baseIRI, "@__baseDocument": true } : {}));
        }
      }
      /**
       * Parse the given context with the configured options.
       * @param {JsonLdContext} context A context to parse.
       * @param {JsonLdContextNormalized} parentContext An optional parent context.
       * @param {boolean} ignoreProtection If @protected term checks should be ignored.
       * @param {boolean} allowDirectlyNestedContext If @context entries should be allowed. Useful for scoped context.
       * @return {Promise<JsonLdContextNormalized>} A promise resolving to the parsed context.
       */
      async parseContext(context, parentContext, ignoreProtection, allowDirectlyNestedContext) {
        return this.contextParser.parse(context, {
          baseIRI: this.baseIRI,
          ignoreProtection,
          normalizeLanguageTags: this.normalizeLanguageTags,
          parentContext,
          processingMode: this.activeProcessingMode,
          disallowDirectlyNestedContext: !allowDirectlyNestedContext
        });
      }
      /**
       * Check if the given context is valid.
       * If not, an error will be thrown.
       * @param {JsonLdContextNormalized} context A context.
       */
      validateContext(context) {
        const activeVersion = context.getContextRaw()["@version"];
        if (activeVersion) {
          if (this.activeProcessingMode && activeVersion > this.activeProcessingMode) {
            throw new ErrorCoded_1.ErrorCoded(`Unsupported JSON-LD version '${activeVersion}' under active processing mode ${this.activeProcessingMode}.`, ErrorCoded_1.ERROR_CODES.PROCESSING_MODE_CONFLICT);
          } else {
            if (this.activeProcessingMode && activeVersion < this.activeProcessingMode) {
              throw new ErrorCoded_1.ErrorCoded(`Invalid JSON-LD version ${activeVersion} under active processing mode ${this.activeProcessingMode}.`, ErrorCoded_1.ERROR_CODES.INVALID_VERSION_VALUE);
            }
            this.activeProcessingMode = activeVersion;
          }
        }
      }
      /**
       * Get the context at the given path.
       * @param {keys} keys The path of keys to get the context at.
       * @param {number} offset The path offset, defaults to 1.
       * @return {Promise<JsonLdContextNormalized>} A promise resolving to a context.
       */
      async getContext(keys, offset = 1) {
        const keysOriginal = keys;
        while (typeof keys[keys.length - 1] === "number") {
          keys = keys.slice(0, keys.length - 1);
        }
        if (offset) {
          keys = keys.slice(0, -offset);
        }
        const contextData = await this.getContextPropagationAware(keys);
        const context = contextData.context;
        let contextRaw = context.getContextRaw();
        for (let i = contextData.depth; i < keysOriginal.length - offset; i++) {
          const key = keysOriginal[i];
          const contextKeyEntry = contextRaw[key];
          if (contextKeyEntry && typeof contextKeyEntry === "object" && "@context" in contextKeyEntry) {
            const scopedContext = (await this.parseContext(contextKeyEntry, contextRaw, true, true)).getContextRaw();
            const propagate = !(key in scopedContext) || scopedContext[key]["@context"]["@propagate"];
            if (propagate !== false || i === keysOriginal.length - 1 - offset) {
              contextRaw = Object.assign({}, scopedContext);
              delete contextRaw["@propagate"];
              contextRaw[key] = Object.assign({}, contextRaw[key]);
              if ("@id" in contextKeyEntry) {
                contextRaw[key]["@id"] = contextKeyEntry["@id"];
              }
              delete contextRaw[key]["@context"];
              if (propagate !== false) {
                this.contextTree.setContext(keysOriginal.slice(0, i + offset), Promise.resolve(new jsonld_context_parser_1.JsonLdContextNormalized(contextRaw)));
              }
            }
          }
        }
        return new jsonld_context_parser_1.JsonLdContextNormalized(contextRaw);
      }
      /**
       * Get the context at the given path.
       * Non-propagating contexts will be skipped,
       * unless the context at that exact depth is retrieved.
       *
       * This ONLY takes into account context propagation logic,
       * so this should usually not be called directly,
       * call {@link #getContext} instead.
       *
       * @param keys The path of keys to get the context at.
       * @return {Promise<{ context: JsonLdContextNormalized, depth: number }>} A context and its depth.
       */
      async getContextPropagationAware(keys) {
        const originalDepth = keys.length;
        let contextData = null;
        let hasApplicablePropertyScopedContext;
        do {
          hasApplicablePropertyScopedContext = false;
          if (contextData && "@__propagateFallback" in contextData.context.getContextRaw()) {
            contextData.context = new jsonld_context_parser_1.JsonLdContextNormalized(contextData.context.getContextRaw()["@__propagateFallback"]);
          } else {
            if (contextData) {
              keys = keys.slice(0, contextData.depth - 1);
            }
            contextData = await this.contextTree.getContext(keys) || { context: await this.rootContext, depth: 0 };
          }
          const lastKey = keys[keys.length - 1];
          if (lastKey in contextData.context.getContextRaw()) {
            const lastKeyValue = contextData.context.getContextRaw()[lastKey];
            if (lastKeyValue && typeof lastKeyValue === "object" && "@context" in lastKeyValue) {
              hasApplicablePropertyScopedContext = true;
            }
          }
        } while (contextData.depth > 0 && contextData.context.getContextRaw()["@propagate"] === false && contextData.depth !== originalDepth && !hasApplicablePropertyScopedContext);
        if (contextData.depth === 0 && contextData.context.getContextRaw()["@propagate"] === false && contextData.depth !== originalDepth) {
          contextData.context = new jsonld_context_parser_1.JsonLdContextNormalized({});
        }
        return contextData;
      }
      /**
       * Start a new job for parsing the given value.
       * @param {any[]} keys The stack of keys.
       * @param value The value to parse.
       * @param {number} depth The depth to parse at.
       * @param {boolean} lastDepthCheck If the lastDepth check should be done for buffer draining.
       * @return {Promise<void>} A promise resolving when the job is done.
       */
      async newOnValueJob(keys, value, depth, lastDepthCheck) {
        await this.parser.newOnValueJob(keys, value, depth, lastDepthCheck);
      }
      /**
       * Flush the pending container flush buffers
       * @return {boolean} If any pending buffers were flushed.
       */
      async handlePendingContainerFlushBuffers() {
        if (this.pendingContainerFlushBuffers.length > 0) {
          for (const pendingFlushBuffer of this.pendingContainerFlushBuffers) {
            await this.parser.flushBuffer(pendingFlushBuffer.depth, pendingFlushBuffer.keys);
            this.parser.flushStacks(pendingFlushBuffer.depth);
          }
          this.pendingContainerFlushBuffers.splice(0, this.pendingContainerFlushBuffers.length);
          return true;
        } else {
          return false;
        }
      }
      /**
       * Emit the given quad into the output stream.
       * @param {number} depth The depth the quad was generated at.
       * @param {Quad} quad A quad to emit.
       */
      emitQuad(depth, quad2) {
        if (depth === 1) {
          this.topLevelProperties = true;
        }
        this.parser.push(quad2);
      }
      /**
       * Emit the given error into the output stream.
       * @param {Error} error An error to emit.
       */
      emitError(error) {
        this.parser.emit("error", error);
      }
      /**
       * Emit the given context into the output stream under the 'context' event.
       * @param {JsonLdContext} context A context to emit.
       */
      emitContext(context) {
        this.parser.emit("context", context);
      }
      /**
       * Safely get or create the depth value of {@link ParsingContext.unidentifiedValuesBuffer}.
       * @param {number} depth A depth.
       * @return {{predicate: Term; object: Term; reverse: boolean}[]} An element of
       *                                                               {@link ParsingContext.unidentifiedValuesBuffer}.
       */
      getUnidentifiedValueBufferSafe(depth) {
        let buffer = this.unidentifiedValuesBuffer[depth];
        if (!buffer) {
          buffer = [];
          this.unidentifiedValuesBuffer[depth] = buffer;
        }
        return buffer;
      }
      /**
       * Safely get or create the depth value of {@link ParsingContext.unidentifiedGraphsBuffer}.
       * @param {number} depth A depth.
       * @return {{predicate: Term; object: Term; reverse: boolean}[]} An element of
       *                                                               {@link ParsingContext.unidentifiedGraphsBuffer}.
       */
      getUnidentifiedGraphBufferSafe(depth) {
        let buffer = this.unidentifiedGraphsBuffer[depth];
        if (!buffer) {
          buffer = [];
          this.unidentifiedGraphsBuffer[depth] = buffer;
        }
        return buffer;
      }
      /**
       * Safely get or create the depth value of {@link ParsingContext.annotationsBuffer}.
       * @param {number} depth A depth.
       * @return {} An element of {@link ParsingContext.annotationsBuffer}.
       */
      getAnnotationsBufferSafe(depth) {
        let buffer = this.annotationsBuffer[depth];
        if (!buffer) {
          buffer = [];
          this.annotationsBuffer[depth] = buffer;
        }
        return buffer;
      }
      /**
       * @return IExpandOptions The expand options for the active processing mode.
       */
      getExpandOptions() {
        return _ParsingContext.EXPAND_OPTIONS[this.activeProcessingMode];
      }
      /**
       * Shift the stack at the given offset to the given depth.
       *
       * This will override anything in the stack at `depth`,
       * and this will remove anything at `depth + depthOffset`
       *
       * @param depth The target depth.
       * @param depthOffset The origin depth, relative to `depth`.
       */
      shiftStack(depth, depthOffset) {
        const deeperIdStack = this.idStack[depth + depthOffset];
        if (deeperIdStack) {
          this.idStack[depth] = deeperIdStack;
          this.emittedStack[depth] = true;
          delete this.idStack[depth + depthOffset];
        }
        if (this.pendingContainerFlushBuffers.length) {
          for (const buffer of this.pendingContainerFlushBuffers) {
            if (buffer.depth >= depth + depthOffset) {
              buffer.depth -= depthOffset;
              buffer.keys.splice(depth, depthOffset);
            }
          }
        }
        if (this.unidentifiedValuesBuffer[depth + depthOffset]) {
          this.unidentifiedValuesBuffer[depth] = this.unidentifiedValuesBuffer[depth + depthOffset];
          delete this.unidentifiedValuesBuffer[depth + depthOffset];
        }
        if (this.annotationsBuffer[depth + depthOffset - 1]) {
          if (!this.annotationsBuffer[depth - 1]) {
            this.annotationsBuffer[depth - 1] = [];
          }
          this.annotationsBuffer[depth - 1] = [
            ...this.annotationsBuffer[depth - 1],
            ...this.annotationsBuffer[depth + depthOffset - 1]
          ];
          delete this.annotationsBuffer[depth + depthOffset - 1];
        }
      }
    };
    exports.ParsingContext = ParsingContext;
    ParsingContext.EXPAND_OPTIONS = {
      1: {
        allowPrefixForcing: false,
        allowPrefixNonGenDelims: false,
        allowVocabRelativeToBase: false
      },
      1.1: {
        allowPrefixForcing: true,
        allowPrefixNonGenDelims: false,
        allowVocabRelativeToBase: true
      }
    };
  }
});

// node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordAnnotation.js
var require_EntryHandlerKeywordAnnotation = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/entryhandler/keyword/EntryHandlerKeywordAnnotation.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EntryHandlerKeywordAnnotation = void 0;
    var EntryHandlerKeyword_1 = require_EntryHandlerKeyword();
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var EntryHandlerKeywordAnnotation = class extends EntryHandlerKeyword_1.EntryHandlerKeyword {
      constructor() {
        super("@annotation");
      }
      async handle(parsingContext, util, key, keys, value, depth) {
        if (typeof value === "string" || typeof value === "object" && value["@value"]) {
          parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Found illegal annotation value: ${JSON.stringify(value)}`, jsonld_context_parser_1.ERROR_CODES.INVALID_ANNOTATION));
        }
      }
    };
    exports.EntryHandlerKeywordAnnotation = EntryHandlerKeywordAnnotation;
  }
});

// node_modules/jsonld-streaming-parser/lib/JsonLdParser.js
var require_JsonLdParser = __commonJS({
  "node_modules/jsonld-streaming-parser/lib/JsonLdParser.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.JsonLdParser = void 0;
    var Parser = require_jsonparse();
    var jsonld_context_parser_1 = require_jsonld_context_parser();
    var readable_stream_1 = require_browser3();
    var EntryHandlerArrayValue_1 = require_EntryHandlerArrayValue();
    var EntryHandlerContainer_1 = require_EntryHandlerContainer();
    var EntryHandlerInvalidFallback_1 = require_EntryHandlerInvalidFallback();
    var EntryHandlerPredicate_1 = require_EntryHandlerPredicate();
    var EntryHandlerKeywordContext_1 = require_EntryHandlerKeywordContext();
    var EntryHandlerKeywordGraph_1 = require_EntryHandlerKeywordGraph();
    var EntryHandlerKeywordId_1 = require_EntryHandlerKeywordId();
    var EntryHandlerKeywordIncluded_1 = require_EntryHandlerKeywordIncluded();
    var EntryHandlerKeywordNest_1 = require_EntryHandlerKeywordNest();
    var EntryHandlerKeywordType_1 = require_EntryHandlerKeywordType();
    var EntryHandlerKeywordUnknownFallback_1 = require_EntryHandlerKeywordUnknownFallback();
    var EntryHandlerKeywordValue_1 = require_EntryHandlerKeywordValue();
    var ParsingContext_1 = require_ParsingContext();
    var Util_1 = require_Util2();
    var http_link_header_1 = require_link();
    var EntryHandlerKeywordAnnotation_1 = require_EntryHandlerKeywordAnnotation();
    var JsonLdParser2 = class _JsonLdParser extends readable_stream_1.Transform {
      constructor(options) {
        super({ readableObjectMode: true });
        options = options || {};
        this.options = options;
        this.parsingContext = new ParsingContext_1.ParsingContext(Object.assign({ parser: this }, options));
        this.util = new Util_1.Util({ dataFactory: options.dataFactory, parsingContext: this.parsingContext });
        this.jsonParser = new Parser();
        this.contextJobs = [];
        this.typeJobs = [];
        this.contextAwaitingJobs = [];
        this.lastDepth = 0;
        this.lastKeys = [];
        this.lastOnValueJob = Promise.resolve();
        this.attachJsonParserListeners();
        this.on("end", () => {
          if (typeof this.jsonParser.mode !== "undefined") {
            this.emit("error", new Error("Unclosed document"));
          }
        });
      }
      /**
       * Construct a JsonLdParser from the given HTTP response.
       *
       * This will throw an error if no valid JSON response is received
       * (application/ld+json, application/json, or something+json).
       *
       * For raw JSON responses, exactly one link header pointing to a JSON-LD context is required.
       *
       * This method is not responsible for handling redirects.
       *
       * @param baseIRI The URI of the received response.
       * @param mediaType The received content type.
       * @param headers Optional HTTP headers.
       * @param options Optional parser options.
       */
      static fromHttpResponse(baseIRI, mediaType, headers, options) {
        let context;
        let wellKnownMediaTypes = ["application/activity+json"];
        if (options && options.wellKnownMediaTypes) {
          wellKnownMediaTypes = options.wellKnownMediaTypes;
        }
        if (mediaType !== "application/ld+json" && !wellKnownMediaTypes.includes(mediaType)) {
          if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
            throw new jsonld_context_parser_1.ErrorCoded(`Unsupported JSON-LD media type ${mediaType}`, jsonld_context_parser_1.ERROR_CODES.LOADING_DOCUMENT_FAILED);
          }
          if (headers && headers.has("Link")) {
            headers.forEach((value, key) => {
              if (key === "link") {
                const linkHeader = (0, http_link_header_1.parse)(value);
                for (const link of linkHeader.get("rel", "http://www.w3.org/ns/json-ld#context")) {
                  if (context) {
                    throw new jsonld_context_parser_1.ErrorCoded("Multiple JSON-LD context link headers were found on " + baseIRI, jsonld_context_parser_1.ERROR_CODES.MULTIPLE_CONTEXT_LINK_HEADERS);
                  }
                  context = link.uri;
                }
              }
            });
          }
          if (!context && !(options === null || options === void 0 ? void 0 : options.ignoreMissingContextLinkHeader)) {
            throw new jsonld_context_parser_1.ErrorCoded(`Missing context link header for media type ${mediaType} on ${baseIRI}`, jsonld_context_parser_1.ERROR_CODES.LOADING_DOCUMENT_FAILED);
          }
        }
        let streamingProfile;
        if (headers && headers.has("Content-Type")) {
          const contentType2 = headers.get("Content-Type");
          const match = /; *profile=([^"]*)/.exec(contentType2);
          if (match && match[1] === "http://www.w3.org/ns/json-ld#streaming") {
            streamingProfile = true;
          }
        }
        return new _JsonLdParser(Object.assign({
          baseIRI,
          context,
          streamingProfile
        }, options ? options : {}));
      }
      /**
       * Parses the given text stream into a quad stream.
       * @param {NodeJS.EventEmitter} stream A text stream.
       * @return {RDF.Stream} A quad stream.
       */
      import(stream) {
        if ("pipe" in stream) {
          stream.on("error", (error) => parsed.emit("error", error));
          const parsed = stream.pipe(new _JsonLdParser(this.options));
          return parsed;
        } else {
          const output = new readable_stream_1.PassThrough({ readableObjectMode: true });
          stream.on("error", (error) => parsed.emit("error", error));
          stream.on("data", (data) => output.push(data));
          stream.on("end", () => output.push(null));
          const parsed = output.pipe(new _JsonLdParser(this.options));
          return parsed;
        }
      }
      _transform(chunk, encoding, callback) {
        this.jsonParser.write(chunk);
        this.lastOnValueJob.then(() => callback(), (error) => callback(error));
      }
      /**
       * Start a new job for parsing the given value.
       *
       * This will let the first valid {@link IEntryHandler} handle the entry.
       *
       * @param {any[]} keys The stack of keys.
       * @param value The value to parse.
       * @param {number} depth The depth to parse at.
       * @param {boolean} lastDepthCheck If the lastDepth check should be done for buffer draining.
       * @return {Promise<void>} A promise resolving when the job is done.
       */
      async newOnValueJob(keys, value, depth, lastDepthCheck) {
        let flushStacks = true;
        if (lastDepthCheck && depth < this.lastDepth) {
          const listPointer = this.parsingContext.listPointerStack[this.lastDepth];
          if (listPointer) {
            if (listPointer.value) {
              this.push(this.util.dataFactory.quad(listPointer.value, this.util.rdfRest, this.util.rdfNil, this.util.getDefaultGraph()));
            }
            listPointer.listId.listHead = true;
            this.parsingContext.idStack[listPointer.listRootDepth + 1] = [listPointer.listId];
            this.parsingContext.listPointerStack.splice(this.lastDepth, 1);
          }
          if (await EntryHandlerContainer_1.EntryHandlerContainer.isBufferableContainerHandler(this.parsingContext, this.lastKeys, this.lastDepth)) {
            this.parsingContext.pendingContainerFlushBuffers.push({ depth: this.lastDepth, keys: this.lastKeys.slice(0, this.lastKeys.length) });
            flushStacks = false;
          } else {
            await this.flushBuffer(this.lastDepth, this.lastKeys);
          }
        }
        const key = await this.util.unaliasKeyword(keys[depth], keys, depth);
        const parentKey = await this.util.unaliasKeywordParent(keys, depth);
        this.parsingContext.emittedStack[depth] = true;
        let handleKey = true;
        if (jsonld_context_parser_1.Util.isValidKeyword(key) && parentKey === "@reverse" && key !== "@context") {
          this.emit("error", new jsonld_context_parser_1.ErrorCoded(`Found the @id '${value}' inside an @reverse property`, jsonld_context_parser_1.ERROR_CODES.INVALID_REVERSE_PROPERTY_MAP));
        }
        let inProperty = false;
        if (this.parsingContext.validationStack.length > 1) {
          inProperty = this.parsingContext.validationStack[this.parsingContext.validationStack.length - 1].property;
        }
        for (let i = Math.max(1, this.parsingContext.validationStack.length - 1); i < keys.length - 1; i++) {
          const validationResult = this.parsingContext.validationStack[i] || (this.parsingContext.validationStack[i] = await this.validateKey(keys.slice(0, i + 1), i, inProperty));
          if (!validationResult.valid) {
            this.parsingContext.emittedStack[depth] = false;
            handleKey = false;
            break;
          } else if (!inProperty && validationResult.property) {
            inProperty = true;
          }
        }
        if (await this.util.isLiteral(keys, depth)) {
          handleKey = false;
        }
        if (handleKey) {
          for (const entryHandler of _JsonLdParser.ENTRY_HANDLERS) {
            const testResult = await entryHandler.test(this.parsingContext, this.util, key, keys, depth);
            if (testResult) {
              await entryHandler.handle(this.parsingContext, this.util, key, keys, value, depth, testResult);
              if (entryHandler.isStackProcessor()) {
                this.parsingContext.processingStack[depth] = true;
              }
              break;
            }
          }
        }
        if (depth === 0 && Array.isArray(value)) {
          await this.util.validateValueIndexes(value);
        }
        if (flushStacks && depth < this.lastDepth) {
          this.flushStacks(this.lastDepth);
        }
        this.lastDepth = depth;
        this.lastKeys = keys;
        this.parsingContext.unaliasedKeywordCacheStack.splice(depth - 1);
      }
      /**
       * Flush the processing stacks at the given depth.
       * @param {number} depth A depth.
       */
      flushStacks(depth) {
        this.parsingContext.processingStack.splice(depth, 1);
        this.parsingContext.processingType.splice(depth, 1);
        this.parsingContext.emittedStack.splice(depth, 1);
        this.parsingContext.idStack.splice(depth, 1);
        this.parsingContext.graphStack.splice(depth + 1, 1);
        this.parsingContext.graphContainerTermStack.splice(depth, 1);
        this.parsingContext.jsonLiteralStack.splice(depth, 1);
        this.parsingContext.validationStack.splice(depth - 1, 2);
        this.parsingContext.literalStack.splice(depth, this.parsingContext.literalStack.length - depth);
        this.parsingContext.annotationsBuffer.splice(depth, 1);
      }
      /**
       * Flush buffers for the given depth.
       *
       * This should be called after the last entry at a given depth was processed.
       *
       * @param {number} depth A depth.
       * @param {any[]} keys A stack of keys.
       * @return {Promise<void>} A promise resolving if flushing is done.
       */
      async flushBuffer(depth, keys) {
        let subjects = this.parsingContext.idStack[depth];
        const subjectsWasDefined = !!subjects;
        if (!subjectsWasDefined) {
          subjects = this.parsingContext.idStack[depth] = [this.util.dataFactory.blankNode()];
        }
        const valueBuffer = this.parsingContext.unidentifiedValuesBuffer[depth];
        if (valueBuffer) {
          for (const subject of subjects) {
            const depthOffsetGraph = await this.util.getDepthOffsetGraph(depth, keys);
            const graphs = this.parsingContext.graphStack[depth] || depthOffsetGraph >= 0 ? this.parsingContext.idStack[depth - depthOffsetGraph - 1] : [await this.util.getGraphContainerValue(keys, depth)];
            if (graphs) {
              for (const graph of graphs) {
                this.parsingContext.emittedStack[depth] = true;
                for (const bufferedValue of valueBuffer) {
                  this.util.emitQuadChecked(depth, subject, bufferedValue.predicate, bufferedValue.object, graph, bufferedValue.reverse, bufferedValue.isEmbedded);
                }
              }
            } else {
              const subGraphBuffer = this.parsingContext.getUnidentifiedGraphBufferSafe(depth - await this.util.getDepthOffsetGraph(depth, keys) - 1);
              for (const bufferedValue of valueBuffer) {
                if (bufferedValue.reverse) {
                  subGraphBuffer.push({
                    object: subject,
                    predicate: bufferedValue.predicate,
                    subject: bufferedValue.object,
                    isEmbedded: bufferedValue.isEmbedded
                  });
                } else {
                  subGraphBuffer.push({
                    object: bufferedValue.object,
                    predicate: bufferedValue.predicate,
                    subject,
                    isEmbedded: bufferedValue.isEmbedded
                  });
                }
              }
            }
          }
          this.parsingContext.unidentifiedValuesBuffer.splice(depth, 1);
          this.parsingContext.literalStack.splice(depth, 1);
          this.parsingContext.jsonLiteralStack.splice(depth, 1);
        }
        const graphBuffer = this.parsingContext.unidentifiedGraphsBuffer[depth];
        if (graphBuffer) {
          for (const subject of subjects) {
            const graph = depth === 1 && subject.termType === "BlankNode" && !this.parsingContext.topLevelProperties ? this.util.getDefaultGraph() : subject;
            this.parsingContext.emittedStack[depth] = true;
            for (const bufferedValue of graphBuffer) {
              this.parsingContext.emitQuad(depth, this.util.dataFactory.quad(bufferedValue.subject, bufferedValue.predicate, bufferedValue.object, graph));
            }
          }
          this.parsingContext.unidentifiedGraphsBuffer.splice(depth, 1);
        }
        const annotationsBuffer = this.parsingContext.annotationsBuffer[depth];
        if (annotationsBuffer) {
          if (annotationsBuffer.length > 0 && depth === 1) {
            this.parsingContext.emitError(new jsonld_context_parser_1.ErrorCoded(`Annotations can not be made on top-level nodes`, jsonld_context_parser_1.ERROR_CODES.INVALID_ANNOTATION));
          }
          const annotationsBufferParent = this.parsingContext.getAnnotationsBufferSafe(depth - 1);
          for (const annotation of annotationsBuffer) {
            annotationsBufferParent.push(annotation);
          }
          delete this.parsingContext.annotationsBuffer[depth];
        }
      }
      /**
       * Check if at least one {@link IEntryHandler} validates the entry to true.
       * @param {any[]} keys A stack of keys.
       * @param {number} depth A depth.
       * @param {boolean} inProperty If the current depth is part of a valid property node.
       * @return {Promise<{ valid: boolean, property: boolean }>} A promise resolving to true or false.
       */
      async validateKey(keys, depth, inProperty) {
        for (const entryHandler of _JsonLdParser.ENTRY_HANDLERS) {
          if (await entryHandler.validate(this.parsingContext, this.util, keys, depth, inProperty)) {
            return { valid: true, property: inProperty || entryHandler.isPropertyHandler() };
          }
        }
        return { valid: false, property: false };
      }
      /**
       * Attach all required listeners to the JSON parser.
       *
       * This should only be called once.
       */
      attachJsonParserListeners() {
        this.jsonParser.onValue = (value) => {
          const depth = this.jsonParser.stack.length;
          const keys = new Array(depth + 1).fill(0).map((v, i) => {
            return i === depth ? this.jsonParser.key : this.jsonParser.stack[i].key;
          });
          if (!this.isParsingContextInner(depth)) {
            const valueJobCb = () => this.newOnValueJob(keys, value, depth, true);
            if (!this.parsingContext.streamingProfile && !this.parsingContext.contextTree.getContext(keys.slice(0, -1))) {
              if (keys[depth] === "@context") {
                let jobs = this.contextJobs[depth];
                if (!jobs) {
                  jobs = this.contextJobs[depth] = [];
                }
                jobs.push(valueJobCb);
              } else {
                this.contextAwaitingJobs.push({ job: valueJobCb, keys, depth });
              }
            } else {
              this.lastOnValueJob = this.lastOnValueJob.then(valueJobCb);
            }
            if (!this.parsingContext.streamingProfile && depth === 0) {
              this.lastOnValueJob = this.lastOnValueJob.then(() => this.executeBufferedJobs());
            }
          }
        };
        this.jsonParser.onError = (error) => {
          this.emit("error", error);
        };
      }
      /**
       * Check if the parser is currently parsing an element that is part of an @context entry.
       * @param {number} depth A depth.
       * @return {boolean} A boolean.
       */
      isParsingContextInner(depth) {
        for (let i = depth; i > 0; i--) {
          if (this.jsonParser.stack[i - 1].key === "@context") {
            return true;
          }
        }
        return false;
      }
      /**
       * Execute all buffered jobs.
       * @return {Promise<void>} A promise resolving if all jobs are finished.
       */
      async executeBufferedJobs() {
        for (const jobs of this.contextJobs) {
          if (jobs) {
            for (const job of jobs) {
              await job();
            }
          }
        }
        this.parsingContext.unaliasedKeywordCacheStack.splice(0);
        const contextAwaitingJobs = [];
        for (const job of this.contextAwaitingJobs) {
          if (await this.util.unaliasKeyword(job.keys[job.depth], job.keys, job.depth, true) === "@type" || typeof job.keys[job.depth] === "number" && await this.util.unaliasKeyword(job.keys[job.depth - 1], job.keys, job.depth - 1, true) === "@type") {
            this.typeJobs.push({ job: job.job, keys: job.keys.slice(0, job.keys.length - 1) });
          } else {
            contextAwaitingJobs.push(job);
          }
        }
        for (const job of contextAwaitingJobs) {
          if (this.typeJobs.length > 0) {
            const applicableTypeJobs = [];
            const applicableTypeJobIds = [];
            for (let i = 0; i < this.typeJobs.length; i++) {
              const typeJob = this.typeJobs[i];
              if (Util_1.Util.isPrefixArray(typeJob.keys, job.keys)) {
                applicableTypeJobs.push(typeJob);
                applicableTypeJobIds.push(i);
              }
            }
            const sortedTypeJobs = applicableTypeJobs.sort((job1, job2) => job1.keys.length - job2.keys.length);
            for (const typeJob of sortedTypeJobs) {
              await typeJob.job();
            }
            const sortedApplicableTypeJobIds = applicableTypeJobIds.sort().reverse();
            for (const jobId of sortedApplicableTypeJobIds) {
              this.typeJobs.splice(jobId, 1);
            }
          }
          await job.job();
        }
      }
    };
    exports.JsonLdParser = JsonLdParser2;
    JsonLdParser2.DEFAULT_PROCESSING_MODE = "1.1";
    JsonLdParser2.ENTRY_HANDLERS = [
      new EntryHandlerArrayValue_1.EntryHandlerArrayValue(),
      new EntryHandlerKeywordContext_1.EntryHandlerKeywordContext(),
      new EntryHandlerKeywordId_1.EntryHandlerKeywordId(),
      new EntryHandlerKeywordIncluded_1.EntryHandlerKeywordIncluded(),
      new EntryHandlerKeywordGraph_1.EntryHandlerKeywordGraph(),
      new EntryHandlerKeywordNest_1.EntryHandlerKeywordNest(),
      new EntryHandlerKeywordType_1.EntryHandlerKeywordType(),
      new EntryHandlerKeywordValue_1.EntryHandlerKeywordValue(),
      new EntryHandlerKeywordAnnotation_1.EntryHandlerKeywordAnnotation(),
      new EntryHandlerContainer_1.EntryHandlerContainer(),
      new EntryHandlerKeywordUnknownFallback_1.EntryHandlerKeywordUnknownFallback(),
      new EntryHandlerPredicate_1.EntryHandlerPredicate(),
      new EntryHandlerInvalidFallback_1.EntryHandlerInvalidFallback()
    ];
  }
});

// node_modules/jsonld-streaming-parser/index.js
var require_jsonld_streaming_parser = __commonJS({
  "node_modules/jsonld-streaming-parser/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_JsonLdParser(), exports);
  }
});

// node_modules/@jeswr/fetch-rdf/dist/parse.js
var import_content_type = __toESM(require_content_type(), 1);

// node_modules/@rdfjs/dataset/DatasetCore.js
function isString(s) {
  return typeof s === "string" || s instanceof String;
}
var xsdString = "http://www.w3.org/2001/XMLSchema#string";
function termToId(term) {
  if (typeof term === "string") {
    return term;
  }
  if (!term) {
    return "";
  }
  if (typeof term.id !== "undefined" && term.termType !== "Quad") {
    return term.id;
  }
  let subject, predicate, object, graph;
  switch (term.termType) {
    case "NamedNode":
      return term.value;
    case "BlankNode":
      return `_:${term.value}`;
    case "Variable":
      return `?${term.value}`;
    case "DefaultGraph":
      return "";
    case "Literal":
      if (term.language) {
        return `"${term.value}"@${term.language}`;
      }
      return `"${term.value}"${term.datatype && term.datatype.value !== xsdString ? `^^${term.datatype.value}` : ""}`;
    case "Quad":
      subject = escapeQuotes(termToId(term.subject));
      predicate = escapeQuotes(termToId(term.predicate));
      object = escapeQuotes(termToId(term.object));
      graph = term.graph.termType === "DefaultGraph" ? "" : ` ${termToId(term.graph)}`;
      return `<<${subject} ${predicate} ${object}${graph}>>`;
    default:
      throw new Error(`Unexpected termType: ${term.termType}`);
  }
}
var escapedLiteral = /^"(.*".*)(?="[^"]*$)/;
function escapeQuotes(id) {
  return id.replace(escapedLiteral, (_, quoted) => `"${quoted.replace(/"/g, '""')}`);
}
var DatasetCore = class {
  constructor(quads) {
    this._size = 0;
    this._graphs = /* @__PURE__ */ Object.create(null);
    this._id = 0;
    this._ids = /* @__PURE__ */ Object.create(null);
    this._ids["><"] = 0;
    this._entities = /* @__PURE__ */ Object.create(null);
    this._quads = /* @__PURE__ */ new Map();
    if (quads) {
      for (const quad2 of quads) {
        this.add(quad2);
      }
    }
  }
  get size() {
    let size = this._size;
    if (size !== null) {
      return size;
    }
    size = 0;
    const graphs = this._graphs;
    let subjects, subject;
    for (const graphKey in graphs) {
      for (const subjectKey in subjects = graphs[graphKey].subjects) {
        for (const predicateKey in subject = subjects[subjectKey]) {
          size += Object.keys(subject[predicateKey]).length;
        }
      }
    }
    this._size = size;
    return this._size;
  }
  add(quad2) {
    let subject = termToId(quad2.subject);
    let predicate = termToId(quad2.predicate);
    let object = termToId(quad2.object);
    const graph = termToId(quad2.graph);
    let graphItem = this._graphs[graph];
    if (!graphItem) {
      graphItem = this._graphs[graph] = { subjects: {}, predicates: {}, objects: {} };
      Object.freeze(graphItem);
    }
    const ids = this._ids;
    const entities = this._entities;
    subject = ids[subject] || (ids[entities[++this._id] = subject] = this._id);
    predicate = ids[predicate] || (ids[entities[++this._id] = predicate] = this._id);
    object = ids[object] || (ids[entities[++this._id] = object] = this._id);
    this._addToIndex(graphItem.subjects, subject, predicate, object);
    this._addToIndex(graphItem.predicates, predicate, object, subject);
    this._addToIndex(graphItem.objects, object, subject, predicate);
    this._setQuad(subject, predicate, object, graph, quad2);
    this._size = null;
    return this;
  }
  delete(quad2) {
    let subject = termToId(quad2.subject);
    let predicate = termToId(quad2.predicate);
    let object = termToId(quad2.object);
    const graph = termToId(quad2.graph);
    const ids = this._ids;
    const graphs = this._graphs;
    let graphItem, subjects, predicates;
    if (!(subject = ids[subject]) || !(predicate = ids[predicate]) || !(object = ids[object]) || !(graphItem = graphs[graph]) || !(subjects = graphItem.subjects[subject]) || !(predicates = subjects[predicate]) || !(object in predicates)) {
      return this;
    }
    this._removeFromIndex(graphItem.subjects, subject, predicate, object);
    this._removeFromIndex(graphItem.predicates, predicate, object, subject);
    this._removeFromIndex(graphItem.objects, object, subject, predicate);
    if (this._size !== null) {
      this._size--;
    }
    this._deleteQuad(subject, predicate, object, graph);
    for (subject in graphItem.subjects) {
      return this;
    }
    delete graphs[graph];
    return this;
  }
  has(quad2) {
    const subject = termToId(quad2.subject);
    const predicate = termToId(quad2.predicate);
    const object = termToId(quad2.object);
    const graph = termToId(quad2.graph);
    const graphItem = this._graphs[graph];
    if (!graphItem) {
      return false;
    }
    const ids = this._ids;
    let subjectId, predicateId, objectId;
    if (isString(subject) && !(subjectId = ids[subject]) || isString(predicate) && !(predicateId = ids[predicate]) || isString(object) && !(objectId = ids[object])) {
      return false;
    }
    return this._countInIndex(graphItem.objects, objectId, subjectId, predicateId) === 1;
  }
  match(subject, predicate, object, graph) {
    return this._createDataset(this._match(subject, predicate, object, graph));
  }
  [Symbol.iterator]() {
    return this._match()[Symbol.iterator]();
  }
  // ## Private methods
  // ### `_addToIndex` adds a quad to a three-layered index.
  // Returns if the index has changed, if the entry did not already exist.
  _addToIndex(index0, key0, key1, key2) {
    const index1 = index0[key0] || (index0[key0] = {});
    const index2 = index1[key1] || (index1[key1] = {});
    const existed = key2 in index2;
    if (!existed) {
      index2[key2] = null;
    }
    return !existed;
  }
  // ### `_removeFromIndex` removes a quad from a three-layered index
  _removeFromIndex(index0, key0, key1, key2) {
    const index1 = index0[key0];
    const index2 = index1[key1];
    delete index2[key2];
    for (const key in index2) {
      return;
    }
    delete index1[key1];
    for (const key in index1) {
      return;
    }
    delete index0[key0];
  }
  // ### `_findInIndex` finds a set of quads in a three-layered index.
  // The index base is `index0` and the keys at each level are `key0`, `key1`, and `key2`.
  // Any of these keys can be undefined, which is interpreted as a wildcard.
  // `name0`, `name1`, and `name2` are the names of the keys at each level,
  // used when reconstructing the resulting quad
  // (for instance: _subject_, _predicate_, and _object_).
  // Finally, `graph` will be the graph of the created quads.
  // If `callback` is given, each result is passed through it
  // and iteration halts when it returns truthy for any quad.
  // If instead `array` is given, each result is added to the array.
  _findInIndex(index0, key0, key1, key2, name0, name1, name2, graph, callback, array) {
    let tmp, index1, index2;
    if (key0) {
      (tmp = index0, index0 = {})[key0] = tmp[key0];
    }
    for (const value0 in index0) {
      index1 = index0[value0];
      if (index1) {
        if (key1) {
          (tmp = index1, index1 = {})[key1] = tmp[key1];
        }
        for (const value1 in index1) {
          index2 = index1[value1];
          if (index2) {
            const values = key2 ? key2 in index2 ? [key2] : [] : Object.keys(index2);
            for (let l = 0; l < values.length; l++) {
              const parts = {
                [name0]: value0,
                [name1]: value1,
                [name2]: values[l]
              };
              const quad2 = this._getQuad(parts.subject, parts.predicate, parts.object, graph);
              if (array) {
                array.push(quad2);
              } else if (callback(quad2)) {
                return true;
              }
            }
          }
        }
      }
    }
    return array;
  }
  // ### `_countInIndex` counts matching quads in a three-layered index.
  // The index base is `index0` and the keys at each level are `key0`, `key1`, and `key2`.
  // Any of these keys can be undefined, which is interpreted as a wildcard.
  _countInIndex(index0, key0, key1, key2) {
    let count = 0;
    let tmp, index1, index2;
    if (key0) {
      (tmp = index0, index0 = {})[key0] = tmp[key0];
    }
    for (const value0 in index0) {
      index1 = index0[value0];
      if (index1) {
        if (key1) {
          (tmp = index1, index1 = {})[key1] = tmp[key1];
        }
        for (const value1 in index1) {
          index2 = index1[value1];
          if (index2) {
            if (key2) {
              key2 in index2 && count++;
            } else {
              count += Object.keys(index2).length;
            }
          }
        }
      }
    }
    return count;
  }
  // ### `_getGraphs` returns an array with the given graph,
  // or all graphs if the argument is null or undefined.
  _getGraphs(graph) {
    if (!isString(graph)) {
      return this._graphs;
    }
    return {
      [graph]: this._graphs[graph]
    };
  }
  _match(subject, predicate, object, graph) {
    subject = subject && termToId(subject);
    predicate = predicate && termToId(predicate);
    object = object && termToId(object);
    graph = graph && termToId(graph);
    const quads = [];
    const graphs = this._getGraphs(graph);
    const ids = this._ids;
    let content, subjectId, predicateId, objectId;
    if (isString(subject) && !(subjectId = ids[subject]) || isString(predicate) && !(predicateId = ids[predicate]) || isString(object) && !(objectId = ids[object])) {
      return quads;
    }
    for (const graphId in graphs) {
      content = graphs[graphId];
      if (content) {
        if (subjectId) {
          if (objectId) {
            this._findInIndex(content.objects, objectId, subjectId, predicateId, "object", "subject", "predicate", graphId, null, quads);
          } else {
            this._findInIndex(content.subjects, subjectId, predicateId, null, "subject", "predicate", "object", graphId, null, quads);
          }
        } else if (predicateId) {
          this._findInIndex(content.predicates, predicateId, objectId, null, "predicate", "object", "subject", graphId, null, quads);
        } else if (objectId) {
          this._findInIndex(content.objects, objectId, null, null, "object", "subject", "predicate", graphId, null, quads);
        } else {
          this._findInIndex(content.subjects, null, null, null, "subject", "predicate", "object", graphId, null, quads);
        }
      }
    }
    return quads;
  }
  _getQuad(subjectId, predicateId, objectId, graphId) {
    return this._quads.get(this._toId(subjectId, predicateId, objectId, graphId));
  }
  _setQuad(subjectId, predicateId, objectId, graphId, quad2) {
    this._quads.set(this._toId(subjectId, predicateId, objectId, graphId), quad2);
  }
  _deleteQuad(subjectId, predicateId, objectId, graphId) {
    this._quads.delete(this._toId(subjectId, predicateId, objectId, graphId));
  }
  _createDataset(quads) {
    return new this.constructor(quads);
  }
  _toId(subjectId, predicateId, objectId, graphId) {
    return `${subjectId}:${predicateId}:${objectId}:${graphId}`;
  }
};
var DatasetCore_default = DatasetCore;

// node_modules/@rdfjs/dataset/Factory.js
var Factory = class {
  dataset(quads) {
    return new DatasetCore_default(quads);
  }
};
Factory.exports = ["dataset"];
var Factory_default = Factory;

// node_modules/@rdfjs/dataset/index.js
var factory = new Factory_default();
var dataset_default = factory;

// node_modules/@jeswr/fetch-rdf/node_modules/n3/src/N3Lexer.js
var import_buffer = __toESM(require_buffer());

// node_modules/@jeswr/fetch-rdf/node_modules/n3/src/IRIs.js
var RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var XSD = "http://www.w3.org/2001/XMLSchema#";
var SWAP = "http://www.w3.org/2000/10/swap/";
var IRIs_default = {
  xsd: {
    decimal: `${XSD}decimal`,
    boolean: `${XSD}boolean`,
    double: `${XSD}double`,
    integer: `${XSD}integer`,
    string: `${XSD}string`
  },
  rdf: {
    type: `${RDF}type`,
    nil: `${RDF}nil`,
    first: `${RDF}first`,
    rest: `${RDF}rest`,
    langString: `${RDF}langString`,
    dirLangString: `${RDF}dirLangString`,
    reifies: `${RDF}reifies`
  },
  owl: {
    sameAs: "http://www.w3.org/2002/07/owl#sameAs"
  },
  r: {
    forSome: `${SWAP}reify#forSome`,
    forAll: `${SWAP}reify#forAll`
  },
  log: {
    implies: `${SWAP}log#implies`,
    isImpliedBy: `${SWAP}log#isImpliedBy`
  }
};

// node_modules/@jeswr/fetch-rdf/node_modules/n3/src/N3Lexer.js
var { xsd } = IRIs_default;
var escapeSequence = /\\u([a-fA-F0-9]{4})|\\U([a-fA-F0-9]{8})|\\([^])/g;
var escapeReplacements = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  "n": "\n",
  "r": "\r",
  "t": "	",
  "f": "\f",
  "b": "\b",
  "_": "_",
  "~": "~",
  ".": ".",
  "-": "-",
  "!": "!",
  "$": "$",
  "&": "&",
  "(": "(",
  ")": ")",
  "*": "*",
  "+": "+",
  ",": ",",
  ";": ";",
  "=": "=",
  "/": "/",
  "?": "?",
  "#": "#",
  "@": "@",
  "%": "%"
};
var illegalIriChars = /[\x00-\x20<>\\"\{\}\|\^\`]/;
function isSurrogateCodePoint(charCode) {
  return charCode >= 55296 && charCode <= 57343;
}
var lineModeRegExps = {
  _iri: true,
  _unescapedIri: true,
  _simpleQuotedString: true,
  _langcode: true,
  _dircode: true,
  _blank: true,
  _newline: true,
  _comment: true,
  _whitespace: true,
  _endOfFile: true
};
var invalidRegExp = /$0^/;
var N3Lexer = class {
  constructor(options) {
    this._iri = /^<((?:[^ <>{}\\]|\\[uU])+)>[ \t]*/;
    this._unescapedIri = /^<([^\x00-\x20<>\\"\{\}\|\^\`]*)>[ \t]*/;
    this._simpleQuotedString = /^"([^"\\\r\n]*)"(?=[^"])/;
    this._simpleApostropheString = /^'([^'\\\r\n]*)'(?=[^'])/;
    this._langcode = /^@([a-z]+(?:-[a-z0-9]+)*)(?=[^a-z0-9])/i;
    this._dircode = /^--(ltr)|(rtl)/;
    this._prefix = /^((?:[A-Za-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:\.?[\-0-9A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)?:(?=[#\s<])/;
    this._prefixed = /^((?:[A-Za-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:\.?[\-0-9A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)?:((?:(?:[0-:A-Z_a-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff]|%[0-9a-fA-F]{2}|\\[!#-\/;=?\-@_~])(?:(?:[\.\-0-:A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff]|%[0-9a-fA-F]{2}|\\[!#-\/;=?\-@_~])*(?:[\-0-:A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff]|%[0-9a-fA-F]{2}|\\[!#-\/;=?\-@_~]))?)?)(?:[ \t]+|(?=\.?[,;!\^\s#()\[\]\{\}"'<>]))/;
    this._variable = /^\?(?:(?:[A-Z_a-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:[\-0-:A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)(?=[.,;!\^\s#()\[\]\{\}"'<>])/;
    this._blank = /^_:((?:[0-9A-Z_a-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:\.?[\-0-9A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)(?:[ \t]+|(?=\.?[,;:\s#()\[\]\{\}"'<>]))/;
    this._number = /^[\-+]?(?:(\d+\.\d*|\.?\d+)[eE][\-+]?|\d*(\.)?)\d+(?=\.?[,;:\s#()\[\]\{\}"'<>])/;
    this._boolean = /^(?:true|false)(?=[.,;\s#()\[\]\{\}"'<>])/;
    this._atKeyword = /^@[a-z]+(?=[\s#<:])/i;
    this._keyword = /^(?:PREFIX|BASE|VERSION|GRAPH)(?=[\s#<])/i;
    this._shortPredicates = /^a(?=[\s#()\[\]\{\}"'<>])/;
    this._newline = /^[ \t]*(?:#[^\n\r]*)?(?:\r\n|\n|\r)[ \t]*/;
    this._comment = /#([^\n\r]*)/;
    this._whitespace = /^[ \t]+/;
    this._endOfFile = /^(?:#[^\n\r]*)?$/;
    options = options || {};
    this._isImpliedBy = options.isImpliedBy;
    if (this._lineMode = !!options.lineMode) {
      this._n3Mode = false;
      for (const key in this) {
        if (!(key in lineModeRegExps) && this[key] instanceof RegExp)
          this[key] = invalidRegExp;
      }
    } else {
      this._n3Mode = options.n3 !== false;
    }
    this.comments = !!options.comments;
    this._literalClosingPos = 0;
  }
  // ## Private methods
  // ### `_tokenizeToEnd` tokenizes as for as possible, emitting tokens through the callback
  _tokenizeToEnd(callback, inputFinished) {
    let input = this._input;
    let currentLineLength = input.length;
    while (true) {
      let whiteSpaceMatch, comment;
      while (whiteSpaceMatch = this._newline.exec(input)) {
        if (this.comments && (comment = this._comment.exec(whiteSpaceMatch[0])))
          emitToken("comment", comment[1], "", this._line, whiteSpaceMatch[0].length);
        input = input.substr(whiteSpaceMatch[0].length, input.length);
        currentLineLength = input.length;
        this._line++;
      }
      if (!whiteSpaceMatch && (whiteSpaceMatch = this._whitespace.exec(input)))
        input = input.substr(whiteSpaceMatch[0].length, input.length);
      if (this._endOfFile.test(input)) {
        if (inputFinished) {
          if (this.comments && (comment = this._comment.exec(input)))
            emitToken("comment", comment[1], "", this._line, input.length);
          input = null;
          emitToken("eof", "", "", this._line, 0);
        }
        return this._input = input;
      }
      const line = this._line, firstChar = input[0];
      let type = "", value = "", prefix = "", match = null, matchLength = 0, inconclusive = false;
      switch (firstChar) {
        case "^":
          if (input.length < 3)
            break;
          else if (input[1] === "^") {
            this._previousMarker = "^^";
            input = input.substr(2);
            if (input[0] !== "<") {
              inconclusive = true;
              break;
            }
          } else {
            if (this._n3Mode) {
              matchLength = 1;
              type = "^";
            }
            break;
          }
        // Fall through in case the type is an IRI
        case "<":
          if (match = this._unescapedIri.exec(input))
            type = "IRI", value = match[1];
          else if (match = this._iri.exec(input)) {
            value = this._unescape(match[1]);
            if (value === null || illegalIriChars.test(value))
              return reportSyntaxError(this);
            type = "IRI";
          } else if (input.length > 2 && input[1] === "<" && input[2] === "(")
            type = "<<(", matchLength = 3;
          else if (!this._lineMode && input.length > (inputFinished ? 1 : 2) && input[1] === "<")
            type = "<<", matchLength = 2;
          else if (this._n3Mode && input.length > 1 && input[1] === "=") {
            matchLength = 2;
            if (this._isImpliedBy) type = "abbreviation", value = "<";
            else type = "inverse", value = ">";
          }
          break;
        case ">":
          if (input.length > 1 && input[1] === ">")
            type = ">>", matchLength = 2;
          break;
        case "_":
          if ((match = this._blank.exec(input)) || inputFinished && (match = this._blank.exec(`${input} `)))
            type = "blank", prefix = "_", value = match[1];
          break;
        case '"':
          if (match = this._simpleQuotedString.exec(input))
            value = match[1];
          else {
            ({ value, matchLength } = this._parseLiteral(input));
            if (value === null)
              return reportSyntaxError(this);
          }
          if (match !== null || matchLength !== 0) {
            type = "literal";
            this._literalClosingPos = 0;
          }
          break;
        case "'":
          if (!this._lineMode) {
            if (match = this._simpleApostropheString.exec(input))
              value = match[1];
            else {
              ({ value, matchLength } = this._parseLiteral(input));
              if (value === null)
                return reportSyntaxError(this);
            }
            if (match !== null || matchLength !== 0) {
              type = "literal";
              this._literalClosingPos = 0;
            }
          }
          break;
        case "?":
          if (this._n3Mode && (match = this._variable.exec(input)))
            type = "var", value = match[0];
          break;
        case "@":
          if (this._previousMarker === "literal" && (match = this._langcode.exec(input)) && match[1] !== "version")
            type = "langcode", value = match[1];
          else if (match = this._atKeyword.exec(input))
            type = match[0];
          break;
        case ".":
          if (input.length === 1 ? inputFinished : input[1] < "0" || input[1] > "9") {
            type = ".";
            matchLength = 1;
            break;
          }
        // Fall through to numerical case (could be a decimal dot)
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9":
        case "+":
        case "-":
          if (input[1] === "-") {
            if (this._previousMarker === "langcode" && (match = this._dircode.exec(input)))
              type = "dircode", matchLength = 2, value = match[1] || match[2], matchLength = value.length + 2;
            break;
          }
          if (match = this._number.exec(input) || inputFinished && (match = this._number.exec(`${input} `))) {
            type = "literal", value = match[0];
            prefix = typeof match[1] === "string" ? xsd.double : typeof match[2] === "string" ? xsd.decimal : xsd.integer;
          }
          break;
        case "B":
        case "b":
        case "p":
        case "P":
        case "G":
        case "g":
        case "V":
        case "v":
          if (match = this._keyword.exec(input))
            type = match[0].toUpperCase();
          else
            inconclusive = true;
          break;
        case "f":
        case "t":
          if (match = this._boolean.exec(input))
            type = "literal", value = match[0], prefix = xsd.boolean;
          else
            inconclusive = true;
          break;
        case "a":
          if (match = this._shortPredicates.exec(input))
            type = "abbreviation", value = "a";
          else
            inconclusive = true;
          break;
        case "=":
          if (this._n3Mode && input.length > 1) {
            type = "abbreviation";
            if (input[1] !== ">")
              matchLength = 1, value = "=";
            else
              matchLength = 2, value = ">";
          }
          break;
        case "!":
          if (!this._n3Mode)
            break;
        case ")":
          if (!inputFinished && (input.length === 1 || input.length === 2 && input[1] === ">")) {
            break;
          }
          if (input.length > 2 && input[1] === ">" && input[2] === ">") {
            type = ")>>", matchLength = 3;
            break;
          }
        case ",":
        case ";":
        case "[":
        case "]":
        case "(":
        case "}":
        case "~":
          if (!this._lineMode) {
            matchLength = 1;
            type = firstChar;
          }
          break;
        case "{":
          if (!this._lineMode && input.length >= 2) {
            if (input[1] === "|")
              type = "{|", matchLength = 2;
            else
              type = firstChar, matchLength = 1;
          }
          break;
        case "|":
          if (input.length >= 2 && input[1] === "}")
            type = "|}", matchLength = 2;
          break;
        default:
          inconclusive = true;
      }
      if (inconclusive) {
        if ((this._previousMarker === "@prefix" || this._previousMarker === "PREFIX") && (match = this._prefix.exec(input)))
          type = "prefix", value = match[1] || "";
        else if ((match = this._prefixed.exec(input)) || inputFinished && (match = this._prefixed.exec(`${input} `)))
          type = "prefixed", prefix = match[1] || "", value = this._unescape(match[2]);
      }
      if (this._previousMarker === "^^") {
        switch (type) {
          case "prefixed":
            type = "type";
            break;
          case "IRI":
            type = "typeIRI";
            break;
          default:
            type = "";
        }
      }
      if (!type) {
        if (inputFinished || !/^'''|^"""/.test(input) && /\n|\r/.test(input))
          return reportSyntaxError(this);
        else
          return this._input = input;
      }
      const length = matchLength || match[0].length;
      const token = emitToken(type, value, prefix, line, length);
      this.previousToken = token;
      this._previousMarker = type;
      input = input.substr(length, input.length);
    }
    function emitToken(type, value, prefix, line, length) {
      const start = input ? currentLineLength - input.length : currentLineLength;
      const end = start + length;
      const token = { type, value, prefix, line, start, end };
      callback(null, token);
      return token;
    }
    function reportSyntaxError(self2) {
      callback(self2._syntaxError(/^\S*/.exec(input)[0]));
    }
  }
  // ### `_unescape` replaces N3 escape codes by their corresponding characters
  _unescape(item) {
    let invalid = false;
    const replaced = item.replace(escapeSequence, (sequence, unicode4, unicode8, escapedChar) => {
      if (typeof unicode4 === "string") {
        const charCode = Number.parseInt(unicode4, 16);
        if (isSurrogateCodePoint(charCode)) {
          invalid = true;
          return "";
        }
        return String.fromCharCode(charCode);
      }
      if (typeof unicode8 === "string") {
        let charCode = Number.parseInt(unicode8, 16);
        if (isSurrogateCodePoint(charCode)) {
          invalid = true;
          return "";
        }
        return charCode <= 65535 ? String.fromCharCode(Number.parseInt(unicode8, 16)) : String.fromCharCode(55296 + ((charCode -= 65536) >> 10), 56320 + (charCode & 1023));
      }
      if (escapedChar in escapeReplacements)
        return escapeReplacements[escapedChar];
      invalid = true;
      return "";
    });
    return invalid ? null : replaced;
  }
  // ### `_parseLiteral` parses a literal into an unescaped value
  _parseLiteral(input) {
    if (input.length >= 3) {
      const opening = input.match(/^(?:"""|"|'''|'|)/)[0];
      const openingLength = opening.length;
      let closingPos = Math.max(this._literalClosingPos, openingLength);
      while ((closingPos = input.indexOf(opening, closingPos)) > 0) {
        let backslashCount = 0;
        while (input[closingPos - backslashCount - 1] === "\\")
          backslashCount++;
        if (backslashCount % 2 === 0) {
          const raw = input.substring(openingLength, closingPos);
          const lines = raw.split(/\r\n|\r|\n/).length - 1;
          const matchLength = closingPos + openingLength;
          if (openingLength === 1 && lines !== 0 || openingLength === 3 && this._lineMode)
            break;
          this._line += lines;
          return { value: this._unescape(raw), matchLength };
        }
        closingPos++;
      }
      this._literalClosingPos = input.length - openingLength + 1;
    }
    return { value: "", matchLength: 0 };
  }
  // ### `_syntaxError` creates a syntax error for the given issue
  _syntaxError(issue) {
    this._input = null;
    const err = new Error(`Unexpected "${issue}" on line ${this._line}.`);
    err.context = {
      token: void 0,
      line: this._line,
      previousToken: this.previousToken
    };
    return err;
  }
  // ### Strips off any starting UTF BOM mark.
  _readStartingBom(input) {
    return input.startsWith("\uFEFF") ? input.substr(1) : input;
  }
  // ## Public methods
  // ### `tokenize` starts the transformation of an N3 document into an array of tokens.
  // The input can be a string or a stream.
  tokenize(input, callback) {
    this._line = 1;
    if (typeof input === "string") {
      this._input = this._readStartingBom(input);
      if (typeof callback === "function")
        queueMicrotask(() => this._tokenizeToEnd(callback, true));
      else {
        const tokens = [];
        let error;
        this._tokenizeToEnd((e, t) => e ? error = e : tokens.push(t), true);
        if (error) throw error;
        return tokens;
      }
    } else {
      this._pendingBuffer = null;
      if (typeof input.setEncoding === "function")
        input.setEncoding("utf8");
      input.on("data", (data) => {
        if (this._input !== null && data.length !== 0) {
          if (this._pendingBuffer) {
            data = import_buffer.Buffer.concat([this._pendingBuffer, data]);
            this._pendingBuffer = null;
          }
          if (data[data.length - 1] & 128) {
            this._pendingBuffer = data;
          } else {
            if (typeof this._input === "undefined")
              this._input = this._readStartingBom(typeof data === "string" ? data : data.toString());
            else
              this._input += data;
            this._tokenizeToEnd(callback, false);
          }
        }
      });
      input.on("end", () => {
        if (typeof this._input === "string")
          this._tokenizeToEnd(callback, true);
      });
      input.on("error", callback);
    }
  }
};

// node_modules/@jeswr/fetch-rdf/node_modules/n3/src/N3DataFactory.js
var { rdf, xsd: xsd2 } = IRIs_default;
var DEFAULTGRAPH;
var _blankNodeCounter = 0;
var DataFactory = {
  namedNode,
  blankNode,
  variable,
  literal,
  defaultGraph,
  quad,
  triple: quad,
  fromTerm,
  fromQuad
};
var N3DataFactory_default = DataFactory;
var Term = class _Term {
  constructor(id) {
    this.id = id;
  }
  // ### The value of this term
  get value() {
    return this.id;
  }
  // ### Returns whether this object represents the same term as the other
  equals(other) {
    if (other instanceof _Term)
      return this.id === other.id;
    return !!other && this.termType === other.termType && this.value === other.value;
  }
  // ### Implement hashCode for Immutable.js, since we implement `equals`
  // https://immutable-js.com/docs/v4.0.0/ValueObject/#hashCode()
  hashCode() {
    return 0;
  }
  // ### Returns a plain object representation of this term
  toJSON() {
    return {
      termType: this.termType,
      value: this.value
    };
  }
};
var NamedNode = class extends Term {
  // ### The term type of this term
  get termType() {
    return "NamedNode";
  }
};
var Literal = class _Literal extends Term {
  // ### The term type of this term
  get termType() {
    return "Literal";
  }
  // ### The text value of this literal
  get value() {
    return this.id.substring(1, this.id.lastIndexOf('"'));
  }
  // ### The language of this literal
  get language() {
    const id = this.id;
    let atPos = id.lastIndexOf('"') + 1;
    const dirPos = id.lastIndexOf("--");
    return atPos < id.length && id[atPos++] === "@" ? (dirPos > atPos ? id.substr(0, dirPos) : id).substr(atPos).toLowerCase() : "";
  }
  // ### The direction of this literal
  get direction() {
    const id = this.id;
    const endPos = id.lastIndexOf('"');
    const dirPos = id.lastIndexOf("--");
    return dirPos > endPos && dirPos + 2 < id.length ? id.substr(dirPos + 2).toLowerCase() : "";
  }
  // ### The datatype IRI of this literal
  get datatype() {
    return new NamedNode(this.datatypeString);
  }
  // ### The datatype string of this literal
  get datatypeString() {
    const id = this.id, dtPos = id.lastIndexOf('"') + 1;
    const char = dtPos < id.length ? id[dtPos] : "";
    return char === "^" ? id.substr(dtPos + 2) : (
      // If "@" follows, return rdf:langString or rdf:dirLangString; xsd:string otherwise
      char !== "@" ? xsd2.string : id.indexOf("--", dtPos) > 0 ? rdf.dirLangString : rdf.langString
    );
  }
  // ### Returns whether this object represents the same term as the other
  equals(other) {
    if (other instanceof _Literal)
      return this.id === other.id;
    return !!other && !!other.datatype && this.termType === other.termType && this.value === other.value && this.language === other.language && (this.direction === other.direction || this.direction === "" && !other.direction) && this.datatype.value === other.datatype.value;
  }
  toJSON() {
    return {
      termType: this.termType,
      value: this.value,
      language: this.language,
      direction: this.direction,
      datatype: { termType: "NamedNode", value: this.datatypeString }
    };
  }
};
var BlankNode = class extends Term {
  constructor(name) {
    super(`_:${name}`);
  }
  // ### The term type of this term
  get termType() {
    return "BlankNode";
  }
  // ### The name of this blank node
  get value() {
    return this.id.substr(2);
  }
};
var Variable = class extends Term {
  constructor(name) {
    super(`?${name}`);
  }
  // ### The term type of this term
  get termType() {
    return "Variable";
  }
  // ### The name of this variable
  get value() {
    return this.id.substr(1);
  }
};
var DefaultGraph = class extends Term {
  constructor() {
    super("");
    return DEFAULTGRAPH || this;
  }
  // ### The term type of this term
  get termType() {
    return "DefaultGraph";
  }
  // ### Returns whether this object represents the same term as the other
  equals(other) {
    return this === other || !!other && this.termType === other.termType;
  }
};
DEFAULTGRAPH = new DefaultGraph();
var Quad = class extends Term {
  constructor(subject, predicate, object, graph) {
    super("");
    this._subject = subject;
    this._predicate = predicate;
    this._object = object;
    this._graph = graph || DEFAULTGRAPH;
  }
  // ### The term type of this term
  get termType() {
    return "Quad";
  }
  get subject() {
    return this._subject;
  }
  get predicate() {
    return this._predicate;
  }
  get object() {
    return this._object;
  }
  get graph() {
    return this._graph;
  }
  // ### Returns a plain object representation of this quad
  toJSON() {
    return {
      termType: this.termType,
      subject: this._subject.toJSON(),
      predicate: this._predicate.toJSON(),
      object: this._object.toJSON(),
      graph: this._graph.toJSON()
    };
  }
  // ### Returns whether this object represents the same quad as the other
  equals(other) {
    return !!other && this._subject.equals(other.subject) && this._predicate.equals(other.predicate) && this._object.equals(other.object) && this._graph.equals(other.graph);
  }
};
function namedNode(iri) {
  return new NamedNode(iri);
}
function blankNode(name) {
  return new BlankNode(name || `n3-${_blankNodeCounter++}`);
}
function literal(value, languageOrDataType) {
  if (typeof languageOrDataType === "string")
    return new Literal(`"${value}"@${languageOrDataType.toLowerCase()}`);
  if (languageOrDataType !== void 0 && !("termType" in languageOrDataType)) {
    return new Literal(`"${value}"@${languageOrDataType.language.toLowerCase()}${languageOrDataType.direction ? `--${languageOrDataType.direction.toLowerCase()}` : ""}`);
  }
  let datatype = languageOrDataType ? languageOrDataType.value : "";
  if (datatype === "") {
    if (typeof value === "boolean")
      datatype = xsd2.boolean;
    else if (typeof value === "number") {
      if (Number.isFinite(value))
        datatype = Number.isInteger(value) ? xsd2.integer : xsd2.double;
      else {
        datatype = xsd2.double;
        if (!Number.isNaN(value))
          value = value > 0 ? "INF" : "-INF";
      }
    }
  }
  return datatype === "" || datatype === xsd2.string ? new Literal(`"${value}"`) : new Literal(`"${value}"^^${datatype}`);
}
function variable(name) {
  return new Variable(name);
}
function defaultGraph() {
  return DEFAULTGRAPH;
}
function quad(subject, predicate, object, graph) {
  return new Quad(subject, predicate, object, graph);
}
function fromTerm(term) {
  if (term instanceof Term)
    return term;
  switch (term.termType) {
    case "NamedNode":
      return namedNode(term.value);
    case "BlankNode":
      return blankNode(term.value);
    case "Variable":
      return variable(term.value);
    case "DefaultGraph":
      return DEFAULTGRAPH;
    case "Literal":
      return literal(term.value, term.language || term.datatype);
    case "Quad":
      return fromQuad(term);
    default:
      throw new Error(`Unexpected termType: ${term.termType}`);
  }
}
function fromQuad(inQuad) {
  if (inQuad instanceof Quad)
    return inQuad;
  if (inQuad.termType !== "Quad")
    throw new Error(`Unexpected termType: ${inQuad.termType}`);
  return quad(fromTerm(inQuad.subject), fromTerm(inQuad.predicate), fromTerm(inQuad.object), fromTerm(inQuad.graph));
}

// node_modules/@jeswr/fetch-rdf/node_modules/n3/src/N3Parser.js
var blankNodePrefix = 0;
var N3Parser = class _N3Parser {
  constructor(options) {
    this._contextStack = [];
    this._graph = null;
    options = options || {};
    this._setBase(options.baseIRI);
    options.factory && initDataFactory(this, options.factory);
    const format = typeof options.format === "string" ? options.format.match(/\w*$/)[0].toLowerCase() : "", isTurtle = /turtle/.test(format), isTriG = /trig/.test(format), isNTriples = /triple/.test(format), isNQuads = /quad/.test(format), isN3 = this._n3Mode = /n3/.test(format), isLineMode = isNTriples || isNQuads;
    if (!(this._supportsNamedGraphs = !(isTurtle || isN3)))
      this._readPredicateOrNamedGraph = this._readPredicate;
    this._supportsQuads = !(isTurtle || isTriG || isNTriples || isN3);
    this._isImpliedBy = options.isImpliedBy;
    if (isLineMode)
      this._resolveRelativeIRI = (iri) => {
        return null;
      };
    this._blankNodePrefix = typeof options.blankNodePrefix !== "string" ? "" : options.blankNodePrefix.replace(/^(?!_:)/, "_:");
    this._lexer = options.lexer || new N3Lexer({ lineMode: isLineMode, n3: isN3, isImpliedBy: this._isImpliedBy });
    this._explicitQuantifiers = !!options.explicitQuantifiers;
    this._parseUnsupportedVersions = !!options.parseUnsupportedVersions;
    this._version = options.version;
  }
  // ## Static class methods
  // ### `_resetBlankNodePrefix` restarts blank node prefix identification
  static _resetBlankNodePrefix() {
    blankNodePrefix = 0;
  }
  // ## Private methods
  // ### `_setBase` sets the base IRI to resolve relative IRIs
  _setBase(baseIRI) {
    if (!baseIRI) {
      this._base = "";
      this._basePath = "";
    } else {
      const fragmentPos = baseIRI.indexOf("#");
      if (fragmentPos >= 0)
        baseIRI = baseIRI.substr(0, fragmentPos);
      this._base = baseIRI;
      this._basePath = baseIRI.indexOf("/") < 0 ? baseIRI : baseIRI.replace(/[^\/?]*(?:\?.*)?$/, "");
      baseIRI = baseIRI.match(/^(?:([a-z][a-z0-9+.-]*:))?(?:\/\/[^\/]*)?/i);
      this._baseRoot = baseIRI[0];
      this._baseScheme = baseIRI[1];
    }
  }
  // ### `_saveContext` stores the current parsing context
  // when entering a new scope (list, blank node, formula)
  _saveContext(type, graph, subject, predicate, object) {
    const n3Mode = this._n3Mode;
    this._contextStack.push({
      type,
      subject,
      predicate,
      object,
      graph,
      inverse: n3Mode ? this._inversePredicate : false,
      blankPrefix: n3Mode ? this._prefixes._ : "",
      quantified: n3Mode ? this._quantified : null
    });
    if (n3Mode) {
      this._inversePredicate = false;
      this._prefixes._ = this._graph ? `${this._graph.value}.` : ".";
      this._quantified = Object.create(this._quantified);
    }
  }
  // ### `_restoreContext` restores the parent context
  // when leaving a scope (list, blank node, formula)
  _restoreContext(type, token) {
    const context = this._contextStack.pop();
    if (!context || context.type !== type)
      return this._error(`Unexpected ${token.type}`, token);
    this._subject = context.subject;
    this._predicate = context.predicate;
    this._object = context.object;
    this._graph = context.graph;
    if (this._n3Mode) {
      this._inversePredicate = context.inverse;
      this._prefixes._ = context.blankPrefix;
      this._quantified = context.quantified;
    }
  }
  // ### `_readBeforeTopContext` is called once only at the start of parsing.
  _readBeforeTopContext(token) {
    if (this._version && !this._isValidVersion(this._version))
      return this._error(`Detected unsupported version as media type parameter: "${this._version}"`, token);
    return this._readInTopContext(token);
  }
  // ### `_readInTopContext` reads a token when in the top context
  _readInTopContext(token) {
    switch (token.type) {
      // If an EOF token arrives in the top context, signal that we're done
      case "eof":
        if (this._graph !== null)
          return this._error("Unclosed graph", token);
        delete this._prefixes._;
        return this._callback(null, null, this._prefixes);
      // It could be a prefix declaration
      case "PREFIX":
        this._sparqlStyle = true;
      case "@prefix":
        return this._readPrefix;
      // It could be a base declaration
      case "BASE":
        this._sparqlStyle = true;
      case "@base":
        return this._readBaseIRI;
      // It could be a version declaration
      case "VERSION":
        this._sparqlStyle = true;
      case "@version":
        return this._readVersion;
      // It could be a graph
      case "{":
        if (this._supportsNamedGraphs) {
          this._graph = "";
          this._subject = null;
          return this._readSubject;
        }
      case "GRAPH":
        if (this._supportsNamedGraphs)
          return this._readNamedGraphLabel;
      // Otherwise, the next token must be a subject
      default:
        return this._readSubject(token);
    }
  }
  // ### `_readEntity` reads an IRI, prefixed name, blank node, or variable
  _readEntity(token, quantifier) {
    let value;
    switch (token.type) {
      // Read a relative or absolute IRI
      case "IRI":
      case "typeIRI":
        const iri = this._resolveIRI(token.value);
        if (iri === null)
          return this._error("Invalid IRI", token);
        value = this._factory.namedNode(iri);
        break;
      // Read a prefixed name
      case "type":
      case "prefixed":
        const prefix = this._prefixes[token.prefix];
        if (prefix === void 0)
          return this._error(`Undefined prefix "${token.prefix}:"`, token);
        value = this._factory.namedNode(prefix + token.value);
        break;
      // Read a blank node
      case "blank":
        value = this._factory.blankNode(this._prefixes[token.prefix] + token.value);
        break;
      // Read a variable
      case "var":
        value = this._factory.variable(token.value.substr(1));
        break;
      // Everything else is not an entity
      default:
        return this._error(`Expected entity but got ${token.type}`, token);
    }
    if (!quantifier && this._n3Mode && value.id in this._quantified)
      value = this._quantified[value.id];
    return value;
  }
  // ### `_readSubject` reads a quad's subject
  _readSubject(token) {
    this._predicate = null;
    switch (token.type) {
      case "[":
        this._saveContext(
          "blank",
          this._graph,
          this._subject = this._factory.blankNode(),
          null,
          null
        );
        return this._readBlankNodeHead;
      case "(":
        const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
        if (parent.type === "<<") {
          return this._error("Unexpected list in reified triple", token);
        }
        this._saveContext("list", this._graph, this.RDF_NIL, null, null);
        this._subject = null;
        return this._readListItem;
      case "{":
        if (!this._n3Mode)
          return this._error("Unexpected graph", token);
        this._saveContext(
          "formula",
          this._graph,
          this._graph = this._factory.blankNode(),
          null,
          null
        );
        return this._readSubject;
      case "}":
        return this._readPunctuation(token);
      case "@forSome":
        if (!this._n3Mode)
          return this._error('Unexpected "@forSome"', token);
        this._subject = null;
        this._predicate = this.N3_FORSOME;
        this._quantifier = "blankNode";
        return this._readQuantifierList;
      case "@forAll":
        if (!this._n3Mode)
          return this._error('Unexpected "@forAll"', token);
        this._subject = null;
        this._predicate = this.N3_FORALL;
        this._quantifier = "variable";
        return this._readQuantifierList;
      case "literal":
        if (!this._n3Mode)
          return this._error("Unexpected literal", token);
        if (token.prefix.length === 0) {
          this._literalValue = token.value;
          return this._completeSubjectLiteral;
        } else
          this._subject = this._factory.literal(token.value, this._factory.namedNode(token.prefix));
        break;
      case "<<(":
        if (!this._n3Mode)
          return this._error("Disallowed triple term as subject", token);
        this._saveContext("<<(", this._graph, null, null, null);
        this._graph = null;
        return this._readSubject;
      case "<<":
        this._saveContext("<<", this._graph, null, null, null);
        this._graph = null;
        return this._readSubject;
      default:
        if ((this._subject = this._readEntity(token)) === void 0)
          return;
        if (this._n3Mode)
          return this._getPathReader(this._readPredicateOrNamedGraph);
    }
    return this._readPredicateOrNamedGraph;
  }
  // ### `_readPredicate` reads a quad's predicate
  _readPredicate(token) {
    const type = token.type;
    switch (type) {
      case "inverse":
        this._inversePredicate = true;
      case "abbreviation":
        this._predicate = this.ABBREVIATIONS[token.value];
        break;
      case ".":
      case "]":
      case "}":
      case "|}":
        if (this._predicate === null)
          return this._error(`Unexpected ${type}`, token);
        this._subject = null;
        return type === "]" ? this._readBlankNodeTail(token) : this._readPunctuation(token);
      case ";":
        return this._predicate !== null ? this._readPredicate : this._error("Expected predicate but got ;", token);
      case "[":
        if (this._n3Mode) {
          this._saveContext(
            "blank",
            this._graph,
            this._subject,
            this._subject = this._factory.blankNode(),
            null
          );
          return this._readBlankNodeHead;
        }
      case "blank":
        if (!this._n3Mode)
          return this._error("Disallowed blank node as predicate", token);
      default:
        if ((this._predicate = this._readEntity(token)) === void 0)
          return;
    }
    this._validAnnotation = true;
    return this._readObject;
  }
  // ### `_readObject` reads a quad's object
  _readObject(token) {
    switch (token.type) {
      case "literal":
        if (token.prefix.length === 0) {
          this._literalValue = token.value;
          return this._readDataTypeOrLang;
        } else
          this._object = this._factory.literal(token.value, this._factory.namedNode(token.prefix));
        break;
      case "[":
        this._saveContext(
          "blank",
          this._graph,
          this._subject,
          this._predicate,
          this._subject = this._factory.blankNode()
        );
        return this._readBlankNodeHead;
      case "(":
        const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
        if (parent.type === "<<") {
          return this._error("Unexpected list in reified triple", token);
        }
        this._saveContext("list", this._graph, this._subject, this._predicate, this.RDF_NIL);
        this._subject = null;
        return this._readListItem;
      case "{":
        if (!this._n3Mode)
          return this._error("Unexpected graph", token);
        this._saveContext(
          "formula",
          this._graph,
          this._subject,
          this._predicate,
          this._graph = this._factory.blankNode()
        );
        return this._readSubject;
      case "<<(":
        this._saveContext("<<(", this._graph, this._subject, this._predicate, null);
        this._graph = null;
        return this._readSubject;
      case "<<":
        this._saveContext("<<", this._graph, this._subject, this._predicate, null);
        this._graph = null;
        return this._readSubject;
      default:
        if ((this._object = this._readEntity(token)) === void 0)
          return;
        if (this._n3Mode)
          return this._getPathReader(this._getContextEndReader());
    }
    return this._getContextEndReader();
  }
  // ### `_readPredicateOrNamedGraph` reads a quad's predicate, or a named graph
  _readPredicateOrNamedGraph(token) {
    return token.type === "{" ? this._readGraph(token) : this._readPredicate(token);
  }
  // ### `_readGraph` reads a graph
  _readGraph(token) {
    if (token.type !== "{")
      return this._error(`Expected graph but got ${token.type}`, token);
    this._graph = this._subject, this._subject = null;
    return this._readSubject;
  }
  // ### `_readBlankNodeHead` reads the head of a blank node
  _readBlankNodeHead(token) {
    if (token.type === "]") {
      this._subject = null;
      return this._readBlankNodeTail(token);
    } else {
      const stack = this._contextStack, parentParent = stack.length > 1 && stack[stack.length - 2];
      if (parentParent.type === "<<") {
        return this._error("Unexpected compound blank node expression in reified triple", token);
      }
      this._predicate = null;
      return this._readPredicate(token);
    }
  }
  // ### `_readBlankNodeTail` reads the end of a blank node
  _readBlankNodeTail(token) {
    if (token.type !== "]")
      return this._readBlankNodePunctuation(token);
    if (this._subject !== null)
      this._emit(this._subject, this._predicate, this._object, this._graph);
    const empty = this._predicate === null;
    this._restoreContext("blank", token);
    if (this._object !== null)
      return this._getContextEndReader();
    else if (this._predicate !== null)
      return this._readObject;
    else
      return empty ? this._readPredicateOrNamedGraph : this._readPredicateAfterBlank;
  }
  // ### `_readPredicateAfterBlank` reads a predicate after an anonymous blank node
  _readPredicateAfterBlank(token) {
    switch (token.type) {
      case ".":
      case "}":
        this._subject = null;
        return this._readPunctuation(token);
      default:
        return this._readPredicate(token);
    }
  }
  // ### `_readListItem` reads items from a list
  _readListItem(token) {
    let item = null, list = null, next = this._readListItem;
    const previousList = this._subject, stack = this._contextStack, parent = stack[stack.length - 1];
    switch (token.type) {
      case "[":
        this._saveContext(
          "blank",
          this._graph,
          list = this._factory.blankNode(),
          this.RDF_FIRST,
          this._subject = item = this._factory.blankNode()
        );
        next = this._readBlankNodeHead;
        break;
      case "(":
        this._saveContext(
          "list",
          this._graph,
          list = this._factory.blankNode(),
          this.RDF_FIRST,
          this.RDF_NIL
        );
        this._subject = null;
        break;
      case ")":
        this._restoreContext("list", token);
        if (stack.length !== 0 && stack[stack.length - 1].type === "list")
          this._emit(this._subject, this._predicate, this._object, this._graph);
        if (this._predicate === null) {
          next = this._readPredicate;
          if (this._subject === this.RDF_NIL)
            return next;
        } else {
          next = this._getContextEndReader();
          if (this._object === this.RDF_NIL)
            return next;
        }
        list = this.RDF_NIL;
        break;
      case "literal":
        if (token.prefix.length === 0) {
          this._literalValue = token.value;
          next = this._readListItemDataTypeOrLang;
        } else {
          item = this._factory.literal(token.value, this._factory.namedNode(token.prefix));
          next = this._getContextEndReader();
        }
        break;
      case "{":
        if (!this._n3Mode)
          return this._error("Unexpected graph", token);
        this._saveContext(
          "formula",
          this._graph,
          this._subject,
          this._predicate,
          this._graph = this._factory.blankNode()
        );
        return this._readSubject;
      case "<<":
        this._saveContext("<<", this._graph, null, null, null);
        this._graph = null;
        next = this._readSubject;
        break;
      default:
        if ((item = this._readEntity(token)) === void 0)
          return;
    }
    if (list === null)
      this._subject = list = this._factory.blankNode();
    if (token.type === "<<")
      stack[stack.length - 1].subject = this._subject;
    if (previousList === null) {
      if (parent.predicate === null)
        parent.subject = list;
      else
        parent.object = list;
    } else {
      this._emit(previousList, this.RDF_REST, list, this._graph);
    }
    if (item !== null) {
      if (this._n3Mode && (token.type === "IRI" || token.type === "prefixed")) {
        this._saveContext("item", this._graph, list, this.RDF_FIRST, item);
        this._subject = item, this._predicate = null;
        return this._getPathReader(this._readListItem);
      }
      this._emit(list, this.RDF_FIRST, item, this._graph);
    }
    return next;
  }
  // ### `_readDataTypeOrLang` reads an _optional_ datatype or language
  _readDataTypeOrLang(token) {
    return this._completeObjectLiteral(token, false);
  }
  // ### `_readListItemDataTypeOrLang` reads an _optional_ datatype or language in a list
  _readListItemDataTypeOrLang(token) {
    return this._completeObjectLiteral(token, true);
  }
  // ### `_completeLiteral` completes a literal with an optional datatype or language
  _completeLiteral(token, component) {
    let literal2 = this._factory.literal(this._literalValue);
    let readCb;
    switch (token.type) {
      // Create a datatyped literal
      case "type":
      case "typeIRI":
        const datatype = this._readEntity(token);
        if (datatype === void 0) return;
        if (datatype.value === IRIs_default.rdf.langString || datatype.value === IRIs_default.rdf.dirLangString) {
          return this._error("Detected illegal (directional) languaged-tagged string with explicit datatype", token);
        }
        literal2 = this._factory.literal(this._literalValue, datatype);
        token = null;
        break;
      // Create a language-tagged string
      case "langcode":
        if (token.value.split("-").some((t) => t.length > 8))
          return this._error("Detected language tag with subtag longer than 8 characters", token);
        literal2 = this._factory.literal(this._literalValue, token.value);
        this._literalLanguage = token.value;
        token = null;
        readCb = this._readDirCode.bind(this, component);
        break;
    }
    return { token, literal: literal2, readCb };
  }
  _readDirCode(component, listItem, token) {
    if (token.type === "dircode") {
      const term = this._factory.literal(this._literalValue, { language: this._literalLanguage, direction: token.value });
      if (component === "subject")
        this._subject = term;
      else
        this._object = term;
      this._literalLanguage = void 0;
      token = null;
    }
    if (component === "subject")
      return token === null ? this._readPredicateOrNamedGraph : this._readPredicateOrNamedGraph(token);
    return this._completeObjectLiteralPost(token, listItem);
  }
  // Completes a literal in subject position
  _completeSubjectLiteral(token) {
    const completed = this._completeLiteral(token, "subject");
    this._subject = completed.literal;
    if (completed.readCb)
      return completed.readCb.bind(this, false);
    return this._readPredicateOrNamedGraph;
  }
  // Completes a literal in object position
  _completeObjectLiteral(token, listItem) {
    const completed = this._completeLiteral(token, "object");
    if (!completed)
      return;
    this._object = completed.literal;
    if (completed.readCb)
      return completed.readCb.bind(this, listItem);
    return this._completeObjectLiteralPost(completed.token, listItem);
  }
  _completeObjectLiteralPost(token, listItem) {
    if (listItem)
      this._emit(this._subject, this.RDF_FIRST, this._object, this._graph);
    if (token === null)
      return this._getContextEndReader();
    else {
      this._readCallback = this._getContextEndReader();
      return this._readCallback(token);
    }
  }
  // ### `_readFormulaTail` reads the end of a formula
  _readFormulaTail(token) {
    if (token.type !== "}")
      return this._readPunctuation(token);
    if (this._subject !== null)
      this._emit(this._subject, this._predicate, this._object, this._graph);
    this._restoreContext("formula", token);
    return this._object === null ? this._readPredicate : this._getContextEndReader();
  }
  // ### `_readPunctuation` reads punctuation between quads or quad parts
  _readPunctuation(token) {
    let next, graph = this._graph, startingAnnotation = false;
    const subject = this._subject, inversePredicate = this._inversePredicate;
    switch (token.type) {
      // A closing brace ends a graph
      case "}":
        if (this._graph === null)
          return this._error("Unexpected graph closing", token);
        if (this._n3Mode)
          return this._readFormulaTail(token);
        this._graph = null;
      // A dot just ends the statement, without sharing anything with the next
      case ".":
        this._subject = null;
        this._tripleTerm = null;
        next = this._contextStack.length ? this._readSubject : this._readInTopContext;
        if (inversePredicate) this._inversePredicate = false;
        break;
      // Semicolon means the subject is shared; predicate and object are different
      case ";":
        next = this._readPredicate;
        break;
      // Comma means both the subject and predicate are shared; the object is different
      case ",":
        next = this._readObject;
        break;
      // ~ is allowed in the annotation syntax
      case "~":
        next = this._readReifierInAnnotation;
        startingAnnotation = true;
        break;
      // {| means that the current triple is annotated with predicate-object pairs.
      case "{|":
        this._subject = this._readTripleTerm();
        this._validAnnotation = false;
        startingAnnotation = true;
        next = this._readPredicate;
        break;
      // |} means that the current reified triple in annotation syntax is finalized.
      case "|}":
        if (!this._annotation)
          return this._error("Unexpected annotation syntax closing", token);
        if (!this._validAnnotation)
          return this._error("Annotation block can not be empty", token);
        this._subject = null;
        this._annotation = false;
        next = this._readPunctuation;
        break;
      default:
        if (this._supportsQuads && this._graph === null && (graph = this._readEntity(token)) !== void 0) {
          next = this._readQuadPunctuation;
          break;
        }
        return this._error(`Expected punctuation to follow "${this._object.id}"`, token);
    }
    if (subject !== null && (!startingAnnotation || startingAnnotation && !this._annotation)) {
      const predicate = this._predicate, object = this._object;
      if (!inversePredicate)
        this._emit(subject, predicate, object, graph);
      else
        this._emit(object, predicate, subject, graph);
    }
    if (startingAnnotation) {
      this._annotation = true;
    }
    return next;
  }
  // ### `_readBlankNodePunctuation` reads punctuation in a blank node
  _readBlankNodePunctuation(token) {
    let next;
    switch (token.type) {
      // Semicolon means the subject is shared; predicate and object are different
      case ";":
        next = this._readPredicate;
        break;
      // Comma means both the subject and predicate are shared; the object is different
      case ",":
        next = this._readObject;
        break;
      default:
        return this._error(`Expected punctuation to follow "${this._object.id}"`, token);
    }
    this._emit(this._subject, this._predicate, this._object, this._graph);
    return next;
  }
  // ### `_readQuadPunctuation` reads punctuation after a quad
  _readQuadPunctuation(token) {
    if (token.type !== ".")
      return this._error("Expected dot to follow quad", token);
    return this._readInTopContext;
  }
  // ### `_readPrefix` reads the prefix of a prefix declaration
  _readPrefix(token) {
    if (token.type !== "prefix")
      return this._error("Expected prefix to follow @prefix", token);
    this._prefix = token.value;
    return this._readPrefixIRI;
  }
  // ### `_readPrefixIRI` reads the IRI of a prefix declaration
  _readPrefixIRI(token) {
    if (token.type !== "IRI")
      return this._error(`Expected IRI to follow prefix "${this._prefix}:"`, token);
    const prefixNode = this._readEntity(token);
    this._prefixes[this._prefix] = prefixNode.value;
    this._prefixCallback(this._prefix, prefixNode);
    return this._readDeclarationPunctuation;
  }
  // ### `_readBaseIRI` reads the IRI of a base declaration
  _readBaseIRI(token) {
    const iri = token.type === "IRI" && this._resolveIRI(token.value);
    if (!iri)
      return this._error("Expected valid IRI to follow base declaration", token);
    this._setBase(iri);
    return this._readDeclarationPunctuation;
  }
  // ### `_isValidVersion` checks if the given version is valid for this parser to handle.
  _isValidVersion(version) {
    return this._parseUnsupportedVersions || _N3Parser.SUPPORTED_VERSIONS.includes(version);
  }
  // ### `_readVersion` reads version string declaration
  _readVersion(token) {
    if (token.type !== "literal")
      return this._error("Expected literal to follow version declaration", token);
    if (token.end - token.start !== token.value.length + 2)
      return this._error("Version declarations must use single quotes", token);
    this._versionCallback(token.value);
    if (!this._isValidVersion(token.value))
      return this._error(`Detected unsupported version: "${token.value}"`, token);
    return this._readDeclarationPunctuation;
  }
  // ### `_readNamedGraphLabel` reads the label of a named graph
  _readNamedGraphLabel(token) {
    switch (token.type) {
      case "IRI":
      case "blank":
      case "prefixed":
        return this._readSubject(token), this._readGraph;
      case "[":
        return this._readNamedGraphBlankLabel;
      default:
        return this._error("Invalid graph label", token);
    }
  }
  // ### `_readNamedGraphLabel` reads a blank node label of a named graph
  _readNamedGraphBlankLabel(token) {
    if (token.type !== "]")
      return this._error("Invalid graph label", token);
    this._subject = this._factory.blankNode();
    return this._readGraph;
  }
  // ### `_readDeclarationPunctuation` reads the punctuation of a declaration
  _readDeclarationPunctuation(token) {
    if (this._sparqlStyle) {
      this._sparqlStyle = false;
      return this._readInTopContext(token);
    }
    if (token.type !== ".")
      return this._error("Expected declaration to end with a dot", token);
    return this._readInTopContext;
  }
  // Reads a list of quantified symbols from a @forSome or @forAll statement
  _readQuantifierList(token) {
    let entity;
    switch (token.type) {
      case "IRI":
      case "prefixed":
        if ((entity = this._readEntity(token, true)) !== void 0)
          break;
      default:
        return this._error(`Unexpected ${token.type}`, token);
    }
    if (!this._explicitQuantifiers)
      this._quantified[entity.id] = this._factory[this._quantifier](this._factory.blankNode().value);
    else {
      if (this._subject === null)
        this._emit(
          this._graph || this.DEFAULTGRAPH,
          this._predicate,
          this._subject = this._factory.blankNode(),
          this.QUANTIFIERS_GRAPH
        );
      else
        this._emit(
          this._subject,
          this.RDF_REST,
          this._subject = this._factory.blankNode(),
          this.QUANTIFIERS_GRAPH
        );
      this._emit(this._subject, this.RDF_FIRST, entity, this.QUANTIFIERS_GRAPH);
    }
    return this._readQuantifierPunctuation;
  }
  // Reads punctuation from a @forSome or @forAll statement
  _readQuantifierPunctuation(token) {
    if (token.type === ",")
      return this._readQuantifierList;
    else {
      if (this._explicitQuantifiers) {
        this._emit(this._subject, this.RDF_REST, this.RDF_NIL, this.QUANTIFIERS_GRAPH);
        this._subject = null;
      }
      this._readCallback = this._getContextEndReader();
      return this._readCallback(token);
    }
  }
  // ### `_getPathReader` reads a potential path and then resumes with the given function
  _getPathReader(afterPath) {
    this._afterPath = afterPath;
    return this._readPath;
  }
  // ### `_readPath` reads a potential path
  _readPath(token) {
    switch (token.type) {
      // Forward path
      case "!":
        return this._readForwardPath;
      // Backward path
      case "^":
        return this._readBackwardPath;
      // Not a path; resume reading where we left off
      default:
        const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
        if (parent && parent.type === "item") {
          const item = this._subject;
          this._restoreContext("item", token);
          this._emit(this._subject, this.RDF_FIRST, item, this._graph);
        }
        return this._afterPath(token);
    }
  }
  // ### `_readForwardPath` reads a '!' path
  _readForwardPath(token) {
    let subject, predicate;
    const object = this._factory.blankNode();
    if ((predicate = this._readEntity(token)) === void 0)
      return;
    if (this._predicate === null)
      subject = this._subject, this._subject = object;
    else
      subject = this._object, this._object = object;
    this._emit(subject, predicate, object, this._graph);
    return this._readPath;
  }
  // ### `_readBackwardPath` reads a '^' path
  _readBackwardPath(token) {
    const subject = this._factory.blankNode();
    let predicate, object;
    if ((predicate = this._readEntity(token)) === void 0)
      return;
    if (this._predicate === null)
      object = this._subject, this._subject = subject;
    else
      object = this._object, this._object = subject;
    this._emit(subject, predicate, object, this._graph);
    return this._readPath;
  }
  // ### `_readTripleTermTail` reads the end of a triple term
  _readTripleTermTail(token) {
    if (token.type !== ")>>")
      return this._error(`Expected )>> but got ${token.type}`, token);
    const quad2 = this._factory.quad(
      this._subject,
      this._predicate,
      this._object,
      this._graph || this.DEFAULTGRAPH
    );
    this._restoreContext("<<(", token);
    if (this._subject === null) {
      this._subject = quad2;
      return this._readPredicate;
    } else {
      this._object = quad2;
      return this._getContextEndReader();
    }
  }
  // ### `_readReifiedTripleTailOrReifier` reads a reifier or the end of a nested reified triple
  _readReifiedTripleTailOrReifier(token) {
    if (token.type === "~") {
      return this._readReifier;
    }
    return this._readReifiedTripleTail(token);
  }
  // ### `_readReifiedTripleTail` reads the end of a nested reified triple
  _readReifiedTripleTail(token) {
    if (token.type !== ">>")
      return this._error(`Expected >> but got ${token.type}`, token);
    this._tripleTerm = null;
    const reifier = this._readTripleTerm();
    this._restoreContext("<<", token);
    const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
    if (parent && parent.type === "list") {
      this._emit(this._subject, this.RDF_FIRST, reifier, this._graph);
      return this._getContextEndReader();
    } else if (this._subject === null) {
      this._subject = reifier;
      return this._readPredicateOrReifierTripleEnd;
    } else {
      this._object = reifier;
      return this._getContextEndReader();
    }
  }
  _readPredicateOrReifierTripleEnd(token) {
    if (token.type === ".") {
      this._subject = null;
      return this._readPunctuation(token);
    }
    return this._readPredicate(token);
  }
  // ### `_readReifier` reads the triple term identifier after a tilde when in a reifying triple.
  _readReifier(token) {
    this._reifier = this._readEntity(token);
    return this._readReifiedTripleTail;
  }
  // ### `_readReifier` reads the optional triple term identifier after a tilde when in annotation syntax.
  _readReifierInAnnotation(token) {
    if (token.type === "IRI" || token.type === "typeIRI" || token.type === "type" || token.type === "prefixed" || token.type === "blank" || token.type === "var") {
      this._reifier = this._readEntity(token);
      return this._readPunctuation;
    }
    this._readTripleTerm();
    this._subject = null;
    return this._readPunctuation(token);
  }
  _readTripleTerm() {
    const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
    const parentGraph = parent ? parent.graph : void 0;
    const reifier = this._reifier || this._factory.blankNode();
    this._reifier = null;
    this._tripleTerm = this._tripleTerm || this._factory.quad(this._subject, this._predicate, this._object);
    this._emit(reifier, this.RDF_REIFIES, this._tripleTerm, parentGraph || this.DEFAULTGRAPH);
    return reifier;
  }
  // ### `_getContextEndReader` gets the next reader function at the end of a context
  _getContextEndReader() {
    const contextStack = this._contextStack;
    if (!contextStack.length)
      return this._readPunctuation;
    switch (contextStack[contextStack.length - 1].type) {
      case "blank":
        return this._readBlankNodeTail;
      case "list":
        return this._readListItem;
      case "formula":
        return this._readFormulaTail;
      case "<<(":
        return this._readTripleTermTail;
      case "<<":
        return this._readReifiedTripleTailOrReifier;
    }
  }
  // ### `_emit` sends a quad through the callback
  _emit(subject, predicate, object, graph) {
    this._callback(null, this._factory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH));
  }
  // ### `_error` emits an error message through the callback
  _error(message, token) {
    const err = new Error(`${message} on line ${token.line}.`);
    err.context = {
      token,
      line: token.line,
      previousToken: this._lexer.previousToken
    };
    this._callback(err);
    this._callback = noop;
  }
  // ### `_resolveIRI` resolves an IRI against the base path
  _resolveIRI(iri) {
    return /^[a-z][a-z0-9+.-]*:/i.test(iri) ? iri : this._resolveRelativeIRI(iri);
  }
  // ### `_resolveRelativeIRI` resolves an IRI against the base path,
  // assuming that a base path has been set and that the IRI is indeed relative
  _resolveRelativeIRI(iri) {
    if (!iri.length)
      return this._base;
    switch (iri[0]) {
      // Resolve relative fragment IRIs against the base IRI
      case "#":
        return this._base + iri;
      // Resolve relative query string IRIs by replacing the query string
      case "?":
        return this._base.replace(/(?:\?.*)?$/, iri);
      // Resolve root-relative IRIs at the root of the base IRI
      case "/":
        return (iri[1] === "/" ? this._baseScheme : this._baseRoot) + this._removeDotSegments(iri);
      // Resolve all other IRIs at the base IRI's path
      default:
        return /^[^/:]*:/.test(iri) ? null : this._removeDotSegments(this._basePath + iri);
    }
  }
  // ### `_removeDotSegments` resolves './' and '../' path segments in an IRI as per RFC3986
  _removeDotSegments(iri) {
    if (!/(^|\/)\.\.?($|[/#?])/.test(iri))
      return iri;
    const length = iri.length;
    let result = "", i = -1, pathStart = -1, segmentStart = 0, next = "/";
    while (i < length) {
      switch (next) {
        // The path starts with the first slash after the authority
        case ":":
          if (pathStart < 0) {
            if (iri[++i] === "/" && iri[++i] === "/")
              while ((pathStart = i + 1) < length && iri[pathStart] !== "/")
                i = pathStart;
          }
          break;
        // Don't modify a query string or fragment
        case "?":
        case "#":
          i = length;
          break;
        // Handle '/.' or '/..' path segments
        case "/":
          if (iri[i + 1] === ".") {
            next = iri[++i + 1];
            switch (next) {
              // Remove a '/.' segment
              case "/":
                result += iri.substring(segmentStart, i - 1);
                segmentStart = i + 1;
                break;
              // Remove a trailing '/.' segment
              case void 0:
              case "?":
              case "#":
                return result + iri.substring(segmentStart, i) + iri.substr(i + 1);
              // Remove a '/..' segment
              case ".":
                next = iri[++i + 1];
                if (next === void 0 || next === "/" || next === "?" || next === "#") {
                  result += iri.substring(segmentStart, i - 2);
                  if ((segmentStart = result.lastIndexOf("/")) >= pathStart)
                    result = result.substr(0, segmentStart);
                  if (next !== "/")
                    return `${result}/${iri.substr(i + 1)}`;
                  segmentStart = i + 1;
                }
            }
          }
      }
      next = iri[++i];
    }
    return result + iri.substring(segmentStart);
  }
  // ## Public methods
  // ### `parse` parses the N3 input and emits each parsed quad through the onQuad callback.
  parse(input, quadCallback, prefixCallback, versionCallback) {
    let onQuad, onPrefix, onComment, onVersion;
    if (quadCallback && (quadCallback.onQuad || quadCallback.onPrefix || quadCallback.onComment || quadCallback.onVersion)) {
      onQuad = quadCallback.onQuad;
      onPrefix = quadCallback.onPrefix;
      onComment = quadCallback.onComment;
      onVersion = quadCallback.onVersion;
    } else {
      onQuad = quadCallback;
      onPrefix = prefixCallback;
      onVersion = versionCallback;
    }
    this._readCallback = this._readBeforeTopContext;
    this._sparqlStyle = false;
    this._prefixes = /* @__PURE__ */ Object.create(null);
    this._prefixes._ = this._blankNodePrefix ? this._blankNodePrefix.substr(2) : `b${blankNodePrefix++}_`;
    this._prefixCallback = onPrefix || noop;
    this._versionCallback = onVersion || noop;
    this._inversePredicate = false;
    this._quantified = /* @__PURE__ */ Object.create(null);
    if (!onQuad) {
      const quads = [];
      let error;
      this._callback = (e, t) => {
        e ? error = e : t && quads.push(t);
      };
      this._lexer.tokenize(input).every((token) => {
        return this._readCallback = this._readCallback(token);
      });
      if (error) throw error;
      return quads;
    }
    let processNextToken = (error, token) => {
      if (error !== null)
        this._callback(error), this._callback = noop;
      else if (this._readCallback)
        this._readCallback = this._readCallback(token);
    };
    if (onComment) {
      this._lexer.comments = true;
      processNextToken = (error, token) => {
        if (error !== null)
          this._callback(error), this._callback = noop;
        else if (this._readCallback) {
          if (token.type === "comment")
            onComment(token.value);
          else
            this._readCallback = this._readCallback(token);
        }
      };
    }
    this._callback = onQuad;
    this._lexer.tokenize(input, processNextToken);
  }
};
function noop() {
}
function initDataFactory(parser, factory2) {
  parser._factory = factory2;
  parser.DEFAULTGRAPH = factory2.defaultGraph();
  parser.RDF_FIRST = factory2.namedNode(IRIs_default.rdf.first);
  parser.RDF_REST = factory2.namedNode(IRIs_default.rdf.rest);
  parser.RDF_NIL = factory2.namedNode(IRIs_default.rdf.nil);
  parser.RDF_REIFIES = factory2.namedNode(IRIs_default.rdf.reifies);
  parser.N3_FORALL = factory2.namedNode(IRIs_default.r.forAll);
  parser.N3_FORSOME = factory2.namedNode(IRIs_default.r.forSome);
  parser.ABBREVIATIONS = {
    "a": factory2.namedNode(IRIs_default.rdf.type),
    "=": factory2.namedNode(IRIs_default.owl.sameAs),
    ">": factory2.namedNode(IRIs_default.log.implies),
    "<": factory2.namedNode(IRIs_default.log.isImpliedBy)
  };
  parser.QUANTIFIERS_GRAPH = factory2.namedNode("urn:n3:quantifiers");
}
N3Parser.SUPPORTED_VERSIONS = [
  "1.2",
  "1.2-basic",
  "1.1"
];
initDataFactory(N3Parser.prototype, N3DataFactory_default);

// node_modules/@jeswr/fetch-rdf/dist/parse.js
var import_jsonld_streaming_parser = __toESM(require_jsonld_streaming_parser(), 1);

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
  if (N3_FAMILY.has(mediaType)) {
    let quads;
    try {
      quads = new N3Parser({ format: mediaType, ...baseIRI !== void 0 && { baseIRI } }).parse(body);
    } catch (cause) {
      throw new RdfFetchError(`Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`, { cause, contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
    }
    return dataset_default.dataset(quads);
  }
  if (JSON_LD_FAMILY.has(mediaType)) {
    let quads;
    try {
      quads = await parseJsonLd(body, baseIRI);
    } catch (cause) {
      throw new RdfFetchError(`Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`, { cause, contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
    }
    return dataset_default.dataset(quads);
  }
  throw new RdfFetchError(`Unsupported RDF media type: "${mediaType}". Supported: ${SUPPORTED_RDF_MEDIA_TYPES.join(", ")}.`, { contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
}
function extractMediaType(headerValue) {
  if (!headerValue)
    return null;
  try {
    return import_content_type.default.parse(headerValue).type;
  } catch {
    return null;
  }
}
function parseJsonLd(body, baseIRI) {
  return new Promise((resolve, reject) => {
    const parser = new import_jsonld_streaming_parser.JsonLdParser({
      ...baseIRI !== void 0 && { baseIRI }
    });
    const collected = [];
    parser.on("data", (quad2) => {
      collected.push(quad2);
    });
    parser.on("error", reject);
    parser.on("end", () => {
      resolve(collected);
    });
    parser.write(body);
    parser.end();
  });
}

// node_modules/@jeswr/fetch-rdf/dist/fetch.js
var DEFAULT_ACCEPT = "text/turtle, application/ld+json;q=0.9";
async function fetchRdf(url, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const accept = options.accept ?? DEFAULT_ACCEPT;
  const headers = new Headers(options.headers);
  headers.set("accept", accept);
  let response;
  try {
    response = await fetchImpl(url, {
      headers,
      ...options.signal !== void 0 && { signal: options.signal }
    });
  } catch (cause) {
    throw new RdfFetchError(`Network error fetching ${url}: ${errorMessage(cause)}`, { cause, url });
  }
  if (!response.ok) {
    throw new RdfFetchError(`HTTP ${response.status} ${response.statusText || ""} fetching ${url}.`.trim(), {
      status: response.status,
      url: response.url || url,
      contentType: response.headers.get("content-type") ?? void 0
    });
  }
  const rawContentType = response.headers.get("content-type");
  const finalUrl = response.url || url;
  let body;
  try {
    body = await response.text();
  } catch (cause) {
    throw new RdfFetchError(`Failed to read response body from ${finalUrl}.`, {
      cause,
      url: finalUrl,
      ...rawContentType !== null && { contentType: rawContentType }
    });
  }
  const dataset = await parseRdf(body, rawContentType, { baseIRI: finalUrl });
  return {
    dataset,
    etag: response.headers.get("etag"),
    contentType: extractMediaType(rawContentType),
    response,
    url: finalUrl
  };
}
function errorMessage(cause) {
  if (cause instanceof Error)
    return cause.message;
  return String(cause);
}

export {
  __commonJS,
  __export,
  __toESM,
  require_buffer,
  require_browser3 as require_browser,
  require_rdf_data_factory,
  RdfFetchError,
  SUPPORTED_RDF_MEDIA_TYPES,
  parseRdf,
  extractMediaType,
  DEFAULT_ACCEPT,
  fetchRdf
};
