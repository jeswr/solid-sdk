// AUTHORED-BY Codex GPT-6.1-Sol
// Source APIs and public discovery use the pristine platform transport.
export const sourceFetch: typeof fetch = globalThis.fetch.bind(globalThis);
export const publicFetch: typeof fetch = (input, init) =>
  sourceFetch(input, { ...init, credentials: "omit" });
