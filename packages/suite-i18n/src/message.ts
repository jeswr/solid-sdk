// AUTHORED-BY Codex GPT-6.1-Sol
import { dir } from "./locale.js";
import type { Parameters } from "./types.js";

const FSI = "\u2068";
const PDI = "\u2069";
/** Embeddings, overrides and isolates: a value must not be able to reorder the text around it. */
const bidiControls = /[\u202A-\u202E\u2066-\u2069]/gu;
const rtlLetter =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}]/u;

/**
 * Neutralise a substituted string value. Embedded bidi controls are always stripped. The value
 * is wrapped in FSI...PDI only when it could otherwise reorder its surroundings: it held bidi
 * controls, contains a strong right-to-left letter, or its first strong letter runs against
 * the locale's direction (a Latin host inside Arabic text). Ordinary same-direction values
 * stay byte-identical, so text lookups and snapshots keep matching.
 */
export function isolateValue(value: string, locale: string): string {
  const clean = value.replace(bidiControls, "");
  let isolate = clean !== value || rtlLetter.test(clean);
  if (!isolate) {
    const first = /\p{L}/u.exec(clean);
    isolate = first !== null && dir(locale) === "rtl";
  }
  return isolate ? `${FSI}${clean}${PDI}` : clean;
}

type Node =
  | { kind: "text"; value: string }
  | { kind: "pound" }
  | { kind: "argument"; name: string }
  | { kind: "plural" | "select"; name: string; options: Map<string, Node[]> };

/** A deliberately bounded ICU subset: interpolation, cardinal plurals, exact matches and select. */
export function parseMessage(source: string): Node[] {
  if (source.length > 20_000) throw new SyntaxError("Message exceeds 20000 characters");
  let cursor = 0;
  const fail = (): never => {
    throw new SyntaxError(`Invalid message at ${cursor}`);
  };
  const space = () => {
    while (/\s/u.test(source.charAt(cursor)) && cursor < source.length) cursor++;
  };
  const token = () => {
    space();
    const start = cursor;
    while (cursor < source.length && !/[\s{},]/u.test(source.charAt(cursor))) cursor++;
    const value = source.slice(start, cursor);
    if (!value) fail();
    space();
    return value;
  };
  const consume = (char: string) => {
    if (source[cursor++] !== char) fail();
  };
  const message = (nested: boolean, depth: number): Node[] => {
    if (depth > 32) throw new SyntaxError("Message nesting exceeds 32 levels");
    const nodes: Node[] = [];
    let literal = "";
    const flush = () => {
      if (literal) nodes.push({ kind: "text", value: literal });
      literal = "";
    };
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === "\\") {
        if (cursor === source.length) fail();
        literal += source[cursor++];
      } else if (char === "}") {
        if (!nested) fail();
        flush();
        return nodes;
      } else if (char === "#") {
        flush();
        nodes.push({ kind: "pound" });
      } else if (char === "{") {
        flush();
        const name = token();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) fail();
        if (source[cursor] === "}") {
          cursor++;
          nodes.push({ kind: "argument", name });
          continue;
        }
        consume(",");
        const kind = token();
        if (kind !== "plural" && kind !== "select") return fail();
        consume(",");
        const options = new Map<string, Node[]>();
        space();
        while (cursor < source.length && source[cursor] !== "}") {
          const rawSelector = token();
          if (
            kind === "plural" &&
            !/^(?:zero|one|two|few|many|other|=-?\d+(?:\.\d+)?)$/u.test(rawSelector)
          )
            fail();
          const selector =
            kind === "plural" && rawSelector.startsWith("=")
              ? `=${Number(rawSelector.slice(1))}`
              : rawSelector;
          if (options.has(selector)) fail();
          consume("{");
          options.set(selector, message(true, depth + 1));
          space();
        }
        consume("}");
        if (!options.has("other")) fail();
        nodes.push({ kind, name, options });
      } else literal += char;
    }
    if (nested) fail();
    flush();
    return nodes;
  };
  return message(false, 0);
}

export function messageParameters(source: string): Record<string, "value" | "number" | "string"> {
  const parameters = new Map<string, "value" | "number" | "string">();
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.kind === "text" || node.kind === "pound") continue;
      const kind = node.kind === "plural" ? "number" : node.kind === "select" ? "string" : "value";
      const previous = parameters.get(node.name);
      if (previous && previous !== kind && previous !== "value" && kind !== "value")
        throw new SyntaxError(`Conflicting parameter ${node.name}`);
      parameters.set(node.name, previous && kind === "value" ? previous : kind);
      if (node.kind !== "argument") for (const option of node.options.values()) visit(option);
    }
  };
  visit(parseMessage(source));
  return Object.fromEntries([...parameters].sort(([a], [b]) => a.localeCompare(b)));
}

/** A parsed message, ready to format repeatedly without parsing again. */
export type CompiledMessage = (
  params?: Parameters,
  locale?: string,
  /** Render missing or wrong-typed parameters as empty isolated values instead of throwing. */
  lenient?: boolean,
) => string;

/** Parse once; the returned formatter throws on missing or wrong parameter values. */
export function compileMessage(source: string): CompiledMessage {
  const nodes = parseMessage(source);
  return (params = {}, locale = "en", lenient = false) => {
    let rules: Intl.PluralRules | undefined;
    let numbers: Intl.NumberFormat | undefined;
    const render = (list: Node[], count?: number): string =>
      list
        .map((node): string => {
          if (node.kind === "text") return node.value;
          if (node.kind === "pound") {
            if (count === undefined) return "#";
            if (Number.isNaN(count)) return "";
            numbers ??= new Intl.NumberFormat(locale);
            return numbers.format(count);
          }
          const value = Object.hasOwn(params, node.name) ? params[node.name] : undefined;
          const invalid =
            typeof value !== "string" && typeof value !== "number"
              ? `Missing parameter ${node.name}`
              : node.kind === "plural" && (typeof value !== "number" || !Number.isFinite(value))
                ? `Expected finite number for ${node.name}`
                : node.kind === "select" && typeof value !== "string"
                  ? `Expected string for ${node.name}`
                  : "";
          if (invalid && !lenient) throw new TypeError(invalid);
          if (invalid) {
            if (node.kind === "argument") return `${FSI}${PDI}`;
            // The parser requires an other branch; a missing count renders no number.
            return render(
              node.options.get("other") as Node[],
              node.kind === "plural" ? NaN : count,
            );
          }
          if (node.kind === "argument")
            return typeof value === "string" ? isolateValue(value, locale) : String(value);
          let key = String(value);
          if (node.kind === "plural") {
            key = `=${value}`;
            if (!node.options.has(key)) {
              rules ??= new Intl.PluralRules(locale);
              key = rules.select(value as number);
            }
          }
          // The parser requires an other branch.
          const body = node.options.get(key) ?? node.options.get("other");
          return render(body as Node[], node.kind === "plural" ? (value as number) : count);
        })
        .join("");
    return render(nodes);
  };
}

export function formatMessage(source: string, params: Parameters = {}, locale = "en"): string {
  return compileMessage(source)(params, locale);
}
