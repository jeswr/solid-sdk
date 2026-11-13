// AUTHORED-BY Codex GPT-6.1-Sol
function container(storage: string, path: string): string {
  try {
    const url = new URL(storage);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !storage.endsWith("/") ||
      storage !== url.href
    )
      throw new Error();
    return new URL(`private/pkg/${path}/`, url).href;
  } catch {
    throw new Error("Invalid storage container");
  }
}

export const connectionsContainer = (storage: string): string => container(storage, "clients");
export const auditContainer = (storage: string): string => container(storage, "audit");
export const auditChainContainer = (storage: string): string => container(storage, "audit-chain");
