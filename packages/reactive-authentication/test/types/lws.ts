// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type ClientProvider,
  type CodeProvider,
  LwsTokenProvider,
  OidcIdTokenSource,
  SessionFence,
} from "../../src/mod.js";

declare const code: CodeProvider;
declare const clients: ClientProvider;
const args = [
  { issuer: "https://openid.example/" },
  "https://app.example/callback",
  code,
  clients,
] as const;
const fence = new SessionFence("lws-type-contract");

// @ts-expect-error OIDC sources must not create a default fence.
new OidcIdTokenSource(...args);
// @ts-expect-error Supplying session options still requires the shared fence.
new OidcIdTokenSource(...args, {});

const source = new OidcIdTokenSource(...args, { fence });
const shared: SessionFence = source.fence;
new LwsTokenProvider(source, { fence: shared });
