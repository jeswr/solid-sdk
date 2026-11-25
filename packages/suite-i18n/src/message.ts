// AUTHORED-BY Codex GPT-6.1-Sol
import type { Parameters } from "./types.js";

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
export type CompiledMessage = (params?: Parameters, locale?: string) => string;

/** Parse once; the returned formatter throws on missing or wrong parameter values. */
export function compileMessage(source: string): CompiledMessage {
  const nodes = parseMessage(source);
  return (params = {}, locale = "en") => {
    let rules: Intl.PluralRules | undefined;
    let numbers: Intl.NumberFormat | undefined;
    const render = (list: Node[], count?: number): string =>
      list
        .map((node): string => {
          if (node.kind === "text") return node.value;
          if (node.kind === "pound") {
            if (count === undefined) return "#";
            numbers ??= new Intl.NumberFormat(locale);
            return numbers.format(count);
          }
          const value = Object.hasOwn(params, node.name) ? params[node.name] : undefined;
          if (typeof value !== "string" && typeof value !== "number")
            throw new TypeError(`Missing parameter ${node.name}`);
          if (node.kind === "argument") return String(value);
          if (node.kind === "plural" && (typeof value !== "number" || !Number.isFinite(value)))
            throw new TypeError(`Expected finite number for ${node.name}`);
          if (node.kind === "select" && typeof value !== "string")
            throw new TypeError(`Expected string for ${node.name}`);
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
