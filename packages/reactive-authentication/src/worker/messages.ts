/*
 * Message protocol between a service worker and the window clients that provide user interaction.
 *
 * The worker sends a request with a dedicated MessagePort; the page answers once on that port. The worker
 * may send `cancel` on the port. Every message is validated on receipt: unknown shapes are dropped.
 */

export const REQUEST_TYPE = "reactive-authentication:request"

/** Interaction kinds a worker may ask a page for. */
export type InteractionKind = "code" | "issuer"

export interface InteractionRequest {
    readonly type: typeof REQUEST_TYPE
    readonly kind: InteractionKind
    /** Authorization request URL (`code`) or request URL needing an issuer (`issuer`). */
    readonly url: string
}

export type InteractionReply =
    | {readonly ok: true, readonly value: string}
    | {readonly ok: false, readonly name: string, readonly message: string}

export const CANCEL = {type: "cancel"} as const

/** Longest URL accepted in either direction. */
export const MAX_URL_LENGTH = 8192

export function isInteractionRequest(data: unknown): data is InteractionRequest {
    const d = data as Partial<InteractionRequest> | null
    return typeof d === "object" && d !== null && d.type === REQUEST_TYPE &&
        (d.kind === "code" || d.kind === "issuer") && isHttpUrl(d.url)
}

export function isInteractionReply(data: unknown): data is InteractionReply {
    const d = data as Record<string, unknown> | null
    if (typeof d !== "object" || d === null) return false
    if (d["ok"] === true) return isHttpUrl(d["value"])
    return d["ok"] === false && typeof d["name"] === "string" && typeof d["message"] === "string" &&
        (d["name"] as string).length < 256 && (d["message"] as string).length < 2048
}

function isHttpUrl(value: unknown): value is string {
    if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return false
    try {
        const url = new URL(value)
        return url.protocol === "https:" || url.protocol === "http:"
    } catch {
        return false
    }
}
