// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { redirect } from "next/navigation";
import { suiteDiaryUrl } from "@/lib/suite-url";

export default function Home() {
  redirect(suiteDiaryUrl());
}
