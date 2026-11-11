// AUTHORED-BY Codex GPT-6
import type { ConnectorEntry } from "../../lib/connect/catalogue";

const badges = {
  connect: "Connect",
  demo: "Demo data",
  import: "Import a file",
  soon: "Coming soon",
};
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
