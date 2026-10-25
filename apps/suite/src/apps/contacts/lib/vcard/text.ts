// AUTHORED-BY Codex GPT-6.1-Sol
/** Split without losing escaped delimiters; optionally respect parameter quotes. */
export function split(value: string, delimiter: string, quotes = false): string[] {
  const parts: string[] = [];
  let part = "";
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i);
    if (!quotes && char === "\\" && i + 1 < value.length) {
      part += char + value.charAt(++i);
    } else if (quotes && char === '"') {
      quoted = !quoted;
      part += char;
    } else if (char === delimiter && !quoted) {
      parts.push(part);
      part = "";
    } else {
      part += char;
    }
  }
  parts.push(part);
  return parts;
}

export function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, char: string) =>
    char.toLowerCase() === "n" ? "\n" : char,
  );
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Fold on UTF-8 octet boundaries, including the continuation space in the limit. */
export function fold(line: string): string {
  const encoder = new TextEncoder();
  let output = "";
  let width = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (width + size > 75) {
      output += "\r\n ";
      width = 1;
    }
    output += char;
    width += size;
  }
  return output;
}

export function decodeQuotedPrintable(value: string, charset: string): string {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (let i = 0; i < value.length; ) {
    if (value.charAt(i) === "=") {
      const hex = value.slice(i + 1, i + 3);
      if (!/^[\da-f]{2}$/i.test(hex)) throw new SyntaxError("Invalid vCard quoted-printable");
      bytes.push(Number.parseInt(hex, 16));
      i += 3;
    } else {
      const codePoint = value.codePointAt(i) as number;
      const char = String.fromCodePoint(codePoint);
      bytes.push(...encoder.encode(char));
      i += char.length;
    }
  }
  try {
    return new TextDecoder(charset, { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    throw new SyntaxError("Unsupported vCard charset or invalid encoded text");
  }
}
