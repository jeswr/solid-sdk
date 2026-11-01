// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { shellDocumentTitle } from "@jeswr/suite-ui/shell";
import type { Metadata } from "next";
import { ShellFixture } from "../_shell/fixture";

// Next's route metadata owns the initial <title>; ShellFrame keeps it in sync on the client.
export const metadata: Metadata = { title: shellDocumentTitle("My Drive", "Drive") };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  return <ShellFixture component="sidebar-nav" initialState={state} />;
}
