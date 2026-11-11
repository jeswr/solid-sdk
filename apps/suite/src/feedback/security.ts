// AUTHORED-BY Codex GPT-6.1-Sol
import { isIP } from "node:net";

export type FeedbackEnv = Readonly<Record<string, string | undefined>>;
export class FeedbackError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}
export const json = (value: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store", ...extra } });
export function allowedOrigin(request: Request, env: FeedbackEnv): string | undefined {
  const origin = request.headers.get("origin");
  if (!origin) return undefined;
  const defaults = [
    new URL(request.url).origin,
    env.NEXT_PUBLIC_PUBLIC_SUITE_URL ?? "https://solid-suite.vercel.app",
    env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "",
  ];
  const list = env.FEEDBACK_ALLOWED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    (list ?? defaults).some((value) => {
      try {
        const u = new URL(value);
        return u.origin === "null" ? value.replace(/\/$/, "") === origin : u.origin === origin;
      } catch {
        return false;
      }
    })
  )
    return origin;
  if (!list) {
    try {
      const u = new URL(origin);
      if (
        ["http:", "https:"].includes(u.protocol) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
        u.origin === origin
      )
        return origin;
    } catch {
      /* Refuse malformed origins. */
    }
  }
  return undefined;
}
export function visitorKey(address: string): string {
  const bare = address.toLowerCase().split("%")[0] ?? "";
  if (isIP(bare) === 4) return bare;
  if (isIP(bare) !== 6) return "unknown";
  if (bare.includes(".")) {
    const ipv4 = bare.slice(bare.lastIndexOf(":") + 1);
    if (/^::ffff:/.test(bare)) return ipv4;
  }
  const [head = "", tail = ""] = bare.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  return `${[...front, ...Array<string>(8 - front.length - back.length).fill("0"), ...back]
    .slice(0, 4)
    .map((s) => s.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}
export function visitorOf(request: Request): string {
  // The deployment proxy must overwrite these headers; never expose the origin server directly.
  return visitorKey(
    request.headers.get("x-real-ip")?.trim() ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown",
  );
}
const DAY = 86_400_000;
export function createLimiter(
  now = Date.now,
  instanceCaps: { turn: number; submit: number; audio?: number } = { turn: 2000, submit: 200 },
) {
  const caps = { audio: 2000, ...instanceCaps };
  const visitors = new Map<string, { turn: number[]; submit: number[]; audio: number[] }>();
  let day = -1;
  let instance = { turn: 0, submit: 0, audio: 0 };
  return (key: string, kind: "turn" | "submit" | "audio"): number | undefined => {
    const t = now();
    if (Math.floor(t / DAY) !== day) {
      day = Math.floor(t / DAY);
      instance = { turn: 0, submit: 0, audio: 0 };
    }
    if (instance[kind] >= caps[kind]) return (day + 1) * DAY - t;
    // Fail closed at capacity rather than evicting active visitors and resetting allowances.
    for (const [id, v] of visitors)
      if (![...v.turn, ...v.submit, ...v.audio].some((at) => t - at < DAY)) visitors.delete(id);
    if (!visitors.has(key) && visitors.size >= 20_000) return 60_000;
    const v = visitors.get(key) ?? { turn: [], submit: [], audio: [] };
    v[kind] = v[kind].filter((at) => t - at < DAY);
    const windows =
      kind === "turn"
        ? [
            [600_000, 30],
            [DAY, 120],
          ]
        : [[3_600_000, kind === "audio" ? 20 : 5]];
    for (const [span = 0, limit = 0] of windows) {
      const recent = v[kind].filter((at) => t - at < span);
      if (recent.length >= limit) return span - (t - (recent[0] ?? t));
    }
    v[kind].push(t);
    visitors.set(key, v);
    instance[kind]++;
    return undefined;
  };
}
export async function readBody(request: Request, max: number): Promise<Uint8Array> {
  const length = Number(request.headers.get("content-length"));
  if (length > max)
    throw new FeedbackError(413, "This feedback is too large. Download it to keep a copy.");
  const reader = request.body?.getReader();
  if (!reader) throw new FeedbackError(400, "Send a request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new FeedbackError(413, "This feedback is too large. Download it to keep a copy.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export const rateLimiter = createLimiter();

// Shared by uploads and submissions, even though each request creates a fresh store.
export function createGithubBackoff(now = () => Date.now()) {
  const until = { core: 0, search: 0 };
  function check(resource: "core" | "search" = "core") {
    if (until[resource] > now())
      throw new FeedbackError(
        503,
        "Feedback storage is busy. Please try again later, or download your feedback to keep a copy.",
        Math.ceil((until[resource] - now()) / 1000),
      );
  }
  return {
    check,
    async observe(response: Response) {
      const resource =
        response.headers.get("x-ratelimit-resource") === "search" ? "search" : "core";
      const remaining = response.headers.get("x-ratelimit-remaining");
      const low =
        remaining !== null &&
        /^\d+$/.test(remaining) &&
        (resource === "search" ? Number(remaining) <= 5 : Number(remaining) < 50);
      const retry = response.headers.get("retry-after");
      let secondary = response.status === 429;
      if (response.status === 403) {
        const data = await response
          .clone()
          .json()
          .catch(() => ({}));
        secondary = retry !== null || /rate limit|abuse/i.test(String(data?.message ?? ""));
      }
      if (!low && !secondary) return;
      const t = now();
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      const retryAt = retry
        ? /^\d+$/.test(retry)
          ? t + Number(retry) * 1000
          : Date.parse(retry)
        : 0;
      const deadlines = [low ? reset : 0, retryAt].filter((at) => Number.isFinite(at) && at > t);
      // GitHub asks for at least a minute when a secondary limit has no retry header.
      until[resource] = Math.max(until[resource], ...(deadlines.length ? deadlines : [t + 60_000]));
      // Only an actual rate-limit failure interrupts an admitted submission;
      // ordinary responses (including the label fallback) can still finish.
      if (secondary || (response.status === 403 && low)) check(resource);
    },
  };
}
export const githubBackoff = createGithubBackoff();
