#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const clientIdPath = "/.well-known/solid-client-id.jsonld";
const oidcContext = "https://www.w3.org/ns/solid/oidc-context.jsonld";
const federationTerms = ["sector", "access", "consumes", "produces", "declaresShape"];
const accessModes = ["Read", "Write", "Append", "Control"].map(
  (mode) => `http://www.w3.org/ns/auth/acl#${mode}`,
);

class ConfigError extends TypeError {}

function object(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new ConfigError(`${label} must be an object containing only documented fields`);
}

function url(value, label, protocols = ["https:"], fragment = false) {
  const fail = () => {
    throw new ConfigError(`${label} must be an absolute URL with no credentials or unsafe syntax`);
  };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject hidden URL syntax before parsing.
  if (typeof value !== "string" || /[\s\\<>"\u0000-\u001f\u007f]/u.test(value)) fail();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail();
  }
  if (
    !protocols.includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    (!fragment && value.includes("#")) ||
    parsed.href !== value
  )
    fail();
  return parsed;
}

function urls(value, label, validate, required = false) {
  if (!Array.isArray(value) || (required && value.length === 0))
    throw new ConfigError(`${label} must be ${required ? "a non-empty" : "an"} array of URLs`);
  // Validate each value before deduplicating; never normalize a redirect URI.
  for (const entry of value) validate(entry);
  return [...new Set(value)];
}

/** Build public metadata only. No network, environment lookup, registration or token handling. */
export function createClientIdDocument(config) {
  object(config, ["origin", "name", "logo", "redirectUris", "fedapp"], "config");
  // A bare origin has no trailing slash; accept that one spelling alongside its URL form.
  const origin = url(
    typeof config.origin === "string" && !config.origin.endsWith("/")
      ? `${config.origin}/`
      : config.origin,
    "origin",
  );
  if (origin.href !== `${origin.origin}/`)
    throw new ConfigError("origin must contain only an HTTPS scheme, host and optional port");
  if (
    typeof config.name !== "string" ||
    !config.name.trim() ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: A public display name must not contain controls.
    /[\u0000-\u001f\u007f]/u.test(config.name)
  )
    throw new ConfigError("name must be a non-empty display name without control characters");
  const redirectUris = urls(
    config.redirectUris,
    "redirectUris",
    (entry) => {
      if (url(entry, "redirectUris entry").origin !== origin.origin)
        throw new ConfigError("redirectUris must belong to the configured suite origin");
    },
    true,
  );
  if (config.logo !== undefined) url(config.logo, "logo");
  object(config.fedapp, ["sectors", ...federationTerms.slice(1)], "fedapp");
  const federation = {};
  for (const term of federationTerms) {
    const values = config.fedapp[term === "sector" ? "sectors" : term];
    if (term !== "sector" && values === undefined) continue;
    federation[`fedapp:${term}`] = urls(
      values,
      `fedapp ${term}`,
      (entry) => {
        url(entry, `fedapp ${term} entry`, ["https:", "http:"], true);
        if (term === "access" && !accessModes.includes(entry))
          throw new ConfigError("fedapp access must use canonical ACL mode URLs");
      },
      term === "sector",
    );
  }

  // The vocabulary is a source-artifact package, with no runtime JS API. Embed only its
  // federation mappings, preserving IRI-valued properties without another remote context.
  const vocabulary = JSON.parse(
    readFileSync(
      new URL("../packages/solid-federation-vocab/context.jsonld", import.meta.url),
      "utf8",
    ),
  )["@context"];
  const context = {
    fedapp: vocabulary.fedapp,
    ...Object.fromEntries(federationTerms.map((term) => [`fedapp:${term}`, vocabulary[term]])),
    // The normative Solid-OIDC context predates this RFC 9449 registration parameter.
    dpop_bound_access_tokens: {
      "@id": "http://www.w3.org/ns/solid/oidc#dpop_bound_access_tokens",
      "@type": "http://www.w3.org/2001/XMLSchema#boolean",
    },
  };
  return {
    "@context": [oidcContext, context],
    client_id: new URL(clientIdPath, origin).href,
    client_name: config.name,
    client_uri: origin.href,
    ...(config.logo === undefined ? {} : { logo_uri: config.logo }),
    redirect_uris: redirectUris,
    scope: "openid webid offline_access",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    dpop_bound_access_tokens: true,
    "@type": "fedapp:App",
    ...federation,
  };
}

/** Generate the exact well-known resource under a caller-selected static serving directory. */
export function writeClientId(configPath, publicDirectory) {
  let config;
  const input = readFileSync(configPath, "utf8");
  try {
    config = JSON.parse(input);
  } catch {
    // JSON.parse errors can echo configuration contents, including misplaced secrets.
    throw new ConfigError("Client ID configuration must be valid JSON");
  }
  const document = createClientIdDocument(config);
  const directory = join(publicDirectory, ".well-known");
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, "solid-client-id.jsonld");
  writeFileSync(destination, `${JSON.stringify(document, null, 2)}\n`);
  return destination;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node scripts/client-id.mjs <config.json> <public-directory>");
  } else if (args.length !== 2 || args.some((arg) => arg.startsWith("-"))) {
    console.error("Usage: node scripts/client-id.mjs <config.json> <public-directory>");
    process.exitCode = 1;
  } else {
    try {
      writeClientId(...args);
    } catch (error) {
      console.error(
        error instanceof ConfigError
          ? error.message
          : "Client ID generation failed; check the config, vocabulary and output directory",
      );
      process.exitCode = 1;
    }
  }
}
