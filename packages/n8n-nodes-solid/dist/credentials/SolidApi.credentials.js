"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// credentials/SolidApi.credentials.ts
var SolidApi_credentials_exports = {};
__export(SolidApi_credentials_exports, {
  SolidApi: () => SolidApi
});
module.exports = __toCommonJS(SolidApi_credentials_exports);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SolidApi
});
//# sourceMappingURL=SolidApi.credentials.js.map
