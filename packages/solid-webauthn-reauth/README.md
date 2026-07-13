<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-webauthn-reauth

Redirect-free Solid-OIDC reauthentication using a WebAuthn passkey assertion and DPoP-bound token exchange.

The browser attests the user and app origin to the identity provider; ordinary RFC 9449 DPoP then
sender-constrains the resulting pod access token.

> Security-critical. The identity provider remains responsible for challenge freshness, assertion
> verification, origin checks, counters, and revocation.

## Install

```sh
npm install github:jeswr/solid-webauthn-reauth#main
```

Requires Node.js 20 or newer for tooling and a WebAuthn-capable browser for the client API.

## Minimal usage

```ts
import { registerPasskey, WebAuthnTokenProvider } from "@jeswr/solid-webauthn-reauth";

await registerPasskey({
  registerOptionsUrl: "https://op.example/.account/webauthn/register-options",
  registerUrl: "https://op.example/.account/webauthn/register",
  clientId: "https://app.example/clientid.jsonld",
  fetch: authenticatedFetch,
});

const provider = new WebAuthnTokenProvider({
  "pod.example": {
    issuer: "https://op.example",
    clientId: "https://app.example/clientid.jsonld",
  },
});

const request = await provider.upgrade(new Request("https://pod.example/private/data"));
const response = await fetch(request);
```

## Key API

- Registration: `registerPasskey`.
- Reauthentication: `WebAuthnTokenProvider`, `WebAuthnTokenExchange`, `dpopBoundRequest`.
- Isomorphic wire format: `encodeAssertionBundle`, `decodeAssertionBundle`, origin helpers, and
  constants from `@jeswr/solid-webauthn-reauth/protocol`.
- The root browser entry is ESM; the pure `./protocol` entry supports ESM and CommonJS.

## Links

- [Source](https://github.com/jeswr/solid-webauthn-reauth)
- [Issues](https://github.com/jeswr/solid-webauthn-reauth/issues)
- [Design and threat model](./DESIGN.md)
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
- [RFC 8693: Token Exchange](https://www.rfc-editor.org/rfc/rfc8693)

## License

[MIT](./LICENSE) © Samu Lang and Jesse Wright
