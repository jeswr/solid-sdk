// AUTHORED-BY Codex GPT-6.1-Sol
/** Reject ambiguous URLs before WHATWG parsing can strip controls or reinterpret slashes. */
export function channelUrl(value: unknown): URL {
  if (
    typeof value !== "string" ||
    !/^(https?|wss?):\/\//i.test(value) ||
    value.includes("#") ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Validate before URL normalisation.
    /[\u0000-\u0020\\]/u.test(value) ||
    !URL.canParse(value)
  )
    throw new TypeError("Invalid notification URL");
  const url = new URL(value);
  if (url.username || url.password || url.hash) throw new TypeError("Invalid notification URL");
  return url;
}

function loopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/u.test(hostname);
}

/** Socket URLs are WS(S); HTTP endpoints are HTTP(S). Host includes the port. */
export function validateChannelUrl(
  value: unknown,
  root: string,
  service: string | undefined,
  socket: boolean,
  allowInsecureLoopback: boolean,
): string {
  const url = channelUrl(value);
  const storage = channelUrl(root);
  const secure = socket ? "wss:" : "https:";
  const insecure = socket ? "ws:" : "http:";
  if (
    url.protocol !== secure &&
    !(
      url.protocol === insecure &&
      allowInsecureLoopback &&
      loopback(storage.hostname) &&
      loopback(url.hostname)
    )
  )
    throw new TypeError("Invalid notification URL scheme");
  if (service !== undefined && url.host !== storage.host && url.host !== channelUrl(service).host)
    throw new TypeError("Invalid notification URL host");
  return url.href;
}
