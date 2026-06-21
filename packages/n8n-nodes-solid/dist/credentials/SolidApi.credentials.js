// credentials/SolidApi.credentials.ts
var SolidApi = class {
  name = "solidApi";
  displayName = "Solid Pod (OIDC / Bearer) API";
  documentationUrl = "https://github.com/jeswr/n8n-nodes-solid#credentials";
  properties = [
    {
      displayName: "Pod Base URL",
      name: "podBaseUrl",
      type: "string",
      default: "",
      required: true,
      placeholder: "https://alice.pod.example/",
      description: "Base URL of the pod (or a sub-container of it). The node confines all reads and writes to URLs under this base. Must be an http(s) URL."
    },
    {
      displayName: "Access Token",
      name: "accessToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description: "A Solid-OIDC / bearer access token authorized for the pod. Sent as `Authorization: Bearer <token>`. P1 does not perform DPoP-bound proof-of-possession \u2014 see the node docs for the DPoP follow-up."
    }
  ];
  // n8n injects the token as a Bearer header on every authenticated request, so
  // the node's execute() code never touches the token (it cannot be logged).
  authenticate = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.accessToken}}"
      }
    }
  };
  // "Test" button: a HEAD/GET against the pod base should not 401 if the token is
  // valid. (A 404 on the base still proves the token was accepted, so n8n's
  // default test only fails the credential on auth errors.)
  test = {
    request: {
      baseURL: "={{$credentials.podBaseUrl}}",
      url: "",
      method: "GET",
      headers: {
        Accept: "text/turtle, application/ld+json;q=0.9"
      }
    }
  };
};
export {
  SolidApi
};
//# sourceMappingURL=SolidApi.credentials.js.map
