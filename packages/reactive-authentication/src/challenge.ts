/**
 * A parsed `WWW-Authenticate` challenge (RFC 9110 §11.6.1).
 *
 * Scheme and parameter names are lower-cased because they are case-insensitive.
 */
export interface AuthenticationChallenge {
  readonly scheme: string;
  readonly params: Readonly<Record<string, string>>;
  readonly token68?: string;
}

/** The response that triggered an upgrade and the challenges it carries. */
export interface ChallengeContext {
  readonly response: Response;
  readonly challenges: readonly AuthenticationChallenge[];
}

export function challengeContext(response: Response): ChallengeContext {
  return { response, challenges: parseChallenges(response.headers.get("WWW-Authenticate")) };
}

/** Finds the first challenge that carries all the given parameters, optionally restricted to a scheme. */
export function findChallenge(
  context: ChallengeContext | undefined,
  params: string[],
  scheme?: string,
): AuthenticationChallenge | undefined {
  return context?.challenges.find(
    (c) =>
      (scheme === undefined || c.scheme === scheme) &&
      params.every((p) => c.params[p] !== undefined),
  );
}

const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+/;
const token68 = /^[A-Za-z0-9\-._~+/]+=*/;
const whitespace = /^[ \t]*/;

/**
 * Parses a `WWW-Authenticate` field value into challenges.
 *
 * oauth4webapi contains an equivalent parser but does not export it, and the challenge must be read
 * before any provider (and therefore any OAuth library call) is chosen, hence this small parser.
 *
 * Fail-closed rules: a challenge with a duplicated parameter (ambiguous, forbidden by RFC 9110) is
 * dropped, and parsing stops at the first malformed challenge, keeping only complete challenges before it.
 * Callers must treat missing parameters as "no usable challenge" rather than guess.
 */
export function parseChallenges(header: string | null): AuthenticationChallenge[] {
  const challenges: AuthenticationChallenge[] = [];
  if (header === null) return challenges;

  const input = new Cursor(header);
  while (!input.done) {
    input.skip(/^[ \t,]*/);
    const scheme = input.take(token);
    if (scheme === undefined) break;

    const params: Record<string, string> = Object.create(null);
    let t68: string | undefined;
    input.skip(whitespace);

    const paramsStart = input.position;
    const candidate = input.take(token68);
    input.skip(whitespace);
    if (candidate !== undefined && !input.peek("=") && (input.done || input.peek(","))) {
      t68 = candidate;
    } else {
      input.position = paramsStart;
      const outcome = parseParams(input, params);
      if (outcome === "malformed") break;
      if (outcome === "ambiguous") continue;
    }

    challenges.push(
      t68 === undefined
        ? { scheme: scheme.toLowerCase(), params }
        : { scheme: scheme.toLowerCase(), params, token68: t68 },
    );
  }

  return challenges;
}

function parseParams(
  input: Cursor,
  params: Record<string, string>,
): "ok" | "ambiguous" | "malformed" {
  let ambiguous = false;
  while (!input.done) {
    const start = input.position;
    input.skip(/^[ \t,]*/);
    const name = input.take(token);
    input.skip(whitespace);
    if (name === undefined || !input.peek("=")) {
      // Not an auth-param: the next challenge starts here.
      input.position = start;
      return ambiguous ? "ambiguous" : "ok";
    }

    input.advance(1);
    input.skip(whitespace);
    const value = input.peek('"') ? input.quoted() : input.take(token);
    if (value === undefined) return "malformed";

    const key = name.toLowerCase();
    // RFC 9110: each parameter name MUST only occur once per challenge.
    if (Object.hasOwn(params, key)) ambiguous = true;
    params[key] = value;
    input.skip(whitespace);
    if (input.done) break;
    if (!input.peek(",")) return "malformed";
    input.advance(1);
  }
  return ambiguous ? "ambiguous" : "ok";
}

class Cursor {
  position = 0;

  constructor(private readonly text: string) {}

  get length() {
    return this.text.length;
  }

  get done() {
    return this.position >= this.length;
  }

  peek(char: string) {
    return this.text[this.position] === char;
  }

  advance(n: number) {
    this.position += n;
  }

  skip(pattern: RegExp) {
    this.take(pattern);
  }

  take(pattern: RegExp): string | undefined {
    const match = pattern.exec(this.text.slice(this.position));
    if (match === null || match[0].length === 0) return undefined;
    this.position += match[0].length;
    return match[0];
  }

  quoted(): string | undefined {
    let value = "";
    for (let i = this.position + 1; i < this.text.length; i++) {
      const char = this.text[i];
      if (char === "\\" && i + 1 < this.text.length) {
        value += this.text[++i];
      } else if (char === '"') {
        this.position = i + 1;
        return value;
      } else {
        value += char;
      }
    }
    return undefined;
  }
}
