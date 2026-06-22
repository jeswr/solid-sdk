import {
  __commonJS,
  __export,
  __toESM,
  parseRdf,
  require_browser,
  require_buffer,
  require_rdf_data_factory
} from "./chunk-BNRDLDVI.js";

// node_modules/lodash/_trimmedEndIndex.js
var require_trimmedEndIndex = __commonJS({
  "node_modules/lodash/_trimmedEndIndex.js"(exports, module) {
    var reWhitespace = /\s/;
    function trimmedEndIndex(string2) {
      var index = string2.length;
      while (index-- && reWhitespace.test(string2.charAt(index))) {
      }
      return index;
    }
    module.exports = trimmedEndIndex;
  }
});

// node_modules/lodash/_baseTrim.js
var require_baseTrim = __commonJS({
  "node_modules/lodash/_baseTrim.js"(exports, module) {
    var trimmedEndIndex = require_trimmedEndIndex();
    var reTrimStart = /^\s+/;
    function baseTrim(string2) {
      return string2 ? string2.slice(0, trimmedEndIndex(string2) + 1).replace(reTrimStart, "") : string2;
    }
    module.exports = baseTrim;
  }
});

// node_modules/lodash/isObject.js
var require_isObject = __commonJS({
  "node_modules/lodash/isObject.js"(exports, module) {
    function isObject(value) {
      var type = typeof value;
      return value != null && (type == "object" || type == "function");
    }
    module.exports = isObject;
  }
});

// node_modules/lodash/_freeGlobal.js
var require_freeGlobal = __commonJS({
  "node_modules/lodash/_freeGlobal.js"(exports, module) {
    var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
    module.exports = freeGlobal;
  }
});

// node_modules/lodash/_root.js
var require_root = __commonJS({
  "node_modules/lodash/_root.js"(exports, module) {
    var freeGlobal = require_freeGlobal();
    var freeSelf = typeof self == "object" && self && self.Object === Object && self;
    var root = freeGlobal || freeSelf || Function("return this")();
    module.exports = root;
  }
});

// node_modules/lodash/_Symbol.js
var require_Symbol = __commonJS({
  "node_modules/lodash/_Symbol.js"(exports, module) {
    var root = require_root();
    var Symbol2 = root.Symbol;
    module.exports = Symbol2;
  }
});

// node_modules/lodash/_getRawTag.js
var require_getRawTag = __commonJS({
  "node_modules/lodash/_getRawTag.js"(exports, module) {
    var Symbol2 = require_Symbol();
    var objectProto = Object.prototype;
    var hasOwnProperty = objectProto.hasOwnProperty;
    var nativeObjectToString = objectProto.toString;
    var symToStringTag = Symbol2 ? Symbol2.toStringTag : void 0;
    function getRawTag(value) {
      var isOwn = hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag];
      try {
        value[symToStringTag] = void 0;
        var unmasked = true;
      } catch (e6) {
      }
      var result = nativeObjectToString.call(value);
      if (unmasked) {
        if (isOwn) {
          value[symToStringTag] = tag;
        } else {
          delete value[symToStringTag];
        }
      }
      return result;
    }
    module.exports = getRawTag;
  }
});

// node_modules/lodash/_objectToString.js
var require_objectToString = __commonJS({
  "node_modules/lodash/_objectToString.js"(exports, module) {
    var objectProto = Object.prototype;
    var nativeObjectToString = objectProto.toString;
    function objectToString(value) {
      return nativeObjectToString.call(value);
    }
    module.exports = objectToString;
  }
});

// node_modules/lodash/_baseGetTag.js
var require_baseGetTag = __commonJS({
  "node_modules/lodash/_baseGetTag.js"(exports, module) {
    var Symbol2 = require_Symbol();
    var getRawTag = require_getRawTag();
    var objectToString = require_objectToString();
    var nullTag = "[object Null]";
    var undefinedTag = "[object Undefined]";
    var symToStringTag = Symbol2 ? Symbol2.toStringTag : void 0;
    function baseGetTag(value) {
      if (value == null) {
        return value === void 0 ? undefinedTag : nullTag;
      }
      return symToStringTag && symToStringTag in Object(value) ? getRawTag(value) : objectToString(value);
    }
    module.exports = baseGetTag;
  }
});

// node_modules/lodash/isObjectLike.js
var require_isObjectLike = __commonJS({
  "node_modules/lodash/isObjectLike.js"(exports, module) {
    function isObjectLike(value) {
      return value != null && typeof value == "object";
    }
    module.exports = isObjectLike;
  }
});

// node_modules/lodash/isSymbol.js
var require_isSymbol = __commonJS({
  "node_modules/lodash/isSymbol.js"(exports, module) {
    var baseGetTag = require_baseGetTag();
    var isObjectLike = require_isObjectLike();
    var symbolTag = "[object Symbol]";
    function isSymbol(value) {
      return typeof value == "symbol" || isObjectLike(value) && baseGetTag(value) == symbolTag;
    }
    module.exports = isSymbol;
  }
});

// node_modules/lodash/toNumber.js
var require_toNumber = __commonJS({
  "node_modules/lodash/toNumber.js"(exports, module) {
    var baseTrim = require_baseTrim();
    var isObject = require_isObject();
    var isSymbol = require_isSymbol();
    var NAN = 0 / 0;
    var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;
    var reIsBinary = /^0b[01]+$/i;
    var reIsOctal = /^0o[0-7]+$/i;
    var freeParseInt = parseInt;
    function toNumber(value) {
      if (typeof value == "number") {
        return value;
      }
      if (isSymbol(value)) {
        return NAN;
      }
      if (isObject(value)) {
        var other = typeof value.valueOf == "function" ? value.valueOf() : value;
        value = isObject(other) ? other + "" : other;
      }
      if (typeof value != "string") {
        return value === 0 ? value : +value;
      }
      value = baseTrim(value);
      var isBinary = reIsBinary.test(value);
      return isBinary || reIsOctal.test(value) ? freeParseInt(value.slice(2), isBinary ? 2 : 8) : reIsBadHex.test(value) ? NAN : +value;
    }
    module.exports = toNumber;
  }
});

// node_modules/lodash/toFinite.js
var require_toFinite = __commonJS({
  "node_modules/lodash/toFinite.js"(exports, module) {
    var toNumber = require_toNumber();
    var INFINITY = 1 / 0;
    var MAX_INTEGER = 17976931348623157e292;
    function toFinite(value) {
      if (!value) {
        return value === 0 ? value : 0;
      }
      value = toNumber(value);
      if (value === INFINITY || value === -INFINITY) {
        var sign = value < 0 ? -1 : 1;
        return sign * MAX_INTEGER;
      }
      return value === value ? value : 0;
    }
    module.exports = toFinite;
  }
});

// node_modules/lodash/toInteger.js
var require_toInteger = __commonJS({
  "node_modules/lodash/toInteger.js"(exports, module) {
    var toFinite = require_toFinite();
    function toInteger(value) {
      var result = toFinite(value), remainder = result % 1;
      return result === result ? remainder ? result - remainder : result : 0;
    }
    module.exports = toInteger;
  }
});

// node_modules/lodash/before.js
var require_before = __commonJS({
  "node_modules/lodash/before.js"(exports, module) {
    var toInteger = require_toInteger();
    var FUNC_ERROR_TEXT = "Expected a function";
    function before(n5, func) {
      var result;
      if (typeof func != "function") {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      n5 = toInteger(n5);
      return function() {
        if (--n5 > 0) {
          result = func.apply(this, arguments);
        }
        if (n5 <= 1) {
          func = void 0;
        }
        return result;
      };
    }
    module.exports = before;
  }
});

// node_modules/lodash/once.js
var require_once = __commonJS({
  "node_modules/lodash/once.js"(exports, module) {
    var before = require_before();
    function once5(func) {
      return before(2, func);
    }
    module.exports = once5;
  }
});

// node_modules/rdf-literal/lib/Translator.js
var require_Translator = __commonJS({
  "node_modules/rdf-literal/lib/Translator.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Translator = void 0;
    var Translator = class {
      constructor() {
        this.supportedRdfDatatypes = [];
        this.fromRdfHandlers = {};
        this.toRdfHandlers = {};
      }
      static incorrectRdfDataType(literal4) {
        throw new Error(`Invalid RDF ${literal4.datatype.value} value: '${literal4.value}'`);
      }
      registerHandler(handler2, rdfDatatypes, javaScriptDataTypes) {
        for (const rdfDatatype of rdfDatatypes) {
          this.supportedRdfDatatypes.push(rdfDatatype);
          this.fromRdfHandlers[rdfDatatype.value] = handler2;
        }
        for (const javaScriptDataType of javaScriptDataTypes) {
          let existingToRdfHandlers = this.toRdfHandlers[javaScriptDataType];
          if (!existingToRdfHandlers) {
            this.toRdfHandlers[javaScriptDataType] = existingToRdfHandlers = [];
          }
          existingToRdfHandlers.push(handler2);
        }
      }
      fromRdf(literal4, validate) {
        const handler2 = this.fromRdfHandlers[literal4.datatype.value];
        if (handler2) {
          return handler2.fromRdf(literal4, validate);
        } else {
          return literal4.value;
        }
      }
      toRdf(value, options) {
        const handlers = this.toRdfHandlers[typeof value];
        if (handlers) {
          for (const handler2 of handlers) {
            const ret = handler2.toRdf(value, options);
            if (ret) {
              return ret;
            }
          }
        }
        throw new Error(`Invalid JavaScript value: '${value}'`);
      }
      /**
       * @return {NamedNode[]} An array of all supported RDF datatypes.
       */
      getSupportedRdfDatatypes() {
        return this.supportedRdfDatatypes;
      }
      /**
       * @return {string[]} An array of all supported JavaScript types.
       */
      getSupportedJavaScriptPrimitives() {
        return Object.keys(this.toRdfHandlers);
      }
    };
    exports.Translator = Translator;
  }
});

// node_modules/rdf-literal/lib/handler/TypeHandlerBoolean.js
var require_TypeHandlerBoolean = __commonJS({
  "node_modules/rdf-literal/lib/handler/TypeHandlerBoolean.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TypeHandlerBoolean = void 0;
    var Translator_1 = require_Translator();
    var TypeHandlerBoolean = class _TypeHandlerBoolean {
      fromRdf(literal4, validate) {
        switch (literal4.value) {
          case "true":
            return true;
          case "false":
            return false;
          case "1":
            return true;
          case "0":
            return false;
        }
        if (validate) {
          Translator_1.Translator.incorrectRdfDataType(literal4);
        }
        return false;
      }
      toRdf(value, { datatype, dataFactory }) {
        return dataFactory.literal(value ? "true" : "false", datatype || dataFactory.namedNode(_TypeHandlerBoolean.TYPE));
      }
    };
    exports.TypeHandlerBoolean = TypeHandlerBoolean;
    TypeHandlerBoolean.TYPE = "http://www.w3.org/2001/XMLSchema#boolean";
  }
});

// node_modules/rdf-literal/lib/handler/TypeHandlerDate.js
var require_TypeHandlerDate = __commonJS({
  "node_modules/rdf-literal/lib/handler/TypeHandlerDate.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TypeHandlerDate = void 0;
    var Translator_1 = require_Translator();
    var TypeHandlerDate = class _TypeHandlerDate {
      fromRdf(literal4, validate) {
        if (validate && !literal4.value.match(_TypeHandlerDate.VALIDATORS[literal4.datatype.value.substr(33, literal4.datatype.value.length)])) {
          Translator_1.Translator.incorrectRdfDataType(literal4);
        }
        switch (literal4.datatype.value) {
          case "http://www.w3.org/2001/XMLSchema#gDay":
            return new Date(0, 0, parseInt(literal4.value, 10));
          case "http://www.w3.org/2001/XMLSchema#gMonthDay":
            const partsMonthDay = literal4.value.split("-");
            return new Date(0, parseInt(partsMonthDay[0], 10) - 1, parseInt(partsMonthDay[1], 10));
          case "http://www.w3.org/2001/XMLSchema#gYear":
            return /* @__PURE__ */ new Date(literal4.value + "-01-01");
          case "http://www.w3.org/2001/XMLSchema#gYearMonth":
            return /* @__PURE__ */ new Date(literal4.value + "-01");
          default:
            return new Date(literal4.value);
        }
      }
      toRdf(value, { datatype, dataFactory }) {
        datatype = datatype || dataFactory.namedNode(_TypeHandlerDate.TYPES[0]);
        if (!(value instanceof Date)) {
          return null;
        }
        const date2 = value;
        let valueString;
        switch (datatype.value) {
          case "http://www.w3.org/2001/XMLSchema#gDay":
            valueString = String(date2.getUTCDate());
            break;
          case "http://www.w3.org/2001/XMLSchema#gMonthDay":
            valueString = date2.getUTCMonth() + 1 + "-" + date2.getUTCDate();
            break;
          case "http://www.w3.org/2001/XMLSchema#gYear":
            valueString = String(date2.getUTCFullYear());
            break;
          case "http://www.w3.org/2001/XMLSchema#gYearMonth":
            valueString = date2.getUTCFullYear() + "-" + (date2.getUTCMonth() + 1);
            break;
          case "http://www.w3.org/2001/XMLSchema#date":
            valueString = date2.toISOString().replace(/T.*$/, "");
            break;
          default:
            valueString = date2.toISOString();
        }
        return dataFactory.literal(valueString, datatype);
      }
    };
    exports.TypeHandlerDate = TypeHandlerDate;
    TypeHandlerDate.TYPES = [
      "http://www.w3.org/2001/XMLSchema#dateTime",
      "http://www.w3.org/2001/XMLSchema#date",
      "http://www.w3.org/2001/XMLSchema#gDay",
      "http://www.w3.org/2001/XMLSchema#gMonthDay",
      "http://www.w3.org/2001/XMLSchema#gYear",
      "http://www.w3.org/2001/XMLSchema#gYearMonth"
    ];
    TypeHandlerDate.VALIDATORS = {
      date: /^[0-9]+-[0-9][0-9]-[0-9][0-9]Z?$/,
      dateTime: /^[0-9]+-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9](\.[0-9][0-9][0-9])?((Z?)|([\+-][0-9][0-9]:[0-9][0-9]))$/,
      gDay: /^[0-9]+$/,
      gMonthDay: /^[0-9]+-[0-9][0-9]$/,
      gYear: /^[0-9]+$/,
      gYearMonth: /^[0-9]+-[0-9][0-9]$/
    };
  }
});

// node_modules/rdf-literal/lib/handler/TypeHandlerNumberDouble.js
var require_TypeHandlerNumberDouble = __commonJS({
  "node_modules/rdf-literal/lib/handler/TypeHandlerNumberDouble.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TypeHandlerNumberDouble = void 0;
    var Translator_1 = require_Translator();
    var TypeHandlerNumberDouble = class _TypeHandlerNumberDouble {
      fromRdf(literal4, validate) {
        const parsed = parseFloat(literal4.value);
        if (validate) {
          if (isNaN(parsed)) {
            Translator_1.Translator.incorrectRdfDataType(literal4);
          }
        }
        return parsed;
      }
      toRdf(value, { datatype, dataFactory }) {
        datatype = datatype || dataFactory.namedNode(_TypeHandlerNumberDouble.TYPES[0]);
        if (isNaN(value)) {
          return dataFactory.literal("NaN", datatype);
        }
        if (!isFinite(value)) {
          return dataFactory.literal(value > 0 ? "INF" : "-INF", datatype);
        }
        if (value % 1 === 0) {
          return null;
        }
        return dataFactory.literal(value.toExponential(15).replace(/(\d)0*e\+?/, "$1E"), datatype);
      }
    };
    exports.TypeHandlerNumberDouble = TypeHandlerNumberDouble;
    TypeHandlerNumberDouble.TYPES = [
      "http://www.w3.org/2001/XMLSchema#double",
      "http://www.w3.org/2001/XMLSchema#decimal",
      "http://www.w3.org/2001/XMLSchema#float"
    ];
  }
});

// node_modules/rdf-literal/lib/handler/TypeHandlerNumberInteger.js
var require_TypeHandlerNumberInteger = __commonJS({
  "node_modules/rdf-literal/lib/handler/TypeHandlerNumberInteger.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TypeHandlerNumberInteger = void 0;
    var Translator_1 = require_Translator();
    var TypeHandlerNumberInteger = class _TypeHandlerNumberInteger {
      fromRdf(literal4, validate) {
        const parsed = parseInt(literal4.value, 10);
        if (validate) {
          if (isNaN(parsed) || literal4.value.indexOf(".") >= 0) {
            Translator_1.Translator.incorrectRdfDataType(literal4);
          }
        }
        return parsed;
      }
      toRdf(value, { datatype, dataFactory }) {
        return dataFactory.literal(String(value), datatype || (value <= _TypeHandlerNumberInteger.MAX_INT && value >= _TypeHandlerNumberInteger.MIN_INT ? dataFactory.namedNode(_TypeHandlerNumberInteger.TYPES[0]) : dataFactory.namedNode(_TypeHandlerNumberInteger.TYPES[1])));
      }
    };
    exports.TypeHandlerNumberInteger = TypeHandlerNumberInteger;
    TypeHandlerNumberInteger.TYPES = [
      "http://www.w3.org/2001/XMLSchema#integer",
      "http://www.w3.org/2001/XMLSchema#long",
      "http://www.w3.org/2001/XMLSchema#int",
      "http://www.w3.org/2001/XMLSchema#byte",
      "http://www.w3.org/2001/XMLSchema#short",
      "http://www.w3.org/2001/XMLSchema#negativeInteger",
      "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
      "http://www.w3.org/2001/XMLSchema#nonPositiveInteger",
      "http://www.w3.org/2001/XMLSchema#positiveInteger",
      "http://www.w3.org/2001/XMLSchema#unsignedByte",
      "http://www.w3.org/2001/XMLSchema#unsignedInt",
      "http://www.w3.org/2001/XMLSchema#unsignedLong",
      "http://www.w3.org/2001/XMLSchema#unsignedShort"
    ];
    TypeHandlerNumberInteger.MAX_INT = 2147483647;
    TypeHandlerNumberInteger.MIN_INT = -2147483648;
  }
});

// node_modules/rdf-literal/lib/handler/TypeHandlerString.js
var require_TypeHandlerString = __commonJS({
  "node_modules/rdf-literal/lib/handler/TypeHandlerString.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TypeHandlerString = void 0;
    var TypeHandlerString = class {
      fromRdf(literal4) {
        return literal4.value;
      }
      toRdf(value, { datatype, dataFactory }) {
        return dataFactory.literal(value, datatype);
      }
    };
    exports.TypeHandlerString = TypeHandlerString;
    TypeHandlerString.TYPES = [
      "http://www.w3.org/2001/XMLSchema#string",
      "http://www.w3.org/2001/XMLSchema#normalizedString",
      "http://www.w3.org/2001/XMLSchema#anyURI",
      "http://www.w3.org/2001/XMLSchema#base64Binary",
      "http://www.w3.org/2001/XMLSchema#language",
      "http://www.w3.org/2001/XMLSchema#Name",
      "http://www.w3.org/2001/XMLSchema#NCName",
      "http://www.w3.org/2001/XMLSchema#NMTOKEN",
      "http://www.w3.org/2001/XMLSchema#token",
      "http://www.w3.org/2001/XMLSchema#hexBinary",
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString",
      "http://www.w3.org/2001/XMLSchema#time",
      "http://www.w3.org/2001/XMLSchema#duration"
    ];
  }
});

// node_modules/rdf-literal/lib/handler/index.js
var require_handler = __commonJS({
  "node_modules/rdf-literal/lib/handler/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o6, m3, k4, k22) {
      if (k22 === void 0) k22 = k4;
      var desc = Object.getOwnPropertyDescriptor(m3, k4);
      if (!desc || ("get" in desc ? !m3.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m3[k4];
        } };
      }
      Object.defineProperty(o6, k22, desc);
    }) : (function(o6, m3, k4, k22) {
      if (k22 === void 0) k22 = k4;
      o6[k22] = m3[k4];
    }));
    var __exportStar = exports && exports.__exportStar || function(m3, exports2) {
      for (var p4 in m3) if (p4 !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p4)) __createBinding(exports2, m3, p4);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_TypeHandlerBoolean(), exports);
    __exportStar(require_TypeHandlerDate(), exports);
    __exportStar(require_TypeHandlerNumberDouble(), exports);
    __exportStar(require_TypeHandlerNumberInteger(), exports);
    __exportStar(require_TypeHandlerString(), exports);
  }
});

// node_modules/rdf-literal/lib/ITypeHandler.js
var require_ITypeHandler = __commonJS({
  "node_modules/rdf-literal/lib/ITypeHandler.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/rdf-literal/index.js
var require_rdf_literal = __commonJS({
  "node_modules/rdf-literal/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o6, m3, k4, k22) {
      if (k22 === void 0) k22 = k4;
      var desc = Object.getOwnPropertyDescriptor(m3, k4);
      if (!desc || ("get" in desc ? !m3.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m3[k4];
        } };
      }
      Object.defineProperty(o6, k22, desc);
    }) : (function(o6, m3, k4, k22) {
      if (k22 === void 0) k22 = k4;
      o6[k22] = m3[k4];
    }));
    var __exportStar = exports && exports.__exportStar || function(m3, exports2) {
      for (var p4 in m3) if (p4 !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p4)) __createBinding(exports2, m3, p4);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fromRdf = fromRdf5;
    exports.toRdf = toRdf;
    exports.getTermRaw = getTermRaw;
    exports.getSupportedRdfDatatypes = getSupportedRdfDatatypes;
    exports.getSupportedJavaScriptPrimitives = getSupportedJavaScriptPrimitives;
    var rdf_data_factory_1 = require_rdf_data_factory();
    var handler_1 = require_handler();
    var Translator_1 = require_Translator();
    __exportStar(require_handler(), exports);
    __exportStar(require_ITypeHandler(), exports);
    __exportStar(require_Translator(), exports);
    var DF = new rdf_data_factory_1.DataFactory();
    var translator = new Translator_1.Translator();
    translator.registerHandler(new handler_1.TypeHandlerString(), handler_1.TypeHandlerString.TYPES.map((t5) => DF.namedNode(t5)), ["string"]);
    translator.registerHandler(new handler_1.TypeHandlerBoolean(), [handler_1.TypeHandlerBoolean.TYPE].map((t5) => DF.namedNode(t5)), ["boolean"]);
    translator.registerHandler(new handler_1.TypeHandlerNumberDouble(), handler_1.TypeHandlerNumberDouble.TYPES.map((t5) => DF.namedNode(t5)), ["number"]);
    translator.registerHandler(new handler_1.TypeHandlerNumberInteger(), handler_1.TypeHandlerNumberInteger.TYPES.map((t5) => DF.namedNode(t5)), ["number"]);
    translator.registerHandler(new handler_1.TypeHandlerDate(), handler_1.TypeHandlerDate.TYPES.map((t5) => DF.namedNode(t5)), ["object"]);
    function fromRdf5(literal4, validate) {
      return translator.fromRdf(literal4, validate);
    }
    function toRdf(value, options) {
      if (options && "namedNode" in options) {
        options = { dataFactory: options };
      }
      options = options || {};
      if (options && !options.dataFactory) {
        options.dataFactory = DF;
      }
      return translator.toRdf(value, options);
    }
    function getTermRaw(term, validate) {
      if (term.termType === "Literal") {
        return fromRdf5(term, validate);
      }
      return term.value;
    }
    function getSupportedRdfDatatypes() {
      return translator.getSupportedRdfDatatypes();
    }
    function getSupportedJavaScriptPrimitives() {
      return translator.getSupportedJavaScriptPrimitives();
    }
  }
});

// node_modules/n3/src/N3Lexer.js
var import_buffer = __toESM(require_buffer());

// node_modules/n3/src/IRIs.js
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
    langString: `${RDF}langString`
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

// node_modules/n3/src/N3Lexer.js
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
var lineModeRegExps = {
  _iri: true,
  _unescapedIri: true,
  _simpleQuotedString: true,
  _langcode: true,
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
    this._langcode = /^@([a-z]+(?:-[a-z0-9]+)*)(?=[^a-z0-9\-])/i;
    this._prefix = /^((?:[A-Za-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:\.?[\-0-9A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)?:(?=[#\s<])/;
    this._prefixed = /^((?:[A-Za-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:\.?[\-0-9A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)?:((?:(?:[0-:A-Z_a-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff]|%[0-9a-fA-F]{2}|\\[!#-\/;=?\-@_~])(?:(?:[\.\-0-:A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff]|%[0-9a-fA-F]{2}|\\[!#-\/;=?\-@_~])*(?:[\-0-:A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff]|%[0-9a-fA-F]{2}|\\[!#-\/;=?\-@_~]))?)?)(?:[ \t]+|(?=\.?[,;!\^\s#()\[\]\{\}"'<>]))/;
    this._variable = /^\?(?:(?:[A-Z_a-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:[\-0-:A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)(?=[.,;!\^\s#()\[\]\{\}"'<>])/;
    this._blank = /^_:((?:[0-9A-Z_a-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:\.?[\-0-9A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)(?:[ \t]+|(?=\.?[,;:\s#()\[\]\{\}"'<>]))/;
    this._number = /^[\-+]?(?:(\d+\.\d*|\.?\d+)[eE][\-+]?|\d*(\.)?)\d+(?=\.?[,;:\s#()\[\]\{\}"'<>])/;
    this._boolean = /^(?:true|false)(?=[.,;\s#()\[\]\{\}"'<>])/;
    this._keyword = /^@[a-z]+(?=[\s#<:])/i;
    this._sparqlKeyword = /^(?:PREFIX|BASE|GRAPH)(?=[\s#<])/i;
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
          } else if (input.length > 1 && input[1] === "<")
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
          if (this._previousMarker === "literal" && (match = this._langcode.exec(input)))
            type = "langcode", value = match[1];
          else if (match = this._keyword.exec(input))
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
          if (match = this._sparqlKeyword.exec(input))
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
        case ",":
        case ";":
        case "[":
        case "]":
        case "(":
        case ")":
        case "}":
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
      const token2 = emitToken(type, value, prefix, line, length);
      this.previousToken = token2;
      this._previousMarker = type;
      input = input.substr(length, input.length);
    }
    function emitToken(type, value, prefix, line, length) {
      const start = input ? currentLineLength - input.length : currentLineLength;
      const end = start + length;
      const token2 = { type, value, prefix, line, start, end };
      callback(null, token2);
      return token2;
    }
    function reportSyntaxError(self2) {
      callback(self2._syntaxError(/^\S*/.exec(input)[0]));
    }
  }
  // ### `_unescape` replaces N3 escape codes by their corresponding characters
  _unescape(item) {
    let invalid = false;
    const replaced = item.replace(escapeSequence, (sequence, unicode4, unicode8, escapedChar) => {
      if (typeof unicode4 === "string")
        return String.fromCharCode(Number.parseInt(unicode4, 16));
      if (typeof unicode8 === "string") {
        let charCode = Number.parseInt(unicode8, 16);
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
        this._tokenizeToEnd((e6, t5) => e6 ? error = e6 : tokens.push(t5), true);
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

// node_modules/n3/src/N3DataFactory.js
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
    return atPos < id.length && id[atPos++] === "@" ? id.substr(atPos).toLowerCase() : "";
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
      // If "@" follows, return rdf:langString; xsd:string otherwise
      char !== "@" ? xsd2.string : rdf.langString
    );
  }
  // ### Returns whether this object represents the same term as the other
  equals(other) {
    if (other instanceof _Literal)
      return this.id === other.id;
    return !!other && !!other.datatype && this.termType === other.termType && this.value === other.value && this.language === other.language && this.datatype.value === other.datatype.value;
  }
  toJSON() {
    return {
      termType: this.termType,
      value: this.value,
      language: this.language,
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
function termFromId(id, factory2, nested) {
  factory2 = factory2 || DataFactory;
  if (!id)
    return factory2.defaultGraph();
  switch (id[0]) {
    case "?":
      return factory2.variable(id.substr(1));
    case "_":
      return factory2.blankNode(id.substr(2));
    case '"':
      if (factory2 === DataFactory)
        return new Literal(id);
      if (id[id.length - 1] === '"')
        return factory2.literal(id.substr(1, id.length - 2));
      const endPos = id.lastIndexOf('"', id.length - 1);
      return factory2.literal(
        id.substr(1, endPos - 1),
        id[endPos + 1] === "@" ? id.substr(endPos + 2) : factory2.namedNode(id.substr(endPos + 3))
      );
    case "[":
      id = JSON.parse(id);
      break;
    default:
      if (!nested || !Array.isArray(id)) {
        return factory2.namedNode(id);
      }
  }
  return factory2.quad(
    termFromId(id[0], factory2, true),
    termFromId(id[1], factory2, true),
    termFromId(id[2], factory2, true),
    id[3] && termFromId(id[3], factory2, true)
  );
}
function termToId(term, nested) {
  if (typeof term === "string")
    return term;
  if (term instanceof Term && term.termType !== "Quad")
    return term.id;
  if (!term)
    return DEFAULTGRAPH.id;
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
      return `"${term.value}"${term.language ? `@${term.language}` : term.datatype && term.datatype.value !== xsd2.string ? `^^${term.datatype.value}` : ""}`;
    case "Quad":
      const res = [
        termToId(term.subject, true),
        termToId(term.predicate, true),
        termToId(term.object, true)
      ];
      if (term.graph && term.graph.termType !== "DefaultGraph") {
        res.push(termToId(term.graph, true));
      }
      return nested ? res : JSON.stringify(res);
    default:
      throw new Error(`Unexpected termType: ${term.termType}`);
  }
}
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

// node_modules/n3/src/N3Parser.js
var blankNodePrefix = 0;
var N3Parser = class {
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
    this._supportsRDFStar = format === "" || /star|\*$/.test(format);
    if (isLineMode)
      this._resolveRelativeIRI = (iri) => {
        return null;
      };
    this._blankNodePrefix = typeof options.blankNodePrefix !== "string" ? "" : options.blankNodePrefix.replace(/^(?!_:)/, "_:");
    this._lexer = options.lexer || new N3Lexer({ lineMode: isLineMode, n3: isN3, isImpliedBy: this._isImpliedBy });
    this._explicitQuantifiers = !!options.explicitQuantifiers;
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
  _restoreContext(type, token2) {
    const context = this._contextStack.pop();
    if (!context || context.type !== type)
      return this._error(`Unexpected ${token2.type}`, token2);
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
  // ### `_readInTopContext` reads a token when in the top context
  _readInTopContext(token2) {
    switch (token2.type) {
      // If an EOF token arrives in the top context, signal that we're done
      case "eof":
        if (this._graph !== null)
          return this._error("Unclosed graph", token2);
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
        return this._readSubject(token2);
    }
  }
  // ### `_readEntity` reads an IRI, prefixed name, blank node, or variable
  _readEntity(token2, quantifier) {
    let value;
    switch (token2.type) {
      // Read a relative or absolute IRI
      case "IRI":
      case "typeIRI":
        const iri = this._resolveIRI(token2.value);
        if (iri === null)
          return this._error("Invalid IRI", token2);
        value = this._factory.namedNode(iri);
        break;
      // Read a prefixed name
      case "type":
      case "prefixed":
        const prefix = this._prefixes[token2.prefix];
        if (prefix === void 0)
          return this._error(`Undefined prefix "${token2.prefix}:"`, token2);
        value = this._factory.namedNode(prefix + token2.value);
        break;
      // Read a blank node
      case "blank":
        value = this._factory.blankNode(this._prefixes[token2.prefix] + token2.value);
        break;
      // Read a variable
      case "var":
        value = this._factory.variable(token2.value.substr(1));
        break;
      // Everything else is not an entity
      default:
        return this._error(`Expected entity but got ${token2.type}`, token2);
    }
    if (!quantifier && this._n3Mode && value.id in this._quantified)
      value = this._quantified[value.id];
    return value;
  }
  // ### `_readSubject` reads a quad's subject
  _readSubject(token2) {
    this._predicate = null;
    switch (token2.type) {
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
        this._saveContext("list", this._graph, this.RDF_NIL, null, null);
        this._subject = null;
        return this._readListItem;
      case "{":
        if (!this._n3Mode)
          return this._error("Unexpected graph", token2);
        this._saveContext(
          "formula",
          this._graph,
          this._graph = this._factory.blankNode(),
          null,
          null
        );
        return this._readSubject;
      case "}":
        return this._readPunctuation(token2);
      case "@forSome":
        if (!this._n3Mode)
          return this._error('Unexpected "@forSome"', token2);
        this._subject = null;
        this._predicate = this.N3_FORSOME;
        this._quantifier = "blankNode";
        return this._readQuantifierList;
      case "@forAll":
        if (!this._n3Mode)
          return this._error('Unexpected "@forAll"', token2);
        this._subject = null;
        this._predicate = this.N3_FORALL;
        this._quantifier = "variable";
        return this._readQuantifierList;
      case "literal":
        if (!this._n3Mode)
          return this._error("Unexpected literal", token2);
        if (token2.prefix.length === 0) {
          this._literalValue = token2.value;
          return this._completeSubjectLiteral;
        } else
          this._subject = this._factory.literal(token2.value, this._factory.namedNode(token2.prefix));
        break;
      case "<<":
        if (!this._supportsRDFStar)
          return this._error("Unexpected RDF-star syntax", token2);
        this._saveContext("<<", this._graph, null, null, null);
        this._graph = null;
        return this._readSubject;
      default:
        if ((this._subject = this._readEntity(token2)) === void 0)
          return;
        if (this._n3Mode)
          return this._getPathReader(this._readPredicateOrNamedGraph);
    }
    return this._readPredicateOrNamedGraph;
  }
  // ### `_readPredicate` reads a quad's predicate
  _readPredicate(token2) {
    const type = token2.type;
    switch (type) {
      case "inverse":
        this._inversePredicate = true;
      case "abbreviation":
        this._predicate = this.ABBREVIATIONS[token2.value];
        break;
      case ".":
      case "]":
      case "}":
        if (this._predicate === null)
          return this._error(`Unexpected ${type}`, token2);
        this._subject = null;
        return type === "]" ? this._readBlankNodeTail(token2) : this._readPunctuation(token2);
      case ";":
        return this._predicate !== null ? this._readPredicate : this._error("Expected predicate but got ;", token2);
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
          return this._error("Disallowed blank node as predicate", token2);
      default:
        if ((this._predicate = this._readEntity(token2)) === void 0)
          return;
    }
    return this._readObject;
  }
  // ### `_readObject` reads a quad's object
  _readObject(token2) {
    switch (token2.type) {
      case "literal":
        if (token2.prefix.length === 0) {
          this._literalValue = token2.value;
          return this._readDataTypeOrLang;
        } else
          this._object = this._factory.literal(token2.value, this._factory.namedNode(token2.prefix));
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
        this._saveContext("list", this._graph, this._subject, this._predicate, this.RDF_NIL);
        this._subject = null;
        return this._readListItem;
      case "{":
        if (!this._n3Mode)
          return this._error("Unexpected graph", token2);
        this._saveContext(
          "formula",
          this._graph,
          this._subject,
          this._predicate,
          this._graph = this._factory.blankNode()
        );
        return this._readSubject;
      case "<<":
        if (!this._supportsRDFStar)
          return this._error("Unexpected RDF-star syntax", token2);
        this._saveContext("<<", this._graph, this._subject, this._predicate, null);
        this._graph = null;
        return this._readSubject;
      default:
        if ((this._object = this._readEntity(token2)) === void 0)
          return;
        if (this._n3Mode)
          return this._getPathReader(this._getContextEndReader());
    }
    return this._getContextEndReader();
  }
  // ### `_readPredicateOrNamedGraph` reads a quad's predicate, or a named graph
  _readPredicateOrNamedGraph(token2) {
    return token2.type === "{" ? this._readGraph(token2) : this._readPredicate(token2);
  }
  // ### `_readGraph` reads a graph
  _readGraph(token2) {
    if (token2.type !== "{")
      return this._error(`Expected graph but got ${token2.type}`, token2);
    this._graph = this._subject, this._subject = null;
    return this._readSubject;
  }
  // ### `_readBlankNodeHead` reads the head of a blank node
  _readBlankNodeHead(token2) {
    if (token2.type === "]") {
      this._subject = null;
      return this._readBlankNodeTail(token2);
    } else {
      this._predicate = null;
      return this._readPredicate(token2);
    }
  }
  // ### `_readBlankNodeTail` reads the end of a blank node
  _readBlankNodeTail(token2) {
    if (token2.type !== "]")
      return this._readBlankNodePunctuation(token2);
    if (this._subject !== null)
      this._emit(this._subject, this._predicate, this._object, this._graph);
    const empty = this._predicate === null;
    this._restoreContext("blank", token2);
    if (this._object !== null)
      return this._getContextEndReader();
    else if (this._predicate !== null)
      return this._readObject;
    else
      return empty ? this._readPredicateOrNamedGraph : this._readPredicateAfterBlank;
  }
  // ### `_readPredicateAfterBlank` reads a predicate after an anonymous blank node
  _readPredicateAfterBlank(token2) {
    switch (token2.type) {
      case ".":
      case "}":
        this._subject = null;
        return this._readPunctuation(token2);
      default:
        return this._readPredicate(token2);
    }
  }
  // ### `_readListItem` reads items from a list
  _readListItem(token2) {
    let item = null, list = null, next = this._readListItem;
    const previousList = this._subject, stack = this._contextStack, parent = stack[stack.length - 1];
    switch (token2.type) {
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
        this._restoreContext("list", token2);
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
        if (token2.prefix.length === 0) {
          this._literalValue = token2.value;
          next = this._readListItemDataTypeOrLang;
        } else {
          item = this._factory.literal(token2.value, this._factory.namedNode(token2.prefix));
          next = this._getContextEndReader();
        }
        break;
      case "{":
        if (!this._n3Mode)
          return this._error("Unexpected graph", token2);
        this._saveContext(
          "formula",
          this._graph,
          this._subject,
          this._predicate,
          this._graph = this._factory.blankNode()
        );
        return this._readSubject;
      default:
        if ((item = this._readEntity(token2)) === void 0)
          return;
    }
    if (list === null)
      this._subject = list = this._factory.blankNode();
    if (previousList === null) {
      if (parent.predicate === null)
        parent.subject = list;
      else
        parent.object = list;
    } else {
      this._emit(previousList, this.RDF_REST, list, this._graph);
    }
    if (item !== null) {
      if (this._n3Mode && (token2.type === "IRI" || token2.type === "prefixed")) {
        this._saveContext("item", this._graph, list, this.RDF_FIRST, item);
        this._subject = item, this._predicate = null;
        return this._getPathReader(this._readListItem);
      }
      this._emit(list, this.RDF_FIRST, item, this._graph);
    }
    return next;
  }
  // ### `_readDataTypeOrLang` reads an _optional_ datatype or language
  _readDataTypeOrLang(token2) {
    return this._completeObjectLiteral(token2, false);
  }
  // ### `_readListItemDataTypeOrLang` reads an _optional_ datatype or language in a list
  _readListItemDataTypeOrLang(token2) {
    return this._completeObjectLiteral(token2, true);
  }
  // ### `_completeLiteral` completes a literal with an optional datatype or language
  _completeLiteral(token2) {
    let literal4 = this._factory.literal(this._literalValue);
    switch (token2.type) {
      // Create a datatyped literal
      case "type":
      case "typeIRI":
        const datatype = this._readEntity(token2);
        if (datatype === void 0) return;
        literal4 = this._factory.literal(this._literalValue, datatype);
        token2 = null;
        break;
      // Create a language-tagged string
      case "langcode":
        literal4 = this._factory.literal(this._literalValue, token2.value);
        token2 = null;
        break;
    }
    return { token: token2, literal: literal4 };
  }
  // Completes a literal in subject position
  _completeSubjectLiteral(token2) {
    this._subject = this._completeLiteral(token2).literal;
    return this._readPredicateOrNamedGraph;
  }
  // Completes a literal in object position
  _completeObjectLiteral(token2, listItem) {
    const completed = this._completeLiteral(token2);
    if (!completed)
      return;
    this._object = completed.literal;
    if (listItem)
      this._emit(this._subject, this.RDF_FIRST, this._object, this._graph);
    if (completed.token === null)
      return this._getContextEndReader();
    else {
      this._readCallback = this._getContextEndReader();
      return this._readCallback(completed.token);
    }
  }
  // ### `_readFormulaTail` reads the end of a formula
  _readFormulaTail(token2) {
    if (token2.type !== "}")
      return this._readPunctuation(token2);
    if (this._subject !== null)
      this._emit(this._subject, this._predicate, this._object, this._graph);
    this._restoreContext("formula", token2);
    return this._object === null ? this._readPredicate : this._getContextEndReader();
  }
  // ### `_readPunctuation` reads punctuation between quads or quad parts
  _readPunctuation(token2) {
    let next, graph = this._graph;
    const subject = this._subject, inversePredicate = this._inversePredicate;
    switch (token2.type) {
      // A closing brace ends a graph
      case "}":
        if (this._graph === null)
          return this._error("Unexpected graph closing", token2);
        if (this._n3Mode)
          return this._readFormulaTail(token2);
        this._graph = null;
      // A dot just ends the statement, without sharing anything with the next
      case ".":
        this._subject = null;
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
      // {| means that the current triple is annotated with predicate-object pairs.
      case "{|":
        if (!this._supportsRDFStar)
          return this._error("Unexpected RDF-star syntax", token2);
        const predicate = this._predicate, object = this._object;
        this._subject = this._factory.quad(subject, predicate, object, this.DEFAULTGRAPH);
        next = this._readPredicate;
        break;
      // |} means that the current quoted triple in annotation syntax is finalized.
      case "|}":
        if (this._subject.termType !== "Quad")
          return this._error("Unexpected asserted triple closing", token2);
        this._subject = null;
        next = this._readPunctuation;
        break;
      default:
        if (this._supportsQuads && this._graph === null && (graph = this._readEntity(token2)) !== void 0) {
          next = this._readQuadPunctuation;
          break;
        }
        return this._error(`Expected punctuation to follow "${this._object.id}"`, token2);
    }
    if (subject !== null) {
      const predicate = this._predicate, object = this._object;
      if (!inversePredicate)
        this._emit(subject, predicate, object, graph);
      else
        this._emit(object, predicate, subject, graph);
    }
    return next;
  }
  // ### `_readBlankNodePunctuation` reads punctuation in a blank node
  _readBlankNodePunctuation(token2) {
    let next;
    switch (token2.type) {
      // Semicolon means the subject is shared; predicate and object are different
      case ";":
        next = this._readPredicate;
        break;
      // Comma means both the subject and predicate are shared; the object is different
      case ",":
        next = this._readObject;
        break;
      default:
        return this._error(`Expected punctuation to follow "${this._object.id}"`, token2);
    }
    this._emit(this._subject, this._predicate, this._object, this._graph);
    return next;
  }
  // ### `_readQuadPunctuation` reads punctuation after a quad
  _readQuadPunctuation(token2) {
    if (token2.type !== ".")
      return this._error("Expected dot to follow quad", token2);
    return this._readInTopContext;
  }
  // ### `_readPrefix` reads the prefix of a prefix declaration
  _readPrefix(token2) {
    if (token2.type !== "prefix")
      return this._error("Expected prefix to follow @prefix", token2);
    this._prefix = token2.value;
    return this._readPrefixIRI;
  }
  // ### `_readPrefixIRI` reads the IRI of a prefix declaration
  _readPrefixIRI(token2) {
    if (token2.type !== "IRI")
      return this._error(`Expected IRI to follow prefix "${this._prefix}:"`, token2);
    const prefixNode = this._readEntity(token2);
    this._prefixes[this._prefix] = prefixNode.value;
    this._prefixCallback(this._prefix, prefixNode);
    return this._readDeclarationPunctuation;
  }
  // ### `_readBaseIRI` reads the IRI of a base declaration
  _readBaseIRI(token2) {
    const iri = token2.type === "IRI" && this._resolveIRI(token2.value);
    if (!iri)
      return this._error("Expected valid IRI to follow base declaration", token2);
    this._setBase(iri);
    return this._readDeclarationPunctuation;
  }
  // ### `_readNamedGraphLabel` reads the label of a named graph
  _readNamedGraphLabel(token2) {
    switch (token2.type) {
      case "IRI":
      case "blank":
      case "prefixed":
        return this._readSubject(token2), this._readGraph;
      case "[":
        return this._readNamedGraphBlankLabel;
      default:
        return this._error("Invalid graph label", token2);
    }
  }
  // ### `_readNamedGraphLabel` reads a blank node label of a named graph
  _readNamedGraphBlankLabel(token2) {
    if (token2.type !== "]")
      return this._error("Invalid graph label", token2);
    this._subject = this._factory.blankNode();
    return this._readGraph;
  }
  // ### `_readDeclarationPunctuation` reads the punctuation of a declaration
  _readDeclarationPunctuation(token2) {
    if (this._sparqlStyle) {
      this._sparqlStyle = false;
      return this._readInTopContext(token2);
    }
    if (token2.type !== ".")
      return this._error("Expected declaration to end with a dot", token2);
    return this._readInTopContext;
  }
  // Reads a list of quantified symbols from a @forSome or @forAll statement
  _readQuantifierList(token2) {
    let entity;
    switch (token2.type) {
      case "IRI":
      case "prefixed":
        if ((entity = this._readEntity(token2, true)) !== void 0)
          break;
      default:
        return this._error(`Unexpected ${token2.type}`, token2);
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
  _readQuantifierPunctuation(token2) {
    if (token2.type === ",")
      return this._readQuantifierList;
    else {
      if (this._explicitQuantifiers) {
        this._emit(this._subject, this.RDF_REST, this.RDF_NIL, this.QUANTIFIERS_GRAPH);
        this._subject = null;
      }
      this._readCallback = this._getContextEndReader();
      return this._readCallback(token2);
    }
  }
  // ### `_getPathReader` reads a potential path and then resumes with the given function
  _getPathReader(afterPath) {
    this._afterPath = afterPath;
    return this._readPath;
  }
  // ### `_readPath` reads a potential path
  _readPath(token2) {
    switch (token2.type) {
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
          this._restoreContext("item", token2);
          this._emit(this._subject, this.RDF_FIRST, item, this._graph);
        }
        return this._afterPath(token2);
    }
  }
  // ### `_readForwardPath` reads a '!' path
  _readForwardPath(token2) {
    let subject, predicate;
    const object = this._factory.blankNode();
    if ((predicate = this._readEntity(token2)) === void 0)
      return;
    if (this._predicate === null)
      subject = this._subject, this._subject = object;
    else
      subject = this._object, this._object = object;
    this._emit(subject, predicate, object, this._graph);
    return this._readPath;
  }
  // ### `_readBackwardPath` reads a '^' path
  _readBackwardPath(token2) {
    const subject = this._factory.blankNode();
    let predicate, object;
    if ((predicate = this._readEntity(token2)) === void 0)
      return;
    if (this._predicate === null)
      object = this._subject, this._subject = subject;
    else
      object = this._object, this._object = subject;
    this._emit(subject, predicate, object, this._graph);
    return this._readPath;
  }
  // ### `_readRDFStarTailOrGraph` reads the graph of a nested RDF-star quad or the end of a nested RDF-star triple
  _readRDFStarTailOrGraph(token2) {
    if (token2.type !== ">>") {
      if (this._supportsQuads && this._graph === null && (this._graph = this._readEntity(token2)) !== void 0)
        return this._readRDFStarTail;
      return this._error(`Expected >> to follow "${this._object.id}"`, token2);
    }
    return this._readRDFStarTail(token2);
  }
  // ### `_readRDFStarTail` reads the end of a nested RDF-star triple
  _readRDFStarTail(token2) {
    if (token2.type !== ">>")
      return this._error(`Expected >> but got ${token2.type}`, token2);
    const quad4 = this._factory.quad(
      this._subject,
      this._predicate,
      this._object,
      this._graph || this.DEFAULTGRAPH
    );
    this._restoreContext("<<", token2);
    if (this._subject === null) {
      this._subject = quad4;
      return this._readPredicate;
    } else {
      this._object = quad4;
      return this._getContextEndReader();
    }
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
      case "<<":
        return this._readRDFStarTailOrGraph;
    }
  }
  // ### `_emit` sends a quad through the callback
  _emit(subject, predicate, object, graph) {
    this._callback(null, this._factory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH));
  }
  // ### `_error` emits an error message through the callback
  _error(message, token2) {
    const err = new Error(`${message} on line ${token2.line}.`);
    err.context = {
      token: token2,
      line: token2.line,
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
    let result = "", i5 = -1, pathStart = -1, segmentStart = 0, next = "/";
    while (i5 < length) {
      switch (next) {
        // The path starts with the first slash after the authority
        case ":":
          if (pathStart < 0) {
            if (iri[++i5] === "/" && iri[++i5] === "/")
              while ((pathStart = i5 + 1) < length && iri[pathStart] !== "/")
                i5 = pathStart;
          }
          break;
        // Don't modify a query string or fragment
        case "?":
        case "#":
          i5 = length;
          break;
        // Handle '/.' or '/..' path segments
        case "/":
          if (iri[i5 + 1] === ".") {
            next = iri[++i5 + 1];
            switch (next) {
              // Remove a '/.' segment
              case "/":
                result += iri.substring(segmentStart, i5 - 1);
                segmentStart = i5 + 1;
                break;
              // Remove a trailing '/.' segment
              case void 0:
              case "?":
              case "#":
                return result + iri.substring(segmentStart, i5) + iri.substr(i5 + 1);
              // Remove a '/..' segment
              case ".":
                next = iri[++i5 + 1];
                if (next === void 0 || next === "/" || next === "?" || next === "#") {
                  result += iri.substring(segmentStart, i5 - 2);
                  if ((segmentStart = result.lastIndexOf("/")) >= pathStart)
                    result = result.substr(0, segmentStart);
                  if (next !== "/")
                    return `${result}/${iri.substr(i5 + 1)}`;
                  segmentStart = i5 + 1;
                }
            }
          }
      }
      next = iri[++i5];
    }
    return result + iri.substring(segmentStart);
  }
  // ## Public methods
  // ### `parse` parses the N3 input and emits each parsed quad through the onQuad callback.
  parse(input, quadCallback, prefixCallback) {
    let onQuad, onPrefix, onComment;
    if (quadCallback && (quadCallback.onQuad || quadCallback.onPrefix || quadCallback.onComment)) {
      onQuad = quadCallback.onQuad;
      onPrefix = quadCallback.onPrefix;
      onComment = quadCallback.onComment;
    } else {
      onQuad = quadCallback;
      onPrefix = prefixCallback;
    }
    this._readCallback = this._readInTopContext;
    this._sparqlStyle = false;
    this._prefixes = /* @__PURE__ */ Object.create(null);
    this._prefixes._ = this._blankNodePrefix ? this._blankNodePrefix.substr(2) : `b${blankNodePrefix++}_`;
    this._prefixCallback = onPrefix || noop;
    this._inversePredicate = false;
    this._quantified = /* @__PURE__ */ Object.create(null);
    if (!onQuad) {
      const quads = [];
      let error;
      this._callback = (e6, t5) => {
        e6 ? error = e6 : t5 && quads.push(t5);
      };
      this._lexer.tokenize(input).every((token2) => {
        return this._readCallback = this._readCallback(token2);
      });
      if (error) throw error;
      return quads;
    }
    let processNextToken = (error, token2) => {
      if (error !== null)
        this._callback(error), this._callback = noop;
      else if (this._readCallback)
        this._readCallback = this._readCallback(token2);
    };
    if (onComment) {
      this._lexer.comments = true;
      processNextToken = (error, token2) => {
        if (error !== null)
          this._callback(error), this._callback = noop;
        else if (this._readCallback) {
          if (token2.type === "comment")
            onComment(token2.value);
          else
            this._readCallback = this._readCallback(token2);
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
initDataFactory(N3Parser.prototype, N3DataFactory_default);

// node_modules/n3/src/N3Util.js
function isDefaultGraph(term) {
  return !!term && term.termType === "DefaultGraph";
}

// node_modules/n3/src/Util.js
function escapeRegex(regex) {
  return regex.replace(/[\]\/\(\)\*\+\?\.\\\$]/g, "\\$&");
}

// node_modules/n3/src/BaseIRI.js
var BASE_UNSUPPORTED = /^:?[^:?#]*(?:[?#]|$)|^file:|^[^:]*:\/*[^?#]+?\/(?:\.\.?(?:\/|$)|\/)/i;
var SUFFIX_SUPPORTED = /^(?:(?:[^/?#]{3,}|\.?[^/?#.]\.?)(?:\/[^/?#]{3,}|\.?[^/?#.]\.?)*\/?)?(?:[?#]|$)/;
var CURRENT = "./";
var PARENT = "../";
var QUERY = "?";
var FRAGMENT = "#";
var BaseIRI = class _BaseIRI {
  constructor(base) {
    this.base = base;
    this._baseLength = 0;
    this._baseMatcher = null;
    this._pathReplacements = new Array(base.length + 1);
  }
  static supports(base) {
    return !BASE_UNSUPPORTED.test(base);
  }
  _getBaseMatcher() {
    if (this._baseMatcher)
      return this._baseMatcher;
    if (!_BaseIRI.supports(this.base))
      return this._baseMatcher = /.^/;
    const scheme = /^[^:]*:\/*/.exec(this.base)[0];
    const regexHead = ["^", escapeRegex(scheme)];
    const regexTail = [];
    const segments = [], segmenter = /[^/?#]*([/?#])/y;
    let segment, query = 0, fragment = 0, last = segmenter.lastIndex = scheme.length;
    while (!query && !fragment && (segment = segmenter.exec(this.base))) {
      if (segment[1] === FRAGMENT)
        fragment = segmenter.lastIndex - 1;
      else {
        regexHead.push(escapeRegex(segment[0]), "(?:");
        regexTail.push(")?");
        if (segment[1] !== QUERY)
          segments.push(last = segmenter.lastIndex);
        else {
          query = last = segmenter.lastIndex;
          fragment = this.base.indexOf(FRAGMENT, query);
          this._pathReplacements[query] = QUERY;
        }
      }
    }
    for (let i5 = 0; i5 < segments.length; i5++)
      this._pathReplacements[segments[i5]] = PARENT.repeat(segments.length - i5 - 1);
    this._pathReplacements[segments[segments.length - 1]] = CURRENT;
    this._baseLength = fragment > 0 ? fragment : this.base.length;
    regexHead.push(
      escapeRegex(this.base.substring(last, this._baseLength)),
      query ? "(?:#|$)" : "(?:[?#]|$)"
    );
    return this._baseMatcher = new RegExp([...regexHead, ...regexTail].join(""));
  }
  toRelative(iri) {
    const match = this._getBaseMatcher().exec(iri);
    if (!match)
      return iri;
    const length = match[0].length;
    if (length === this._baseLength && length === iri.length)
      return "";
    const parentPath = this._pathReplacements[length];
    if (parentPath) {
      const suffix = iri.substring(length);
      if (parentPath !== QUERY && !SUFFIX_SUPPORTED.test(suffix))
        return iri;
      if (parentPath === CURRENT && /^[^?#]/.test(suffix))
        return suffix;
      return parentPath + suffix;
    }
    return iri.substring(length - 1);
  }
};

// node_modules/n3/src/N3Writer.js
var DEFAULTGRAPH2 = N3DataFactory_default.defaultGraph();
var { rdf: rdf2, xsd: xsd3 } = IRIs_default;
var escape = /["\\\t\n\r\b\f\u0000-\u0019\ud800-\udbff]/;
var escapeAll = /["\\\t\n\r\b\f\u0000-\u0019]|[\ud800-\udbff][\udc00-\udfff]/g;
var escapedCharacters = {
  "\\": "\\\\",
  '"': '\\"',
  "	": "\\t",
  "\n": "\\n",
  "\r": "\\r",
  "\b": "\\b",
  "\f": "\\f"
};
var SerializedTerm = class extends Term {
  // Pretty-printed nodes are not equal to any other node
  // (e.g., [] does not equal [])
  equals(other) {
    return other === this;
  }
};
var N3Writer = class {
  constructor(outputStream, options) {
    this._prefixRegex = /$0^/;
    if (outputStream && typeof outputStream.write !== "function")
      options = outputStream, outputStream = null;
    options = options || {};
    this._lists = options.lists;
    if (!outputStream) {
      let output = "";
      this._outputStream = {
        write(chunk, encoding, done) {
          output += chunk;
          done && done();
        },
        end: (done) => {
          done && done(null, output);
        }
      };
      this._endStream = true;
    } else {
      this._outputStream = outputStream;
      this._endStream = options.end === void 0 ? true : !!options.end;
    }
    this._subject = null;
    if (!/triple|quad/i.test(options.format)) {
      this._lineMode = false;
      this._graph = DEFAULTGRAPH2;
      this._prefixIRIs = /* @__PURE__ */ Object.create(null);
      options.prefixes && this.addPrefixes(options.prefixes);
      if (options.baseIRI) {
        this._baseIri = new BaseIRI(options.baseIRI);
      }
    } else {
      this._lineMode = true;
      this._writeQuad = this._writeQuadLine;
    }
  }
  // ## Private methods
  // ### Whether the current graph is the default graph
  get _inDefaultGraph() {
    return DEFAULTGRAPH2.equals(this._graph);
  }
  // ### `_write` writes the argument to the output stream
  _write(string2, callback) {
    this._outputStream.write(string2, "utf8", callback);
  }
  // ### `_writeQuad` writes the quad to the output stream
  _writeQuad(subject, predicate, object, graph, done) {
    try {
      if (!graph.equals(this._graph)) {
        this._write((this._subject === null ? "" : this._inDefaultGraph ? ".\n" : "\n}\n") + (DEFAULTGRAPH2.equals(graph) ? "" : `${this._encodeIriOrBlank(graph)} {
`));
        this._graph = graph;
        this._subject = null;
      }
      if (subject.equals(this._subject)) {
        if (predicate.equals(this._predicate))
          this._write(`, ${this._encodeObject(object)}`, done);
        else
          this._write(`;
    ${this._encodePredicate(this._predicate = predicate)} ${this._encodeObject(object)}`, done);
      } else
        this._write(`${(this._subject === null ? "" : ".\n") + this._encodeSubject(this._subject = subject)} ${this._encodePredicate(this._predicate = predicate)} ${this._encodeObject(object)}`, done);
    } catch (error) {
      done && done(error);
    }
  }
  // ### `_writeQuadLine` writes the quad to the output stream as a single line
  _writeQuadLine(subject, predicate, object, graph, done) {
    delete this._prefixMatch;
    this._write(this.quadToString(subject, predicate, object, graph), done);
  }
  // ### `quadToString` serializes a quad as a string
  quadToString(subject, predicate, object, graph) {
    return `${this._encodeSubject(subject)} ${this._encodeIriOrBlank(predicate)} ${this._encodeObject(object)}${graph && graph.value ? ` ${this._encodeIriOrBlank(graph)} .
` : " .\n"}`;
  }
  // ### `quadsToString` serializes an array of quads as a string
  quadsToString(quads) {
    let quadsString = "";
    for (const quad4 of quads)
      quadsString += this.quadToString(quad4.subject, quad4.predicate, quad4.object, quad4.graph);
    return quadsString;
  }
  // ### `_encodeSubject` represents a subject
  _encodeSubject(entity) {
    return entity.termType === "Quad" ? this._encodeQuad(entity) : this._encodeIriOrBlank(entity);
  }
  // ### `_encodeIriOrBlank` represents an IRI or blank node
  _encodeIriOrBlank(entity) {
    if (entity.termType !== "NamedNode") {
      if (this._lists && entity.value in this._lists)
        entity = this.list(this._lists[entity.value]);
      return "id" in entity ? entity.id : `_:${entity.value}`;
    }
    let iri = entity.value;
    if (this._baseIri) {
      iri = this._baseIri.toRelative(iri);
    }
    if (escape.test(iri))
      iri = iri.replace(escapeAll, characterReplacer);
    const prefixMatch = this._prefixRegex.exec(iri);
    return !prefixMatch ? `<${iri}>` : !prefixMatch[1] ? iri : this._prefixIRIs[prefixMatch[1]] + prefixMatch[2];
  }
  // ### `_encodeLiteral` represents a literal
  _encodeLiteral(literal4) {
    let value = literal4.value;
    if (escape.test(value))
      value = value.replace(escapeAll, characterReplacer);
    if (literal4.language)
      return `"${value}"@${literal4.language}`;
    if (this._lineMode) {
      if (literal4.datatype.value === xsd3.string)
        return `"${value}"`;
    } else {
      switch (literal4.datatype.value) {
        case xsd3.string:
          return `"${value}"`;
        case xsd3.boolean:
          if (value === "true" || value === "false")
            return value;
          break;
        case xsd3.integer:
          if (/^[+-]?\d+$/.test(value))
            return value;
          break;
        case xsd3.decimal:
          if (/^[+-]?\d*\.\d+$/.test(value))
            return value;
          break;
        case xsd3.double:
          if (/^[+-]?(?:\d+\.\d*|\.?\d+)[eE][+-]?\d+$/.test(value))
            return value;
          break;
      }
    }
    return `"${value}"^^${this._encodeIriOrBlank(literal4.datatype)}`;
  }
  // ### `_encodePredicate` represents a predicate
  _encodePredicate(predicate) {
    return predicate.value === rdf2.type ? "a" : this._encodeIriOrBlank(predicate);
  }
  // ### `_encodeObject` represents an object
  _encodeObject(object) {
    switch (object.termType) {
      case "Quad":
        return this._encodeQuad(object);
      case "Literal":
        return this._encodeLiteral(object);
      default:
        return this._encodeIriOrBlank(object);
    }
  }
  // ### `_encodeQuad` encodes an RDF-star quad
  _encodeQuad({ subject, predicate, object, graph }) {
    return `<<${this._encodeSubject(subject)} ${this._encodePredicate(predicate)} ${this._encodeObject(object)}${isDefaultGraph(graph) ? "" : ` ${this._encodeIriOrBlank(graph)}`}>>`;
  }
  // ### `_blockedWrite` replaces `_write` after the writer has been closed
  _blockedWrite() {
    throw new Error("Cannot write because the writer has been closed.");
  }
  // ### `addQuad` adds the quad to the output stream
  addQuad(subject, predicate, object, graph, done) {
    if (object === void 0)
      this._writeQuad(subject.subject, subject.predicate, subject.object, subject.graph, predicate);
    else if (typeof graph === "function")
      this._writeQuad(subject, predicate, object, DEFAULTGRAPH2, graph);
    else
      this._writeQuad(subject, predicate, object, graph || DEFAULTGRAPH2, done);
  }
  // ### `addQuads` adds the quads to the output stream
  addQuads(quads) {
    for (let i5 = 0; i5 < quads.length; i5++)
      this.addQuad(quads[i5]);
  }
  // ### `addPrefix` adds the prefix to the output stream
  addPrefix(prefix, iri, done) {
    const prefixes = {};
    prefixes[prefix] = iri;
    this.addPrefixes(prefixes, done);
  }
  // ### `addPrefixes` adds the prefixes to the output stream
  addPrefixes(prefixes, done) {
    if (!this._prefixIRIs)
      return done && done();
    let hasPrefixes = false;
    for (let prefix in prefixes) {
      let iri = prefixes[prefix];
      if (typeof iri !== "string")
        iri = iri.value;
      hasPrefixes = true;
      if (this._subject !== null) {
        this._write(this._inDefaultGraph ? ".\n" : "\n}\n");
        this._subject = null, this._graph = "";
      }
      this._prefixIRIs[iri] = prefix += ":";
      this._write(`@prefix ${prefix} <${iri}>.
`);
    }
    if (hasPrefixes) {
      let IRIlist = "", prefixList = "";
      for (const prefixIRI in this._prefixIRIs) {
        IRIlist += IRIlist ? `|${prefixIRI}` : prefixIRI;
        prefixList += (prefixList ? "|" : "") + this._prefixIRIs[prefixIRI];
      }
      IRIlist = escapeRegex(IRIlist, /[\]\/\(\)\*\+\?\.\\\$]/g, "\\$&");
      this._prefixRegex = new RegExp(`^(?:${prefixList})[^/]*$|^(${IRIlist})([_a-zA-Z0-9][\\-_a-zA-Z0-9]*)$`);
    }
    this._write(hasPrefixes ? "\n" : "", done);
  }
  // ### `blank` creates a blank node with the given content
  blank(predicate, object) {
    let children = predicate, child, length;
    if (predicate === void 0)
      children = [];
    else if (predicate.termType)
      children = [{ predicate, object }];
    else if (!("length" in predicate))
      children = [predicate];
    switch (length = children.length) {
      // Generate an empty blank node
      case 0:
        return new SerializedTerm("[]");
      // Generate a non-nested one-triple blank node
      case 1:
        child = children[0];
        if (!(child.object instanceof SerializedTerm))
          return new SerializedTerm(`[ ${this._encodePredicate(child.predicate)} ${this._encodeObject(child.object)} ]`);
      // Generate a multi-triple or nested blank node
      default:
        let contents = "[";
        for (let i5 = 0; i5 < length; i5++) {
          child = children[i5];
          if (child.predicate.equals(predicate))
            contents += `, ${this._encodeObject(child.object)}`;
          else {
            contents += `${(i5 ? ";\n  " : "\n  ") + this._encodePredicate(child.predicate)} ${this._encodeObject(child.object)}`;
            predicate = child.predicate;
          }
        }
        return new SerializedTerm(`${contents}
]`);
    }
  }
  // ### `list` creates a list node with the given content
  list(elements) {
    const length = elements && elements.length || 0, contents = new Array(length);
    for (let i5 = 0; i5 < length; i5++)
      contents[i5] = this._encodeObject(elements[i5]);
    return new SerializedTerm(`(${contents.join(" ")})`);
  }
  // ### `end` signals the end of the output stream
  end(done) {
    if (this._subject !== null) {
      this._write(this._inDefaultGraph ? ".\n" : "\n}\n");
      this._subject = null;
    }
    this._write = this._blockedWrite;
    let singleDone = done && ((error, result) => {
      singleDone = null, done(error, result);
    });
    if (this._endStream) {
      try {
        return this._outputStream.end(singleDone);
      } catch (error) {
      }
    }
    singleDone && singleDone();
  }
};
function characterReplacer(character) {
  let result = escapedCharacters[character];
  if (result === void 0) {
    if (character.length === 1) {
      result = character.charCodeAt(0).toString(16);
      result = "\\u0000".substr(0, 6 - result.length) + result;
    } else {
      result = ((character.charCodeAt(0) - 55296) * 1024 + character.charCodeAt(1) + 9216).toString(16);
      result = "\\U00000000".substr(0, 10 - result.length) + result;
    }
  }
  return result;
}

// node_modules/n3/src/N3Store.js
var import_readable_stream = __toESM(require_browser());
var ITERATOR = Symbol("iter");
function merge(target, source, depth = 4) {
  if (depth === 0)
    return Object.assign(target, source);
  for (const key in source)
    target[key] = merge(target[key] || /* @__PURE__ */ Object.create(null), source[key], depth - 1);
  return target;
}
function intersect(s1, s22, depth = 4) {
  let target = false;
  for (const key in s1) {
    if (key in s22) {
      const intersection = depth === 0 ? null : intersect(s1[key], s22[key], depth - 1);
      if (intersection !== false) {
        target = target || /* @__PURE__ */ Object.create(null);
        target[key] = intersection;
      } else if (depth === 3) {
        return false;
      }
    }
  }
  return target;
}
function difference(s1, s22, depth = 4) {
  let target = false;
  for (const key in s1) {
    if (!(key in s22)) {
      target = target || /* @__PURE__ */ Object.create(null);
      target[key] = depth === 0 ? null : merge({}, s1[key], depth - 1);
    } else if (depth !== 0) {
      const diff = difference(s1[key], s22[key], depth - 1);
      if (diff !== false) {
        target = target || /* @__PURE__ */ Object.create(null);
        target[key] = diff;
      } else if (depth === 3) {
        return false;
      }
    }
  }
  return target;
}
var N3EntityIndex = class {
  constructor(options = {}) {
    this._id = 1;
    this._ids = /* @__PURE__ */ Object.create(null);
    this._ids[""] = 1;
    this._entities = /* @__PURE__ */ Object.create(null);
    this._entities[1] = "";
    this._blankNodeIndex = 0;
    this._factory = options.factory || N3DataFactory_default;
  }
  _termFromId(id) {
    if (id[0] === ".") {
      const entities = this._entities;
      const terms = id.split(".");
      const q3 = this._factory.quad(
        this._termFromId(entities[terms[1]]),
        this._termFromId(entities[terms[2]]),
        this._termFromId(entities[terms[3]]),
        terms[4] && this._termFromId(entities[terms[4]])
      );
      return q3;
    }
    return termFromId(id, this._factory);
  }
  _termToNumericId(term) {
    if (term.termType === "Quad") {
      const s4 = this._termToNumericId(term.subject), p4 = this._termToNumericId(term.predicate), o6 = this._termToNumericId(term.object);
      let g4;
      return s4 && p4 && o6 && (isDefaultGraph(term.graph) || (g4 = this._termToNumericId(term.graph))) && this._ids[g4 ? `.${s4}.${p4}.${o6}.${g4}` : `.${s4}.${p4}.${o6}`];
    }
    return this._ids[termToId(term)];
  }
  _termToNewNumericId(term) {
    const str = term && term.termType === "Quad" ? `.${this._termToNewNumericId(term.subject)}.${this._termToNewNumericId(term.predicate)}.${this._termToNewNumericId(term.object)}${isDefaultGraph(term.graph) ? "" : `.${this._termToNewNumericId(term.graph)}`}` : termToId(term);
    return this._ids[str] || (this._ids[this._entities[++this._id] = str] = this._id);
  }
  createBlankNode(suggestedName) {
    let name, index;
    if (suggestedName) {
      name = suggestedName = `_:${suggestedName}`, index = 1;
      while (this._ids[name])
        name = suggestedName + index++;
    } else {
      do {
        name = `_:b${this._blankNodeIndex++}`;
      } while (this._ids[name]);
    }
    this._ids[name] = ++this._id;
    this._entities[this._id] = name;
    return this._factory.blankNode(name.substr(2));
  }
};
var N3Store = class _N3Store {
  constructor(quads, options) {
    this._size = 0;
    this._graphs = /* @__PURE__ */ Object.create(null);
    if (!options && quads && !quads[0] && !(typeof quads.match === "function"))
      options = quads, quads = null;
    options = options || {};
    this._factory = options.factory || N3DataFactory_default;
    this._entityIndex = options.entityIndex || new N3EntityIndex({ factory: this._factory });
    this._entities = this._entityIndex._entities;
    this._termFromId = this._entityIndex._termFromId.bind(this._entityIndex);
    this._termToNumericId = this._entityIndex._termToNumericId.bind(this._entityIndex);
    this._termToNewNumericId = this._entityIndex._termToNewNumericId.bind(this._entityIndex);
    if (quads)
      this.addAll(quads);
  }
  // ## Public properties
  // ### `size` returns the number of quads in the store
  get size() {
    let size = this._size;
    if (size !== null)
      return size;
    size = 0;
    const graphs = this._graphs;
    let subjects, subject;
    for (const graphKey in graphs)
      for (const subjectKey in subjects = graphs[graphKey].subjects)
        for (const predicateKey in subject = subjects[subjectKey])
          size += Object.keys(subject[predicateKey]).length;
    return this._size = size;
  }
  // ## Private methods
  // ### `_addToIndex` adds a quad to a three-layered index.
  // Returns if the index has changed, if the entry did not already exist.
  _addToIndex(index0, key0, key1, key2) {
    const index1 = index0[key0] || (index0[key0] = {});
    const index2 = index1[key1] || (index1[key1] = {});
    const existed = key2 in index2;
    if (!existed)
      index2[key2] = null;
    return !existed;
  }
  // ### `_removeFromIndex` removes a quad from a three-layered index
  _removeFromIndex(index0, key0, key1, key2) {
    const index1 = index0[key0], index2 = index1[key1];
    delete index2[key2];
    for (const key in index2) return;
    delete index1[key1];
    for (const key in index1) return;
    delete index0[key0];
  }
  // ### `_findInIndex` finds a set of quads in a three-layered index.
  // The index base is `index0` and the keys at each level are `key0`, `key1`, and `key2`.
  // Any of these keys can be undefined, which is interpreted as a wildcard.
  // `name0`, `name1`, and `name2` are the names of the keys at each level,
  // used when reconstructing the resulting quad
  // (for instance: _subject_, _predicate_, and _object_).
  // Finally, `graphId` will be the graph of the created quads.
  *_findInIndex(index0, key0, key1, key2, name0, name1, name2, graphId) {
    let tmp, index1, index2;
    const entityKeys = this._entities;
    const graph = this._termFromId(entityKeys[graphId]);
    const parts = { subject: null, predicate: null, object: null };
    if (key0) (tmp = index0, index0 = {})[key0] = tmp[key0];
    for (const value0 in index0) {
      if (index1 = index0[value0]) {
        parts[name0] = this._termFromId(entityKeys[value0]);
        if (key1) (tmp = index1, index1 = {})[key1] = tmp[key1];
        for (const value1 in index1) {
          if (index2 = index1[value1]) {
            parts[name1] = this._termFromId(entityKeys[value1]);
            const values = key2 ? key2 in index2 ? [key2] : [] : Object.keys(index2);
            for (let l4 = 0; l4 < values.length; l4++) {
              parts[name2] = this._termFromId(entityKeys[values[l4]]);
              yield this._factory.quad(parts.subject, parts.predicate, parts.object, graph);
            }
          }
        }
      }
    }
  }
  // ### `_loop` executes the callback on all keys of index 0
  _loop(index0, callback) {
    for (const key0 in index0)
      callback(key0);
  }
  // ### `_loopByKey0` executes the callback on all keys of a certain entry in index 0
  _loopByKey0(index0, key0, callback) {
    let index1, key1;
    if (index1 = index0[key0]) {
      for (key1 in index1)
        callback(key1);
    }
  }
  // ### `_loopByKey1` executes the callback on given keys of all entries in index 0
  _loopByKey1(index0, key1, callback) {
    let key0, index1;
    for (key0 in index0) {
      index1 = index0[key0];
      if (index1[key1])
        callback(key0);
    }
  }
  // ### `_loopBy2Keys` executes the callback on given keys of certain entries in index 2
  _loopBy2Keys(index0, key0, key1, callback) {
    let index1, index2, key2;
    if ((index1 = index0[key0]) && (index2 = index1[key1])) {
      for (key2 in index2)
        callback(key2);
    }
  }
  // ### `_countInIndex` counts matching quads in a three-layered index.
  // The index base is `index0` and the keys at each level are `key0`, `key1`, and `key2`.
  // Any of these keys can be undefined, which is interpreted as a wildcard.
  _countInIndex(index0, key0, key1, key2) {
    let count = 0, tmp, index1, index2;
    if (key0) (tmp = index0, index0 = {})[key0] = tmp[key0];
    for (const value0 in index0) {
      if (index1 = index0[value0]) {
        if (key1) (tmp = index1, index1 = {})[key1] = tmp[key1];
        for (const value1 in index1) {
          if (index2 = index1[value1]) {
            if (key2) key2 in index2 && count++;
            else count += Object.keys(index2).length;
          }
        }
      }
    }
    return count;
  }
  // ### `_getGraphs` returns an array with the given graph,
  // or all graphs if the argument is null or undefined.
  _getGraphs(graph) {
    graph = graph === "" ? 1 : graph && (this._termToNumericId(graph) || -1);
    return typeof graph !== "number" ? this._graphs : { [graph]: this._graphs[graph] };
  }
  // ### `_uniqueEntities` returns a function that accepts an entity ID
  // and passes the corresponding entity to callback if it hasn't occurred before.
  _uniqueEntities(callback) {
    const uniqueIds = /* @__PURE__ */ Object.create(null);
    return (id) => {
      if (!(id in uniqueIds)) {
        uniqueIds[id] = true;
        callback(this._termFromId(this._entities[id], this._factory));
      }
    };
  }
  // ## Public methods
  // ### `add` adds the specified quad to the dataset.
  // Returns the dataset instance it was called on.
  // Existing quads, as defined in Quad.equals, will be ignored.
  add(quad4) {
    this.addQuad(quad4);
    return this;
  }
  // ### `addQuad` adds a new quad to the store.
  // Returns if the quad index has changed, if the quad did not already exist.
  addQuad(subject, predicate, object, graph) {
    if (!predicate)
      graph = subject.graph, object = subject.object, predicate = subject.predicate, subject = subject.subject;
    graph = graph ? this._termToNewNumericId(graph) : 1;
    let graphItem = this._graphs[graph];
    if (!graphItem) {
      graphItem = this._graphs[graph] = { subjects: {}, predicates: {}, objects: {} };
      Object.freeze(graphItem);
    }
    subject = this._termToNewNumericId(subject);
    predicate = this._termToNewNumericId(predicate);
    object = this._termToNewNumericId(object);
    if (!this._addToIndex(graphItem.subjects, subject, predicate, object))
      return false;
    this._addToIndex(graphItem.predicates, predicate, object, subject);
    this._addToIndex(graphItem.objects, object, subject, predicate);
    this._size = null;
    return true;
  }
  // ### `addQuads` adds multiple quads to the store
  addQuads(quads) {
    for (let i5 = 0; i5 < quads.length; i5++)
      this.addQuad(quads[i5]);
  }
  // ### `delete` removes the specified quad from the dataset.
  // Returns the dataset instance it was called on.
  delete(quad4) {
    this.removeQuad(quad4);
    return this;
  }
  // ### `has` determines whether a dataset includes a certain quad or quad pattern.
  has(subjectOrQuad, predicate, object, graph) {
    if (subjectOrQuad && subjectOrQuad.subject)
      ({ subject: subjectOrQuad, predicate, object, graph } = subjectOrQuad);
    return !this.readQuads(subjectOrQuad, predicate, object, graph).next().done;
  }
  // ### `import` adds a stream of quads to the store
  import(stream) {
    stream.on("data", (quad4) => {
      this.addQuad(quad4);
    });
    return stream;
  }
  // ### `removeQuad` removes a quad from the store if it exists
  removeQuad(subject, predicate, object, graph) {
    if (!predicate)
      ({ subject, predicate, object, graph } = subject);
    graph = graph ? this._termToNumericId(graph) : 1;
    const graphs = this._graphs;
    let graphItem, subjects, predicates;
    if (!(subject = subject && this._termToNumericId(subject)) || !(predicate = predicate && this._termToNumericId(predicate)) || !(object = object && this._termToNumericId(object)) || !(graphItem = graphs[graph]) || !(subjects = graphItem.subjects[subject]) || !(predicates = subjects[predicate]) || !(object in predicates))
      return false;
    this._removeFromIndex(graphItem.subjects, subject, predicate, object);
    this._removeFromIndex(graphItem.predicates, predicate, object, subject);
    this._removeFromIndex(graphItem.objects, object, subject, predicate);
    if (this._size !== null) this._size--;
    for (subject in graphItem.subjects) return true;
    delete graphs[graph];
    return true;
  }
  // ### `removeQuads` removes multiple quads from the store
  removeQuads(quads) {
    for (let i5 = 0; i5 < quads.length; i5++)
      this.removeQuad(quads[i5]);
  }
  // ### `remove` removes a stream of quads from the store
  remove(stream) {
    stream.on("data", (quad4) => {
      this.removeQuad(quad4);
    });
    return stream;
  }
  // ### `removeMatches` removes all matching quads from the store
  // Setting any field to `undefined` or `null` indicates a wildcard.
  removeMatches(subject, predicate, object, graph) {
    const stream = new import_readable_stream.Readable({ objectMode: true });
    const iterable = this.readQuads(subject, predicate, object, graph);
    stream._read = (size) => {
      while (--size >= 0) {
        const { done, value } = iterable.next();
        if (done) {
          stream.push(null);
          return;
        }
        stream.push(value);
      }
    };
    return this.remove(stream);
  }
  // ### `deleteGraph` removes all triples with the given graph from the store
  deleteGraph(graph) {
    return this.removeMatches(null, null, null, graph);
  }
  // ### `getQuads` returns an array of quads matching a pattern.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  getQuads(subject, predicate, object, graph) {
    return [...this.readQuads(subject, predicate, object, graph)];
  }
  /**
   * `readQuads` returns a generator of quads matching a pattern.
   * Setting any field to `undefined` or `null` indicates a wildcard.
   * @deprecated Use `match` instead.
   */
  *readQuads(subject, predicate, object, graph) {
    const graphs = this._getGraphs(graph);
    let content, subjectId, predicateId, objectId;
    if (subject && !(subjectId = this._termToNumericId(subject)) || predicate && !(predicateId = this._termToNumericId(predicate)) || object && !(objectId = this._termToNumericId(object)))
      return;
    for (const graphId in graphs) {
      if (content = graphs[graphId]) {
        if (subjectId) {
          if (objectId)
            yield* this._findInIndex(
              content.objects,
              objectId,
              subjectId,
              predicateId,
              "object",
              "subject",
              "predicate",
              graphId
            );
          else
            yield* this._findInIndex(
              content.subjects,
              subjectId,
              predicateId,
              null,
              "subject",
              "predicate",
              "object",
              graphId
            );
        } else if (predicateId)
          yield* this._findInIndex(
            content.predicates,
            predicateId,
            objectId,
            null,
            "predicate",
            "object",
            "subject",
            graphId
          );
        else if (objectId)
          yield* this._findInIndex(
            content.objects,
            objectId,
            null,
            null,
            "object",
            "subject",
            "predicate",
            graphId
          );
        else
          yield* this._findInIndex(
            content.subjects,
            null,
            null,
            null,
            "subject",
            "predicate",
            "object",
            graphId
          );
      }
    }
  }
  // ### `match` returns a new dataset that is comprised of all quads in the current instance matching the given arguments.
  // The logic described in Quad Matching is applied for each quad in this dataset to check if it should be included in the output dataset.
  // Note: This method always returns a new DatasetCore, even if that dataset contains no quads.
  // Note: Since a DatasetCore is an unordered set, the order of the quads within the returned sequence is arbitrary.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  // For backwards compatibility, the object return also implements the Readable stream interface.
  match(subject, predicate, object, graph) {
    return new DatasetCoreAndReadableStream(this, subject, predicate, object, graph, { entityIndex: this._entityIndex });
  }
  // ### `countQuads` returns the number of quads matching a pattern.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  countQuads(subject, predicate, object, graph) {
    const graphs = this._getGraphs(graph);
    let count = 0, content, subjectId, predicateId, objectId;
    if (subject && !(subjectId = this._termToNumericId(subject)) || predicate && !(predicateId = this._termToNumericId(predicate)) || object && !(objectId = this._termToNumericId(object)))
      return 0;
    for (const graphId in graphs) {
      if (content = graphs[graphId]) {
        if (subject) {
          if (object)
            count += this._countInIndex(content.objects, objectId, subjectId, predicateId);
          else
            count += this._countInIndex(content.subjects, subjectId, predicateId, objectId);
        } else if (predicate) {
          count += this._countInIndex(content.predicates, predicateId, objectId, subjectId);
        } else {
          count += this._countInIndex(content.objects, objectId, subjectId, predicateId);
        }
      }
    }
    return count;
  }
  // ### `forEach` executes the callback on all quads.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  forEach(callback, subject, predicate, object, graph) {
    this.some((quad4) => {
      callback(quad4, this);
      return false;
    }, subject, predicate, object, graph);
  }
  // ### `every` executes the callback on all quads,
  // and returns `true` if it returns truthy for all them.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  every(callback, subject, predicate, object, graph) {
    return !this.some((quad4) => !callback(quad4, this), subject, predicate, object, graph);
  }
  // ### `some` executes the callback on all quads,
  // and returns `true` if it returns truthy for any of them.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  some(callback, subject, predicate, object, graph) {
    for (const quad4 of this.readQuads(subject, predicate, object, graph))
      if (callback(quad4, this))
        return true;
    return false;
  }
  // ### `getSubjects` returns all subjects that match the pattern.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  getSubjects(predicate, object, graph) {
    const results = [];
    this.forSubjects((s4) => {
      results.push(s4);
    }, predicate, object, graph);
    return results;
  }
  // ### `forSubjects` executes the callback on all subjects that match the pattern.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  forSubjects(callback, predicate, object, graph) {
    const graphs = this._getGraphs(graph);
    let content, predicateId, objectId;
    callback = this._uniqueEntities(callback);
    if (predicate && !(predicateId = this._termToNumericId(predicate)) || object && !(objectId = this._termToNumericId(object)))
      return;
    for (graph in graphs) {
      if (content = graphs[graph]) {
        if (predicateId) {
          if (objectId)
            this._loopBy2Keys(content.predicates, predicateId, objectId, callback);
          else
            this._loopByKey1(content.subjects, predicateId, callback);
        } else if (objectId)
          this._loopByKey0(content.objects, objectId, callback);
        else
          this._loop(content.subjects, callback);
      }
    }
  }
  // ### `getPredicates` returns all predicates that match the pattern.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  getPredicates(subject, object, graph) {
    const results = [];
    this.forPredicates((p4) => {
      results.push(p4);
    }, subject, object, graph);
    return results;
  }
  // ### `forPredicates` executes the callback on all predicates that match the pattern.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  forPredicates(callback, subject, object, graph) {
    const graphs = this._getGraphs(graph);
    let content, subjectId, objectId;
    callback = this._uniqueEntities(callback);
    if (subject && !(subjectId = this._termToNumericId(subject)) || object && !(objectId = this._termToNumericId(object)))
      return;
    for (graph in graphs) {
      if (content = graphs[graph]) {
        if (subjectId) {
          if (objectId)
            this._loopBy2Keys(content.objects, objectId, subjectId, callback);
          else
            this._loopByKey0(content.subjects, subjectId, callback);
        } else if (objectId)
          this._loopByKey1(content.predicates, objectId, callback);
        else
          this._loop(content.predicates, callback);
      }
    }
  }
  // ### `getObjects` returns all objects that match the pattern.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  getObjects(subject, predicate, graph) {
    const results = [];
    this.forObjects((o6) => {
      results.push(o6);
    }, subject, predicate, graph);
    return results;
  }
  // ### `forObjects` executes the callback on all objects that match the pattern.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  forObjects(callback, subject, predicate, graph) {
    const graphs = this._getGraphs(graph);
    let content, subjectId, predicateId;
    callback = this._uniqueEntities(callback);
    if (subject && !(subjectId = this._termToNumericId(subject)) || predicate && !(predicateId = this._termToNumericId(predicate)))
      return;
    for (graph in graphs) {
      if (content = graphs[graph]) {
        if (subjectId) {
          if (predicateId)
            this._loopBy2Keys(content.subjects, subjectId, predicateId, callback);
          else
            this._loopByKey1(content.objects, subjectId, callback);
        } else if (predicateId)
          this._loopByKey0(content.predicates, predicateId, callback);
        else
          this._loop(content.objects, callback);
      }
    }
  }
  // ### `getGraphs` returns all graphs that match the pattern.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  getGraphs(subject, predicate, object) {
    const results = [];
    this.forGraphs((g4) => {
      results.push(g4);
    }, subject, predicate, object);
    return results;
  }
  // ### `forGraphs` executes the callback on all graphs that match the pattern.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  forGraphs(callback, subject, predicate, object) {
    for (const graph in this._graphs) {
      this.some((quad4) => {
        callback(quad4.graph);
        return true;
      }, subject, predicate, object, this._termFromId(this._entities[graph]));
    }
  }
  // ### `createBlankNode` creates a new blank node, returning its name
  createBlankNode(suggestedName) {
    return this._entityIndex.createBlankNode(suggestedName);
  }
  // ### `extractLists` finds and removes all list triples
  // and returns the items per list.
  extractLists({ remove = false, ignoreErrors = false } = {}) {
    const lists = {};
    const onError = ignoreErrors ? (() => true) : ((node, message) => {
      throw new Error(`${node.value} ${message}`);
    });
    const tails = this.getQuads(null, IRIs_default.rdf.rest, IRIs_default.rdf.nil, null);
    const toRemove = remove ? [...tails] : [];
    tails.forEach((tailQuad) => {
      const items = [];
      let malformed = false;
      let head;
      let headPos;
      const graph = tailQuad.graph;
      let current = tailQuad.subject;
      while (current && !malformed) {
        const objectQuads = this.getQuads(null, null, current, null);
        const subjectQuads = this.getQuads(current, null, null, null);
        let quad4, first = null, rest = null, parent = null;
        for (let i5 = 0; i5 < subjectQuads.length && !malformed; i5++) {
          quad4 = subjectQuads[i5];
          if (!quad4.graph.equals(graph))
            malformed = onError(current, "not confined to single graph");
          else if (head)
            malformed = onError(current, "has non-list arcs out");
          else if (quad4.predicate.value === IRIs_default.rdf.first) {
            if (first)
              malformed = onError(current, "has multiple rdf:first arcs");
            else
              toRemove.push(first = quad4);
          } else if (quad4.predicate.value === IRIs_default.rdf.rest) {
            if (rest)
              malformed = onError(current, "has multiple rdf:rest arcs");
            else
              toRemove.push(rest = quad4);
          } else if (objectQuads.length)
            malformed = onError(current, "can't be subject and object");
          else {
            head = quad4;
            headPos = "subject";
          }
        }
        for (let i5 = 0; i5 < objectQuads.length && !malformed; ++i5) {
          quad4 = objectQuads[i5];
          if (head)
            malformed = onError(current, "can't have coreferences");
          else if (quad4.predicate.value === IRIs_default.rdf.rest) {
            if (parent)
              malformed = onError(current, "has incoming rdf:rest arcs");
            else
              parent = quad4;
          } else {
            head = quad4;
            headPos = "object";
          }
        }
        if (!first)
          malformed = onError(current, "has no list head");
        else
          items.unshift(first.object);
        current = parent && parent.subject;
      }
      if (malformed)
        remove = false;
      else if (head)
        lists[head[headPos].value] = items;
    });
    if (remove)
      this.removeQuads(toRemove);
    return lists;
  }
  /**
   * Returns `true` if the current dataset is a superset of the given dataset; in other words, returns `true` if
   * the given dataset is a subset of, i.e., is contained within, the current dataset.
   *
   * Blank Nodes will be normalized.
   */
  addAll(quads) {
    if (quads instanceof DatasetCoreAndReadableStream)
      quads = quads.filtered;
    if (Array.isArray(quads))
      this.addQuads(quads);
    else if (quads instanceof _N3Store && quads._entityIndex === this._entityIndex) {
      if (quads._size !== 0) {
        this._graphs = merge(this._graphs, quads._graphs);
        this._size = null;
      }
    } else {
      for (const quad4 of quads)
        this.add(quad4);
    }
    return this;
  }
  /**
   * Returns `true` if the current dataset is a superset of the given dataset; in other words, returns `true` if
   * the given dataset is a subset of, i.e., is contained within, the current dataset.
   *
   * Blank Nodes will be normalized.
   */
  contains(other) {
    if (other instanceof DatasetCoreAndReadableStream)
      other = other.filtered;
    if (other === this)
      return true;
    if (!(other instanceof _N3Store) || this._entityIndex !== other._entityIndex)
      return other.every((quad4) => this.has(quad4));
    const g1 = this._graphs, g22 = other._graphs;
    let s1, s22, p1, p22, o1;
    for (const graph in g22) {
      if (!(s1 = g1[graph])) return false;
      s1 = s1.subjects;
      for (const subject in s22 = g22[graph].subjects) {
        if (!(p1 = s1[subject])) return false;
        for (const predicate in p22 = s22[subject]) {
          if (!(o1 = p1[predicate])) return false;
          for (const object in p22[predicate])
            if (!(object in o1)) return false;
        }
      }
    }
    return true;
  }
  /**
   * This method removes the quads in the current dataset that match the given arguments.
   *
   * The logic described in {@link https://rdf.js.org/dataset-spec/#quad-matching|Quad Matching} is applied for each
   * quad in this dataset, to select the quads which will be deleted.
   *
   * @param subject   The optional exact subject to match.
   * @param predicate The optional exact predicate to match.
   * @param object    The optional exact object to match.
   * @param graph     The optional exact graph to match.
   */
  deleteMatches(subject, predicate, object, graph) {
    for (const quad4 of this.match(subject, predicate, object, graph))
      this.removeQuad(quad4);
    return this;
  }
  /**
   * Returns a new dataset that contains all quads from the current dataset that are not included in the given dataset.
   */
  difference(other) {
    if (other && other instanceof DatasetCoreAndReadableStream)
      other = other.filtered;
    if (other === this)
      return new _N3Store({ entityIndex: this._entityIndex });
    if (other instanceof _N3Store && other._entityIndex === this._entityIndex) {
      const store = new _N3Store({ entityIndex: this._entityIndex });
      const graphs = difference(this._graphs, other._graphs);
      if (graphs) {
        store._graphs = graphs;
        store._size = null;
      }
      return store;
    }
    return this.filter((quad4) => !other.has(quad4));
  }
  /**
   * Returns true if the current dataset contains the same graph structure as the given dataset.
   *
   * Blank Nodes will be normalized.
   */
  equals(other) {
    if (other instanceof DatasetCoreAndReadableStream)
      other = other.filtered;
    return other === this || this.size === other.size && this.contains(other);
  }
  /**
   * Creates a new dataset with all the quads that pass the test implemented by the provided `iteratee`.
   *
   * This method is aligned with Array.prototype.filter() in ECMAScript-262.
   */
  filter(iteratee) {
    const store = new _N3Store({ entityIndex: this._entityIndex });
    for (const quad4 of this)
      if (iteratee(quad4, this))
        store.add(quad4);
    return store;
  }
  /**
   * Returns a new dataset containing all quads from the current dataset that are also included in the given dataset.
   */
  intersection(other) {
    if (other instanceof DatasetCoreAndReadableStream)
      other = other.filtered;
    if (other === this) {
      const store = new _N3Store({ entityIndex: this._entityIndex });
      store._graphs = merge(/* @__PURE__ */ Object.create(null), this._graphs);
      store._size = this._size;
      return store;
    } else if (other instanceof _N3Store && this._entityIndex === other._entityIndex) {
      const store = new _N3Store({ entityIndex: this._entityIndex });
      const graphs = intersect(other._graphs, this._graphs);
      if (graphs) {
        store._graphs = graphs;
        store._size = null;
      }
      return store;
    }
    return this.filter((quad4) => other.has(quad4));
  }
  /**
   * Returns a new dataset containing all quads returned by applying `iteratee` to each quad in the current dataset.
   */
  map(iteratee) {
    const store = new _N3Store({ entityIndex: this._entityIndex });
    for (const quad4 of this)
      store.add(iteratee(quad4, this));
    return store;
  }
  /**
   * This method calls the `iteratee` method on each `quad` of the `Dataset`. The first time the `iteratee` method
   * is called, the `accumulator` value is the `initialValue`, or, if not given, equals the first quad of the `Dataset`.
   * The return value of each call to the `iteratee` method is used as the `accumulator` value for the next call.
   *
   * This method returns the return value of the last `iteratee` call.
   *
   * This method is aligned with `Array.prototype.reduce()` in ECMAScript-262.
   */
  reduce(callback, initialValue) {
    const iter = this.readQuads();
    let accumulator = initialValue === void 0 ? iter.next().value : initialValue;
    for (const quad4 of iter)
      accumulator = callback(accumulator, quad4, this);
    return accumulator;
  }
  /**
   * Returns the set of quads within the dataset as a host-language-native sequence, for example an `Array` in
   * ECMAScript-262.
   *
   * Since a `Dataset` is an unordered set, the order of the quads within the returned sequence is arbitrary.
   */
  toArray() {
    return this.getQuads();
  }
  /**
   * Returns an N-Quads string representation of the dataset, preprocessed with the
   * {@link https://json-ld.github.io/normalization/spec/|RDF Dataset Normalization} algorithm.
   */
  toCanonical() {
    throw new Error("not implemented");
  }
  /**
   * Returns a stream that contains all quads of the dataset.
   */
  toStream() {
    return this.match();
  }
  /**
   * Returns an N-Quads string representation of the dataset.
   *
   * No prior normalization is required, therefore the results for the same quads may vary depending on the `Dataset`
   * implementation.
   */
  toString() {
    return new N3Writer().quadsToString(this);
  }
  /**
   * Returns a new `Dataset` that is a concatenation of this dataset and the quads given as an argument.
   */
  union(quads) {
    const store = new _N3Store({ entityIndex: this._entityIndex });
    store._graphs = merge(/* @__PURE__ */ Object.create(null), this._graphs);
    store._size = this._size;
    store.addAll(quads);
    return store;
  }
  // ### Store is an iterable.
  // Can be used where iterables are expected: for...of loops, array spread operator,
  // `yield*`, and destructuring assignment (order is not guaranteed).
  *[Symbol.iterator]() {
    yield* this.readQuads();
  }
};
function indexMatch(index, ids, depth = 0) {
  const ind = ids[depth];
  if (ind && !(ind in index))
    return false;
  let target = false;
  for (const key in ind ? { [ind]: index[ind] } : index) {
    const result = depth === 2 ? null : indexMatch(index[key], ids, depth + 1);
    if (result !== false) {
      target = target || /* @__PURE__ */ Object.create(null);
      target[key] = result;
    }
  }
  return target;
}
var DatasetCoreAndReadableStream = class _DatasetCoreAndReadableStream extends import_readable_stream.Readable {
  constructor(n3Store, subject, predicate, object, graph, options) {
    super({ objectMode: true });
    Object.assign(this, { n3Store, subject, predicate, object, graph, options });
  }
  get filtered() {
    if (!this._filtered) {
      const { n3Store, graph, object, predicate, subject } = this;
      const newStore = this._filtered = new N3Store({ factory: n3Store._factory, entityIndex: this.options.entityIndex });
      let subjectId, predicateId, objectId;
      if (subject && !(subjectId = newStore._termToNumericId(subject)) || predicate && !(predicateId = newStore._termToNumericId(predicate)) || object && !(objectId = newStore._termToNumericId(object)))
        return newStore;
      const graphs = n3Store._getGraphs(graph);
      for (const graphKey in graphs) {
        let subjects, predicates, objects, content;
        if (content = graphs[graphKey]) {
          if (!subjectId && predicateId) {
            if (predicates = indexMatch(content.predicates, [predicateId, objectId, subjectId])) {
              subjects = indexMatch(content.subjects, [subjectId, predicateId, objectId]);
              objects = indexMatch(content.objects, [objectId, subjectId, predicateId]);
            }
          } else if (objectId) {
            if (objects = indexMatch(content.objects, [objectId, subjectId, predicateId])) {
              subjects = indexMatch(content.subjects, [subjectId, predicateId, objectId]);
              predicates = indexMatch(content.predicates, [predicateId, objectId, subjectId]);
            }
          } else if (subjects = indexMatch(content.subjects, [subjectId, predicateId, objectId])) {
            predicates = indexMatch(content.predicates, [predicateId, objectId, subjectId]);
            objects = indexMatch(content.objects, [objectId, subjectId, predicateId]);
          }
          if (subjects)
            newStore._graphs[graphKey] = { subjects, predicates, objects };
        }
      }
      newStore._size = null;
    }
    return this._filtered;
  }
  get size() {
    return this.filtered.size;
  }
  _read(size) {
    if (size > 0 && !this[ITERATOR])
      this[ITERATOR] = this[Symbol.iterator]();
    const iterable = this[ITERATOR];
    while (--size >= 0) {
      const { done, value } = iterable.next();
      if (done) {
        this.push(null);
        return;
      }
      this.push(value);
    }
  }
  addAll(quads) {
    return this.filtered.addAll(quads);
  }
  contains(other) {
    return this.filtered.contains(other);
  }
  deleteMatches(subject, predicate, object, graph) {
    return this.filtered.deleteMatches(subject, predicate, object, graph);
  }
  difference(other) {
    return this.filtered.difference(other);
  }
  equals(other) {
    return this.filtered.equals(other);
  }
  every(callback, subject, predicate, object, graph) {
    return this.filtered.every(callback, subject, predicate, object, graph);
  }
  filter(iteratee) {
    return this.filtered.filter(iteratee);
  }
  forEach(callback, subject, predicate, object, graph) {
    return this.filtered.forEach(callback, subject, predicate, object, graph);
  }
  import(stream) {
    return this.filtered.import(stream);
  }
  intersection(other) {
    return this.filtered.intersection(other);
  }
  map(iteratee) {
    return this.filtered.map(iteratee);
  }
  some(callback, subject, predicate, object, graph) {
    return this.filtered.some(callback, subject, predicate, object, graph);
  }
  toCanonical() {
    return this.filtered.toCanonical();
  }
  toStream() {
    return this._filtered ? this._filtered.toStream() : this.n3Store.match(this.subject, this.predicate, this.object, this.graph);
  }
  union(quads) {
    return this._filtered ? this._filtered.union(quads) : this.n3Store.match(this.subject, this.predicate, this.object, this.graph).addAll(quads);
  }
  toArray() {
    return this._filtered ? this._filtered.toArray() : this.n3Store.getQuads(this.subject, this.predicate, this.object, this.graph);
  }
  reduce(callback, initialValue) {
    return this.filtered.reduce(callback, initialValue);
  }
  toString() {
    return new N3Writer().quadsToString(this);
  }
  add(quad4) {
    return this.filtered.add(quad4);
  }
  delete(quad4) {
    return this.filtered.delete(quad4);
  }
  has(quad4) {
    return this.filtered.has(quad4);
  }
  match(subject, predicate, object, graph) {
    return new _DatasetCoreAndReadableStream(this.filtered, subject, predicate, object, graph, this.options);
  }
  *[Symbol.iterator]() {
    yield* this._filtered || this.n3Store.readQuads(this.subject, this.predicate, this.object, this.graph);
  }
};

// node_modules/n3/src/N3StreamParser.js
var import_readable_stream2 = __toESM(require_browser());
var N3StreamParser = class extends import_readable_stream2.Transform {
  constructor(options) {
    super({ decodeStrings: true });
    this._readableState.objectMode = true;
    const parser = new N3Parser(options);
    let onData, onEnd;
    const callbacks = {
      // Handle quads by pushing them down the pipeline
      onQuad: (error, quad4) => {
        error && this.emit("error", error) || quad4 && this.push(quad4);
      },
      // Emit prefixes through the `prefix` event
      onPrefix: (prefix, uri) => {
        this.emit("prefix", prefix, uri);
      }
    };
    if (options && options.comments)
      callbacks.onComment = (comment) => {
        this.emit("comment", comment);
      };
    parser.parse({
      on: (event, callback) => {
        switch (event) {
          case "data":
            onData = callback;
            break;
          case "end":
            onEnd = callback;
            break;
        }
      }
    }, callbacks);
    this._transform = (chunk, encoding, done) => {
      onData(chunk);
      done();
    };
    this._flush = (done) => {
      onEnd();
      done();
    };
  }
  // ### Parses a stream of strings
  import(stream) {
    stream.on("data", (chunk) => {
      this.write(chunk);
    });
    stream.on("end", () => {
      this.end();
    });
    stream.on("error", (error) => {
      this.emit("error", error);
    });
    return this;
  }
};

// src/serialize.ts
function serializeTurtle(quads) {
  const store = quads instanceof N3Store ? quads : new N3Store([...quads]);
  return new Promise((resolve, reject) => {
    const writer = new N3Writer({ format: "text/turtle" });
    for (const quad4 of store.getQuads(null, null, null, null)) {
      writer.addQuad(quad4.subject, quad4.predicate, quad4.object);
    }
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

// src/rdf.ts
async function parseToStore(body, contentTypeHeader, options) {
  const text = typeof body === "string" ? body : await readStreamToText(body);
  const dataset2 = await parseRdf(text, contentTypeHeader, options);
  return new N3Store([...dataset2]);
}
async function readStreamToText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

// src/shacl-view-fetch.ts
var DCT_CONFORMS_TO = "http://purl.org/dc/terms/conformsTo";
var AUTO_IMPORT_PREDICATES = /* @__PURE__ */ new Set([DCT_CONFORMS_TO]);
function isHttpNamedNode(object) {
  if (object.termType !== "NamedNode") return false;
  let protocol;
  try {
    protocol = new URL(object.value).protocol;
  } catch {
    return false;
  }
  return protocol === "http:" || protocol === "https:";
}
async function neutraliseValuesTurtle(turtle) {
  const store = await parseToStore(turtle, "text/turtle");
  const toRemove = [];
  for (const quad4 of store.getQuads(null, null, null, null)) {
    if (AUTO_IMPORT_PREDICATES.has(quad4.predicate.value) && isHttpNamedNode(quad4.object)) {
      toRemove.push(quad4);
    }
  }
  for (const quad4 of toRemove) store.removeQuad(quad4);
  return serializeTurtle(store);
}
async function countTurtleQuads(turtle) {
  const store = await parseToStore(turtle, "text/turtle");
  return store.size;
}
var VALUES_SUBJECT_SENTINEL = "urn:jeswr:solid-components:shacl-view:values-subject";
var DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
var DEFAULT_TIMEOUT_MS = 1e4;
var NO_NETWORK_RDF_TYPES = /* @__PURE__ */ new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig"
]);
function assertNoNetworkRdfType(mediaType, context) {
  if (!NO_NETWORK_RDF_TYPES.has(mediaType)) {
    throw new Error(
      `Refusing ${context}: content-type "${mediaType}" is not a no-network RDF type (Turtle/N-Triples/N-Quads/TriG). JSON-LD/RDF-XML are rejected because the parser would resolve a remote @context/import through an unguarded fetch (an SSRF surface).`
    );
  }
}
async function resolveGraphToTurtle(source, seam, options = {}) {
  if (source.kind === "inline") {
    const declaredType = (source.contentType ?? "text/turtle").split(";")[0].trim().toLowerCase();
    assertNoNetworkRdfType(declaredType, "inline source");
    const store = await parseToStore(source.text, declaredType);
    return serializeTurtle(store);
  }
  if (source.kind === "trusted") {
    let doFetch;
    if (source.seam === "public") {
      if (!seam.publicFetch) {
        throw new Error(
          `Refusing to fetch trusted public source ${source.url}: no credential-free \`publicFetch\` was provided. Set the element's \`.publicFetch\` (a fetch that carries no session credentials) to read a public/foreign source.`
        );
      }
      doFetch = seam.publicFetch;
    } else {
      doFetch = seam.fetch;
    }
    return fetchAndSerialise(source.url, doFetch, { signal: options.signal });
  }
  const guarded = await loadGuarded(options);
  return fetchAndSerialise(source.url, guarded, {
    signal: options.signal,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  });
}
async function fetchAndSerialise(url, doFetch, opts) {
  const response = await doFetch(url, {
    method: "GET",
    // Ask for Turtle ONLY — never JSON-LD (no remote-@context fetch surface).
    headers: { Accept: "text/turtle" },
    ...opts.signal ? { signal: opts.signal } : {},
    // These two are honoured by the guarded fetch (a plain fetch ignores unknown
    // init keys); the guard reads them from its own GuardOptions, but we also pass
    // them on the init so a guarded-fetch built per-call picks them up.
    ...opts.maxBytes !== void 0 ? { maxBytes: opts.maxBytes } : {},
    ...opts.timeoutMs !== void 0 ? { timeoutMs: opts.timeoutMs } : {}
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch graph ${url}: HTTP ${response.status}`);
  }
  const contentType = response.headers.get("Content-Type");
  const mediaType = (contentType ?? "text/turtle").split(";")[0].trim().toLowerCase();
  assertNoNetworkRdfType(mediaType, `graph ${url}`);
  const finalUrl = response.url || url;
  const body = response.body ?? await response.text();
  const store = await parseToStore(body, contentType, { baseIRI: finalUrl });
  return serializeTurtle(store);
}
async function loadGuarded(options) {
  if (options.loadGuardedFetch) return options.loadGuardedFetch();
  const mod = await import("@jeswr/guarded-fetch");
  return mod.createGuardedFetch({
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  });
}
var EMPTY_SHAPES_MESSAGE = "The SHACL shapes graph is empty (zero triples) \u2014 nothing to render, and an empty shapes graph is refused (it would enable shacl-form's auto-import fetch path).";
async function resolveAndHarden(shapes, values, seam, options = {}) {
  try {
    const [shapesTurtle, valuesTurtleRaw] = await Promise.all([
      resolveGraphToTurtle(shapes, seam, options),
      resolveGraphToTurtle(values, seam, options)
    ]);
    if (await countTurtleQuads(shapesTurtle) === 0) {
      return { kind: "empty-shapes", message: EMPTY_SHAPES_MESSAGE };
    }
    const valuesTurtle = await neutraliseValuesTurtle(valuesTurtleRaw);
    return { kind: "ready", shapesTurtle, valuesTurtle };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

// scripts/stubs/rdfxml-streaming-parser.mjs
var RdfXmlParser = class {
  constructor() {
    throw new Error(
      "[@jeswr/solid-components] rdfxml-streaming-parser is not bundled. <jeswr-shacl-view> only passes inline Turtle to shacl-form; an RDF/XML code path was reached unexpectedly. This is a bug."
    );
  }
};

// scripts/stubs/jsonld.mjs
var notBundled = () => {
  throw new Error(
    "[@jeswr/solid-components] jsonld is not bundled. <jeswr-shacl-view> only passes inline Turtle to shacl-form; a JSON-LD code path was reached unexpectedly. This is a bug."
  );
};
var jsonld_default = {
  toRDF: notBundled,
  fromRDF: notBundled,
  expand: notBundled,
  compact: notBundled,
  flatten: notBundled,
  frame: notBundled,
  normalize: notBundled,
  canonize: notBundled
};

// node_modules/@lit/reactive-element/css-tag.js
var t = globalThis;
var e = t.ShadowRoot && (void 0 === t.ShadyCSS || t.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
var s = Symbol();
var o = /* @__PURE__ */ new WeakMap();
var n = class {
  constructor(t5, e6, o6) {
    if (this._$cssResult$ = true, o6 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t5, this.t = e6;
  }
  get styleSheet() {
    let t5 = this.o;
    const s4 = this.t;
    if (e && void 0 === t5) {
      const e6 = void 0 !== s4 && 1 === s4.length;
      e6 && (t5 = o.get(s4)), void 0 === t5 && ((this.o = t5 = new CSSStyleSheet()).replaceSync(this.cssText), e6 && o.set(s4, t5));
    }
    return t5;
  }
  toString() {
    return this.cssText;
  }
};
var r = (t5) => new n("string" == typeof t5 ? t5 : t5 + "", void 0, s);
var i = (t5, ...e6) => {
  const o6 = 1 === t5.length ? t5[0] : e6.reduce((e7, s4, o7) => e7 + ((t6) => {
    if (true === t6._$cssResult$) return t6.cssText;
    if ("number" == typeof t6) return t6;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + t6 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(s4) + t5[o7 + 1], t5[0]);
  return new n(o6, t5, s);
};
var S = (s4, o6) => {
  if (e) s4.adoptedStyleSheets = o6.map((t5) => t5 instanceof CSSStyleSheet ? t5 : t5.styleSheet);
  else for (const e6 of o6) {
    const o7 = document.createElement("style"), n5 = t.litNonce;
    void 0 !== n5 && o7.setAttribute("nonce", n5), o7.textContent = e6.cssText, s4.appendChild(o7);
  }
};
var c = e ? (t5) => t5 : (t5) => t5 instanceof CSSStyleSheet ? ((t6) => {
  let e6 = "";
  for (const s4 of t6.cssRules) e6 += s4.cssText;
  return r(e6);
})(t5) : t5;

// node_modules/@lit/reactive-element/reactive-element.js
var { is: i2, defineProperty: e2, getOwnPropertyDescriptor: h, getOwnPropertyNames: r2, getOwnPropertySymbols: o2, getPrototypeOf: n2 } = Object;
var a = globalThis;
var c2 = a.trustedTypes;
var l = c2 ? c2.emptyScript : "";
var p = a.reactiveElementPolyfillSupport;
var d = (t5, s4) => t5;
var u = { toAttribute(t5, s4) {
  switch (s4) {
    case Boolean:
      t5 = t5 ? l : null;
      break;
    case Object:
    case Array:
      t5 = null == t5 ? t5 : JSON.stringify(t5);
  }
  return t5;
}, fromAttribute(t5, s4) {
  let i5 = t5;
  switch (s4) {
    case Boolean:
      i5 = null !== t5;
      break;
    case Number:
      i5 = null === t5 ? null : Number(t5);
      break;
    case Object:
    case Array:
      try {
        i5 = JSON.parse(t5);
      } catch (t6) {
        i5 = null;
      }
  }
  return i5;
} };
var f = (t5, s4) => !i2(t5, s4);
var b = { attribute: true, type: String, converter: u, reflect: false, useDefault: false, hasChanged: f };
Symbol.metadata ??= Symbol("metadata"), a.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var y = class extends HTMLElement {
  static addInitializer(t5) {
    this._$Ei(), (this.l ??= []).push(t5);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t5, s4 = b) {
    if (s4.state && (s4.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t5) && ((s4 = Object.create(s4)).wrapped = true), this.elementProperties.set(t5, s4), !s4.noAccessor) {
      const i5 = Symbol(), h5 = this.getPropertyDescriptor(t5, i5, s4);
      void 0 !== h5 && e2(this.prototype, t5, h5);
    }
  }
  static getPropertyDescriptor(t5, s4, i5) {
    const { get: e6, set: r6 } = h(this.prototype, t5) ?? { get() {
      return this[s4];
    }, set(t6) {
      this[s4] = t6;
    } };
    return { get: e6, set(s5) {
      const h5 = e6?.call(this);
      r6?.call(this, s5), this.requestUpdate(t5, h5, i5);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t5) {
    return this.elementProperties.get(t5) ?? b;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d("elementProperties"))) return;
    const t5 = n2(this);
    t5.finalize(), void 0 !== t5.l && (this.l = [...t5.l]), this.elementProperties = new Map(t5.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d("properties"))) {
      const t6 = this.properties, s4 = [...r2(t6), ...o2(t6)];
      for (const i5 of s4) this.createProperty(i5, t6[i5]);
    }
    const t5 = this[Symbol.metadata];
    if (null !== t5) {
      const s4 = litPropertyMetadata.get(t5);
      if (void 0 !== s4) for (const [t6, i5] of s4) this.elementProperties.set(t6, i5);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t6, s4] of this.elementProperties) {
      const i5 = this._$Eu(t6, s4);
      void 0 !== i5 && this._$Eh.set(i5, t6);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s4) {
    const i5 = [];
    if (Array.isArray(s4)) {
      const e6 = new Set(s4.flat(1 / 0).reverse());
      for (const s5 of e6) i5.unshift(c(s5));
    } else void 0 !== s4 && i5.push(c(s4));
    return i5;
  }
  static _$Eu(t5, s4) {
    const i5 = s4.attribute;
    return false === i5 ? void 0 : "string" == typeof i5 ? i5 : "string" == typeof t5 ? t5.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t5) => this.enableUpdating = t5), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t5) => t5(this));
  }
  addController(t5) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t5), void 0 !== this.renderRoot && this.isConnected && t5.hostConnected?.();
  }
  removeController(t5) {
    this._$EO?.delete(t5);
  }
  _$E_() {
    const t5 = /* @__PURE__ */ new Map(), s4 = this.constructor.elementProperties;
    for (const i5 of s4.keys()) this.hasOwnProperty(i5) && (t5.set(i5, this[i5]), delete this[i5]);
    t5.size > 0 && (this._$Ep = t5);
  }
  createRenderRoot() {
    const t5 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S(t5, this.constructor.elementStyles), t5;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(true), this._$EO?.forEach((t5) => t5.hostConnected?.());
  }
  enableUpdating(t5) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t5) => t5.hostDisconnected?.());
  }
  attributeChangedCallback(t5, s4, i5) {
    this._$AK(t5, i5);
  }
  _$ET(t5, s4) {
    const i5 = this.constructor.elementProperties.get(t5), e6 = this.constructor._$Eu(t5, i5);
    if (void 0 !== e6 && true === i5.reflect) {
      const h5 = (void 0 !== i5.converter?.toAttribute ? i5.converter : u).toAttribute(s4, i5.type);
      this._$Em = t5, null == h5 ? this.removeAttribute(e6) : this.setAttribute(e6, h5), this._$Em = null;
    }
  }
  _$AK(t5, s4) {
    const i5 = this.constructor, e6 = i5._$Eh.get(t5);
    if (void 0 !== e6 && this._$Em !== e6) {
      const t6 = i5.getPropertyOptions(e6), h5 = "function" == typeof t6.converter ? { fromAttribute: t6.converter } : void 0 !== t6.converter?.fromAttribute ? t6.converter : u;
      this._$Em = e6;
      const r6 = h5.fromAttribute(s4, t6.type);
      this[e6] = r6 ?? this._$Ej?.get(e6) ?? r6, this._$Em = null;
    }
  }
  requestUpdate(t5, s4, i5, e6 = false, h5) {
    if (void 0 !== t5) {
      const r6 = this.constructor;
      if (false === e6 && (h5 = this[t5]), i5 ??= r6.getPropertyOptions(t5), !((i5.hasChanged ?? f)(h5, s4) || i5.useDefault && i5.reflect && h5 === this._$Ej?.get(t5) && !this.hasAttribute(r6._$Eu(t5, i5)))) return;
      this.C(t5, s4, i5);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t5, s4, { useDefault: i5, reflect: e6, wrapped: h5 }, r6) {
    i5 && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t5) && (this._$Ej.set(t5, r6 ?? s4 ?? this[t5]), true !== h5 || void 0 !== r6) || (this._$AL.has(t5) || (this.hasUpdated || i5 || (s4 = void 0), this._$AL.set(t5, s4)), true === e6 && this._$Em !== t5 && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t5));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t6) {
      Promise.reject(t6);
    }
    const t5 = this.scheduleUpdate();
    return null != t5 && await t5, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [t7, s5] of this._$Ep) this[t7] = s5;
        this._$Ep = void 0;
      }
      const t6 = this.constructor.elementProperties;
      if (t6.size > 0) for (const [s5, i5] of t6) {
        const { wrapped: t7 } = i5, e6 = this[s5];
        true !== t7 || this._$AL.has(s5) || void 0 === e6 || this.C(s5, void 0, i5, e6);
      }
    }
    let t5 = false;
    const s4 = this._$AL;
    try {
      t5 = this.shouldUpdate(s4), t5 ? (this.willUpdate(s4), this._$EO?.forEach((t6) => t6.hostUpdate?.()), this.update(s4)) : this._$EM();
    } catch (s5) {
      throw t5 = false, this._$EM(), s5;
    }
    t5 && this._$AE(s4);
  }
  willUpdate(t5) {
  }
  _$AE(t5) {
    this._$EO?.forEach((t6) => t6.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t5)), this.updated(t5);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t5) {
    return true;
  }
  update(t5) {
    this._$Eq &&= this._$Eq.forEach((t6) => this._$ET(t6, this[t6])), this._$EM();
  }
  updated(t5) {
  }
  firstUpdated(t5) {
  }
};
y.elementStyles = [], y.shadowRootOptions = { mode: "open" }, y[d("elementProperties")] = /* @__PURE__ */ new Map(), y[d("finalized")] = /* @__PURE__ */ new Map(), p?.({ ReactiveElement: y }), (a.reactiveElementVersions ??= []).push("2.1.2");

// node_modules/lit-html/lit-html.js
var t2 = globalThis;
var i3 = (t5) => t5;
var s2 = t2.trustedTypes;
var e3 = s2 ? s2.createPolicy("lit-html", { createHTML: (t5) => t5 }) : void 0;
var h2 = "$lit$";
var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;
var n3 = "?" + o3;
var r3 = `<${n3}>`;
var l2 = document;
var c3 = () => l2.createComment("");
var a2 = (t5) => null === t5 || "object" != typeof t5 && "function" != typeof t5;
var u2 = Array.isArray;
var d2 = (t5) => u2(t5) || "function" == typeof t5?.[Symbol.iterator];
var f2 = "[ 	\n\f\r]";
var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var _ = /-->/g;
var m = />/g;
var p2 = RegExp(`>|${f2}(?:([^\\s"'>=/]+)(${f2}*=${f2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var g = /'/g;
var $ = /"/g;
var y2 = /^(?:script|style|textarea|title)$/i;
var x = (t5) => (i5, ...s4) => ({ _$litType$: t5, strings: i5, values: s4 });
var b2 = x(1);
var w = x(2);
var T = x(3);
var E = Symbol.for("lit-noChange");
var A = Symbol.for("lit-nothing");
var C = /* @__PURE__ */ new WeakMap();
var P = l2.createTreeWalker(l2, 129);
function V(t5, i5) {
  if (!u2(t5) || !t5.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e3 ? e3.createHTML(i5) : i5;
}
var N = (t5, i5) => {
  const s4 = t5.length - 1, e6 = [];
  let n5, l4 = 2 === i5 ? "<svg>" : 3 === i5 ? "<math>" : "", c5 = v;
  for (let i6 = 0; i6 < s4; i6++) {
    const s5 = t5[i6];
    let a3, u3, d4 = -1, f3 = 0;
    for (; f3 < s5.length && (c5.lastIndex = f3, u3 = c5.exec(s5), null !== u3); ) f3 = c5.lastIndex, c5 === v ? "!--" === u3[1] ? c5 = _ : void 0 !== u3[1] ? c5 = m : void 0 !== u3[2] ? (y2.test(u3[2]) && (n5 = RegExp("</" + u3[2], "g")), c5 = p2) : void 0 !== u3[3] && (c5 = p2) : c5 === p2 ? ">" === u3[0] ? (c5 = n5 ?? v, d4 = -1) : void 0 === u3[1] ? d4 = -2 : (d4 = c5.lastIndex - u3[2].length, a3 = u3[1], c5 = void 0 === u3[3] ? p2 : '"' === u3[3] ? $ : g) : c5 === $ || c5 === g ? c5 = p2 : c5 === _ || c5 === m ? c5 = v : (c5 = p2, n5 = void 0);
    const x3 = c5 === p2 && t5[i6 + 1].startsWith("/>") ? " " : "";
    l4 += c5 === v ? s5 + r3 : d4 >= 0 ? (e6.push(a3), s5.slice(0, d4) + h2 + s5.slice(d4) + o3 + x3) : s5 + o3 + (-2 === d4 ? i6 : x3);
  }
  return [V(t5, l4 + (t5[s4] || "<?>") + (2 === i5 ? "</svg>" : 3 === i5 ? "</math>" : "")), e6];
};
var S2 = class _S {
  constructor({ strings: t5, _$litType$: i5 }, e6) {
    let r6;
    this.parts = [];
    let l4 = 0, a3 = 0;
    const u3 = t5.length - 1, d4 = this.parts, [f3, v5] = N(t5, i5);
    if (this.el = _S.createElement(f3, e6), P.currentNode = this.el.content, 2 === i5 || 3 === i5) {
      const t6 = this.el.content.firstChild;
      t6.replaceWith(...t6.childNodes);
    }
    for (; null !== (r6 = P.nextNode()) && d4.length < u3; ) {
      if (1 === r6.nodeType) {
        if (r6.hasAttributes()) for (const t6 of r6.getAttributeNames()) if (t6.endsWith(h2)) {
          const i6 = v5[a3++], s4 = r6.getAttribute(t6).split(o3), e7 = /([.?@])?(.*)/.exec(i6);
          d4.push({ type: 1, index: l4, name: e7[2], strings: s4, ctor: "." === e7[1] ? I : "?" === e7[1] ? L : "@" === e7[1] ? z : H }), r6.removeAttribute(t6);
        } else t6.startsWith(o3) && (d4.push({ type: 6, index: l4 }), r6.removeAttribute(t6));
        if (y2.test(r6.tagName)) {
          const t6 = r6.textContent.split(o3), i6 = t6.length - 1;
          if (i6 > 0) {
            r6.textContent = s2 ? s2.emptyScript : "";
            for (let s4 = 0; s4 < i6; s4++) r6.append(t6[s4], c3()), P.nextNode(), d4.push({ type: 2, index: ++l4 });
            r6.append(t6[i6], c3());
          }
        }
      } else if (8 === r6.nodeType) if (r6.data === n3) d4.push({ type: 2, index: l4 });
      else {
        let t6 = -1;
        for (; -1 !== (t6 = r6.data.indexOf(o3, t6 + 1)); ) d4.push({ type: 7, index: l4 }), t6 += o3.length - 1;
      }
      l4++;
    }
  }
  static createElement(t5, i5) {
    const s4 = l2.createElement("template");
    return s4.innerHTML = t5, s4;
  }
};
function M(t5, i5, s4 = t5, e6) {
  if (i5 === E) return i5;
  let h5 = void 0 !== e6 ? s4._$Co?.[e6] : s4._$Cl;
  const o6 = a2(i5) ? void 0 : i5._$litDirective$;
  return h5?.constructor !== o6 && (h5?._$AO?.(false), void 0 === o6 ? h5 = void 0 : (h5 = new o6(t5), h5._$AT(t5, s4, e6)), void 0 !== e6 ? (s4._$Co ??= [])[e6] = h5 : s4._$Cl = h5), void 0 !== h5 && (i5 = M(t5, h5._$AS(t5, i5.values), h5, e6)), i5;
}
var R = class {
  constructor(t5, i5) {
    this._$AV = [], this._$AN = void 0, this._$AD = t5, this._$AM = i5;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t5) {
    const { el: { content: i5 }, parts: s4 } = this._$AD, e6 = (t5?.creationScope ?? l2).importNode(i5, true);
    P.currentNode = e6;
    let h5 = P.nextNode(), o6 = 0, n5 = 0, r6 = s4[0];
    for (; void 0 !== r6; ) {
      if (o6 === r6.index) {
        let i6;
        2 === r6.type ? i6 = new k(h5, h5.nextSibling, this, t5) : 1 === r6.type ? i6 = new r6.ctor(h5, r6.name, r6.strings, this, t5) : 6 === r6.type && (i6 = new Z(h5, this, t5)), this._$AV.push(i6), r6 = s4[++n5];
      }
      o6 !== r6?.index && (h5 = P.nextNode(), o6++);
    }
    return P.currentNode = l2, e6;
  }
  p(t5) {
    let i5 = 0;
    for (const s4 of this._$AV) void 0 !== s4 && (void 0 !== s4.strings ? (s4._$AI(t5, s4, i5), i5 += s4.strings.length - 2) : s4._$AI(t5[i5])), i5++;
  }
};
var k = class _k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t5, i5, s4, e6) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t5, this._$AB = i5, this._$AM = s4, this.options = e6, this._$Cv = e6?.isConnected ?? true;
  }
  get parentNode() {
    let t5 = this._$AA.parentNode;
    const i5 = this._$AM;
    return void 0 !== i5 && 11 === t5?.nodeType && (t5 = i5.parentNode), t5;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t5, i5 = this) {
    t5 = M(this, t5, i5), a2(t5) ? t5 === A || null == t5 || "" === t5 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t5 !== this._$AH && t5 !== E && this._(t5) : void 0 !== t5._$litType$ ? this.$(t5) : void 0 !== t5.nodeType ? this.T(t5) : d2(t5) ? this.k(t5) : this._(t5);
  }
  O(t5) {
    return this._$AA.parentNode.insertBefore(t5, this._$AB);
  }
  T(t5) {
    this._$AH !== t5 && (this._$AR(), this._$AH = this.O(t5));
  }
  _(t5) {
    this._$AH !== A && a2(this._$AH) ? this._$AA.nextSibling.data = t5 : this.T(l2.createTextNode(t5)), this._$AH = t5;
  }
  $(t5) {
    const { values: i5, _$litType$: s4 } = t5, e6 = "number" == typeof s4 ? this._$AC(t5) : (void 0 === s4.el && (s4.el = S2.createElement(V(s4.h, s4.h[0]), this.options)), s4);
    if (this._$AH?._$AD === e6) this._$AH.p(i5);
    else {
      const t6 = new R(e6, this), s5 = t6.u(this.options);
      t6.p(i5), this.T(s5), this._$AH = t6;
    }
  }
  _$AC(t5) {
    let i5 = C.get(t5.strings);
    return void 0 === i5 && C.set(t5.strings, i5 = new S2(t5)), i5;
  }
  k(t5) {
    u2(this._$AH) || (this._$AH = [], this._$AR());
    const i5 = this._$AH;
    let s4, e6 = 0;
    for (const h5 of t5) e6 === i5.length ? i5.push(s4 = new _k(this.O(c3()), this.O(c3()), this, this.options)) : s4 = i5[e6], s4._$AI(h5), e6++;
    e6 < i5.length && (this._$AR(s4 && s4._$AB.nextSibling, e6), i5.length = e6);
  }
  _$AR(t5 = this._$AA.nextSibling, s4) {
    for (this._$AP?.(false, true, s4); t5 !== this._$AB; ) {
      const s5 = i3(t5).nextSibling;
      i3(t5).remove(), t5 = s5;
    }
  }
  setConnected(t5) {
    void 0 === this._$AM && (this._$Cv = t5, this._$AP?.(t5));
  }
};
var H = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t5, i5, s4, e6, h5) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t5, this.name = i5, this._$AM = e6, this.options = h5, s4.length > 2 || "" !== s4[0] || "" !== s4[1] ? (this._$AH = Array(s4.length - 1).fill(new String()), this.strings = s4) : this._$AH = A;
  }
  _$AI(t5, i5 = this, s4, e6) {
    const h5 = this.strings;
    let o6 = false;
    if (void 0 === h5) t5 = M(this, t5, i5, 0), o6 = !a2(t5) || t5 !== this._$AH && t5 !== E, o6 && (this._$AH = t5);
    else {
      const e7 = t5;
      let n5, r6;
      for (t5 = h5[0], n5 = 0; n5 < h5.length - 1; n5++) r6 = M(this, e7[s4 + n5], i5, n5), r6 === E && (r6 = this._$AH[n5]), o6 ||= !a2(r6) || r6 !== this._$AH[n5], r6 === A ? t5 = A : t5 !== A && (t5 += (r6 ?? "") + h5[n5 + 1]), this._$AH[n5] = r6;
    }
    o6 && !e6 && this.j(t5);
  }
  j(t5) {
    t5 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t5 ?? "");
  }
};
var I = class extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t5) {
    this.element[this.name] = t5 === A ? void 0 : t5;
  }
};
var L = class extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t5) {
    this.element.toggleAttribute(this.name, !!t5 && t5 !== A);
  }
};
var z = class extends H {
  constructor(t5, i5, s4, e6, h5) {
    super(t5, i5, s4, e6, h5), this.type = 5;
  }
  _$AI(t5, i5 = this) {
    if ((t5 = M(this, t5, i5, 0) ?? A) === E) return;
    const s4 = this._$AH, e6 = t5 === A && s4 !== A || t5.capture !== s4.capture || t5.once !== s4.once || t5.passive !== s4.passive, h5 = t5 !== A && (s4 === A || e6);
    e6 && this.element.removeEventListener(this.name, this, s4), h5 && this.element.addEventListener(this.name, this, t5), this._$AH = t5;
  }
  handleEvent(t5) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t5) : this._$AH.handleEvent(t5);
  }
};
var Z = class {
  constructor(t5, i5, s4) {
    this.element = t5, this.type = 6, this._$AN = void 0, this._$AM = i5, this.options = s4;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t5) {
    M(this, t5);
  }
};
var B = t2.litHtmlPolyfillSupport;
B?.(S2, k), (t2.litHtmlVersions ??= []).push("3.3.3");
var D = (t5, i5, s4) => {
  const e6 = s4?.renderBefore ?? i5;
  let h5 = e6._$litPart$;
  if (void 0 === h5) {
    const t6 = s4?.renderBefore ?? null;
    e6._$litPart$ = h5 = new k(i5.insertBefore(c3(), t6), t6, void 0, s4 ?? {});
  }
  return h5._$AI(t5), h5;
};

// node_modules/lit-element/lit-element.js
var s3 = globalThis;
var i4 = class extends y {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t5 = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t5.firstChild, t5;
  }
  update(t5) {
    const r6 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t5), this._$Do = D(r6, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return E;
  }
};
i4._$litElement$ = true, i4["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i4 });
var o4 = s3.litElementPolyfillSupport;
o4?.({ LitElement: i4 });
(s3.litElementVersions ??= []).push("4.2.2");

// node_modules/@lit/reactive-element/decorators/custom-element.js
var t3 = (t5) => (e6, o6) => {
  void 0 !== o6 ? o6.addInitializer(() => {
    customElements.define(t5, e6);
  }) : customElements.define(t5, e6);
};

// node_modules/@lit/reactive-element/decorators/property.js
var o5 = { attribute: true, type: String, converter: u, reflect: false, hasChanged: f };
var r4 = (t5 = o5, e6, r6) => {
  const { kind: n5, metadata: i5 } = r6;
  let s4 = globalThis.litPropertyMetadata.get(i5);
  if (void 0 === s4 && globalThis.litPropertyMetadata.set(i5, s4 = /* @__PURE__ */ new Map()), "setter" === n5 && ((t5 = Object.create(t5)).wrapped = true), s4.set(r6.name, t5), "accessor" === n5) {
    const { name: o6 } = r6;
    return { set(r7) {
      const n6 = e6.get.call(this);
      e6.set.call(this, r7), this.requestUpdate(o6, n6, t5, true, r7);
    }, init(e7) {
      return void 0 !== e7 && this.C(o6, void 0, t5, e7), e7;
    } };
  }
  if ("setter" === n5) {
    const { name: o6 } = r6;
    return function(r7) {
      const n6 = this[o6];
      e6.call(this, r7), this.requestUpdate(o6, n6, t5, true, r7);
    };
  }
  throw Error("Unsupported decorator location: " + n5);
};
function n4(t5) {
  return (e6, o6) => "object" == typeof o6 ? r4(t5, e6, o6) : ((t6, e7, o7) => {
    const r6 = e7.hasOwnProperty(o7);
    return e7.constructor.createProperty(o7, t6), r6 ? Object.getOwnPropertyDescriptor(e7, o7) : void 0;
  })(t5, e6, o6);
}

// node_modules/@lit/reactive-element/decorators/state.js
function r5(r6) {
  return n4({ ...r6, state: true, attribute: false });
}

// node_modules/@lit/reactive-element/decorators/base.js
var e4 = (e6, t5, c5) => (c5.configurable = true, c5.enumerable = true, Reflect.decorate && "object" != typeof t5 && Object.defineProperty(e6, t5, c5), c5);

// node_modules/@lit/reactive-element/decorators/query.js
function e5(e6, r6) {
  return (n5, s4, i5) => {
    const o6 = (t5) => t5.renderRoot?.querySelector(e6) ?? null;
    if (r6) {
      const { get: e7, set: r7 } = "object" == typeof s4 ? n5 : i5 ?? (() => {
        const t5 = Symbol();
        return { get() {
          return this[t5];
        }, set(e8) {
          this[t5] = e8;
        } };
      })();
      return e4(n5, s4, { get() {
        let t5 = e7.call(this);
        return void 0 === t5 && (t5 = o6(this), (null !== t5 || this.hasUpdated) && r7.call(this, t5)), t5;
      } });
    }
    return e4(n5, s4, { get() {
      return o6(this);
    } });
  };
}

// node_modules/@ro-kit/ui-widgets/dist/index.js
var _t = (t5) => {
  throw TypeError(t5);
};
var Et = (t5, e6, i5) => e6.has(t5) || _t("Cannot " + i5);
var I2 = (t5, e6, i5) => (Et(t5, e6, "read from private field"), i5 ? i5.call(t5) : e6.get(t5));
var $t = (t5, e6, i5) => e6.has(t5) ? _t("Cannot add the same private member more than once") : e6 instanceof WeakSet ? e6.add(t5) : e6.set(t5, i5);
var Ot = (t5, e6, i5, o6) => (Et(t5, e6, "write to private field"), o6 ? o6.call(t5, i5) : e6.set(t5, i5), i5);
var Nt = Object.defineProperty;
var W = (t5, e6, i5, o6) => {
  for (var s4 = void 0, r6 = t5.length - 1, n5; r6 >= 0; r6--)
    (n5 = t5[r6]) && (s4 = n5(e6, i5, s4) || s4);
  return s4 && Nt(e6, i5, s4), s4;
};
var dt = class dt2 extends i4 {
  constructor() {
    super(...arguments), this.dense = false;
  }
};
dt.shadowRootOptions = { ...i4.shadowRootOptions, delegatesFocus: true }, dt.styles = [i`
    :host {
        --rokit-primary-color-inner: var(--rokit-primary-color, #008877);
        --rokit-primary-color-transparent-inner: color-mix(in srgb, var(--rokit-primary-color-inner) 40%, transparent);
        --rokit-error-color-inner: var(--rokit-error-color, #F03333);
        --rokit-background-color-inner: var(--rokit-background-color, #FFF);
        --rokit-light-background-color-inner: var(--rokit-light-background-color, color-mix(in srgb, var(--rokit-background-color-inner) 97%, currentColor));
        --rokit-light-background-darker-color-inner: var(--rokit-light-background-darker-color, color-mix(in srgb, var(--rokit-light-background-color-inner) 80%, currentColor));
        --rokit-shadow-color-inner: var(--rokit-shadow-color, color-mix(in srgb, currentColor 40%, transparent));
        --rokit-list-indent-inner: var(--rokit-list-indent, 1em);
        --rokit-list-max-height-inner: var(--rokit-list-max-height, 300);
        --rokit-caret-size-inner: var(--rokit-caret-size, 0.5em);
        --rokit-transition-duration-inner: var(--rokit-transition-duration, 0.2s);
        display: inline-flex;
        font-size: 16px;
        position: relative;
    }
    :host(.loading)::part(loader):before {
        content: '';
        width: 0.7em;
        height: 0.7em;
        border: 0.15em solid;
        border-bottom-color: transparent;
        border-radius: 50%;
        animation: rotation-animation 0.8s linear infinite;
    }
    :host([dense]) { font-size: 14px; }
    @keyframes rotation-animation {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    `];
var g2 = dt;
W([
  n4({ type: Boolean, reflect: true })
], g2.prototype, "dense");
var k2;
var pt = class pt2 extends g2 {
  constructor() {
    super();
    $t(this, k2);
    this.value = "", this.clearable = false, this.required = false, this.disabled = false, Ot(this, k2, this.attachInternals());
  }
  checkValidity() {
    return I2(this, k2).checkValidity();
  }
  reportValidity() {
    const i5 = I2(this, k2).reportValidity();
    return this.classList.toggle("invalid", !i5), i5;
  }
  get validity() {
    return I2(this, k2).validity;
  }
  get validationMessage() {
    return I2(this, k2).validationMessage;
  }
  setCustomValidity(i5, o6) {
    i5 ? I2(this, k2).setValidity({ customError: true }, i5, o6) : I2(this, k2).setValidity({});
  }
  updateValidity(i5, o6, s4) {
    I2(this, k2).setValidity(i5, o6, s4);
  }
  setFormValue(i5, o6) {
    I2(this, k2).setFormValue(i5, o6);
  }
};
k2 = /* @__PURE__ */ new WeakMap(), pt.formAssociated = true, pt.styles = [...g2.styles, i`
    :host { align-items: center; padding: 6px 8px; border-bottom: 2px solid var(--rokit-light-background-darker-color-inner); box-sizing: border-box; }
    :host(:focus) { border-color: var(--rokit-primary-color-inner); }
    :host(.invalid) { border-color: var(--rokit-error-color-inner); }
    `];
var b3 = pt;
W([
  n4()
], b3.prototype, "name");
W([
  n4()
], b3.prototype, "value");
W([
  n4({ type: Boolean })
], b3.prototype, "clearable");
W([
  n4({ type: Boolean })
], b3.prototype, "required");
W([
  n4({ type: Boolean })
], b3.prototype, "disabled");
W([
  n4()
], b3.prototype, "label");
W([
  n4()
], b3.prototype, "placeholder");
function Tt(t5) {
  const e6 = t5.trim();
  if (e6.endsWith("ms")) {
    const i5 = Number(e6.slice(0, -2));
    return Number.isFinite(i5) ? i5 : 0;
  }
  if (e6.endsWith("s")) {
    const i5 = Number(e6.slice(0, -1));
    return Number.isFinite(i5) ? i5 * 1e3 : 0;
  }
  return 0;
}
var Gt = Object.defineProperty;
var Ut = Object.getOwnPropertyDescriptor;
var ut = (t5, e6, i5, o6) => {
  for (var s4 = o6 > 1 ? void 0 : o6 ? Ut(e6, i5) : e6, r6 = t5.length - 1, n5; r6 >= 0; r6--)
    (n5 = t5[r6]) && (s4 = (o6 ? n5(e6, i5, s4) : n5(s4)) || s4);
  return o6 && s4 && Gt(e6, i5, s4), s4;
};
var D2 = class extends g2 {
  constructor() {
    super(...arguments), this.icon = false, this.disabled = false, this.href = "";
  }
  render() {
    return !!this.href && !this.disabled ? b2`<a part="button loader" class="button" href="${this.href}"><slot></slot></a>` : b2`<button part="button loader" class="button" type="button" ?disabled="${this.disabled}"><slot></slot></button>`;
  }
};
D2.styles = [...g2.styles, i`
    :host { display: inline-flex; align-items: center; }
    :host([disabled]) { pointer-events: none; opacity: 0.5; }
    :host([rounded]) .button { border-radius: 200px; }
    :host([primary]) .button { color: white; background-color: var(--rokit-primary-color-inner); border-color: var(--rokit-primary-color-transparent-inner); }
    :host([primary][text]) .button { color: var(--rokit-primary-color-inner); }
    :host([primary]:not([text])) .button:hover { filter: brightness(115%); }
    :host([text]) .button { background-color: inherit; border-color: transparent; }
    :host([icon]) .button { width: 2em; height: 2em; border-radius: 50%; border-color: transparent; background-color: inherit; }
    :host([icon]) .button:hover, :host([text]) .button:hover { background-color: transparent; backdrop-filter: invert(20%) }
    :host(.clear) .button:before { content: '\u2715'; }
    :host(.caret) .button:before {
        content: '';
        position: absolute;
        width: var(--rokit-caret-size-inner);
        height: var(--rokit-caret-size-inner);
        border-color: currentColor;
        border-style: none solid solid none;
        border-width: calc(0.2 * var(--rokit-caret-size-inner));
        transform: translate(0, -0.15em) rotate(45deg);
        transition: transform var(--rokit-transition-duration-inner) ease-out;
    }
    :host(.caret.down) .button:before { transform: translate(0, 0.15em) rotate(225deg); }
    :host(.caret.right) .button:before { transform: translate(-0.15em, 0) rotate(-45deg); }
    .button {
        display: inline-flex;
        flex-grow: 1;
        gap: 0.5em;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        line-height: 1.2em;
        font-family: inherit;
        font-size: inherit;
        font-weight: 500;
        color: inherit;
        padding: 0.4em 0.6em;
        background-color: var(--rokit-light-background-color-inner);
        border: 1px solid var(--rokit-light-background-darker-color-inner);
        border-radius: 3px;
    }
    .button:hover { filter: brightness(102%); }
    `];
ut([
  n4({ type: Boolean, reflect: true })
], D2.prototype, "icon", 2);
ut([
  n4({ type: Boolean, reflect: true })
], D2.prototype, "disabled", 2);
ut([
  n4()
], D2.prototype, "href", 2);
D2 = ut([
  t3("rokit-button")
], D2);
var Xt = Object.defineProperty;
var Jt = Object.getOwnPropertyDescriptor;
var Mt = (t5) => {
  throw TypeError(t5);
};
var $2 = (t5, e6, i5, o6) => {
  for (var s4 = o6 > 1 ? void 0 : o6 ? Jt(e6, i5) : e6, r6 = t5.length - 1, n5; r6 >= 0; r6--)
    (n5 = t5[r6]) && (s4 = (o6 ? n5(e6, i5, s4) : n5(s4)) || s4);
  return o6 && s4 && Xt(e6, i5, s4), s4;
};
var Dt = (t5, e6, i5) => e6.has(t5) || Mt("Cannot " + i5);
var U = (t5, e6, i5) => (Dt(t5, e6, "read from private field"), i5 ? i5.call(t5) : e6.get(t5));
var gt = (t5, e6, i5) => e6.has(t5) ? Mt("Cannot add the same private member more than once") : e6 instanceof WeakSet ? e6.add(t5) : e6.set(t5, i5);
var it = (t5, e6, i5) => (Dt(t5, e6, "access private method"), i5);
var X;
var st;
var F;
var wt;
var yt;
var w2 = class extends g2 {
  constructor() {
    super(...arguments), gt(this, F), this.open = false, this.disabled = false, this.headerInactive = false, this.transitioning = false, this.closedBeforeTransition = false, gt(this, X, new MutationObserver(() => this.updateContentHeight())), gt(this, st, new IntersectionObserver((t5) => {
      t5.length && t5[0].isIntersecting && this.updateContentHeight();
    })), this.onMouseDown = (() => {
      this.closedBeforeTransition = !this.open && !this.transitioning;
    }).bind(this), this.onClickToggles = (() => {
      this.toggle(this.closedBeforeTransition, true);
    }).bind(this), this.onClickOpens = (() => {
      this.toggle(true, true);
    }).bind(this);
  }
  firstUpdated() {
    this.transitionDuration = Tt(getComputedStyle(this).getPropertyValue("--rokit-transition-duration-inner")), U(this, st).observe(this), it(this, F, yt).call(this);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), U(this, X).disconnect(), U(this, st).disconnect(), it(this, F, wt).call(this);
  }
  updated(t5) {
    t5.has("transitioning") && this.classList.toggle("transitioning", this.transitioning), (t5.has("disabled") || t5.has("headerInactive")) && (this.toggleButton.disabled = this.disabled, it(this, F, yt).call(this)), t5.has("open") && !this.transitioning && !this.disabled && this.toggle(this.open);
  }
  updateContentHeight() {
    setTimeout(() => {
      this.content.style.maxHeight = (this.maxHeight !== void 0 ? Math.min(this.maxHeight, this.content.scrollHeight) : this.content.scrollHeight) + "px", this.classList.toggle("has-content", this.content.style.maxHeight !== "0px");
    });
  }
  onSlotChange() {
    const t5 = this.shadowRoot.querySelector("#content > slot").assignedElements({ flatten: true });
    U(this, X).disconnect();
    for (const e6 of t5)
      U(this, X).observe(e6, { subtree: true, childList: true, characterData: true, attributes: true });
    this.updateContentHeight();
  }
  toggle(t5 = !this.open, e6 = false) {
    this.disabled || (this.transitioning = this.open !== t5, this.open = t5, this.toggleButton.classList.toggle("down", t5), setTimeout(() => {
      this.transitioning = false, this.open && e6 && this.content.scrollIntoView({ block: "nearest" });
    }, this.transitionDuration));
  }
  render() {
    return b2`
            <header part="header">
                <slot name="prefix" part="prefix"></slot>
                <span class="label"><slot name="label" part="label">${this.label}</slot></span>
                <slot name="pre-suffix" part="suffix"></slot>
                <rokit-button id="toggle" part="toggle" class="caret" icon ?dense="${this.dense}" title="${this.open ? "Collapse" : "Expand"}"></rokit-button>
                <slot name="suffix" part="suffix loader"></slot>
            </header>
            <div id="content" part="content">
                <slot @slotchange=${this.onSlotChange}></slot>
            </div>
        `;
  }
};
X = /* @__PURE__ */ new WeakMap();
st = /* @__PURE__ */ new WeakMap();
F = /* @__PURE__ */ new WeakSet();
wt = function() {
  this.header.removeEventListener("mousedown", this.onMouseDown), this.header.removeEventListener("click", this.onClickToggles), this.header.removeEventListener("click", this.onClickOpens), this.toggleButton.removeEventListener("mousedown", this.onMouseDown), this.toggleButton.removeEventListener("click", this.onClickToggles);
};
yt = function() {
  if (it(this, F, wt).call(this), !this.disabled) {
    if (this.headerInactive) {
      this.toggleButton.addEventListener("mousedown", this.onMouseDown), this.toggleButton.addEventListener("click", this.onClickToggles), this.header.addEventListener("click", this.onClickOpens);
      return;
    }
    this.header.addEventListener("mousedown", this.onMouseDown), this.header.addEventListener("click", this.onClickToggles);
  }
};
w2.styles = [...g2.styles, i`
        :host { display: flex; flex-direction: column; align-items: stretch; border-bottom: 2px solid var(--rokit-light-background-darker-color-inner); }
        :host header { cursor: pointer; }
        :host([dense]) header { padding: 2px 4px; }
        :host([maxheight]) #content { overflow:auto }
        :host(:not([open])) #content { max-height: 0 !important; }
        :host(:not([open])) #content, :host(.transitioning) #content { overflow: hidden !important; }
        :host([open]) #content, :host(.transitioning) #content { padding-top: 4px; }
        header { display: flex; align-items: center; padding: 6px 8px; background-color: var(--rokit-light-background-color-inner); user-select: none; }
        .label { flex-grow: 1; overflow: hidden; }
        #content { display: flex; transition: max-height var(--rokit-transition-duration-inner) ease-in-out; position: relative; scrollbar-width: thin; }
        #toggle { margin-left: 3px; }
    `];
$2([
  n4({ type: Boolean, reflect: true })
], w2.prototype, "open", 2);
$2([
  n4()
], w2.prototype, "label", 2);
$2([
  n4({ reflect: true })
], w2.prototype, "maxHeight", 2);
$2([
  n4({ type: Boolean })
], w2.prototype, "disabled", 2);
$2([
  n4({ type: Boolean })
], w2.prototype, "headerInactive", 2);
$2([
  e5("#content")
], w2.prototype, "content", 2);
$2([
  e5("#toggle")
], w2.prototype, "toggleButton", 2);
$2([
  e5("header")
], w2.prototype, "header", 2);
$2([
  r5()
], w2.prototype, "transitioning", 2);
w2 = $2([
  t3("rokit-collapsible")
], w2);
var Yt = Object.defineProperty;
var jt = Object.getOwnPropertyDescriptor;
var Wt = (t5) => {
  throw TypeError(t5);
};
var m2 = (t5, e6, i5, o6) => {
  for (var s4 = o6 > 1 ? void 0 : o6 ? jt(e6, i5) : e6, r6 = t5.length - 1, n5; r6 >= 0; r6--)
    (n5 = t5[r6]) && (s4 = (o6 ? n5(e6, i5, s4) : n5(s4)) || s4);
  return o6 && s4 && Yt(e6, i5, s4), s4;
};
var Pt = (t5, e6, i5) => e6.has(t5) || Wt("Cannot " + i5);
var vt = (t5, e6, i5) => (Pt(t5, e6, "read from private field"), i5 ? i5.call(t5) : e6.get(t5));
var It = (t5, e6, i5) => e6.has(t5) ? Wt("Cannot add the same private member more than once") : e6 instanceof WeakSet ? e6.add(t5) : e6.set(t5, i5);
var tt = (t5, e6, i5, o6) => (Pt(t5, e6, "write to private field"), e6.set(t5, i5), i5);
var J;
var q;
var p3 = class extends b3 {
  constructor() {
    super(), this.type = "text", this.readonly = false, this.sticky = false, this.minWidth = 80, this.autoGrowLabelWidth = false, It(this, J, ""), It(this, q), this.addEventListener("keydown", (t5) => {
      t5.code === "Escape" && this.blur();
    }), this.addEventListener("focus", () => {
      this.classList.add("has-focus");
    }), this.addEventListener("blur", () => {
      this.inputElement.scrollLeft = 0, this.classList.remove("has-focus");
    });
  }
  firstUpdated() {
    tt(this, J, this.value), this.inputElement.addEventListener("input", () => {
      this.value = this.inputElement.value, this.updateValidity(this.inputElement.validity, this.inputElement.validationMessage, this.inputElement), this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }), this.inputElement.addEventListener("change", () => {
      this.value = this.inputElement.value, this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }), this.autoGrowLabelWidth && (tt(this, q, new IntersectionObserver((t5) => {
      t5.length && t5[0].isIntersecting && this.updateMinWidth();
    })), vt(this, q).observe(this));
  }
  disconnectedCallback() {
    vt(this, q)?.disconnect(), tt(this, q, void 0), super.disconnectedCallback();
  }
  updateMinWidth() {
    const t5 = this.shadowRoot.querySelector(".wrapper");
    if (t5) {
      const e6 = this.shadowRoot?.querySelector("label")?.scrollWidth || 0, i5 = this.minWidth > e6 ? this.minWidth : e6;
      t5.style.minWidth = i5 > 0 ? i5 + "px" : "";
    }
  }
  updated(t5) {
    t5.has("label") && (this.classList.toggle("has-label", this.label !== void 0 && this.label !== ""), this.autoGrowLabelWidth && this.updateMinWidth()), t5.has("min") && (this.inputElement.min = this.min || ""), t5.has("max") && (this.inputElement.max = this.max || ""), t5.has("step") && (this.inputElement.step = this.step || ""), t5.has("placeholder") && (this.inputElement.placeholder = this.placeholder || ""), t5.has("pattern") && (this.inputElement.pattern = this.pattern || ""), t5.has("minLength") && (this.inputElement.minLength = this.minLength === void 0 ? -1 : this.minLength), t5.has("maxLength") && (this.inputElement.maxLength = this.maxLength === void 0 ? -1 : this.maxLength), t5.has("value") && (this.classList.toggle("has-value", this.value !== ""), this.setFormValue(this.value), this.updateValidity(this.inputElement.validity, this.inputElement.validationMessage, this.inputElement), this.value !== vt(this, J) && tt(this, J, this.value));
  }
  clear() {
    this.disabled || (this.inputElement.value = "", this.value = "", this.dispatchEvent(new CustomEvent("change", { bubbles: true, composed: true })), this.blur());
  }
  renderInput() {
    return b2`<input id="input" part="input" size="1" name="${this.name}" type="${this.type}" autocomplete="off" ?disabled="${this.disabled}" ?readonly="${this.readonly}" ?required="${this.required}" .value="${this.type === "file" ? "" : this.value}">`;
  }
  render() {
    return b2`
            <slot name="prefix" part="prefix"></slot>
            <div class="wrapper">
                <label for="input" part="label">${this.label}</label>
                ${this.renderInput()}
                ${this.clearable ? b2`
                    <rokit-button class="clear" icon ?dense="${this.dense}" @mousedown="${(t5) => {
      t5.preventDefault();
    }}" @click="${(t5) => {
      t5.stopPropagation(), this.clear();
    }}" title="Clear"></rokit-button>
                ` : A}
            </div>
            <slot name="suffix" part="suffix loader"></slot>
            <div class="supporting-text" part="supportingText">
                <slot name="supportingText">${this.supportingText}</slot>
            </div>
        `;
  }
};
J = /* @__PURE__ */ new WeakMap();
q = /* @__PURE__ */ new WeakMap();
p3.styles = [...b3.styles, i`
        :host { background-color: var(--rokit-light-background-color-inner); user-select: none; flex-wrap: wrap; }
        :host([dense]) { padding: 2px 4px; }
        :host(.has-focus:not([readonly])) label, :host(.has-value) label, :host([sticky]) label { font-size: 0.75em; top: 0.5em; font-weight: 600; }
        :host(.has-focus) label { color: var(--rokit-primary-color-inner); }
        .wrapper { display: flex; position: relative; flex-grow: 1; align-items: center; }
        label { position: absolute; top: 50%; transform: translate(0, -50%); transition-property: top, font-size; transition-duration: var(--rokit-transition-duration-inner); max-width: 100%; overflow: hidden; pointer-events: none; white-space: nowrap; }
        #input { height: 1.3em; border: 0; outline: 0; flex-grow: 1; font-size: 1em; background: none; padding: 0; color: currentColor; font-family: inherit; text-overflow: ellipsis; }
        #input[type='file'] { padding-bottom: 3px; }
        #input[readonly] { caret-color: transparent; }
        #input[readonly]::placeholder { color: transparent; }
        :host(.has-label) #input { margin-top: 0.9em; }
        :host(.has-label:not(.has-focus):not(.has-value):not([sticky])) #input { clip-path: polygon(0 0, 0 0, 0 0, 0 0); }
        :host(:not(.has-value)) .clear { visibility: hidden; }
        .supporting-text { width: 100%; font-size: 0.8em; }
    `];
m2([
  n4()
], p3.prototype, "type", 2);
m2([
  n4({ type: Boolean, reflect: true })
], p3.prototype, "readonly", 2);
m2([
  n4({ type: Boolean, reflect: true })
], p3.prototype, "sticky", 2);
m2([
  n4()
], p3.prototype, "pattern", 2);
m2([
  n4()
], p3.prototype, "minLength", 2);
m2([
  n4()
], p3.prototype, "maxLength", 2);
m2([
  n4()
], p3.prototype, "min", 2);
m2([
  n4()
], p3.prototype, "max", 2);
m2([
  n4()
], p3.prototype, "step", 2);
m2([
  n4()
], p3.prototype, "minWidth", 2);
m2([
  n4({ type: Boolean })
], p3.prototype, "autoGrowLabelWidth", 2);
m2([
  n4()
], p3.prototype, "supportingText", 2);
m2([
  e5("#input")
], p3.prototype, "inputElement", 2);
p3 = m2([
  t3("rokit-input")
], p3);
var Qt = Object.defineProperty;
var Zt = Object.getOwnPropertyDescriptor;
var zt = (t5) => {
  throw TypeError(t5);
};
var c4 = (t5, e6, i5, o6) => {
  for (var s4 = o6 > 1 ? void 0 : o6 ? Zt(e6, i5) : e6, r6 = t5.length - 1, n5; r6 >= 0; r6--)
    (n5 = t5[r6]) && (s4 = (o6 ? n5(e6, i5, s4) : n5(s4)) || s4);
  return o6 && s4 && Qt(e6, i5, s4), s4;
};
var Kt = (t5, e6, i5) => e6.has(t5) || zt("Cannot " + i5);
var L2 = (t5, e6, i5) => (Kt(t5, e6, "read from private field"), i5 ? i5.call(t5) : e6.get(t5));
var V2 = (t5, e6, i5) => e6.has(t5) ? zt("Cannot add the same private member more than once") : e6 instanceof WeakSet ? e6.add(t5) : e6.set(t5, i5);
var et = (t5, e6, i5, o6) => (Kt(t5, e6, "write to private field"), e6.set(t5, i5), i5);
var H2;
var ot;
var Y;
var rt;
var nt;
var at;
var d3 = class extends b3 {
  constructor() {
    super(), this.emptyMessage = "Nothing to select", this.collapsibleOrientationLeft = "0", this.collapsibleOrientationRight = "0", this.collapsibleWidth = "", this.autoGrowLabelWidth = false, this.fixedOpen = false, this.collapse = false, this.filterableThreshold = 15, this.itemCount = 0, this.toggleOnHeaderClick = true, V2(this, H2, ""), V2(this, ot, ""), V2(this, Y, new MutationObserver(() => this.onSlotChange())), V2(this, rt, () => {
      this.collapsible?.toggle(true);
    }), V2(this, nt, (t5) => {
      const e6 = t5.relatedTarget;
      e6 && (e6 === this || this.shadowRoot?.contains(e6)) || (this.checkInputValue(), this.collapsible?.toggle(false));
    }), V2(this, at, () => {
      this.collapsible?.toggle(true);
    }), this.addEventListener("focusin", L2(this, rt)), this.addEventListener("focusout", L2(this, nt)), this.addEventListener("input", L2(this, at));
  }
  disconnectedCallback() {
    L2(this, Y).disconnect(), this.removeEventListener("focusin", L2(this, rt)), this.removeEventListener("focusout", L2(this, nt)), this.removeEventListener("input", L2(this, at)), super.disconnectedCallback();
  }
  firstUpdated() {
    et(this, H2, this.value), et(this, ot, getComputedStyle(this).getPropertyValue("--rokit-list-indent-inner")), this.input.placeholder = this.placeholder === void 0 ? "Type to filter list..." : this.placeholder, this.input.label = this.label, this.inputMinWidth !== void 0 && (this.input.minWidth = this.inputMinWidth), setTimeout(() => {
      this.collapsible.maxHeight = parseInt(this.collapsibleMaxHeight !== void 0 ? this.collapsibleMaxHeight : getComputedStyle(this).getPropertyValue("--rokit-list-max-height-inner")), this.collapsible.content.style.width = this.collapsibleWidth, this.collapsible.content.style.left = this.collapsibleOrientationLeft, this.collapsible.content.style.right = this.collapsibleOrientationRight;
    });
  }
  updated(t5) {
    if (t5.has("selectedItem")) {
      const e6 = this.value;
      this.value = this.selectedItem ? this.itemValue(this.selectedItem) : "", this.input.value = this.selectedItem ? this.itemText(this.selectedItem) : this.value, this.title || (this.input.title = this.input.value), this.classList.toggle("has-value", this.value !== ""), this.setFormValue(this.value), this.required && this.value === "" ? this.updateValidity({ valueMissing: true }, "Please select a value", this.listContainer) : this.updateValidity(), e6 !== this.value && this.dispatchEvent(new CustomEvent("change", { bubbles: true }));
    }
    t5.has("value") && this.selectItem(this.findItem(this.value)), t5.has("disabled") && (this.input.disabled = this.disabled, this.collapsible.disabled = this.disabled), t5.has("supportingText") && (this.input.supportingText = this.supportingText), (t5.has("filterableThreshold") || t5.has("itemCount")) && (this.input.readonly = this.filterableThreshold < 0 || this.itemCount < this.filterableThreshold, this.toggleOnHeaderClick = this.input.readonly), this.collapsible?.toggleButton && (this.collapsible.toggleButton.style.display = this.listContainer.childElementCount === 0 ? "none" : ""), t5.has("fixedOpen") && (this.collapsible.open = this.fixedOpen, this.collapsible.disabled = this.fixedOpen);
  }
  checkInputValue(t5 = true) {
    if (this.input.value) {
      if (this.selectedItem && this.itemText(this.selectedItem) === this.input.value)
        return;
      const e6 = this.findItem(this.input.value);
      if (e6) {
        this.selectItem(e6);
        return;
      }
    }
    t5 && (this.input.value = "", this.input.title = "", et(this, H2, ""), this.selectItem(null, false));
  }
  filter(t5) {
    t5 = t5.toLowerCase();
    let e6 = true;
    for (const i5 of this.listContainer.querySelectorAll("li"))
      if (i5.id !== "noresult") {
        const o6 = this.itemText(i5).toLowerCase().indexOf(t5) == -1 && (!i5.dataset.value || i5.dataset.value.toLowerCase().indexOf(t5) == -1);
        i5.classList.toggle("hidden", o6), this.collapse && (i5.classList.remove("open"), i5.querySelector("ul")?.classList.remove("open")), o6 || (e6 = false);
      }
    for (const i5 of this.listContainer.querySelectorAll("li:has(li:not(.hidden))"))
      i5.classList.remove("hidden"), t5 && this.collapse && (i5.classList.add("open"), i5.querySelector("ul")?.classList.add("open")), e6 = false;
    this.highlightItem(null), this.listContainer.querySelector("#noresult")?.classList.toggle("hidden", !e6);
  }
  selectItem(t5, e6 = true, i5 = false) {
    t5?.getAttribute("disabled") !== null && (t5 = null), this.selectedItem = t5, this.filter(""), this.highlightItem(t5, false), e6 && this.value && et(this, H2, this.value), i5 && setTimeout(() => this.blur());
  }
  findItem(t5) {
    let e6 = null;
    if (t5)
      for (const i5 of this.listContainer.querySelectorAll("li")) {
        if (i5.dataset.value === t5)
          return i5;
        this.itemText(i5) === t5 && (e6 = i5);
      }
    return e6;
  }
  highlightItem(t5, e6 = true) {
    if (this.listContainer.querySelector("li.active")?.classList.remove("active"), t5) {
      if (e6 && this.listContainer.focus(), t5.classList.add("active"), this.collapse)
        for (let i5 = t5.closest("ul"); i5; i5 = i5.parentElement.closest("ul"))
          i5.classList.add("open"), i5.closest("li")?.classList.add("open");
      this.collapsible.open && t5.scrollIntoView({ block: "nearest" });
    }
  }
  highlightNextItem() {
    const t5 = this.listContainer.querySelector("li.active");
    let e6 = t5;
    const i5 = this.listContainer.querySelectorAll("ul.open > li:not([disabled]):not(.hidden):not(.divider)");
    if (t5) {
      for (let o6 = 0; o6 < i5.length; o6++)
        if (i5[o6] === t5 && o6 < i5.length - 1) {
          e6 = i5[o6 + 1];
          break;
        }
    } else i5.length > 0 && (e6 = i5[0]);
    this.highlightItem(e6);
  }
  highlightPreviousItem() {
    const t5 = this.listContainer.querySelector("li.active");
    let e6 = null;
    if (t5) {
      const i5 = this.listContainer.querySelectorAll("ul.open > li:not([disabled]):not(.hidden):not(.divider)");
      for (let o6 = 0; o6 < i5.length; o6++)
        if (i5[o6] === t5 && o6 > 0) {
          e6 = i5[o6 - 1];
          break;
        }
    }
    this.highlightItem(e6), e6 || this.input.focus();
  }
  itemValue(t5) {
    return t5.dataset.value || this.itemText(t5) || "";
  }
  itemText(t5) {
    return t5.querySelector("div > div")?.innerText || "";
  }
  elementText(t5) {
    let e6 = "";
    for (const i5 of t5.childNodes)
      i5.nodeType == 3 && (e6 += i5.nodeValue?.trim());
    return e6;
  }
  onSlotChange() {
    this.listContainer.replaceChildren(), this.itemCount = 0;
    let t5 = null;
    const e6 = this.shadowRoot.querySelector("#list-container-slot").assignedElements();
    if (e6?.length === 1 && (t5 = Array.prototype.slice.call(e6[0].querySelectorAll(":scope > li")), this.copyItems(t5, this.listContainer), L2(this, Y).disconnect(), L2(this, Y).observe(e6[0], { subtree: true, childList: true, characterData: true, attributes: true })), this.emptyMessage) {
      const i5 = document.createElement("li");
      i5.id = "noresult", i5.setAttribute("disabled", ""), i5.innerText = this.emptyMessage, this.listContainer.appendChild(i5), t5 && t5.length > 0 && i5.classList.add("hidden");
    }
    this.value = this.value || L2(this, H2), this.selectItem(this.findItem(this.value));
  }
  copyItems(t5, e6, i5 = 0) {
    if (this.sort !== void 0) {
      const s4 = this.sort || "asc";
      t5 = t5.sort((r6, n5) => s4 === "desc" ? (this.elementText(n5) || this.itemValue(n5)).localeCompare(this.elementText(r6) || this.itemValue(r6)) : (this.elementText(r6) || this.itemValue(r6)).localeCompare(this.elementText(n5) || this.itemValue(n5)));
    }
    let o6 = "";
    i5 > 0 && (o6 = `calc(0.3em + ${i5}*${L2(this, ot)})`);
    for (const s4 of t5) {
      const r6 = s4.cloneNode();
      r6.replaceChildren();
      const n5 = document.createElement("div");
      o6 && (n5.style.paddingLeft = o6);
      const u3 = document.createElement("div");
      n5.appendChild(u3);
      for (const z3 of s4.childNodes)
        if (z3.nodeName !== "UL") {
          const C3 = z3.cloneNode(true);
          C3.nodeType === 3 && C3.nodeValue && (C3.nodeValue = C3.nodeValue.trim()), u3.appendChild(C3);
        }
      r6.appendChild(n5), r6.title = r6.title || this.itemText(r6);
      const Lt = s4.querySelector("ul");
      if (Lt?.childElementCount) {
        const z3 = document.createElement("ul");
        if (r6.appendChild(z3), this.copyItems(Array.prototype.slice.call(Lt.children), z3, i5 + 1), this.collapse) {
          const C3 = new D2();
          C3.dense = true, C3.icon = true, C3.classList.add("toggle-node", "caret"), C3.addEventListener("click", (At) => {
            At.stopPropagation(), r6.classList.toggle("open"), z3.classList.toggle("open"), this.collapsible.updateContentHeight();
          }), n5.prepend(C3);
        } else
          z3.classList.add("open");
      }
      e6.appendChild(r6), this.itemCount++;
    }
  }
  render() {
    return b2`
            <rokit-collapsible ?dense="${this.dense}" part="collapsible" ?headerInactive="${!this.toggleOnHeaderClick}">
                <slot name="prefix" part="prefix" slot="prefix"></slot>
                <slot name="suffix" part="suffix loader" slot="suffix"></slot>
                <rokit-input id="input" slot="label" exportparts="supportingText"
                    ?clearable="${this.clearable}"
                    ?dense="${this.dense}"
                    @change="${() => {
      this.checkInputValue(this.input.inputElement.value === "" || !this.collapsible.open);
    }}"
                    @input="${() => {
      this.filter(this.input.inputElement.value);
    }}"
                    ?autoGrowLabelWidth="${this.autoGrowLabelWidth}"
                    @keydown="${(t5) => {
      switch (t5.code) {
        case "ArrowDown":
          t5.preventDefault(), this.highlightNextItem();
          break;
        case "Enter": {
          const e6 = this.findItem(this.input.value);
          e6 ? this.selectItem(e6, true, true) : this.filter(this.input.value);
          break;
        }
      }
    }}"
                ></rokit-input>
                <ul id="list-container" tabindex="-1" part="list" class="open"
                    @mousedown="${(t5) => {
      t5.preventDefault();
    }}"
                    @click="${(t5) => {
      const e6 = t5.target.closest("li");
      e6 && e6.getAttribute("disabled") === null && !e6.classList.contains("divider") && this.selectItem(e6, true, true);
    }}"
                    @keydown="${(t5) => {
      switch (t5.code) {
        case "Enter":
          this.selectItem(this.listContainer.querySelector("li.active"), true, true);
          break;
        case "ArrowDown":
          t5.preventDefault(), this.highlightNextItem();
          break;
        case "ArrowUp":
          t5.preventDefault(), this.highlightPreviousItem();
          break;
        case "ArrowRight":
          if (this.collapse) {
            const e6 = this.listContainer.querySelector("li.active");
            e6 && (t5.preventDefault(), e6.classList.add("open"), e6.querySelector("ul")?.classList.add("open"), this.collapsible.updateContentHeight());
          }
          break;
        case "ArrowLeft":
          if (this.collapse) {
            const e6 = this.listContainer.querySelector("li.active");
            e6 && (t5.preventDefault(), e6.classList.remove("open"), e6.querySelector("ul")?.classList.remove("open"), this.collapsible.updateContentHeight());
          }
          break;
        case "Escape":
          this.listContainer.blur();
          break;
      }
    }}">
                </ul>
                <slot id="list-container-slot" @slotchange=${this.onSlotChange}></slot>
            </rokit-collapsible>
        `;
  }
};
H2 = /* @__PURE__ */ new WeakMap();
ot = /* @__PURE__ */ new WeakMap();
Y = /* @__PURE__ */ new WeakMap();
rt = /* @__PURE__ */ new WeakMap();
nt = /* @__PURE__ */ new WeakMap();
at = /* @__PURE__ */ new WeakMap();
d3.styles = [...b3.styles, i`
        :host { background-color: var(--rokit-light-background-color-inner); user-select: none; padding: 0; }
        :host([dense]) {
            li > div { padding: 4px 2px; }
            li.large > div, li.header > div { padding-top: 6px; padding-bottom: 6px; }
        }
        #input { padding: 0; background-color: inherit; }
        rokit-collapsible, #input { display: flex; flex-grow: 1; border: 0; max-width: 100%; }
        rokit-collapsible::part(content) { display: flex; flex-direction: column; padding-top: 0; outline: 0; background-color: var(--rokit-background-color-inner); border-color: var(--rokit-light-background-color-inner); border-width: 0 2px 0 2px; border-style: solid; }
        rokit-collapsible::part(header) { background-color: inherit !important; }
        :host(:not([fixedOpen])) {
            rokit-collapsible::part(content) { position: absolute; z-index: 1000; top: calc(100% + 2px); }
            rokit-collapsible[open].has-content::part(content), rokit-collapsible.has-content.transitioning::part(content) { box-shadow: 0 0 10px var(--rokit-shadow-color-inner); clip-path: inset(0 -13px -13px 0); }
        }
        #list-container { outline: 0; }
        #list-container-slot { display: none; }
        ul { list-style-type: none; margin: 0; padding: 0; width: 100%; box-sizing: border-box; }
        li > div, #noresult { display: flex; align-items:center; line-height: 1em; padding: 8px; white-space: nowrap; transition: all calc(0.5 * var(--rokit-transition-duration-inner)); }
        li:not([disabled]):not(.divider) { cursor: pointer }
        li:not([disabled]):not(.divider) > div:hover { background-color: var(--rokit-light-background-color-inner); }
        li.active > div { color: var(--rokit-primary-color-inner); background-color: var(--rokit-light-background-color-inner); }
        li.divider { border-top: 1px solid var(--rokit-light-background-darker-color-inner); height: 0; padding: 0; }
        li.divider, li.header { pointer-events: none; }
        li.header > div { font-size: 0.7rem; font-weight: bold; padding-top: 8px; }
        li.large > div { padding-top: 10px; padding-bottom: 10px; }
        .hidden { display: none !important; }
        :host([collapse]) li > div { padding-left: 0; }
        :host([collapse]) .toggle-node { position: absolute }
        :host([collapse]) li > div > div { padding-left: 1.8em; }
        :host([collapse]) ul:not(.open) { display: none; }
        :host([collapse]) li:not(.open) > div > .toggle-node::part(button):before { transform: translate(0, 0) rotate(-45deg); }
    `];
c4([
  n4()
], d3.prototype, "emptyMessage", 2);
c4([
  n4()
], d3.prototype, "sort", 2);
c4([
  n4()
], d3.prototype, "collapsibleMaxHeight", 2);
c4([
  n4()
], d3.prototype, "collapsibleOrientationLeft", 2);
c4([
  n4()
], d3.prototype, "collapsibleOrientationRight", 2);
c4([
  n4()
], d3.prototype, "collapsibleWidth", 2);
c4([
  n4({ type: Boolean })
], d3.prototype, "autoGrowLabelWidth", 2);
c4([
  n4({ type: Boolean, reflect: true })
], d3.prototype, "fixedOpen", 2);
c4([
  n4()
], d3.prototype, "inputMinWidth", 2);
c4([
  n4({ type: Boolean, reflect: true })
], d3.prototype, "collapse", 2);
c4([
  n4()
], d3.prototype, "filterableThreshold", 2);
c4([
  n4()
], d3.prototype, "supportingText", 2);
c4([
  e5("rokit-collapsible")
], d3.prototype, "collapsible", 2);
c4([
  e5("#input")
], d3.prototype, "input", 2);
c4([
  e5("#list-container")
], d3.prototype, "listContainer", 2);
c4([
  r5()
], d3.prototype, "selectedItem", 2);
c4([
  r5()
], d3.prototype, "itemCount", 2);
c4([
  r5()
], d3.prototype, "toggleOnHeaderClick", 2);
d3 = c4([
  t3("rokit-select")
], d3);
var te = Object.defineProperty;
var ee = Object.getOwnPropertyDescriptor;
var Vt = (t5) => {
  throw TypeError(t5);
};
var ft = (t5, e6, i5, o6) => {
  for (var s4 = o6 > 1 ? void 0 : o6 ? ee(e6, i5) : e6, r6 = t5.length - 1, n5; r6 >= 0; r6--)
    (n5 = t5[r6]) && (s4 = (o6 ? n5(e6, i5, s4) : n5(s4)) || s4);
  return o6 && s4 && te(e6, i5, s4), s4;
};
var Bt = (t5, e6, i5) => e6.has(t5) || Vt("Cannot " + i5);
var B2 = (t5, e6, i5) => (Bt(t5, e6, "read from private field"), i5 ? i5.call(t5) : e6.get(t5));
var St = (t5, e6, i5) => e6.has(t5) ? Vt("Cannot add the same private member more than once") : e6 instanceof WeakSet ? e6.add(t5) : e6.set(t5, i5);
var mt = (t5, e6, i5, o6) => (Bt(t5, e6, "write to private field"), e6.set(t5, i5), i5);
var T2;
var j;
var N2 = class extends p3 {
  constructor() {
    super(...arguments), this.resize = "none", this.rows = 3, St(this, T2), St(this, j, () => this.autoResize());
  }
  firstUpdated() {
    super.firstUpdated(), this.applyDimensions(), this.applyResizeBehavior();
  }
  updated(t5) {
    super.updated(t5), (t5.has("rows") || t5.has("cols")) && this.applyDimensions(), t5.has("resize") && this.applyResizeBehavior(), this.resize === "auto" && t5.has("value") && this.autoResize();
  }
  disconnectedCallback() {
    this.inputElement?.removeEventListener("input", B2(this, j)), B2(this, T2)?.disconnect(), mt(this, T2, void 0), super.disconnectedCallback();
  }
  applyDimensions() {
    this.inputElement.rows = this.rows, this.inputElement.cols = this.cols === void 0 ? 20 : this.cols;
  }
  applyResizeBehavior() {
    if (this.inputElement.removeEventListener("input", B2(this, j)), B2(this, T2)?.disconnect(), mt(this, T2, void 0), this.resize === "auto") {
      this.inputElement.style.resize = "none", this.inputElement.addEventListener("input", B2(this, j)), mt(this, T2, new IntersectionObserver((t5) => {
        t5.length && t5[0].isIntersecting && this.autoResize();
      })), B2(this, T2).observe(this), this.autoResize();
      return;
    }
    this.inputElement.style.resize = this.resize, this.inputElement.style.height = "";
  }
  autoResize() {
    this.inputElement.style.height = "", this.inputElement.style.height = this.inputElement.scrollHeight + "px";
  }
  onSlotChange() {
    const t5 = this.shadowRoot.querySelector("#content").assignedNodes().map((e6) => e6.textContent).join("");
    t5.trim() !== "" && (this.value = t5);
  }
  renderInput() {
    return b2`
        <textarea id="input" part="input" autocomplete="off" name="${this.name}" ?disabled="${this.disabled}" ?readonly="${this.readonly}" ?required="${this.required}" .value="${this.value}"></textarea>
        <slot id="content" @slotchange=${this.onSlotChange}></slot>
        `;
  }
};
T2 = /* @__PURE__ */ new WeakMap();
j = /* @__PURE__ */ new WeakMap();
N2.styles = [...p3.styles, i`
        :host, .wrapper { align-items: flex-start; }
        #input { height: initial; }
        #content { display: none; }
    `];
ft([
  n4()
], N2.prototype, "resize", 2);
ft([
  n4({ type: Number })
], N2.prototype, "rows", 2);
ft([
  n4({ type: Number })
], N2.prototype, "cols", 2);
N2 = ft([
  t3("rokit-textarea")
], N2);
var ie = Object.defineProperty;
var se = Object.getOwnPropertyDescriptor;
var Rt = (t5) => {
  throw TypeError(t5);
};
var O = (t5, e6, i5, o6) => {
  for (var s4 = o6 > 1 ? void 0 : o6 ? se(e6, i5) : e6, r6 = t5.length - 1, n5; r6 >= 0; r6--)
    (n5 = t5[r6]) && (s4 = (o6 ? n5(e6, i5, s4) : n5(s4)) || s4);
  return o6 && s4 && ie(e6, i5, s4), s4;
};
var qt = (t5, e6, i5) => e6.has(t5) || Rt("Cannot " + i5);
var l3 = (t5, e6, i5) => (qt(t5, e6, "read from private field"), i5 ? i5.call(t5) : e6.get(t5));
var bt = (t5, e6, i5) => e6.has(t5) ? Rt("Cannot add the same private member more than once") : e6 instanceof WeakSet ? e6.add(t5) : e6.set(t5, i5);
var R2 = (t5, e6, i5, o6) => (qt(t5, e6, "write to private field"), e6.set(t5, i5), i5);
var h3;
var v2;
var A2;
var M2 = 18;
var S3 = class extends p3 {
  constructor() {
    super(...arguments), this.labelFormatter = (t5) => String(Math.round(t5 * 1e3) / 1e3), bt(this, h3, [0, 1]), bt(this, v2, [l3(this, h3)[0], l3(this, h3)[1]]), bt(this, A2);
  }
  firstUpdated() {
    super.firstUpdated(), this.sliderElement.addEventListener("mousedown", (t5) => this.onKnobDrag(t5)), this.sliderElement.addEventListener("touchstart", (t5) => this.onKnobDrag(t5)), new ResizeObserver(() => {
      this.updateKnobPositions();
    }).observe(this.sliderElement);
  }
  updated(t5) {
    if (super.updated(t5), t5.has("min") && (l3(this, h3)[0] = parseFloat(this.min || "0"), l3(this, h3)[1] = Math.max(l3(this, h3)[0], l3(this, h3)[1])), t5.has("max") && (l3(this, h3)[1] = parseFloat(this.max || "1"), l3(this, h3)[0] = Math.min(l3(this, h3)[0], l3(this, h3)[1])), t5.has("step") && R2(this, A2, this.step ? parseFloat(this.step) : void 0), t5.has("value") || t5.has("min") || t5.has("max") || t5.has("step"))
      if (this.value !== void 0 && this.value !== "")
        if (this.range !== void 0)
          try {
            const e6 = JSON.parse(this.value);
            Array.isArray(e6) && e6.length === 2 && Number.isFinite(e6[0]) && Number.isFinite(e6[1]) ? R2(this, v2, [this.applyConstraints(Number(e6[0])), this.applyConstraints(Number(e6[1]))]) : R2(this, v2, [l3(this, h3)[0], l3(this, h3)[1]]);
          } catch {
            R2(this, v2, [l3(this, h3)[0], l3(this, h3)[1]]);
          }
        else {
          const e6 = parseFloat(this.value);
          R2(this, v2, [this.applyConstraints(Number.isFinite(e6) ? e6 : l3(this, h3)[0])]);
        }
      else
        R2(this, v2, this.range !== void 0 ? [l3(this, h3)[0], l3(this, h3)[1]] : [l3(this, h3)[0]]);
    this.updateKnobPositions();
  }
  // overridden to provide suitable anchor
  updateValidity(t5, e6) {
    super.updateValidity(t5, e6, this.sliderElement);
  }
  chooseKnob(t5) {
    if (!this.endKnob)
      return this.startKnob;
    let e6 = Math.abs(t5 - this.startKnob.offsetLeft) < Math.abs(t5 - this.endKnob.offsetLeft) ? this.startKnob : this.endKnob;
    return this.startKnob.value === this.endKnob.value && (e6.id === "start" && e6.value === l3(this, h3)[0] ? e6 = this.endKnob : e6.id === "end" && e6.value === l3(this, h3)[1] && (e6 = this.startKnob)), e6;
  }
  toScreenSpace(t5) {
    const e6 = this.track.offsetWidth, i5 = l3(this, h3)[1] - l3(this, h3)[0];
    return e6 <= 0 || i5 <= 0 ? 0 : (t5 - l3(this, h3)[0]) / i5 * e6;
  }
  toValueSpace(t5) {
    const e6 = this.track.offsetWidth, i5 = l3(this, h3)[1] - l3(this, h3)[0];
    return e6 <= 0 || i5 <= 0 ? l3(this, h3)[0] : t5 / e6 * i5 + l3(this, h3)[0];
  }
  applyConstraints(t5, e6) {
    let i5 = Math.min(Math.max(t5, l3(this, h3)[0]), l3(this, h3)[1]);
    return l3(this, A2) && (i5 = l3(this, h3)[0] + Math.round((i5 - l3(this, h3)[0]) / l3(this, A2)) * l3(this, A2)), e6 !== void 0 && this.endKnob && (i5 = e6 ? Math.min(i5, this.endKnob.value) : Math.max(i5, this.startKnob.value)), i5;
  }
  updateKnob(t5, e6) {
    t5.id === "start" ? l3(this, v2)[0] = e6 : l3(this, v2)[1] = e6, t5.value = e6, t5.offset = this.toScreenSpace(e6), t5.label = this.labelFormatter(e6), this.endKnob && (t5.id === "start" ? this.track.style.borderLeftWidth = t5.offset + "px" : this.track.style.borderRightWidth = this.track.offsetWidth - t5.offset + "px");
  }
  updateKnobPositions() {
    this.updateKnob(this.startKnob, l3(this, v2)[0]), this.endKnob && this.updateKnob(this.endKnob, l3(this, v2)[1]);
  }
  onKnobDrag(t5) {
    if (t5.target instanceof G || this.classList.contains("has-value") || this.classList.contains("has-focus")) {
      const e6 = this.value;
      let i5;
      const o6 = (r6) => {
        let n5 = 0;
        r6.type === "touchmove" || r6.type === "touchstart" ? n5 = r6.touches[0].clientX : n5 = r6.clientX, n5 = n5 - this.track.getBoundingClientRect().left, i5 || (i5 = this.chooseKnob(n5), i5.classList.add("focus")), this.updateKnob(i5, this.applyConstraints(this.toValueSpace(n5), i5.id === "start"));
        const u3 = this.range !== void 0 ? JSON.stringify([l3(this, v2)[0], l3(this, v2)[1]]) : String(l3(this, v2)[0]);
        this.value !== u3 && (this.value = u3, this.dispatchEvent(new Event("input", { bubbles: true, composed: true })));
      }, s4 = () => {
        document.removeEventListener("mousemove", o6), document.removeEventListener("touchmove", o6), document.removeEventListener("mouseup", s4), document.removeEventListener("touchend", s4), i5 && (i5.classList.remove("focus"), this.value !== e6 && this.dispatchEvent(new Event("change", { bubbles: true, composed: true }))), i5 = void 0;
      };
      this.sliderElement.focus(), document.addEventListener("mousemove", o6), document.addEventListener("touchmove", o6), document.addEventListener("mouseup", s4), document.addEventListener("touchend", s4), o6(t5);
    }
  }
  renderInput() {
    return b2`
        ${super.renderInput()}
        <div id="slider" part="slider" tabindex="0" ?range="${this.range !== void 0}">
            <div id="track"></div>
            <rokit-slider-knob id="start"></rokit-slider-knob>
            ${this.range === void 0 ? A : b2`
                <rokit-slider-knob id="end"></rokit-slider-knob>
            `}
        </div>
        `;
  }
};
h3 = /* @__PURE__ */ new WeakMap();
v2 = /* @__PURE__ */ new WeakMap();
A2 = /* @__PURE__ */ new WeakMap();
S3.styles = [...p3.styles, i`
        :host(.has-label:not(:focus):not(.has-value):not([sticky])) #slider > * { visibility: hidden; }
        :host(.has-label) .wrapper { padding-top: 1em; }
        :host([sticky]) #slider { margin-top: ${0.25 * M2 + 22}px; }
        #input { display: none; }
        #slider { display: flex; position: relative; align-items: center; width: 100%; height: ${M2}px; padding: 0 ${M2 / 2}px; outline: 0; }
        :host(:not([sticky])) #slider:not(:focus) rokit-slider-knob::part(label) { color: transparent; background-color: transparent; border-color: transparent; top: 0; }
        #track { height: 2px;  flex-grow: 1; background-color: #CCC; }
        #slider[range] #track { background-color: color-mix(in srgb, var(--rokit-primary-color-inner) 60%, transparent); border-width: 0; border-color: #CCC; border-style: solid; }
    `];
O([
  n4()
], S3.prototype, "range", 2);
O([
  n4()
], S3.prototype, "labelFormatter", 2);
O([
  e5("#slider")
], S3.prototype, "sliderElement", 2);
O([
  e5("#track")
], S3.prototype, "track", 2);
O([
  e5("#start")
], S3.prototype, "startKnob", 2);
O([
  e5("#end")
], S3.prototype, "endKnob", 2);
S3 = O([
  t3("rokit-slider")
], S3);
var G = class extends i4 {
  constructor() {
    super(...arguments), this.offset = 0, this.label = "", this.value = 0;
  }
  updated(t5) {
    t5.has("offset") && (this.style.left = this.offset + "px");
  }
  render() {
    return b2`<label part="label">${this.label}</label>`;
  }
};
G.styles = [i`
        :host { position: absolute; width: ${M2}px; height: ${M2}px; border-radius: ${M2}px; background-color: var(--rokit-primary-color-inner); }
        :host(.focus), :host(:hover) { box-shadow: 0 0 0 ${M2 / 2}px var(--rokit-primary-color-transparent-inner); z-index: 1; }
        label {
            position: absolute;
            top: calc(-2em - ${M2 / 4}px);
            left: 50%;
            transform: translate(-50%, 0);
            white-space: nowrap;
            font-size: 0.75em;
            font-weight: 500;
            transition-property: top color background-color;
            transition-duration: var(--rokit-transition-duration-inner);
            pointer-events: none;
            color: white;
            background-color: var(--rokit-primary-color-inner);
            padding: 0 4px;
            border-radius: 3px;
        }
        label:after {
            content: '';
            width: 10px;
            height: 10px;
            position: absolute;
            left: 50%;
            bottom: -4px;
            transform: translate(-50%, 0);
            background-color: inherit;
            clip-path: polygon(50% 50%, 100% 50%, 50% 100%, 0 50%);
        }
    `];
O([
  n4()
], G.prototype, "offset", 2);
O([
  n4()
], G.prototype, "label", 2);
G = O([
  t3("rokit-slider-knob")
], G);
var oe = Object.defineProperty;
var re = Object.getOwnPropertyDescriptor;
var Z2 = (t5, e6, i5, o6) => {
  for (var s4 = o6 > 1 ? void 0 : o6 ? re(e6, i5) : e6, r6 = t5.length - 1, n5; r6 >= 0; r6--)
    (n5 = t5[r6]) && (s4 = (o6 ? n5(e6, i5, s4) : n5(s4)) || s4);
  return o6 && s4 && oe(e6, i5, s4), s4;
};
var K = class extends g2 {
  constructor() {
    super(...arguments), this.open = false, this.closable = false, this.title = "", this.previousBodyOverflow = "", this.layoutLocked = false, this.onDialogClose = () => {
      this.unlockLayout(), this.open = false, this.dispatchEvent(new Event("close"));
    };
  }
  lockLayout() {
    this.layoutLocked || (this.layoutLocked = true, this.previousBodyOverflow = document.body.style.overflow, document.body.classList.add("dialog-open"), document.body.style.overflow = "hidden");
  }
  unlockLayout() {
    this.layoutLocked && (this.layoutLocked = false, document.body.classList.remove("dialog-open"), document.body.style.overflow = this.previousBodyOverflow, this.previousBodyOverflow = "");
  }
  firstUpdated() {
    this.dialogElement.addEventListener("close", this.onDialogClose);
  }
  disconnectedCallback() {
    this.dialogElement?.removeEventListener("close", this.onDialogClose), this.unlockLayout(), super.disconnectedCallback();
  }
  updated(t5) {
    if (t5.has("open")) {
      if (this.open) {
        this.lockLayout(), this.dialogElement.open || this.dialogElement.showModal();
        return;
      }
      this.unlockLayout(), this.dialogElement.open && this.dialogElement.close();
    }
  }
  render() {
    return b2`
            <dialog id="dialog" part="dialog">
                <header>
                    <div class="title" part="title">
                        <slot name="header">${this.title}</slot>
                    </div>
                    ${this.closable ? b2`
                        <rokit-button class="clear" icon ?dense="${this.dense}" @click="${() => {
      this.open = false;
    }}" title="Close"></rokit-button>
                    ` : A}
                </header>
                <main part="main">
                    <slot></slot>
                </main>
            </dialog>
        `;
  }
};
K.styles = [...g2.styles, i`
        dialog[open] { display: flex; flex-direction: column; width: 100%; max-width: 90vw; max-height: 90vh; margin: auto; outline: 0; border: 0; border-radius: 1em; padding: 0; }
        dialog::backdrop { background-color: #0007; }
        header { display: flex; align-items: center; padding: 14px; }
        .title { font-weight: 600; flex-grow: 1; text-align: center; }
        .clear { justify-self: flex-end; }
        main { flex-grow: 1; overflow: auto; display: flex; flex-direction: column; padding: 0 16px 14px 16px; }
    `];
Z2([
  n4({ type: Boolean, reflect: true })
], K.prototype, "open", 2);
Z2([
  n4({ type: Boolean })
], K.prototype, "closable", 2);
Z2([
  n4()
], K.prototype, "title", 2);
Z2([
  e5("#dialog")
], K.prototype, "dialogElement", 2);
K = Z2([
  t3("rokit-dialog")
], K);
var ne = Object.defineProperty;
var ae = Object.getOwnPropertyDescriptor;
var Ct = (t5, e6, i5, o6) => {
  for (var s4 = o6 > 1 ? void 0 : o6 ? ae(e6, i5) : e6, r6 = t5.length - 1, n5; r6 >= 0; r6--)
    (n5 = t5[r6]) && (s4 = (o6 ? n5(e6, i5, s4) : n5(s4)) || s4);
  return o6 && s4 && ne(e6, i5, s4), s4;
};
var Q = class extends g2 {
  updated(t5) {
    if (t5.has("percent")) {
      const e6 = Number(this.percent);
      if (Number.isFinite(e6)) {
        const i5 = Math.min(100, Math.max(0, e6));
        this.bar.style.width = `${i5}%`;
      } else
        this.bar.style.width = "";
    }
  }
  render() {
    const t5 = Number.isFinite(Number(this.percent));
    return b2`<div part="bar" class="bar ${t5 ? "" : "indeterminate"}"></div>`;
  }
};
Q.styles = [...g2.styles, i`
    :host { display: flex; background-color: var(--rokit-primary-color-transparent-inner); color: var(--rokit-primary-color-inner); }
    .bar { height: 3px; background-color: var(--rokit-primary-color-inner); }
    .bar.indeterminate { width: 100%; --c: no-repeat linear-gradient(currentColor 0 0); background: var(--c), var(--c); background-size: 60% 100%; animation: indeterminate 3s infinite; }
    @keyframes indeterminate {
        0%   { background-position:-150% 0,-150% 0 }
        66%  { background-position: 250% 0,-150% 0 }
        100% { background-position: 250% 0, 250% 0 }
    }
    `];
Ct([
  n4({ type: Number })
], Q.prototype, "percent", 2);
Ct([
  e5(".bar")
], Q.prototype, "bar", 2);
Q = Ct([
  t3("rokit-progressbar")
], Q);
var le = Object.getOwnPropertyDescriptor;
var he = (t5, e6, i5, o6) => {
  for (var s4 = o6 > 1 ? void 0 : o6 ? le(e6, i5) : e6, r6 = t5.length - 1, n5; r6 >= 0; r6--)
    (n5 = t5[r6]) && (s4 = n5(s4) || s4);
  return s4;
};
var xt = "RokitSnackbarEvent";
var Ht = "0.2s";
var de = Tt(Ht);
var pe = 3e3;
var ht = class extends i4 {
  constructor() {
    super(), this.listener = (t5) => {
      t5.stopImmediatePropagation(), ce(t5.detail, this);
    }, this.container = document.createElement("div"), this.container.classList.add("snackbar"), this.container.setAttribute("part", "snackbar");
  }
  connectedCallback() {
    super.connectedCallback(), this.shadowRoot.appendChild(this.container), document.addEventListener(xt, this.listener);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), document.removeEventListener(xt, this.listener);
  }
};
ht.styles = i`
    :host { display: flex; justify-content: center; width: 100%; position: fixed; bottom: 10px; pointer-events: none; }
    :host(.left)  { right: auto; left: 10px; width: auto; }
    :host(.right) { right: 10px; left: auto; width: auto; }
    :host(.top) { top: 10px; bottom: auto; }
    :host(.top) .snackbar { flex-direction: column-reverse; }
    .snackbar { display: flex; flex-direction: column; width: 300px; }
    .message { max-height: 0; margin-bottom: 0; overflow: hidden; background-color: #333; color: #FFF; border-radius: 4px; transition: all ${r(Ht)} ease-in-out; font-weight: 500; pointer-events: auto; }
    .message.error { background-color: #C22; }
    .message.success { background-color: #0a8f0a; }
    .message:not(.closable) .text { text-align: center; }
    .inner { display: flex; padding: 10px; }
    .text { flex-grow: 1; word-break: break-all; }
    .text a { color: inherit; }
    `;
ht = he([
  t3("rokit-snackbar")
], ht);
function ce(t5, e6) {
  e6 || (e6 = document.querySelector("rokit-snackbar") || void 0, e6 || (e6 = new ht(), document.body.appendChild(e6)));
  const i5 = document.createElement("div");
  i5.classList.add("message");
  const o6 = document.createElement("div");
  o6.classList.add("inner");
  const s4 = document.createElement("div");
  if (s4.classList.add("text"), s4.innerHTML = t5.message, o6.appendChild(s4), i5.appendChild(o6), t5.closable !== void 0 ? t5.closable : t5.ttl === 0) {
    i5.classList.add("closable");
    const u3 = new D2();
    u3.setAttribute("icon", ""), u3.setAttribute("dense", ""), u3.classList.add("clear"), u3.title = "Dismiss", u3.addEventListener("click", () => {
      n5(i5);
    }), o6.append(u3);
  }
  t5.cssStyle && (i5.style.cssText = t5.cssStyle), t5.cssClass && i5.classList.add(t5.cssClass), e6.container.appendChild(i5), setTimeout(() => {
    i5.style.maxHeight = i5.scrollHeight + "px", i5.style.marginBottom = "10px";
  }), t5.ttl !== 0 && setTimeout(() => {
    n5(i5);
  }, t5.ttl || pe);
  const n5 = (u3) => {
    u3.style.maxHeight = "", u3.style.marginBottom = "", setTimeout(() => {
      u3.remove();
    }, de);
  };
}
var ue = Object.defineProperty;
var fe = Object.getOwnPropertyDescriptor;
var P2 = (t5, e6, i5, o6) => {
  for (var s4 = o6 > 1 ? void 0 : o6 ? fe(e6, i5) : e6, r6 = t5.length - 1, n5; r6 >= 0; r6--)
    (n5 = t5[r6]) && (s4 = (o6 ? n5(e6, i5, s4) : n5(s4)) || s4);
  return o6 && s4 && ue(e6, i5, s4), s4;
};
var E2 = class extends g2 {
  constructor() {
    super(...arguments), this.pos = "50%", this.minPos = 10, this.maxPos = 90, this.dir = "horizontal", this.sep = "4px", this.dragging = false, this.storageKey = "", this._restoredKey = "", this._activePointerId = null, this.posFromPointer = (t5) => {
      const e6 = this.getBoundingClientRect(), i5 = this.dir === "horizontal" ? t5.clientX - e6.left : t5.clientY - e6.top, o6 = this.dir === "horizontal" ? e6.width : e6.height, s4 = o6 > 0 ? i5 / o6 * 100 : 50;
      return `${Math.min(this.maxPos, Math.max(this.minPos, s4))}%`;
    }, this.startDrag = (t5) => {
      t5.button == 0 && (this.dragging = true, this._activePointerId = t5.pointerId, t5.currentTarget.setPointerCapture(t5.pointerId), this.pos = this.posFromPointer(t5));
    }, this.drag = (t5) => {
      this.dragging && this._activePointerId == t5.pointerId && (this.pos = this.posFromPointer(t5));
    }, this.endDrag = (t5) => {
      this._activePointerId == t5.pointerId && (this.dragging = false, this._activePointerId = null);
    };
  }
  updated(t5) {
    if (this.storageKey || (this.storageKey = `rokit-splitpane:${this.id || "default"}`), this.storageKey && this.storageKey !== this._restoredKey) {
      try {
        const e6 = localStorage.getItem(this.storageKey);
        e6 && (this.pos = e6);
      } catch {
      }
      this._restoredKey = this.storageKey;
    }
    if (t5.has("minPos") && (this.minPos = Math.max(0, Math.min(100, this.minPos))), t5.has("maxPos") && (this.maxPos = Math.max(0, Math.min(100, this.maxPos))), this.minPos > this.maxPos && ([this.minPos, this.maxPos] = [this.maxPos, this.minPos]), (t5.has("pos") || t5.has("dir")) && (this.dir === "horizontal" ? (this.style.gridTemplateColumns = this.template(), this.style.gridTemplateRows = "") : (this.style.gridTemplateRows = this.template(), this.style.gridTemplateColumns = ""), this.storageKey))
      try {
        localStorage.setItem(this.storageKey, this.pos);
      } catch {
      }
  }
  template() {
    return `${this.pos} ${this.sep} 1fr`;
  }
  render() {
    return b2`
            <div><slot name="pane1"></slot></div>
            <div
                id="separator"
                part="separator"
                role="separator"
                aria-orientation="${this.dir}"
                @pointerdown="${this.startDrag}"
                @pointermove="${this.drag}"
                @pointerup="${this.endDrag}"
                @pointercancel="${this.endDrag}">
            </div>
            <div><slot name="pane2"></slot></div>
        `;
  }
};
E2.styles = [...g2.styles, i`
    :host { display: grid; }
    :host([dragging]) { user-select: none; }
    :host([dragging][dir="horizontal"]) { cursor: col-resize; }
    :host([dragging][dir="vertical"]) { cursor: row-resize; }
    :host([dir="horizontal"]) {
        #separator { cursor: col-resize; }
    }
    :host([dir="vertical"]) {
        #separator { cursor: row-resize; }
    }
    #separator { background-color: var(--rokit-light-background-darker-color-inner); }
    `];
P2([
  n4()
], E2.prototype, "pos", 2);
P2([
  n4()
], E2.prototype, "minPos", 2);
P2([
  n4()
], E2.prototype, "maxPos", 2);
P2([
  n4({ reflect: true })
], E2.prototype, "dir", 2);
P2([
  n4()
], E2.prototype, "sep", 2);
P2([
  n4({ reflect: true, type: Boolean })
], E2.prototype, "dragging", 2);
P2([
  n4()
], E2.prototype, "storageKey", 2);
E2 = P2([
  t3("rokit-splitpane")
], E2);

// node_modules/uuid/dist/stringify.js
var byteToHex = [];
for (let i5 = 0; i5 < 256; ++i5) {
  byteToHex.push((i5 + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

// node_modules/uuid/dist/rng.js
var getRandomValues;
var rnds8 = new Uint8Array(16);
function rng() {
  if (!getRandomValues) {
    if (typeof crypto === "undefined" || !crypto.getRandomValues) {
      throw new Error("crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported");
    }
    getRandomValues = crypto.getRandomValues.bind(crypto);
  }
  return getRandomValues(rnds8);
}

// node_modules/uuid/dist/native.js
var randomUUID = typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID.bind(crypto);
var native_default = { randomUUID };

// node_modules/uuid/dist/v4.js
function _v4(options, buf, offset) {
  options = options || {};
  const rnds = options.random ?? options.rng?.() ?? rng();
  if (rnds.length < 16) {
    throw new Error("Random bytes length must be >= 16");
  }
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    if (offset < 0 || offset + 16 > buf.length) {
      throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`);
    }
    for (let i5 = 0; i5 < 16; ++i5) {
      buf[offset + i5] = rnds[i5];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  return _v4(options, buf, offset);
}
var v4_default = v4;

// node_modules/@rdfjs/to-ntriples/lib/blankNode.js
function blankNode2(blankNode4) {
  return "_:" + blankNode4.value;
}
var blankNode_default = blankNode2;

// node_modules/@rdfjs/to-ntriples/lib/dataset.js
function dataset(dataset2, toNT2) {
  return [...dataset2].map((quad4) => toNT2(quad4)).join("\n") + "\n";
}
var dataset_default = dataset;

// node_modules/@rdfjs/to-ntriples/lib/defaultGraph.js
function defaultGraph2() {
  return "";
}
var defaultGraph_default = defaultGraph2;

// node_modules/@rdfjs/to-ntriples/lib/namedNode.js
function namedNode2(namedNode5) {
  return "<" + namedNode5.value + ">";
}
var namedNode_default = namedNode2;

// node_modules/@rdfjs/to-ntriples/lib/literal.js
var echarRegEx = /["\\\\\n\r]/;
var echarRegExAll = /["\\\\\n\r]/g;
var echarReplacement = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r"
};
function echarReplacer(char) {
  return echarReplacement[char];
}
function escapeValue(value) {
  if (echarRegEx.test(value)) {
    return value.replace(echarRegExAll, echarReplacer);
  }
  return value;
}
function literal2(literal4) {
  const escapedValue = escapeValue(literal4.value);
  if (literal4.datatype.value === "http://www.w3.org/2001/XMLSchema#string") {
    return '"' + escapedValue + '"';
  }
  if (literal4.datatype.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString") {
    return '"' + escapedValue + '"@' + literal4.language;
  }
  return '"' + escapedValue + '"^^' + namedNode_default(literal4.datatype);
}
var literal_default = literal2;

// node_modules/@rdfjs/to-ntriples/lib/quad.js
function quad2(quad4, toNT2) {
  const subjectString = toNT2(quad4.subject);
  const predicateString = toNT2(quad4.predicate);
  const objectString = toNT2(quad4.object);
  const graphString = toNT2(quad4.graph);
  return `${subjectString} ${predicateString} ${objectString} ${graphString ? graphString + " " : ""}.`;
}
var quad_default = quad2;

// node_modules/@rdfjs/to-ntriples/lib/variable.js
function variable2(variable4) {
  return "?" + variable4.value;
}
var variable_default = variable2;

// node_modules/@rdfjs/to-ntriples/index.js
function toNT(term) {
  if (!term) {
    return null;
  }
  if (term.termType === "BlankNode") {
    return blankNode_default(term);
  }
  if (term.termType === "DefaultGraph") {
    return defaultGraph_default();
  }
  if (term.termType === "Literal") {
    return literal_default(term);
  }
  if (term.termType === "NamedNode") {
    return namedNode_default(term);
  }
  if (term.termType === "Quad" || term.subject && term.predicate && term.object && term.graph) {
    return quad_default(term, toNT);
  }
  if (term.termType === "Variable") {
    return variable_default(term);
  }
  if (term[Symbol.iterator]) {
    return dataset_default(term, toNT);
  }
  throw new Error(`unknown termType ${term.termType}`);
}
var to_ntriples_default = toNT;

// node_modules/@rdfjs/term-map/TermMap.js
var TermMap = class {
  constructor(entries) {
    this.index = /* @__PURE__ */ new Map();
    if (entries) {
      for (const [term, value] of entries) {
        this.set(term, value);
      }
    }
  }
  get size() {
    return this.index.size;
  }
  clear() {
    this.index.clear();
  }
  delete(term) {
    return this.index.delete(to_ntriples_default(term));
  }
  *entries() {
    for (const [, { term, value }] of this.index) {
      yield [term, value];
    }
  }
  forEach(callback, thisArg) {
    for (const entry of this.entries()) {
      callback.call(thisArg, entry[1], entry[0], this);
    }
  }
  get(term) {
    const item = this.index.get(to_ntriples_default(term));
    return item && item.value;
  }
  has(term) {
    return this.index.has(to_ntriples_default(term));
  }
  *keys() {
    for (const [, { term }] of this.index) {
      yield term;
    }
  }
  set(term, value) {
    const key = to_ntriples_default(term);
    this.index.set(key, { term, value });
    return this;
  }
  *values() {
    for (const [, { value }] of this.index) {
      yield value;
    }
  }
  [Symbol.iterator]() {
    return this.entries()[Symbol.iterator]();
  }
};
var TermMap_default = TermMap;

// node_modules/grapoi/Edge.js
var Edge = class {
  constructor({ dataset: dataset2, end, quad: quad4, start }) {
    this.dataset = dataset2;
    this.end = end;
    this.quad = quad4;
    this.start = start;
  }
  get term() {
    return this.quad[this.end];
  }
  get graph() {
    return this.quad.graph;
  }
  get startTerm() {
    return this.quad[this.start];
  }
};
var Edge_default = Edge;

// node_modules/@rdfjs/term-set/TermSet.js
function quietToNT(term) {
  try {
    return to_ntriples_default(term);
  } catch (err) {
    return null;
  }
}
var TermSet = class {
  constructor(terms) {
    this.index = /* @__PURE__ */ new Map();
    if (terms) {
      for (const term of terms) {
        this.add(term);
      }
    }
  }
  get size() {
    return this.index.size;
  }
  add(term) {
    const key = to_ntriples_default(term);
    if (!this.index.has(key)) {
      this.index.set(key, term);
    }
    return this;
  }
  clear() {
    this.index.clear();
  }
  delete(term) {
    if (!term) {
      return false;
    }
    return this.index.delete(quietToNT(term));
  }
  entries() {
    return this.values().entries();
  }
  forEach(callbackfn, thisArg) {
    return this.values().forEach(callbackfn, thisArg);
  }
  has(term) {
    if (!term) {
      return false;
    }
    return this.index.has(quietToNT(term));
  }
  values() {
    return new Set(this.index.values());
  }
  keys() {
    return this.values();
  }
  [Symbol.iterator]() {
    return this.index.values();
  }
};
var TermSet_default = TermSet;

// node_modules/@rdfjs/data-model/lib/BlankNode.js
var BlankNode2 = class {
  constructor(id) {
    this.value = id;
  }
  equals(other) {
    return !!other && other.termType === this.termType && other.value === this.value;
  }
};
BlankNode2.prototype.termType = "BlankNode";
var BlankNode_default = BlankNode2;

// node_modules/@rdfjs/data-model/lib/DefaultGraph.js
var DefaultGraph2 = class {
  equals(other) {
    return !!other && other.termType === this.termType;
  }
};
DefaultGraph2.prototype.termType = "DefaultGraph";
DefaultGraph2.prototype.value = "";
var DefaultGraph_default = DefaultGraph2;

// node_modules/@rdfjs/data-model/lib/fromTerm.js
function fromTerm2(factory2, original) {
  if (!original) {
    return null;
  }
  if (original.termType === "BlankNode") {
    return factory2.blankNode(original.value);
  }
  if (original.termType === "DefaultGraph") {
    return factory2.defaultGraph();
  }
  if (original.termType === "Literal") {
    return factory2.literal(original.value, original.language || factory2.namedNode(original.datatype.value));
  }
  if (original.termType === "NamedNode") {
    return factory2.namedNode(original.value);
  }
  if (original.termType === "Quad") {
    const subject = factory2.fromTerm(original.subject);
    const predicate = factory2.fromTerm(original.predicate);
    const object = factory2.fromTerm(original.object);
    const graph = factory2.fromTerm(original.graph);
    return factory2.quad(subject, predicate, object, graph);
  }
  if (original.termType === "Variable") {
    return factory2.variable(original.value);
  }
  throw new Error(`unknown termType ${original.termType}`);
}
var fromTerm_default = fromTerm2;

// node_modules/@rdfjs/data-model/lib/Literal.js
var Literal2 = class {
  constructor(value, language2, datatype, direction = "") {
    this.value = value;
    this.language = language2;
    this.datatype = datatype;
    this.direction = direction;
  }
  equals(other) {
    return !!other && other.termType === this.termType && other.value === this.value && other.language === this.language && other.datatype.equals(this.datatype) && (other.direction || "") === this.direction;
  }
};
Literal2.prototype.termType = "Literal";
var Literal_default = Literal2;

// node_modules/@rdfjs/data-model/lib/NamedNode.js
var NamedNode2 = class {
  constructor(iri) {
    this.value = iri;
  }
  equals(other) {
    return !!other && other.termType === this.termType && other.value === this.value;
  }
};
NamedNode2.prototype.termType = "NamedNode";
var NamedNode_default = NamedNode2;

// node_modules/@rdfjs/data-model/lib/Quad.js
var Quad2 = class {
  constructor(subject, predicate, object, graph) {
    this.subject = subject;
    this.predicate = predicate;
    this.object = object;
    this.graph = graph;
  }
  equals(other) {
    return !!other && (other.termType === "Quad" || !other.termType) && other.subject.equals(this.subject) && other.predicate.equals(this.predicate) && other.object.equals(this.object) && other.graph.equals(this.graph);
  }
};
Quad2.prototype.termType = "Quad";
Quad2.prototype.value = "";
var Quad_default = Quad2;

// node_modules/@rdfjs/data-model/lib/Variable.js
var Variable2 = class {
  constructor(name) {
    this.value = name;
  }
  equals(other) {
    return !!other && other.termType === this.termType && other.value === this.value;
  }
};
Variable2.prototype.termType = "Variable";
var Variable_default = Variable2;

// node_modules/@rdfjs/data-model/Factory.js
var dirLangStringDatatype = new NamedNode_default("http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString");
var langStringDatatype = new NamedNode_default("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString");
var stringDatatype = new NamedNode_default("http://www.w3.org/2001/XMLSchema#string");
var DataFactory2 = class {
  constructor() {
    this.init();
  }
  init() {
    this._data = {
      blankNodeCounter: 0,
      defaultGraph: new DefaultGraph_default()
    };
  }
  namedNode(value) {
    return new NamedNode_default(value);
  }
  blankNode(value) {
    value = value || "b" + ++this._data.blankNodeCounter;
    return new BlankNode_default(value);
  }
  literal(value, languageOrDatatype) {
    if (typeof languageOrDatatype === "string") {
      return new Literal_default(value, languageOrDatatype, langStringDatatype);
    } else if (typeof languageOrDatatype?.language === "string") {
      return new Literal_default(
        value,
        languageOrDatatype.language,
        languageOrDatatype.direction ? dirLangStringDatatype : langStringDatatype,
        languageOrDatatype.direction
      );
    } else {
      return new Literal_default(value, "", languageOrDatatype || stringDatatype);
    }
  }
  variable(value) {
    return new Variable_default(value);
  }
  defaultGraph() {
    return this._data.defaultGraph;
  }
  quad(subject, predicate, object, graph = this.defaultGraph()) {
    return new Quad_default(subject, predicate, object, graph);
  }
  fromTerm(original) {
    return fromTerm_default(this, original);
  }
  fromQuad(original) {
    return fromTerm_default(this, original);
  }
};
DataFactory2.exports = [
  "blankNode",
  "defaultGraph",
  "fromQuad",
  "fromTerm",
  "literal",
  "namedNode",
  "quad",
  "variable"
];
var Factory_default = DataFactory2;

// node_modules/@rdfjs/data-model/index.js
var factory = new Factory_default();
var data_model_default = factory;

// node_modules/@rdfjs/namespace/index.js
var handler = {
  apply: (target, thisArg, args) => target(args[0]),
  get: (target, property) => target(property)
};
function namespace(baseIRI, { factory: factory2 = data_model_default } = {}) {
  const builder = (term = "") => factory2.namedNode(`${baseIRI}${term.raw || term}`);
  return typeof Proxy === "undefined" ? builder : new Proxy(builder, handler);
}
var namespace_default = namespace;

// node_modules/grapoi/lib/namespaces.js
var xsd4 = namespace_default("http://www.w3.org/2001/XMLSchema#");
var rdfns = namespace_default("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
var rdfs = namespace_default("http://www.w3.org/2000/01/rdf-schema#");

// node_modules/grapoi/Processor.js
var Processor = class _Processor {
  static add({ ptr, start, end, subjects = [null], predicates = [null], objects = [null], graphs, callback } = {}) {
    if (!ptr.factory) {
      throw new Error("add operation requires a factory");
    }
    let edgeCallback = () => {
    };
    if (callback) {
      edgeCallback = (quad4) => {
        callback(new Edge_default({ dataset: ptr.dataset, start, end, quad: quad4 }));
      };
    }
    for (const subject of subjects) {
      for (const predicate of predicates) {
        for (const object of objects) {
          for (const graph of graphs) {
            const pattern = { subject, predicate, object, graph };
            pattern[start] = ptr.term;
            const quad4 = ptr.factory.quad(
              pattern.subject,
              pattern.predicate,
              pattern.object,
              pattern.graph
            );
            ptr.dataset.add(quad4);
            edgeCallback(quad4);
          }
        }
      }
    }
    return ptr;
  }
  static addList({ ptr, predicates, items, graphs }) {
    if (ptr.isAny()) {
      throw new Error("can't attach a list to an any ptr");
    }
    for (const predicate of predicates) {
      for (const graph of graphs) {
        const nodes = items.map(() => ptr.factory.blankNode());
        ptr.dataset.add(ptr.factory.quad(ptr.term, predicate, nodes[0] || rdfns.nil, graph));
        for (let index = 0; index < nodes.length; index++) {
          ptr.dataset.add(ptr.factory.quad(nodes[index], rdfns.first, items[index], graph));
          ptr.dataset.add(ptr.factory.quad(nodes[index], rdfns.rest, nodes[index + 1] || rdfns.nil, graph));
        }
      }
    }
    return ptr;
  }
  static delete({
    ptr,
    start,
    subjects = [null],
    predicates = [null],
    objects = [null]
  }) {
    for (const subject of subjects) {
      for (const predicate of predicates) {
        for (const object of objects) {
          const pattern = { subject, predicate, object };
          pattern[start] = ptr.term;
          const matches = ptr.dataset.match(pattern.subject, pattern.predicate, pattern.object);
          for (const quad4 of matches) {
            ptr.dataset.delete(quad4);
          }
        }
      }
    }
    return ptr;
  }
  static deleteList({ ptr, predicates }) {
    const toDelete = [];
    for (const predicate of predicates) {
      for (const quad4 of ptr.dataset.match(ptr.term, predicate)) {
        let link = quad4.object;
        toDelete.push(quad4);
        while (!rdfns.nil.equals(link)) {
          link = toDelete[toDelete.length - 1].object;
          const matches = ptr.dataset.match(link);
          if (matches.size === 0) {
            break;
          }
          for (const quad5 of matches) {
            toDelete.push(quad5);
          }
        }
      }
    }
    for (const quad4 of toDelete) {
      ptr.dataset.delete(quad4);
    }
    return ptr;
  }
  static execute({
    ptr,
    operation = "traverse",
    quantifier,
    start,
    end,
    subjects,
    predicates,
    objects,
    graphs,
    items,
    callback
  } = {}) {
    if (operation === "add") {
      return _Processor.add({ ptr, start, end, subjects, predicates, objects, graphs, callback });
    }
    if (operation === "addList") {
      return _Processor.addList({ ptr, predicates, items, graphs });
    }
    if (operation === "delete") {
      return _Processor.delete({ ptr, start, subjects, predicates, objects });
    }
    if (operation === "deleteList") {
      return _Processor.deleteList({ ptr, predicates });
    }
    if (operation === "isList") {
      return _Processor.isList({ ptr });
    }
    if (operation === "list") {
      return _Processor.list({ ptr });
    }
    if (operation === "traverse") {
      return _Processor.traverse({ ptr, quantifier, start, end, subjects, predicates, objects, graphs });
    }
    throw new Error(`unknown operation ${operation}`);
  }
  static isList({ ptr }) {
    if (ptr.isAny()) {
      return false;
    }
    if (rdfns.nil.equals(ptr.term)) {
      return true;
    }
    const item = _Processor.traverse({ ptr, predicates: [rdfns.first] });
    if (item.length === 1) {
      return true;
    }
    return false;
  }
  static list({ ptr }) {
    if (!ptr.isList()) {
      return void 0;
    }
    return {
      *[Symbol.iterator]() {
        const visited = new TermSet_default();
        while (ptr && !ptr.term.equals(rdfns.nil)) {
          if (visited.has(ptr.term)) {
            throw new Error(`Invalid list: circular reference on ${ptr.value}`);
          }
          visited.add(ptr.term);
          const value = ptr.out([rdfns.first]);
          if (value.length !== 1) {
            throw new Error(`Invalid list: rdf:first count not equals one on ${ptr.value}`);
          }
          const rest = ptr.out([rdfns.rest]);
          if (rest.length !== 1) {
            throw new Error(`Invalid list: rdf:rest count not equals one on ${ptr.value}`);
          }
          yield value[0];
          ptr = rest[0];
        }
      }
    };
  }
  static traverse({
    ptr,
    quantifier = "one",
    start = "subject",
    end = "object",
    subjects = [null],
    predicates = [null],
    objects = [null],
    graphs = [null],
    callback
  }) {
    if (quantifier === "one") {
      return _Processor.traverseOne({ ptr, start, end, subjects, predicates, objects, graphs, callback });
    }
    if (quantifier === "oneOrMore") {
      const ptrs = _Processor.traverse({ ptr, end, start, subjects, predicates, objects, graphs, callback });
      return _Processor.traverseMore({ ptrs, end, start, subjects, predicates, objects, graphs, callback });
    }
    if (quantifier === "zeroOrMore") {
      return _Processor.traverseMore({ ptrs: [ptr], end, start, subjects, predicates, objects, graphs, callback });
    }
    if (quantifier === "zeroOrOne") {
      return [ptr, ..._Processor.traverse({ ptr, end, start, subjects, predicates, objects, graphs, callback })];
    }
    throw new Error(`unknown quantifier ${quantifier}`);
  }
  static traverseMore({ ptrs, end, start, subjects, predicates, objects, graphs, callback } = {}) {
    let result = [...ptrs];
    let current;
    let last;
    do {
      current = [];
      for (const ptr of ptrs) {
        current = [
          ...current,
          ..._Processor.traverseOne({ ptr, end, start, subjects, predicates, objects, graphs, callback })
        ];
      }
      if (last) {
        current = current.filter((ptr) => !last.has(ptr.term));
      }
      ptrs = current;
      result = [...result, ...current];
      last = new TermSet_default(result.map((ptr) => ptr.term));
    } while (current.length > 0);
    return result;
  }
  static traverseOne({ ptr, start, end, subjects, predicates, objects, graphs, callback = (edge, ptr2) => ptr2.extend(edge) } = {}) {
    const results = [];
    for (const subject of subjects) {
      for (const predicate of predicates) {
        for (const object of objects) {
          for (const graph of graphs) {
            const pattern = { subject, predicate, object, graph };
            pattern[start] = ptr.term;
            for (const quad4 of ptr.dataset.match(pattern.subject, pattern.predicate, pattern.object, pattern.graph)) {
              results.push(callback(new Edge_default({ dataset: ptr.dataset, end, quad: quad4, start }), ptr));
            }
          }
        }
      }
    }
    return results;
  }
};
var Processor_default = Processor;

// node_modules/grapoi/Path.js
function createEdgeCallback(context, callback) {
  if (!callback) {
    return () => {
    };
  }
  return (edge) => callback(context.extend(edge));
}
var Path = class {
  constructor({ dataset: dataset2, edges = [], factory: factory2, graph, term }) {
    if (!dataset2 && edges.length === 0) {
      throw new Error("dataset or edges is required");
    }
    if (edges.length === 0 && typeof term === "undefined") {
      throw new Error("edges or term must be given");
    }
    if (edges.length > 0 && term) {
      throw new Error("edges or term must be given");
    }
    this.dataset = dataset2 || edges[edges.length - 1].dataset;
    this.edges = edges;
    this.factory = factory2;
    this._graph = graph;
    if (edges.length === 0) {
      this._term = term;
    }
  }
  get edge() {
    return this.edges[this.edges.length - 1];
  }
  get graph() {
    if (typeof this._graph === "object") {
      return this._graph;
    }
    return this.edge && this.edge.graph;
  }
  get length() {
    if (this._term !== void 0) {
      return 1;
    }
    return this.edges.length + 1;
  }
  get startTerm() {
    return this._term || this.edges[0].startTerm;
  }
  get term() {
    if (this._term !== void 0) {
      return this._term;
    }
    return this.edge.term;
  }
  get value() {
    const term = this.term;
    return term === null ? void 0 : term.value;
  }
  addIn(predicates, subjects, callback) {
    return Processor_default.add({
      ptr: this,
      start: "object",
      end: "subject",
      subjects,
      predicates,
      graphs: [this.graph || this.factory.defaultGraph()],
      callback: createEdgeCallback(this, callback)
    });
  }
  addList(predicates, items) {
    return Processor_default.addList({
      ptr: this,
      predicates,
      graphs: [this.graph || this.factory.defaultGraph()],
      items
    });
  }
  addOut(predicates, objects, callback) {
    return Processor_default.add({
      ptr: this,
      start: "subject",
      end: "object",
      predicates,
      objects,
      graphs: [this.graph || this.factory.defaultGraph()],
      callback: createEdgeCallback(this, callback)
    });
  }
  deleteIn(predicates, subjects) {
    return Processor_default.delete({
      ptr: this,
      start: "object",
      subjects,
      predicates
    });
  }
  deleteList(predicates) {
    return Processor_default.deleteList({
      ptr: this,
      predicates
    });
  }
  deleteOut(predicates, objects) {
    return Processor_default.delete({
      ptr: this,
      start: "subject",
      predicates,
      objects
    });
  }
  execute({ operation, quantifier, start, end, subjects, predicates, objects, graphs, items, callback }) {
    return Processor_default.execute({
      ptr: this,
      operation,
      quantifier,
      start,
      end,
      subjects,
      predicates,
      objects,
      graphs,
      items,
      callback
    });
  }
  extend(edge) {
    return new this.constructor({
      dataset: this.dataset,
      edges: [...this.edges, edge],
      factory: this.factory,
      graph: this._graph
    });
  }
  hasIn(predicates, subjects) {
    return Processor_default.traverse({
      ptr: this,
      start: "object",
      end: "object",
      subjects,
      predicates,
      graphs: [this.graph]
    });
  }
  hasOut(predicates, objects) {
    return Processor_default.traverse({
      ptr: this,
      start: "subject",
      end: "subject",
      predicates,
      objects,
      graphs: [this.graph]
    });
  }
  in(predicates, subjects) {
    return Processor_default.traverse({
      ptr: this,
      start: "object",
      end: "subject",
      subjects,
      predicates,
      graphs: [this.graph]
    });
  }
  isAny() {
    return !this.term;
  }
  isList() {
    return Processor_default.isList({ ptr: this });
  }
  list() {
    return Processor_default.list({ ptr: this });
  }
  *nodes() {
    for (let index = 0; index < this.length; index++) {
      if (this._term !== void 0) {
        yield {
          dataset: this.dataset,
          term: this._term
        };
      } else if (this.edges.length > index) {
        yield {
          dataset: this.edges[index].dataset,
          term: this.edges[index].startTerm
        };
      } else if (this.edges.length === index) {
        yield {
          dataset: this.edges[index - 1].dataset,
          term: this.edges[index - 1].term
        };
      }
    }
  }
  out(predicates, objects) {
    return Processor_default.traverse({
      ptr: this,
      predicates,
      objects,
      graphs: [this.graph]
    });
  }
  *quads() {
    for (const { quad: quad4 } of this.edges) {
      yield quad4;
    }
  }
  trim() {
    return new this.constructor({
      dataset: this.dataset,
      factory: this.factory,
      graph: this.graph,
      term: this.term
    });
  }
};
var Path_default = Path;

// node_modules/grapoi/lib/termIsEqual.js
function termIsEqual(a3, b5) {
  if (a3) {
    return a3.equals(b5);
  }
  return a3 === b5;
}
var termIsEqual_default = termIsEqual;

// node_modules/grapoi/lib/ptrIsEqual.js
function ptrIsEqual(a3, b5) {
  if (a3.dataset !== b5.dataset) {
    return false;
  }
  if (!termIsEqual_default(a3.graph, b5.graph)) {
    return false;
  }
  if (!termIsEqual_default(a3.term, b5.term)) {
    return false;
  }
  return true;
}
var ptrIsEqual_default = ptrIsEqual;

// node_modules/grapoi/PathList.js
function createExtendCallback(ptrList, callback) {
  if (!callback) {
    return () => {
    };
  }
  return (ptr) => {
    return callback(new ptrList.constructor({
      factory: ptrList.factory,
      ptrs: [ptr]
    }));
  };
}
var PathList = class {
  /**
   * Create a new instance
   * @param {DatasetCore} dataset Dataset for the pointers
   * @param {Environment} factory Factory for new quads
   * @param {Path[]} ptrs Use existing pointers
   * @param {Term[]} terms Terms for the pointers
   * @param {Term[]} graphs Graphs for the pointers
   */
  constructor({ dataset: dataset2, factory: factory2, ptrs, terms, graphs }) {
    this.factory = factory2;
    if (ptrs) {
      this.ptrs = [...ptrs];
    } else {
      this.ptrs = [];
      for (const term of terms || [null]) {
        for (const graph of graphs || [null]) {
          this.ptrs.push(new Path_default({ dataset: dataset2, factory: factory2, graph, term }));
        }
      }
    }
  }
  /**
   * Dataset of the pointer or null if there is no unique dataset.
   * @returns {DatasetCore|null} Unique dataset or null
   */
  get dataset() {
    const datasets = new Set(this.datasets);
    if (datasets.size !== 1) {
      return null;
    }
    return datasets[Symbol.iterator]().next().value;
  }
  /**
   * An array of all datasets of all pointers.
   * @returns {DatasetCore[]} Array of datasets.
   */
  get datasets() {
    return this.ptrs.map((ptr) => ptr.dataset);
  }
  /**
   * The length of the list of pointers.
   * @returns {number} Length of the list of pointers.
   */
  get length() {
    return this.ptrs.length;
  }
  /**
   * The term of the pointers if all pointers refer to a unique term.
   * @returns {Term|undefined} Term of undefined
   */
  get term() {
    const terms = new TermSet_default(this.terms);
    if (terms.size !== 1) {
      return void 0;
    }
    return terms[Symbol.iterator]().next().value;
  }
  /**
   * An array of all terms of all pointers.
   * @returns {Term[]} Array of all terms
   */
  get terms() {
    return this.ptrs.map((ptr) => ptr.term);
  }
  /**
   * The value of the pointers if all pointers refer to a unique term.
   * @returns {String|undefined} Value or undefined
   */
  get value() {
    const term = this.term;
    return term === void 0 || term === null ? void 0 : term.value;
  }
  /**
   * An array of all values of all pointers.
   * @returns {String[]} Array of all values
   */
  get values() {
    return this.ptrs.map((ptr) => ptr.value);
  }
  /**
   * Add quads with the current terms as the object
   * @param {Term[]} predicates Predicates of the quads
   * @param {Term[]} subjects Subjects of the quads
   * @param {function} [callback] Function called for each subject as a pointer argument
   * @returns {PathList} this
   */
  addIn(predicates, subjects, callback) {
    const extendCallback = createExtendCallback(this, callback);
    for (const ptr of this.ptrs) {
      ptr.addIn(predicates, subjects, extendCallback);
    }
    return this;
  }
  /**
   * Add lists with the given items
   * @param {Term[]} predicates Predicates of the lists
   * @param {Term[]} items List items
   * @returns {PathList} this
   */
  addList(predicates, items) {
    if (this.isAny()) {
      throw new Error("can't attach a list to an any ptr");
    }
    for (const ptr of this.ptrs) {
      ptr.addList(predicates, items);
    }
    return this;
  }
  /**
   * Add quads with the current terms as the subject
   * @param {Term[]} predicates Predicates of the quads
   * @param {Term[]} objects Objects of the quads
   * @param {function} [callback] Function called for each subject as a pointer argument
   * @returns {PathList} this
   */
  addOut(predicates, objects, callback) {
    const extendCallback = createExtendCallback(this, callback);
    for (const ptr of this.ptrs) {
      ptr.addOut(predicates, objects, extendCallback);
    }
    return this;
  }
  /**
   * Create a new instance of the Constructor with a cloned list of pointers.
   * @param args Additional arguments for the constructor
   * @returns {Constructor} Cloned instance
   */
  clone(args) {
    return new this.constructor({ factory: this.factory, ptrs: this.ptrs, ...args });
  }
  /**
   * Delete quads with the current terms as the object.
   * @param {Term[]} predicates Predicates of the quads
   * @param {Term[]} subjects Subjects of the quads
   * @returns {PathList} this
   */
  deleteIn(predicates, subjects) {
    for (const ptr of this.ptrs) {
      ptr.deleteIn(predicates, subjects);
    }
    return this;
  }
  /**
   * Delete lists.
   * @param {Term[]} predicates Predicates of the lists
   * @returns {PathList} this
   */
  deleteList(predicates) {
    for (const ptr of this.ptrs) {
      ptr.deleteList(predicates);
    }
    return this;
  }
  /**
   * Delete quads with the current terms as the subject.
   * @param {Term[]} predicates Predicates of the quads
   * @param {Term[]} objects Objects of the quads
   * @returns {PathList} this
   */
  deleteOut(predicates, objects) {
    for (const ptr of this.ptrs) {
      ptr.deleteOut(predicates, objects);
    }
    return this;
  }
  /**
   * Create a new instance with a unique set of pointers.
   * The path of the pointers is trimmed.
   * @returns {Constructor} Instance with unique pointers
   */
  distinct() {
    const ptrs = this.ptrs.reduce((unique, ptr) => {
      if (!unique.some((uPtr) => ptrIsEqual_default(uPtr, ptr))) {
        unique.push(ptr.trim());
      }
      return unique;
    }, []);
    return this.clone({ ptrs });
  }
  /**
   * Executes a single instruction.
   * @param instruction The instruction to execute
   * @returns {Constructor} Instance with the result pointers.
   */
  execute(instruction) {
    return this.clone({ ptrs: this.ptrs.flatMap((ptr) => ptr.execute(instruction)) });
  }
  /**
   * Executes an array of instructions.
   * @param instruction The instructions to execute
   * @returns {Constructor} Instance with the result pointers.
   */
  executeAll(instructions) {
    let output = this;
    for (const instruction of instructions) {
      output = output.execute(instruction);
    }
    return output;
  }
  /**
   * Filter the pointers based on the result of the given callback function.
   * @param callback
   * @returns {Constructor} Instance with the filtered pointers.
   */
  filter(callback) {
    return this.clone({ ptrs: [...this].filter(callback).map((ptr) => ptr.ptrs[0]) });
  }
  /**
   * Filter the pointers based on matching quad(s) with the current terms as the object.
   * @param {Term[]} predicates Predicates of the quads
   * @param {Term[]} subjects Subjects of the quads
   * @returns {Constructor} Instance that contains only the filtered pointers
   */
  hasIn(predicates, subjects) {
    return this.clone({ ptrs: this.ptrs.flatMap((ptr) => ptr.hasIn(predicates, subjects)) });
  }
  /**
   * Filter the pointers based on matching quad(s) with the current terms as the subject.
   * @param {Term[]} predicates Predicates of the quads
   * @param {Term[]} objects Objects of the quads
   * @returns {Constructor} Instance that contains only the filtered pointers
   */
  hasOut(predicates, objects) {
    return this.clone({ ptrs: this.ptrs.flatMap((ptr) => ptr.hasOut(predicates, objects)) });
  }
  /**
   * Traverse the graph with the current terms as the object.
   * @param {Term[]} predicates Predicates of the quads
   * @param {Term[]} subjects Subjects of the quads
   * @returns {Constructor} Instance with pointers of the traversed target terms
   */
  in(predicates, subjects) {
    return this.clone({ ptrs: this.ptrs.flatMap((ptr) => ptr.in(predicates, subjects)) });
  }
  /**
   * Check if any pointer is an any-pointer.
   * @returns {boolean} True if any any-pointer was found
   */
  isAny() {
    return this.ptrs.length > 0 && this.ptrs.some((ptr) => ptr.isAny());
  }
  /**
   * Check if there is only one pointer and whether that pointer is a list.
   * @returns {boolean} True if the pointer is a list
   */
  isList() {
    if (this.ptrs.length !== 1) {
      return false;
    }
    return this.ptrs[0].isList();
  }
  /**
   * Create an iterator for the list if the instance is a list; otherwise, return undefined.
   * @returns {Iterator<Constructor>|undefined} Iterator or undefined
   */
  list() {
    if (!this.isList()) {
      return void 0;
    }
    const iterator = this.ptrs[0].list();
    const ths = this;
    return (function* () {
      for (const ptr of iterator) {
        yield ths.clone({ ptrs: [ptr] });
      }
    })();
  }
  /**
   * Map each pointer using the given callback function.
   * @param callback
   * @returns {Array} Array of mapped results
   */
  map(callback) {
    return [...this].map(callback);
  }
  /**
   * Create a new instance with pointers using the given terms.
   * @param terms Array of terms for the pointers
   * @returns {Constructor} Instance with pointers of the given terms
   */
  node(terms) {
    const dataset2 = this.dataset;
    const ptrs = [...terms].map((term) => new Path_default({ dataset: dataset2, factory: this.factory, term }));
    return this.clone({ ptrs });
  }
  /**
   * Traverse the graph with the current terms as the subject.
   * @param {Term[]} predicates Predicates of the quads
   * @param {Term[]} objects Objects of the quads
   * @returns {Constructor} Instance with pointers of the traversed target terms
   */
  out(predicates, objects) {
    return this.clone({ ptrs: this.ptrs.flatMap((ptr) => ptr.out(predicates, objects)) });
  }
  /**
   * Create an iterator of all quads of all pointer paths.
   * @returns {Iterator<Quad>} Iterator for the quads
   */
  *quads() {
    for (const { edges } of this.ptrs) {
      for (const { quad: quad4 } of edges) {
        yield quad4;
      }
    }
  }
  /**
   * Trim the path of all pointers and create a new instance for the result.
   * @returns {Constructor} Instance of the trimmed pointers
   */
  trim() {
    return this.clone({
      ptrs: this.ptrs.map((ptr) => ptr.trim())
    });
  }
  /**
   * Iterator for each pointer wrapped into a new instance.
   * @returns {Iterator<Constructor>}} Iterator for the wrapped pointers
   */
  *[Symbol.iterator]() {
    for (const ptr of this.ptrs) {
      yield this.clone({ ptrs: [ptr] });
    }
  }
};
var PathList_default = PathList;

// node_modules/shacl-engine/lib/namespaces.js
var owl = namespace_default("http://www.w3.org/2002/07/owl#");
var rdf3 = namespace_default("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
var rdfs2 = namespace_default("http://www.w3.org/2000/01/rdf-schema#");
var sh = namespace_default("http://www.w3.org/ns/shacl#");
var shn = namespace_default("https://schemas.link/shacl-next#");
var xsd5 = namespace_default("http://www.w3.org/2001/XMLSchema#");

// node_modules/shacl-engine/lib/pathsToString.js
function pathToString(path) {
  if (!path) {
    return "{}";
  }
  return `{${[...path.quads()].map((quad4) => to_ntriples_default(quad4)).join(" ")}}`;
}
function pathsToString(paths) {
  if (!paths) {
    return "{}";
  }
  return `{${paths.map((path) => pathToString(path)).join(" ")}}`;
}
var pathsToString_default = pathsToString;

// node_modules/shacl-engine/lib/Report.js
var import_once = __toESM(require_once(), 1);
var Report = class {
  constructor({ details, factory: factory2, options, results = [] } = {}) {
    this.details = details;
    this.factory = factory2;
    this.options = options;
    this.results = results;
    this._conforms = (0, import_once.default)(() => !this.results.some((result) => {
      return result.severity.equals(sh.Info) || result.severity.equals(sh.Violation) || result.severity.equals(sh.Warning);
    }));
    this._ptr = (0, import_once.default)(() => this.build());
  }
  get conforms() {
    return this._conforms();
  }
  get dataset() {
    return this.ptr.dataset;
  }
  get ptr() {
    return this._ptr();
  }
  get term() {
    return this.ptr.term;
  }
  build() {
    const ptr = new PathList_default({
      dataset: this.factory.dataset(),
      factory: this.factory,
      terms: [this.factory.blankNode()]
    });
    ptr.addOut([rdf3.type], [sh.ValidationReport]).addOut([sh.conforms], [this.factory.literal(this.conforms.toString(), xsd5.boolean)]);
    for (const result of this.results) {
      ptr.addOut([sh.result], [this.factory.blankNode()], (resultPtr) => {
        result.build(resultPtr, this.options);
      });
    }
    return ptr;
  }
  coverage() {
    return this.results.flatMap((result) => result.coverage());
  }
};
var Report_default = Report;

// node_modules/shacl-engine/lib/Result.js
var import_once2 = __toESM(require_once(), 1);
function resolveVariables(message, args) {
  return Object.entries(args).reduce((message2, [name, value]) => {
    if (value && value.termType) {
      value = to_ntriples_default(value);
    }
    return message2.replace(`{$${name}}`, value).replace(`{?${name}}`, value);
  }, message);
}
var Result = class {
  constructor({
    args = {},
    constraintComponent,
    factory: factory2,
    focusNode,
    message = [],
    path,
    results = [],
    severity,
    shape,
    source = [],
    value,
    valuePaths = []
  } = {}) {
    this.args = args;
    this.constraintComponent = constraintComponent;
    this.factory = factory2;
    this.focusNode = focusNode;
    this.path = path || shape.path;
    this.results = results;
    this.severity = severity;
    this.shape = shape;
    this.source = source;
    this.value = value;
    this.valuePaths = valuePaths;
    this._message = (0, import_once2.default)(() => {
      if (this.shape.message.length > 0) {
        message = this.shape.message;
      }
      if (message.length === 0) {
        message = this.shape.ptr.node([this.constraintComponent]).out([sh.message]).terms;
      }
      return message.map((message2) => {
        return factory2.literal(resolveVariables(message2.value, args, factory2), message2.language || null);
      });
    });
  }
  get message() {
    return this._message();
  }
  build(resultPtr, { details } = {}) {
    resultPtr.addOut([rdf3.type], [sh.ValidationResult]).addOut([sh.focusNode], this.focusNode.terms).addOut([sh.resultSeverity], [this.severity]).addOut([sh.sourceConstraint], this.source).addOut([sh.sourceConstraintComponent], [this.constraintComponent]).addOut([sh.sourceShape], this.shape.ptr.terms);
    if (this.message) {
      resultPtr.addOut([sh.resultMessage], this.message);
    }
    const buildResultStep = (step) => {
      if (step.quantifier === "one") {
        if (step.predicates.length > 1) {
          return resultPtr.node([this.factory.blankNode()]).addList([sh.alternativePath], step.predicates);
        }
        if (step.start === "object") {
          return resultPtr.node([this.factory.blankNode()]).addOut([sh.inversePath], [step.predicates[0]]);
        }
        return resultPtr.node([step.predicates[0]]);
      }
      if (step.quantifier === "oneOrMore") {
        return resultPtr.node([this.factory.blankNode()]).addOut([sh.oneOrMorePath], [step.predicates[0]]);
      }
      if (step.quantifier === "zeroOrMore") {
        return resultPtr.node([this.factory.blankNode()]).addOut([sh.zeroOrMorePath], [step.predicates[0]]);
      }
      if (step.quantifier === "zeroOrOne") {
        return resultPtr.node([this.factory.blankNode()]).addOut([sh.zeroOrOnePath], [step.predicates[0]]);
      }
    };
    if (this.path) {
      if (this.path.length === 1) {
        resultPtr.addOut([sh.resultPath], buildResultStep(this.path[0]).terms);
      } else {
        resultPtr.addList([sh.resultPath], this.path.map((step) => buildResultStep(step).term));
      }
    }
    if (typeof this.value !== "undefined") {
      resultPtr.addOut([sh.value], this.value.terms);
    }
    if (details) {
      for (const result of this.results) {
        resultPtr.addOut([sh.detail], [this.factory.blankNode()], (detailPtr) => {
          result.build(detailPtr, { details });
        });
      }
    }
  }
  coverage() {
    return [
      ...this.valuePaths.flatMap((valuePath) => [...valuePath.quads()]),
      ...this.results.flatMap((result) => result.coverage())
    ];
  }
};
var Result_default = Result;

// node_modules/shacl-engine/lib/Context.js
var Context = class _Context {
  constructor({
    factory: factory2,
    focusNode,
    options = { debug: false, details: false },
    processed = /* @__PURE__ */ new Set(),
    report = new Report_default({ factory: factory2, options }),
    results = /* @__PURE__ */ new Map(),
    shape,
    value,
    valueOrNode,
    valuePaths,
    values
  } = {}) {
    this.factory = factory2;
    this.focusNode = focusNode;
    this.options = options;
    this.processed = processed;
    this.report = report;
    this.results = results;
    this.shape = shape;
    this.value = value;
    this.valuePaths = valuePaths;
    this.valueOrNode = valueOrNode;
    this.values = values;
  }
  create({
    child,
    focusNode = this.focusNode,
    shape = this.shape,
    value = this.value,
    valueOrNode = this.valueOrNode,
    valuePaths = this.valuePaths,
    values = this.values
  } = {}) {
    return new _Context({
      factory: this.factory,
      focusNode,
      options: this.options,
      processed: this.processed,
      report: child ? new Report_default({ factory: this.factory, options: this.options }) : this.report,
      results: this.results,
      shape,
      value,
      valueOrNode,
      valuePaths,
      values
    });
  }
  id({ shape = this.shape } = {}) {
    return `${to_ntriples_default(shape.ptr.term)} - ${to_ntriples_default(this.focusNode.term)} - ${pathsToString_default(this.valuePaths)}`;
  }
  result(args) {
    const result = new Result_default({
      factory: this.factory,
      focusNode: this.focusNode,
      shape: this.shape,
      value: this.value,
      valuePaths: this.valuePaths,
      ...args
    });
    const id = this.id();
    if (!this.results.has(id)) {
      this.results.set(id, /* @__PURE__ */ new Set([result]));
    } else {
      this.results.get(id).add(result);
    }
    this.report.results.push(result);
  }
  debug(constraintComponent, args) {
    if (this.options.debug) {
      this.result({ severity: shn.Debug, constraintComponent, ...args });
    }
  }
  trace(constraintComponent, args) {
    if (this.options.trace) {
      this.result({ severity: shn.Trace, constraintComponent, ...args });
    }
  }
  test(success, constraintComponent, args) {
    if (success) {
      this.debug(constraintComponent, args);
    } else {
      this.violation(constraintComponent, args);
    }
  }
  violation(constraintComponent, args) {
    this.result({
      constraintComponent,
      severity: this.shape.severity || sh.Violation,
      ...args
    });
  }
};
var Context_default = Context;

// node_modules/shacl-engine/lib/validations/traversal.js
function compileTraversal() {
  return {
    generic: validateTraversal()
  };
}
function validateTraversal() {
  return (context) => {
    context.trace(shn.TraversalConstraintComponent, {
      args: {},
      message: [context.factory.literal("Traversal")],
      value: context.valueOrNode
    });
  };
}

// node_modules/shacl-engine/lib/Registry.js
var Registry = class {
  constructor(validations2) {
    this.validations = new TermMap_default(validations2);
  }
  compile(shape) {
    const coverage = shape.validator.options.coverage;
    if (shape.deactivated) {
      return [];
    }
    let propertyValidation = false;
    const selected = /* @__PURE__ */ new Set();
    for (const property of shape.ptr.execute({ start: "subject", end: "predicate" })) {
      const result = this.validations.get(property.term);
      if (result) {
        selected.add(result);
        if (property.term.equals(sh.property)) {
          propertyValidation = true;
        }
      }
    }
    if (coverage && shape.isPropertyShape && !propertyValidation) {
      selected.add(compileTraversal);
    }
    return [...selected].map((selected2) => selected2(shape)).filter(Boolean);
  }
};
var Registry_default = Registry;

// node_modules/shacl-engine/lib/Shape.js
var import_once4 = __toESM(require_once(), 1);
var import_rdf_literal = __toESM(require_rdf_literal(), 1);

// node_modules/shacl-engine/lib/parsePath.js
function parseStep(ptr) {
  if (ptr.term.termType !== "BlankNode") {
    return {
      quantifier: "one",
      start: "subject",
      end: "object",
      predicates: [ptr.term]
    };
  }
  const alternativePtr = ptr.out([sh.alternativePath]);
  if (alternativePtr.ptrs.length === 1 && alternativePtr.ptrs[0].isList()) {
    return {
      quantifier: "one",
      start: "subject",
      end: "object",
      predicates: [...alternativePtr.list()].map((ptr2) => ptr2.term)
    };
  }
  const inversePtr = ptr.out([sh.inversePath]);
  if (inversePtr.term) {
    return {
      quantifier: "one",
      start: "object",
      end: "subject",
      predicates: [inversePtr.term]
    };
  }
  const oneOrMorePtr = ptr.out([sh.oneOrMorePath]);
  if (oneOrMorePtr.term) {
    return {
      quantifier: "oneOrMore",
      start: "subject",
      end: "object",
      predicates: [oneOrMorePtr.term]
    };
  }
  const zeroOrMorePtr = ptr.out([sh.zeroOrMorePath]);
  if (zeroOrMorePtr.term) {
    return {
      quantifier: "zeroOrMore",
      start: "subject",
      end: "object",
      predicates: [zeroOrMorePtr.term]
    };
  }
  const zeroOrOnePtr = ptr.out([sh.zeroOrOnePath]);
  if (zeroOrOnePtr.term) {
    return {
      quantifier: "zeroOrOne",
      start: "subject",
      end: "object",
      predicates: [zeroOrOnePtr.term]
    };
  }
}
function parsePath(ptr) {
  if (ptr.terms.length === 0) {
    return null;
  }
  if (!ptr.ptrs[0].isList()) {
    return [parseStep(ptr)];
  }
  return [...ptr.list()].map((stepPtr) => parseStep(stepPtr));
}
var parsePath_default = parsePath;

// node_modules/shacl-engine/lib/ShapeValidator.js
var import_once3 = __toESM(require_once(), 1);
var ShapeValidator = class {
  constructor(shape) {
    this.shape = shape;
    this._compiled = (0, import_once3.default)(() => this.shape.validator.registry.compile(shape));
  }
  get compiled() {
    return this._compiled();
  }
  async validate(context) {
    if (context.focusNode.dataset.size === 0) {
      return context;
    }
    if (this.shape.isPropertyShape) {
      await this.validateProperty(context);
    } else {
      await this.validateNode(context);
    }
    return context;
  }
  async validateNode(context) {
    const shapeContext = context.create({ shape: this.shape, valueOrNode: context.value || context.focusNode });
    for (const validation of this.compiled) {
      if (validation.node) {
        await validation.node(shapeContext);
      }
      if (validation.generic) {
        await validation.generic(shapeContext);
      }
    }
  }
  async validateProperty(context) {
    let resolved;
    if (this.shape.isSparqlShape) {
      resolved = context.focusNode;
    } else {
      resolved = context.focusNode.executeAll(this.shape.path);
    }
    const values = resolved.node(new TermSet_default(resolved.terms));
    const valuesPaths = [...resolved].reduce((valuesPaths2, valuePaths) => {
      const term = valuePaths.term;
      const value = resolved.node([term]);
      if (!valuesPaths2.has(term)) {
        valuesPaths2.set(term, { value, valuePaths: [] });
      }
      valuesPaths2.get(term).valuePaths.push(valuePaths);
      return valuesPaths2;
    }, new TermMap_default()).values();
    const valuesContext = context.create({ shape: this.shape, values });
    for (const validation of this.compiled) {
      if (validation.property) {
        await validation.property(valuesContext);
      }
    }
    for (const { value, valuePaths } of valuesPaths) {
      const valueContext = context.create({ shape: this.shape, value, valueOrNode: value, valuePaths });
      for (const validation of this.compiled) {
        if (validation.generic) {
          await validation.generic(valueContext);
        }
      }
    }
  }
};
var ShapeValidator_default = ShapeValidator;

// node_modules/shacl-engine/lib/resolveClasses.js
function resolveClasses(classes) {
  const resolved = new TermSet_default();
  const ptr = new PathList_default({ dataset: classes.dataset, terms: classes.terms });
  const results = ptr.execute({
    quantifier: "zeroOrMore",
    start: "object",
    end: "subject",
    predicates: [rdfs2.subClassOf]
  });
  for (const result of results.ptrs) {
    for (const { term } of result.nodes()) {
      resolved.add(term);
    }
  }
  return resolved;
}
var resolveClasses_default = resolveClasses;

// node_modules/shacl-engine/lib/TargetResolver.js
var TargetResolver = class {
  constructor(ptr, { registry }) {
    this.registry = registry;
    this.targetClass = new TermSet_default([
      ...resolveClasses_default(ptr.hasOut([rdf3.type], [sh.NodeShape])),
      ...resolveClasses_default(ptr.out([sh.targetClass]))
    ]);
    this.targetNode = ptr.out([sh.targetNode]).terms;
    this.targetObjectsOf = ptr.out([sh.targetObjectsOf]).terms;
    this.targetSubjectsOf = ptr.out([sh.targetSubjectsOf]).terms;
    this.targets = [...ptr.out([sh.target])];
  }
  async resolve(context) {
    const any = context.focusNode.node([null]);
    const ptrs = [
      ...context.focusNode.hasOut([rdf3.type], this.targetClass).ptrs,
      ...context.focusNode.node(this.targetNode).ptrs,
      ...any.execute({ start: "object", end: "object", predicates: this.targetObjectsOf }).ptrs,
      ...any.execute({ start: "subject", end: "subject", predicates: this.targetSubjectsOf }).ptrs
    ];
    for (const targetPtr of this.targets) {
      for (const [, resolver] of this.registry.targetResolvers) {
        const terms = await resolver(targetPtr, context);
        ptrs.push(...context.focusNode.node(terms).ptrs);
      }
    }
    const resolved = context.focusNode.clone({ ptrs });
    return resolved.node([...new TermSet_default(resolved.terms)]);
  }
};
var TargetResolver_default = TargetResolver;

// node_modules/shacl-engine/lib/Shape.js
var Shape = class {
  constructor(ptr, { validator }) {
    this.ptr = ptr;
    this.validator = validator;
    this._deactivated = (0, import_once4.default)(() => {
      const deactivatedTerm = this.ptr.out([sh.deactivated]).term;
      return deactivatedTerm && (0, import_rdf_literal.fromRdf)(deactivatedTerm);
    });
    this._message = (0, import_once4.default)(() => this.ptr.out([sh.message]).terms);
    this._path = (0, import_once4.default)(() => parsePath_default(this.ptr.out([sh.path])));
    this._severity = (0, import_once4.default)(() => this.ptr.out([sh.severity]).term);
    this._shapeValidator = (0, import_once4.default)(() => new ShapeValidator_default(this));
    this._sparql = (0, import_once4.default)(() => this.ptr.out([sh.sparql]));
    this._targetResolver = (0, import_once4.default)(() => new TargetResolver_default(this.ptr, { registry: this.validator.targetResolverRegistry }));
  }
  get deactivated() {
    return this._deactivated();
  }
  get isPropertyShape() {
    return Boolean(this.path);
  }
  get isSparqlShape() {
    return this.sparql.terms.length > 0;
  }
  get path() {
    return this._path();
  }
  get targetResolver() {
    return this._targetResolver();
  }
  get message() {
    return this._message();
  }
  get severity() {
    return this._severity();
  }
  get shapeValidator() {
    return this._shapeValidator();
  }
  get sparql() {
    return this._sparql();
  }
  async resolveTargets(context) {
    return this.targetResolver.resolve(context);
  }
  async validate(context) {
    const id = context.id({ shape: this });
    if (context.processed.has(id)) {
      if (context.results.has(id)) {
        for (const result of context.results.get(id)) {
          context.report.results.push(result);
        }
      }
      return context;
    }
    context.processed.add(id);
    return this.shapeValidator.validate(context);
  }
};
var Shape_default = Shape;

// node_modules/shacl-engine/lib/TargetResolverRegistry.js
var TargetResolverRegistry = class {
  constructor(targetResolvers) {
    this.targetResolvers = new TermMap_default(targetResolvers);
  }
};
var TargetResolverRegistry_default = TargetResolverRegistry;

// node_modules/shacl-engine/lib/validations/cardinality.js
function compileMaxCount(shape) {
  const maxCount = parseInt(shape.ptr.out([sh.maxCount]).value);
  return {
    property: validateMaxCountProperty(maxCount)
  };
}
function validateMaxCountProperty(maxCount) {
  return (context) => {
    context.test(context.values.terms.length <= maxCount, sh.MaxCountConstraintComponent, {
      args: { maxCount },
      message: [context.factory.literal("More than {$maxCount} values")]
    });
  };
}
function compileMinCount(shape) {
  const minCount = parseInt(shape.ptr.out([sh.minCount]).value);
  return {
    property: validateMinCountProperty(minCount)
  };
}
function validateMinCountProperty(minCount) {
  return (context) => {
    context.test(context.values.terms.length >= minCount, sh.MinCountConstraintComponent, {
      args: { minCount },
      message: [context.factory.literal("Less than {$minCount} values")]
    });
  };
}

// node_modules/shacl-engine/lib/async.js
async function every(items, func) {
  for (const item of items) {
    if (!await func(item)) {
      return false;
    }
  }
  return true;
}
async function filter(items, func) {
  return (await Promise.all(items.map((item) => func(item)))).filter(Boolean);
}
async function map(items, func) {
  return Promise.all(items.map(func));
}
async function some(items, func) {
  for (const item of items) {
    if (await func(item)) {
      return true;
    }
  }
  return false;
}

// node_modules/shacl-engine/lib/validations/logical.js
function compileAnd(shape) {
  const and = [...shape.ptr.out([sh.and])].flatMap((ptr) => [...ptr.list()]).map((ptr) => shape.validator.shape(ptr));
  return {
    generic: validateAnd(and)
  };
}
function validateAnd(and) {
  return async (context) => {
    const andReports = await map(and, async (shape) => {
      return (await shape.validate(context.create({ child: true, focusNode: context.valueOrNode }))).report;
    });
    const result = andReports.every((report) => report.conforms);
    context.test(result, sh.AndConstraintComponent, {
      results: andReports.flatMap((report) => report.results),
      value: context.valueOrNode
    });
  };
}
function compileNot(shape) {
  const not = shape.validator.shape(shape.ptr.out([sh.not]));
  return {
    generic: validateNot(not)
  };
}
function validateNot(not) {
  return async (context) => {
    const notReport = (await not.validate(context.create({ child: true, focusNode: context.valueOrNode }))).report;
    const result = !notReport.conforms;
    context.test(result, sh.NotConstraintComponent, {
      args: { not: not.ptr.term },
      message: [context.factory.literal("Value does have shape {$not}")],
      results: notReport.results,
      value: context.valueOrNode
    });
  };
}
function compileOr(shape) {
  const or = [...shape.ptr.out([sh.or])].flatMap((ptr) => [...ptr.list()]).map((ptr) => shape.validator.shape(ptr));
  return {
    generic: validateOr(or)
  };
}
function validateOr(or) {
  return async (context) => {
    let results = [];
    let result;
    if (context.options.debug || context.options.details) {
      const orReports = await map(or, async (shape) => {
        return (await shape.validate(context.create({ child: true, focusNode: context.valueOrNode }))).report;
      });
      results = orReports.flatMap((report) => report.results);
      result = orReports.some((report) => report.conforms);
    } else {
      result = await some(or, async (shape) => {
        return (await shape.validate(context.create({ child: true, focusNode: context.valueOrNode }))).report.conforms;
      });
    }
    context.test(result, sh.OrConstraintComponent, {
      results,
      value: context.valueOrNode
    });
  };
}
function compileXone(shape) {
  const xone = [...shape.ptr.out([sh.xone])].flatMap((ptr) => [...ptr.list()]).map((ptr) => shape.validator.shape(ptr));
  return {
    generic: validateXone(xone)
  };
}
function validateXone(xone) {
  return async (context) => {
    const xoneReports = await map(xone, async (shape) => {
      return (await shape.validate(context.create({ child: true, focusNode: context.valueOrNode }))).report;
    });
    const result = xoneReports.filter((report) => report.conforms).length === 1;
    context.test(result, sh.XoneConstraintComponent, {
      results: xoneReports.flatMap((report) => report.results),
      value: context.valueOrNode
    });
  };
}

// node_modules/shacl-engine/lib/validations/other.js
var import_rdf_literal2 = __toESM(require_rdf_literal(), 1);
function compileClosedNode(shape) {
  const closed = (0, import_rdf_literal2.fromRdf)(shape.ptr.out([sh.closed]).term);
  if (!closed) {
    return null;
  }
  const propertyShapes = shape.ptr.out([sh.property]).map((ptr) => shape.validator.shape(ptr));
  const properties = new TermSet_default(propertyShapes.filter((shape2) => !shape2.deactivated).map((shape2) => shape2.path[0].predicates[0]));
  const ignoredProperties = new TermSet_default([...shape.ptr.out([sh.ignoredProperties]).list() || []].map((item) => item.term));
  return {
    node: validateClosedNode(properties, ignoredProperties)
  };
}
function validateClosedNode(properties, ignoredProperties) {
  return (context) => {
    const notAllowed = context.focusNode.execute({ start: "subject", end: "predicate" }).filter((property) => {
      if (ignoredProperties.has(property.term)) {
        return false;
      }
      return !properties.has(property.term);
    });
    if (notAllowed.ptrs.length > 0) {
      for (const value of notAllowed) {
        context.violation(sh.ClosedConstraintComponent, {
          message: [context.factory.literal("Predicate is not allowed (closed shape)")],
          path: [{ quantifier: "one", start: "subject", end: "object", predicates: [value.term] }],
          value: context.focusNode.node([[...value.quads()][0].object])
        });
      }
    } else {
      context.debug(sh.ClosedConstraintComponent);
    }
  };
}
function compileHasValue(shape) {
  const hasValue = shape.ptr.out([sh.hasValue]).term;
  return {
    node: validateHasValueNode(hasValue),
    property: validateHasValueProperty(hasValue)
  };
}
function validateHasValueNode(hasValue) {
  return (context) => {
    context.test(hasValue.equals(context.valueOrNode.term), sh.HasValueConstraintComponent, {
      args: { hasValue },
      message: [context.factory.literal("Value must be {$hasValue}")]
    });
  };
}
function validateHasValueProperty(hasValue) {
  return (context) => {
    const result = [...context.values].some((value) => hasValue.equals(value.term));
    context.test(result, sh.HasValueConstraintComponent, {
      args: { hasValue },
      message: [context.factory.literal("Missing expected value {$hasValue}")]
    });
  };
}
function compileIn(shape) {
  const values = new TermSet_default([...shape.ptr.out([sh.in]).list()].map((item) => item.term));
  return {
    generic: validateIn(values)
  };
}
function validateIn(values) {
  return (context) => {
    context.test(values.has(context.valueOrNode.term), sh.InConstraintComponent, {
      args: { in: [...values].map((v5) => v5.value).join(", ") },
      message: [context.factory.literal("Value is not in {$in}")],
      value: context.valueOrNode
    });
  };
}

// node_modules/shacl-engine/lib/compareTerms.js
var import_rdf_literal3 = __toESM(require_rdf_literal(), 1);
function compareTerms(termA, termB) {
  if (!termA || termA.termType !== "Literal") {
    return null;
  }
  if (!termB || termB.termType !== "Literal") {
    return null;
  }
  if (hasTimezone(termA) !== hasTimezone(termB)) {
    return null;
  }
  const valueA = (0, import_rdf_literal3.fromRdf)(termA);
  const valueB = (0, import_rdf_literal3.fromRdf)(termB);
  if (typeof valueA !== typeof valueB) {
    return null;
  }
  if (typeof valueA === "string") {
    return valueA.localeCompare(valueB);
  }
  return valueA - valueB;
}
function hasTimezone(term) {
  const pattern = /^.*(((\+|-)\d{2}:\d{2})|Z)$/;
  return xsd5.dateTime.equals(term.datatype) && pattern.test(term.value);
}
var compareTerms_default = compareTerms;

// node_modules/shacl-engine/lib/validations/pair.js
function compileDisjoint(shape) {
  const disjoint = shape.ptr.out([sh.disjoint]).term;
  return {
    generic: validateDisjoint(disjoint)
  };
}
function validateDisjoint(disjoint) {
  return (context) => {
    const matches = context.focusNode.dataset.match(context.focusNode.term, disjoint, context.valueOrNode.term);
    context.test(matches.size === 0, sh.DisjointConstraintComponent, {
      args: { disjoint },
      message: [context.factory.literal("Value node must not also be one of the values of {$disjoint}")],
      value: context.valueOrNode
    });
  };
}
function compileEquals(shape) {
  const equals = shape.ptr.out([sh.equals]).term;
  return {
    node: validateEqualsNode(equals),
    property: validateEqualsProperty(equals)
  };
}
function validateEqualsNode(equals) {
  return (context) => {
    const reference = context.focusNode.out([equals]);
    const notEquals = reference.filter((ptr) => !ptr.term.equals(context.focusNode.term));
    const result = reference.terms.length !== 0 && notEquals.terms.length === 0;
    context.test(result, sh.EqualsConstraintComponent, {
      args: { equals },
      message: [context.factory.literal("Must have same values as {$equals}")],
      value: notEquals.terms[0] && context.focusNode.node([notEquals.terms[0]]) || context.focusNode
    });
  };
}
function validateEqualsProperty(equals) {
  return (context) => {
    const references = new TermSet_default(context.focusNode.out([equals]).terms);
    const values = new TermSet_default(context.values.terms);
    const missingReferences = [...values].filter((term) => !references.has(term));
    const missingValues = [...references].filter((term) => !values.has(term));
    const differences = [...missingReferences, ...missingValues];
    for (const value of differences) {
      context.violation(sh.EqualsConstraintComponent, {
        args: { equals },
        message: [context.factory.literal("Must have same values as {$equals}")],
        value: context.focusNode.node([value])
      });
    }
    if (differences.length === 0) {
      context.debug(sh.EqualsConstraintComponent, {
        args: { equals },
        message: [context.factory.literal("Must have same values as {$equals}")]
      });
    }
  };
}
function compileLessThan(shape) {
  const lessThan = shape.ptr.out([sh.lessThan]).term;
  return {
    property: validateLessThanProperty(lessThan)
  };
}
function validateLessThanProperty(lessThan) {
  return (context) => {
    const references = context.focusNode.out([lessThan]).terms;
    for (const value of context.values) {
      for (const reference of references) {
        const c5 = compareTerms_default(value.term, reference);
        if (c5 === null || c5 >= 0) {
          context.violation(sh.LessThanConstraintComponent, {
            args: { lessThan },
            message: [context.factory.literal("Value is not less than value of {$lessThan}")],
            value
          });
        } else {
          context.debug(sh.LessThanConstraintComponent, {
            args: { lessThan },
            message: [context.factory.literal("Value is not less than value of {$lessThan}")],
            value
          });
        }
      }
    }
  };
}
function compileLessThanOrEquals(shape) {
  const lessThanOrEquals = shape.ptr.out([sh.lessThanOrEquals]).term;
  return {
    property: validateLessThanOrEqualsProperty(lessThanOrEquals)
  };
}
function validateLessThanOrEqualsProperty(lessThanOrEquals) {
  return (context) => {
    const references = context.focusNode.out([lessThanOrEquals]).terms;
    for (const value of context.values) {
      for (const reference of references) {
        const c5 = compareTerms_default(value.term, reference);
        if (c5 === null || c5 > 0) {
          context.violation(sh.LessThanOrEqualsConstraintComponent, {
            args: { lessThanOrEquals },
            message: [context.factory.literal("Value is not less than or equal to value of {$lessThanOrEquals}")],
            value
          });
        } else {
          context.debug(sh.LessThanOrEqualsConstraintComponent, {
            args: { lessThanOrEquals },
            message: [context.factory.literal("Value is not less than or equal to value of {$lessThanOrEquals}")],
            value
          });
        }
      }
    }
  };
}

// node_modules/shacl-engine/lib/validations/range.js
function compileMaxExclusive(shape) {
  const maxExclusive = shape.ptr.out([sh.maxExclusive]).term;
  return {
    generic: validateMaxExclusive(maxExclusive)
  };
}
function validateMaxExclusive(maxExclusive) {
  return (context) => {
    const comparison = compareTerms_default(context.valueOrNode.term, maxExclusive);
    context.test(comparison !== null && comparison < 0, sh.MaxExclusiveConstraintComponent, {
      args: { maxExclusive },
      message: [context.factory.literal("Value is not less than {$maxExclusive}")],
      value: context.valueOrNode
    });
  };
}
function compileMaxInclusive(shape) {
  const maxInclusive = shape.ptr.out([sh.maxInclusive]).term;
  return {
    generic: validateMaxInclusive(maxInclusive)
  };
}
function validateMaxInclusive(maxInclusive) {
  return (context) => {
    const comparison = compareTerms_default(context.valueOrNode.term, maxInclusive);
    context.test(comparison !== null && comparison <= 0, sh.MaxInclusiveConstraintComponent, {
      args: { maxInclusive },
      message: [context.factory.literal("Value is not less than or equal to {$maxInclusive}")],
      value: context.valueOrNode
    });
  };
}
function compileMinExclusive(shape) {
  const minExclusive = shape.ptr.out([sh.minExclusive]).term;
  return {
    generic: validateMinExclusive(minExclusive)
  };
}
function validateMinExclusive(minExclusive) {
  return (context) => {
    const comparison = compareTerms_default(context.valueOrNode.term, minExclusive);
    context.test(comparison !== null && comparison > 0, sh.MinExclusiveConstraintComponent, {
      args: { minExclusive },
      message: [context.factory.literal("Value is not greater than {$minExclusive}")],
      value: context.valueOrNode
    });
  };
}
function compileMinInclusive(shape) {
  const minInclusive = shape.ptr.out([sh.minInclusive]).term;
  return {
    generic: validateMinInclusive(minInclusive)
  };
}
function validateMinInclusive(minInclusive) {
  return (context) => {
    const comparison = compareTerms_default(context.valueOrNode.term, minInclusive);
    context.test(comparison !== null && comparison >= 0, sh.MinInclusiveConstraintComponent, {
      args: { minInclusive },
      message: [context.factory.literal("Value is not greater than or equal to {$minInclusive}")],
      value: context.valueOrNode
    });
  };
}

// node_modules/shacl-engine/lib/validations/shape.js
var import_rdf_literal4 = __toESM(require_rdf_literal(), 1);
function compileNode(shape) {
  const node = [...shape.ptr.out([sh.node])].map((ptr) => shape.validator.shape(ptr));
  return {
    generic: validateNode(node)
  };
}
function validateNode(node) {
  return async (context) => {
    for (const shape of node) {
      const nodeContext = await shape.validate(context.create({ child: true, focusNode: context.valueOrNode }));
      context.test(nodeContext.report.conforms, sh.NodeConstraintComponent, {
        args: { node: shape.ptr.term },
        message: [context.factory.literal("Value does not have shape {$node}")],
        results: nodeContext.report.results,
        value: context.valueOrNode
      });
    }
  };
}
function compileProperty(shape) {
  const property = [...shape.ptr.out([sh.property])].map((ptr) => shape.validator.shape(ptr));
  return {
    generic: validateProperty(property)
  };
}
function validateProperty(property) {
  return async (context) => {
    const propertyContext = context.create({ focusNode: context.valueOrNode });
    for (const shape of property) {
      await shape.validate(propertyContext);
    }
  };
}
function compileQualifiedShape(shape) {
  const valueShape = shape.validator.shape(shape.ptr.out([sh.qualifiedValueShape]));
  const valueShapesDisjointTerm = shape.ptr.out([sh.qualifiedValueShapesDisjoint]).term;
  const valueShapesDisjoint = valueShapesDisjointTerm ? (0, import_rdf_literal4.fromRdf)(valueShapesDisjointTerm) : false;
  const maxCountTerm = shape.ptr.out([sh.qualifiedMaxCount]).term;
  const maxCount = maxCountTerm ? parseInt(maxCountTerm.value) : null;
  const minCountTerm = shape.ptr.out([sh.qualifiedMinCount]).term;
  const minCount = minCountTerm ? parseInt(minCountTerm.value) : null;
  return {
    property: validateQualifiedShapeProperty(valueShape, valueShapesDisjoint, maxCount, minCount)
  };
}
function validateQualifiedShapeProperty(valueShape, valueShapesDisjoint, maxCount, minCount) {
  return async (context) => {
    const resultsDeep = [];
    let siblingShapes = [];
    if (valueShapesDisjoint) {
      siblingShapes = new Set(
        context.shape.ptr.in([sh.property]).out([sh.property]).out([sh.qualifiedValueShape]).filter((ptr) => !ptr.term.equals(valueShape.ptr.term)).map((ptr) => context.shape.validator.shape(ptr))
      );
    }
    const count = (await filter(context.values, async (value) => {
      const valueShapeReport = (await valueShape.validate(context.create({ child: true, focusNode: value }))).report;
      resultsDeep.push(valueShapeReport.results);
      if (!valueShapeReport.conforms) {
        return false;
      }
      if (siblingShapes.length === 0) {
        return true;
      }
      if (context.options.debug || context.options.details) {
        const siblingReports = await map([...siblingShapes], async (siblingShape) => {
          return (await siblingShape.validate(context.create({ child: true, focusNode: value }))).report;
        });
        resultsDeep.push(siblingReports.flatMap((report) => report.results));
        return !siblingReports.every((report) => report.conforms);
      } else {
        return !await every([...siblingShapes], async (siblingShape) => {
          return (await siblingShape.validate(context.create({ child: true, focusNode: value }))).report.conforms;
        });
      }
    })).length;
    if (maxCount !== null) {
      context.test(count <= maxCount, sh.QualifiedMaxCountConstraintComponent, {
        args: {
          qualifiedMaxCount: maxCount,
          qualifiedValueShape: valueShape.ptr.term,
          qualifiedValueShapesDisjoint: valueShapesDisjoint
        },
        message: [context.factory.literal("More than {$qualifiedMaxCount} values have shape {$qualifiedValueShape}")],
        results: resultsDeep.flat()
      });
    }
    if (minCount !== null) {
      context.test(count >= minCount, sh.QualifiedMinCountConstraintComponent, {
        args: {
          qualifiedMinCount: minCount,
          qualifiedValueShape: valueShape.ptr.term,
          qualifiedValueShapesDisjoint: valueShapesDisjoint
        },
        message: [context.factory.literal("Less than {$qualifiedMinCount} values have shape {$qualifiedValueShape}")],
        results: resultsDeep.flat()
      });
    }
  };
}

// node_modules/shacl-engine/lib/validations/string.js
function languageMatch(item, language2) {
  if (!language2) {
    return false;
  }
  return language2.slice(0, item.length) === item;
}
function compileLanguageIn(shape) {
  const languageIn = [...new Set([...shape.ptr.out([sh.languageIn]).list()].map((item) => item.value))];
  return {
    generic: validateLanguageIn(languageIn)
  };
}
function validateLanguageIn(languageIn) {
  return (context) => {
    const result = languageIn.some((item) => languageMatch(item, context.valueOrNode.term.language));
    context.test(result, sh.LanguageInConstraintComponent, {
      args: { languageIn: languageIn.join(", ") },
      message: [context.factory.literal("Language does not match any of {$languageIn}")],
      value: context.valueOrNode
    });
  };
}
function compileMaxLength(shape) {
  const maxLength = parseInt(shape.ptr.out([sh.maxLength]).value);
  return {
    generic: validateMaxLength(maxLength)
  };
}
function validateMaxLength(maxLength) {
  return (context) => {
    const result = context.valueOrNode.term.termType !== "BlankNode" && context.valueOrNode.value.length <= maxLength;
    context.test(result, sh.MaxLengthConstraintComponent, {
      args: { maxLength },
      message: [context.factory.literal("Value has more than {$maxLength} characters")],
      value: context.valueOrNode
    });
  };
}
function compileMinLength(shape) {
  const minLength = parseInt(shape.ptr.out([sh.minLength]).value);
  return {
    generic: validateMinLength(minLength)
  };
}
function validateMinLength(minLength) {
  return (context) => {
    const result = context.valueOrNode.term.termType !== "BlankNode" && context.valueOrNode.value.length >= minLength;
    context.test(result, sh.MinLengthConstraintComponent, {
      args: { minLength },
      message: [context.factory.literal("Value has less than {$minLength} characters")],
      value: context.valueOrNode
    });
  };
}
function compilePattern(shape) {
  const pattern = shape.ptr.out([sh.pattern]).value;
  const flags = shape.ptr.out([sh.flags]).value;
  const regex = new RegExp(pattern, flags);
  return {
    generic: validatePattern(pattern, flags, regex)
  };
}
function validatePattern(pattern, flags, regex) {
  return (context) => {
    context.test(regex.test(context.valueOrNode.term.value), sh.PatternConstraintComponent, {
      args: { flags, pattern },
      message: [context.factory.literal('Value does not match pattern "{$pattern}"')],
      value: context.valueOrNode
    });
  };
}
function compileUniqueLang(shape) {
  const term = shape.ptr.out([sh.uniqueLang]).term;
  const uniqueLang = term.value === "true" && xsd5.boolean.equals(term.datatype);
  if (!uniqueLang) {
    return null;
  }
  return {
    property: validateUniqueLangProperty()
  };
}
function validateUniqueLangProperty() {
  return (context) => {
    const result = Object.entries(context.values.terms.reduce((result2, term) => {
      if (term.language) {
        result2[term.language] = (result2[term.language] || 0) + 1;
      }
      return result2;
    }, {}));
    const invalid = result.filter(([, count]) => count > 1);
    for (const [lang] of invalid) {
      context.violation(sh.UniqueLangConstraintComponent, {
        args: { lang },
        message: [context.factory.literal('Language "{?lang}" used more than once')]
      });
    }
    if (invalid.length === 0) {
      context.debug(sh.UniqueLangConstraintComponent);
    }
  };
}

// node_modules/rdf-validation/lib/namespaces.js
var sh2 = namespace_default("http://www.w3.org/ns/shacl#");
var shn2 = namespace_default("https://schemas.link/shacl-next#");

// node_modules/rdf-validation/lib/Report.js
var Report2 = class {
  constructor({ results = [] } = {}) {
    this.results = results;
  }
  get conforms() {
    return !this.results.some((result) => {
      return result.severity.equals(sh2.Info) || result.severity.equals(sh2.Violation) || result.severity.equals(sh2.Warning);
    });
  }
};
var Report_default2 = Report2;

// node_modules/rdf-validation/lib/Result.js
function resolveVariables2(message, args) {
  return Object.entries(args).reduce((message2, [name, value]) => {
    if (value && value.termType) {
      value = to_ntriples_default(value);
    }
    return message2.replace(`{$${name}}`, value).replace(`{?${name}}`, value);
  }, message);
}
var Result2 = class {
  constructor({ args = {}, factory: factory2, message = [], severity = sh2.Violation } = {}) {
    this.severity = severity;
    this.message = message.map((message2) => {
      return factory2.literal(resolveVariables2(message2.value, args), message2.language || null);
    });
  }
};
var Result_default2 = Result2;

// node_modules/rdf-validation/lib/Validation.js
var Validation = class _Validation {
  constructor({ factory: factory2 = data_model_default } = {}) {
    this.factory = factory2;
  }
  clone({ factory: factory2 } = {}) {
    return new _Validation({
      factory: factory2 || this.factory
    });
  }
  validate() {
    return new Report_default2();
  }
  validateSimple() {
    return true;
  }
};
var Validation_default = Validation;

// node_modules/rdf-validation/lib/term/DatatypeValidation.js
var DatatypeValidation = class _DatatypeValidation extends Validation_default {
  constructor({ datatypes, factory: factory2 } = {}) {
    super({ factory: factory2 });
    this.datatypes = [];
    for (const datatype of Array.isArray(datatypes) ? datatypes : [datatypes]) {
      if (datatype) {
        this.datatypes.push(this.factory.fromTerm(datatype));
      }
    }
  }
  clone({ factory: factory2 } = {}) {
    return new _DatatypeValidation({
      datatypes: this.datatypes,
      factory: factory2 || this.factory
    });
  }
};
var DatatypeValidation_default = DatatypeValidation;

// node_modules/rdf-validation/lib/term/DatatypeValidations.js
var DatatypeValidations = class {
  constructor({ factory: factory2 = data_model_default, validations: validations2 } = {}) {
    this.factory = factory2;
    this.validations = new TermMap_default();
    if (validations2) {
      for (const validation of Object.values(validations2)) {
        const clone = validation.clone({ factory: this.factory });
        for (const datatype of clone.datatypes) {
          this.validations.set(datatype, clone);
        }
      }
    }
  }
  validate(term) {
    const validation = this.validations.get(term.datatype);
    if (!validation) {
      return new Report_default2();
    }
    return validation.validate(term);
  }
  validateSimple(term) {
    const validation = this.validations.get(term.datatype);
    if (!validation) {
      return true;
    }
    return validation.validateSimple(term);
  }
};
var DatatypeValidations_default = DatatypeValidations;

// node_modules/rdf-validation/lib/term/PatternValidation.js
var PatternValidation = class _PatternValidation extends DatatypeValidation_default {
  constructor(patterns, datatypes, { factory: factory2 } = {}) {
    super({ datatypes, factory: factory2 });
    this.message = [this.factory.literal("term value {$this} matches pattern {$pattern}")];
    this.patterns = Array.isArray(patterns) ? patterns : [patterns];
  }
  clone({ factory: factory2 } = {}) {
    return new _PatternValidation(this.patterns, this.datatypes, {
      factory: factory2 || this.factory
    });
  }
  validate(term) {
    const results = this.patterns.map((pattern) => {
      let severity;
      if (pattern.test(term.value)) {
        severity = shn2.Debug;
      }
      const args = {
        pattern: this.factory.literal(pattern.toString()),
        this: term
      };
      return new Result_default2({
        args,
        factory: this.factory,
        message: this.message,
        severity
      });
    });
    return new Report_default2({ results });
  }
  validateSimple(term) {
    return this.patterns.every((pattern) => pattern.test(term.value));
  }
};
var PatternValidation_default = PatternValidation;

// node_modules/rdf-validation/lib/term/IntegerValidation.js
var integerPattern = /^([-+]?[0-9]+)$/;
var IntegerValidation = class _IntegerValidation extends PatternValidation_default {
  constructor(minInclusive = null, maxInclusive = null, datatypes, { factory: factory2 } = {}) {
    super(integerPattern, datatypes, { factory: factory2 });
    this.maxInclusive = null;
    this.minInclusive = null;
    if (typeof maxInclusive === "string") {
      this.maxInclusive = BigInt(maxInclusive);
    }
    if (typeof minInclusive === "string") {
      this.minInclusive = BigInt(minInclusive);
    }
  }
  clone({ factory: factory2 } = {}) {
    return new _IntegerValidation(
      this.minInclusive?.toString(),
      this.maxInclusive?.toString(),
      this.datatypes,
      {
        factory: factory2 || this.factory
      }
    );
  }
  validate(term) {
    const results = super.validate(term).results;
    if (!shn2.Debug.equals(results[0].severity)) {
      return new Report_default2({ results });
    }
    const value = BigInt(term.value);
    if (this.minInclusive !== null && value < this.minInclusive) {
      const messageStr = `term value "${term.value}" is less than "${this.minInclusive.toString()}"`;
      const message = [this.factory.literal(messageStr)];
      results.push(new Result_default2({ factory: this.factory, message }));
    }
    if (this.maxInclusive !== null && value > this.maxInclusive) {
      const messageStr = `term value "${term.value}" is greater than "${this.maxInclusive.toString()}"`;
      const message = [this.factory.literal(messageStr)];
      results.push(new Result_default2({ factory: this.factory, message }));
    }
    return new Report_default2({ results });
  }
  validateSimple(term) {
    if (!super.validateSimple(term)) {
      return false;
    }
    const value = BigInt(term.value);
    if (this.minInclusive !== null && value < this.minInclusive) {
      return false;
    }
    if (this.maxInclusive !== null && value > this.maxInclusive) {
      return false;
    }
    return true;
  }
};
var IntegerValidation_default = IntegerValidation;

// node_modules/rdf-validation/lib/term/InValidation.js
var InValidation = class _InValidation extends DatatypeValidation_default {
  constructor(values, datatypes, { factory: factory2 } = {}) {
    super({ datatypes, factory: factory2 });
    this.values = new Set(values);
  }
  clone({ factory: factory2 } = {}) {
    return new _InValidation(this.values, this.datatypes, {
      factory: factory2 || this.factory
    });
  }
  validate(term) {
    const results = [];
    if (!this.values.has(term.value)) {
      const messageStr = `term value "${term.value}" is not included in the list: ${[...this.values].join(",")}`;
      const message = [this.factory.literal(messageStr)];
      results.push(new Result_default2({ factory: this.factory, message }));
    }
    return new Report_default2({ results });
  }
  validateSimple(term) {
    return this.values.has(term.value);
  }
};
var InValidation_default = InValidation;

// node_modules/rdf-validation/lib/term/xsd.js
var xsd_exports = {};
__export(xsd_exports, {
  anyAtomicType: () => anyAtomicType,
  anySimpleType: () => anySimpleType,
  anyURI: () => anyURI,
  base64Binary: () => base64Binary,
  boolean: () => boolean,
  byte: () => byte,
  date: () => date,
  dateTime: () => dateTime,
  dateTimeStamp: () => dateTimeStamp,
  dayTimeDuration: () => dayTimeDuration,
  decimal: () => decimal,
  double: () => double,
  duration: () => duration,
  float: () => float,
  gDay: () => gDay,
  gMonth: () => gMonth,
  gMonthDay: () => gMonthDay,
  gYear: () => gYear,
  gYearMonth: () => gYearMonth,
  hexBinary: () => hexBinary,
  int: () => int,
  integer: () => integer,
  language: () => language,
  long: () => long,
  negativeInteger: () => negativeInteger,
  nonNegativeInteger: () => nonNegativeInteger,
  nonPositiveInteger: () => nonPositiveInteger,
  normalizedString: () => normalizedString,
  positiveInteger: () => positiveInteger,
  short: () => short,
  string: () => string,
  time: () => time,
  token: () => token,
  unsignedByte: () => unsignedByte,
  unsignedInt: () => unsignedInt,
  unsignedLong: () => unsignedLong,
  unsignedShort: () => unsignedShort,
  yearMonthDuration: () => yearMonthDuration
});
var ns = {
  xsd: namespace_default("http://www.w3.org/2001/XMLSchema#")
};
var anySimpleType = new DatatypeValidation_default({ datatypes: ns.xsd.anySimpleType });
var anyAtomicType = new DatatypeValidation_default({ datatypes: ns.xsd.anyAtomicType });
var stringPattern = /^([^\ud8ff-\udfff\ufffe-\uffff]*)$/;
var decimalPattern = /^((\+|-)?([0-9]+(\.[0-9]*)?|\.[0-9]+))$/;
var floatPattern = /^((\+|-)?([0-9]+(\.[0-9]*)?|\.[0-9]+)([Ee](\+|-)?[0-9]+)?|(\+|-)?INF|NaN)$/;
var durationPattern = /^(-?P((([0-9]+Y([0-9]+M)?([0-9]+D)?|([0-9]+M)([0-9]+D)?|([0-9]+D))(T(([0-9]+H)([0-9]+M)?([0-9]+(\.[0-9]+)?S)?|([0-9]+M)([0-9]+(\.[0-9]+)?S)?|([0-9]+(\.[0-9]+)?S)))?)|(T(([0-9]+H)([0-9]+M)?([0-9]+(\.[0-9]+)?S)?|([0-9]+M)([0-9]+(\.[0-9]+)?S)?|([0-9]+(\.[0-9]+)?S)))))$/;
var dateTimePattern = /^(-?([1-9][0-9]{3,}|0[0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T(([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?|(24:00:00(\.0+)?))(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))?)$/;
var timePattern = /^((([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?|(24:00:00(\.0+)?))(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))?)$/;
var datePattern = /^(-?([1-9][0-9]{3,}|0[0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))?)$/;
var gYearMonthPattern = /^(-?([1-9][0-9]{3,}|0[0-9]{3})-(0[1-9]|1[0-2])(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))?)$/;
var gYearPattern = /^(-?([1-9][0-9]{3,}|0[0-9]{3})(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))?)$/;
var gMonthDayPattern = /^(--(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))?)$/;
var gDayPattern = /^(---(0[1-9]|[12][0-9]|3[01])(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))?)$/;
var gMonthPattern = /^(--(0[1-9]|1[0-2])(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))?)$/;
var hexBinaryPattern = /^(([0-9a-fA-F]{2})*)$/;
var base64BinaryPattern = /^(((([A-Za-z0-9+/] ?){4})*(([A-Za-z0-9+/] ?){3}[A-Za-z0-9+/]|([A-Za-z0-9+/] ?){2}[AEIMQUYcgkosw048] ?=|[A-Za-z0-9+/] ?[AQgw] ?= ?=))?)$/;
var string = new PatternValidation_default(stringPattern, ns.xsd.string);
var boolean = new InValidation_default(["1", "true", "0", "false"], ns.xsd.boolean);
var decimal = new PatternValidation_default(decimalPattern, ns.xsd.decimal);
var float = new PatternValidation_default(floatPattern, ns.xsd.float);
var double = new PatternValidation_default(floatPattern, ns.xsd.double);
var duration = new PatternValidation_default(durationPattern, ns.xsd.duration);
var dateTime = new PatternValidation_default(dateTimePattern, ns.xsd.dateTime);
var time = new PatternValidation_default(timePattern, ns.xsd.time);
var date = new PatternValidation_default(datePattern, ns.xsd.date);
var gYearMonth = new PatternValidation_default(gYearMonthPattern, ns.xsd.gYearMonth);
var gYear = new PatternValidation_default(gYearPattern, ns.xsd.gYear);
var gMonthDay = new PatternValidation_default(gMonthDayPattern, ns.xsd.gMonthDay);
var gDay = new PatternValidation_default(gDayPattern, ns.xsd.gDay);
var gMonth = new PatternValidation_default(gMonthPattern, ns.xsd.gMonth);
var hexBinary = new PatternValidation_default(hexBinaryPattern, ns.xsd.hexBinary);
var base64Binary = new PatternValidation_default(base64BinaryPattern, ns.xsd.base64Binary);
var anyURI = new PatternValidation_default(stringPattern, ns.xsd.anyURI);
var normalizedStringPattern = /^([^\u000d\u000a\u0009]*)$/;
var tokenPattern = /^([^ ]+( [^ ]+)*)*$/;
var languagePattern = /^([a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*)$/;
var yearMonthDurationPattern = /^([^DT]*)$/;
var dayTimeDurationPattern = /^([^YM]*[DT].*)$/;
var dateTimeStampPattern = /^(.*(Z|(\+|-)[0-9][0-9]:[0-9][0-9]))$/;
var normalizedString = new PatternValidation_default([stringPattern, normalizedStringPattern], ns.xsd.normalizedString);
var token = new PatternValidation_default([stringPattern, normalizedStringPattern, tokenPattern], ns.xsd.token);
var language = new PatternValidation_default(languagePattern, ns.xsd.language);
var integer = new IntegerValidation_default(null, null, ns.xsd.integer);
var nonPositiveInteger = new IntegerValidation_default(null, "0", ns.xsd.nonPositiveInteger);
var negativeInteger = new IntegerValidation_default(null, "-1", ns.xsd.negativeInteger);
var long = new IntegerValidation_default("-9223372036854775808", "9223372036854775807", ns.xsd.long);
var int = new IntegerValidation_default("-2147483648", "2147483647", ns.xsd.int);
var short = new IntegerValidation_default("-32768", "32767", ns.xsd.short);
var byte = new IntegerValidation_default("-128", "127", ns.xsd.byte);
var nonNegativeInteger = new IntegerValidation_default("0", null, ns.xsd.nonNegativeInteger);
var unsignedLong = new IntegerValidation_default("0", "18446744073709551615", ns.xsd.unsignedLong);
var unsignedInt = new IntegerValidation_default("0", "4294967295", ns.xsd.unsignedInt);
var unsignedShort = new IntegerValidation_default("0", "65535", ns.xsd.unsignedShort);
var unsignedByte = new IntegerValidation_default("0", "255", ns.xsd.unsignedByte);
var positiveInteger = new IntegerValidation_default("1", null, ns.xsd.positiveInteger);
var yearMonthDuration = new PatternValidation_default([durationPattern, yearMonthDurationPattern], ns.xsd.yearMonthDuration);
var dayTimeDuration = new PatternValidation_default([durationPattern, dayTimeDurationPattern], ns.xsd.dayTimeDuration);
var dateTimeStamp = new PatternValidation_default([dateTimePattern, dateTimeStampPattern], ns.xsd.dateTimeStamp);

// node_modules/rdf-validation/lib/term/XsdValidation.js
var XsdValidation = class extends DatatypeValidations_default {
  constructor({ factory: factory2 } = {}) {
    super({ factory: factory2, validations: { ...xsd_exports } });
  }
};
var XsdValidation_default = XsdValidation;

// node_modules/shacl-engine/lib/validations/type.js
var toTermType = new TermMap_default([
  [sh.BlankNode, /* @__PURE__ */ new Set(["BlankNode"])],
  [sh.BlankNodeOrIRI, /* @__PURE__ */ new Set(["BlankNode", "NamedNode"])],
  [sh.BlankNodeOrLiteral, /* @__PURE__ */ new Set(["BlankNode", "Literal"])],
  [sh.IRI, /* @__PURE__ */ new Set(["NamedNode"])],
  [sh.IRIOrLiteral, /* @__PURE__ */ new Set(["NamedNode", "Literal"])],
  [sh.Literal, /* @__PURE__ */ new Set(["Literal"])]
]);
function compileClass(shape) {
  const classes = shape.ptr.out([sh.class]).map((ptr) => resolveClasses_default(ptr));
  return {
    generic: validateClass(classes)
  };
}
function validateClass(classes) {
  return (context) => {
    const types = new TermSet_default(context.valueOrNode.out([rdf3.type]).terms);
    for (const classSet of classes) {
      const result = [...types].some((type) => classSet.has(type));
      context.test(result, sh.ClassConstraintComponent, { value: context.valueOrNode });
    }
  };
}
function compileDatatype(shape) {
  const datatype = shape.ptr.out([sh.datatype]).term;
  const validation = new XsdValidation_default();
  return {
    generic: validateDatatype(datatype, validation)
  };
}
function validateDatatype(datatype, validation) {
  return (context) => {
    const result = datatype.equals(context.valueOrNode.term.datatype) && validation.validateSimple(context.valueOrNode.term);
    context.test(result, sh.DatatypeConstraintComponent, {
      args: { datatype },
      message: [context.factory.literal("Value does not have datatype {$datatype}")],
      value: context.valueOrNode
    });
  };
}
function compileNodeKind(shape) {
  const nodeKind = shape.ptr.out([sh.nodeKind]).term;
  const termTypes = toTermType.get(nodeKind);
  return {
    generic: validateNodeKind(nodeKind, termTypes)
  };
}
function validateNodeKind(nodeKind, termTypes) {
  return (context) => {
    context.test(termTypes.has(context.valueOrNode.term.termType), sh.NodeKindConstraintComponent, {
      args: { nodeKind },
      message: [context.factory.literal("Value does not have node kind {$nodeKind}")],
      value: context.valueOrNode
    });
  };
}

// node_modules/shacl-engine/lib/validations.js
var validations = new TermMap_default([
  [sh.maxCount, compileMaxCount],
  [sh.minCount, compileMinCount],
  [sh.and, compileAnd],
  [sh.not, compileNot],
  [sh.or, compileOr],
  [sh.xone, compileXone],
  [sh.closed, compileClosedNode],
  [sh.hasValue, compileHasValue],
  [sh.in, compileIn],
  [sh.disjoint, compileDisjoint],
  [sh.equals, compileEquals],
  [sh.lessThan, compileLessThan],
  [sh.lessThanOrEquals, compileLessThanOrEquals],
  [sh.maxExclusive, compileMaxExclusive],
  [sh.maxInclusive, compileMaxInclusive],
  [sh.minExclusive, compileMinExclusive],
  [sh.minInclusive, compileMinInclusive],
  [sh.node, compileNode],
  [sh.property, compileProperty],
  [sh.qualifiedValueShape, compileQualifiedShape],
  [sh.languageIn, compileLanguageIn],
  [sh.maxLength, compileMaxLength],
  [sh.minLength, compileMinLength],
  [sh.pattern, compilePattern],
  [sh.uniqueLang, compileUniqueLang],
  [sh.class, compileClass],
  [sh.datatype, compileDatatype],
  [sh.nodeKind, compileNodeKind]
]);
var validations_default = validations;

// node_modules/shacl-engine/Validator.js
var Validator = class {
  constructor(dataset2, { factory: factory2, ...options }) {
    this.factory = factory2;
    this.options = options;
    this.registry = new Registry_default(validations_default);
    this.targetResolverRegistry = new TargetResolverRegistry_default(this.options.targetResolvers || []);
    this.shapesPtr = new PathList_default({ dataset: dataset2, factory: factory2 });
    this.shapes = new TermMap_default();
    if (this.options.coverage) {
      this.options.debug = true;
      this.options.details = true;
      this.options.trace = true;
    }
    if (this.options.validations) {
      for (const [key, value] of this.options.validations) {
        this.registry.validations.set(key, value);
      }
    }
    const shapePtrs = [
      ...this.shapesPtr.hasOut([sh.targetClass]),
      ...this.shapesPtr.hasOut([sh.targetNode]),
      ...this.shapesPtr.hasOut([sh.targetObjectsOf]),
      ...this.shapesPtr.hasOut([sh.targetSubjectsOf]),
      ...this.shapesPtr.hasOut([sh.target]),
      ...this.shapesPtr.hasOut([rdf3.type], [sh.NodeShape]),
      ...this.shapesPtr.hasOut([rdf3.type], [sh.PropertyShape])
    ];
    for (const shapePtr of shapePtrs) {
      this.shape(shapePtr);
    }
  }
  shape(ptr) {
    if (!ptr.term) {
      return null;
    }
    let shape = this.shapes.get(ptr.term);
    if (!shape) {
      shape = new Shape_default(ptr, { validator: this });
      this.shapes.set(ptr.term, shape);
    }
    return shape;
  }
  async validate(data, shapes) {
    const focusNode = new PathList_default({ ...data, factory: this.factory });
    const context = new Context_default({ factory: this.factory, focusNode, options: this.options, validator: this });
    if (shapes) {
      shapes = shapes.map((shape) => this.shape(this.shapesPtr.node(shape.terms)));
    } else {
      shapes = this.shapes.values();
    }
    for (const shape of shapes) {
      const shapeContext = context.create({ shape });
      let targets;
      if (!focusNode.isAny()) {
        targets = focusNode;
      } else {
        targets = await shape.resolveTargets(shapeContext);
      }
      for (const focusNode2 of targets) {
        await shape.validate(shapeContext.create({ focusNode: focusNode2 }));
      }
    }
    return context.report;
  }
};
var Validator_default = Validator;

// node_modules/@ulb-darmstadt/shacl-form/dist/index.js
var h4 = `http://www.w3.org/ns/shacl#`;
var te2 = `http://datashapes.org/dash#`;
var g3 = `http://www.w3.org/2001/XMLSchema#`;
var _2 = `http://www.w3.org/1999/02/22-rdf-syntax-ns#`;
var v3 = `http://www.w3.org/2000/01/rdf-schema#`;
var ne2 = `http://www.w3.org/2004/02/skos/core#`;
var re2 = `http://www.w3.org/2002/07/owl#`;
var ie2 = `http://www.w3.org/ns/oa#`;
var ae2 = `http://purl.org/dc/terms/`;
var y3 = N3DataFactory_default.namedNode(`loaded-shapes`);
var b4 = N3DataFactory_default.namedNode(`loaded-data`);
var x2 = N3DataFactory_default.namedNode(_2 + `type`);
var oe2 = N3DataFactory_default.namedNode(_2 + `langString`);
var S4 = N3DataFactory_default.namedNode(ae2 + `conformsTo`);
var se2 = N3DataFactory_default.namedNode(v3 + `subClassOf`);
var C2 = N3DataFactory_default.namedNode(re2 + `imports`);
var ce2 = N3DataFactory_default.namedNode(ne2 + `broader`);
var le2 = N3DataFactory_default.namedNode(ne2 + `narrower`);
var w3 = N3DataFactory_default.namedNode(h4 + `NodeShape`);
var ue2 = N3DataFactory_default.namedNode(h4 + `IRI`);
var T3 = N3DataFactory_default.namedNode(h4 + `property`);
var E3 = N3DataFactory_default.namedNode(h4 + `class`);
var de2 = N3DataFactory_default.namedNode(h4 + `node`);
var D3 = N3DataFactory_default.namedNode(h4 + `targetClass`);
var fe2 = N3DataFactory_default.namedNode(h4 + `nodeKind`);
var pe2 = N3DataFactory_default.namedNode(g3 + `string`);
var me = N3DataFactory_default.namedNode(g3 + `boolean`);
function O2(e6, t5, n5 = h4, r6) {
  let i5 = ``, a3 = he2(e6, t5, n5, r6);
  return a3 && (i5 = a3.value), i5;
}
function he2(e6, t5, n5 = h4, r6) {
  let i5, a3 = n5 + t5;
  if (r6?.length) {
    for (let t6 of r6) for (let n6 of e6) if (n6.predicate.value === a3) {
      if (n6.object.id.endsWith(`@${t6}`)) return n6.object;
      n6.object.id.indexOf(`@`) < 0 ? i5 = n6.object : i5 ||= n6.object;
    }
  } else for (let t6 of e6) if (t6.predicate.value === a3) return t6.object;
  return i5;
}
function ge(e6) {
  e6.querySelector(`.editor`)?.focus();
}
function k3(e6, t5) {
  return O2(e6, `prefLabel`, `http://www.w3.org/2004/02/skos/core#`, t5) || O2(e6, `label`, `http://www.w3.org/2000/01/rdf-schema#`, t5) || O2(e6, `title`, `http://purl.org/dc/terms/`, t5) || O2(e6, `name`, `http://xmlns.com/foaf/0.1/`, t5);
}
function _e(e6, t5, n5) {
  let r6 = [];
  for (let i5 of e6) r6.push({ value: i5, label: k3(t5.getQuads(i5, null, null, null), n5), children: [] });
  return r6;
}
function A3(e6, t5) {
  for (let n5 in t5) {
    let r6 = t5[n5];
    e6.startsWith(r6) && (e6 = e6.slice(r6.length));
  }
  return e6;
}
function ve(e6, t5, n5, r6, i5 = /* @__PURE__ */ new Set()) {
  for (let a3 of t5.owlImports) i5.has(a3.id) || (i5.add(a3.id), r6.push(...n5.getSubjects(x2, e6, a3)));
  t5.parent && ve(e6, t5.parent, n5, r6, i5);
}
function ye(e6, t5) {
  if (t5.in) {
    let e7 = t5.config.lists[t5.in];
    return _e(e7?.length ? e7 : [], t5.config.store, t5.config.languages);
  } else {
    let n5 = t5.config.store.getSubjects(x2, e6, y3);
    n5.push(...t5.config.store.getSubjects(x2, e6, b4)), ve(e6, t5, t5.config.store, n5);
    let r6 = /* @__PURE__ */ new Map(), i5 = /* @__PURE__ */ new Map();
    for (let e7 of n5) r6.set(e7.id, { value: e7, label: k3(t5.config.store.getQuads(e7, null, null, null), t5.config.languages), children: [] });
    for (let e7 of n5) {
      for (let n6 of t5.config.store.getObjects(e7, ce2, null)) r6.has(n6.id) && i5.set(e7.id, n6.id);
      for (let n6 of t5.config.store.getObjects(e7, le2, null)) r6.has(n6.id) && i5.set(n6.id, e7.id);
      for (let n6 of t5.config.store.getObjects(e7, se2, null)) r6.has(n6.id) && i5.set(e7.id, n6.id);
    }
    for (let [e7, t6] of i5.entries()) r6.get(t6)?.children?.push(r6.get(e7));
    let a3 = [];
    for (let [e7, t6] of r6.entries()) i5.has(e7) || a3.push(t6);
    for (let n6 of t5.config.store.getSubjects(se2, e6, null)) a3.push(...ye(n6, t5));
    return a3;
  }
}
function j2(e6) {
  let t5;
  try {
    t5 = new URL(e6);
  } catch {
    return false;
  }
  return t5.protocol === `http:` || t5.protocol === `https:`;
}
function M3(e6, t5, n5) {
  if (t5 === void 0) return n5;
  if (n5 === void 0) return t5;
  let r6 = e6.indexOf(t5.language);
  if (r6 < 0) return n5;
  let i5 = e6.indexOf(n5.language);
  return i5 < 0 || i5 > r6 ? t5 : n5;
}
function be(e6, t5) {
  let n5;
  for (let r6 of t5) n5 = M3(e6, n5, r6);
  return n5 ? n5.value : ``;
}
var N3 = /^(-?\d{4,}-\d{2}-\d{2})(Z|[+-]\d{2}:\d{2})?$/;
var xe = /^(-?\d{4,}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
var Se = /^(-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(\.\d+)?)?$/;
function Ce(e6) {
  let t5 = e6.match(N3);
  if (!t5) {
    let t6 = e6.match(xe);
    return t6 ? { value: t6[1], suffix: t6[5] || `` } : void 0;
  }
  return { value: t5[1], suffix: t5[2] || `` };
}
function we(e6) {
  let t5 = e6.match(xe);
  if (!t5) {
    let t6 = e6.match(N3);
    return t6 ? { value: `${t6[1]}T00:00:00`, suffix: t6[2] || `` } : void 0;
  }
  return { value: `${t5[1]}T${t5[2]}:${t5[3] || `00`}`, suffix: t5[5] || `` };
}
function Te(e6, t5 = ``) {
  let n5 = e6.match(N3);
  return n5 ? `${n5[1]}${t5}` : e6;
}
function Ee(e6, t5 = ``) {
  let n5 = e6.match(Se);
  return n5 ? `${n5[1]}:${n5[2] || `00`}${n5[3] || ``}${t5}` : e6;
}
function De(e6) {
  let t5 = /* @__PURE__ */ new Set();
  for (let n5 of e6.getObjects(null, E3, y3)) t5.add(n5.value);
  for (let n5 of e6.getObjects(null, D3, y3)) t5.add(n5.value);
  return t5;
}
function Oe(e6, t5) {
  return e6 instanceof Set ? [...t5].filter((t6) => !e6.has(t6)) : [...t5].filter((t6) => !e6.includes(t6));
}
function ke(e6, { remove: t5 = false, ignoreErrors: n5 = false } = {}) {
  let r6 = {}, i5 = n5 ? (() => true) : ((e7, t6) => {
    throw Error(`${e7.value} ${t6}`);
  }), a3 = e6.getQuads(null, _2 + `rest`, _2 + `nil`, null), o6 = t5 ? [...a3] : [];
  return a3.forEach((n6) => {
    let a4 = [], s4 = false, c5, l4, u3 = n6.graph, d4 = n6.subject;
    for (; d4 && !s4; ) {
      let t6 = e6.getQuads(null, null, d4, null), n7 = e6.getQuads(d4, null, null, null).filter((e7) => !e7.predicate.equals(x2)), r7, f3 = null, p4 = null, m3 = null;
      for (let e7 = 0; e7 < n7.length && !s4; e7++) r7 = n7[e7], r7.graph.equals(u3) ? c5 ? s4 = i5(d4, `has non-list arcs out`) : r7.predicate.value === `http://www.w3.org/1999/02/22-rdf-syntax-ns#first` ? f3 ? s4 = i5(d4, `has multiple rdf:first arcs`) : o6.push(f3 = r7) : r7.predicate.value === `http://www.w3.org/1999/02/22-rdf-syntax-ns#rest` ? p4 ? s4 = i5(d4, `has multiple rdf:rest arcs`) : o6.push(p4 = r7) : t6.length ? s4 = i5(d4, `can't be subject and object`) : (c5 = r7, l4 = `subject`) : s4 = i5(d4, `not confined to single graph`);
      for (let e7 = 0; e7 < t6.length && !s4; ++e7) r7 = t6[e7], c5 ? s4 = i5(d4, `can't have coreferences`) : r7.predicate.value === `http://www.w3.org/1999/02/22-rdf-syntax-ns#rest` ? m3 ? s4 = i5(d4, `has incoming rdf:rest arcs`) : m3 = r7 : (c5 = r7, l4 = `object`);
      f3 ? a4.unshift(f3.object) : s4 = i5(d4, `has no list head`), d4 = m3 && m3.subject;
    }
    s4 ? t5 = false : c5 && (r6[c5[l4].value] = a4);
  }), t5 && e6.removeQuads(o6), r6;
}
var P3 = {};
var F2 = {};
function I3(e6) {
  let t5 = /* @__PURE__ */ new Set();
  for (let n5 of e6.getQuads(null, S4, null, b4)) n5.subject.termType === `NamedNode` && t5.add(n5.subject.value);
  if (t5.size === 1) return t5.values().next().value;
}
function L3(t5, n5) {
  let r6 = N3DataFactory_default.namedNode(n5);
  for (let e6 of t5.getObjects(r6, S4, b4)) if (e6.termType === `NamedNode` && t5.getQuads(e6, x2, w3, null).length > 0) return e6;
}
async function Ae(e6) {
  let t5 = { store: new N3Store(), importedUrls: [], atts: e6 }, n5 = [];
  if (e6.shapes ? n5.push(R3(B3(e6.shapes), t5, y3)) : e6.shapesUrl && n5.push(R3(z2(e6.shapesUrl, t5.atts.proxy), t5, y3)), e6.values ? n5.push(R3(B3(e6.values), t5, b4)) : e6.valuesUrl && n5.push(R3(z2(e6.valuesUrl, t5.atts.proxy), t5, b4)), await Promise.all(n5), e6.classInstanceProvider) try {
    let n6 = De(t5.store), r6 = await e6.classInstanceProvider(n6);
    r6 && await R3(B3(r6), t5, y3);
  } catch (e7) {
    console.error(`failed loading class instances`, e7);
  }
  if (e6.valuesSubject ||= I3(t5.store) || null, e6.valuesSubject && t5.store.countQuads(null, null, null, y3) === 0) {
    let n6 = [...t5.store.getObjects(e6.valuesSubject, x2, b4), ...t5.store.getObjects(e6.valuesSubject, S4, b4)], r6 = [];
    for (let e7 of n6) {
      let n7 = je(e7.value);
      !n7 && e7.value.startsWith(`urn:`) && t5.atts.proxy && (n7 = e7.value), n7 && t5.importedUrls.indexOf(n7) < 0 && (t5.importedUrls.push(n7), r6.push(R3(z2(n7, t5.atts.proxy), t5, y3)));
    }
    try {
      await Promise.allSettled(r6);
    } catch (e7) {
      console.warn(e7);
    }
  }
  return t5.store;
}
async function R3(t5, n5, r6) {
  let i5 = await t5, a3 = [];
  for (let t6 of i5) {
    let i6 = r6;
    if (n5.atts.valuesSubject && b4.equals(r6) && t6.graph.id && t6.graph.id !== n5.atts.valuesSubject && (i6 = t6.graph), n5.store.add(N3DataFactory_default.quad(t6.subject, t6.predicate, t6.object, i6)), n5.atts.loadOwlImports && C2.equals(t6.predicate)) {
      let r7 = je(t6.object.value);
      r7 && n5.importedUrls.indexOf(r7) < 0 && (n5.importedUrls.push(r7), a3.push(R3(z2(r7, n5.atts.proxy), n5, N3DataFactory_default.namedNode(r7))));
    }
  }
  await Promise.allSettled(a3);
}
async function z2(e6, t5) {
  return e6 in P3 || (P3[e6] = (async () => {
    let n5 = e6;
    t5 && (n5 = t5 + encodeURIComponent(e6));
    let r6 = await fetch(n5, { headers: { Accept: `text/turtle, application/trig, application/n-triples, application/n-quads, text/n3, application/ld+json` } });
    return r6.ok ? B3(await r6.text()) : (console.warn(`failed fetching RDF from`, e6), []);
  })()), P3[e6];
}
async function B3(t5) {
  if (!t5.trim()) return [];
  let n5 = Me(t5);
  if (n5 === `json`) try {
    t5 = await jsonld_default.toRDF(JSON.parse(t5), { format: `application/n-quads` });
  } catch (e6) {
    console.error(e6);
  }
  let r6 = [];
  return await new Promise((a3, s4) => {
    let c5 = n5 === `xml` ? new RdfXmlParser() : new N3StreamParser();
    c5.on(`data`, (t6) => {
      r6.push(N3DataFactory_default.quad(t6.subject, t6.predicate, t6.object, t6.graph));
    }).on(`error`, (e6) => {
      s4(e6);
    }).on(`prefix`, (e6, t6) => {
      e6 && (F2[e6] = t6);
    }).on(`end`, () => {
      a3(null);
    }), c5.write(t5), c5.end();
  }), r6;
}
function je(e6) {
  if (j2(e6)) return e6;
  let t5 = e6.split(`:`);
  if (t5.length === 2) {
    let n5 = F2[t5[0]];
    if (n5 && (e6 = e6.replace(`${t5[0]}:`, n5), j2(e6))) return e6;
  }
  return null;
}
function Me(e6) {
  return /^\s*[\\[{]/.test(e6) ? `json` : /^\s*<\?xml/.test(e6) ? `xml` : `ttl`;
}
var Ne = { [`${h4}name`]: (e6, t5) => {
  let n5 = t5;
  e6.name = M3(e6.config.languages, e6.name, n5);
}, [`${h4}description`]: (e6, t5) => {
  let n5 = t5;
  e6.description = M3(e6.config.languages, e6.description, n5);
}, [`${h4}path`]: (e6, t5) => {
  e6.path = t5.value;
}, [`${h4}group`]: (e6, t5) => {
  e6.group = t5.id;
}, [`${h4}datatype`]: (e6, t5) => {
  e6.datatype = t5;
}, [`${h4}nodeKind`]: (e6, t5) => {
  e6.nodeKind = t5;
}, [`${h4}minCount`]: (e6, t5) => {
  e6.minCount = parseInt(t5.value);
}, [`${h4}maxCount`]: (e6, t5) => {
  e6.maxCount = parseInt(t5.value);
}, [`${h4}minLength`]: (e6, t5) => {
  e6.minLength = parseInt(t5.value);
}, [`${h4}maxLength`]: (e6, t5) => {
  e6.maxLength = parseInt(t5.value);
}, [`${h4}minInclusive`]: (e6, t5) => {
  e6.minInclusive = parseInt(t5.value);
}, [`${h4}maxInclusive`]: (e6, t5) => {
  e6.maxInclusive = parseInt(t5.value);
}, [`${h4}minExclusive`]: (e6, t5) => {
  e6.minExclusive = parseInt(t5.value);
}, [`${h4}maxExclusive`]: (e6, t5) => {
  e6.maxExclusive = parseInt(t5.value);
}, [`${h4}pattern`]: (e6, t5) => {
  e6.pattern = t5.value;
}, [`${h4}order`]: (e6, t5) => {
  e6.order = parseInt(t5.value);
}, [`${te2}singleLine`]: (e6, t5) => {
  e6.singleLine = t5.value === `true`;
}, [`${te2}readonly`]: (e6, t5) => {
  e6.readonly = t5.value === `true`;
}, [`${ie2}styleClass`]: (e6, t5) => {
  e6.cssClass = t5.value;
}, [`${h4}in`]: (e6, t5) => {
  e6.in = t5.value;
}, [`${h4}languageIn`]: (e6, t5) => {
  e6.languageIn = e6.config.lists[t5.value], e6.datatype = oe2;
}, [`${h4}defaultValue`]: (e6, t5) => {
  e6.defaultValue = t5;
}, [`${h4}hasValue`]: (e6, t5) => {
  e6.hasValue = t5;
}, [`${h4}node`]: (e6, t5) => {
  e6.node = t5, e6.nodeShapes.add(e6.config.getNodeTemplate(t5, e6));
}, [`${h4}and`]: (e6, t5) => {
  e6.and = t5.value;
  let n5 = e6.config.lists[e6.and];
  if (n5?.length) for (let t6 of n5) e6.nodeShapes.add(e6.config.getNodeTemplate(t6, e6));
}, [`${h4}qualifiedValueShape`]: (e6, t5) => {
  let n5 = e6.config.getNodeTemplate(t5, e6);
  e6.qualifiedValueShape = n5, e6.nodeShapes.add(n5);
}, [`${h4}qualifiedMinCount`]: (e6, t5) => {
  e6.qualifiedMinCount = parseInt(t5.value);
}, [`${h4}qualifiedMaxCount`]: (e6, t5) => {
  e6.qualifiedMaxCount = parseInt(t5.value);
}, [C2.id]: (e6, t5) => {
  e6.owlImports.add(t5);
}, [E3.id]: (e6, t5) => {
  e6.class = t5;
  let n5 = e6.config.store.getSubjects(D3, t5, null);
  n5.length > 0 && (e6.node = n5[0]);
}, [`${h4}or`]: (e6, t5) => {
  let n5 = e6.config.lists[t5.value];
  n5?.length ? e6.or = n5 : console.error(`list for sh:or not found:`, t5.value, `existing lists:`, e6.config.lists);
}, [`${h4}xone`]: (e6, t5) => {
  let n5 = e6.config.lists[t5.value];
  n5?.length ? e6.xone = n5 : console.error(`list for sh:xone not found:`, t5.value, `existing lists:`, e6.config.lists);
} };
var V3 = class {
  constructor(e6, t5) {
    this.label = ``, this.nodeShapes = /* @__PURE__ */ new Set(), this.owlImports = /* @__PURE__ */ new Set(), this.id = e6, this.parent = t5, this.config = t5.config, this.config.registerPropertyTemplate(this), U2(this, this.config.store.getQuads(e6, null, null, null));
  }
};
function H3(e6) {
  return Math.max(e6.minCount ?? 0, e6.qualifiedMinCount ?? 0);
}
function Pe(e6) {
  return Math.min(e6.maxCount ?? 2 ** 53 - 1, e6.qualifiedMaxCount ?? 2 ** 53 - 1);
}
function Fe(e6) {
  let t5 = Object.assign({}, e6);
  return t5.nodeShapes = new Set(e6.nodeShapes), t5.owlImports = new Set(e6.owlImports), e6.languageIn && (t5.languageIn = [...e6.languageIn]), e6.or && (t5.or = [...e6.or]), e6.xone && (t5.xone = [...e6.xone]), t5;
}
function U2(e6, t5) {
  for (let n5 of t5) Ne[n5.predicate.id]?.call(e6, e6, n5.object);
  return e6.label = e6.name?.value || k3(t5, e6.config.languages), e6.label ||= e6.path ? A3(e6.path, F2) : `unknown`, e6;
}
function Ie(e6, t5) {
  let n5 = t5, r6 = e6;
  for (let e7 in t5) if (e7 !== `parent` && e7 !== `config` && e7 !== `id`) {
    let t6 = n5[e7];
    if (t6 !== void 0 && t6 !== ``) if (Array.isArray(t6)) {
      let n6 = r6[e7];
      Array.isArray(n6) ? n6.push(...t6) : r6[e7] = [...t6];
    } else if (t6 instanceof Set && t6.size) {
      let n6 = r6[e7];
      r6[e7] = /* @__PURE__ */ new Set([...n6 instanceof Set ? n6 : [], ...t6]);
    } else r6[e7] = t6;
  }
}
function Le(e6, t5, n5) {
  let r6 = document.createElement(`div`);
  r6.classList.add(`shacl-or-constraint`), r6.setAttribute(`part`, `constraint`);
  let i5 = [];
  if (t5 instanceof X2) {
    let a3 = [], o6 = false;
    e6.length && (o6 = n5.store.countQuads(e6[0], T3, null, null) > 0);
    for (let r7 = 0; r7 < e6.length; r7++) if (o6) {
      let o7 = n5.store.getObjects(e6[r7], T3, null), s5 = [], c6 = ``;
      for (let e7 of o7) {
        let r8 = new K2(n5.getPropertyTemplate(e7, t5.template), t5);
        s5.push(r8), c6 += (c6.length > 0 ? ` / ` : ``) + r8.template.label;
      }
      a3.push(s5), i5.push({ label: c6, value: r7.toString() });
    } else {
      let o7 = e6[r7], s5 = new K2(n5.getPropertyTemplate(o7, t5.template), t5);
      a3.push([s5]), i5.push({ label: s5.template.label, value: r7.toString() });
    }
    let s4 = n5.theme.createListEditor(`Please choose`, null, false, i5);
    s4.setAttribute(`part`, `constraint-editor`);
    let c5 = s4.querySelector(`.editor`);
    c5.onchange = async () => {
      if (c5.value) {
        let e7 = a3[parseInt(c5.value)], n6;
        if (e7.length) {
          for (let n7 of e7) await n7.bindValues(t5.nodeId, false);
          n6 = e7[0], r6.replaceWith(e7[0]), n6.updateControls();
        }
        for (let t6 = 1; t6 < e7.length; t6++) n6.after(e7[t6]), n6 = e7[t6], n6.updateControls();
      }
    }, r6.appendChild(s4);
  } else {
    let a3 = [];
    for (let t6 = 0; t6 < e6.length; t6++) {
      let r7 = n5.store.getQuads(e6[t6], null, null, null);
      if (r7.length) {
        a3.push(r7);
        let e7 = k3(r7, n5.languages);
        for (let t7 of r7) t7.predicate.equals(de2) && (e7 = k3(n5.store.getQuads(t7.object, null, null, null), n5.languages));
        i5.push({ label: e7 || A3(r7[0].predicate.value, F2) + ` = ` + A3(r7[0].object.value, F2), value: t6.toString() });
      }
    }
    let o6 = n5.theme.createListEditor(t5.template.label + `?`, null, false, i5, t5.template);
    o6.setAttribute(`part`, `constraint-editor`);
    let s4 = o6.querySelector(`.editor`);
    s4.onchange = async () => {
      if (s4.value) {
        let e7 = await q2(U2(Fe(t5.template), a3[parseInt(s4.value)]), void 0, true), n6 = e7.querySelector(`:scope > label`);
        n6 && n6.classList.add(`persistent`), r6.replaceWith(e7);
      }
    }, r6.appendChild(o6);
  }
  return r6;
}
function Re(e6, t5, n5) {
  if (t5.termType === `Literal`) {
    let r6 = t5.datatype;
    for (let t6 of e6) {
      let e7 = n5.store.getQuads(t6, null, null, null);
      for (let t7 of e7) if (t7.predicate.value === `http://www.w3.org/ns/shacl#datatype` && t7.object.equals(r6)) return e7;
    }
  } else {
    let r6 = n5.store.getObjects(t5, x2, null);
    for (let t6 of e6) {
      let e7 = n5.store.getQuads(t6, null, null, null);
      for (let t7 of e7) if (r6.length > 0) {
        if (t7.predicate.value === `http://www.w3.org/ns/shacl#node`) {
          for (let i5 of r6) if (n5.store.getQuads(t7.object, D3, i5, null).length > 0) return e7;
        }
        if (t7.predicate.equals(E3)) {
          for (let n6 of r6) if (t7.object.equals(n6)) return e7;
        }
      } else if (t7.predicate.equals(fe2) && t7.object.equals(ue2)) return e7;
    }
  }
  return console.error(`couldn't resolve sh:or/sh:xone on property for value`, t5), [];
}
function ze(e6, t5, n5) {
  for (let r6 of e6) {
    let e7 = false, i5 = n5.store.getObjects(r6, T3, null);
    for (let r7 of i5) {
      let i6 = n5.store.getObjects(r7, `${h4}path`, null);
      for (let r8 of i6) if (e7 = n5.store.countQuads(t5, r8, null, null) > 0, e7) break;
    }
    if (e7) return i5;
  }
  return console.error(`couldn't resolve sh:or/sh:xone on node for value`, t5), [];
}
var Be = `:host {
    --shacl-font-family: inherit;
    --shacl-font-size: 14px;
    --shacl-text-color: #333;
    --shacl-muted-color: #555;
    --shacl-border-color: #DDD;
    --shacl-bg: #FFF;
    --shacl-row-alt-bg: #F8F8F8;
    --shacl-error-color: #C00;
    --shacl-label-width: 8em;
}
form { display:block; --label-width: var(--shacl-label-width, 8em); --caret-size: 10px; font-family: var(--shacl-font-family); font-size: var(--shacl-font-size); color: var(--shacl-text-color); background-color: var(--shacl-bg); }
form.mode-edit { padding-left: 1em;  }
form, form * { box-sizing: border-box; }
shacl-node, .collapsible::part(content) { display: flex; flex-direction: column; width: 100%; position: relative; }
shacl-node .remove-button { margin-top: 1px; }
shacl-node .add-button-wrapper { display: flex; width: 100%; justify-content: flex-end; gap: 20px; padding-right: 24px; color: var(--shacl-muted-color); font-size: 14px; }
shacl-node .add-button::part(button)::before { content: '+ ' }
shacl-node .link-button::part(button)::before { content: '\u{1F517} '; font-size: 10px; }
shacl-node h1 { font-size: 16px; border-bottom: 1px solid #AAA; margin-top: 4px; color: var(--shacl-muted-color); }
shacl-property:not(:has(>.collapsible)), shacl-property>.collapsible::part(content) { display: flex; flex-direction: column; align-items: end; position: relative; }
shacl-property:not(.may-add) > .add-button-wrapper, shacl-property:not(.may-add) > .collapsible > .add-button-wrapper { display: none; }
shacl-property:not(.may-remove) > .property-instance > .remove-button-wrapper > .remove-button:not(.persistent) { visibility: hidden; }
shacl-property:not(.may-remove) > .collapsible > .property-instance > .remove-button-wrapper > .remove-button:not(.persistent) { visibility: hidden; }
shacl-property:not(.may-remove) > .shacl-or-constraint > .remove-button-wrapper > .remove-button:not(.persistent) { visibility: hidden; }
.mode-view .shacl-group:not(:has(shacl-property)) { display: none; }
.property-instance, .shacl-or-constraint { display: flex; align-items: flex-start; padding: 4px 0; width: 100%; position: relative; }
.shacl-or-constraint > div { display: flex; align-items: flex-start; }
.shacl-or-constraint > div:first-child { flex-grow: 1 }
.shacl-or-constraint label { display: inline-block; word-break: break-word; width: var(--label-width); line-height: 1em; padding-top: 0.15em; padding-right: 1em; flex-shrink: 0; position: relative; }
.property-instance label[title] { cursor: help; text-decoration: underline dashed #AAA; }
.property-instance.linked label:after, label.linked:after { content: '\\1F517'; font-size: 0.6em; position: absolute; top: 3px; right: 3px; }
.mode-edit .property-instance label.required::before, .add-button-wrapper.required > .add-button::before, .add-button-wrapper.required > .link-button::before { color: var(--shacl-error-color); content: '\\2736'; font-size: 0.6rem; position: absolute; left: -1.4em; }
.mode-edit .add-button-wrapper.required > .add-button::before, .add-button-wrapper.required > .link-button::before { left: -0.5em; }
.mode-edit .property-instance label.required::before { top: 0.15rem; }
.property-instance.valid::before { content: ''; position: absolute; left: calc(var(--label-width) - 1em); top:0.5em; width: 0.9em; height: 0.9em; background: url('data:image/svg+xml;utf8,<svg viewBox="0 0 1024 1024" fill="green" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M866.133333 258.133333L362.666667 761.6l-204.8-204.8L98.133333 618.666667 362.666667 881.066667l563.2-563.2z"/></svg>'); }
.editor:not([type='checkbox']) { flex-grow: 1; }
textarea.editor { resize: vertical; }
.lang-chooser { border: 0; background-color: #e9e9ed; padding: 2px 4px; align-self: flex-start; }
.validation-error { position: absolute; left: calc(var(--label-width) - 1em); color: var(--shacl-error-color); cursor: help; }
.validation-error::before { content: '\\26a0' }
.validation-error.node { left: -1em; }
.invalid > .editor { border-color: red !important; }
.ml-0  { margin-left: 0 !important; }
.pr-0  { padding-right: 0 !important; }
.mode-view .property-instance:not(:first-child) > label { visibility: hidden; }
.mode-view .property-instance label { width: var(--label-width); }

.d-flex { display: flex; }
.lang { opacity: 0.65; font-size: 0.6em; }
a, a:visited { color: inherit; }
h3 { margin-top: 0; }

.fadeIn, .fadeOut { animation: fadeIn 0.2s ease-out; }
.fadeOut { animation-direction: reverse; animation-timing-function: ease-out;}
@keyframes fadeIn {
    0% { opacity: 0; transform: scaleY(0.8); }
    100% { opacity: 1; transform: scaleY(1); }
}
.collapsible::part(label) { font-weight: 600; }
.collapsible > .property-instance:nth-child(even) { background-color: var(--shacl-row-alt-bg); }
.collapsible > .property-instance > shacl-node > h1 { display: none; }
.ref-link { cursor: pointer; }
.ref-link:hover { text-decoration: underline; }
.node-id-display { color: var(--shacl-muted-color); font-size: 11px; }
/* hierarchy colors */
.colorize { --hierarchy-color-width: 3px; padding: 0 1px 0 calc(1px + var(--hierarchy-color-width)); align-self: stretch; position: relative; }
.colorize::before {
    content: '';
    position: absolute;
    width: var(--hierarchy-color-width);
    top: 0; bottom: 0; left: 0;
    --index: mod(var(--hierarchy-level), var(--hierarchy-colors-length));
    background: linear-gradient(var(--hierarchy-colors)) no-repeat 0 calc(var(--index) * 100% / (var(--hierarchy-colors-length) - 1)) / 100% calc(1px * infinity);
 }
.property-instance:not(:has(shacl-node)) > .colorize::before { background: 0; }
.colorize:not(:has(.remove-button)) { padding-left: calc(8px + var(--hierarchy-color-width)); }
.mode-view .property-instance > .colorize { order: -1; }
.link-option { padding: 10px; }
.link-option:hover { background-color: #F5F5F5; cursor: pointer; }
rokit-dialog.link-chooser::part(dialog) { min-height: min(434px, 90vh); width: min(90vw, 600px); }
`;
var Ve = class {
  constructor(e6) {
    this.dense = true;
    let t5 = Be;
    e6 && (t5 += `
` + e6), this.stylesheet = new CSSStyleSheet(), this.stylesheet.replaceSync(t5);
  }
  apply(e6) {
  }
  setDense(e6) {
    this.dense = e6;
  }
  createViewer(e6, r6, i5) {
    let a3 = document.createElement(`div`), o6 = document.createElement(`label`);
    o6.textContent = `${e6}:`, i5.description && o6.setAttribute(`title`, i5.description.value), a3.appendChild(o6);
    let s4 = r6.value, c5 = null;
    if (r6 instanceof NamedNode) {
      let e7 = i5.config.store.getQuads(s4, null, null, null);
      if (e7.length) {
        let t5 = k3(e7, i5.config.languages);
        t5 && (s4 = t5);
      }
    } else r6 instanceof Literal && (r6.language ? (c5 = document.createElement(`span`), c5.classList.add(`lang`), c5.innerText = `@${r6.language}`) : r6.datatype.value === `http://www.w3.org/2001/XMLSchema#date` ? s4 = new Date(Date.parse(r6.value)).toDateString() : r6.datatype.value === `http://www.w3.org/2001/XMLSchema#dateTime` && (s4 = new Date(Date.parse(r6.value)).toLocaleString()));
    let l4;
    return j2(r6.value) ? (l4 = document.createElement(`a`), l4.setAttribute(`href`, r6.value)) : l4 = document.createElement(`div`), l4.classList.add(`d-flex`), l4.innerText = s4, c5 && l4.appendChild(c5), a3.appendChild(l4), a3;
  }
};
function He(e6, n5, r6) {
  if (r6) {
    let r7 = H3(e6) > 0;
    if (e6.class && !e6.hasValue) return e6.config.theme.createListEditor(e6.label, n5, r7, ye(e6.class, e6), e6);
    if (e6.in) {
      let t5 = e6.config.lists[e6.in];
      if (t5?.length) {
        let i5 = _e(t5, e6.config.store, e6.config.languages);
        return e6.config.theme.createListEditor(e6.label, n5, r7, i5, e6);
      } else console.error(`list not found:`, e6.in, `existing lists:`, e6.config.lists);
    }
    if (e6.datatype?.equals(oe2) || e6.languageIn?.length || e6.datatype === void 0 && n5 instanceof Literal && n5.language) return e6.config.theme.createLangStringEditor(e6.label, n5, r7, e6);
    switch (e6.datatype?.value.replace(g3, ``)) {
      case `integer`:
      case `float`:
      case `double`:
      case `decimal`:
        return e6.config.theme.createNumberEditor(e6.label, n5, r7, e6);
      case `date`:
      case `dateTime`:
        return e6.config.theme.createDateEditor(e6.label, n5, r7, e6);
      case `boolean`:
        return e6.config.theme.createBooleanEditor(e6.label, n5, r7, e6);
      case `base64Binary`:
        return e6.config.theme.createFileEditor(e6.label, n5, r7, e6);
    }
    return e6.config.theme.createTextEditor(e6.label, n5, r7, e6);
  } else return n5 ? e6.config.theme.createViewer(e6.label, n5, e6) : document.createElement(`div`);
}
function Ue(e6, t5, n5) {
  if (t5 === `application/ld+json`) return We(e6);
  {
    let r6 = new N3Writer({ format: t5, prefixes: n5 });
    r6.addQuads(e6);
    let i5 = ``;
    return r6.end((e7, t6) => {
      e7 && console.error(e7), i5 = t6;
    }), i5;
  }
}
function We(e6) {
  let n5 = [];
  for (let r6 of e6) {
    let e7 = { "@id": r6.subject.id };
    if (r6.predicate === x2) e7[`@type`] = r6.object.id;
    else {
      let n6 = r6.object.value;
      r6.object instanceof Literal ? r6.object.language ? n6 = { "@language": r6.object.language, "@value": r6.object.value } : r6.object.datatype && r6.object.datatype.value !== `http://www.w3.org/2001/XMLSchema##string` && (n6 = { "@type": r6.object.datatype.value, "@value": r6.object.value }) : n6 = { "@id": r6.object.id }, e7[r6.predicate.value] = n6;
    }
    n5.push(e7);
  }
  return JSON.stringify(n5);
}
function Ge(t5) {
  let r6 = t5.shaclDatatype, i5 = t5.dataset.value || t5.value;
  if ((t5.type === `file` || t5.getAttribute(`type`) === `file`) && t5.binaryData) i5 = t5.binaryData;
  else if ((t5.type === `checkbox` || t5.getAttribute(`type`) === `checkbox`) && (t5.checked || parseInt(t5.dataset.minCount || `0`) > 0)) return N3DataFactory_default.literal(t5.checked ? `true` : `false`, r6);
  if (i5) {
    if (i5.startsWith(`<`) && i5.endsWith(`>`) && i5.indexOf(`:`) > -1) return N3DataFactory_default.namedNode(i5.substring(1, i5.length - 1));
    if (t5.dataset.class || t5.dataset.nodeKind === `http://www.w3.org/ns/shacl#IRI`) return N3DataFactory_default.namedNode(i5);
    if (t5.dataset.link) return JSON.parse(t5.dataset.link);
    if (t5.dataset.lang ? r6 = t5.dataset.lang : t5.type === `number` ? i5 = parseFloat(i5) : t5.type === `datetime-local` ? i5 = Ee(i5, t5.dataset.xsdTemporalSuffix) : t5.type === `date` && r6 instanceof NamedNode && r6.value === `http://www.w3.org/2001/XMLSchema#date` && (i5 = Te(i5, t5.dataset.xsdTemporalSuffix)), (!r6 || r6 instanceof NamedNode && pe2.equals(r6)) && typeof i5 == `string`) {
      let t6 = i5.split(`^^`);
      t6.length === 2 && t6[0].startsWith(`"`) && t6[0].endsWith(`"`) && t6[1].split(`:`).length === 2 ? (i5 = t6[0].substring(1, t6[0].length - 1), r6 = N3DataFactory_default.namedNode(t6[1])) : (t6 = i5.split(`@`), t6.length === 2 && t6[0].startsWith(`"`) && t6[0].endsWith(`"`) ? (i5 = t6[0].substring(1, t6[0].length - 1), r6 = t6[1]) : i5.startsWith(`"`) && i5.endsWith(`"`) && (i5 = i5.substring(1, i5.length - 1)));
    }
    return N3DataFactory_default.literal(i5, r6);
  }
}
var W2 = {};
function Ke(e6) {
  e6.predicate === void 0 && e6.datatype === void 0 ? console.warn(`not registering plugin because it does neither define "predicate" nor "datatype"`, e6) : W2[`${e6.predicate}^${e6.datatype}`] = e6;
}
function qe() {
  return Object.entries(W2).map((e6) => e6[1]);
}
function Je(e6, t5) {
  let n5 = W2[`${e6}^${t5}`];
  return n5 || (n5 = W2[`${e6}^undefined`], n5) ? n5 : W2[`undefined^${t5}`];
}
async function Xe(e6) {
  if (e6.template.nodeShapes.size === 0) return;
  let t5 = e6.template.config.resourceLinkProvider;
  if ((!t5 || t5 && !t5.lazyLoad) && (await et2(e6.template), Qe(e6).length === 0)) return;
  let n5 = e6.template.config.theme.createButton(e6.template.label, false);
  n5.title = `Link existing ` + e6.template.label, n5.classList.add(`link-button`), n5.setAttribute(`text`, ``);
  let r6 = n5.getAttribute(`part`);
  return n5.setAttribute(`part`, `${r6 ? r6 + ` ` : ``}link-button`), n5.addEventListener(`click`, async () => {
    t5?.lazyLoad && (n5.classList.add(`loading`), await et2(e6.template), n5.classList.remove(`loading`));
    let r7 = Qe(e6);
    if (r7.length === 0) n5.innerText = `No linkable resources found`, n5.setAttribute(`disabled`, ``), setTimeout(() => n5.remove(), 2e3);
    else {
      let t6 = e6.template.config.form.querySelector(`#dialog`);
      t6 || (t6 = new K(), t6.classList.add(`link-chooser`), t6.closable = true, e6.template.config.form.appendChild(t6)), t6.title = `Link existing ` + e6.template.label, Ze(t6, e6, r7), t6.open = true;
    }
  }), n5;
}
function Ze(e6, t5, n5) {
  let r6 = document.createElement(`div`);
  for (let i5 of n5) {
    let n6 = document.createElement(`div`);
    n6.classList.add(`link-option`), n6.title = `Link this resource`, n6.innerText = i5.label || i5.value, n6.addEventListener(`click`, () => {
      $e(i5.value, t5), e6.open = false;
    }), r6.appendChild(n6);
  }
  e6.replaceChildren(r6);
}
function Qe(t5) {
  let n5 = [];
  if (t5.template.config.resourceLinkProvider) {
    for (let r6 of t5.template.nodeShapes) if (t5.template.config.providedConformingResourceIds[r6.id.value]) for (let i5 of t5.template.config.providedConformingResourceIds[r6.id.value]) t5.querySelector(`:scope > .property-instance > shacl-node[data-node-id='${i5}'], :scope > .collapsible > .property-instance > shacl-node[data-node-id='${i5}']`) === null && n5.push({ value: i5, label: k3(t5.template.config.store.getQuads(N3DataFactory_default.namedNode(i5), null, null, null), t5.template.config.languages), children: [] });
  }
  return n5;
}
async function $e(t5, n5) {
  let r6 = N3DataFactory_default.namedNode(t5);
  if (rt2(r6, n5.template.config.store)) {
    if (n5.template.config.providedResources[t5]?.length > 0) {
      let e7 = { store: n5.template.config.store, importedUrls: [], atts: { loadOwlImports: false } };
      await R3(B3(n5.template.config.providedResources[t5]), e7, y3), n5.template.config.providedResources[t5] = ``;
    }
    let e6 = await q2(n5.template, r6, true, true);
    n5.container.insertBefore(e6, n5.querySelector(`:scope > .add-button-wrapper`)), await n5.updateControls();
  }
}
async function et2(e6) {
  let t5 = e6.config.resourceLinkProvider;
  if (!t5) return;
  let n5 = new Set(Array.from(e6.nodeShapes).map((e7) => e7.id.value));
  if (n5.size === 0) return;
  let r6 = Oe(Object.keys(e6.config.providedConformingResourceIds), n5);
  if (r6.length !== 0) try {
    let n6 = await t5.listConformingResources(r6, e6);
    if (n6) {
      for (let t6 of Object.keys(n6)) {
        let r7 = new Set(n6[t6]);
        e6.config.providedConformingResourceIds[t6] = r7, await tt2(r7, false, e6.config);
      }
      for (let t6 of r6) e6.config.providedConformingResourceIds[t6] || (e6.config.providedConformingResourceIds[t6] = /* @__PURE__ */ new Set());
    }
  } catch (e7) {
    console.error(`failed loading conforming resources`, e7);
  }
}
async function tt2(e6, t5, n5) {
  if (n5.resourceLinkProvider && e6.size > 0) {
    let r6 = [];
    for (let t6 of e6) n5.providedResources[t6] || r6.push(t6);
    if (r6.length === 0) return [];
    try {
      let e7 = await n5.resourceLinkProvider.loadResources(r6);
      if (e7) {
        let r7 = { store: n5.store, importedUrls: [], atts: { loadOwlImports: false } };
        for (let i5 of e7) n5.providedResources[i5.resourceId] = i5.resourceRDF, t5 && await R3(B3(i5.resourceRDF), r7, y3);
        return e7;
      }
      for (let e8 of r6) n5.providedResources[e8] || (n5.providedResources[e8] = ``);
    } catch (e7) {
      console.error(`failed loading resources`, e7);
    }
  }
  return [];
}
async function nt2(e6) {
  let t5 = /* @__PURE__ */ new Set();
  for (let n5 of e6.store.getQuads(null, null, null, b4)) rt2(n5.object, e6.store) && t5.add(n5.object.value);
  await tt2(t5, true, e6);
}
function rt2(e6, t5) {
  return e6.termType === `NamedNode` && t5.countQuads(e6, null, null, null) === 0;
}
var G2 = `:scope > .add-button-wrapper, :scope > .collapsible > .add-button-wrapper`;
var it2 = `:scope > .property-instance, :scope > .shacl-or-constraint, :scope > shacl-node, :scope > .collapsible > .property-instance`;
var K2 = class extends HTMLElement {
  constructor(e6, t5) {
    if (super(), this.template = e6, this.parent = t5, this.container = this, this.setAttribute(`part`, `property`), this.template.nodeShapes.size && this.template.config.attributes.collapse !== null && (this.template.maxCount === void 0 || this.template.maxCount > 1)) {
      let t6 = new w2();
      t6.classList.add(`collapsible`, `shacl-group`), t6.open = e6.config.attributes.collapse === `open`, t6.label = this.template.label, t6.setAttribute(`part`, `collapsible`), this.container = t6, this.appendChild(this.container);
    }
    this.template.order !== void 0 && (this.style.order = `${this.template.order}`), this.template.cssClass && this.classList.add(this.template.cssClass), e6.config.editMode && !t5.linked && this.addEventListener(`change`, async () => {
      await this.updateControls();
    });
  }
  async bindValues(e6, t5) {
    if (this.template.path) {
      let n5 = false;
      if (e6) {
        let r6 = this.template.config.store.getQuads(e6, this.template.path, null, this.parent.linked ? null : b4);
        t5 && (r6 = await this.filterValidValues(r6, e6));
        for (let e7 of r6) this.parent.linked || this.template.config.store.delete(e7), await this.addPropertyInstance(e7.object, !b4.equals(e7.graph) || this.template.config.providedResources[e7.object.value] !== void 0, this.template.config.providedResources[e7.object.value] !== void 0), this.template.hasValue && e7.object.equals(this.template.hasValue) && (n5 = true);
      }
      this.template.config.editMode && this.template.hasValue && !n5 && !this.parent.linked && await this.addPropertyInstance(this.template.hasValue);
    }
  }
  async addPropertyInstance(e6, t5, n5 = false) {
    let r6;
    if (this.template.or?.length || this.template.xone?.length) {
      let t6 = this.template.or?.length ? this.template.or : this.template.xone, n6 = false;
      if (e6) {
        let i5 = Re(t6, e6, this.template.config);
        i5.length && (r6 = await q2(U2(Fe(this.template), i5), e6, !this.parent.linked, this.parent.linked, this.parent), n6 = true);
      }
      !n6 && this.template.config.editMode && (r6 = Le(t6, this, this.template.config), at2(r6, ``, this.template.config.theme.dense, this.template.config.hierarchyColorsStyleSheet !== void 0));
    } else r6 = await q2(this.template, e6, n5, t5 || this.parent.linked, this.parent);
    return r6 && this.container.insertBefore(r6, this.querySelector(G2)), r6;
  }
  async updateControls() {
    this.template.config.editMode && !this.parent.linked && !this.querySelector(G2) && this.container.appendChild(await this.createAddControls());
    let e6 = H3(this.template), t5 = this.template.nodeShapes.size === 0, n5 = this.querySelector(`:scope > .add-button-wrapper > .link-button, :scope > .collapsible > .add-button-wrapper > .link-button`) === null, r6 = t5 || !this.hasRecursiveNodeShape(), i5 = this.instanceCount();
    i5 === 0 && r6 && (t5 || n5 && e6 > 0) && (await this.addPropertyInstance(), i5 = 1), t5 || this.querySelector(G2)?.classList.toggle(`required`, i5 < e6);
    let a3;
    a3 = e6 > 0 ? i5 > e6 : !t5 || i5 > 1;
    let o6 = i5 < Pe(this.template);
    this.classList.toggle(`may-remove`, a3), this.classList.toggle(`may-add`, o6);
  }
  instanceCount() {
    return this.querySelectorAll(it2).length;
  }
  hasRecursiveNodeShape() {
    let e6 = /* @__PURE__ */ new Set();
    this.parent.ancestorShapeIds.forEach((t5) => e6.add(t5)), e6.add(this.parent.template.id.value);
    for (let t5 of this.template.nodeShapes) if (e6.has(t5.id.value)) return true;
    return false;
  }
  toRDF(t5, n5) {
    let r6 = N3DataFactory_default.namedNode(this.template.path);
    for (let e6 of this.querySelectorAll(`:scope > .property-instance, :scope > .collapsible > .property-instance`)) if (e6.firstChild instanceof X2) {
      let i5 = e6.firstChild.toRDF(t5);
      t5.addQuad(n5, r6, i5, this.template.config.valuesGraphId);
    } else if (this.template.config.editMode) for (let i5 of e6.querySelectorAll(`:scope > .editor`)) {
      let e7 = Ge(i5);
      e7 && t5.addQuad(n5, r6, e7, this.template.config.valuesGraphId);
    }
    else {
      let i5 = Ge(e6);
      i5 && t5.addQuad(n5, r6, i5, this.template.config.valuesGraphId);
    }
  }
  async filterValidValues(e6, t5) {
    let n5 = this.template.id, r6 = [t5];
    if (this.template.qualifiedValueShape) {
      n5 = this.template.qualifiedValueShape.id, r6 = [];
      for (let t6 of e6) r6.push(t6.object);
    }
    let i5 = await this.template.config.validator.validate({ dataset: this.template.config.store, terms: r6 }, [{ terms: [n5] }]), a3 = /* @__PURE__ */ new Set();
    for (let e7 of i5.results) {
      let t6 = this.template.qualifiedValueShape ? e7.focusNode : e7.value;
      t6?.ptrs?.length && a3.add(t6.ptrs[0]._term.id);
    }
    return e6.filter((e7) => !a3.has(e7.object.id));
  }
  async createAddControls() {
    let e6 = document.createElement(`div`);
    e6.classList.add(`add-button-wrapper`), e6.setAttribute(`part`, `add-controls`);
    let t5 = await Xe(this);
    t5 && e6.appendChild(t5);
    let n5 = this.template.config.theme.createButton(this.template.label, false);
    n5.title = `Add ` + this.template.label, n5.classList.add(`add-button`), n5.setAttribute(`text`, ``);
    let r6 = n5.getAttribute(`part`);
    return n5.setAttribute(`part`, `${r6 ? r6 + ` ` : ``}add-button`), n5.addEventListener(`click`, async () => {
      let e7 = await this.addPropertyInstance();
      e7 && (e7.classList.add(`fadeIn`), await this.updateControls(), setTimeout(() => {
        ge(e7), e7.classList.remove(`fadeIn`);
      }, 200));
    }), e6.appendChild(n5), e6;
  }
};
async function q2(e6, n5, r6 = false, i5 = false, a3) {
  let o6;
  if (e6.nodeShapes.size) {
    o6 = document.createElement(`div`), o6.classList.add(`property-instance`), o6.setAttribute(`part`, `property-instance`);
    let t5 = new Set(a3?.ancestorShapeIds ?? []);
    a3 && t5.add(a3.template.id.value);
    for (let r7 of e6.nodeShapes) {
      let a4 = new X2(r7, n5, e6.nodeKind, e6.label, i5, t5);
      o6.appendChild(a4), await a4.ready;
    }
  } else {
    let t5 = Je(e6.path, e6.datatype?.value);
    o6 = t5 ? e6.config.editMode && !i5 ? t5.createEditor(e6, n5) : t5.createViewer(e6, n5) : He(e6, n5 || null, e6.config.editMode && !i5), o6.childNodes.length > 0 && (o6.classList.add(`property-instance`), o6.setAttribute(`part`, `property-instance`)), i5 && o6.classList.add(`linked`);
  }
  return e6.config.editMode && (!i5 || r6) ? at2(o6, e6.label, e6.config.theme.dense, e6.config.hierarchyColorsStyleSheet !== void 0, r6) : e6.config.hierarchyColorsStyleSheet !== void 0 && o6.appendChild(ot2(true)), n5 && !e6.config.editMode && (n5 instanceof Literal ? (o6.dataset.value = n5.value, n5.language.length > 0 ? o6.dataset.lang = n5.language : o6.shaclDatatype = n5.datatype) : o6.dataset.value = `<` + n5.value + `>`), o6.dataset.path = e6.path, o6;
}
function at2(e6, t5, n5, r6, i5 = false) {
  let a3 = ot2(r6), o6 = new D2();
  o6.classList.add(`remove-button`, `clear`), o6.title = `Remove ` + t5, o6.dense = n5, o6.icon = true;
  let s4 = o6.getAttribute(`part`);
  o6.setAttribute(`part`, `${s4 ? s4 + ` ` : ``}remove-button`), o6.addEventListener(`click`, () => {
    e6.classList.remove(`fadeIn`), e6.classList.add(`fadeOut`), setTimeout(() => {
      let t6 = e6.parentElement;
      e6.remove(), t6?.dispatchEvent(new Event(`change`, { bubbles: true, cancelable: true }));
    }, 200);
  }), i5 && o6.classList.add(`persistent`), a3.appendChild(o6), e6.appendChild(a3);
}
function ot2(e6) {
  let t5 = document.createElement(`div`);
  return t5.className = `remove-button-wrapper`, t5.setAttribute(`part`, `remove-controls`), e6 && t5.classList.add(`colorize`), t5;
}
window.customElements.define(`shacl-property`, K2);
function st2(e6, t5) {
  let n5 = e6, r6 = t5.store.getQuads(e6, null, null, null), i5 = O2(r6, `label`, v3, t5.languages);
  i5 && (n5 = i5);
  let a3;
  if (t5.attributes.collapse !== null) a3 = new w2(), a3.classList.add(`collapsible`), a3.open = t5.attributes.collapse === `open`, a3.label = n5, a3.setAttribute(`part`, `group collapsible`);
  else {
    a3 = document.createElement(`div`);
    let e7 = document.createElement(`h1`);
    e7.innerText = n5, e7.setAttribute(`part`, `group-title`), a3.appendChild(e7), a3.setAttribute(`part`, `group`);
  }
  a3.dataset.subject = e6, a3.classList.add(`shacl-group`);
  let o6 = O2(r6, `order`);
  return o6 && (a3.style.order = o6), a3;
}
var ct = { [`${h4}node`]: (e6, t5) => {
  e6.extendedShapes.add(new J2(t5, e6.config, e6));
}, [`${h4}and`]: (e6, t5) => {
  for (let n5 of e6.config.lists[t5.value]) e6.extendedShapes.add(new J2(n5, e6.config, e6));
}, [`${h4}property`]: (e6, t5) => {
  let n5 = e6.config.getPropertyTemplate(t5, e6);
  if (n5.path) {
    let t6 = e6.properties[n5.path];
    if (t6 || (t6 = [], e6.properties[n5.path] = t6), n5.qualifiedValueShape) t6.push(n5);
    else {
      let r6;
      for (let t7 = 0; t7 < e6.properties[n5.path].length && !r6; t7++) e6.properties[n5.path][t7].qualifiedValueShape || (r6 = e6.properties[n5.path][t7]);
      r6 ? Ie(r6, n5) : t6.push(n5);
    }
  }
}, [`${h4}nodeKind`]: (e6, t5) => {
  e6.nodeKind = t5;
}, [`${h4}targetClass`]: (e6, t5) => {
  e6.targetClass = t5;
}, [`${h4}or`]: (e6, t5) => {
  e6.or = e6.config.lists[t5.value];
}, [`${h4}xone`]: (e6, t5) => {
  e6.xone = e6.config.lists[t5.value];
}, [C2.id]: (e6, t5) => {
  e6.owlImports.add(t5);
}, [`${ae2}title`]: (e6, t5) => {
  let n5 = t5;
  e6.label = M3(e6.config.languages, e6.label, n5);
}, [`${v3}label`]: (e6, t5) => {
  let n5 = t5;
  e6.label = M3(e6.config.languages, e6.label, n5);
} };
var J2 = class {
  constructor(e6, t5, n5) {
    this.extendedShapes = /* @__PURE__ */ new Set(), this.properties = {}, this.owlImports = /* @__PURE__ */ new Set(), this.merged = false, this.id = e6, this.config = t5, this.parent = n5, t5.registerNodeTemplate(this), lt(this, this.config.store.getQuads(e6, null, null, null));
  }
};
function lt(e6, t5) {
  for (let n5 of t5) ct[n5.predicate.id]?.call(e6, e6, n5.object);
  return e6;
}
function ut2(e6) {
  if (!e6.merged) {
    e6.merged = true;
    for (let t5 of Object.values(e6.properties)) for (let n5 of t5) {
      let [t6, r6] = Y2(e6, n5.path);
      if (t6.length > 1 && r6) {
        let e7 = t6[t6.length - 1];
        for (let n6 = t6.length - 2; n6 >= 0; n6--) {
          let r7 = t6[n6];
          delete r7.parent.properties[r7.path], Ie(e7, r7);
        }
      }
    }
  }
}
function Y2(e6, t5, n5 = /* @__PURE__ */ new Set(), r6 = [], i5 = false) {
  if (!n5.has(e6.id.value)) {
    n5.add(e6.id.value);
    let a3 = e6.properties[t5];
    if (a3?.length === 1) {
      r6.push(a3[0]), i5 ||= a3[0].maxCount === 1;
      for (let e7 of a3[0].nodeShapes) {
        let [a4, o6] = Y2(e7, t5, n5, r6, i5);
        i5 ||= o6;
      }
    }
    for (let a4 of e6.extendedShapes) {
      let [e7, o6] = Y2(a4, t5, n5, r6, i5);
      i5 ||= o6;
    }
  }
  return [r6, i5];
}
var X2 = class t4 extends HTMLElement {
  constructor(n5, r6, i5, a3, o6, s4 = /* @__PURE__ */ new Set()) {
    super(), this.template = n5, this.linked = o6 ?? false, this.ancestorShapeIds = s4, this.setAttribute(`part`, `node`);
    let c5 = r6;
    c5 ||= (!i5 && n5.nodeKind && (i5 = n5.nodeKind), i5 === void 0 && n5.config.attributes.valuesNamespace || i5?.value === `http://www.w3.org/ns/shacl#IRI` ? N3DataFactory_default.namedNode(n5.config.attributes.valuesNamespace + v4_default()) : N3DataFactory_default.blankNode(v4_default())), this.nodeId = c5;
    let l4 = JSON.stringify([n5.id, r6]);
    if (r6 && n5.config.renderedNodes.has(l4)) {
      a3 ||= `Link`;
      let e6 = document.createElement(`label`);
      e6.innerText = a3, e6.classList.add(`linked`), this.appendChild(e6);
      let t5 = this.getAttribute(`part`);
      this.setAttribute(`part`, `${t5 ? t5 + ` ` : ``}linked-node`);
      let n6 = document.createElement(`a`), i6 = r6.termType === `BlankNode` ? `_:` + r6.value : r6.value;
      n6.innerText = i6, n6.classList.add(`ref-link`), n6.onclick = () => {
        this.template.config.form.querySelector(`shacl-node[data-node-id='${i6}']`)?.scrollIntoView();
      }, this.appendChild(n6), this.style.flexDirection = `row`, this.ready = Promise.resolve();
    } else {
      r6 && n5.config.renderedNodes.add(l4);
      let e6 = this.ancestorShapeIds, i6 = this.template.id.value;
      if (this.dataset.nodeId = this.nodeId.id, this.template.config.attributes.showNodeIds !== null) {
        let e7 = document.createElement(`div`);
        e7.innerText = `id: ${this.nodeId.id}`, e7.classList.add(`node-id-display`), this.appendChild(e7);
      }
      ut2(n5), this.ready = (async () => {
        let s5 = new Set(e6);
        s5.add(i6);
        for (let [e7, t5] of Object.entries(n5.properties)) for (let e8 of t5) await this.addPropertyInstance(e8, r6, t5.length > 1);
        for (let e7 of n5.extendedShapes) {
          let n6 = new t4(e7, r6, void 0, void 0, o6, s5);
          this.prepend(n6), await n6.ready;
        }
        if (n5.or?.length && await this.tryResolve(n5.or, r6, n5.config), n5.xone?.length && await this.tryResolve(n5.xone, r6, n5.config), a3) {
          let e7 = document.createElement(`h1`);
          e7.innerText = a3, e7.setAttribute(`part`, `node-title`), this.prepend(e7);
        }
      })();
    }
  }
  toRDF(t5, n5, r6 = ``) {
    if (n5 ||= this.nodeId, !this.linked) {
      for (let e6 of this.querySelectorAll(`:scope > shacl-node, :scope > .shacl-group > shacl-node, :scope > shacl-property, :scope > .shacl-group > shacl-property`)) e6.toRDF(t5, n5);
      this.template.targetClass && t5.addQuad(n5, x2, this.template.targetClass, this.template.config.valuesGraphId), r6 && t5.addQuad(n5, N3DataFactory_default.namedNode(r6), this.template.id, this.template.config.valuesGraphId);
    }
    return n5;
  }
  async addPropertyInstance(e6, t5, n5) {
    let r6 = null;
    if (e6.group) if (e6.config.groups.indexOf(e6.group) > -1) {
      let t6 = this.querySelector(`:scope > .shacl-group[data-subject='${e6.group}']`);
      t6 || (t6 = st2(e6.group, e6.config), this.appendChild(t6)), r6 = t6;
    } else console.warn(`ignoring unknown group reference`, e6.group, `existing groups:`, e6.config.groups);
    let i5 = new K2(e6, this);
    await i5.bindValues(t5, n5), (e6.config.editMode || i5.instanceCount() > 0) && (r6 ? r6.appendChild(i5) : this.appendChild(i5), await i5.updateControls());
  }
  async tryResolve(e6, t5, n5) {
    let r6 = false;
    if (t5) {
      let i5 = ze(e6, t5, n5);
      if (i5.length) {
        for (let e7 of i5) await this.addPropertyInstance(n5.getPropertyTemplate(e7, this.template), t5);
        r6 = true;
      }
    }
    r6 || this.appendChild(Le(e6, this, n5));
  }
};
window.customElements.define(`shacl-node`, X2);
var dt3 = `
.editor:not([type='checkbox']) { border: 1px solid var(--shacl-border-color, #DDD); }
.property-instance label { display: inline-flex; word-break: break-word; line-height: 1em; padding-top: 0.15em; padding-right: 1em; flex-shrink: 0; position: relative; }
.property-instance:not(:first-child) > label:not(.persistent) { visibility: hidden; max-height: 0; }
.mode-edit .property-instance label { width: var(--label-width); }
`;
var ft2 = class extends Ve {
  constructor(e6) {
    super(e6 || dt3), this.idCtr = 0;
  }
  createDefaultTemplate(r6, i5, a3, o6, s4) {
    if (o6.id = `e${this.idCtr++}`, o6.classList.add(`editor`), o6.setAttribute(`part`, `editor`), s4?.datatype ? o6.shaclDatatype = s4.datatype : i5 instanceof Literal && (o6.shaclDatatype = i5.datatype), s4 && H3(s4) > 0 && (o6.dataset.minCount = String(H3(s4))), s4?.class && (o6.dataset.class = s4.class.value), s4?.nodeKind) o6.dataset.nodeKind = s4.nodeKind.value;
    else if (i5 && (i5 instanceof NamedNode || s4?.nodeKind?.equals(ue2)) && (o6.dataset.nodeKind = h4 + `IRI`, s4)) {
      let t5 = k3(s4.config.store.getQuads(i5, null, null, null), s4.config.languages);
      t5 && (o6.dataset.value = `<` + i5.value + `>`, i5 = N3DataFactory_default.literal(t5));
    }
    (s4?.hasValue && i5 || s4?.readonly) && (o6.disabled = true);
    let c5 = i5?.value || s4?.defaultValue?.value || ``;
    s4?.datatype?.equals(me) ? o6.checked = i5?.value === `true` || s4?.defaultValue?.value === `true` : o6.type === `file` ? o6.binaryData = c5 || void 0 : o6.value = c5;
    let l4 = document.createElement(`label`);
    l4.htmlFor = o6.id, l4.innerText = r6, l4.setAttribute(`part`, `label`), s4?.description && l4.setAttribute(`title`, s4.description.value);
    let u3 = s4?.description ? s4.description.value : s4?.pattern ? s4.pattern : null;
    u3 && o6.setAttribute(`placeholder`, u3), a3 && (o6.setAttribute(`required`, `true`), l4.classList.add(`required`));
    let d4 = document.createElement(`div`);
    return d4.setAttribute(`part`, `field`), d4.appendChild(l4), d4.appendChild(o6), d4;
  }
  createDateEditor(e6, t5, n5, r6) {
    let i5 = new p3();
    r6.datatype?.value === `http://www.w3.org/2001/XMLSchema#dateTime` ? (i5.type = `datetime-local`, i5.setAttribute(`step`, `1`)) : i5.type = `date`, i5.clearable = true, i5.dense = this.dense, i5.classList.add(`pr-0`);
    let a3 = this.createDefaultTemplate(e6, null, n5, i5, r6);
    if (t5) {
      let e7 = r6.datatype?.value === `http://www.w3.org/2001/XMLSchema#dateTime` ? we(t5.value) : Ce(t5.value);
      e7 ? (i5.value = e7.value, e7.suffix && (i5.dataset.xsdTemporalSuffix = e7.suffix)) : console.error(`unable to parse xsd date literal`, t5);
    }
    return a3;
  }
  createTextEditor(e6, t5, n5, r6) {
    let i5;
    return r6.singleLine === false ? (i5 = new N2(), i5.resize = `auto`) : i5 = new p3(), i5.dense = this.dense, r6.pattern && (i5.pattern = r6.pattern), r6.minLength && (i5.minLength = r6.minLength), r6.maxLength && (i5.maxLength = r6.maxLength), this.createDefaultTemplate(e6, t5, n5, i5, r6);
  }
  createLangStringEditor(e6, n5, r6, i5) {
    let a3 = this.createTextEditor(e6, n5, r6, i5), o6 = a3.querySelector(`:scope .editor`), s4;
    if (i5.languageIn?.length) {
      s4 = document.createElement(`select`);
      for (let e7 of i5.languageIn) {
        let t5 = document.createElement(`option`);
        t5.innerText = e7.value, s4.appendChild(t5);
      }
    } else s4 = document.createElement(`input`), s4.maxLength = 5, s4.size = 5, s4.placeholder = `lang?`;
    return s4.title = `Language of the text`, s4.classList.add(`lang-chooser`), s4.setAttribute(`part`, `lang-chooser`), s4.slot = `suffix`, o6.addEventListener(`change`, () => {
      s4.required = o6.value !== ``;
    }), s4.addEventListener(`change`, (e7) => {
      e7.stopPropagation(), o6 && (o6.dataset.lang = s4.value, o6.dispatchEvent(new Event(`change`, { bubbles: true })));
    }), n5 instanceof Literal && (s4.value = n5.language), o6.dataset.lang = s4.value, o6.appendChild(s4), a3;
  }
  createBooleanEditor(e6, n5, r6, i5) {
    let a3 = document.createElement(`input`);
    a3.type = `checkbox`, a3.classList.add(`ml-0`);
    let o6 = this.createDefaultTemplate(e6, null, r6, a3, i5);
    return a3.removeAttribute(`required`), o6.querySelector(`:scope label`)?.classList.remove(`required`), n5 instanceof Literal && (a3.checked = n5.value === `true`), o6;
  }
  createFileEditor(e6, t5, n5, r6) {
    let i5 = document.createElement(`input`);
    return i5.type = `file`, i5.addEventListener(`change`, (e7) => {
      if (i5.files?.length) {
        e7.stopPropagation();
        let t6 = new FileReader();
        t6.readAsDataURL(i5.files[0]), t6.onload = () => {
          i5.binaryData = btoa(t6.result), i5.parentElement?.dispatchEvent(new Event(`change`, { bubbles: true }));
        };
      } else i5.binaryData = void 0;
    }), this.createDefaultTemplate(e6, t5, n5, i5, r6);
  }
  createNumberEditor(e6, t5, n5, r6) {
    let i5 = new p3();
    i5.type = `number`, i5.clearable = true, i5.dense = this.dense, i5.classList.add(`pr-0`);
    let a3 = r6.minInclusive === void 0 ? r6.minExclusive === void 0 ? void 0 : r6.minExclusive + 1 : r6.minInclusive, o6 = r6.maxInclusive === void 0 ? r6.maxExclusive === void 0 ? void 0 : r6.maxExclusive - 1 : r6.maxInclusive;
    return a3 !== void 0 && (i5.min = String(a3)), o6 !== void 0 && (i5.max = String(o6)), r6.datatype?.value !== `http://www.w3.org/2001/XMLSchema#integer` && (i5.step = `any`), this.createDefaultTemplate(e6, t5, n5, i5, r6);
  }
  createListEditor(e6, t5, r6, i5, a3) {
    let o6 = new d3();
    o6.clearable = true, o6.dense = this.dense;
    let s4 = this.createDefaultTemplate(e6, null, r6, o6, a3), c5 = document.createElement(`ul`), l4 = true, u3 = (e7, t6) => {
      let r7 = document.createElement(`li`);
      if (typeof e7.value == `string` ? (r7.dataset.value = e7.value, r7.innerText = e7.label ? e7.label : e7.value) : (r7.dataset.value = e7.value.id, e7.value instanceof NamedNode && (r7.dataset.value = `<` + r7.dataset.value + `>`), r7.innerText = e7.label ? e7.label : e7.value.value), t6.appendChild(r7), e7.children?.length) {
        l4 = false;
        let t7 = document.createElement(`ul`);
        r7.appendChild(t7);
        for (let n5 of e7.children) u3(n5, t7);
      }
    };
    for (let e7 of i5) u3(e7, c5);
    return l4 || (o6.collapse = true), o6.appendChild(c5), t5 = t5 ?? a3?.defaultValue ?? null, t5 && (o6.value = t5.id, t5 instanceof NamedNode && (o6.value = `<` + o6.value + `>`)), s4;
  }
  createButton(e6, t5) {
    let n5 = new D2();
    return n5.dense = this.dense, n5.innerHTML = e6, t5 ? (n5.setAttribute(`primary`, ``), n5.setAttribute(`part`, `button primary`)) : n5.setAttribute(`part`, `button`), n5;
  }
};
var Z3 = class {
  constructor() {
    this.shapes = null, this.shapesUrl = null, this.shapeSubject = null, this.values = null, this.valuesUrl = null, this.valueSubject = null, this.valuesSubject = null, this.valuesNamespace = ``, this.valuesGraph = null, this.view = null, this.language = null, this.loading = `Loading\u2026`, this.proxy = null, this.ignoreOwlImports = null, this.collapse = null, this.hierarchyColors = null, this.submitButton = null, this.generateNodeShapeReference = S4.value, this.showNodeIds = null, this.showRootShapeLabel = null, this.dense = `true`, this.useShadowRoot = `true`;
  }
};
var pt3 = `#4c93d785, #f85e9a85, #00327385, #87001f85`;
var Q2 = class {
  constructor(t5) {
    this.attributes = new Z3(), this.editMode = true, this.lists = {}, this.groups = [], this.renderedNodes = /* @__PURE__ */ new Set(), this._store = new N3Store(), this._nodeTemplates = {}, this._propertyTemplates = {}, this.validator = new Validator_default(this._store, { details: true, factory: N3DataFactory_default }), this.providedConformingResourceIds = {}, this.providedResources = {}, this.form = t5, this._theme = new ft2(), this.languages = [...new Set(navigator.languages.flatMap((e6) => e6.length > 2 ? [e6.toLocaleLowerCase(), e6.substring(0, 2)] : e6)), ``];
  }
  reset() {
    this.lists = {}, this.groups = [], this.renderedNodes.clear(), this.providedConformingResourceIds = {}, this.providedResources = {}, this._nodeTemplates = {}, this._propertyTemplates = {};
  }
  updateAttributes(t5) {
    let n5 = new Z3();
    if (Object.keys(n5).forEach((e6) => {
      let r6 = t5.dataset[e6];
      r6 !== void 0 && (n5[e6] = r6);
    }), this.editMode = n5.view === null, this.theme.setDense(n5.dense === `true`), this.attributes = n5, this.attributes.valueSubject && !this.attributes.valuesSubject && (this.attributes.valuesSubject = this.attributes.valueSubject), n5.language) {
      let e6 = this.languages.indexOf(n5.language);
      e6 > -1 && this.languages.splice(e6, 1), this.languages.unshift(n5.language);
    }
    if (n5.valuesGraph && (this.valuesGraphId = N3DataFactory_default.namedNode(n5.valuesGraph)), n5.hierarchyColors != null) {
      let e6 = n5.hierarchyColors.length ? n5.hierarchyColors : pt3, t6 = `:host { --hierarchy-colors: ${e6}; --hierarchy-colors-length: ${e6.split(`,`).length} }`;
      for (let e7 = 8; e7 >= 0; e7--) {
        let n6 = `shacl-property { --hierarchy-level: ${e7} }`;
        for (let t7 = 0; t7 < e7; t7++) n6 = `shacl-property ` + n6;
        t6 = t6 + `
` + n6;
      }
      this.hierarchyColorsStyleSheet = new CSSStyleSheet(), this.hierarchyColorsStyleSheet.replaceSync(t6);
    }
  }
  static dataAttributes() {
    let e6 = new Z3();
    return Object.keys(e6).map((e7) => (e7 = e7.replace(/[A-Z]/g, (e8) => `-` + e8.toLowerCase()), `data-` + e7));
  }
  buildTemplateKey(e6, t5) {
    let n5 = e6.value;
    return t5 && (t5 instanceof V3 ? n5 += `*` + t5.id.value : n5 += `*` + this.buildTemplateKey(t5.id, t5.parent)), n5;
  }
  registerNodeTemplate(e6) {
    this._nodeTemplates[this.buildTemplateKey(e6.id, e6.parent)] = e6;
  }
  registerPropertyTemplate(e6) {
    this._propertyTemplates[this.buildTemplateKey(e6.id, e6.parent)] = e6;
  }
  getNodeTemplateIds() {
    let e6 = /* @__PURE__ */ new Set();
    for (let t5 of Object.values(this._nodeTemplates)) e6.add(t5.id.value);
    return e6;
  }
  getNodeTemplate(e6, t5) {
    let n5 = this.buildTemplateKey(e6, t5), r6 = this._nodeTemplates[n5];
    return r6 ||= new J2(e6, this, t5), r6;
  }
  getPropertyTemplate(e6, t5) {
    let n5 = this.buildTemplateKey(e6, t5), r6 = this._propertyTemplates[n5];
    return r6 ||= new V3(e6, t5), r6;
  }
  get nodeTemplates() {
    return Object.values(this._nodeTemplates);
  }
  get theme() {
    return this._theme;
  }
  set theme(e6) {
    this._theme = e6, e6.setDense(this.attributes.dense === `true`);
  }
  get store() {
    return this._store;
  }
  set store(t5) {
    this._store = t5, this.lists = ke(t5, { ignoreErrors: true }), this.groups = [], t5.forSubjects((e6) => {
      this.groups.push(e6.id);
    }, x2, `${h4}PropertyGroup`, null), this.validator = new Validator_default(t5, { details: true, factory: N3DataFactory_default });
  }
};
var $3 = class extends HTMLElement {
  static get observedAttributes() {
    return Q2.dataAttributes();
  }
  constructor() {
    super(), this.shape = null, this.styleElement = null, this.form = document.createElement(`form`), this.form.setAttribute(`part`, `form`), this.config = new Q2(this.form), this.form.addEventListener(`change`, (e6) => {
      e6.stopPropagation(), this.config.editMode && this.validate(true).then((e7) => {
        this.dispatchEvent(new CustomEvent(`change`, { bubbles: true, cancelable: false, composed: true, detail: { valid: e7.conforms, report: e7 } }));
      }).catch((e7) => {
        console.warn(e7);
      });
    });
  }
  connectedCallback() {
    this.config.updateAttributes(this), this.ensureRenderRoot(), this.initialize();
  }
  attributeChangedCallback() {
    this.config.updateAttributes(this), this.ensureRenderRoot(), this.initialize();
  }
  initialize() {
    clearTimeout(this.initDebounceTimeout), this.setAttribute(`loading`, ``), this.form.replaceChildren(document.createTextNode(this.config.attributes.loading)), this.initDebounceTimeout = setTimeout(async () => {
      try {
        this.config.reset(), this.config.store = await Ae({ shapes: this.config.attributes.shapes, shapesUrl: this.config.attributes.shapesUrl, values: this.config.attributes.values, valuesUrl: this.config.attributes.valuesUrl, valuesSubject: this.config.attributes.valuesSubject, loadOwlImports: this.config.attributes.ignoreOwlImports === null, classInstanceProvider: this.config.classInstanceProvider, proxy: this.config.attributes.proxy }), this.config.resourceLinkProvider && await nt2(this.config), this.config.attributes.valuesSubject || (this.config.attributes.valuesSubject = I3(this.config.store) || null), this.form.replaceChildren();
        let t5 = this.findRootShaclShapeSubject();
        if (t5) {
          this.form.classList.forEach((e6) => {
            this.form.classList.remove(e6);
          }), this.form.classList.toggle(`mode-edit`, this.config.editMode), this.form.classList.toggle(`mode-view`, !this.config.editMode), this.config.theme.apply(this.form);
          let n5 = [this.config.theme.stylesheet];
          this.config.hierarchyColorsStyleSheet && n5.push(this.config.hierarchyColorsStyleSheet);
          for (let e6 of qe()) e6.stylesheet && n5.push(e6.stylesheet);
          this.applyStyles(n5);
          let r6 = new J2(t5, this.config);
          for (let e6 of this.config.nodeTemplates) ut2(e6);
          if (this.shape = new X2(r6, this.config.attributes.valuesSubject ? N3DataFactory_default.namedNode(this.config.attributes.valuesSubject) : void 0), this.form.appendChild(this.shape), this.config.attributes.showRootShapeLabel !== null && r6.label) {
            let e6 = document.createElement(`h3`);
            e6.innerText = r6.label.value, this.form.prepend(e6);
          }
          if (this.config.editMode) {
            if (this.config.attributes.submitButton !== null) {
              let e6 = this.config.theme.createButton(this.config.attributes.submitButton || `Submit`, true);
              e6.classList.add(`submit-button`);
              let t6 = e6.getAttribute(`part`);
              e6.setAttribute(`part`, `${t6 ? t6 + ` ` : ``}submit-button`), e6.addEventListener(`click`, (e7) => {
                e7.preventDefault(), this.form.reportValidity() && this.validate().then((e8) => {
                  if (e8?.conforms) this.dispatchEvent(new Event(`submit`, { bubbles: true, cancelable: true }));
                  else {
                    let e9 = this.form.querySelector(`:scope .invalid > .editor`);
                    e9 ? e9.focus() : this.form.querySelector(`:scope .invalid`)?.scrollIntoView();
                  }
                });
              }), this.form.appendChild(e6);
            }
            (async () => {
              await this.shape?.ready, this.config.attributes.valuesSubject && this.removeFromDataGraph(N3DataFactory_default.namedNode(this.config.attributes.valuesSubject)), this.validate(true);
            })();
          }
        } else if (this.config.store.countQuads(null, null, null, y3) > 0) throw Error(`shacl root node shape not found`);
      } catch (e6) {
        console.error(e6);
        let t5 = document.createElement(`div`);
        t5.innerText = String(e6), this.form.replaceChildren(t5);
      }
      this.removeAttribute(`loading`), await this.shape?.ready, this.dispatchEvent(new Event(`ready`));
    }, 200);
  }
  ensureRenderRoot() {
    this.config.attributes.useShadowRoot === `false` ? (this.shadowRoot?.contains(this.form) && this.shadowRoot.removeChild(this.form), this.contains(this.form) || this.prepend(this.form)) : (this.shadowRoot || this.attachShadow({ mode: `open` }), this.shadowRoot.contains(this.form) || this.shadowRoot.prepend(this.form));
  }
  applyStyles(e6) {
    if (this.config.attributes.useShadowRoot !== `false` && this.shadowRoot) {
      this.shadowRoot.adoptedStyleSheets = e6, this.styleElement &&= (this.styleElement.remove(), null);
      return;
    }
    let t5 = e6.map((e7) => Array.from(e7.cssRules).map((e8) => e8.cssText).join(`
`).replace(/:host\b/g, `shacl-form`)).join(`
`);
    this.styleElement || (this.styleElement = document.createElement(`style`), this.prepend(this.styleElement)), this.styleElement.textContent = t5;
  }
  serialize(e6 = `text/turtle`, t5 = this.toRDF()) {
    return Ue(t5.getQuads(null, null, null, null), e6, F2);
  }
  toRDF(e6 = new N3Store()) {
    return this.shape?.toRDF(e6, void 0, this.config.attributes.generateNodeShapeReference), e6;
  }
  registerPlugin(e6) {
    Ke(e6), this.initialize();
  }
  setTheme(e6) {
    this.config.theme = e6, this.initialize();
  }
  setClassInstanceProvider(e6) {
    this.config.classInstanceProvider = e6, this.initialize();
  }
  setResourceLinkProvider(e6) {
    this.config.resourceLinkProvider = e6, this.initialize();
  }
  async validate(e6 = false) {
    for (let e7 of this.form.querySelectorAll(`:scope .validation-error`)) e7.remove();
    for (let e7 of this.form.querySelectorAll(`:scope .property-instance`)) e7.classList.remove(`invalid`), e7.querySelector(`:scope > .editor`)?.value ? e7.classList.add(`valid`) : e7.classList.remove(`valid`);
    for (let e7 of this.form.querySelectorAll(`.add-button-wrapper`)) e7.classList.remove(`invalid`, `validation-error`);
    if (!this.shape) return { conforms: true, results: [] };
    if (!e6) {
      let e7 = this.form.querySelectorAll(`.add-button-wrapper.required`);
      for (let t6 of e7) t6.classList.add(`invalid`), t6.after(this.createValidationErrorDisplay(`Value is required`, `node`));
      if (e7.length > 0) return { conforms: false, results: [] };
    }
    let t5 = this.shape;
    return new Promise((n5) => {
      this.config.store.deleteGraph(this.config.valuesGraphId || ``).on(`end`, async () => {
        t5.toRDF(this.config.store, void 0, this.config.attributes.generateNodeShapeReference);
        try {
          let r6 = await this.config.validator.validate({ dataset: this.config.store, terms: [t5.nodeId] }, [{ terms: [t5.template.id] }]);
          for (let t6 of r6.results) if (t6.focusNode?.ptrs?.length) for (let n6 of t6.focusNode.ptrs) {
            let r7 = n6._term;
            if (t6.path?.length) {
              let n7 = t6.path[0].predicates[0], i5 = this.form.querySelectorAll(`
                                        :scope shacl-node[data-node-id='${r7.id}'] > shacl-property > .property-instance[data-path='${n7.id}'] > .editor,
                                        :scope shacl-node[data-node-id='${r7.id}'] > shacl-property > .shacl-group > .property-instance[data-path='${n7.id}'] > .editor,
                                        :scope shacl-node[data-node-id='${r7.id}'] > .shacl-group > shacl-property > .property-instance[data-path='${n7.id}'] > .editor,
                                        :scope shacl-node[data-node-id='${r7.id}'] > .shacl-group > shacl-property > .shacl-group > .property-instance[data-path='${n7.id}'] > .editor`);
              i5.length === 0 && (i5 = this.form.querySelectorAll(`
                                            :scope [data-node-id='${r7.id}']  > shacl-property > .property-instance[data-path='${n7.id}'],
                                            :scope [data-node-id='${r7.id}']  > shacl-property > .shacl-group > .property-instance[data-path='${n7.id}']`));
              for (let n8 of i5) if (n8.classList.contains(`editor`)) {
                if (!e6 || n8.value) {
                  let e7 = n8.parentElement;
                  e7.classList.add(`invalid`), e7.classList.remove(`valid`), e7.appendChild(this.createValidationErrorDisplay(t6));
                  do
                    e7 instanceof w2 && (e7.open = true), e7 = e7.parentElement;
                  while (e7);
                }
              } else e6 || (n8.classList.add(`invalid`), n8.classList.remove(`valid`), n8.appendChild(this.createValidationErrorDisplay(t6, `node`)));
            } else e6 || this.form.querySelector(`:scope [data-node-id='${r7.id}']`)?.prepend(this.createValidationErrorDisplay(t6, `node`));
          }
          n5(r6);
        } catch (e7) {
          console.error(e7), n5({ conforms: false, results: [] });
        }
      });
    });
  }
  createValidationErrorDisplay(e6, t5) {
    let n5 = document.createElement(`span`);
    n5.classList.add(`validation-error`), t5 && n5.classList.add(t5);
    let r6 = typeof e6 == `object` && e6 ? e6 : null;
    return r6 ? r6.message?.length ? n5.title += be(this.config.languages, r6.message) : r6.sourceConstraintComponent?.value && (n5.title = r6.sourceConstraintComponent.value) : typeof e6 == `string` && (n5.title = e6), n5;
  }
  findRootShaclShapeSubject() {
    if (this.config.attributes.shapeSubject) {
      let t5 = N3DataFactory_default.namedNode(this.config.attributes.shapeSubject);
      if (this.config.store.getQuads(t5, x2, w3, null).length === 0) {
        console.warn(`shapes graph does not contain requested node shape ${this.config.attributes.shapeSubject}`);
        return;
      } else return t5;
    } else {
      if (this.config.attributes.valuesSubject && this.config.store.countQuads(null, null, null, b4) > 0) {
        let t6 = N3DataFactory_default.namedNode(this.config.attributes.valuesSubject), n5 = L3(this.config.store, this.config.attributes.valuesSubject), r6 = this.config.store.getQuads(t6, x2, null, b4);
        if (r6.length === 0 && console.warn(`value subject '${this.config.attributes.valuesSubject}' has neither ${x2.id} nor ${S4.id} statement`), n5) return n5;
        for (let e6 of r6) if (this.config.store.getQuads(e6.object, x2, w3, null).length > 0) return e6.object;
        let i5 = this.config.store.getObjects(t6, x2, b4);
        for (let e6 of i5) for (let t7 of this.config.store.getQuads(null, D3, e6, null)) return t7.subject;
      }
      let t5 = this.config.store.getQuads(null, x2, w3, null);
      if (t5.length == 0) {
        console.warn(`shapes graph does not contain any node shapes`);
        return;
      }
      return t5.length > 1 && (console.warn(`shapes graph contains`, t5.length, `node shapes. choosing first found which is`, t5[0].subject.value), console.info(`hint: set the node shape to use with element attribute "data-shape-subject"`)), t5[0].subject;
    }
  }
  removeFromDataGraph(e6) {
    for (let t5 of this.config.store.getQuads(e6, null, null, b4)) this.config.store.delete(t5), (t5.object.termType === `NamedNode` || t5.object.termType === `BlankNode`) && this.removeFromDataGraph(t5.object);
  }
};
window.customElements.define(`shacl-form`, $3);

// src/components/shacl-view.ts
var ALLOWED_DATASET_KEYS = /* @__PURE__ */ new Set([
  "view",
  "ignoreOwlImports",
  "shapes",
  "values",
  "shapeSubject",
  // `data-values-subject` (camelCase `valuesSubject`): the auto-import suppressant
  // — pinning it stops shacl-form auto-deriving a fetchable subject from the data.
  "valuesSubject"
]);
var INPUT_PROPS = ["shapes", "values", "shapeSubject", "fetch", "publicFetch", "resolveOptions"];
var JeswrShaclView = class extends i4 {
  static properties = {
    shapes: { attribute: false },
    values: { attribute: false },
    shapeSubject: { attribute: "shape-subject" },
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    resolveOptions: { attribute: false },
    status: { state: true },
    errorMessage: { state: true },
    shapesTurtle: { state: true },
    valuesTurtle: { state: true }
  };
  /** A monotonically increasing token to drop the result of a superseded resolve. */
  #renderToken = 0;
  constructor() {
    super();
    this.shapes = void 0;
    this.values = void 0;
    this.shapeSubject = void 0;
    this.fetch = void 0;
    this.publicFetch = void 0;
    this.resolveOptions = void 0;
    this.status = "idle";
    this.errorMessage = "";
    this.shapesTurtle = "";
    this.valuesTurtle = "";
  }
  /** Render into the light DOM so a consuming app can `::part`/style the inner form. */
  createRenderRoot() {
    return this;
  }
  willUpdate(changed) {
    const changedKeys = changed;
    if (INPUT_PROPS.some((k4) => changedKeys.has(k4))) {
      void this.#resolve();
    }
  }
  /**
   * Pre-fetch + serialise both graphs, then drop them into state so render()
   * inlines them onto <shacl-form>. Fail-closed: any error → the error view, with
   * no partially-applied inline graph.
   */
  async #resolve() {
    const token2 = ++this.#renderToken;
    const shapes = this.shapes;
    const values = this.values;
    if (!shapes || !values) {
      this.shapesTurtle = "";
      this.valuesTurtle = "";
      this.errorMessage = "";
      this.status = "idle";
      return;
    }
    this.status = "loading";
    this.errorMessage = "";
    const seam = {
      fetch: this.fetch ?? globalThis.fetch.bind(globalThis),
      ...this.publicFetch ? { publicFetch: this.publicFetch } : {}
    };
    const opts = this.resolveOptions ?? {};
    const result = await resolveAndHarden(shapes, values, seam, opts);
    if (token2 !== this.#renderToken) return;
    if (result.kind === "ready") {
      this.shapesTurtle = result.shapesTurtle;
      this.valuesTurtle = result.valuesTurtle;
      this.status = "ready";
      return;
    }
    this.shapesTurtle = "";
    this.valuesTurtle = "";
    this.errorMessage = result.message;
    this.status = "error";
  }
  render() {
    if (this.status === "idle") {
      return b2`<slot name="empty"><p part="empty">No shape or data to display.</p></slot>`;
    }
    if (this.status === "loading") {
      return b2`<slot name="loading"><p part="loading">Loading…</p></slot>`;
    }
    if (this.status === "error") {
      return b2`<p part="error" role="alert">${this.errorMessage}</p>`;
    }
    return b2`
      <shacl-form
        part="form"
        data-view=""
        data-ignore-owl-imports=""
        data-shapes=${this.shapesTurtle}
        data-values=${this.valuesTurtle}
        data-shape-subject=${this.shapeSubject ?? A}
      ></shacl-form>
    `;
  }
  /**
   * Defence-in-depth: after every render, REMOVE any `*-url` dataset key from the
   * inner <shacl-form> that might somehow have appeared, and any key not on the
   * allow-list. This is belt-and-braces over the template (which already only
   * binds inline keys) so a future template edit cannot silently re-introduce a
   * URL fetch surface.
   */
  updated(_changed) {
    const form = this.querySelector("shacl-form");
    if (!form) return;
    for (const key of Object.keys(form.dataset)) {
      const lower = key.toLowerCase();
      if (lower.endsWith("url") || !ALLOWED_DATASET_KEYS.has(key)) {
        delete form.dataset[key];
      }
    }
  }
};
if (!customElements.get("jeswr-shacl-view")) {
  customElements.define("jeswr-shacl-view", JeswrShaclView);
}

// src/vocab.ts
var TASK_CLASS = "http://www.w3.org/2005/01/wf/flow#Task";
var VCARD_INDIVIDUAL = "http://www.w3.org/2006/vcard/ns#Individual";
var VCARD_ADDRESS_BOOK = "http://www.w3.org/2006/vcard/ns#AddressBook";
var BOOKMARK_CLASS = "https://w3id.org/jeswr/bookmark#Bookmark";
var AS_NOTE = "https://www.w3.org/ns/activitystreams#Note";
var LDP_CONTAINER = "http://www.w3.org/ns/ldp#Container";
var LDP_BASIC_CONTAINER = "http://www.w3.org/ns/ldp#BasicContainer";
var RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

// src/errors.ts
var DataControllerError = class extends Error {
  /** The resource URL the failing read targeted. */
  url;
  /** The HTTP status, when the failure came from a response (else undefined). */
  status;
  constructor(message, url, options) {
    super(message, options?.cause !== void 0 ? { cause: options.cause } : void 0);
    this.name = new.target.name;
    this.url = url;
    this.status = options?.status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var NotFoundError = class extends DataControllerError {
  constructor(url, options) {
    super(`Resource not found: ${url}`, url, options);
  }
};
var AccessDeniedError = class extends DataControllerError {
  constructor(url, options) {
    super(`Access denied: ${url}`, url, options);
  }
};
var NetworkError = class extends DataControllerError {
  constructor(url, options) {
    super(
      options?.status !== void 0 ? `Request to ${url} failed with status ${options.status}` : `Network error fetching ${url}`,
      url,
      options
    );
  }
};
var DataFormatError = class extends DataControllerError {
  constructor(url, options) {
    super(`Could not parse data from ${url}`, url, options);
  }
};
function classifyReadError(url, error, hints) {
  if (error instanceof DataControllerError) return error;
  const status = hints?.status ?? numericStatus(error);
  if (status !== void 0) {
    if (status === 404 || status === 410) return new NotFoundError(url, { status, cause: error });
    if (status === 401 || status === 403)
      return new AccessDeniedError(url, { status, cause: error });
    if (status >= 200 && status < 300) return new DataFormatError(url, { status, cause: error });
    return new NetworkError(url, { status, cause: error });
  }
  if (hints?.parsed === false) return new DataFormatError(url, { cause: error });
  return new NetworkError(url, { cause: error });
}
function numericStatus(error) {
  for (const candidate of [error, error?.cause]) {
    if (candidate && typeof candidate === "object" && "status" in candidate) {
      const s4 = candidate.status;
      if (typeof s4 === "number" && Number.isFinite(s4)) return s4;
    }
  }
  return void 0;
}

// src/data-controller.ts
var LDP_CONTAINS = "http://www.w3.org/ns/ldp#contains";
var RDF_TYPE2 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
var LDP_CONTAINER2 = "http://www.w3.org/ns/ldp#Container";
var LDP_BASIC_CONTAINER2 = "http://www.w3.org/ns/ldp#BasicContainer";
var RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9";
var DataController = class {
  #fetch;
  /** The injected credential-free fetch, or `undefined` (a public read fails closed). */
  #publicFetch;
  constructor(seam = {}) {
    this.#fetch = seam.fetch ?? globalThis.fetch.bind(globalThis);
    this.#publicFetch = seam.publicFetch;
  }
  /** The authenticated fetch this controller reads the user's own origin with. */
  get fetch() {
    return this.#fetch;
  }
  /**
   * The injected credential-free fetch for public reads, or `undefined` when none
   * was supplied (a `{ public: true }` read then fails closed).
   */
  get publicFetch() {
    return this.#publicFetch;
  }
  /**
   * Read one RDF resource into an N3 Store, classifying any failure onto the
   * 4-class taxonomy. Honours a conditional `If-None-Match` (the `etag` option):
   * a `304` resolves to `{ notModified: true }` with no dataset.
   *
   * A `{ public: true }` read REQUIRES an injected `publicFetch` (the credential
   * boundary is fail-closed) — without one it throws a {@link NetworkError} rather
   * than risk using the authenticated fetch.
   *
   * @throws {@link DataControllerError} — exactly one of NotFound / AccessDenied /
   *   Network / DataFormat. Never throws a raw `Response` or fetch error.
   */
  async read(url, options = {}) {
    let doFetch;
    if (options.public) {
      if (!this.#publicFetch) {
        throw new NetworkError(url, {
          cause: new Error(
            "A { public: true } read requires an injected `publicFetch` (a credential-free fetch). The DataController never falls back to the authenticated fetch for a public read."
          )
        });
      }
      doFetch = this.#publicFetch;
    } else {
      doFetch = this.#fetch;
    }
    const headers = {
      ...options.headers,
      Accept: RDF_ACCEPT
    };
    if (options.etag) headers["If-None-Match"] = options.etag;
    let response;
    try {
      response = await doFetch(url, {
        method: "GET",
        headers,
        ...options.signal ? { signal: options.signal } : {}
      });
    } catch (cause) {
      throw classifyReadError(url, cause);
    }
    const finalUrl = response.url || url;
    if (response.status === 304) {
      return { url: finalUrl, notModified: true, ...etagOf(response) };
    }
    if (!response.ok) {
      throw statusError(finalUrl, response.status);
    }
    let dataset2;
    try {
      const contentType = response.headers.get("Content-Type");
      const body = response.body ?? await response.text();
      dataset2 = await parseToStore(body, contentType, { baseIRI: finalUrl });
    } catch (cause) {
      throw classifyReadError(finalUrl, cause, { status: response.status, parsed: false });
    }
    return { url: finalUrl, dataset: dataset2, notModified: false, ...etagOf(response) };
  }
  /**
   * List an LDP container: read its RDF then collect every `ldp:contains` child.
   * Each child's `isContainer` is derived from an `rdf:type` of `ldp:Container` /
   * `ldp:BasicContainer` IF that triple is present in the container's own graph
   * (CSS/ESS commonly include it), else from a trailing-slash heuristic.
   *
   * @throws {@link DataControllerError} as {@link DataController.read} does.
   */
  async listContainer(url, options = {}) {
    const result = await this.read(url, options);
    if (!result.dataset) {
      throw new NetworkError(result.url, {
        cause: new Error("listContainer unexpectedly received a 304 (no etag was sent)")
      });
    }
    return {
      url: result.url,
      children: childrenOf(result.dataset, result.url),
      dataset: result.dataset,
      ...result.etag ? { etag: result.etag } : {}
    };
  }
};
function etagOf(response) {
  const etag = response.headers.get("ETag");
  return etag ? { etag } : {};
}
function statusError(url, status) {
  if (status === 404 || status === 410) return new NotFoundError(url, { status });
  if (status === 401 || status === 403) return new AccessDeniedError(url, { status });
  return new NetworkError(url, { status });
}
function childrenOf(dataset2, containerUrl) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const quad4 of iterContains(dataset2)) {
    const childUrl = quad4.object.value;
    if (quad4.subject.value !== containerUrl) continue;
    if (seen.has(childUrl)) continue;
    seen.add(childUrl);
    out.push({ url: childUrl, isContainer: isContainerChild(dataset2, quad4.object, childUrl) });
  }
  return out;
}
function iterContains(dataset2) {
  return dataset2.getQuads(null, namedNode3(LDP_CONTAINS), null, null);
}
function isContainerChild(dataset2, child, childUrl) {
  for (const t5 of dataset2.getQuads(child, namedNode3(RDF_TYPE2), null, null)) {
    const typeValue = t5.object.value;
    if (typeValue === LDP_CONTAINER2 || typeValue === LDP_BASIC_CONTAINER2) return true;
  }
  return childUrl.endsWith("/");
}
function namedNode3(value) {
  return { termType: "NamedNode", value, equals: termEquals };
}
function termEquals(other) {
  return other != null && typeof other === "object" && other.termType === this.termType && other.value === this.value;
}

// src/components/shared.ts
var BASE_INPUT_PROPS = ["src", "fetch", "publicFetch", "publicRead"];
var AbstractReadElement = class extends i4 {
  /** A monotonically increasing token to drop the result of a superseded read. */
  #readToken = 0;
  static properties = {
    src: {},
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    publicRead: { type: Boolean, attribute: "public-read" },
    store: { attribute: false },
    status: { state: true },
    errorMessage: { state: true },
    graph: { state: true },
    baseUrl: { state: true }
  };
  constructor() {
    super();
    this.src = void 0;
    this.fetch = void 0;
    this.publicFetch = void 0;
    this.publicRead = false;
    this.store = void 0;
    this.status = "idle";
    this.errorMessage = "";
    this.graph = void 0;
    this.baseUrl = void 0;
  }
  /** Render into the light DOM so a consuming app can `::part`/style the output. */
  createRenderRoot() {
    return this;
  }
  /** The input prop names this element re-reads on. Override to extend the base set. */
  inputProps() {
    return BASE_INPUT_PROPS;
  }
  willUpdate(changed) {
    const changedKeys = changed;
    if (changedKeys.has("store")) {
      void this.#applyDirectStore();
      return;
    }
    if (this.inputProps().some((k4) => changedKeys.has(k4))) {
      void this.#read();
    }
  }
  /** Render the directly-set `store` (no network), or fall back to idle when cleared. */
  async #applyDirectStore() {
    const token2 = ++this.#readToken;
    const ds = this.store;
    if (!ds) {
      this.graph = void 0;
      this.baseUrl = void 0;
      this.status = this.src ? this.status : "idle";
      if (this.src) void this.#read();
      return;
    }
    this.graph = ds;
    this.baseUrl = this.src ?? "";
    this.errorMessage = "";
    if (token2 === this.#readToken) this.status = "ready";
  }
  /** Read `src` through a DataController, classify any failure, drop a superseded result. */
  async #read() {
    const token2 = ++this.#readToken;
    if (this.store) return;
    const src = this.src;
    if (!src) {
      this.graph = void 0;
      this.baseUrl = void 0;
      this.errorMessage = "";
      this.status = "idle";
      return;
    }
    this.status = "loading";
    this.errorMessage = "";
    const seam = {
      ...this.fetch ? { fetch: this.fetch } : {},
      ...this.publicFetch ? { publicFetch: this.publicFetch } : {}
    };
    const controller = new DataController(seam);
    try {
      const { graph, baseUrl } = await this.loadFrom(controller, src, this.publicRead);
      if (token2 !== this.#readToken) return;
      this.graph = graph;
      this.baseUrl = baseUrl;
      this.status = "ready";
    } catch (error) {
      if (token2 !== this.#readToken) return;
      this.graph = void 0;
      this.baseUrl = void 0;
      this.errorMessage = errorMessageOf(error);
      this.status = "error";
    }
  }
  render() {
    switch (this.status) {
      case "idle":
        return b2`<slot name="empty"><p part="empty">Nothing to display.</p></slot>`;
      case "loading":
        return b2`<slot name="loading"><p part="loading">Loading…</p></slot>`;
      case "error":
        return b2`<p part="error" role="alert">${this.errorMessage}</p>`;
      default:
        return this.graph !== void 0 && this.baseUrl !== void 0 ? this.renderReady(this.graph, this.baseUrl) : b2`<slot name="empty"><p part="empty">Nothing to display.</p></slot>`;
    }
  }
};
function errorMessageOf(error) {
  if (error instanceof DataControllerError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
function safeHref(value) {
  if (!value) return void 0;
  try {
    const u3 = new URL(value);
    return u3.protocol === "https:" || u3.protocol === "http:" ? value : void 0;
  } catch {
    return void 0;
  }
}
function safeMailto(value) {
  return value && /^mailto:[^\s]+@?[^\s]*$/i.test(value) ? value : void 0;
}
function safeTel(value) {
  return value && /^tel:[^\s]+$/i.test(value) ? value : void 0;
}
function stripScheme(value) {
  return value.replace(/^(mailto:|tel:)/i, "");
}
function formatDate(date2) {
  if (!date2) return "";
  try {
    return date2.toLocaleDateString();
  } catch {
    return "";
  }
}

// node_modules/@rdfjs/wrapper/dist/TermWrapper.js
var TermWrapper = class {
  original;
  _dataset;
  _factory;
  constructor(term, dataset2, factory2) {
    this.original = typeof term === "string" ? factory2.namedNode(term) : term;
    this._dataset = dataset2;
    this._factory = factory2;
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
    const i5 = Number.parseInt(property);
    target.fill(value, i5, i5 + 1);
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
var RDF2 = {
  langString: "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
  type: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
  first: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
  rest: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
  nil: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil"
};

// node_modules/@rdfjs/wrapper/dist/mapping/TermFrom.js
var TermFrom;
(function(TermFrom2) {
  function instance(value, factory2) {
    return itself(value, factory2);
  }
  TermFrom2.instance = instance;
  function itself(value, _3) {
    return value;
  }
  TermFrom2.itself = itself;
})(TermFrom || (TermFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/RequiredFrom.js
var RequiredFrom;
(function(RequiredFrom2) {
  function subjectPredicate(anchor1, p4, termAs) {
    if (termAs === void 0) {
      throw new Error();
    }
    const anchor2 = anchor1.factory.namedNode(p4);
    const matches = anchor1.dataset.match(anchor1, anchor2)[Symbol.iterator]();
    const { value: first, done: none } = matches.next();
    if (none) {
      throw new Error(`No value found for predicate ${p4} on term ${anchor1.value}`);
    }
    if (!matches.next().done) {
      throw new Error(`More than one value for predicate ${p4} on term ${anchor1.value}`);
    }
    return termAs(new TermWrapper(first.object, anchor1.dataset, anchor1.factory));
  }
  RequiredFrom2.subjectPredicate = subjectPredicate;
})(RequiredFrom || (RequiredFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/OptionalFrom.js
var OptionalFrom;
(function(OptionalFrom2) {
  function subjectPredicate(anchor, p4, termAs) {
    if (termAs === void 0) {
      throw new Error();
    }
    const predicate = anchor.factory.namedNode(p4);
    for (const q3 of anchor.dataset.match(anchor, predicate)) {
      return termAs(new TermWrapper(q3.object, anchor.dataset, anchor.factory));
    }
    return void 0;
  }
  OptionalFrom2.subjectPredicate = subjectPredicate;
})(OptionalFrom || (OptionalFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/OptionalAs.js
var OptionalAs;
(function(OptionalAs2) {
  function object(anchor, p4, value, termFrom) {
    if (termFrom === void 0) {
      throw new Error();
    }
    const predicate = anchor.factory.namedNode(p4);
    for (const q4 of anchor.dataset.match(anchor, predicate)) {
      anchor.dataset.delete(q4);
    }
    if (value === void 0) {
      return;
    }
    if (!isQuadSubject(anchor)) {
      return;
    }
    const o6 = termFrom(value, anchor.factory);
    if (o6 === void 0) {
      return;
    }
    if (!isQuadObject(o6)) {
      return;
    }
    const q3 = anchor.factory.quad(anchor, predicate, o6);
    anchor.dataset.add(q3);
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
  function object(anchor, p4, value, termFrom) {
    if (value === void 0) {
      throw new Error("value cannot be undefined");
    }
    OptionalAs.object(anchor, p4, value, termFrom);
  }
  RequiredAs2.object = object;
})(RequiredAs || (RequiredAs = {}));

// node_modules/@rdfjs/wrapper/dist/ListItem.js
var ListItem = class _ListItem extends TermWrapper {
  termAs;
  termFrom;
  constructor(term, dataset2, factory2, termAs, termFrom) {
    super(term, dataset2, factory2);
    this.termAs = termAs;
    this.termFrom = termFrom;
  }
  get firstRaw() {
    return OptionalFrom.subjectPredicate(this, RDF2.first, TermAs.term);
  }
  set firstRaw(value) {
    OptionalAs.object(this, RDF2.first, value, TermFrom.itself);
  }
  get restRaw() {
    return OptionalFrom.subjectPredicate(this, RDF2.rest, TermAs.term);
  }
  set restRaw(value) {
    OptionalAs.object(this, RDF2.rest, value, TermFrom.itself);
  }
  get isListItem() {
    return this.firstRaw !== void 0 && this.restRaw !== void 0;
  }
  get isNil() {
    return this.equals(this.factory.namedNode(RDF2.nil));
  }
  get first() {
    return RequiredFrom.subjectPredicate(this, RDF2.first, this.termAs);
  }
  set first(value) {
    RequiredAs.object(this, RDF2.first, value, this.termFrom);
  }
  get rest() {
    return RequiredFrom.subjectPredicate(this, RDF2.rest, (w4) => new _ListItem(w4, w4.dataset, w4.factory, this.termAs, this.termFrom));
  }
  set rest(value) {
    RequiredAs.object(this, RDF2.rest, value, TermFrom.instance);
  }
  pop() {
    try {
      return this.first;
    } finally {
      this.firstRaw = void 0;
      this.restRaw = this.factory.namedNode(RDF2.nil);
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
  constructor(subject, p4) {
    super(subject, subject.dataset, subject.factory);
    this.p = p4;
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
  set length(_3) {
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
    const nil = this.subject.factory.namedNode(RDF2.nil);
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
  constructor(literal4, datatypes, cause) {
    super(literal4, `Datatype must be one of ${[...datatypes].join()} but was ${literal4.datatype}`, cause);
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
  if (term.termType === "NamedNode" && term.value === RDF2.nil) {
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
var XSD2 = {
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
  function boolean2(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, XSD2.boolean);
    return term.value === "true" || term.value === "1";
  }
  LiteralAs2.boolean = boolean2;
  function date2(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, ...dateDatatypes);
    return new Date(term.value);
  }
  LiteralAs2.date = date2;
  function langString(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, RDF2.langString);
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
  function string2(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    return term.value;
  }
  LiteralAs2.string = string2;
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
      case XSD2.hexBinary:
        return Uint8Array.from(Buffer.from(term.value, "hex"));
      default:
      case XSD2.base64Binary:
        return Uint8Array.from(Buffer.from(term.value, "base64"));
    }
  }
  LiteralAs2.uInt8Array = uInt8Array;
  function url(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, XSD2.anyURI);
    return new URL(term.value);
  }
  LiteralAs2.url = url;
  function langTuple(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, RDF2.langString);
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
  XSD2.base64Binary,
  XSD2.hexBinary
];
var integerDatatypes = [
  XSD2.integer,
  XSD2.nonPositiveInteger,
  XSD2.long,
  XSD2.nonNegativeInteger,
  XSD2.negativeInteger,
  XSD2.int,
  XSD2.unsignedLong,
  XSD2.positiveInteger,
  XSD2.short,
  XSD2.unsignedInt,
  XSD2.byte,
  XSD2.unsignedShort,
  XSD2.unsignedByte
];
var numericDatatypes = integerDatatypes.concat([
  XSD2.decimal,
  XSD2.float,
  XSD2.double
]);
var dateDatatypes = [
  XSD2.date,
  XSD2.dateTime
];

// node_modules/@rdfjs/wrapper/dist/mapping/LiteralFrom.js
var LiteralFrom;
(function(LiteralFrom2) {
  function anyUriString(value, factory2) {
    return factory2.literal(value, factory2.namedNode(XSD2.anyURI));
  }
  LiteralFrom2.anyUriString = anyUriString;
  function anyUriUrl(value, factory2) {
    return anyUriString(value.toString(), factory2);
  }
  LiteralFrom2.anyUriUrl = anyUriUrl;
  function base64(value, factory2) {
    return factory2.literal(value.toBase64(), factory2.namedNode(XSD2.base64Binary));
  }
  LiteralFrom2.base64 = base64;
  function boolean2(value, factory2) {
    return factory2.literal(value.toString(), factory2.namedNode(XSD2.boolean));
  }
  LiteralFrom2.boolean = boolean2;
  function date2(value, factory2) {
    return factory2.literal(value.toISOString(), factory2.namedNode(XSD2.date));
  }
  LiteralFrom2.date = date2;
  function dateTime2(value, factory2) {
    return factory2.literal(value.toISOString(), factory2.namedNode(XSD2.dateTime));
  }
  LiteralFrom2.dateTime = dateTime2;
  function double2(value, factory2) {
    return factory2.literal(value.toString(), factory2.namedNode(XSD2.double));
  }
  LiteralFrom2.double = double2;
  function integer2(value, factory2) {
    return factory2.literal(value.toString(), factory2.namedNode(XSD2.integer));
  }
  LiteralFrom2.integer = integer2;
  function hex(value, factory2) {
    return factory2.literal(value.toHex(), factory2.namedNode(XSD2.hexBinary));
  }
  LiteralFrom2.hex = hex;
  function langString(value, factory2) {
    return factory2.literal(value.string, { language: value.lang });
  }
  LiteralFrom2.langString = langString;
  function string2(value, factory2) {
    return factory2.literal(value);
  }
  LiteralFrom2.string = string2;
  function langTuple([key, value], factory2) {
    return factory2.literal(value, key);
  }
  LiteralFrom2.langTuple = langTuple;
  function datatypeTuple([key, value], factory2) {
    return factory2.literal(value, factory2.namedNode(key));
  }
  LiteralFrom2.datatypeTuple = datatypeTuple;
})(LiteralFrom || (LiteralFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/NamedNodeFrom.js
var NamedNodeFrom;
(function(NamedNodeFrom2) {
  function string2(value, factory2) {
    return factory2.namedNode(value);
  }
  NamedNodeFrom2.string = string2;
  function url(value, factory2) {
    return string2(value.toString(), factory2);
  }
  NamedNodeFrom2.url = url;
})(NamedNodeFrom || (NamedNodeFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/NamedNodeAs.js
var NamedNodeAs;
(function(NamedNodeAs2) {
  function string2(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "NamedNode");
    return term.value;
  }
  NamedNodeAs2.string = string2;
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
  function string2(value, factory2) {
    return factory2.blankNode(value);
  }
  BlankNodeFrom2.string = string2;
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
    for (const q3 of this.matches) {
      this.subject.dataset.delete(q3);
    }
  }
  delete(k4) {
    const p4 = this.subject.factory.namedNode(this.predicate);
    for (const entry of this) {
      if (entry[0] !== k4) {
        continue;
      }
      this.subject.dataset.delete(this.subject.factory.quad(this.subject, p4, this.termFrom(entry, this.subject.factory)));
      return true;
    }
    return false;
  }
  forEach(callback, thisArg) {
    for (const [key, value] of this) {
      callback.call(thisArg, value, key, this);
    }
  }
  get(k4) {
    for (const [key, value] of this) {
      if (key !== k4) {
        continue;
      }
      return value;
    }
    return void 0;
  }
  has(k4) {
    return this.get(k4) !== void 0;
  }
  set(k4, v5) {
    this.delete(k4);
    this.add(k4, v5);
    return this;
  }
  get size() {
    return [...this.matches].length;
  }
  set size(_3) {
    throw new Error("not supported");
  }
  *entries() {
    for (const quad4 of this.matches) {
      yield this.termAs(new TermWrapper(quad4.object, this.subject.dataset, this.subject.factory));
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
    const p4 = this.subject.factory.namedNode(this.predicate);
    return this.subject.dataset.match(this.subject, p4);
  }
  add(k4, v5) {
    const p4 = this.subject.factory.namedNode(this.predicate);
    this.subject.dataset.add(this.subject.factory.quad(this.subject, p4, this.termFrom([k4, v5], this.subject.factory)));
  }
};

// node_modules/@rdfjs/wrapper/dist/mapping/Mapping.js
var Mapping;
(function(Mapping2) {
  function languageDictionary(anchor, p4, termAs, termFrom) {
    if (termAs === void 0) {
      throw new Error();
    }
    if (termFrom === void 0) {
      throw new Error();
    }
    return new WrappingMap(anchor, p4, termAs, termFrom);
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
    for (const q3 of this.matches) {
      this.subject.dataset.delete(q3);
    }
  }
  delete(value) {
    if (!this.has(value)) {
      return false;
    }
    const o6 = this.termFrom(value, this.subject.factory);
    const p4 = this.subject.factory.namedNode(this.predicate);
    for (const q3 of this.subject.dataset.match(this.subject, p4, o6)) {
      this.subject.dataset.delete(q3);
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
    for (const v5 of this) {
      yield [v5, v5];
    }
  }
  keys() {
    return this.values();
  }
  *values() {
    for (const q3 of this.matches) {
      yield this.termAs(new TermWrapper(q3.object, this.subject.dataset, this.subject.factory));
    }
  }
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
  quad(value) {
    const s4 = this.subject;
    const p4 = this.subject.factory.namedNode(this.predicate);
    const o6 = this.termFrom(value, this.subject.factory);
    const q3 = this.subject.factory.quad(s4, p4, o6);
    return q3;
  }
  get matches() {
    const p4 = this.subject.factory.namedNode(this.predicate);
    return this.subject.dataset.match(this.subject, p4);
  }
};

// node_modules/@rdfjs/wrapper/dist/mapping/SetFrom.js
var SetFrom;
(function(SetFrom2) {
  function subjectPredicate(anchor, p4, termAs, termFrom) {
    if (termAs === void 0) {
      throw new Error();
    }
    if (termFrom === void 0) {
      throw new Error();
    }
    return new WrappingSet(anchor, p4, termAs, termFrom);
  }
  SetFrom2.subjectPredicate = subjectPredicate;
})(SetFrom || (SetFrom = {}));

// node_modules/@jeswr/solid-chat-interop/node_modules/n3/src/IRIs.js
var RDF3 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var XSD3 = "http://www.w3.org/2001/XMLSchema#";
var SWAP2 = "http://www.w3.org/2000/10/swap/";
var IRIs_default2 = {
  xsd: {
    decimal: `${XSD3}decimal`,
    boolean: `${XSD3}boolean`,
    double: `${XSD3}double`,
    integer: `${XSD3}integer`,
    string: `${XSD3}string`
  },
  rdf: {
    type: `${RDF3}type`,
    nil: `${RDF3}nil`,
    first: `${RDF3}first`,
    rest: `${RDF3}rest`,
    langString: `${RDF3}langString`,
    dirLangString: `${RDF3}dirLangString`,
    reifies: `${RDF3}reifies`
  },
  owl: {
    sameAs: "http://www.w3.org/2002/07/owl#sameAs"
  },
  r: {
    forSome: `${SWAP2}reify#forSome`,
    forAll: `${SWAP2}reify#forAll`
  },
  log: {
    implies: `${SWAP2}log#implies`,
    isImpliedBy: `${SWAP2}log#isImpliedBy`
  }
};

// node_modules/@jeswr/solid-chat-interop/node_modules/n3/src/N3DataFactory.js
var { rdf: rdf4, xsd: xsd6 } = IRIs_default2;
var DEFAULTGRAPH3;
var _blankNodeCounter2 = 0;
var DataFactory3 = {
  namedNode: namedNode4,
  blankNode: blankNode3,
  variable: variable3,
  literal: literal3,
  defaultGraph: defaultGraph3,
  quad: quad3,
  triple: quad3,
  fromTerm: fromTerm3,
  fromQuad: fromQuad2
};
var N3DataFactory_default2 = DataFactory3;
var Term2 = class _Term {
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
var NamedNode3 = class extends Term2 {
  // ### The term type of this term
  get termType() {
    return "NamedNode";
  }
};
var Literal3 = class _Literal extends Term2 {
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
    return new NamedNode3(this.datatypeString);
  }
  // ### The datatype string of this literal
  get datatypeString() {
    const id = this.id, dtPos = id.lastIndexOf('"') + 1;
    const char = dtPos < id.length ? id[dtPos] : "";
    return char === "^" ? id.substr(dtPos + 2) : (
      // If "@" follows, return rdf:langString or rdf:dirLangString; xsd:string otherwise
      char !== "@" ? xsd6.string : id.indexOf("--", dtPos) > 0 ? rdf4.dirLangString : rdf4.langString
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
var BlankNode3 = class extends Term2 {
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
var Variable3 = class extends Term2 {
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
var DefaultGraph3 = class extends Term2 {
  constructor() {
    super("");
    return DEFAULTGRAPH3 || this;
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
DEFAULTGRAPH3 = new DefaultGraph3();
var Quad3 = class extends Term2 {
  constructor(subject, predicate, object, graph) {
    super("");
    this._subject = subject;
    this._predicate = predicate;
    this._object = object;
    this._graph = graph || DEFAULTGRAPH3;
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
function namedNode4(iri) {
  return new NamedNode3(iri);
}
function blankNode3(name) {
  return new BlankNode3(name || `n3-${_blankNodeCounter2++}`);
}
function literal3(value, languageOrDataType) {
  if (typeof languageOrDataType === "string")
    return new Literal3(`"${value}"@${languageOrDataType.toLowerCase()}`);
  if (languageOrDataType !== void 0 && !("termType" in languageOrDataType)) {
    return new Literal3(`"${value}"@${languageOrDataType.language.toLowerCase()}${languageOrDataType.direction ? `--${languageOrDataType.direction.toLowerCase()}` : ""}`);
  }
  let datatype = languageOrDataType ? languageOrDataType.value : "";
  if (datatype === "") {
    if (typeof value === "boolean")
      datatype = xsd6.boolean;
    else if (typeof value === "number") {
      if (Number.isFinite(value))
        datatype = Number.isInteger(value) ? xsd6.integer : xsd6.double;
      else {
        datatype = xsd6.double;
        if (!Number.isNaN(value))
          value = value > 0 ? "INF" : "-INF";
      }
    }
  }
  return datatype === "" || datatype === xsd6.string ? new Literal3(`"${value}"`) : new Literal3(`"${value}"^^${datatype}`);
}
function variable3(name) {
  return new Variable3(name);
}
function defaultGraph3() {
  return DEFAULTGRAPH3;
}
function quad3(subject, predicate, object, graph) {
  return new Quad3(subject, predicate, object, graph);
}
function fromTerm3(term) {
  if (term instanceof Term2)
    return term;
  switch (term.termType) {
    case "NamedNode":
      return namedNode4(term.value);
    case "BlankNode":
      return blankNode3(term.value);
    case "Variable":
      return variable3(term.value);
    case "DefaultGraph":
      return DEFAULTGRAPH3;
    case "Literal":
      return literal3(term.value, term.language || term.datatype);
    case "Quad":
      return fromQuad2(term);
    default:
      throw new Error(`Unexpected termType: ${term.termType}`);
  }
}
function fromQuad2(inQuad) {
  if (inQuad instanceof Quad3)
    return inQuad;
  if (inQuad.termType !== "Quad")
    throw new Error(`Unexpected termType: ${inQuad.termType}`);
  return quad3(fromTerm3(inQuad.subject), fromTerm3(inQuad.predicate), fromTerm3(inQuad.object), fromTerm3(inQuad.graph));
}

// node_modules/@jeswr/solid-chat-interop/dist/iri.js
function isHttpIri(value) {
  if (!value)
    return false;
  try {
    const u3 = new URL(value);
    return u3.protocol === "http:" || u3.protocol === "https:";
  } catch {
    return false;
  }
}
function httpIriOrUndefined(value) {
  return isHttpIri(value) ? value : void 0;
}
function toIsoOrUndefined(d4) {
  return d4 !== void 0 && !Number.isNaN(d4.getTime()) ? d4.toISOString() : void 0;
}
function tryRead(read) {
  try {
    return read();
  } catch {
    return void 0;
  }
}
function readIsoDate(read) {
  return toIsoOrUndefined(tryRead(read));
}

// node_modules/@jeswr/solid-task-model/dist/vocab.js
var WF = "http://www.w3.org/2005/01/wf/flow#";
var DCT = "http://purl.org/dc/terms/";
var RDF4 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var SCHEMA = "http://schema.org/";
var PROV = "http://www.w3.org/ns/prov#";
var VCARD = "http://www.w3.org/2006/vcard/ns#";
var wf = (local) => `${WF}${local}`;
var dct = (local) => `${DCT}${local}`;
var rdf5 = (local) => `${RDF4}${local}`;
var schema = (local) => `${SCHEMA}${local}`;
var prov = (local) => `${PROV}${local}`;
var vcard = (local) => `${VCARD}${local}`;
var TASK_CLASS2 = wf("Task");
var WF_OPEN = wf("Open");
var WF_CLOSED = wf("Closed");
var RDF_TYPE3 = rdf5("type");
var WF_TRACKER = wf("Tracker");
var WF_ISSUE_CLASS = wf("issueClass");
var WF_ISSUE_CATEGORY = wf("issueCategory");
var WF_STATE = wf("State");
var WF_INITIAL_STATE = wf("initialState");
var WF_ALLOWED_TRANS = wf("allowedTransitions");
var WF_STATE_STORE = wf("stateStore");
var WF_ASSIGNEE_GROUP = wf("assigneeGroup");
var VCARD_ADDRESS_BOOK2 = vcard("AddressBook");
var VCARD_NAME_EMAIL_INDEX = vcard("nameEmailIndex");
var VCARD_GROUP_INDEX = vcard("groupIndex");
var VCARD_IN_ADDRESS_BOOK = vcard("inAddressBook");
var VCARD_INCLUDES_GROUP = vcard("includesGroup");
var VCARD_INDIVIDUAL2 = vcard("Individual");
var VCARD_GROUP = vcard("Group");
var VCARD_FN = vcard("fn");
var VCARD_HAS_EMAIL = vcard("hasEmail");
var VCARD_HAS_TELEPHONE = vcard("hasTelephone");
var VCARD_HAS_UID = vcard("hasUID");
var VCARD_URL = vcard("url");
var VCARD_NOTE = vcard("note");
var VCARD_ORGANIZATION_NAME = vcard("organization-name");
var VCARD_VALUE = vcard("value");
var VCARD_HAS_MEMBER = vcard("hasMember");
var VCARD_HOME = vcard("Home");
var VCARD_CELL = vcard("Cell");
var VCARD_WEB_ID = vcard("WebId");

// node_modules/@jeswr/solid-chat-interop/dist/vocab.js
var AS = "https://www.w3.org/ns/activitystreams#";
var PC = "https://w3id.org/jeswr/pod-chat#";
var SIOC = "http://rdfs.org/sioc/ns#";
var FOAF = "http://xmlns.com/foaf/0.1/";
var DCT2 = "http://purl.org/dc/terms/";
var SCHEMA2 = "http://schema.org/";
var PROV2 = "http://www.w3.org/ns/prov#";
var MEETING = "http://www.w3.org/ns/pim/meeting#";
var WF2 = "http://www.w3.org/2005/01/wf/flow#";
var RDF5 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var RDF_TYPE4 = `${RDF5}type`;
var AS_NOTE2 = `${AS}Note`;
var AS_COLLECTION = `${AS}Collection`;
var AS_PERSON = `${AS}Person`;
var AS_CONTENT = `${AS}content`;
var AS_MEDIA_TYPE = `${AS}mediaType`;
var AS_ATTRIBUTED_TO = `${AS}attributedTo`;
var AS_PUBLISHED = `${AS}published`;
var AS_CONTEXT = `${AS}context`;
var AS_IN_REPLY_TO = `${AS}inReplyTo`;
var AS_ITEMS = `${AS}items`;
var AS_NAME = `${AS}name`;
var PC_CHAT_ROOM = `${PC}ChatRoom`;
var SIOC_NOTE = `${SIOC}Note`;
var SIOC_CONTENT = `${SIOC}content`;
var SIOC_HAS_REPLY = `${SIOC}has_reply`;
var FOAF_MAKER = `${FOAF}maker`;
var MEETING_LONG_CHAT = `${MEETING}LongChat`;
var SCHEMA_MESSAGE = `${SCHEMA2}Message`;
var SCHEMA_DATE_DELETED = `${SCHEMA2}dateDeleted`;
var DCT_CREATED = `${DCT2}created`;
var DCT_CREATOR = `${DCT2}creator`;
var DCT_TITLE = `${DCT2}title`;
var DCT_IS_REPLACED_BY = `${DCT2}isReplacedBy`;
var PROV_WAS_ATTRIBUTED_TO = `${PROV2}wasAttributedTo`;
var PROV_WAS_GENERATED_BY = `${PROV2}wasGeneratedBy`;
var PROV_WAS_DERIVED_FROM = `${PROV2}wasDerivedFrom`;
var WF_ASSIGNEE = `${WF2}assignee`;
var DEFAULT_MEDIA_TYPE = "text/plain";

// node_modules/@jeswr/solid-chat-interop/dist/as2.js
var As2MessageDoc = class extends TermWrapper {
  get types() {
    return SetFrom.subjectPredicate(this, RDF_TYPE4, NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp the subject as an `as:Note`. */
  markNote() {
    this.types.add(AS_NOTE2);
    return this;
  }
  get content() {
    return OptionalFrom.subjectPredicate(this, AS_CONTENT, LiteralAs.string);
  }
  set content(v5) {
    OptionalAs.object(this, AS_CONTENT, v5, LiteralFrom.string);
  }
  get mediaType() {
    return OptionalFrom.subjectPredicate(this, AS_MEDIA_TYPE, LiteralAs.string);
  }
  set mediaType(v5) {
    OptionalAs.object(this, AS_MEDIA_TYPE, v5, LiteralFrom.string);
  }
  get author() {
    return OptionalFrom.subjectPredicate(this, AS_ATTRIBUTED_TO, NamedNodeAs.string);
  }
  set author(v5) {
    OptionalAs.object(this, AS_ATTRIBUTED_TO, v5, NamedNodeFrom.string);
  }
  get published() {
    return OptionalFrom.subjectPredicate(this, AS_PUBLISHED, LiteralAs.date);
  }
  set published(v5) {
    OptionalAs.object(this, AS_PUBLISHED, v5, LiteralFrom.dateTime);
  }
  get room() {
    return OptionalFrom.subjectPredicate(this, AS_CONTEXT, NamedNodeAs.string);
  }
  set room(v5) {
    OptionalAs.object(this, AS_CONTEXT, v5, NamedNodeFrom.string);
  }
  get inReplyTo() {
    return OptionalFrom.subjectPredicate(this, AS_IN_REPLY_TO, NamedNodeAs.string);
  }
  set inReplyTo(v5) {
    OptionalAs.object(this, AS_IN_REPLY_TO, v5, NamedNodeFrom.string);
  }
  get replacedBy() {
    return OptionalFrom.subjectPredicate(this, DCT_IS_REPLACED_BY, NamedNodeAs.string);
  }
  set replacedBy(v5) {
    OptionalAs.object(this, DCT_IS_REPLACED_BY, v5, NamedNodeFrom.string);
  }
  get deletedAt() {
    return OptionalFrom.subjectPredicate(this, SCHEMA_DATE_DELETED, LiteralAs.date);
  }
  set deletedAt(v5) {
    OptionalAs.object(this, SCHEMA_DATE_DELETED, v5, LiteralFrom.dateTime);
  }
  // --- PROV-O provenance (AI / external-source attribution) ---
  get provAttributedTo() {
    return OptionalFrom.subjectPredicate(this, PROV_WAS_ATTRIBUTED_TO, NamedNodeAs.string);
  }
  set provAttributedTo(v5) {
    OptionalAs.object(this, PROV_WAS_ATTRIBUTED_TO, v5, NamedNodeFrom.string);
  }
  get provGeneratedBy() {
    return OptionalFrom.subjectPredicate(this, PROV_WAS_GENERATED_BY, NamedNodeAs.string);
  }
  set provGeneratedBy(v5) {
    OptionalAs.object(this, PROV_WAS_GENERATED_BY, v5, NamedNodeFrom.string);
  }
  get provDerivedFrom() {
    return OptionalFrom.subjectPredicate(this, PROV_WAS_DERIVED_FROM, NamedNodeAs.string);
  }
  set provDerivedFrom(v5) {
    OptionalAs.object(this, PROV_WAS_DERIVED_FROM, v5, NamedNodeFrom.string);
  }
  // --- wf:Task overlay (the actionable facet, identical to pod-chat) ---
  get taskTitle() {
    return OptionalFrom.subjectPredicate(this, DCT_TITLE, LiteralAs.string);
  }
  set taskTitle(v5) {
    OptionalAs.object(this, DCT_TITLE, v5, LiteralFrom.string);
  }
  get assignee() {
    return OptionalFrom.subjectPredicate(this, WF_ASSIGNEE, NamedNodeAs.string);
  }
  set assignee(v5) {
    OptionalAs.object(this, WF_ASSIGNEE, v5, NamedNodeFrom.string);
  }
};
function readTypeSet(subject, dataset2) {
  const types = /* @__PURE__ */ new Set();
  for (const q3 of dataset2.match(N3DataFactory_default2.namedNode(subject), N3DataFactory_default2.namedNode(RDF_TYPE4), null)) {
    if (q3.object.termType === "NamedNode")
      types.add(q3.object.value);
  }
  return types;
}
function readTask(doc, types) {
  if (!types.has(TASK_CLASS2))
    return void 0;
  const state = types.has(WF_CLOSED) ? "closed" : "open";
  const task = { state };
  const title = tryRead(() => doc.taskTitle);
  if (title !== void 0)
    task.title = title;
  const assignee = httpIriOrUndefined(tryRead(() => doc.assignee));
  if (assignee !== void 0)
    task.assignee = assignee;
  return task;
}
function readProvenance(doc) {
  const attributedTo = httpIriOrUndefined(tryRead(() => doc.provAttributedTo));
  const generatedBy = httpIriOrUndefined(tryRead(() => doc.provGeneratedBy));
  const derivedFrom = httpIriOrUndefined(tryRead(() => doc.provDerivedFrom));
  if (attributedTo === void 0 && generatedBy === void 0 && derivedFrom === void 0) {
    return void 0;
  }
  const prov2 = {};
  if (attributedTo !== void 0)
    prov2.attributedTo = attributedTo;
  if (generatedBy !== void 0)
    prov2.generatedBy = generatedBy;
  if (derivedFrom !== void 0)
    prov2.derivedFrom = derivedFrom;
  return prov2;
}
function parseAs2Message(subject, dataset2) {
  const doc = new As2MessageDoc(subject, dataset2, N3DataFactory_default2);
  const types = readTypeSet(subject, dataset2);
  if (!types.has(AS_NOTE2))
    return void 0;
  const msg = {
    id: subject,
    content: tryRead(() => doc.content) ?? "",
    mediaType: tryRead(() => doc.mediaType) ?? DEFAULT_MEDIA_TYPE
  };
  const author = httpIriOrUndefined(tryRead(() => doc.author));
  if (author !== void 0)
    msg.author = author;
  const published = readIsoDate(() => doc.published);
  if (published !== void 0)
    msg.published = published;
  const room = httpIriOrUndefined(tryRead(() => doc.room));
  if (room !== void 0)
    msg.room = room;
  const inReplyTo = httpIriOrUndefined(tryRead(() => doc.inReplyTo));
  if (inReplyTo !== void 0)
    msg.inReplyTo = inReplyTo;
  const replacedBy = httpIriOrUndefined(tryRead(() => doc.replacedBy));
  if (replacedBy !== void 0)
    msg.replacedBy = replacedBy;
  const deletedAt = readIsoDate(() => doc.deletedAt);
  if (deletedAt !== void 0)
    msg.deletedAt = deletedAt;
  const provenance = readProvenance(doc);
  if (provenance !== void 0)
    msg.provenance = provenance;
  const task = readTask(doc, types);
  if (task !== void 0)
    msg.task = task;
  return msg;
}

// src/components/message-list.ts
var MAX_CHILDREN = 500;
var FETCH_CONCURRENCY = 6;
var JeswrMessageList = class extends AbstractReadElement {
  async loadFrom(controller, src, publicRead) {
    const listing = await controller.listContainer(src, publicRead ? { public: true } : {});
    const merged = new N3Store();
    addQuads(merged, listing.dataset);
    const children = listing.children.slice(0, MAX_CHILDREN);
    if (children.length > 0) {
      const childGraphs = await fetchChildGraphs(controller, children, publicRead);
      for (const g4 of childGraphs) addQuads(merged, g4);
    }
    return { graph: merged, baseUrl: listing.url };
  }
  renderReady(graph) {
    const messages = collectMessages(graph);
    if (messages.length === 0) {
      return b2`<slot name="empty"><p part="empty">No messages.</p></slot>`;
    }
    return b2`
      <ul part="list">
        ${messages.map((m3) => this.#renderMessage(m3))}
      </ul>
    `;
  }
  #renderMessage(message) {
    const authorHref = safeHref(message.author);
    const time2 = formatDateTime(message.published);
    return b2`
      <li part="message">
        ${message.author ? authorHref ? b2`<a part="author" href=${authorHref} rel="noopener noreferrer"
                  >${message.author}</a
                >` : b2`<span part="author">${message.author}</span>` : null}
        ${time2 ? b2`<time part="time" datetime=${message.published ?? ""}>${time2}</time>` : null}
        <!-- The message body is untrusted: Lit text interpolation escapes it (no
             unsafeHTML), so script/markup in the body renders as inert TEXT. -->
        <p part="content">${message.content}</p>
        ${message.inReplyTo ? b2`<small part="reply">In reply to a message</small>` : null}
      </li>
    `;
  }
};
async function fetchChildGraphs(controller, children, publicRead) {
  const graphs = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < children.length) {
      const child = children[cursor++];
      if (child.isContainer) continue;
      const graph = await readChild(controller, child.url, publicRead);
      if (graph) graphs.push(graph);
    }
  };
  const pool = Math.min(FETCH_CONCURRENCY, children.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
  return graphs;
}
async function readChild(controller, url, publicRead) {
  try {
    const result = await controller.read(url, publicRead ? { public: true } : {});
    return result.dataset;
  } catch {
    return void 0;
  }
}
function addQuads(into, from) {
  into.addQuads(from.getQuads(null, null, null, null));
}
function collectMessages(graph) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const quad4 of graph.getQuads(null, N3DataFactory_default.namedNode(RDF_TYPE), null, null)) {
    if (quad4.object.value !== AS_NOTE) continue;
    const subject = quad4.subject.value;
    if (seen.has(subject)) continue;
    seen.add(subject);
    const message = parseAs2Message(subject, graph);
    if (message === void 0) continue;
    out.push(message);
  }
  return sortByPublished(out);
}
function sortByPublished(messages) {
  return messages.map((m3, i5) => ({ m: m3, i: i5, t: publishedMillis(m3.published) })).sort((a3, b5) => a3.t - b5.t || a3.i - b5.i).map((x3) => x3.m);
}
function publishedMillis(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}
function formatDateTime(iso) {
  if (!iso) return "";
  const date2 = new Date(iso);
  if (Number.isNaN(date2.getTime())) return "";
  try {
    return date2.toLocaleString();
  } catch {
    return "";
  }
}
if (!customElements.get("jeswr-message-list")) {
  customElements.define("jeswr-message-list", JeswrMessageList);
}

// src/components/shacl-form-edit.ts
var ALLOWED_DATASET_KEYS2 = /* @__PURE__ */ new Set([
  // NOTE: NO "view" key here — its ABSENCE is what makes shacl-form editable.
  "ignoreOwlImports",
  "shapes",
  "values",
  "shapeSubject",
  "valuesSubject"
]);
var INPUT_PROPS2 = ["shapes", "values", "shapeSubject", "fetch", "publicFetch", "resolveOptions"];
var JeswrShaclForm = class extends i4 {
  static properties = {
    shapes: { attribute: false },
    values: { attribute: false },
    shapeSubject: { attribute: "shape-subject" },
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    resolveOptions: { attribute: false },
    mergeSave: { attribute: false },
    showSaveButton: { type: Boolean, attribute: "show-save-button" },
    status: { state: true },
    saveStatus: { state: true },
    errorMessage: { state: true },
    saveErrorMessage: { state: true },
    validationWarning: { state: true },
    shapesTurtle: { state: true },
    valuesTurtle: { state: true }
  };
  /** A monotonically increasing token to drop the result of a superseded resolve. */
  #renderToken = 0;
  /** A monotonically increasing token so a stale save can't flip a newer one's state. */
  #saveToken = 0;
  constructor() {
    super();
    this.shapes = void 0;
    this.values = void 0;
    this.shapeSubject = void 0;
    this.fetch = void 0;
    this.publicFetch = void 0;
    this.resolveOptions = void 0;
    this.mergeSave = void 0;
    this.showSaveButton = true;
    this.status = "idle";
    this.saveStatus = "idle";
    this.errorMessage = "";
    this.saveErrorMessage = "";
    this.validationWarning = "";
    this.shapesTurtle = "";
    this.valuesTurtle = "";
  }
  /** Light DOM so a consuming app can `::part`/style the inner form. */
  createRenderRoot() {
    return this;
  }
  willUpdate(changed) {
    const changedKeys = changed;
    if (INPUT_PROPS2.some((k4) => changedKeys.has(k4))) {
      void this.#resolve();
    }
  }
  /**
   * Pre-fetch + §9-harden both graphs through the SHARED pipeline (the SAME one the
   * read view uses). Fail-closed: empty shapes / any error → the error view with no
   * partially-applied inline graph, so a mounted <shacl-form> never sees bad input.
   */
  async #resolve() {
    const token2 = ++this.#renderToken;
    const shapes = this.shapes;
    const values = this.values;
    if (!shapes || !values) {
      this.shapesTurtle = "";
      this.valuesTurtle = "";
      this.errorMessage = "";
      this.status = "idle";
      return;
    }
    this.status = "loading";
    this.errorMessage = "";
    this.validationWarning = "";
    const seam = {
      fetch: this.fetch ?? globalThis.fetch.bind(globalThis),
      ...this.publicFetch ? { publicFetch: this.publicFetch } : {}
    };
    const opts = this.resolveOptions ?? {};
    const result = await resolveAndHarden(shapes, values, seam, opts);
    if (token2 !== this.#renderToken) return;
    if (result.kind === "ready") {
      this.shapesTurtle = result.shapesTurtle;
      this.valuesTurtle = result.valuesTurtle;
      this.status = "ready";
      return;
    }
    this.shapesTurtle = "";
    this.valuesTurtle = "";
    this.errorMessage = result.message;
    this.status = "error";
  }
  /**
   * SAVE — the §10 merge write. Reads the edited graph from shacl-form (`toRDF()` —
   * only the shaped node's triples), runs an ADVISORY client validation (warn,
   * never block), then delegates the actual write to {@link JeswrShaclForm.mergeSave}
   * (the per-class forms wire a DataWriter §10 merge). Optimistic state:
   * saving → saved on success, → error + a surfaced message on failure (revert).
   *
   * @returns `true` on a successful save, `false` on failure (the error is on the
   *   element's status + the `jeswr-save-error` event).
   * @throws if there is no mounted form, or no `mergeSave` callback (the base element
   *   refuses to do a naive write — that would drop triples / break dual-predicate).
   */
  async save() {
    const form = this.querySelector("shacl-form");
    if (!form) {
      throw new Error("Cannot save: the editable form is not ready (no inner <shacl-form>).");
    }
    if (!this.mergeSave) {
      throw new Error(
        "Cannot save: no `mergeSave` callback is set. The editable form refuses a naive write (it would drop triples outside the shape + break dual-predicate compat). Use a per-class form (jeswr-task-form/\u2026) or set `.mergeSave` to a DataWriter \xA710 merge."
      );
    }
    const formGraph = form.toRDF();
    let conforms = true;
    try {
      const report = await form.validate(true);
      conforms = report.conforms;
      this.validationWarning = report.conforms ? "" : "Some fields don't satisfy the shape. Saving anyway (validation is advisory).";
    } catch {
      this.validationWarning = "";
    }
    const token2 = ++this.#saveToken;
    this.saveStatus = "saving";
    this.saveErrorMessage = "";
    try {
      await this.mergeSave(formGraph);
      if (token2 !== this.#saveToken) return true;
      this.saveStatus = "saved";
      this.#emit("jeswr-save", { formGraph, conforms });
      return true;
    } catch (error) {
      if (token2 !== this.#saveToken) return false;
      this.saveStatus = "error";
      this.saveErrorMessage = error instanceof Error ? error.message : String(error);
      this.#emit("jeswr-save-error", { error });
      return false;
    }
  }
  /** Fire a CustomEvent (composed so a consuming app outside the light DOM hears it). */
  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  render() {
    if (this.status === "idle") {
      return b2`<slot name="empty"><p part="empty">No shape or data to edit.</p></slot>`;
    }
    if (this.status === "loading") {
      return b2`<slot name="loading"><p part="loading">Loading…</p></slot>`;
    }
    if (this.status === "error") {
      return b2`<p part="error" role="alert">${this.errorMessage}</p>`;
    }
    return b2`
      <shacl-form
        part="form"
        data-ignore-owl-imports=""
        data-shapes=${this.shapesTurtle}
        data-values=${this.valuesTurtle}
        data-shape-subject=${this.shapeSubject ?? A}
      ></shacl-form>
      ${this.validationWarning ? b2`<p part="warning" role="status">${this.validationWarning}</p>` : null}
      ${this.#renderActions()}
    `;
  }
  /** The save button + the saving/saved/error indicator. */
  #renderActions() {
    if (!this.showSaveButton) {
      return this.saveStatus === "idle" ? null : this.#statusIndicator();
    }
    return b2`
      <div part="actions">
        <button
          part="save"
          type="button"
          ?disabled=${this.saveStatus === "saving"}
          @click=${() => void this.save()}
        >
          ${this.saveStatus === "saving" ? "Saving\u2026" : "Save"}
        </button>
        ${this.#statusIndicator()}
      </div>
    `;
  }
  /** The non-button saving/saved/error text (escaped — Lit text interpolation). */
  #statusIndicator() {
    if (this.saveStatus === "saved") {
      return b2`<span part="status" data-state="saved" role="status">Saved</span>`;
    }
    if (this.saveStatus === "error") {
      return b2`<span part="status" data-state="error" role="alert"
        >${this.saveErrorMessage || "Save failed"}</span
      >`;
    }
    if (this.saveStatus === "saving") {
      return b2`<span part="status" data-state="saving" role="status">Saving…</span>`;
    }
    return null;
  }
  /**
   * Belt-and-braces (identical to the view): after every render, REMOVE any `*-url`
   * dataset key or any key off the allow-list from the inner <shacl-form>, so a
   * future template edit can never silently re-introduce a fetch-URL surface. ALSO
   * asserts data-view is never set here (the edit form must stay editable).
   */
  updated(_changed) {
    const form = this.querySelector("shacl-form");
    if (!form) return;
    for (const key of Object.keys(form.dataset)) {
      const lower = key.toLowerCase();
      if (lower.endsWith("url") || key === "view" || !ALLOWED_DATASET_KEYS2.has(key)) {
        delete form.dataset[key];
      }
    }
  }
};
if (!customElements.get("jeswr-shacl-form")) {
  customElements.define("jeswr-shacl-form", JeswrShaclForm);
}

// src/data-writer.ts
var TURTLE = "text/turtle";
var RDF_ACCEPT2 = "text/turtle, application/ld+json;q=0.9";
var WriteScopeError = class _WriteScopeError extends Error {
  /** The offending target URL. */
  url;
  constructor(url, reason) {
    super(`Refusing to write ${url}: ${reason}`);
    this.name = "WriteScopeError";
    this.url = url;
    Object.setPrototypeOf(this, _WriteScopeError.prototype);
  }
};
var UnconditionalOverwriteError = class _UnconditionalOverwriteError extends Error {
  /** The resource URL the unconditional overwrite targeted. */
  url;
  constructor(url) {
    super(
      `Refusing an UNCONDITIONAL overwrite of ${url}: a write that replaces an existing resource requires an \`If-Match\` etag (the lost-update guard), or \`If-None-Match: "*"\` to create-if-absent. Pass the etag you read, or use saveMerged() which reads it for you.`
    );
    this.name = "UnconditionalOverwriteError";
    this.url = url;
    Object.setPrototypeOf(this, _UnconditionalOverwriteError.prototype);
  }
};
var WriteConflictError = class _WriteConflictError extends Error {
  /** The resource URL the conflicting write targeted. */
  url;
  /** The HTTP status the server returned (412 / 409 / 428). */
  status;
  constructor(url, status) {
    super(
      `Write to ${url} conflicted (HTTP ${status}): the resource changed since you read it (lost-update guard fired) or already exists. Re-read it and retry.`
    );
    this.name = "WriteConflictError";
    this.url = url;
    this.status = status;
    Object.setPrototypeOf(this, _WriteConflictError.prototype);
  }
};
var WriteFailedError = class _WriteFailedError extends Error {
  /** The resource URL. */
  url;
  /** The HTTP status, when the failure came from a response. */
  status;
  constructor(url, options) {
    super(
      options?.status !== void 0 ? `Write to ${url} failed with status ${options.status}` : `Write to ${url} failed`,
      options?.cause !== void 0 ? { cause: options.cause } : void 0
    );
    this.name = "WriteFailedError";
    this.url = url;
    this.status = options?.status;
    Object.setPrototypeOf(this, _WriteFailedError.prototype);
  }
};
var DataWriter = class {
  #fetch;
  #base;
  constructor(seam = {}) {
    this.#fetch = seam.fetch ?? globalThis.fetch.bind(globalThis);
    this.#base = seam.base;
  }
  /** The base every write is confined to, or `undefined` (no path-prefix check). */
  get base() {
    return this.#base;
  }
  /**
   * §10 MERGE-NOT-REPLACE save (THE correctness invariant). Loads the existing
   * resource graph (keeping its ETag), applies the form's edited values via the
   * MODEL's typed-accessor mutator onto that loaded graph (so only the shape-covered
   * predicates change — incl. dual-predicate writes — and every untouched triple is
   * preserved), then conditionally `If-Match` PUTs the merged graph.
   *
   * If the resource does not exist yet (404 on the pre-read) and
   * `createIfAbsent` (default true), the mutator is applied to an EMPTY graph and
   * the result is CREATE-ONLY written (`If-None-Match: "*"`) so a concurrent
   * creation cannot be clobbered.
   *
   * @param url     - the resource to save (scope-guarded against the base).
   * @param mutate  - applies the form delta through the model's typed setters.
   * @param options - see {@link SaveMergedOptions}.
   * @throws {@link WriteScopeError} if `url` is outside the base.
   * @throws {@link WriteConflictError} on a 412/409/428 (lost-update / exists).
   * @throws {@link WriteFailedError} on any other write failure.
   */
  async saveMerged(url, mutate, options = {}) {
    this.#assertWithinScope(url);
    const createIfAbsent = options.createIfAbsent ?? true;
    const pre = await this.#readForMerge(url, options.signal);
    if (pre.kind === "missing") {
      if (!createIfAbsent) {
        throw new WriteFailedError(url, { status: 404 });
      }
      const created = await applyMutator(new N3Store(), url, mutate);
      const turtle2 = await serializeTurtle(created);
      return this.#put(url, turtle2, { ifNoneMatch: "*", signal: options.signal });
    }
    const merged = await applyMutator(pre.graph, url, mutate);
    const turtle = await serializeTurtle(merged);
    if (!pre.etag) {
      throw new UnconditionalOverwriteError(url);
    }
    return this.#put(url, turtle, { ifMatch: pre.etag, signal: options.signal });
  }
  /**
   * Conditional PUT of a Turtle body. ENFORCES the lost-update guard: overwriting an
   * existing resource requires `ifMatch`; `ifNoneMatch: "*"` is the create-only
   * alternative. An UNCONDITIONAL PUT (neither set) is REFUSED unless
   * `allowUnconditional` is explicitly passed (used only for a brand-new resource a
   * caller has already proven absent some other way — `saveMerged` never uses it).
   *
   * @throws {@link UnconditionalOverwriteError} if neither conditional is set.
   * @throws {@link WriteScopeError} if `url` is outside the base.
   * @throws {@link WriteConflictError} / {@link WriteFailedError} on a failure.
   */
  async putTurtle(url, turtle, options = {}) {
    this.#assertWithinScope(url);
    if (options.ifMatch && options.ifNoneMatch) {
      throw new Error("Pass at most one of ifMatch / ifNoneMatch.");
    }
    if (!options.ifMatch && !options.ifNoneMatch && !options.allowUnconditional) {
      throw new UnconditionalOverwriteError(url);
    }
    return this.#put(url, turtle, options);
  }
  /**
   * Conditional DELETE. Requires `ifMatch` (the lost-update guard) — an
   * unconditional delete of an existing resource is refused, mirroring the write
   * discipline. Scope-guarded.
   */
  async delete(url, options) {
    this.#assertWithinScope(url);
    if (!options.ifMatch) throw new UnconditionalOverwriteError(url);
    let response;
    try {
      response = await this.#fetch(url, {
        method: "DELETE",
        headers: { "If-Match": options.ifMatch },
        // SCOPE GUARD (redirect-SSRF) — see #put: refuse a redirect rather than
        // delete an off-scope resource via a 307/308 to another origin/path.
        redirect: "error",
        ...options.signal ? { signal: options.signal } : {}
      });
    } catch (cause) {
      throw new WriteFailedError(url, { cause });
    }
    if (response.status === 412 || response.status === 409 || response.status === 428) {
      throw new WriteConflictError(url, response.status);
    }
    if (!response.ok && response.status !== 404) {
      throw new WriteFailedError(url, { status: response.status });
    }
  }
  /** The low-level conditional PUT (after the scope + conditional checks). */
  async #put(url, turtle, options) {
    const headers = {
      ...options.headers,
      "Content-Type": TURTLE
    };
    if (options.ifMatch) headers["If-Match"] = options.ifMatch;
    if (options.ifNoneMatch) headers["If-None-Match"] = options.ifNoneMatch;
    let response;
    try {
      response = await this.#fetch(url, {
        method: "PUT",
        headers,
        body: turtle,
        // SCOPE GUARD (redirect-SSRF): `fetch` follows redirects by DEFAULT, so a
        // scoped target that 307/308-redirects to a DIFFERENT origin/path would do
        // the AUTHENTICATED write OUTSIDE the guarded scope (the `#assertWithinScope`
        // check only saw the original URL). `redirect: "error"` makes a redirected
        // write REJECT rather than silently follow it off-scope. (A Solid PUT to your
        // own pod is never legitimately redirected cross-origin.)
        redirect: "error",
        ...options.signal ? { signal: options.signal } : {}
      });
    } catch (cause) {
      throw new WriteFailedError(url, { cause });
    }
    const finalUrl = response.url || url;
    if (response.status === 412 || response.status === 409 || response.status === 428) {
      throw new WriteConflictError(finalUrl, response.status);
    }
    if (!response.ok) {
      throw new WriteFailedError(finalUrl, { status: response.status });
    }
    const etag = response.headers.get("ETag");
    return { url: finalUrl, ...etag ? { etag } : {} };
  }
  /**
   * Read the existing resource for a merge: parse it to a Store + keep its ETag, OR
   * report it MISSING (404/410). Any other read failure throws a WriteFailedError so
   * a save never silently proceeds on a transport error.
   */
  async #readForMerge(url, signal) {
    let response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: { Accept: RDF_ACCEPT2 },
        // SCOPE GUARD (redirect-SSRF): refuse a redirected pre-read too — a 307/308 to
        // a foreign origin would merge that origin's body + ETag, which we'd then
        // conditionally PUT back. The merge base must be the EXACT scoped resource.
        redirect: "error",
        ...signal ? { signal } : {}
      });
    } catch (cause) {
      throw new WriteFailedError(url, { cause });
    }
    const finalUrl = response.url || url;
    this.#assertWithinScope(finalUrl);
    if (response.status === 404 || response.status === 410) return { kind: "missing" };
    if (!response.ok) {
      throw new WriteFailedError(finalUrl, { status: response.status });
    }
    const contentType = response.headers.get("Content-Type");
    let graph;
    try {
      const body = response.body ?? await response.text();
      graph = await parseToStore(body, contentType, { baseIRI: finalUrl });
    } catch (cause) {
      throw new WriteFailedError(finalUrl, { cause });
    }
    const etag = response.headers.get("ETag");
    return { kind: "present", graph, ...etag ? { etag } : {} };
  }
  /**
   * SCOPE GUARD (fail-closed). Throw a {@link WriteScopeError} unless `target` is a
   * safe write target: an absolute http(s) URL, no embedded credentials, and — when
   * a base is configured — same origin + a path under the base's directory. Mirrors
   * the suite forks' `assertWithinBase`. Run BEFORE any fetch.
   */
  #assertWithinScope(target) {
    let url;
    try {
      url = new URL(target);
    } catch {
      throw new WriteScopeError(target, "not an absolute URL");
    }
    const scheme = url.protocol.toLowerCase();
    if (scheme !== "http:" && scheme !== "https:") {
      throw new WriteScopeError(target, `non-http(s) scheme "${url.protocol}"`);
    }
    if (url.username || url.password) {
      throw new WriteScopeError(target, "embedded credentials in the URL");
    }
    if (this.#base === void 0) return;
    let base;
    try {
      base = new URL(this.#base);
    } catch {
      throw new WriteScopeError(target, `the configured base "${this.#base}" is not a valid URL`);
    }
    if (url.origin !== base.origin) {
      throw new WriteScopeError(target, `different origin from the base (${base.origin})`);
    }
    const baseDir = base.pathname.endsWith("/") ? base.pathname : base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1);
    if (!url.pathname.startsWith(baseDir)) {
      throw new WriteScopeError(target, `path is outside the base directory (${baseDir})`);
    }
  }
};
async function applyMutator(graph, resourceUrl, mutate) {
  const returned = await mutate(graph, resourceUrl);
  return returned instanceof N3Store ? returned : graph;
}

// src/components/form-base.ts
var AbstractFormElement = class extends i4 {
  static properties = {
    src: {},
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    base: {},
    publicRead: { type: Boolean, attribute: "public-read" },
    resolveOptions: { attribute: false },
    saveStatus: { state: true }
  };
  constructor() {
    super();
    this.src = void 0;
    this.fetch = void 0;
    this.publicFetch = void 0;
    this.base = void 0;
    this.publicRead = false;
    this.resolveOptions = void 0;
    this.saveStatus = "idle";
  }
  /** Light DOM so a consuming app can `::part`/style the inner editable form. */
  createRenderRoot() {
    return this;
  }
  /**
   * The §10 merge-save callback handed to <jeswr-shacl-form>. Builds a DataWriter
   * scoped to `base` (or the resource directory) and runs `saveMerged`, whose mutator
   * delegates to the subclass's {@link applyFormDeltaToExisting} on the LOADED graph.
   */
  mergeSaveCallback() {
    return async (formGraph) => {
      const src = this.src;
      if (!src) throw new Error("Cannot save: no `src` resource is set.");
      const seam = {
        ...this.fetch ? { fetch: this.fetch } : {},
        // Default the scope-guard base to the resource's own directory so a save can
        // never leave the edited resource's container even if `base` is unset.
        base: this.base ?? defaultBaseFor(src)
      };
      const writer = new DataWriter(seam);
      await writer.saveMerged(src, async (existing, resourceUrl) => {
        await this.applyFormDeltaToExisting(formGraph, existing, resourceUrl);
        return void 0;
      });
    };
  }
  /**
   * Build the data-graph source for the inner form: the resource at `src`, read with
   * the authenticated `fetch` — OR, when `publicRead` is set, with the credential-free
   * `publicFetch` (the resolver fails closed if `publicFetch` is then missing, so the
   * session token never leaks to a foreign read). Honours the same `public-read`
   * contract as the read elements.
   */
  dataSource() {
    if (!this.src) return void 0;
    return { kind: "trusted", url: this.src, seam: this.publicRead ? "public" : "auth" };
  }
  /** Forward a child <jeswr-shacl-form>'s save state up so this element can reflect it. */
  #onChildState = () => {
    const form = this.querySelector("jeswr-shacl-form");
    if (form)
      this.saveStatus = form.saveStatus ?? "idle";
  };
  /** Imperatively trigger a save on the inner editable form. */
  async save() {
    const form = this.querySelector("jeswr-shacl-form");
    if (!form) throw new Error("Cannot save: the editable form is not ready.");
    const ok = await form.save();
    this.#onChildState();
    return ok;
  }
  render() {
    if (!this.src) {
      return b2`<slot name="empty"><p part="empty">No resource to edit.</p></slot>`;
    }
    const dataSource = this.dataSource();
    return b2`
      <jeswr-shacl-form
        part="form"
        .shapes=${{ kind: "inline", text: this.shapeTurtle() }}
        .values=${dataSource}
        .fetch=${this.fetch}
        .publicFetch=${this.publicFetch}
        .resolveOptions=${this.resolveOptions}
        .mergeSave=${this.mergeSaveCallback()}
        @jeswr-save=${(e6) => this.#onSave(e6)}
        @jeswr-save-error=${() => this.#onChildState()}
      ></jeswr-shacl-form>
    `;
  }
  /**
   * Re-emit the inner form's save as THIS element's own event (so a consumer listens
   * on the per-class form, with this element as the event target) + mirror the state.
   * STOP the child's bubbling event first so a consumer listening on this element or
   * an ancestor does NOT receive a DUPLICATE `jeswr-save` (the inner event bubbles +
   * composes; we replace it with one re-targeted to this element).
   */
  #onSave(e6) {
    e6.stopPropagation();
    this.#onChildState();
    this.dispatchEvent(
      new CustomEvent("jeswr-save", { detail: e6.detail, bubbles: true, composed: true })
    );
  }
};
function defaultBaseFor(resourceUrl) {
  try {
    const u3 = new URL(resourceUrl);
    const dir = u3.pathname.slice(0, u3.pathname.lastIndexOf("/") + 1) || "/";
    return `${u3.origin}${dir}`;
  } catch {
    return resourceUrl;
  }
}
var RDF_TYPE5 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
function findEditedSubject(formGraph, typeIri, conventional, namedNode5) {
  const rdfType = namedNode5(RDF_TYPE5);
  const typeNode = namedNode5(typeIri);
  if (formGraph.getQuads(namedNode5(conventional), rdfType, typeNode, null).length > 0) {
    return conventional;
  }
  for (const q3 of formGraph.getQuads(null, rdfType, typeNode, null)) {
    if (q3.subject.termType === "NamedNode") return q3.subject.value;
  }
  return conventional;
}

// node_modules/@jeswr/solid-task-model/dist/iri.js
function httpIriOrUndefined2(value) {
  if (!value)
    return void 0;
  try {
    const u3 = new URL(value);
    return u3.protocol === "http:" || u3.protocol === "https:" ? u3.href : void 0;
  } catch {
    return void 0;
  }
}
function isHttpIri2(value) {
  return value !== void 0 && httpIriOrUndefined2(value) === value;
}

// node_modules/@jeswr/solid-task-model/dist/task.js
var PRIORITIES = ["high", "medium", "low"];
function normalizePriority(value) {
  const v5 = (value ?? "").toLowerCase().trim();
  return PRIORITIES.includes(v5) ? v5 : void 0;
}
var Task = class extends TermWrapper {
  /** The task subject IRI. */
  get id() {
    return this.value;
  }
  /** The `rdf:type` set as a live set of IRI strings. */
  get types() {
    return SetFrom.subjectPredicate(this, rdf5("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp this subject as a `wf:Task`. Idempotent; returns `this` for chaining. */
  mark() {
    this.types.add(TASK_CLASS2);
    return this;
  }
  /** Whether this subject is a `wf:Task`. */
  get isTask() {
    return this.types.has(TASK_CLASS2);
  }
  get title() {
    return OptionalFrom.subjectPredicate(this, dct("title"), LiteralAs.string);
  }
  set title(value) {
    OptionalAs.object(this, dct("title"), value, LiteralFrom.string);
  }
  /**
   * The body. The two existing producers DIVERGE on the predicate — solid-issues
   * writes `wf:description`, the Pod Manager writes `dct:description` — so the
   * shared model must read BOTH or it would silently drop a PM-written body on a
   * cross-app read. The getter prefers `wf:description` and falls back to
   * `dct:description`; the setter writes BOTH (and clears both on undefined) so a
   * consumer querying either predicate finds it. This is the convergence point:
   * once apps adopt this package they all read/write the same pair.
   */
  get description() {
    return OptionalFrom.subjectPredicate(this, wf("description"), LiteralAs.string) ?? OptionalFrom.subjectPredicate(this, dct("description"), LiteralAs.string);
  }
  set description(value) {
    OptionalAs.object(this, wf("description"), value, LiteralFrom.string);
    OptionalAs.object(this, dct("description"), value, LiteralFrom.string);
  }
  get created() {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }
  get modified() {
    return OptionalFrom.subjectPredicate(this, dct("modified"), LiteralAs.date);
  }
  set modified(value) {
    OptionalAs.object(this, dct("modified"), value, LiteralFrom.dateTime);
  }
  /** `prov:endedAtTime` — completion time. Set automatically by {@link state}. */
  get endedAt() {
    return OptionalFrom.subjectPredicate(this, prov("endedAtTime"), LiteralAs.date);
  }
  set endedAt(value) {
    OptionalAs.object(this, prov("endedAtTime"), value, LiteralFrom.dateTime);
  }
  get creator() {
    return OptionalFrom.subjectPredicate(this, dct("creator"), NamedNodeAs.string);
  }
  set creator(value) {
    OptionalAs.object(this, dct("creator"), value, NamedNodeFrom.string);
  }
  /** `wf:assignee` — the assigned agent's WebID. */
  get assignee() {
    return OptionalFrom.subjectPredicate(this, wf("assignee"), NamedNodeAs.string);
  }
  set assignee(value) {
    OptionalAs.object(this, wf("assignee"), value, NamedNodeFrom.string);
  }
  /** `wf:tracker` — the project / tracker document. */
  get project() {
    return OptionalFrom.subjectPredicate(this, wf("tracker"), NamedNodeAs.string);
  }
  set project(value) {
    OptionalAs.object(this, wf("tracker"), value, NamedNodeFrom.string);
  }
  /** `wf:dateDue` — the due date (stored as xsd:dateTime; well-formed + round-trips). */
  get dueDate() {
    return OptionalFrom.subjectPredicate(this, wf("dateDue"), LiteralAs.date);
  }
  set dueDate(value) {
    OptionalAs.object(this, wf("dateDue"), value, LiteralFrom.dateTime);
  }
  /** `schema:priority` — high/medium/low, as a string literal. */
  get priority() {
    return normalizePriority(OptionalFrom.subjectPredicate(this, schema("priority"), LiteralAs.string));
  }
  set priority(value) {
    OptionalAs.object(this, schema("priority"), value, LiteralFrom.string);
  }
  /** `schema:position` — backlog rank; lower sorts first. */
  get rank() {
    return OptionalFrom.subjectPredicate(this, schema("position"), LiteralAs.number);
  }
  set rank(value) {
    OptionalAs.object(this, schema("position"), value, LiteralFrom.double);
  }
  /** `dct:isPartOf` — the parent issue. */
  get parent() {
    return OptionalFrom.subjectPredicate(this, dct("isPartOf"), NamedNodeAs.string);
  }
  set parent(value) {
    OptionalAs.object(this, dct("isPartOf"), value, NamedNodeFrom.string);
  }
  /** `dct:isReplacedBy` — the canonical successor (close-as-duplicate). */
  get duplicateOf() {
    return OptionalFrom.subjectPredicate(this, dct("isReplacedBy"), NamedNodeAs.string);
  }
  set duplicateOf(value) {
    OptionalAs.object(this, dct("isReplacedBy"), value, NamedNodeFrom.string);
  }
  /** `prov:wasDerivedFrom` — the single original this task was cloned from. */
  get clonedFrom() {
    return OptionalFrom.subjectPredicate(this, prov("wasDerivedFrom"), NamedNodeAs.string);
  }
  set clonedFrom(value) {
    OptionalAs.object(this, prov("wasDerivedFrom"), value, NamedNodeFrom.string);
  }
  /** `dct:requires` — issues this one is blocked by (live set of IRIs). */
  get blockedBy() {
    return SetFrom.subjectPredicate(this, dct("requires"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** `dct:relation` — non-blocking, symmetric relates-to links (live set of IRIs). */
  get relatesTo() {
    return SetFrom.subjectPredicate(this, dct("relation"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /**
   * Lifecycle state, read from / written to `rdf:type wf:Open` / `wf:Closed`.
   * Setting `closed` stamps `prov:endedAtTime` (once — preserved on re-close);
   * setting `open` clears it. Always keeps `wf:Task` typed.
   */
  get state() {
    return this.types.has(WF_CLOSED) ? "closed" : "open";
  }
  set state(value) {
    const types = this.types;
    types.add(TASK_CLASS2);
    if (value === "closed") {
      types.add(WF_CLOSED);
      types.delete(WF_OPEN);
      this.endedAt ??= /* @__PURE__ */ new Date();
    } else {
      types.add(WF_OPEN);
      types.delete(WF_CLOSED);
      this.endedAt = void 0;
    }
  }
  /** Convenience: is this task open? */
  get isOpen() {
    return this.state === "open";
  }
};
function taskSubject(resourceUrl) {
  return `${resourceUrl}#it`;
}

// src/components/shapes.ts
var TASK_SHAPE_TTL = `
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix wf:     <http://www.w3.org/2005/01/wf/flow#> .
@prefix dct:    <http://purl.org/dc/terms/> .
@prefix schema: <http://schema.org/> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .

[] a sh:NodeShape ;
  sh:targetClass wf:Task ;
  sh:property [ sh:path dct:title ;       sh:name "Title" ;       sh:order 1 ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path wf:description ;  sh:name "Description" ; sh:order 2 ; sh:datatype xsd:string ; sh:maxCount 1 ] ;
  sh:property [ sh:path wf:assignee ;     sh:name "Assignee" ;    sh:order 3 ; sh:nodeKind sh:IRI ; sh:maxCount 1 ; sh:pattern "^https?://" ] ;
  sh:property [ sh:path wf:dateDue ;      sh:name "Due date" ;    sh:order 4 ; sh:datatype xsd:dateTime ; sh:maxCount 1 ] ;
  sh:property [ sh:path schema:priority ; sh:name "Priority" ;    sh:order 5 ; sh:datatype xsd:string ; sh:maxCount 1 ; sh:in ( "high" "medium" "low" ) ] .
`;
var BOOKMARK_SHAPE_TTL = `
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix book:   <https://w3id.org/jeswr/bookmark#> .
@prefix schema: <http://schema.org/> .
@prefix dct:    <http://purl.org/dc/terms/> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .

[] a sh:NodeShape ;
  sh:targetClass book:Bookmark ;
  sh:property [ sh:path schema:url ;         sh:name "URL" ;         sh:order 1 ; sh:nodeKind sh:IRI ; sh:minCount 1 ; sh:maxCount 1 ; sh:pattern "^https?://" ] ;
  sh:property [ sh:path dct:title ;          sh:name "Title" ;       sh:order 2 ; sh:datatype xsd:string ; sh:maxCount 1 ] ;
  sh:property [ sh:path dct:description ;    sh:name "Description" ; sh:order 3 ; sh:datatype xsd:string ; sh:maxCount 1 ] ;
  sh:property [ sh:path book:notes ;         sh:name "Notes" ;       sh:order 4 ; sh:datatype xsd:string ; sh:maxCount 1 ] ;
  sh:property [ sh:path book:archived ;      sh:name "Archived" ;    sh:order 5 ; sh:datatype xsd:boolean ; sh:maxCount 1 ] ;
  sh:property [ sh:path schema:keywords ;    sh:name "Tags" ;        sh:order 6 ; sh:datatype xsd:string ] .
`;
var CONTACT_SHAPE_TTL = `
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix vcard:  <http://www.w3.org/2006/vcard/ns#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .

[] a sh:NodeShape ;
  sh:targetClass vcard:Individual ;
  sh:property [ sh:path vcard:fn ;                sh:name "Name" ;         sh:order 1 ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path vcard:organization-name ; sh:name "Organisation" ; sh:order 2 ; sh:datatype xsd:string ; sh:maxCount 1 ] ;
  sh:property [ sh:path vcard:note ;              sh:name "Note" ;         sh:order 3 ; sh:datatype xsd:string ; sh:maxCount 1 ] .
`;

// src/components/task-form.ts
var TASK_TYPE = "http://www.w3.org/2005/01/wf/flow#Task";
var JeswrTaskForm = class extends AbstractFormElement {
  shapeTurtle() {
    return TASK_SHAPE_TTL;
  }
  /**
   * Apply the edited task fields from the form graph onto the existing graph, via the
   * model's typed `Task` accessor on each. Reads through `new Task(readSubject,
   * formGraph)` (the form's edited node, which shacl-form may have minted) and writes
   * through `new Task(writeSubject, existing)` (the resource's conventional `#it`) —
   * so the saved triples land on `${url}#it` regardless of shacl-form's minted IRI.
   * Only the shape's predicates change; the `description` setter writes BOTH
   * wf:description + dct:description (the dual-predicate contract); every untouched
   * triple on `existing` (and on OTHER subjects) is preserved.
   */
  applyFormDeltaToExisting(formGraph, existing, resourceUrl) {
    const writeSubject = taskSubject(resourceUrl);
    const readSubject = findEditedSubject(
      formGraph,
      TASK_TYPE,
      writeSubject,
      N3DataFactory_default.namedNode
    );
    const edited = new Task(readSubject, formGraph, N3DataFactory_default);
    const target = new Task(writeSubject, existing, N3DataFactory_default).mark();
    target.title = edited.title;
    target.description = edited.description;
    target.assignee = safeHref(edited.assignee);
    target.dueDate = edited.dueDate;
    target.priority = edited.priority;
    target.modified = /* @__PURE__ */ new Date();
  }
};
if (!customElements.get("jeswr-task-form")) {
  customElements.define("jeswr-task-form", JeswrTaskForm);
}

// node_modules/@jeswr/solid-task-model/dist/contacts.js
function isMailto(value) {
  return /^mailto:.+/.test(value);
}
function isTel(value) {
  return /^tel:.+/.test(value);
}
var blankNodeLabel = (term) => term.value;
function addStructuredValue(parent, predicate, kind, iriValue) {
  const bnode = parent.factory.blankNode();
  SetFrom.subjectPredicate(parent, predicate, blankNodeLabel, BlankNodeFrom.string).add(bnode.value);
  const child = new TermWrapper(bnode, parent.dataset, parent.factory);
  SetFrom.subjectPredicate(child, rdf5("type"), NamedNodeAs.string, NamedNodeFrom.string).add(kind);
  OptionalAs.object(child, VCARD_VALUE, iriValue, NamedNodeFrom.string);
}
function readStructuredValues(parent, predicate) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const p4 = parent.factory.namedNode(predicate);
  for (const q3 of parent.dataset.match(parent, p4)) {
    const obj = q3.object;
    if (obj.termType === "NamedNode") {
      if (!seen.has(obj.value)) {
        seen.add(obj.value);
        out.push(obj.value);
      }
      continue;
    }
    if (obj.termType === "BlankNode") {
      const child = new TermWrapper(obj, parent.dataset, parent.factory);
      const value = OptionalFrom.subjectPredicate(child, VCARD_VALUE, NamedNodeAs.string);
      if (value !== void 0 && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}
var Contact = class extends TermWrapper {
  /** The individual subject IRI (`<person>#this`). */
  get id() {
    return this.value;
  }
  /** The `rdf:type` set as a live set of IRI strings. */
  get types() {
    return SetFrom.subjectPredicate(this, rdf5("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp this subject as a `vcard:Individual`. Idempotent; returns `this`. */
  mark() {
    this.types.add(VCARD_INDIVIDUAL2);
    return this;
  }
  /** Whether this subject is a `vcard:Individual`. */
  get isIndividual() {
    return this.types.has(VCARD_INDIVIDUAL2);
  }
  /** `vcard:fn` — the formatted/display name. */
  get name() {
    return OptionalFrom.subjectPredicate(this, VCARD_FN, LiteralAs.string);
  }
  set name(value) {
    OptionalAs.object(this, VCARD_FN, value, LiteralFrom.string);
  }
  /** `vcard:inAddressBook` — the owning address book IRI. */
  get inAddressBook() {
    return OptionalFrom.subjectPredicate(this, VCARD_IN_ADDRESS_BOOK, NamedNodeAs.string);
  }
  set inAddressBook(value) {
    OptionalAs.object(this, VCARD_IN_ADDRESS_BOOK, value, NamedNodeFrom.string);
  }
  /** `vcard:hasUID` — a stable unique id literal (the model writes `urn:uuid:<v4>`). */
  get uid() {
    return OptionalFrom.subjectPredicate(this, VCARD_HAS_UID, LiteralAs.string);
  }
  set uid(value) {
    OptionalAs.object(this, VCARD_HAS_UID, value, LiteralFrom.string);
  }
  /** `dct:created` (DC Terms) — the person document's creation time. */
  get created() {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }
  /** `vcard:note` — a free-text note. */
  get note() {
    return OptionalFrom.subjectPredicate(this, VCARD_NOTE, LiteralAs.string);
  }
  set note(value) {
    OptionalAs.object(this, VCARD_NOTE, value, LiteralFrom.string);
  }
  /**
   * `vcard:organization-name` — the contact's organisation/company name (the standard
   * W3C vCard `ORG` term). A plain string literal; clears the triple on `undefined`.
   */
  get organization() {
    return OptionalFrom.subjectPredicate(this, VCARD_ORGANIZATION_NAME, LiteralAs.string);
  }
  set organization(value) {
    OptionalAs.object(this, VCARD_ORGANIZATION_NAME, value, LiteralFrom.string);
  }
  /**
   * The contact's emails as canonical `mailto:` IRIs. Reads BOTH a direct
   * `vcard:hasEmail <mailto:..>` and the structured `vcard:hasEmail [ vcard:value
   * <mailto:..> ]` form (the crux behaviour). Only well-formed `mailto:` IRIs are
   * returned: pod data is untrusted, so a `javascript:`/`http:`/literal value from a
   * malicious or malformed contact is DROPPED rather than handed to UI as an email
   * (the public contract is canonical `mailto:` values).
   */
  get emails() {
    return readStructuredValues(this, VCARD_HAS_EMAIL).filter(isMailto);
  }
  /**
   * Replace the contact's emails. Clears any prior `vcard:hasEmail` (structured nodes
   * and direct IRIs), then writes each as the STRUCTURED `[ a vcard:Home; vcard:value
   * <mailto:..> ]` form SolidOS reads. Non-`mailto:` entries are dropped (untrusted
   * input). Accepts either a bare address or a full `mailto:` IRI.
   */
  setEmails(emails) {
    this.clearStructured(VCARD_HAS_EMAIL);
    for (const raw of emails) {
      const iri = raw.startsWith("mailto:") ? raw : `mailto:${raw}`;
      if (isMailto(iri))
        addStructuredValue(this, VCARD_HAS_EMAIL, VCARD_HOME, iri);
    }
  }
  /**
   * The contact's phones as canonical `tel:` IRIs. Reads BOTH a direct
   * `vcard:hasTelephone <tel:..>` and the structured `vcard:hasTelephone [ vcard:value
   * <tel:..> ]` form. Only well-formed `tel:` IRIs are returned: an untrusted/malformed
   * value (e.g. `javascript:`) is DROPPED rather than handed to UI as a phone link.
   */
  get phones() {
    return readStructuredValues(this, VCARD_HAS_TELEPHONE).filter(isTel);
  }
  /**
   * Replace the contact's phones. Clears any prior `vcard:hasTelephone`, then writes
   * each as the STRUCTURED `[ a vcard:Cell; vcard:value <tel:..> ]` form. Non-`tel:`
   * entries are dropped. Accepts either a bare number or a full `tel:` IRI.
   */
  setPhones(phones) {
    this.clearStructured(VCARD_HAS_TELEPHONE);
    for (const raw of phones) {
      const iri = raw.startsWith("tel:") ? raw : `tel:${raw}`;
      if (isTel(iri))
        addStructuredValue(this, VCARD_HAS_TELEPHONE, VCARD_CELL, iri);
    }
  }
  /**
   * The contact's WebID, read from the structured `vcard:url [ a vcard:WebId;
   * vcard:value <webid> ]` form (or a direct `vcard:url <webid>`). Only http(s) IRIs.
   */
  get webId() {
    return readStructuredValues(this, VCARD_URL).find(isHttpIri2);
  }
  /**
   * Replace the contact's WebID. Clears any prior `vcard:url`, then writes the
   * structured `[ a vcard:WebId; vcard:value <webid> ]` form. A non-http(s) value is
   * dropped (untrusted input).
   */
  setWebId(webId) {
    this.clearStructured(VCARD_URL);
    if (isHttpIri2(webId))
      addStructuredValue(this, VCARD_URL, VCARD_WEB_ID, webId);
  }
  /**
   * Remove every `predicate` edge AND any blank-node value node it pointed at, so a
   * replace leaves no orphan structured node behind. Direct-IRI objects are removed by
   * the edge deletion alone; blank-node objects have their own triples cleared too.
   */
  clearStructured(predicate) {
    const p4 = this.factory.namedNode(predicate);
    const edges = [...this.dataset.match(this, p4)];
    for (const q3 of edges) {
      if (q3.object.termType === "BlankNode") {
        for (const inner of [...this.dataset.match(q3.object)])
          this.dataset.delete(inner);
      }
      this.dataset.delete(q3);
    }
  }
};
function personSubject(personDocUrl) {
  return `${personDocUrl}#this`;
}

// src/components/contact-form.ts
var CONTACT_TYPE = "http://www.w3.org/2006/vcard/ns#Individual";
var JeswrContactForm = class extends AbstractFormElement {
  shapeTurtle() {
    return CONTACT_SHAPE_TTL;
  }
  applyFormDeltaToExisting(formGraph, existing, resourceUrl) {
    const writeSubject = personSubject(resourceUrl);
    const readSubject = findEditedSubject(
      formGraph,
      CONTACT_TYPE,
      writeSubject,
      N3DataFactory_default.namedNode
    );
    const edited = new Contact(readSubject, formGraph, N3DataFactory_default);
    const target = new Contact(writeSubject, existing, N3DataFactory_default).mark();
    target.name = edited.name;
    target.organization = edited.organization;
    target.note = edited.note;
  }
};
if (!customElements.get("jeswr-contact-form")) {
  customElements.define("jeswr-contact-form", JeswrContactForm);
}

// node_modules/@jeswr/solid-bookmark/dist/vocab.js
var BOOK = "https://w3id.org/jeswr/bookmark#";
var SCHEMA3 = "http://schema.org/";
var DCT3 = "http://purl.org/dc/terms/";
var RDF6 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var book = (local) => `${BOOK}${local}`;
var schema2 = (local) => `${SCHEMA3}${local}`;
var dct2 = (local) => `${DCT3}${local}`;
var rdf6 = (local) => `${RDF6}${local}`;
var BOOKMARK_CLASS2 = book("Bookmark");
var BOOK_ARCHIVED = book("archived");
var BOOK_NOTES = book("notes");
var SCHEMA_URL = schema2("url");
var SCHEMA_KEYWORDS = schema2("keywords");
var DCT_TITLE2 = dct2("title");
var DCT_DESCRIPTION = dct2("description");
var DCT_CREATED2 = dct2("created");
var DCT_MODIFIED = dct2("modified");
var RDF_TYPE6 = rdf6("type");

// node_modules/@jeswr/solid-bookmark/dist/bookmark.js
function bookmarkSubject(resourceUrl) {
  return `${resourceUrl}#it`;
}
var Bookmark = class extends TermWrapper {
  /** The bookmark subject IRI. */
  get id() {
    return this.value;
  }
  /** The `rdf:type` set as a live set of IRI strings. */
  get types() {
    return SetFrom.subjectPredicate(this, RDF_TYPE6, NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp this subject as a `book:Bookmark`. Idempotent; returns `this` for chaining. */
  mark() {
    this.types.add(BOOKMARK_CLASS2);
    return this;
  }
  /** Whether this subject is a `book:Bookmark`. */
  get isBookmark() {
    return this.types.has(BOOKMARK_CLASS2);
  }
  /** `schema:url` — the bookmarked URL (an http(s) IRI). */
  get url() {
    return OptionalFrom.subjectPredicate(this, SCHEMA_URL, NamedNodeAs.string);
  }
  set url(value) {
    OptionalAs.object(this, SCHEMA_URL, value, NamedNodeFrom.string);
  }
  /** `dct:title`. */
  get title() {
    return OptionalFrom.subjectPredicate(this, DCT_TITLE2, LiteralAs.string);
  }
  set title(value) {
    OptionalAs.object(this, DCT_TITLE2, value, LiteralFrom.string);
  }
  /** `dct:description` — the short summary / blurb. */
  get description() {
    return OptionalFrom.subjectPredicate(this, DCT_DESCRIPTION, LiteralAs.string);
  }
  set description(value) {
    OptionalAs.object(this, DCT_DESCRIPTION, value, LiteralFrom.string);
  }
  /** `book:notes` — the user's markdown notes. */
  get notes() {
    return OptionalFrom.subjectPredicate(this, BOOK_NOTES, LiteralAs.string);
  }
  set notes(value) {
    OptionalAs.object(this, BOOK_NOTES, value, LiteralFrom.string);
  }
  /**
   * `book:archived` — `xsd:boolean`. Absent triple reads as `false` (a bookmark
   * is not archived until explicitly so). The setter writes `false` explicitly
   * too, so the boolean is always observable on the wire rather than relying on
   * absence — except `undefined` clears it.
   */
  get archived() {
    return OptionalFrom.subjectPredicate(this, BOOK_ARCHIVED, LiteralAs.boolean) ?? false;
  }
  set archived(value) {
    OptionalAs.object(this, BOOK_ARCHIVED, value, LiteralFrom.boolean);
  }
  /** `dct:created`. */
  get created() {
    return OptionalFrom.subjectPredicate(this, DCT_CREATED2, LiteralAs.date);
  }
  set created(value) {
    OptionalAs.object(this, DCT_CREATED2, value, LiteralFrom.dateTime);
  }
  /** `dct:modified`. */
  get modified() {
    return OptionalFrom.subjectPredicate(this, DCT_MODIFIED, LiteralAs.date);
  }
  set modified(value) {
    OptionalAs.object(this, DCT_MODIFIED, value, LiteralFrom.dateTime);
  }
  /**
   * `schema:keywords` — the tags, as a live set of free-text labels (one triple
   * per tag). A `Set` rather than a list because tags are unordered + unique.
   */
  get tags() {
    return SetFrom.subjectPredicate(this, SCHEMA_KEYWORDS, LiteralAs.string, LiteralFrom.string);
  }
};

// src/components/bookmark-form.ts
var BOOKMARK_TYPE = "https://w3id.org/jeswr/bookmark#Bookmark";
var JeswrBookmarkForm = class extends AbstractFormElement {
  shapeTurtle() {
    return BOOKMARK_SHAPE_TTL;
  }
  applyFormDeltaToExisting(formGraph, existing, resourceUrl) {
    const writeSubject = bookmarkSubject(resourceUrl);
    const readSubject = findEditedSubject(
      formGraph,
      BOOKMARK_TYPE,
      writeSubject,
      N3DataFactory_default.namedNode
    );
    const edited = new Bookmark(readSubject, formGraph, N3DataFactory_default);
    const target = new Bookmark(writeSubject, existing, N3DataFactory_default).mark();
    target.url = safeHref(edited.url);
    target.title = edited.title;
    target.description = edited.description;
    target.notes = edited.notes;
    target.archived = edited.archived;
    for (const t5 of [...target.tags]) target.tags.delete(t5);
    for (const t5 of edited.tags) target.tags.add(t5);
    target.modified = /* @__PURE__ */ new Date();
  }
};
if (!customElements.get("jeswr-bookmark-form")) {
  customElements.define("jeswr-bookmark-form", JeswrBookmarkForm);
}

export {
  N3DataFactory_default,
  N3Store,
  b2 as b,
  i4 as i,
  serializeTurtle,
  neutraliseValuesTurtle,
  countTurtleQuads,
  VALUES_SUBJECT_SENTINEL,
  resolveGraphToTurtle,
  EMPTY_SHAPES_MESSAGE,
  resolveAndHarden,
  JeswrShaclView,
  TermWrapper,
  OptionalFrom,
  TermAs,
  LiteralAs,
  NamedNodeFrom,
  NamedNodeAs,
  SetFrom,
  Task,
  TASK_CLASS,
  VCARD_INDIVIDUAL,
  VCARD_ADDRESS_BOOK,
  BOOKMARK_CLASS,
  AS_NOTE,
  LDP_CONTAINER,
  LDP_BASIC_CONTAINER,
  RDF_TYPE,
  DataControllerError,
  NotFoundError,
  AccessDeniedError,
  NetworkError,
  DataFormatError,
  classifyReadError,
  DataController,
  BASE_INPUT_PROPS,
  AbstractReadElement,
  safeHref,
  safeMailto,
  safeTel,
  stripScheme,
  formatDate,
  Contact,
  Bookmark,
  JeswrMessageList,
  JeswrShaclForm,
  WriteScopeError,
  UnconditionalOverwriteError,
  WriteConflictError,
  WriteFailedError,
  DataWriter,
  AbstractFormElement,
  defaultBaseFor,
  findEditedSubject,
  JeswrTaskForm,
  JeswrContactForm,
  JeswrBookmarkForm
};
