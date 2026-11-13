// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { captureSchema, type SessionCapture } from "./browser.js";
import { boundary, origin, parse, Secret, VaultError } from "./safe.js";
import type { LoginTransaction, SessionBundle, SessionStore } from "./sessions.js";

export { captureSchema, type SessionCapture } from "./browser.js";
/** Validate at the trusted extension/popup boundary. The host must authenticate the sender/tab. */
export function sessionCapture(input: unknown): Secret<SessionCapture> {
  return new Secret(parse(captureSchema, input));
}
export function acceptCapture(
  store: SessionStore,
  input: Secret<SessionCapture>,
  expected: LoginTransaction,
  now: () => number = Date.now,
  source?: "browser-capture",
): Promise<SessionBundle> {
  return boundary(() =>
    input.use(async (raw) => {
      const c = parse(captureSchema, raw);
      const site = origin(c.site);
      if (
        site !== origin(expected.site) ||
        (c.account && c.account !== expected.account) ||
        c.capturedAt > now() + 30000 ||
        c.capturedAt < now() - 300000
      )
        throw new VaultError("invalid");
      await store.storeCapture(
        {
          site,
          account: expected.account,
          bundle: { cookies: c.cookies },
          tokens: c.tokens,
          capturedAt: c.capturedAt,
          stale: false,
          origin: source,
        },
        expected,
      );
      const result = await store.get(site, expected.account, expected.generation);
      if (!result) throw new VaultError("missing");
      return result;
    }),
  );
}
