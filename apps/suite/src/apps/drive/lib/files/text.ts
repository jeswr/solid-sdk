// AUTHORED-BY Codex GPT-6.1-Sol

/** Preview all text as UTF-8, but allow editing only when it can round-trip. */
export function decodePreviewText(bytes: Uint8Array, contentType: string) {
  const text = new TextDecoder().decode(bytes);
  const charsets = contentType
    .split(";")
    .slice(1)
    .filter((parameter) => /^\s*charset\s*(?:=|$)/i.test(parameter))
    .map((parameter) =>
      parameter
        .slice(parameter.indexOf("=") + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1")
        .toLowerCase(),
    );
  let editableEncoding = charsets.every((charset) => charset === "utf-8" || charset === "us-ascii");
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    // BOM files remain preview-only so an editor cannot silently drop the BOM.
    if (decoded.startsWith("\uFEFF")) editableEncoding = false;
  } catch {
    editableEncoding = false;
  }
  // A textarea normalises newlines. Only uniform LF or CRLF can round-trip safely.
  const withoutCrlf = text.replace(/\r\n/g, "");
  if (withoutCrlf.includes("\r") || (text.includes("\r\n") && withoutCrlf.includes("\n")))
    editableEncoding = false;
  return { text, editableEncoding, declaredCharset: charsets.length > 0 };
}
