// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Solid node — a programmatic n8n community node that reads/writes a Solid
// pod over LDP from inside automation workflows.
//
// DESIGN DECISIONS (documented; see README + the design issue):
//   - PROGRAMMATIC node (not declarative): the Container -> List operation must
//     PARSE the RDF container listing (ldp:contains) via @jeswr/fetch-rdf, and the
//     write operations need conditional-request + scope-guard logic that the
//     declarative routing model cannot express. So the node implements `execute`.
//   - Operations: Resource {Read, Create, Update, Delete} + Container {List}.
//   - Transport: n8n's `httpRequestWithAuthentication` (n8n injects the Bearer
//     header from the SolidApi credential and owns the transport — the node's own
//     code never touches the token, so it cannot be logged).
//   - Safety: every target is resolved + scope-guarded to a URL under the
//     configured pod base (operations.ts -> scope.ts); http(s) only; Create uses
//     `If-None-Match: *` so it never silently overwrites.

import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import {
  createResource,
  deleteResource,
  listContainer,
  readResource,
  type SolidHttpRequest,
  type SolidHttpResponse,
  type SolidResult,
  type SolidTransport,
  updateResource,
} from "./operations.js";

export class Solid implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Solid",
    name: "solid",
    icon: "file:solid.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Read and write a Solid pod over LDP",
    defaults: { name: "Solid" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: "solidApi", required: true }],
    properties: [
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Resource",
            value: "resource",
            description: "A single LDP resource (a document)",
          },
          { name: "Container", value: "container", description: "An LDP container (a folder)" },
        ],
        default: "resource",
      },
      // --- Resource operations ---
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["resource"] } },
        options: [
          {
            name: "Read",
            value: "read",
            action: "Read a resource",
            description: "Get a resource's contents",
          },
          {
            name: "Create",
            value: "create",
            action: "Create a resource",
            description: "Create a new resource (fails if it already exists)",
          },
          {
            name: "Update",
            value: "update",
            action: "Update a resource",
            description: "Create or overwrite a resource",
          },
          {
            name: "Delete",
            value: "delete",
            action: "Delete a resource",
            description: "Delete a resource",
          },
        ],
        default: "read",
      },
      // --- Container operations ---
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["container"] } },
        options: [
          {
            name: "List",
            value: "list",
            action: "List a container",
            description: "List the direct members of a container (ldp:contains)",
          },
        ],
        default: "list",
      },
      // --- Target (all operations) ---
      {
        displayName: "Target",
        name: "target",
        type: "string",
        default: "",
        required: true,
        placeholder: "notes/today.ttl  (or an absolute URL under the pod base)",
        description:
          "The resource or container to act on. Either an absolute http(s) URL under the pod base, or a path relative to the pod base. Confined to the pod base — a target that escapes it is refused.",
      },
      // --- Body (Create / Update) ---
      {
        displayName: "Content",
        name: "content",
        type: "string",
        typeOptions: { rows: 5 },
        default: "",
        displayOptions: { show: { resource: ["resource"], operation: ["create", "update"] } },
        description: "The resource body to write",
      },
      {
        displayName: "Content Type",
        name: "contentType",
        type: "string",
        default: "text/turtle",
        displayOptions: { show: { resource: ["resource"], operation: ["create", "update"] } },
        description:
          "The Content-Type to store the body as (e.g. text/turtle, application/json, text/plain)",
      },
      // --- Conditional update (Update only) ---
      {
        displayName: "If-Match ETag",
        name: "ifMatch",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["resource"], operation: ["update"] } },
        description:
          "Optional. An ETag (from a prior Read) for a conditional, lost-update-safe write. If set and the resource changed, the update fails with 412.",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter("resource", i) as string;
        const operation = this.getNodeParameter("operation", i) as string;
        const target = this.getNodeParameter("target", i) as string;
        const credentials = await this.getCredentials("solidApi", i);
        const podBaseUrl = String(credentials.podBaseUrl ?? "");

        // The transport: one authenticated request via n8n's helper. n8n injects
        // the Bearer header from the SolidApi credential; the token never reaches
        // this code. `returnFullResponse` + `ignoreHttpStatusErrors` let the
        // operations map non-2xx statuses to Solid-aware results/errors.
        const request: SolidTransport = async (
          req: SolidHttpRequest,
        ): Promise<SolidHttpResponse> => {
          const options: IHttpRequestOptions = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            returnFullResponse: true,
            ignoreHttpStatusErrors: true,
            // SECURITY (wave-3 review): NEVER follow redirects on an
            // authenticated pod request. n8n's axios transport follows them by
            // default AND forwards credentials on cross-origin redirects
            // (`sendCredentialsOnCrossOriginRedirect` defaults to true), so a
            // poisoned in-pod resource answering `302 Location: https://evil…`
            // would exfiltrate the Bearer token. The 3xx comes back to the
            // operations, which refuse it fail-closed (assertNotRedirect).
            disableFollowRedirect: true,
            // Defence in depth: even if redirect-following is ever re-enabled,
            // never forward the credential across origins.
            sendCredentialsOnCrossOriginRedirect: false,
            // Always treat the body as raw text — Solid resources are opaque
            // bytes/RDF; we never want n8n to JSON-parse the body.
            json: false,
            ...(req.body !== undefined ? { body: req.body } : {}),
          };
          const response = (await this.helpers.httpRequestWithAuthentication.call(
            this,
            "solidApi",
            options,
          )) as { statusCode: number; headers: Record<string, string | undefined>; body: unknown };
          return {
            statusCode: response.statusCode,
            headers: normalizeHeaders(response.headers),
            body: bodyToString(response.body),
          };
        };

        const base = { podBaseUrl, target, request };

        if (resource === "resource") {
          if (operation === "read") {
            pushOne(out, await readResource(base), i);
          } else if (operation === "create") {
            pushOne(
              out,
              await createResource({
                ...base,
                content: this.getNodeParameter("content", i, "") as string,
                contentType: this.getNodeParameter("contentType", i, "text/turtle") as string,
              }),
              i,
            );
          } else if (operation === "update") {
            pushOne(
              out,
              await updateResource({
                ...base,
                content: this.getNodeParameter("content", i, "") as string,
                contentType: this.getNodeParameter("contentType", i, "text/turtle") as string,
                ifMatch: this.getNodeParameter("ifMatch", i, "") as string,
              }),
              i,
            );
          } else if (operation === "delete") {
            pushOne(out, await deleteResource(base), i);
          } else {
            throw new NodeOperationError(
              this.getNode(),
              `Unknown resource operation: ${operation}`,
              {
                itemIndex: i,
              },
            );
          }
        } else if (resource === "container") {
          if (operation === "list") {
            const { members, containerUrl } = await listContainer(base);
            if (members.length === 0) {
              pushOne(out, { containerUrl, members: [] }, i);
            } else {
              for (const m of members) {
                pushOne(out, m, i);
              }
            }
          } else {
            throw new NodeOperationError(
              this.getNode(),
              `Unknown container operation: ${operation}`,
              {
                itemIndex: i,
              },
            );
          }
        } else {
          throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, {
            itemIndex: i,
          });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({
            json: { error: (error as Error).message },
            pairedItem: { item: i },
          });
          continue;
        }
        // Preserve a real NodeOperationError; wrap a plain Error with item index.
        if (error instanceof NodeOperationError) {
          throw error;
        }
        throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
      }
    }

    return [out];
  }
}

/** Push a single result row with paired-item linkage back to the source item. */
function pushOne(out: INodeExecutionData[], json: SolidResult, itemIndex: number): void {
  out.push({ json: json as IDataObject, pairedItem: { item: itemIndex } });
}

/** Lower-case header keys; coerce array values to their first element. */
function normalizeHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (!headers) {
    return out;
  }
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

/** Coerce an n8n response body (string | Buffer | object) to text. */
function bodyToString(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (body == null) {
    return "";
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString("utf8");
  }
  if (typeof body === "object") {
    // n8n may have parsed a JSON-ish body despite json:false on some transports;
    // re-serialise so downstream RDF parse / passthrough sees the text.
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }
  return String(body);
}
