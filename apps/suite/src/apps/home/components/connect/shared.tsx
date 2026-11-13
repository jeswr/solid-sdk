// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Badge } from "@jeswr/suite-ui";
import { type ConnectorEntry, DEMO_CONNECTOR } from "../../lib/connect/catalogue";

const badges = {
  connect: "Connect",
  demo: DEMO_CONNECTOR.label,
  import: "Import a file",
  soon: "Coming soon",
};
export function DemoDataBadge() {
  return (
    <Badge
      role="note"
      aria-label={badges.demo}
      variant="secondary"
      className="bg-warning text-warning-foreground"
    >
      {badges.demo}
    </Badge>
  );
}
export function StatusBadge({ status }: Pick<ConnectorEntry, "status">) {
  return (
    <span className="hm-connect-badge" data-status={status}>
      {badges[status]}
    </span>
  );
}
export function ConnectorLogo({ entry }: { entry: ConnectorEntry }) {
  return (
    <span className="hm-connect-logo" data-logo={entry.logoId} aria-hidden="true">
      {entry.name.slice(0, 2)}
    </span>
  );
}
