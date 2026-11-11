// AUTHORED-BY Codex GPT-6.1-Sol
/** Node-only HTTP fixture helpers. Import this subpath only in tests/conformance runners. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toBytes } from "./internal.js";
import type { AuthFetch } from "./types.js";

/** Header names are normalised to lowercase; credential headers are omitted on both sides. */
export type FixtureHeaders = readonly (readonly [string, string])[];

/** Versioned, JSON-safe request/response pair. Bodies are base64 bytes, or null for no body. */
export interface HttpFixture {
  version: 1;
  request: {
    method: string;
    url: string;
    headers: FixtureHeaders;
    body: string | null;
  };
  response: {
    url: string;
    status: number;
    statusText: string;
    headers: FixtureHeaders;
    body: string | null;
    redirected: boolean;
  };
}

/** Options for recording one ordered scenario into a dedicated directory. */
export interface RecordingFetchOptions {
  fetch: AuthFetch;
  directory: string;
}

const PRIVATE_HEADERS = new Set([
  "authorization",
  "dpop",
  "set-cookie",
  "cookie",
  "proxy-authorization",
]);

function publicHeaders(headers: Headers): FixtureHeaders {
  return [...headers].filter(([name]) => !PRIVATE_HEADERS.has(name));
}

function requestOf(input: Parameters<AuthFetch>[0], init?: RequestInit): Request {
  // Clone only inherited bodies; replacements must also work on consumed Request inputs.
  // A single effective Request also preserves init overrides and multipart boundaries.
  const source =
    input instanceof Request && (init?.body === undefined || init.body === null)
      ? input.clone()
      : input;
  return new Request(source, {
    ...init,
    duplex: "half",
  } as RequestInit);
}

async function bodyOf(value: Request | Response, signal: AbortSignal): Promise<string | null> {
  if (value.body === null) return null;
  const bytes = await toBytes(value.body, signal);
  signal.throwIfAborted();
  return Buffer.from(bytes).toString("base64");
}

/**
 * Wrap an injected fetch only when RECORD=1 at construction time (otherwise return it unchanged).
 * Write 000001.json, 000002.json, … in invocation order, exclusively: existing files are never
 * overwritten. Use a fresh directory per scenario/recorder. The effective Request is forwarded
 * with its credentials intact; only the persisted copy is redacted. Bodies are buffered on this
 * opt-in test path; the returned original Response remains readable, with its URL and headers intact.
 * Network/body failures produce no fixture; filesystem failures reject the call.
 */
export function createRecordingFetch(options: RecordingFetchOptions): AuthFetch {
  if (process.env.RECORD !== "1") return options.fetch;
  let sequence = 0;
  return async (input, init) => {
    const file = `${String(++sequence).padStart(6, "0")}.json`;
    const request = requestOf(input, init);
    request.signal.throwIfAborted();
    const requestBody = await bodyOf(request.clone(), request.signal);
    request.signal.throwIfAborted();
    const response = await options.fetch(request);
    const fixture: HttpFixture = {
      version: 1,
      request: {
        method: request.method,
        url: request.url,
        headers: publicHeaders(request.headers),
        body: requestBody,
      },
      response: {
        url: response.url || request.url,
        status: response.status,
        statusText: response.statusText,
        headers: publicHeaders(response.headers),
        body: await bodyOf(response.clone(), request.signal),
        redirected: response.redirected,
      },
    };
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    await writeFile(
      join(options.directory, file),
      `${JSON.stringify(fixtureOf(fixture), null, 2)}\n`,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    return response;
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}

function body(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && Buffer.from(value, "base64").toString("base64") === value)
  );
}

function headers(value: unknown): value is FixtureHeaders {
  return (
    Array.isArray(value) &&
    value.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        typeof pair[0] === "string" &&
        typeof pair[1] === "string",
    )
  );
}

/** Validate and copy data, omitting all unknown fields and private headers before use. */
function fixtureOf(value: unknown): HttpFixture {
  const invalid = () => new TypeError("Invalid HTTP fixture");
  if (!object(value) || value.version !== 1) throw invalid();
  const req = value.request;
  const res = value.response;
  if (
    !object(req) ||
    !object(res) ||
    typeof req.method !== "string" ||
    !httpUrl(req.url) ||
    !httpUrl(res.url) ||
    !headers(req.headers) ||
    !headers(res.headers) ||
    !body(req.body) ||
    !body(res.body) ||
    !Number.isInteger(res.status) ||
    (res.status as number) < 200 ||
    (res.status as number) > 599 ||
    typeof res.statusText !== "string" ||
    typeof res.redirected !== "boolean" ||
    ([204, 205, 304].includes(res.status as number) && res.body !== null)
  ) {
    throw invalid();
  }
  // Fetch constructors validate HTTP method tokens, header fields and status text too.
  try {
    const request = new Request(req.url, {
      method: req.method,
      headers: req.headers as [string, string][],
    });
    if (
      (request.method === "HEAD" && res.body !== null) ||
      (["GET", "HEAD"].includes(request.method) && req.body !== null)
    )
      throw invalid();
    const response = new Response(null, {
      status: res.status as number,
      statusText: res.statusText,
      headers: res.headers as [string, string][],
    });
    return {
      version: 1,
      request: {
        method: request.method,
        url: request.url,
        headers: publicHeaders(request.headers),
        body: req.body,
      },
      response: {
        url: new URL(res.url).href,
        status: response.status,
        statusText: response.statusText,
        headers: publicHeaders(response.headers),
        body: res.body,
        redirected: res.redirected,
      },
    };
  } catch {
    throw invalid();
  }
}

/** Load a scenario's numbered JSON files in invocation order, validating the version and shape. */
export async function loadFixtures(directory: string): Promise<HttpFixture[]> {
  const files = (await readdir(directory)).filter((file) => /^\d{6,}\.json$/.test(file));
  files.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return Promise.all(
    files.map(async (file) => fixtureOf(JSON.parse(await readFile(join(directory, file), "utf8")))),
  );
}

/** An offline fetch with an explicit assertion that every expected exchange was consumed. */
export type ReplayFetch = AuthFetch & { assertDone(): void };

function withResponseMetadata(response: Response, recorded: HttpFixture["response"]): Response {
  return Object.defineProperties(response, {
    url: { value: recorded.url },
    redirected: { value: recorded.redirected },
    clone: {
      value(this: Response): Response {
        // Native cloning keeps stream teeing, headers and body-used checks intact.
        return withResponseMetadata(Response.prototype.clone.call(this), recorded);
      },
    },
  });
}

/**
 * Replay an ordered scenario without network access. Match URL, method, public headers and exact
 * body bytes; credentials are ignored. Mismatches/extra calls throw without echoing request data.
 * A mismatch does not consume an entry. Calls are serialised in invocation order. Each response is
 * fresh and preserves the recorded URL, redirect flag and bytes (including binary/empty bodies).
 */
export function createReplayFetch(fixtures: readonly HttpFixture[]): ReplayFetch {
  const entries = fixtures.map(fixtureOf);
  let position = 0;
  let queue = Promise.resolve();
  const replay: AuthFetch = async (input, init) => {
    const request = requestOf(input, init);
    const result = queue.then(async () => {
      request.signal.throwIfAborted();
      const entry = entries[position];
      if (!entry) throw new Error("HTTP fixture replay exhausted");
      const actual = {
        method: request.method,
        url: request.url,
        headers: publicHeaders(request.headers),
        body: await bodyOf(request, request.signal),
      };
      request.signal.throwIfAborted();
      if (JSON.stringify(actual) !== JSON.stringify(entry.request)) {
        throw new Error(`HTTP fixture request mismatch at exchange ${position + 1}`);
      }
      position++;
      const response = new Response(
        entry.response.body === null ? null : Buffer.from(entry.response.body, "base64"),
        {
          status: entry.response.status,
          statusText: entry.response.statusText,
          headers: entry.response.headers as [string, string][],
        },
      );
      return withResponseMetadata(response, entry.response);
    });
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return Object.assign(replay, {
    assertDone() {
      if (position !== entries.length) throw new Error("HTTP fixture replay has unused exchanges");
    },
  });
}
