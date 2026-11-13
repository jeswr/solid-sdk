// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { SharedItem } from "@jeswr/suite-sdk/shared";
import { AppIcon, Badge, Button } from "@jeswr/suite-ui";
import Link from "next/link";
import { appLabel, sharedItemHref, sharedSender } from "./items";

export function SharedList({
  items,
  remove,
  storageUrl,
}: {
  items: readonly SharedItem[];
  remove?: (url: string) => void;
  storageUrl?: string;
}) {
  return (
    <ul className="shared-list" aria-label="Shared items">
      {items.map((item) => (
        <li key={item.url} className="shared-row">
          <AppIcon app={item.app} size={32} decorative />
          <div className="shared-details">
            <Link href={sharedItemHref(item, storageUrl)} className="shared-name">
              {item.name}
            </Link>
            <p className="hm-muted">
              {new URL(item.url).origin} · {appLabel(item.app)}
              {item.sharedBy ? ` · Sender (unverified): ${sharedSender(item.sharedBy)}` : ""}
              {item.fromAnotherPod ? " · from another pod" : ""}
              {item.sharedAt && Number.isFinite(Date.parse(item.sharedAt)) ? (
                <>
                  {" "}
                  ·{" "}
                  <time dateTime={item.sharedAt}>
                    {new Date(item.sharedAt).toLocaleDateString()}
                  </time>
                </>
              ) : (
                " · Date unknown"
              )}
            </p>
          </div>
          {item.role ? <Badge variant="secondary">{item.role} (unverified)</Badge> : null}
          {remove ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${item.name} from Shared with me`}
              onClick={() => remove(item.url)}
            >
              Remove
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
