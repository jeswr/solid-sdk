// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { isLoaded, type Row } from "../lib/client";
import { isTruncated } from "../lib/collections";
import type { Query } from "../lib/hooks";

export function QueryRows<T>({
  query,
  empty,
  children,
}: {
  query: Query<Row<T>[]>;
  empty: string;
  children: (rows: T[]) => ReactNode;
}) {
  if (query.status === "loading") return <LoadingSkeleton label="Loading agent records" />;
  if (query.status === "error")
    return <ErrorState error="unreachable" actions={{ retry: query.reload }} />;
  const failed = query.data.filter((row) => !isLoaded(row));
  return (
    <>
      <CollectionNotice rows={query.data} />
      {failed.length > 0 && (
        <div role="alert">
          <p>
            {failed.length} record{failed.length === 1 ? "" : "s"} couldn't be read.
          </p>
          <Button variant="outline" onClick={query.reload}>
            Retry
          </Button>
        </div>
      )}
      {query.data.length === 0 ? (
        <EmptyState title={empty} body="Records will appear here when your agent adds them." />
      ) : (
        children(query.data.filter(isLoaded<T>).map((row) => row.record))
      )}
    </>
  );
}
export function CollectionNotice({ rows }: { rows: readonly unknown[] }) {
  return isTruncated(rows) ? <p role="status">Showing the newest 500</p> : null;
}
export function DisabledAction({
  children,
  tip = "Set up approvals on this device first",
}: {
  children: ReactNode;
  tip?: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focus exposes the disabled action reason to keyboard users */}
          <span className="agent-disabled" tabIndex={0} title={tip}>
            <Button disabled>{children}</Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="agent-page">
      <h1>{title}</h1>
      {children}
    </section>
  );
}
export function DetailScreen({
  title,
  back,
  children,
}: {
  title: string;
  back: string;
  children: ReactNode;
}) {
  const [mobile, setMobile] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const media = matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  if (!mobile) return <Screen title={title}>{children}</Screen>;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(back);
      }}
    >
      <SheetContent
        side="bottom"
        className={`agent-app agent-detail-sheet ${back === "/agent/approvals" ? "agent-approval-detail" : ""}`}
      >
        <SheetTitle asChild>
          <h1>{title}</h1>
        </SheetTitle>
        <SheetDescription>Read the selected agent record.</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}
