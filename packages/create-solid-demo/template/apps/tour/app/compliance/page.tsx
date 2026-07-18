import { ShowcaseCompliancePage } from "@jeswr/solid-showcase";
import { notFound } from "next/navigation";
import { walkthrough } from "../../lib/walkthrough";

/**
 * The compliance lens ("Examiner View" generalised) renders only once the document
 * configures one — add a `compliance` block to walkthrough.json to activate it.
 */
export default function CompliancePage() {
  if (walkthrough.compliance === undefined) notFound();
  return <ShowcaseCompliancePage document={walkthrough} />;
}
