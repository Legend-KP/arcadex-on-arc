import {
  createWalletClient,
  custom,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { arcChain } from "@/lib/arc-chain";

type InjectedProvider = EIP1193Provider & {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
  providers?: InjectedProvider[];
};

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
  if (typeof window === "undefined" || !window.ethereum) return null;
  const eth = window.ethereum;
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    return (
      eth.providers.find((p) => p.isMetaMask) ||
      eth.providers.find((p) => p.isRabby) ||
      eth.providers.find((p) => p.isCoinbaseWallet) ||
      eth.providers[0] ||
      eth
    );
  }
  return eth;
}

export function createInjectedWalletClient(): WalletClient | null {
  const provider = getInjectedProvider();
  if (!provider) return null;

  return createWalletClient({
    chain: arcChain,
    transport: custom(provider),
  });
}

/** @deprecated Use createInjectedWalletClient — MiniPay is not used on Arc. */
export const createMiniPayWalletClient = createInjectedWalletClient;

/** @deprecated MiniPay gate removed for Arc web wallets. */
export function isMiniPay(): boolean {
  return hasInjectedWallet();
}
