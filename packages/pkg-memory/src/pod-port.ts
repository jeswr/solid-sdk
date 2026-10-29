// AUTHORED-BY Codex GPT-6.1-Sol
/** Structural MCP DESIGN §3 seam; compatible with @jeswr/solid-mcp's PodPort. */
export interface PodPort {
  readonly root: string;
  readonly webId: string;
  read(url: string): Promise<{ body: Uint8Array; contentType: string; etag?: string }>;
  list(container: string): Promise<{ url: string; isContainer: boolean }[]>;
  write(
    url: string,
    body: Uint8Array,
    contentType: string,
    cond: PodConditions,
  ): Promise<{ etag?: string }>;
  delete(url: string, cond?: PodConditions): Promise<void>;
}
/** Conditional PodPort mutations. */
export interface PodConditions {
  ifMatch?: string;
  ifNoneMatch?: "*";
}

/** Read status from test/backend errors or the existing fetch PodPort's errors. */
export function podStatus(error: unknown): number | undefined {
  if (
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
  )
    return error.status;
  if (error instanceof Error) {
    const match = /\bHTTP (\d{3})\b/.exec(error.message);
    if (match) return Number(match[1]);
  }
  return undefined;
}
