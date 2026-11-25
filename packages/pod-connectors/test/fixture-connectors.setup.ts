// AUTHORED-BY Claude Sonnet 5.5
import { vi } from "vitest";

/**
 * TEST-ONLY escape. Production fails closed: a connector id outside `CONNECTOR_PRIVACY` is
 * private, so a missing owner-only verifier refuses the import. The fixture adapters in this
 * package's unit tests use throwaway ids and exercise the import pipeline rather than the
 * privacy gate, so these exact ids (never an id that is classified, and never any other
 * unclassified id) are treated as public-ok here. Tests of the gate itself use other ids or
 * `vi.importActual`.
 */
const TEST_FIXTURE_CONNECTORS: ReadonlySet<string> = new Set([
  "accounting",
  "incremental",
  "legacy",
  "takeout",
  "toy",
]);

vi.mock("../src/core/pod-writer-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/pod-writer-policy.js")>();
  return {
    ...actual,
    requiresPrivateDestination: (id: string) => {
      return TEST_FIXTURE_CONNECTORS.has(id) ? false : actual.requiresPrivateDestination(id);
    },
  };
});
