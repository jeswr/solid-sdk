// AUTHORED-BY Claude Opus 5.5
import type { Metadata } from "next";
import { SignupFlow } from "@/shell/registration/signup";

export const metadata: Metadata = { title: "Create your account · Solid Suite" };
export default function Page() {
  return <SignupFlow />;
}
