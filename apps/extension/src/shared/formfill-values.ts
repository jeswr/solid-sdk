// AUTHORED-BY Codex GPT-6.1-Sol
/** Maximum UTF-16 code units in any extracted or written form-fill value. Oversized values are skipped. */
export const MAX_FORM_FILL_VALUE_LENGTH = 256;

export type CommunicationKind = 'email' | 'tel';

// RFC 5322-lite: one dot-atom mailbox at a DNS domain; no display names, lists or URI queries.
const EMAIL =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/** Strip the matching scheme, decode mailto addresses once, then validate the bounded scalar. */
export function communicationValue(value: string, kind: CommunicationKind): string | null {
  const scheme = kind === 'email' ? 'mailto:' : 'tel:';
  const trimmed = value.trim();
  const hasScheme = trimmed.toLowerCase().startsWith(scheme);
  let result = hasScheme ? trimmed.slice(scheme.length).trim() : trimmed;
  if (kind === 'email' && hasScheme) {
    // URI queries/fragments are not mailboxes; encoded punctuation belongs to the address.
    if (/[?#]/.test(result)) return null;
    try {
      result = decodeURIComponent(result);
    } catch {
      return null;
    }
  }
  if (result.length > MAX_FORM_FILL_VALUE_LENGTH) return null;
  const valid =
    kind === 'email'
      ? EMAIL.test(result) && !/\s/.test(result)
      : /^[0-9+(). -]+$/.test(result) && /[0-9]/.test(result);
  return valid ? result : null;
}
