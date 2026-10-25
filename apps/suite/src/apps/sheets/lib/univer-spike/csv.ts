// AUTHORED-BY Codex GPT-6.1-Sol
/** RFC 4180 text fields. Import never evaluates formulas or coerces identifiers. */
export function parseCsv(csv: string): string[][] {
  const text = csv.replace(/^\uFEFF/, "");
  if (text === "") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === "," || char === "\r" || char === "\n") {
      row.push(field);
      field = "";
      closed = false;
      if (char !== ",") {
        rows.push(row);
        row = [];
        if (char === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (char === '"' && field === "" && !closed) {
      quoted = true;
    } else {
      if (closed || char === '"') throw new SyntaxError("Unexpected character in CSV field");
      field += char;
    }
  }
  if (quoted) throw new SyntaxError("Unterminated CSV field");
  if (row.length > 0 || !/[\r\n]$/.test(text) || closed) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function serializeCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row
        .map((value) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value))
        .join(","),
    )
    .map((line) => `${line}\r\n`)
    .join("");
}
