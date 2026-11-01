// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  toast,
} from "@jeswr/suite-ui";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { routeAfterSwitch } from "../lib/account-route";
import { reportProblemUrl } from "../lib/report-problem";
import { appForPath } from "../registry";
import { useAccounts } from "../session/accounts-provider";
import { ShortcutHelpSheet } from "../shortcuts/help-sheet";
import { AccountAvatar, AccountCard } from "./account-card";

export function AccountMenu() {
  const { active, accounts, switchTo, signOut, signOutAll } = useAccounts();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState(false);
  const [help, setHelp] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const nextDialog = useRef<"help" | "about" | null>(null);
  if (!active) return null;
  const signout = async (all: boolean) => {
    setOpen(false);
    try {
      await (all ? signOutAll() : signOut(active.id));
    } catch {
      toast.error("Signed out here. Your provider couldn't finish signing out.");
    } finally {
      if (all || accounts.length === 1) router.replace("/welcome");
    }
  };
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* No aria-label: the sr-only sentence names it, so the name and its text agree
              (axe label-content-name-mismatch, WCAG 2.5.3). */}
          <Button ref={trigger} className="suite-shell-icon-button" variant="ghost" size="icon">
            <span className="suite-sr-only">Account: {active.name}</span>
            {/* Initials are decoration; the name is the sentence above (WCAG 2.5.3). */}
            <span aria-hidden="true">
              <AccountAvatar account={active} />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="Account menu"
          className="w-80 max-w-[calc(100vw-2rem)] max-h-[85dvh] overflow-y-auto shadow-(--shadow-2)"
          onCloseAutoFocus={(event) => {
            const dialog = nextDialog.current;
            if (dialog) {
              event.preventDefault();
              trigger.current?.focus();
              nextDialog.current = null;
              if (dialog === "about") setAbout(true);
              else setHelp(true);
            }
          }}
        >
          <div className="account-menu-content">
            <AccountCard account={active} />
            <Separator />
            {accounts.some((account) => account.id !== active.id) && (
              <section aria-label="Switch account">
                <h2 className="text-sm font-semibold">Switch account</h2>
                {accounts
                  .filter((account) => account.id !== active.id)
                  .map((account) => (
                    <Button
                      key={account.id}
                      variant="ghost"
                      className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                      onClick={() => {
                        setOpen(false);
                        const current = location.pathname + location.search + location.hash;
                        switchTo(account.id);
                        const destination = routeAfterSwitch(current);
                        if (destination !== current) router.push(destination);
                        toast(`Now using ${account.name}`);
                      }}
                    >
                      <AccountAvatar account={account} />
                      <span>
                        {account.name}
                        <span className="block text-xs text-muted-foreground">
                          {new URL(account.storageUrl).host}
                        </span>
                      </span>
                    </Button>
                  ))}
              </section>
            )}
            <Button asChild variant="ghost" className="justify-start">
              <a
                href={`/signin?add=1&next=${encodeURIComponent(typeof location === "undefined" ? pathname : location.pathname + location.search + location.hash)}`}
              >
                Add another account
              </a>
            </Button>
            {active.kind !== "extension" && (
              <>
                <Button asChild variant="ghost" className="justify-start">
                  <a href="/settings/account">Manage your account</a>
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start"
                  onClick={() => void signout(false)}
                >
                  Sign out
                </Button>
              </>
            )}
            <Button variant="ghost" className="justify-start" onClick={() => void signout(true)}>
              Sign out of all accounts
            </Button>
            <Separator />
            <Button
              variant="ghost"
              className="justify-start"
              onClick={() => {
                nextDialog.current = "help";
                setOpen(false);
              }}
            >
              Keyboard shortcuts
            </Button>
            <Button asChild variant="ghost" className="justify-start">
              <a
                href={reportProblemUrl({
                  app: appForPath(pathname)?.name ?? "Home",
                  route: pathname,
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                Report a problem
              </a>
            </Button>
            <Button
              variant="ghost"
              className="justify-start"
              onClick={() => {
                nextDialog.current = "about";
                setOpen(false);
              }}
            >
              About Solid Suite
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Dialog open={about} onOpenChange={setAbout}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogTitle>About Solid Suite</DialogTitle>
          <DialogDescription>
            Your documents, files and tasks, in storage you control.
          </DialogDescription>
          <p>Version {process.env.NEXT_PUBLIC_SUITE_VERSION ?? "preview"}</p>
          <p>Solid Suite is available under the MIT licence.</p>
          <a
            href="https://github.com/jeswr/solid-sdk/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the Solid Suite licence
          </a>
        </DialogContent>
      </Dialog>
      <ShortcutHelpSheet
        open={help}
        onOpenChange={(value) => {
          setHelp(value);
          if (!value) requestAnimationFrame(() => trigger.current?.focus());
        }}
      />
    </>
  );
}
