// AUTHORED-BY Codex GPT-6.1-Sol
import { EmptyState } from "@jeswr/suite-ui";
import Link from "next/link";
export default function ComingNext() {
  return (
    <>
      <h1>New contact</h1>
      <EmptyState
        title="Coming next"
        body="The contact form and import wizard arrive in the next lane."
        primaryAction={<Link href="/contacts">Back to contacts</Link>}
      />
    </>
  );
}
