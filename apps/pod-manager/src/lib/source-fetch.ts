// AUTHORED-BY Codex GPT-6.1-Sol
// Imported by SessionProvider before its auth effect can patch the global fetch.
// Source APIs and OAuth token exchange must always bypass the Pod auth manager.
export const sourceFetch: typeof fetch = globalThis.fetch.bind(globalThis);
