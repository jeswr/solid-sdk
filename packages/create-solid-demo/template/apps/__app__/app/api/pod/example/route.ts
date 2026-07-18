import { createPodRouteGuard, type PodRouteGuard } from "@jeswr/solid-pod-guard";
import { guardConfig } from "../../../../lib/server/config";

/**
 * Sample AUTHENTICATED pod route behind the full fail-closed pipeline:
 * anonymous ⇒ 401 (before any validation), caller-supplied pod/webid ⇒ 400,
 * unconfigured issuer allowlist ⇒ 503, binding failure ⇒ 403 — never pick-first.
 * Replace the handler body with this app's real scene logic; the caller's
 * `{ webid, podBase }` is derived from the TOKEN, never from the request.
 */
let guard: PodRouteGuard | undefined;

function getGuard(): PodRouteGuard {
  guard ??= createPodRouteGuard({ config: guardConfig() });
  return guard;
}

export async function POST(request: Request): Promise<Response> {
  return getGuard().handle(request, async (caller) =>
    Response.json({
      simulated: true,
      podBase: caller.podBase,
      webid: caller.webid,
    }),
  );
}
