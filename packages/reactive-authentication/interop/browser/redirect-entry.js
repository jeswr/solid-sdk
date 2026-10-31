// The MSAL v5 redirect bridge: the popup's redirect URI page hands the raw response to the opening page (over a
// same-origin BroadcastChannel) and does nothing else. The code exchange happens in the opener.
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = "No authentication response to forward.";
});
