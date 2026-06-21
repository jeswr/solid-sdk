import { isContainerUrl, type ResolvedTarget } from "../../src/scope.js";
/** The operations the node supports, namespaced by resource. */
export type SolidResource = "resource" | "container";
export type ResourceOperation = "read" | "create" | "update" | "delete";
export type ContainerOperation = "list";
/** Minimal HTTP response shape the operations need from the transport. */
export interface SolidHttpResponse {
    /** HTTP status code. */
    statusCode: number;
    /** Response headers, lower-cased keys. */
    headers: Record<string, string | undefined>;
    /** Response body as text (the transport must return the body as a string). */
    body: string;
}
/** Minimal HTTP request the operations issue against the pod. */
export interface SolidHttpRequest {
    method: "GET" | "PUT" | "DELETE";
    url: string;
    headers: Record<string, string>;
    /** Request body (PUT only). */
    body?: string;
}
/**
 * The transport callback: perform one authenticated request and return the
 * response. MUST NOT throw on a non-2xx status — it returns the status so the
 * operations can map it to a Solid-aware error/result. (n8n's httpRequest is
 * configured with `returnFullResponse: true` + `ignoreHttpStatusErrors: true` to
 * satisfy this; see Solid.node.ts.)
 */
export type SolidTransport = (req: SolidHttpRequest) => Promise<SolidHttpResponse>;
/** Inputs shared by every operation, already validated/normalised. */
export interface SolidOperationInput {
    /** The configured pod base URL (raw, from the credential). */
    podBaseUrl: string;
    /** The workflow-supplied target (absolute URL or base-relative path). */
    target: string;
    /** The transport callback. */
    request: SolidTransport;
}
/** Read/Create/Update extra inputs. */
export interface ResourceWriteInput extends SolidOperationInput {
    /** The resource body to write (Create/Update). */
    content: string;
    /** The Content-Type to store (Create/Update). */
    contentType: string;
}
/** A normalised result row returned to n8n as item JSON. */
export interface SolidResult {
    [key: string]: unknown;
}
/**
 * Resolve + scope-guard a target against the pod base, returning the validated
 * absolute URL. Throws (fail-closed) if the target escapes the pod.
 */
export declare function scopedTarget(podBaseUrl: string, target: string): ResolvedTarget;
/** Resource -> Read: GET the resource, return its body + content-type + etag. */
export declare function readResource(input: SolidOperationInput): Promise<SolidResult>;
/**
 * Resource -> Create: PUT with `If-None-Match: *` so it fails (412) if the
 * resource already exists — Create never silently overwrites.
 */
export declare function createResource(input: ResourceWriteInput): Promise<SolidResult>;
/**
 * Resource -> Update: PUT, overwriting (or creating) the resource. If an
 * `ifMatch` etag is supplied, send `If-Match` for a conditional (lost-update-safe)
 * write.
 */
export declare function updateResource(input: ResourceWriteInput & {
    ifMatch?: string;
}): Promise<SolidResult>;
/** Resource -> Delete: DELETE the resource. A 404 is reported, not thrown. */
export declare function deleteResource(input: SolidOperationInput): Promise<SolidResult>;
/**
 * Container -> List: GET the container and parse its `ldp:contains` members via
 * `@jeswr/fetch-rdf` + `@solid/object`. Returns one result per member.
 */
export declare function listContainer(input: SolidOperationInput): Promise<{
    members: SolidResult[];
    containerUrl: string;
}>;
export { isContainerUrl };
//# sourceMappingURL=operations.d.ts.map