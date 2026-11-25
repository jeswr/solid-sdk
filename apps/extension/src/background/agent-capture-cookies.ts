// AUTHORED-BY Codex GPT-6.1-Sol
import {
  captureOrigin,
  captureSchema,
  cookieDomainAllowed,
  type SessionCapture,
} from '@jeswr/agent-vault/browser';

/** Only cookies for the chosen host, or an explicitly vetted parent, survive the browser query. */
export function captureCookies(
  site: string,
  input: chrome.cookies.Cookie[],
  parents: readonly string[],
  now: number,
): SessionCapture['cookies'] {
  const url = new URL(captureOrigin(site));
  const cookies: SessionCapture['cookies'] = [];
  for (const c of input) {
    const domain = c.domain.replace(/^\./, '').toLowerCase();
    if (
      c.partitionKey ||
      !cookieDomainAllowed(url.hostname, domain, c.hostOnly, parents) ||
      (c.secure && url.protocol !== 'https:') ||
      (!c.session && (c.expirationDate === undefined || c.expirationDate * 1000 <= now))
    )
      continue;
    const sameSite =
      c.sameSite === 'strict'
        ? 'Strict'
        : c.sameSite === 'lax'
          ? 'Lax'
          : c.sameSite === 'no_restriction'
            ? 'None'
            : undefined;
    cookies.push({
      name: c.name,
      value: c.value,
      domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      hostOnly: c.hostOnly,
      ...(sameSite ? { sameSite } : {}),
      expires: c.session ? -1 : c.expirationDate,
    });
  }
  const result = captureSchema.safeParse({ site, cookies, capturedAt: now });
  if (!result.success) throw new Error('Sign-in sharing unavailable.');
  return result.data.cookies;
}
