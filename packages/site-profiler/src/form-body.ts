// AUTHORED-BY Codex GPT-6.1-Sol
// Bounded text-only form decoding. Uploads and malformed multipart bodies are not replayable.
export function formFields(body: string, contentType: string): Array<[string, string]> | undefined {
  if (/^application\/x-www-form-urlencoded\b/i.test(contentType))
    return [...new URLSearchParams(body)];
  if (!/^multipart\/form-data\b/i.test(contentType)) return undefined;
  const boundary = /\bboundary=(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(contentType);
  const value = boundary?.[1] ?? boundary?.[2];
  if (!value || value.length > 70) return undefined;
  const parts = body.split(`--${value}`);
  if (parts.length < 3 || parts[0] !== "" || !/^--(?:\r\n)?$/.test(parts.at(-1) ?? ""))
    return undefined;
  const fields: Array<[string, string]> = [];
  for (const part of parts.slice(1, -1)) {
    const match = /^\r\n([\s\S]*?)\r\n\r\n([\s\S]*)\r\n$/.exec(part);
    if (!match) return undefined;
    const headers = match[1] ?? "";
    if (/\bfilename\s*=/i.test(headers)) return undefined;
    const name = /^content-disposition:\s*form-data;\s*name="([^"\r\n]+)"\s*$/im.exec(headers)?.[1];
    if (!name || fields.length >= 2000) return undefined;
    fields.push([name, match[2] ?? ""]);
  }
  return fields;
}
