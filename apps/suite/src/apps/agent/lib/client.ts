// AUTHORED-BY Codex GPT-6.1-Sol
import { fromRdf, type PodRecord, type RecordType, recordFromTurtle } from "@jeswr/agent-model";
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch } from "@jeswr/guarded-fetch";
import { readContainerMembers } from "@jeswr/ldp-container";
import { Store } from "n3";
import type { PodSession } from "../../../lib/session/pod-session";
import { agentPaths } from "./paths";

export interface Loaded<T> {
  url: string;
  record: T;
  etag: string | null;
  verified: "unchecked";
}
export interface Unreadable {
  url: string;
  error: unknown;
}
export type Row<T> = Loaded<T> | Unreadable;
export const isLoaded = <T>(row: Row<T>): row is Loaded<T> => "record" in row;
export class ConflictError extends Error {
  constructor() {
    super("This record changed. Reload and try again.");
    this.name = "ConflictError";
  }
}
export class AgentReadError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Couldn't read the agent record (${status})`);
    this.status = status;
  }
}
const MAX_BYTES = 1024 * 1024;
async function boundedText(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_BYTES)
    throw new Error("Record exceeds 1 MiB");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) throw new Error("Record exceeds 1 MiB");
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
}
export function createAgentClient(options: {
  fetch: PodSession["fetch"];
  storage: string;
  workspace: string;
}) {
  const workspace = assertWithinPodScope(options.storage, options.workspace);
  const scoped = createPodScopedFetch(options.storage, { fetch: options.fetch, maxRedirects: 0 });
  const check = (url: string) =>
    assertWithinPodScope(workspace, assertWithinPodScope(options.storage, url));
  const document = async (url: string) => {
    const response = await scoped(check(url), {
      headers: { accept: "text/turtle, application/trig" },
    });
    if (!response.ok) throw new AgentReadError(response.status);
    return {
      text: await boundedText(response),
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
    };
  };
  const graph = async (url: string) => {
    const doc = await document(url);
    return { ...doc, dataset: await parseRdf(doc.text, doc.contentType, { baseIRI: url }) };
  };
  const write = async (
    url: string,
    body: string,
    contentType: string,
    condition: Record<string, string>,
  ) => {
    const response = await scoped(check(url), {
      method: "PUT",
      headers: { "content-type": contentType, ...condition },
      body,
    });
    if (response.status === 412) throw new ConflictError();
    if (!response.ok) throw new Error(`Couldn't save the record (${response.status})`);
    return response.headers.get("etag");
  };
  return {
    workspace,
    paths: agentPaths(workspace),
    graph,
    async list(container: string) {
      return (
        (await readContainerMembers(scoped, check(container), {
          scope: container,
          package: "agent",
        })) ?? []
      );
    },
    async read<T extends RecordType>(
      url: string,
      type: T,
    ): Promise<Loaded<Extract<PodRecord, { type: T }>>> {
      const doc = await document(url);
      const trig = doc.contentType?.split(";")[0]?.trim().toLowerCase() === "application/trig";
      if (!trig && doc.contentType?.split(";")[0]?.trim().toLowerCase() !== "text/turtle")
        throw new Error("Unsupported agent record format");
      const record = trig
        ? fromRdf(
            new Store(
              [...(await parseRdf(doc.text, "application/trig", { baseIRI: url }))].filter(
                (q) => q.graph.termType === "DefaultGraph",
              ),
            ),
            url,
          )
        : await recordFromTurtle(doc.text, url);
      if (record.type !== type) throw new Error("Unexpected agent record type");
      return {
        record: record as Extract<PodRecord, { type: T }>,
        etag: doc.etag,
        url,
        verified: "unchecked",
      };
    },
    create: (url: string, body: string, contentType = "text/turtle") =>
      write(url, body, contentType, { "if-none-match": "*" }),
    replace: (url: string, body: string, etag: string, contentType = "text/turtle") => {
      if (!etag.trim()) throw new Error("A validator is required to replace a record");
      return write(url, body, contentType, { "if-match": etag });
    },
  };
}
export type AgentClient = ReturnType<typeof createAgentClient>;
