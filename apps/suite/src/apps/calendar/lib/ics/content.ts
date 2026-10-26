// AUTHORED-BY Codex GPT-6.1-Sol
export function requireIcs(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid iCalendar: ${message}`);
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[,;]/g, "\\$&");
}

export function unescapeText(value: string): string {
  return value.replace(/\\([\\,;nN])/g, (_, char: string) => (/[nN]/.test(char) ? "\n" : char));
}

/** Fold at 75 UTF-8 octets, including continuation whitespace, never inside a code point. */
export function foldLine(value: string): string {
  requireIcs(!/[\r\n]/.test(value), "raw newline in content line");
  const encoder = new TextEncoder();
  let output = "";
  let width = 0;
  for (const char of value) {
    const length = encoder.encode(char).length;
    if (width + length > 75) {
      output += "\r\n ";
      width = 1;
    }
    output += char;
    width += length;
  }
  return output;
}

export interface Property {
  name: string;
  params: Map<string, string[]>;
  value: string;
}
export interface Component {
  name: string;
  properties: Property[];
  children: Component[];
}

function property(line: string): Property {
  // Separators in quoted parameter values are data (e.g. TZID="custom:zone").
  let index = 0;
  let quoted = false;
  for (; index < line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ":" && !quoted) break;
  }
  requireIcs(index < line.length && !quoted, "missing property separator");
  const segments = line.slice(0, index).match(/(?:"[^"]*"|[^;])+/g);
  requireIcs(
    segments && segments.join(";") === line.slice(0, index),
    "missing property name or empty parameter",
  );
  const name = segments.shift() as string;
  requireIcs(/^[a-z\d-]+$/i.test(name), "invalid property name");
  const params = new Map<string, string[]>();
  for (const segment of segments) {
    const equal = segment.indexOf("=");
    const key = segment.slice(0, equal).toUpperCase();
    const value = segment.slice(equal + 1);
    requireIcs(
      equal > 0 && /^[A-Z\d-]+$/.test(key) && value && !params.has(key),
      "invalid parameter",
    );
    const values = value.match(/"[^"]*"|[^",]+/g);
    requireIcs(values && values.join(",") === value, "invalid quoted parameter list");
    params.set(
      key,
      values.map((part) => (part.startsWith('"') ? part.slice(1, -1) : part)),
    );
  }
  return { name: name.toUpperCase(), params, value: line.slice(index + 1) };
}

/** Read a supported singleton parameter without collapsing a list into one value. */
export function parameter(prop: Property, name: string): string | undefined {
  const values = prop.params.get(name);
  if (values === undefined) return undefined;
  requireIcs(values.length === 1, `expected one ${name} parameter value`);
  return values[0];
}

export function parseComponent(text: string): Component {
  const root: Component = { name: "ROOT", properties: [], children: [] };
  const stack = [root];
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    const prop = property(line);
    const parent = stack[stack.length - 1] as Component;
    if (prop.name === "BEGIN") {
      const child = { name: prop.value.toUpperCase(), properties: [], children: [] };
      parent.children.push(child);
      stack.push(child);
    } else if (prop.name === "END") {
      requireIcs(
        stack.length > 1 && parent.name === prop.value.toUpperCase(),
        "mismatched component end",
      );
      stack.pop();
    } else {
      parent.properties.push(prop);
    }
  }
  requireIcs(
    stack.length === 1 && root.children.length === 1 && root.properties.length === 0,
    "incomplete document",
  );
  return root.children[0] as Component;
}

export function componentLines(component: Component): string[] {
  return [
    `BEGIN:${component.name}`,
    ...component.properties.map(
      (prop) =>
        `${prop.name}${[...prop.params].map(([key, values]) => `;${key}=${values.map((value) => `"${value}"`).join(",")}`).join("")}:${prop.value}`,
    ),
    ...component.children.flatMap(componentLines),
    `END:${component.name}`,
  ];
}

export function all(component: Component, name: string): Property[] {
  return component.properties.filter((prop) => prop.name === name);
}

export function one(component: Component, name: string, required = false): Property | undefined {
  const values = all(component, name);
  requireIcs(values.length <= 1 && (!required || values.length === 1), `expected one ${name}`);
  return values[0];
}
