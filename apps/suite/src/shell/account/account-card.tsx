// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useT } from "@jeswr/suite-i18n/react";
import { APP_ICONS, Avatar, AvatarFallback, AvatarImage, Badge, Button } from "@jeswr/suite-ui";
import { useState } from "react";
import { accountHue } from "../lib/account-hue";
import type { SuiteAccount } from "../session/types";

export function AccountAvatar({
  account,
  size = "default",
}: {
  account: SuiteAccount;
  size?: "default" | "lg";
}) {
  const presence = Object.entries(APP_ICONS).find(
    ([, icon]) => icon.hue === accountHue(account.webId),
  )?.[0];
  return (
    <Avatar
      size={size}
      aria-hidden="true"
      style={{
        outline: `2px solid var(--presence-${presence})`,
        outlineOffset: 1,
      }}
    >
      {account.photoUrl && <AvatarImage src={account.photoUrl} alt="" />}
      <AvatarFallback>
        {account.name
          .trim()
          .split(/\s+/u)
          .map((part) => part[0])
          .slice(0, 2)
          .join("")}
      </AvatarFallback>
    </Avatar>
  );
}

/** A clipboard failure never claims success, including on browsers without the API. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useT();
  const [status, setStatus] = useState<"" | "copied" | "copyFailed">("");
  return (
    <span className="account-copy">
      <Button
        size="sm"
        variant="outline"
        aria-label={label ?? t("account.copyId")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setStatus("copied");
          } catch {
            setStatus("copyFailed");
          }
        }}
      >
        {t("account.copy")}
      </Button>
      <span role="status" className="account-copy-status">
        {status ? t(`account.${status}`) : ""}
      </span>
    </span>
  );
}

export function AccountCard({ account }: { account: SuiteAccount }) {
  const t = useT();
  const id = account.webId;
  const shortened = id.length > 44 ? `${id.slice(0, 24)}…${id.slice(-17)}` : id;
  return (
    <div className="account-card">
      <div className="account-card-heading">
        <AccountAvatar account={account} size="lg" />
        <strong>{account.name}</strong>
      </div>
      <div className="account-id">
        <span>{t("account.id")}</span>
        <span title={id}>
          <span aria-hidden="true">{shortened}</span>
          <span className="suite-sr-only">{id}</span>
        </span>
        <CopyButton value={id} />
      </div>
      <Badge variant="secondary">
        {t("account.storedAt", { host: new URL(account.storageUrl).host })}
      </Badge>
      {account.kind === "extension" && <p>{t("account.extension")}</p>}
    </div>
  );
}
