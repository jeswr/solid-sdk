// AUTHORED-BY Claude Opus 5.5
/**
 * Whether self-registration is offered, and the test-only override that the
 * dev-fixture build reads from browser storage so one e2e server can exercise
 * both the hidden and the available signup (02-suite-shell §12 scenario 3).
 * The override is ignored outside the explicitly enabled fixture build.
 */
import { z } from "zod";
import { REGISTRATION_STEP_IDS, type RegistrationStepId } from "./registration-steps";

export const REGISTRATION_FIXTURE_KEY = "suite.test.registration.v1";

export interface RegistrationFixture {
  /** Force registration on, as `SUITE_TEST_CAPS={"selfRegistration":true}` would. */
  available: boolean;
  /** Steps whose first attempt fails, so Retry can be exercised. */
  failOnce: RegistrationStepId[];
}
const none: RegistrationFixture = { available: false, failOnce: [] };

const schema = z.object({
  available: z.boolean().catch(false),
  failOnce: z
    .array(z.unknown())
    .catch([])
    .transform((steps) => REGISTRATION_STEP_IDS.filter((id) => steps.includes(id))),
});

export function parseRegistrationFixture(raw: string | null): RegistrationFixture {
  try {
    const parsed = schema.safeParse(JSON.parse(raw ?? "null"));
    return parsed.success ? parsed.data : { ...none };
  } catch {
    return { ...none };
  }
}

/**
 * Registration is offered when the capability flag (or the fixture override)
 * says so AND a backend can serve it. Today the only backend is the demo one,
 * so a deployment with the demo switched off offers no registration.
 */
export function registrationAvailable(input: {
  selfRegistration: boolean | undefined;
  fixture: RegistrationFixture;
  demo: boolean;
}): boolean {
  return (input.selfRegistration === true || input.fixture.available) && input.demo;
}
