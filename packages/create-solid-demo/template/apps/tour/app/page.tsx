import { ShowcaseLanding } from "@jeswr/solid-showcase";
import { walkthrough } from "../lib/walkthrough";

export default function LandingPage() {
  return <ShowcaseLanding document={walkthrough} />;
}
