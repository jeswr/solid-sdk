// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReactNode } from "react";

export interface AsyncRenderProps {
  loading?: ReactNode;
  error?: ReactNode;
  empty?: ReactNode;
  children: ReactNode | (() => ReactNode);
}

/** First-load feedback takes precedence. Refreshes pass no loading node to retain content. */
export function renderAsync({ loading, error, empty, children }: AsyncRenderProps): ReactNode {
  if (loading) return loading;
  if (error) return error;
  if (empty) return empty;
  return typeof children === "function" ? children() : children;
}
