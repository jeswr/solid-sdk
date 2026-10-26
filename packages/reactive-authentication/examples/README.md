# Examples

Each example is complete but minimal. Imports use the package name; in a browser without a bundler, map
bare specifiers with an import map (see `../index.html`). Service workers cannot use import maps, so the
service-worker example needs a bundler (the browser smoke tests bundle `test/browser/sw-entry.js` with esbuild).

| File | Shows |
| --- | --- |
| [`solid-oidc.html`](solid-oidc.html) | Solid-OIDC in a page: issuer picker, popup flow, DPoP, credential boundary, persistence, logout, identity |
| [`service-worker/`](service-worker/sw.js) | Authenticating every fetch of a page from a service worker, UI in the page |
| [`lws-openid.js`](lws-openid.js) | LWS OpenID Connect suite: ID token exchanged for a storage access token |
| [`lws-controlled-identifier.js`](lws-controlled-identifier.js) | LWS self-issued JWT with a controlled identifier document (bots, scripts) |
| [`lws-did-key.js`](lws-did-key.js) | LWS self-issued JWT with a `did:key` identifier |
| [`lws-saml.js`](lws-saml.js) | LWS SAML 2.0 suite through an application-provided SAML stack |
| [`client-credentials.js`](client-credentials.js) | A script acting as itself with client credentials (e.g. Community Solid Server) |
| [`google-api.html`](google-api.html) | Google APIs through Google Identity Services (token model, click-driven popup) |
| [`microsoft-graph.html`](microsoft-graph.html) | Microsoft Graph `User.Read` through MSAL.js |
| [`microsoft-redirect.html`](microsoft-redirect.html) | The dedicated MSAL v5 popup redirect page (`broadcastResponseToMainFrame`) |
| [`oauth-generic.html`](oauth-generic.html) | Any OAuth 2.0 / OpenID Connect provider (Auth0, Keycloak…) with PKCE |
| [`oauth-server.js`](oauth-server.js) | Server-side confidential client, one per application session (your framework routes the callback) |
| [`custom-protocol.js`](custom-protocol.js) | Plugging any other authentication protocol into the reactive fetch |
