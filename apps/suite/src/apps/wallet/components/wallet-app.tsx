// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { ErrorState, LoadingSkeleton, Toaster } from "@jeswr/suite-ui";
import { LockKeyhole, WalletCards } from "lucide-react";
import Link from "next/link";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppSessionGuard } from "@/shell/app-frame";
import { WalletProvider } from "../state/wallet-context";
import { WalletHome } from "./wallet-home";

function SessionWallet() {
  const account = usePodSessionState();
  return (
    <AppFrame
      app="wallet"
      sidebar={
        <div className="wallet-sidebar">
          <WalletCards aria-hidden="true" size={28} />
          <strong>Wallet</strong>
          <nav aria-label="Wallet">
            <Link href="/wallet" aria-current="page">
              All documents
            </Link>
          </nav>
          <p>
            <LockKeyhole size={16} aria-hidden="true" /> Private storage required
          </p>
          <p>Keep your important documents together in your pod.</p>
        </div>
      }
    >
      <div className="wallet-page">
        {account.status === "loading" ? (
          <LoadingSkeleton preset="grid" label="Opening Wallet" />
        ) : account.status === "signed-out" ? (
          <p role="status">Sign in to open your wallet.</p>
        ) : account.status === "error" ? (
          <ErrorState error="unreachable" actions={{ retry: () => location.reload() }} />
        ) : (
          <WalletProvider
            key={`${account.session.mode}:${account.session.webId}:${account.session.storageUrl}`}
            session={account.session}
          >
            <WalletHome />
          </WalletProvider>
        )}
      </div>
    </AppFrame>
  );
}
export function WalletApp() {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionWallet />
        <Toaster position="bottom-center" />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
