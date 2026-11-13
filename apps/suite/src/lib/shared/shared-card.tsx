// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import Link from "next/link";
import { useHomeSession } from "@/apps/home/components/home-app";
import { SharedList } from "./shared-list";
import { useSharedItems } from "./use-shared-items";

export function SharedCard() {
  const data = useSharedItems(useHomeSession());
  return (
    <section className="shared-card" aria-labelledby="shared-card-title">
      <div className="hm-section-heading">
        <h2 id="shared-card-title">Shared with you</h2>
        <Button variant="ghost" asChild>
          <Link href="/shared">View all shared items</Link>
        </Button>
      </div>
      {data.loading ? (
        <p role="status">Loading shared items…</p>
      ) : data.items.length ? (
        <SharedList items={data.items.slice(0, 5)} storageUrl={data.storageUrl} />
      ) : (
        <p className="hm-muted">
          {data.error ? "Couldn't load shared announcements." : "Nothing shared with you yet."}
        </p>
      )}
    </section>
  );
}
