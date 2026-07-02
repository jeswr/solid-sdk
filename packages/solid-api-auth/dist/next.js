// src/next.ts
import {
  ApiAuthError,
  verifyRequest
} from "./index.js";
export * from "./index.js";
function apiAuthErrorToResponse(error) {
  if (error instanceof ApiAuthError) {
    const headers = new Headers({ "content-type": "application/json" });
    if (error.wwwAuthenticate !== void 0) {
      headers.set("WWW-Authenticate", error.wwwAuthenticate);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.statusCode,
      headers
    });
  }
  return new Response(JSON.stringify({ error: "Internal server error." }), {
    status: 500,
    headers: { "content-type": "application/json" }
  });
}
function verifyNextRequest(request, opts) {
  return verifyRequest(request.headers, request.method, request.url, opts);
}
function withOwnerAuth(handler, opts) {
  return async (request, ...args) => {
    let credentials;
    try {
      credentials = await verifyNextRequest(request, opts);
    } catch (error) {
      return apiAuthErrorToResponse(error);
    }
    return handler(request, credentials, ...args);
  };
}
export {
  apiAuthErrorToResponse,
  verifyNextRequest,
  withOwnerAuth
};
//# sourceMappingURL=next.js.map
