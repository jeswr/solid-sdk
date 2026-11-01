// AUTHORED-BY Codex GPT-6.1-Sol
/** Bounded, standard base64 transport shared by the page, bridge and worker. */
export const MAX_BODY_BYTES = 25 * 1024 * 1024;
export const REQUEST_BODY_LIMIT_ERROR =
  'Request body exceeds the 25 MiB limit for extension fetches';
export const RESPONSE_BODY_LIMIT_ERROR =
  'Response body exceeds the 25 MiB limit for extension fetches';

export function assertBodySize(size: number, error = REQUEST_BODY_LIMIT_ERROR): void {
  if (size > MAX_BODY_BYTES) throw new Error(error);
}

/** Check encoded length BEFORE inspecting characters or allocating decoded bytes. */
export function decodedBase64Length(length: number, padding: number): number {
  assertBodySize((length / 4) * 3 - padding);
  if (length % 4 !== 0 || padding < 0 || padding > 2 || padding > length)
    throw new Error('Invalid base64 body');
  return (length / 4) * 3 - padding;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function validateBase64(value: string): void {
  // Even two padding characters cannot make a longer encoding fit the raw-byte limit.
  assertBodySize((value.length / 4) * 3 - 2);
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  decodedBase64Length(value.length, padding);
  const end = value.length - padding;
  if (
    /[^A-Za-z0-9+/=]/.test(value) ||
    (value.indexOf('=') !== -1 && value.indexOf('=') !== end) ||
    (padding > 0 && (ALPHABET.indexOf(value[end - 1]) & (padding === 2 ? 15 : 3)) !== 0)
  )
    throw new Error('Invalid base64 body');
}

export function bytesToBase64(bytes: Uint8Array): string {
  assertBodySize(bytes.byteLength);
  const chunks: string[] = [];
  // A multiple of three keeps every non-final chunk unpadded; bounded spread avoids
  // argument-stack overflow even at the body-size limit.
  for (let offset = 0; offset < bytes.length; offset += 24_576)
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))));
  return chunks.join('');
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  validateBase64(value);
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Validate untrusted wire fields without allocating a binary body. */
export function validateBodyFields(body: unknown, bodyBase64: unknown): void {
  if (
    (body !== undefined && typeof body !== 'string') ||
    (bodyBase64 !== undefined && typeof bodyBase64 !== 'string') ||
    (body !== undefined && bodyBase64 !== undefined)
  )
    throw new Error('Extension fetch body and bodyBase64 must be mutually exclusive strings');
  if (typeof body === 'string') {
    assertBodySize(body.length);
    assertBodySize(new TextEncoder().encode(body).byteLength);
  }
  if (typeof bodyBase64 === 'string') validateBase64(bodyBase64);
}

/** Preserve UTF-8 text on the existing wire path; everything else stays byte-exact. */
export function encodeResponseBody(
  bytes: Uint8Array,
  contentType: string | null,
): { body: string } | { bodyBase64: string } {
  assertBodySize(bytes.byteLength, RESPONSE_BODY_LIMIT_ERROR);
  const mime = contentType?.split(';', 1)[0].trim().toLowerCase();
  const textual =
    !mime ||
    mime.startsWith('text/') ||
    /\+(json|xml)$/.test(mime) ||
    [
      'application/json',
      'application/xml',
      'application/n-triples',
      'application/n-quads',
      'application/trig',
      'application/javascript',
    ].includes(mime);
  if (textual) {
    try {
      return { body: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    } catch {
      // Invalid UTF-8 must never be replaced with lossy U+FFFD characters.
    }
  }
  return { bodyBase64: bytesToBase64(bytes) };
}
