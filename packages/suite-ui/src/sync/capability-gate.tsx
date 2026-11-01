// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  type ReactNode,
  useContext,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import type { Capabilities, CapabilityKey } from "./types.js";

const CapabilityContext = createContext<Capabilities>({});
export function CapabilityProvider({
  capabilities,
  children,
}: {
  capabilities: Capabilities;
  children: ReactNode;
}) {
  return <CapabilityContext.Provider value={capabilities}>{children}</CapabilityContext.Provider>;
}
export function useCapabilities(): Capabilities {
  return useContext(CapabilityContext);
}

/** Supply the current online snapshot and an action phrase, e.g. "change sharing". */
export function useRequiresOnline(online: boolean, action: string) {
  return { disabled: !online, reason: `Reconnect to ${action}` };
}

function disabledChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (
      !isValidElement<{ children?: ReactNode; disabled?: boolean; "aria-disabled"?: boolean }>(
        child,
      )
    )
      return child;
    if (child.type === Fragment)
      return cloneElement(child, {}, disabledChildren(child.props.children));
    return cloneElement(child, { disabled: true, "aria-disabled": true });
  });
}

export interface CapabilityGateProps {
  need: CapabilityKey;
  fallback: "disabled" | "hidden" | "note";
  reason?: string;
  /** Controls must forward the native disabled and aria-disabled props. */
  children: ReactNode;
}
export function CapabilityGate({
  need,
  fallback,
  reason = "Not available on this storage",
  children,
}: CapabilityGateProps) {
  const capabilities = useCapabilities();
  if (capabilities[need] === true) return children;
  if (fallback === "hidden") return null;
  return (
    <div className="suite-capability">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Disabled controls need a keyboard target for their explanation. */}
            <fieldset className="suite-disabled-trigger" tabIndex={0} aria-label={reason}>
              {disabledChildren(children)}
            </fieldset>
          </TooltipTrigger>
          <TooltipContent>{reason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {fallback === "note" && (
        <span className="suite-sync-note">
          Not available on this storage ·{" "}
          <a href="/settings/storage">Learn what your storage supports</a>
        </span>
      )}
    </div>
  );
}
