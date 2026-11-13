// AUTHORED-BY GPT-6.1 Sol
import { useSolidExtensionPresent } from "../hooks/use-solid-extension-present.js";
import { AccountMenu, type AccountMenuProps } from "./account-menu.js";
import { Button } from "./primitives.js";

export interface AccountControlProps
  extends Pick<AccountMenuProps, "webId" | "displayName" | "avatarUrl" | "onSignOut"> {
  /** Label for the standalone sign-out button when the extension owns the profile menu. */
  signOutLabel?: string;
}

/** Keep app-owned sign-out available when the extension supplies the profile menu. */
export function AccountControl({ signOutLabel = "Sign out", ...props }: AccountControlProps) {
  const extensionPresent = useSolidExtensionPresent();
  return extensionPresent ? (
    <Button variant="ghost" onClick={props.onSignOut}>
      {signOutLabel}
    </Button>
  ) : (
    <AccountMenu {...props} />
  );
}
