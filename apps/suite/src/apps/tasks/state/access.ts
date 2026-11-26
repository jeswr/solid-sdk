// AUTHORED-BY Codex GPT-6.1-Sol
import { verifyPrivateDemoAccess } from "@jeswr/pod-access/roles";
import type { PodSession } from "@/lib/session/pod-session";

type AccessSession = Pick<PodSession, "fetch" | "storageUrl" | "webId"> & { mode: string };
export const supportsTasksSharing = (session: Pick<AccessSession, "mode">): boolean =>
  session.mode === "demo";
export const ensurePrivateTasksAccess = verifyPrivateDemoAccess;
export const ensurePrivateIndexAccess = verifyPrivateDemoAccess;
