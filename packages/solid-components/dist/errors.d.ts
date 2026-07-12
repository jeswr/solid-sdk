/** Shared base so `instanceof DataControllerError` catches the whole taxonomy. */
export declare abstract class DataControllerError extends Error {
    /** The resource URL the failing read targeted. */
    readonly url: string;
    /** The HTTP status, when the failure came from a response (else undefined). */
    readonly status?: number;
    protected constructor(message: string, url: string, options?: {
        status?: number;
        cause?: unknown;
    });
}
/** The resource does not exist (404 / 410). A consumer may create it. */
export declare class NotFoundError extends DataControllerError {
    constructor(url: string, options?: {
        status?: number;
        cause?: unknown;
    });
}
/** Authentication is required or the agent is forbidden (401 / 403). */
export declare class AccessDeniedError extends DataControllerError {
    constructor(url: string, options?: {
        status?: number;
        cause?: unknown;
    });
}
/** A transport-level failure, an abort, or a non-2xx that is not 401/403/404/410. */
export declare class NetworkError extends DataControllerError {
    constructor(url: string, options?: {
        status?: number;
        cause?: unknown;
    });
}
/** A 2xx response whose body could not be parsed as the requested representation. */
export declare class DataFormatError extends DataControllerError {
    constructor(url: string, options?: {
        status?: number;
        cause?: unknown;
    });
}
/**
 * Map an arbitrary failure (a `@jeswr/fetch-rdf` `RdfFetchError`, a thrown
 * `Response`-shaped object, an `AbortError`, or any other error) onto the
 * 4-class taxonomy. Centralised so every read path classifies identically.
 *
 * `status` (when known) drives the choice: 404/410 → NotFound, 401/403 → Denied,
 * any other non-2xx → Network. A 2xx that threw is a parse failure → DataFormat.
 * No status at all is a transport failure → Network.
 */
export declare function classifyReadError(url: string, error: unknown, hints?: {
    status?: number;
    parsed?: boolean;
}): DataControllerError;
