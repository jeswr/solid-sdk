// AUTHORED-BY Codex GPT-6.1-Sol
import { fromRdf, type PodRecord, type RecordType, recordFromTurtle } from "@jeswr/agent-model";
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch } from "@jeswr/guarded-fetch";
import { parseContainerMembers } from "@jeswr/ldp-container";
import { Store } from "n3";
import type { PodSession } from "../../../lib/session/pod-session";
import { agentPaths } from "./paths";
import { readRdfDocument } from "./rdf";
import type { Verification } from "./verify";

export interface Loaded<T> {
  url: string;
  record: T;
  etag: string | null;
  verified: Verification;
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
    return readRdfDocument(response);
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
      try {
        const doc = await graph(container);
        return parseContainerMembers(doc.dataset, container, { scope: container });
      } catch (error) {
        if (error instanceof AgentReadError && (error.status === 404 || error.status === 410))
          return [];
        throw error;
      }
    },
    async read<T extends RecordType>(
      url: string,
      type: T,
    ): Promise<Loaded<Extract<PodRecord, { type: T }>>> {
      const doc = await document(url);
      const trig = doc.contentType === "application/trig";
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
