// AUTHORED-BY Codex GPT-6.1-Sol
/** Detect percent-encoded RFC 3986 unreserved characters, slashes, backslashes or percent.
 * These aliases depend on how often a server decodes a path. Inspect before URL normalisation. */
export function encodesPlainCharacter(target: string): boolean {
  for (const [, hex] of target.matchAll(/%([\da-f]{2})/giu)) {
    if (/[A-Za-z0-9._~%/\\-]/u.test(String.fromCharCode(Number.parseInt(hex as string, 16))))
      return true;
  }
  return false;
}

/** Detect ambiguous resource identifiers before URL normalisation, including encoded delimiters. */
export function isAmbiguousResourceTarget(target: string): boolean {
  return (
    /[;?#\\]/u.test(target) ||
    /[. ](?:\/|$)/u.test(target) ||
    encodesPlainCharacter(target) ||
    /%(?:3b|3f|23)/iu.test(target) ||
    /%20(?:\/|$)/iu.test(target)
  );
}

/** Refuse auxiliary suffixes (.acl/.acr/.meta, case-insensitive and slash-tolerant)
 * and every ambiguous identifier recognised by isAmbiguousResourceTarget. This is a
 * conservative lexical guard, not discovery: arbitrary auxiliary URLs also require Link metadata. */
export function isAuxiliaryResourceTarget(target: string): boolean {
  return isAmbiguousResourceTarget(target) || /\.(acl|acr|meta)\/*$/iu.test(target);
}
