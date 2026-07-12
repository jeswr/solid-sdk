// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md

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
export async function dpopBoundRequest(
  request: Request,
  accessToken: string,
  dpop: oauth.DPoPHandle,
): Promise<Request> {
  const headers = new Headers(request.headers);
  await oauth.protectedResourceRequest(
    accessToken,
    request.method,
    new URL(request.url),
    undefined,
    undefined,
    {
      DPoP: dpop,
      signal: request.signal,
      [oauth.customFetch]: (_url, init) => {
        new Headers(init.headers).forEach((value, name) => {
          headers.set(name, value);
        });
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    },
  );
  return new Request(request, { headers });
}
