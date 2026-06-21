// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SolidApi credential — the P1 credential shape for the Solid node.
//
// DESIGN DECISION (documented; see README and the design issue):
//   P1 stores a pod base URL + an OIDC/bearer ACCESS TOKEN. This is the simplest
//   credential n8n's model can hold and inject, and it works against any Solid
//   server that accepts a Bearer access token on the resource (RFC 6750). The
//   token is injected by n8n via the `authenticate` block (an `Authorization:
//   Bearer …` header) using `httpRequestWithAuthentication`, so the node's own
//   `execute` code NEVER reads the token — it cannot be logged or leaked by node
//   logic.
//
//   FOLLOW-UP (NOT P1): full DPoP-bound Solid-OIDC. DPoP requires a fresh,
//   per-request signed proof (htu/htm/ath bound to the exact method+URL+token),
//   which n8n's declarative `authenticate` model (static header templating) cannot
//   express. The seam for it is a future programmatic credential composing
//   `@jeswr/solid-dpop` + `@jeswr/solid-openid-client` to (a) exchange a stored
//   refresh token for a short-lived access token and (b) compute the DPoP proof
//   per request inside the node. Tracked as a documented follow-up, not a gap in
//   P1.

import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

export class SolidApi implements ICredentialType {
  name = "solidApi";

  displayName = "Solid Pod (OIDC / Bearer) API";

  documentationUrl = "https://github.com/jeswr/n8n-nodes-solid#credentials";

  properties: INodeProperties[] = [
    {
      displayName: "Pod Base URL",
      name: "podBaseUrl",
      type: "string",
      default: "",
      required: true,
      placeholder: "https://alice.pod.example/",
      description:
        "Base URL of the pod (or a sub-container of it). The node confines all reads and writes to URLs under this base. Must be an http(s) URL.",
    },
    {
      displayName: "Access Token",
      name: "accessToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description:
        "A Solid-OIDC / bearer access token authorized for the pod. Sent as `Authorization: Bearer <token>`. P1 does not perform DPoP-bound proof-of-possession — see the node docs for the DPoP follow-up.",
    },
  ];

  // n8n injects the token as a Bearer header on every authenticated request, so
  // the node's execute() code never touches the token (it cannot be logged).
  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.accessToken}}",
      },
    },
  };

  // "Test" button: a HEAD/GET against the pod base should not 401 if the token is
  // valid. (A 404 on the base still proves the token was accepted, so n8n's
  // default test only fails the credential on auth errors.)
  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials.podBaseUrl}}",
      url: "",
      method: "GET",
      headers: {
        Accept: "text/turtle, application/ld+json;q=0.9",
      },
    },
  };
}
