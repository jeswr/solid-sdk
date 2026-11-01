// AUTHORED-BY Claude Opus 5.5
import { registerPlugin } from "@capacitor/core";
import type { AuthSessionPlugin } from "./auth-session.js";
import type { SharePlugin } from "./share.js";
import type { ShareIntakePlugin } from "./share-intake.js";
import type { ShareStagingPlugin } from "./share-staging.js";

/** Native bindings. Import this subpath only in code that runs inside the app shell. */
export const authSessionPlugin = registerPlugin<AuthSessionPlugin>("SuiteAuthSession");
export const shareIntakePlugin = registerPlugin<ShareIntakePlugin>("SuiteShareIntake");
export const shareStagingPlugin = registerPlugin<ShareStagingPlugin>("SuiteShareStaging");
/** The `@capacitor/share` native plugin, registered by name so the suite needs no extra package. */
export const sharePlugin = registerPlugin<SharePlugin>("Share");
