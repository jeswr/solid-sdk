// AUTHORED-BY Claude Opus 5.5
import type { Transport } from "./types.js";

type Pair = { name: string; value: string };
export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Pair[];
    cookies: Pair[];
    queryString: Pair[];
    headersSize: number;
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Pair[];
    cookies: Pair[];
    content: { size: number; mimeType: string; text: string; encoding?: "base64" };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
  // biome-ignore lint/style/useNamingConvention: HAR extension fields start with an underscore.
  _capture_error?: string;
}

const secretField =
  /^(?:password|passwd|pwd|current_password|new_password|password_confirmation|csrf(?:[_-]?token)?|_?token|authenticity_token|form_key|access_token|refresh_token|authorization)$/i;
const visibleCookies = new Set(["mage-messages"]);
const redacted = "[redacted]";
const isSecretField = (key: string) =>
  secretField.test(key) || secretField.test(/\[([^\]]+)\]$/.exec(key)?.[1] ?? "");

function jsonSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSecrets);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, isSecretField(k) ? redacted : jsonSecrets(v)]),
    );
  return value;
}
function bodyText(text: string, mime: string): string {
  if (mime.includes("application/json")) {
    try {
      return JSON.stringify(jsonSecrets(JSON.parse(text)));
    } catch {
      return text;
    }
  }
  if (mime.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    for (const key of new Set(params.keys())) if (isSecretField(key)) params.set(key, redacted);
    return params.toString();
  }
  if (mime.includes("multipart/form-data"))
    return text.replace(
      /(name="([^"]+)"[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n)([\s\S]*?)(?=\r?\n--)/g,
      (whole, prefix: string, key: string) => (isSecretField(key) ? `${prefix}${redacted}` : whole),
    );
  // HTML must retain its DOM/text evidence; strip only credential-bearing input values.
  return text.replace(/<(?:input|meta)\b[^>]*>/gi, (tag) => {
    const name = /\bname=["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    return isSecretField(name) || /\btype=["']password["']/i.test(tag)
      ? tag.replace(/\b(value|content)=(?:"[^"]*"|'[^']*')/gi, `$1="${redacted}"`)
      : tag;
  });
}
function safeUrl(value: string): string {
  const url = new URL(value, "http://relative.invalid");
  for (const key of new Set(url.searchParams.keys()))
    if (isSecretField(key)) url.searchParams.set(key, redacted);
  return url.origin === "http://relative.invalid"
    ? `${url.pathname}${url.search}${url.hash}`
    : url.href;
}
function cookiePairs(header: string): Pair[] {
  return header.split(";").flatMap((part) => {
    const split = part.indexOf("=");
    return split < 0
      ? []
      : [{ name: part.slice(0, split).trim(), value: part.slice(split + 1).trim() }];
  });
}
function cookiesForHar(cookies: Pair[]): Pair[] {
  return cookies.map((c) => ({
    name: c.name,
    value: visibleCookies.has(c.name) ? c.value : redacted,
  }));
}
function headersForHar(headers: Headers): Pair[] {
  return [...headers].map(([name, value]) => ({
    name,
    value: /^(?:authorization|proxy-authorization|x-csrf-?token|x-xsrf-?token|x-auth-token)$/i.test(
      name,
    )
      ? redacted
      : name === "cookie"
        ? cookiesForHar(cookiePairs(value))
            .map((c) => `${c.name}=${c.value}`)
            .join("; ")
        : name === "set-cookie"
          ? redacted
          : name === "location" || name === "referer"
            ? safeUrl(value)
            : value,
  }));
}

async function readBody(
  response: Response,
  signal?: AbortSignal,
  limit = 5 * 1024 * 1024,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      length += value.length;
      if (length > limit) {
        abort();
        throw new Error("HAR response exceeds 5 MiB.");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

/** Real transport evidence only. Redaction is applied solely to the persisted HAR copy. */
export function captureHar(
  transport: Transport,
  signal?: AbortSignal,
  sensitiveValues: string[] = [],
) {
  const entries: HarEntry[] = [];
  const secrets = new Set(sensitiveValues.filter((s) => s.length >= 8));
  const remember = (headers: Headers) => {
    for (const cookie of cookiePairs(headers.get("cookie") ?? ""))
      if (!visibleCookies.has(cookie.name) && cookie.value.length >= 8) secrets.add(cookie.value);
    for (const line of headers.getSetCookie())
      for (const cookie of cookiePairs(line.split(";")[0] ?? ""))
        if (!visibleCookies.has(cookie.name) && cookie.value.length >= 8) secrets.add(cookie.value);
    for (const [name, value] of headers)
      if (/authorization|csrf|xsrf|auth-token/i.test(name)) {
        if (value.length >= 8) secrets.add(value);
        const token = value.split(/\s+/).at(-1);
        if (token && token.length >= 8) secrets.add(token);
      }
  };
  const redactKnown = (value: unknown): unknown => {
    if (typeof value === "string") {
      let text = value;
      for (const secret of [...secrets].sort((a, b) => b.length - a.length))
        for (const form of new Set([
          secret,
          encodeURIComponent(secret),
          JSON.stringify(secret).slice(1, -1),
        ]))
          text = text.split(form).join(redacted);
      return text;
    }
    if (Array.isArray(value)) return value.map(redactKnown);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactKnown(v)]));
    return value;
  };
  const recorded: Transport = async (input, init) => {
    signal?.throwIfAborted();
    const request = new Request(input, init);
    remember(request.headers);
    const started = performance.now();
    const mime = request.headers.get("content-type") ?? "";
    const body = request.body ? await request.clone().text() : undefined;
    const entry: HarEntry = {
      startedDateTime: new Date().toISOString(),
      time: 0,
      request: {
        method: request.method,
        url: safeUrl(request.url),
        httpVersion: "HTTP/1.1",
        headers: headersForHar(request.headers),
        cookies: cookiesForHar(cookiePairs(request.headers.get("cookie") ?? "")),
        queryString: [...new URL(safeUrl(request.url)).searchParams].map(([name, value]) => ({
          name,
          value,
        })),
        headersSize: -1,
        bodySize: body === undefined ? 0 : Buffer.byteLength(body),
        ...(body === undefined ? {} : { postData: { mimeType: mime, text: bodyText(body, mime) } }),
      },
      response: {
        status: 0,
        statusText: "",
        httpVersion: "HTTP/1.1",
        headers: [],
        cookies: [],
        content: { size: 0, mimeType: "", text: "" },
        redirectURL: "",
        headersSize: -1,
        bodySize: 0,
      },
      cache: {},
      timings: { send: 0, wait: 0, receive: 0 },
    };
    entries.push(entry);
    const combined = signal ? AbortSignal.any([signal, request.signal]) : request.signal;
    try {
      combined.throwIfAborted();
      const response = await transport(request, { signal: combined, redirect: "manual" });
      remember(response.headers);
      entry.timings.wait = performance.now() - started;
      entry.response.status = response.status;
      entry.response.statusText = response.statusText;
      entry.response.headers = headersForHar(response.headers);
      entry.response.cookies = cookiesForHar(
        response.headers.getSetCookie().flatMap((line) => cookiePairs(line.split(";")[0] ?? "")),
      );
      const location = response.headers.get("location");
      entry.response.redirectURL = location ? safeUrl(new URL(location, request.url).href) : "";
      const bytes = await readBody(response.clone(), combined);
      const responseMime = response.headers.get("content-type") ?? "application/octet-stream";
      const textual = /json|text|xml|javascript|x-www-form-urlencoded|multipart/i.test(
        responseMime,
      );
      entry.response.bodySize = bytes.length;
      entry.response.content = {
        size: bytes.length,
        mimeType: responseMime,
        text: textual
          ? bodyText(Buffer.from(bytes).toString("utf8"), responseMime)
          : Buffer.from(bytes).toString("base64"),
        ...(textual ? {} : { encoding: "base64" as const }),
      };
      combined.throwIfAborted();
      return response;
    } catch (error) {
      entry._capture_error = signal?.aborted
        ? "Task deadline reached."
        : "HTTP transport or HAR body capture failed.";
      throw error;
    } finally {
      entry.time = performance.now() - started;
      entry.timings.receive = Math.max(0, entry.time - entry.timings.wait);
    }
  };
  return {
    transport: recorded,
    entries,
    har: () => ({
      log: {
        version: "1.2",
        creator: { name: "@jeswr/webarena-bench", version: "0.1.0" },
        entries: redactKnown(entries) as HarEntry[],
      },
    }),
  };
}
