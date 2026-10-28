// AUTHORED-BY Codex
/**
 * A document incarnation is its URL plus its assigned instance id. A readable
 * slug, log path or absent legacy id never proves continuity. Claim legacy ids
 * with If-Match before opening for edits; compare before adopting remote state
 * or writing, and recover edits on mismatch. Mirrors (including pending edits)
 * additionally include the log generation, so reused URLs cannot merge histories.
 */
interface Incarnation {
  url: string;
  data: { instanceId?: string | undefined };
}

export function sameIncarnation(previous: Incarnation, next: Incarnation): boolean {
  return (
    previous.url === next.url &&
    previous.data.instanceId !== undefined &&
    previous.data.instanceId === next.data.instanceId
  );
}

export function incarnationMirror(document: Incarnation, container: string): string {
  if (!document.data.instanceId)
    throw new Error("Claim the document identity before opening its mirror");
  return `suite.docs:${JSON.stringify([document.url, document.data.instanceId, container])}`;
}

export class DocumentReplacedError extends Error {
  readonly status = 409;
  constructor() {
    super("The document was replaced at this location");
  }
}
