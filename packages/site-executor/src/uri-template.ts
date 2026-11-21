// AUTHORED-BY Claude Opus 5.5
// RFC 6570 URI Template expansion (levels 1-4: simple, reserved, fragment, label,
// path, path-parameter, query and query-continuation operators, plus the level 4
// prefix `:n` and explode `*` modifiers). Hand-written so the executor controls
// percent-encoding exactly: the encoding is what keeps a value inside the URL
// component its template slot names.

export type TemplateValue =
  | string
  | readonly string[]
  | Readonly<Record<string, string>>
  | undefined;
export type TemplateVars = Readonly<Record<string, TemplateValue>>;

export class UriTemplateError extends Error {
  override name = "UriTemplateError";
}

interface OperatorSpec {
  first: string;
  sep: string;
  named: boolean;
  ifEmpty: string;
  allowReserved: boolean;
}

const OPERATORS: Readonly<Record<string, OperatorSpec>> = {
  "": { first: "", sep: ",", named: false, ifEmpty: "", allowReserved: false },
  "+": { first: "", sep: ",", named: false, ifEmpty: "", allowReserved: true },
  "#": { first: "#", sep: ",", named: false, ifEmpty: "", allowReserved: true },
  ".": { first: ".", sep: ".", named: false, ifEmpty: "", allowReserved: false },
  "/": { first: "/", sep: "/", named: false, ifEmpty: "", allowReserved: false },
  ";": { first: ";", sep: ";", named: true, ifEmpty: "", allowReserved: false },
  "?": { first: "?", sep: "&", named: true, ifEmpty: "=", allowReserved: false },
  "&": { first: "&", sep: "&", named: true, ifEmpty: "=", allowReserved: false },
};

/** Operators RFC 6570 reserves for future extensions: a template using one is invalid. */
const RESERVED_OPERATORS = new Set(["=", ",", "!", "@", "|"]);

const UNRESERVED = /[A-Za-z0-9\-._~]/;
const RESERVED = /[:/?#[\]@!$&'()*+,;=]/;
const PCT_TRIPLET = /^%[0-9A-Fa-f]{2}/;
const VARNAME = /^(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})+(?:\.(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})+)*$/;

interface VarSpec {
  name: string;
  explode: boolean;
  prefix?: number;
}

interface Expression {
  operator: string;
  vars: VarSpec[];
}

type Part = string | Expression;

function encodeChar(ch: string): string {
  return Array.from(
    new TextEncoder().encode(ch),
    (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
  ).join("");
}

/** Percent-encode `value`; with `allowReserved`, reserved characters and existing pct-triplets pass through. */
export function encodeValue(value: string, allowReserved: boolean): string {
  let out = "";
  const chars = Array.from(value);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string;
    if (UNRESERVED.test(ch)) {
      out += ch;
    } else if (allowReserved && RESERVED.test(ch)) {
      out += ch;
    } else if (allowReserved && ch === "%" && PCT_TRIPLET.test(chars.slice(i, i + 3).join(""))) {
      out += chars.slice(i, i + 3).join("");
      i += 2;
    } else {
      out += encodeChar(ch);
    }
  }
  return out;
}

/** Literal template text: characters that are not allowed in a URI are pct-encoded. */
function encodeLiteral(text: string): string {
  return encodeValue(text, true);
}

function parseVarSpec(raw: string): VarSpec {
  let spec = raw;
  let explode = false;
  let prefix: number | undefined;
  if (spec.endsWith("*")) {
    explode = true;
    spec = spec.slice(0, -1);
  } else {
    const colon = spec.indexOf(":");
    if (colon !== -1) {
      const digits = spec.slice(colon + 1);
      if (!/^[1-9][0-9]{0,3}$/.test(digits)) {
        throw new UriTemplateError(`invalid prefix modifier in "${raw}"`);
      }
      prefix = Number(digits);
      spec = spec.slice(0, colon);
    }
  }
  if (!VARNAME.test(spec)) {
    throw new UriTemplateError(`invalid variable name "${spec}"`);
  }
  return prefix === undefined ? { name: spec, explode } : { name: spec, explode, prefix };
}

/** Parse a template into literal and expression parts; throws UriTemplateError on malformed input. */
export function parseTemplate(template: string): Part[] {
  const parts: Part[] = [];
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf("{", i);
    const close = template.indexOf("}", i);
    if (close !== -1 && (open === -1 || close < open)) {
      throw new UriTemplateError("unmatched '}' in template");
    }
    if (open === -1) {
      parts.push(template.slice(i));
      break;
    }
    if (open > i) parts.push(template.slice(i, open));
    const end = template.indexOf("}", open);
    if (end === -1) throw new UriTemplateError("unclosed '{' in template");
    let body = template.slice(open + 1, end);
    if (body.includes("{")) throw new UriTemplateError("nested '{' in template");
    let operator = "";
    const firstChar = body.charAt(0);
    if (firstChar in OPERATORS && firstChar !== "") {
      operator = firstChar;
      body = body.slice(1);
    } else if (RESERVED_OPERATORS.has(firstChar)) {
      throw new UriTemplateError(`reserved operator "${firstChar}" in template`);
    }
    if (body.length === 0) throw new UriTemplateError("empty expression in template");
    parts.push({ operator, vars: body.split(",").map(parseVarSpec) });
    i = end + 1;
  }
  return parts;
}

/** Names of every variable a template references, in order of first appearance. */
export function templateVariables(template: string): string[] {
  const names: string[] = [];
  for (const part of parseTemplate(template)) {
    if (typeof part === "string") continue;
    for (const v of part.vars) if (!names.includes(v.name)) names.push(v.name);
  }
  return names;
}

function isList(value: TemplateValue): value is readonly string[] {
  return Array.isArray(value);
}

function isMap(value: TemplateValue): value is Readonly<Record<string, string>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined(value: TemplateValue): boolean {
  if (value === undefined || value === null) return false;
  if (isList(value)) return value.length > 0;
  if (isMap(value)) return Object.keys(value).length > 0;
  return true;
}

function expandExpression(expr: Expression, vars: TemplateVars): string {
  const op = OPERATORS[expr.operator] as OperatorSpec;
  const enc = (s: string): string => encodeValue(s, op.allowReserved);
  const pieces: string[] = [];
  for (const spec of expr.vars) {
    const value = Object.hasOwn(vars, spec.name) ? vars[spec.name] : undefined;
    if (!isDefined(value)) continue;
    if (typeof value === "string") {
      const v =
        spec.prefix === undefined ? value : Array.from(value).slice(0, spec.prefix).join("");
      if (op.named) {
        pieces.push(v === "" ? `${spec.name}${op.ifEmpty}` : `${spec.name}=${enc(v)}`);
      } else {
        pieces.push(enc(v));
      }
      continue;
    }
    if (spec.prefix !== undefined) {
      throw new UriTemplateError(`prefix modifier applied to composite value "${spec.name}"`);
    }
    const entries: [string, string][] = isList(value)
      ? value.map((item) => ["", item])
      : Object.entries(value as Record<string, string>);
    if (!spec.explode) {
      const joined = isList(value)
        ? value.map(enc).join(",")
        : entries.map(([k, v]) => `${enc(k)},${enc(v)}`).join(",");
      pieces.push(op.named ? `${spec.name}${joined === "" ? op.ifEmpty : `=${joined}`}` : joined);
      continue;
    }
    const exploded = entries.map(([k, v]) => {
      if (isMap(value)) return v === "" ? `${enc(k)}${op.ifEmpty}` : `${enc(k)}=${enc(v)}`;
      if (op.named) return v === "" ? `${spec.name}${op.ifEmpty}` : `${spec.name}=${enc(v)}`;
      return enc(v);
    });
    pieces.push(exploded.join(op.sep));
  }
  return pieces.length === 0 ? "" : op.first + pieces.join(op.sep);
}

/** Expand an RFC 6570 template. Undefined variables expand to nothing, as the RFC specifies. */
export function expandTemplate(template: string, vars: TemplateVars): string {
  return parseTemplate(template)
    .map((part) => (typeof part === "string" ? encodeLiteral(part) : expandExpression(part, vars)))
    .join("");
}
