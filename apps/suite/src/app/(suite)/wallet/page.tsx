// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import { WalletApp } from "@/apps/wallet/components/wallet-app";
import "@/apps/wallet/components/wallet.css";
export const metadata: Metadata = { title: "Wallet · Solid Suite" };
export default function Page() {
  return <WalletApp />;
}
