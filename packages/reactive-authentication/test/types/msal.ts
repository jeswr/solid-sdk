// Compile-time check (npm run test:types): the real MSAL browser client satisfies the structural MsalClient
// contract, so applications can pass their PublicClientApplication without casts.
import type { AccountInfo, IPublicClientApplication } from "@azure/msal-browser"
import { MsalTokenSource, type MsalClient } from "../../src/oauth/MsalTokenSource.js"

declare const msal: IPublicClientApplication
const client: MsalClient<AccountInfo> = msal
export const source = new MsalTokenSource(msal, {scopes: ["User.Read"], account: () => msal.getActiveAccount()})
export { client }

// The MSAL v5 popup redirect page's only import (examples/microsoft-redirect.html) resolves with these types.
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge"
export const bridge: () => Promise<void> = broadcastResponseToMainFrame
