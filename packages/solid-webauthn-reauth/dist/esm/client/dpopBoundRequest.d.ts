import * as oauth from "oauth4webapi";
/**
 * Return `request` upgraded with a resource-bound DPoP proof + `Authorization:
 * DPoP <token>`, using the `oauth4webapi` {@link oauth.DPoPHandle}.
 *
 * Reused verbatim (style-normalised) from the `reactive-authentication-js`
 * fork's `dpopBoundRequest.ts`: the handle computes the proof's `htu`
 * (query/fragment stripped, RFC 9449 §4.2) and `ath` (access-token hash)
 * correctly, so there is no hand-rolled proof generation. We drive
 * {@link oauth.protectedResourceRequest} but intercept the outbound request via
 * {@link oauth.customFetch}, copying its computed headers onto the upgraded
 * request rather than sending it.
 */
export declare function dpopBoundRequest(request: Request, accessToken: string, dpop: oauth.DPoPHandle): Promise<Request>;
//# sourceMappingURL=dpopBoundRequest.d.ts.map