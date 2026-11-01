// AUTHORED-BY Claude Opus 5.5
import type { Metadata } from "next";
import { OnboardingPage } from "@/shell/onboarding/onboarding";

export const metadata: Metadata = { title: "Welcome · Solid Suite" };
export default function Page() {
  return <OnboardingPage />;
}
