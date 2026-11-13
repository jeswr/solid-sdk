// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";
import { boundary, identifier, origin, parse, Secret, VaultError } from "./safe.js";
import { cookieSchema, type SessionBundle, type SessionStore, tokensSchema } from "./sessions.js";
export const captureSchema = z.strictObject({
  site: z.string(),
  account: identifier.optional(),
  cookies: z.array(cookieSchema).max(300),
  tokens: tokensSchema.optional(),
  capturedAt: z.number().finite().nonnegative(),
});
export type SessionCapture = z.infer<typeof captureSchema>;
/** Validate at the trusted extension/popup boundary. The host must authenticate the sender/tab. */
export function sessionCapture(input: unknown): Secret<SessionCapture> {
  return new Secret(parse(captureSchema, input));
}
export function acceptCapture(
  store: SessionStore,
  input: Secret<SessionCapture>,
  expected: { site: string; account: string },
  now: () => number = Date.now,
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
      await store.store({
        site,
        account: expected.account,
        bundle: { cookies: c.cookies },
        tokens: c.tokens,
        capturedAt: c.capturedAt,
        stale: false,
      });
      const result = await store.get(site, expected.account);
      if (!result) throw new VaultError("missing");
      return result;
    }),
  );
}
