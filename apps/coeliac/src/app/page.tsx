// AUTHORED-BY Codex GPT-6.1-Sol
import { redirect } from "next/navigation";

export default function Home() {
  redirect(
    `${process.env.NEXT_PUBLIC_SUITE_URL ?? "https://solid-suite.vercel.app"}/health/diary?mode=coeliac`,
  );
}
