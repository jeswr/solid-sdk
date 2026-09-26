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
| [`custom-protocol.js`](custom-protocol.js) | Plugging any other authentication protocol into the reactive fetch |
