// AUTHORED-BY Codex GPT-6.1-Sol
import { shellDocumentTitle } from "@jeswr/suite-ui/shell";
import { MovePodSettings } from "@/shell/settings/move-pod";
export const metadata = { title: shellDocumentTitle("Move to another pod", "Home") };
export default function Page() {
  return <MovePodSettings />;
}
