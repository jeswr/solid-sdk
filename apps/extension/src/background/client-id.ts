// AUTHORED-BY GPT-6.1-Sol (Codex)
/** Client ID Document metadata comes from the build's single template. */
export { CLIENT_ID_SCOPE, PUBLISHED_CLIENT_ID_URL } from './client-id-template';

/**
 * Check that the hosted HTTPS document self-references its exact URL. Failure never
 * selects DCR: auth-flow.ts reports an error when clientIdMode is 'document'.
 */
export async function isPublishedClientIdReachable(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    if (new URL(url).protocol !== 'https:') return false;
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/ld+json, application/json' },
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) return false;
    const doc: unknown = await response.json();
    return typeof doc === 'object' && doc !== null && 'client_id' in doc && doc.client_id === url;
  } catch {
    return false;
  }
}
