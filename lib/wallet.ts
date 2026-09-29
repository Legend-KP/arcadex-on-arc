import {
  createWalletClient,
  custom,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { arcChain } from "@/lib/arc-chain";
import {
  ensureArcChain,
  getPreferredInjectedProvider,
  type InjectedProvider,
} from "@/lib/arc-wallet";

export type { InjectedProvider };

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

/** True when any injected EIP-1193 provider is available (MetaMask, Coinbase, Rabby, etc.). */
export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && Boolean(getInjectedProvider());
}

export function getInjectedProvider(): InjectedProvider | null {
  return getPreferredInjectedProvider();
}

export function createInjectedWalletClient(): WalletClient | null {
  const provider = getInjectedProvider();
  if (!provider) return null;

  return createWalletClient({
    chain: arcChain,
    transport: custom(provider as EIP1193Provider),
  });
}

/**
 * Ensure the connected wallet is on Arc before a write.
 * No-op if no provider (caller should already require a wallet).
 */
export async function prepareWalletForArcTx(): Promise<void> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error(
      "Connect a wallet (MetaMask, Coinbase, Rabby, OKX, or Brave) on Arc to continue."
    );
  }
  await ensureArcChain(provider);
}

/** @deprecated Use createInjectedWalletClient — MiniPay is not used on Arc. */
export const createMiniPayWalletClient = createInjectedWalletClient;

/** @deprecated MiniPay gate removed for Arc web wallets. */
export function isMiniPay(): boolean {
  return hasInjectedWallet();
}
