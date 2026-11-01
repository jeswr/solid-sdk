// AUTHORED-BY Codex GPT-6.1-Sol
import { SignInFixtures } from "./fixtures";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  return <SignInFixtures state={state ?? "all"} />;
}
