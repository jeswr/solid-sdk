// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { EmptyState } from "@jeswr/suite-ui";
import Link from "next/link";

export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ ref: "__" }] : [];
}

export default function ComingNext() {
  return (
    <>
      <h1>Edit contact</h1>
      <EmptyState
        title="Coming next"
        body="The contact form and import wizard arrive in the next lane."
        primaryAction={<Link href="/contacts">Back to contacts</Link>}
      />
    </>
  );
}
