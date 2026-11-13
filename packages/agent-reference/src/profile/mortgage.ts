// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import { loadProfile } from "../engine/load.js";

export const MORTGAGE_PROFILE = loadProfile(
  fileURLToPath(new URL("../../profiles/mortgage.json", import.meta.url)),
);
export const MORTGAGE_CONTENT = {
  vocabulary: MORTGAGE_PROFILE.vocabulary,
  reliance: {
    id: "urn:profile:mortgage:reliance",
    rules: MORTGAGE_PROFILE.claims.map((claim) => ({
      id: `urn:profile:mortgage:${claim.kind}`,
      claimType: claim.kind,
      methods: claim.methods,
      maxAgeDays: claim.maxAgeDays,
      text: `Mortgage reliance for ${claim.kind}`,
    })),
  },
  identifiers: MORTGAGE_PROFILE.identifiers,
  purposes: Object.fromEntries(MORTGAGE_PROFILE.purposes.map((p) => [p.id, p.claims])),
};
