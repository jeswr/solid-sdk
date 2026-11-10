// @vitest-environment node
// AUTHORED-BY Claude Opus 5.5
import { createPodAuth } from "@jeswr/pod-auth";
import { createMockOp } from "@jeswr/pod-auth/testing";
import { afterEach, expect, it, vi } from "vitest";
import { DomainsAuthError, DomainsUnavailableError, domainsApiBase, listDomains } from "./domains";
import { STORAGE_ENDPOINTS } from "./pod-auth";

afterEach(() => vi.unstubAllGlobals());

// A path-scoped pod (https://pod.example/alice/) whose server serves the account domains API at
// its origin root, as the live deployment does.
it.each([
  [STORAGE_ENDPOINTS, DomainsUnavailableError],
  [[], DomainsAuthError],
])("the domains API on the pod server origin is authorized only through storageEndpoints (%j)", async (storageEndpoints, expected) => {
  const op = createMockOp({ protectedUrls: ["https://pod.example/account/domains"] });
  vi.stubGlobal("fetch", op.fetch);
  const getCode = vi.fn(op.getCode);
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { storageEndpoints },
    ui: { getWebId: async () => op.webId!, getCode },
  });
  await auth.login({ webId: op.webId! });
  // The mock answers an authorized request with plain text, which listDomains reads as
  // "not this feature"; an unauthorized one stays a 401.
  await expect(listDomains(domainsApiBase(op.root), auth.fetch)).rejects.toBeInstanceOf(expected);
  expect(getCode).toHaveBeenCalledOnce();
});
