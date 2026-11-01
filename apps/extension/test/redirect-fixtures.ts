/** Chrome's manual redirects expose neither status, headers nor a target URL. */
export function opaqueRedirect(): Response {
  const response = Response.error();
  Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
  return response;
}

/** Only the credential-free, browser-followed probe exposes the final URL. */
export function redirectProbe(url: string, redirected = true): Response {
  const response = new Response(null);
  Object.defineProperties(response, {
    url: { value: url },
    redirected: { value: redirected },
  });
  return response;
}
