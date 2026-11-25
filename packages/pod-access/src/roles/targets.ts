// AUTHORED-BY Claude Opus 5.5
// Extracted from requests-solid approval.ts (Codex GPT-6) so every grant path shares one check.

/**
 * Whether a grant may target `target` in `storage`. Refused: anything outside storage,
 * access-control and metadata documents (`.acl`, `.acr`, `.meta`), queries, fragments, empty
 * path segments, percent-encodings a server may decode into another name (unreserved
 * characters, `%`, `/`, `\`, control characters), the storage root (with or without its
 * trailing slash), the owner's `settings/` folder and every top-level folder named in
 * `reserved`, with everything under them, compared case-insensitively by decoded path, and path
 * segments ending in a dot or space or containing `::` (Windows aliases). Ordinary encoded names
 * (spaces, non-ASCII) stay grantable. The target is compared by its decoded path, never as a
 * raw string.
 */
export function isGrantableTarget(
  target: string,
  storage: string,
  reserved: readonly string[] = [],
): boolean {
  let url: URL;
  let base: URL;
  try {
    url = new URL(target);
    base = new URL(storage);
  } catch {
    return false;
  }
  const { pathname } = url;
  const ambiguous = [...pathname.matchAll(/%([0-9a-f]{2})/gi)].some(([, hex]) => {
    const code = Number.parseInt(hex as string, 16);
    return code < 0x20 || code === 0x7f || /[A-Za-z0-9\-._~%/\\]/.test(String.fromCharCode(code));
  });
  if (
    url.origin !== base.origin ||
    target.includes("?") ||
    target.includes("#") ||
    pathname.includes("//") ||
    ambiguous
  )
    return false;
  const path = decoded(pathname);
  const root = decoded(base.pathname);
  if (path === undefined || root === undefined || !root.endsWith("/") || !path.startsWith(root))
    return false;
  return !(
    /\.(acl|acr|meta)$/.test(path) ||
    // Windows backends drop a trailing dot or space and expose `name::$DATA` streams.
    /[. ](?:\/|$)|::/.test(path) ||
    path === root ||
    ["settings", ...reserved].some((name) => {
      const folder = `${root}${name.toUpperCase().toLowerCase()}`;
      return path === folder || path.startsWith(`${folder}/`);
    })
  );
}

/** The lower-cased decoded path, or undefined when its encoding is not valid UTF-8. */
function decoded(path: string): string | undefined {
  try {
    // Upper then lower case folds letters such as the long s into ASCII, as case-insensitive
    // filesystems do.
    return decodeURIComponent(path).toUpperCase().toLowerCase();
  } catch {
    return undefined;
  }
}
