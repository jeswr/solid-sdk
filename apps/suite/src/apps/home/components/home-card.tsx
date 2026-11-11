// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  ProvenanceBadge,
  TypedView,
  type TypedViewData,
  toast,
} from "@jeswr/suite-ui";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ComponentProps, useMemo } from "react";
import { createPreviewImageResolver } from "../../drive/lib/preview/image-resolver";
import { DEMO_CONNECTOR } from "../lib/connect/catalogue";
import { isDemoImport } from "../lib/connect/demo";
import type { DomainItem } from "../lib/model/discovery";
import { inStorage } from "../lib/model/rdf";
import { useConnectors } from "../state/connectors";
import { type ItemAction, itemActions, itemTitle } from "../state/presentation";
import { useProvenance } from "../state/use-provenance";
import { DemoDataBadge } from "./connect/shared";
import { useHomeSession } from "./home-app";
import { openShare } from "./item/open-share";
import { itemShortcut } from "./item/shortcuts";
import { useItemActions } from "./item/use-item-actions";

function ActionLink({
  action,
  ...props
}: { action: ItemAction } & Omit<ComponentProps<typeof Link>, "href">) {
  return action.external ? (
    <a {...props} href={action.href} target="_blank" rel="noopener noreferrer">
      {action.label}
    </a>
  ) : (
    <Link {...props} href={action.href as string}>
      {action.label}
    </Link>
  );
}

export function HomeCard({
  item,
  view,
  storage,
  webId,
}: {
  item: DomainItem;
  view: TypedViewData;
  storage: string;
  webId: string;
}) {
  const session = useHomeSession();
  const [connections] = useConnectors(webId);
  const router = useRouter();
  const { deleteItem } = useItemActions(session);
  const keydown = (event: React.KeyboardEvent) => {
    if (event.key === "." && itemShortcut(event)) {
      event.preventDefault();
      router.push(openShare(item.url));
    }
  };
  const resolveImage = useMemo(() => {
    const resolve = createPreviewImageResolver(async (input, init) => {
      const url = assertWithinPodScope(
        storage,
        input instanceof Request ? input.url : String(input),
      );
      return session.fetch(url, { ...init, redirect: "error" });
    });
    return (url: string, signal: AbortSignal) =>
      inStorage(url, storage) ? resolve(url, signal) : Promise.resolve(undefined);
  }, [session, storage]);
  const actions = itemActions(item, storage, undefined, webId);
  const open = actions[0]?.href as string;
  const title = itemTitle(item);
  const provenance = useProvenance(item, session);
  const demo = provenance.demo || isDemoImport(item.url, connections);
  const onlyDemo =
    provenance.demo && provenance.kind === "source" && provenance.label === DEMO_CONNECTOR.label;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(open, location.origin).href);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };
  return (
    <li className="hm-card" aria-label={title}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="hm-card-body">
            <div className="hm-card-content">
              <TypedView data={view} resolveImage={resolveImage} />
            </div>
            {/* Stretched link: its name is exactly the title; the card's text stays outside it. */}
            <Link href={open} className="hm-card-open" onKeyDown={keydown}>
              <span className="hm-sr-only">{title}</span>
            </Link>
            <footer className="hm-card-footer">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {demo ? <DemoDataBadge /> : null}
                {!onlyDemo &&
                  (provenance.kind === "you" || provenance.kind === "app" ? (
                    <span className="hm-you">
                      {provenance.kind === "you" ? "Added by you" : `Added by ${provenance.label}`}
                    </span>
                  ) : (
                    <ProvenanceBadge source={provenance.label} />
                  ))}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    variant="ghost"
                    className="hm-more"
                    label={`More actions for ${title}`}
                    onKeyDown={keydown}
                  >
                    <MoreHorizontal aria-hidden="true" size={20} />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="hm-menu">
                  {actions.map((action) =>
                    action.href ? (
                      <DropdownMenuItem key={action.id} asChild>
                        <ActionLink action={action} />
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        key={action.id}
                        onSelect={() => void (action.id === "delete" ? deleteItem(item) : copy())}
                      >
                        {action.label}
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </footer>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="hm-menu">
          {actions.map((action) =>
            action.href ? (
              <ContextMenuItem key={action.id} asChild>
                <ActionLink action={action} />
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                key={action.id}
                onSelect={() => void (action.id === "delete" ? deleteItem(item) : copy())}
              >
                {action.label}
              </ContextMenuItem>
            ),
          )}
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}
