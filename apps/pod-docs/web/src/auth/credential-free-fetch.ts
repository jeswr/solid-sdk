// AUTHORED-BY Codex GPT-6
/** Honor anonymous requests before the proactive token wrapper can upgrade them. */
export function respectOmittedCredentials(
  authenticatedFetch: typeof fetch,
  pristineFetch: typeof fetch,
): typeof fetch {
  return (input, init) => {
    const request = new Request(input, init);
    return request.credentials === "omit" ? pristineFetch(request) : authenticatedFetch(request);
  };
}
