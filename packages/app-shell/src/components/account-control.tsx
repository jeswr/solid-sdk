// AUTHORED-BY GPT-6.1 Sol
import { useSolidExtensionPresent } from "../hooks/use-solid-extension-present.js";
import { AccountMenu, type AccountMenuProps } from "./account-menu.js";
import { Button } from "./primitives.js";

export interface AccountControlProps
  extends Pick<AccountMenuProps, "webId" | "displayName" | "avatarUrl" | "onSignOut"> {
  /** Label for the standalone sign-out button when the extension owns the profile menu. */
  signOutLabel?: string;
}

/**
 * Keep app-owned sign-out available when the extension supplies the profile menu.
 *
 * The extension being present says nothing about WHICH account it shows, and the app keeps its
 * own session, so the app's signed-in identity stays visible beside the sign-out button.
 */
export function AccountControl({ signOutLabel = "Sign out", ...props }: AccountControlProps) {
  const extensionPresent = useSolidExtensionPresent();
  if (!extensionPresent) return <AccountMenu {...props} />;
  const identity = props.displayName || props.webId;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {identity ? (
        <span
          className="max-w-40 truncate text-xs text-as-muted-foreground"
          title={props.webId ?? undefined}
          data-account-identity=""
        >
          <span className="sr-only">Signed in to this app as </span>
          {identity}
        </span>
      ) : null}
      <Button variant="ghost" onClick={() => props.onSignOut()}>
        {signOutLabel}
      </Button>
    </span>
  );
}
