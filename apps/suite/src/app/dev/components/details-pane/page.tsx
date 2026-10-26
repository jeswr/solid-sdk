// AUTHORED-BY Codex GPT-6.1-Sol
import { ShellFixture } from "../_shell/fixture";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  return <ShellFixture component="details-pane" initialState={state} />;
}
