// AUTHORED-BY Codex GPT-6.1-Sol
import { decodeQuotedPrintable, split, unescapeText, unescapeUri } from "./text";
import type { VCard, VCardField } from "./types";

interface Property extends VCardField<string> {
  name: string;
}

/** Find only the header separator: quotes in a TEXT value have no header meaning. */
function headerEnd(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line.charAt(i);
    if (char === '"') quoted = !quoted;
    if (char === ":" && !quoted) return i;
  }
  throw new SyntaxError("Invalid vCard content line");
}

function property(line: string): Property {
  const colon = headerEnd(line);
  const [identifier, ...params] = split(line.slice(0, colon), ";", true);
  if (!/^([a-z\d-]+\.)?[a-z\d-]+$/i.test(identifier as string)) {
    throw new SyntaxError("Invalid vCard property name");
  }
  const tokens = (identifier as string).split(".");
  const name = (tokens.pop() as string).toUpperCase();
  const parameters: Record<string, string[]> = {};
  for (const param of params) {
    const equals = param.indexOf("=");
    const key = equals < 0 ? "TYPE" : param.slice(0, equals).toUpperCase();
    if (!/^[A-Z\d-]+$/.test(key)) throw new SyntaxError("Invalid vCard parameter name");
    const raw = equals < 0 ? param : param.slice(equals + 1);
    let values = split(raw, ",", true).map((value) => {
      if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
      return value;
    });
    if (key === "TYPE") values = values.flatMap((value) => value.toLowerCase().split(","));
    parameters[key] = [...(parameters[key] ?? []), ...values];
  }
  return {
    name,
    value: line.slice(colon + 1),
    parameters,
    ...(tokens.length ? { group: tokens[0] as string } : {}),
  };
}

function logicalLines(text: string): string[] {
  const lines: string[] = [];
  for (const line of text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    const previous = lines.at(-1);
    // Legacy v3 exports use MIME soft breaks, sometimes with an extra fold space.
    const header = previous?.match(/^(?:[^":]|"[^"]*")*:/)?.[0];
    const soft =
      previous?.endsWith("=") &&
      header !== undefined &&
      property(header).parameters.ENCODING?.[0]?.toUpperCase() === "QUOTED-PRINTABLE";
    if (previous !== undefined && (soft || /^[ \t]/.test(line))) {
      lines[lines.length - 1] =
        (soft ? previous.slice(0, -1) : previous) + line.replace(/^[ \t]/, "");
    } else {
      lines.push(line);
    }
  }
  return lines;
}

const nameKeys = ["family", "given", "additional", "prefixes", "suffixes"] as const;
const addressKeys = [
  "poBox",
  "extended",
  "street",
  "locality",
  "region",
  "postalCode",
  "country",
] as const;

function structured<K extends string>(value: string, keys: readonly K[]): Record<K, string[]> {
  const parts = split(value, ";");
  if (parts.length > keys.length) throw new SyntaxError("Too many vCard structured components");
  return Object.fromEntries(
    keys.map((key, i) => [key, split(parts[i] ?? "", ",").map(unescapeText)]),
  ) as Record<K, string[]>;
}

const supported = new Set([
  "FN",
  "N",
  "EMAIL",
  "TEL",
  "ADR",
  "ORG",
  "TITLE",
  "BDAY",
  "NOTE",
  "PHOTO",
  "CATEGORIES",
]);

function cardFrom(properties: Property[]): VCard {
  const versions = properties.filter((entry) => entry.name === "VERSION");
  const version = versions[0]?.value;
  if (versions.length !== 1 || (version !== "3.0" && version !== "4.0")) {
    throw new SyntaxError("Expected one vCard VERSION of 3.0 or 4.0");
  }
  if (!properties.some((entry) => entry.name === "FN")) throw new SyntaxError("Missing vCard FN");
  const card: VCard = { version, fn: "", emails: [], tels: [], addresses: [], categories: [] };
  for (const entry of properties) {
    if (!supported.has(entry.name)) continue;
    const { name, parameters } = entry;
    const encoding = parameters.ENCODING?.[0]?.toUpperCase();
    if (
      name === "PHOTO" &&
      (encoding === "B" ||
        encoding === "BASE64" ||
        parameters.VALUE?.[0]?.toUpperCase() === "BINARY")
    )
      continue;
    let raw = entry.value;
    if (encoding !== undefined) {
      if (encoding !== "QUOTED-PRINTABLE" || version !== "3.0") {
        throw new SyntaxError("Unsupported vCard text encoding");
      }
      raw = decodeQuotedPrintable(raw, parameters.CHARSET?.[0] ?? "utf-8");
    }
    delete parameters.ENCODING;
    delete parameters.CHARSET;
    if (version === "4.0") {
      for (const key of Object.keys(parameters)) {
        parameters[key] = (parameters[key] as string[]).map((value) =>
          value.replace(/\^(\^|n|')/g, (_, char: string) =>
            char === "^" ? "^" : char === "'" ? '"' : "\n",
          ),
        );
      }
    }
    const value = unescapeText(raw);
    const field: VCardField<string> = {
      value,
      parameters,
      ...(entry.group ? { group: entry.group } : {}),
    };
    switch (name) {
      case "FN":
        card.fn = value;
        break;
      case "N":
        card.n = structured(raw, nameKeys);
        break;
      case "EMAIL":
        card.emails.push(field);
        break;
      case "TEL":
        // TEL defaults to TEXT; explicit URI values use only version-specific comma escaping.
        if (parameters.VALUE?.[0]?.toLowerCase() === "uri") field.value = unescapeUri(raw, version);
        card.tels.push(field);
        break;
      case "ADR":
        card.addresses.push({
          ...field,
          value: structured(raw, addressKeys),
        });
        break;
      case "ORG":
        card.org = split(raw, ";").map(unescapeText);
        break;
      case "TITLE":
        card.title = value;
        break;
      case "BDAY":
        card.bday = value;
        if (parameters.VALUE?.[0] !== undefined)
          card.bdayValueType = parameters.VALUE[0].toLowerCase();
        else delete card.bdayValueType;
        break;
      case "NOTE":
        card.note = value;
        break;
      case "PHOTO":
        if (/^[a-z][a-z\d+.-]*:[^\s]*$/i.test(raw)) card.photo = unescapeUri(raw, version);
        break;
      case "CATEGORIES":
        card.categories.push(...split(raw, ",").map(unescapeText));
        break;
    }
  }
  return card;
}

/** Parse one or more v3/v4 cards into plain objects; reject malformed envelopes and encodings. */
export function parseVCards(text: string): VCard[] {
  const cards: VCard[] = [];
  let properties: Property[] | undefined;
  for (const line of logicalLines(text)) {
    if (line === "") continue;
    if (/^BEGIN:VCARD$/i.test(line)) {
      if (properties) throw new SyntaxError("Nested vCard");
      properties = [];
    } else if (/^END:VCARD$/i.test(line)) {
      if (!properties) throw new SyntaxError("Unexpected vCard END");
      cards.push(cardFrom(properties));
      properties = undefined;
    } else {
      if (!properties) throw new SyntaxError("Content outside vCard");
      properties.push(property(line));
    }
  }
  if (properties) throw new SyntaxError("Unclosed vCard");
  return cards;
}
