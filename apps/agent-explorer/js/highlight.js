// AUTHORED-BY Codex GPT-6.2 Sol
// Classic script. Tokenise for display, keeping the original text and whitespace.
(() => {
  const entities = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "\r": "&#13;",
  };
  const escapeHtml = (text) =>
    text.length === 1
      ? (entities[text] ?? text)
      : text.replace(/[&<>"'\r]/g, (char) => entities[char]);

  const jsonTokens =
    /"(?:[^"\\\r\n]*\\[^\r\n])*[^"\\\r\n]*"|"|[{}[\]:,]+|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;
  const jsonKeyEnd = /\s*:/y;
  const ldKeys = new Set(
    (
      "@base @container @context @direction @graph @id @import @included @index @json @language @list " +
      "@nest @none @prefix @propagate @protected @reverse @set @type @value @version @vocab"
    ).split(" "),
  );
  const ldKeyPattern = /[{,]\s*("(?:@|\\u0040)(?:[a-z]|\\u[\da-fA-F]{4}){2,7}")\s*:/g;
  const iriValue = /^[a-z][\w+.-]*:[^\s"\\]+$/i;
  const rdfDirective = /^[ \t]*(?:(?:@prefix|PREFIX)[ \t]+[^\s:]*:[ \t]*<|(?:@base|BASE)[ \t]+<)/im;
  const rdfTriple = /^[ \t]*<[^<>\s]+>[ \t]+<[^<>\s]+>/m;
  const rdfTokens =
    /"""|'''|["'<]|#[^\r\n]*|\^\^|@[a-z]+(?:-[a-z0-9]+)*|[?$][\p{L}\p{N}_][\p{L}\p{N}\p{M}_]*|(?:[\p{L}_][\p{L}\p{N}\p{M}_.-]*)?:(?:[\p{L}\p{N}\p{M}_.:-]|%[\da-f]{2}|\\[_~.!$&'()*+,;=/?#@%:-])*|[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+|[+-]?(?:\d*\.)?\d+|[\p{L}_][\p{L}\p{N}\p{M}_.-]*|[.;,[\](){}=!*+|/&>^]+/giu;
  const iriEnd = /[\s<>"{}|^\x60\\]/g;
  const iriEscape = /\\(?:u[\da-fA-F]{4}|U[\da-fA-F]{8})/y;
  const sparqlKeywords = new Set(
    (
      "SELECT CONSTRUCT DESCRIBE ASK WHERE FROM NAMED ORDER BY ASC DESC LIMIT OFFSET DISTINCT REDUCED " +
      "OPTIONAL GRAPH UNION FILTER SERVICE SILENT BIND AS VALUES UNDEF MINUS GROUP HAVING EXISTS NOT IN " +
      "INSERT DELETE DATA LOAD CLEAR CREATE DROP ADD MOVE COPY INTO TO WITH USING DEFAULT ALL " +
      "COUNT SUM MIN MAX AVG SAMPLE GROUP_CONCAT SEPARATOR STR LANG LANGMATCHES DATATYPE BOUND IRI URI " +
      "BNODE RAND ABS CEIL FLOOR ROUND CONCAT SUBSTR STRLEN REPLACE UCASE LCASE ENCODE_FOR_URI CONTAINS " +
      "STRSTARTS STRENDS STRBEFORE STRAFTER YEAR MONTH DAY HOURS MINUTES SECONDS TIMEZONE TZ NOW " +
      "UUID STRUUID MD5 SHA1 SHA256 SHA384 SHA512 COALESCE IF STRLANG STRDT SAMETERM ISIRI ISURI " +
      "ISBLANK ISLITERAL ISNUMERIC REGEX"
    ).split(" "),
  );
  const scriptTokens =
    /\/\/[^\r\n]*|\/\*|["'\x60]|[a-z_$][\w$]*|\b\d+(?:\.\d+)?\b|[{}[\]();,.:=>]+/gi;
  const scriptKeywords = new Set(
    (
      "as async await break case catch class const continue default do else enum export extends finally " +
      "for from function if implements import in instanceof interface let new of private protected public " +
      "readonly return satisfies static super switch this throw try type typeof var void while yield"
    ).split(" "),
  );
  const shellTokens = /(?<!\S)#[^\r\n]*|["']|\$(?:\{|\w+)|[a-z_][\w-]*|\b\d+\b|[;|&()<>]+/gi;
  const shellParameterBoundary = /[}\r\n]/g;
  const shellKeywords = new Set(
    "case cd curl do done echo elif else esac exit export fi for function if in local node npm pnpm printf read return set then unset until while".split(
      " ",
    ),
  );
  const httpTokens =
    /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)(?=[ \t])|^[^\S\r\n\u2028\u2029]*#[^\r\n]*|^[\w-]+(?=:)|\bHTTP\/\d(?:\.\d)?\b|\b\d{3}\b|"|:/gm;

  function detect(text) {
    if (/^\s*[{[]/.test(text)) {
      ldKeyPattern.lastIndex = 0;
      for (let match = ldKeyPattern.exec(text); match; match = ldKeyPattern.exec(text)) {
        const key = JSON.parse(match[1]);
        if (key === "@context" || key === "@id") return "jsonld";
      }
      return "json";
    }
    if (rdfDirective.test(text) || rdfTriple.test(text)) return "turtle";
    try {
      JSON.parse(text);
      return "json";
    } catch {
      return "text";
    }
  }

  function quotedEnd(text, end, quote, escapes = true) {
    const multiline = quote.length === 3 || quote === "\x60";
    for (let i = end; i < text.length; i++) {
      const char = text[i];
      if (char === "\\" && escapes) {
        i++;
      } else if (char === quote[0] && text.startsWith(quote, i)) {
        return i + quote.length;
      } else if (!multiline && (char === "\n" || char === "\r")) {
        return -1;
      }
    }
    return -1;
  }

  function readIri(text, start) {
    if (text[start] === "<") return -1;
    iriEnd.lastIndex = start;
    for (let match = iriEnd.exec(text); match; match = iriEnd.exec(text)) {
      if (match[0] === ">") return iriEnd.lastIndex;
      if (match[0] !== "\\") return -1;
      iriEscape.lastIndex = match.index;
      if (!iriEscape.test(text)) return -1;
      iriEnd.lastIndex = iriEscape.lastIndex;
    }
    return -1;
  }

  function span(kind, escaped) {
    return `<span class="tok-${kind}">${escaped}</span>`;
  }

  // A classifier may extend a match (quotes and IRIs) or shorten it (a Turtle name
  // followed by a dot). Unmatched gaps and uncoloured tokens also pass through escape.
  // Finish each token before searching again, so a malformed string can stop the scan.
  function lex(text, pattern, classify) {
    let html = "";
    let offset = 0;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const start = match.index;
      const token = match[0];
      const matchEnd = pattern.lastIndex;
      const [kind, end = matchEnd] = classify(token, matchEnd, start);
      if (end < 0) return escapeHtml(text);
      if (end !== matchEnd) pattern.lastIndex = end;
      if (!kind) continue;
      if (start > offset) html += escapeHtml(text.slice(offset, start));
      html += span(kind, escapeHtml(end === matchEnd ? token : text.slice(start, end)));
      offset = end;
    }
    return html + escapeHtml(text.slice(offset));
  }

  function json(text, linked) {
    return lex(text, jsonTokens, (token, end) => {
      const first = token[0];
      if (first === '"') {
        // Stop on the first unclosed string before trying any of its escaped quotes.
        if (token.length === 1) return [null, -1];
        jsonKeyEnd.lastIndex = end;
        const key = text[end] === ":" || jsonKeyEnd.test(text);
        if (!linked) return [key ? "key" : "string"];
        const value = token.slice(1, -1);
        if (value.startsWith("@") || value.startsWith("\\u0040")) {
          const name = value.includes("\\") ? JSON.parse(token) : value;
          if (ldKeys.has(name)) return ["keyword"];
        }
        if (
          !key &&
          (iriValue.test(value) ||
            (value.includes("\\/") && iriValue.test(value.replaceAll("\\/", "/"))))
        ) {
          return ["iri"];
        }
        return [key ? "key" : "string"];
      }
      if ("{}[]:,".includes(first)) return ["punctuation"];
      if (first === "-" || (first >= "0" && first <= "9")) return ["number"];
      return ["literal"];
    });
  }

  function rdf(text, sparql) {
    return lex(text, rdfTokens, (token, end, start) => {
      if (token[0] === '"' || token[0] === "'") return ["string", quotedEnd(text, end, token)];
      if (token === "<") {
        const stop = readIri(text, end);
        if (stop < 0 && sparql) return ["punctuation"];
        return ["iri", stop];
      }
      if (token[0] === "#") return ["comment"];
      if (token[0] === "@" || token === "^^") return ["keyword"];
      if (token[0] === "?" || token[0] === "$") return [sparql ? "variable" : null];
      if (/^[+-]?(?:\d|\.\d)/.test(token)) return ["number"];
      if (/^[.;,[\](){}=!*+|/&>^]/.test(token)) return ["punctuation"];
      let length = token.length;
      while (token[length - 1] === "." && token[length - 2] !== "\\") length--;
      token = token.slice(0, length);
      if (token.includes(":")) return [token.startsWith("_:") ? "blank" : "name", start + length];
      if (token === "a" || /^(?:prefix|base|graph)$/i.test(token))
        return ["keyword", start + length];
      if (sparql && sparqlKeywords.has(token.toUpperCase())) return ["keyword", start + length];
      if (/^(?:true|false)$/i.test(token)) return ["literal", start + length];
      return [null, start + length];
    });
  }

  function script(text, shell) {
    let parameterBoundary = -1;
    return lex(text, shell ? shellTokens : scriptTokens, (token, end) => {
      if (token === '"' || token === "'" || token === "\x60") {
        return ["string", quotedEnd(text, end, token, !shell || token !== "'")];
      }
      if (token === "/*") {
        const stop = text.indexOf("*/", end);
        return ["comment", stop < 0 ? -1 : stop + 2];
      }
      if (token.startsWith("//")) return ["comment"];
      if (shell && token[0] === "#") return ["comment"];
      if (shell && token === "${") {
        // Look ahead once per stretch up to a closing brace or a line break.
        if (parameterBoundary < end) {
          shellParameterBoundary.lastIndex = end;
          parameterBoundary = shellParameterBoundary.exec(text)?.index ?? text.length;
        }
        return text[parameterBoundary] === "}" ? ["variable", parameterBoundary + 1] : [null];
      }
      if (shell && token[0] === "$") return ["variable"];
      if ((shell ? shellKeywords : scriptKeywords).has(token)) return ["keyword"];
      if (/^(?:true|false|null|undefined)$/.test(token)) return ["literal"];
      if (/^\d/.test(token)) return ["number"];
      return [/^[{}[\]();,.:=<>|&]/.test(token) ? "punctuation" : null];
    });
  }

  function http(text) {
    const split = /\r?\n\r?\n/.exec(text);
    const head = split ? text.slice(0, split.index) : text;
    const html = lex(head, httpTokens, (token, end) => {
      if (token === '"') return ["string", quotedEnd(head, end, token)];
      if (token === ":") return ["punctuation"];
      if (token.trimStart()[0] === "#") return ["comment"];
      if (head[end] === ":") return ["key"];
      return [/^\d/.test(token) ? "number" : "keyword"];
    });
    return split
      ? html + escapeHtml(split[0]) + highlight(text.slice(split.index + split[0].length))
      : html;
  }

  function highlight(text, language) {
    if (typeof text !== "string") return "";
    try {
      const lang = typeof language === "string" ? language.trim().toLowerCase() : language;
      switch (lang == null || lang === "" ? detect(text) : lang) {
        case "json":
        case "application/json":
          return json(text, false);
        case "jsonld":
        case "json-ld":
        case "ld+json":
        case "application/ld+json":
          return json(text, true);
        case "turtle":
        case "ttl":
        case "text/turtle":
        case "rdf":
        case "trig":
        case "application/trig":
        case "ntriples":
        case "n-triples":
        case "nt":
        case "application/n-triples":
        case "nquads":
        case "n-quads":
        case "nq":
        case "application/n-quads":
          return rdf(text, false);
        case "sparql":
        case "rq":
        case "application/sparql-query":
          return rdf(text, true);
        case "js":
        case "javascript":
        case "ts":
        case "typescript":
          return script(text, false);
        case "sh":
        case "bash":
        case "shell":
        case "console":
          return script(text, true);
        case "http":
          return http(text);
        default:
          return escapeHtml(text);
      }
    } catch {
      return escapeHtml(text);
    }
  }

  window.AX ??= {};
  window.AX.highlight = highlight;
})();
