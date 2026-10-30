// AUTHORED-BY Codex GPT-6.1-Sol
export const SUPPORTED_PHONE_REGIONS = Object.freeze(["US", "CA", "GB", "AU"] as const);
export type PhoneRegion = (typeof SUPPORTED_PHONE_REGIONS)[number];

interface NumberClass {
  readonly pattern: RegExp;
  readonly groups: readonly number[];
  readonly mobile: boolean;
}

interface CallingPlan {
  readonly callingCode: string;
  readonly trunk: string;
  readonly classes: readonly NumberClass[];
}

/** Bounded structural subset, not an allocation or reachability database. See README.md. */
export const callingPlans: Readonly<Record<PhoneRegion, CallingPlan>> = {
  US: {
    callingCode: "1",
    trunk: "1",
    classes: [{ pattern: /^[2-9]\d{2}[2-9]\d{6}$/, groups: [3, 3, 4], mobile: false }],
  },
  CA: {
    callingCode: "1",
    trunk: "1",
    classes: [{ pattern: /^[2-9]\d{2}[2-9]\d{6}$/, groups: [3, 3, 4], mobile: false }],
  },
  GB: {
    callingCode: "44",
    trunk: "0",
    classes: [
      { pattern: /^20\d{8}$/, groups: [2, 4, 4], mobile: false },
      { pattern: /^7[1-57-9]\d{8}$/, groups: [4, 6], mobile: true },
    ],
  },
  AU: {
    callingCode: "61",
    trunk: "0",
    classes: [
      { pattern: /^[2378]\d{8}$/, groups: [1, 4, 4], mobile: false },
      { pattern: /^4\d{8}$/, groups: [3, 3, 3], mobile: true },
    ],
  },
};
