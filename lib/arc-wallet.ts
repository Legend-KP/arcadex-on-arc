/**
 * Arc-compatible wallet catalog + connect / switch helpers.
 * Arc is EVM (chain 5042); any EIP-1193 wallet that can add a custom network works.
 */

import type { EIP1193Provider } from "viem";
import {
  ARC_CHAIN_ID,
  ARC_DEFAULT_RPC_URL,
} from "@/lib/arc-chain";

export type ArcWalletId =
  | "metamask"
  | "coinbase"
  | "rabby"
  | "okx"
  | "brave"
  | "injected";

export interface ArcWalletOption {
  id: ArcWalletId;
  name: string;
  description: string;
  /** Chrome / desktop extension install URL when not detected. */
  installUrl: string;
  /** Detect installed EIP-1193 provider. */
  match: (p: InjectedProvider) => boolean;
}

export type InjectedProvider = EIP1193Provider & {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
  isBraveWallet?: boolean;
  providers?: InjectedProvider[];
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
    okxwallet?: InjectedProvider;
    coinbaseWalletExtension?: InjectedProvider;
  }
}

export const ARC_WALLET_OPTIONS: ArcWalletOption[] = [
  {
    id: "metamask",
    name: "MetaMask",
    description: "Browser extension · Arc via custom network",
    installUrl: "https://metamask.io/download/",
    match: (p) => Boolean(p.isMetaMask) && !p.isRabby && !p.isBraveWallet,
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    description: "Extension or Smart Wallet",
    installUrl: "https://www.coinbase.com/wallet/downloads",
    match: (p) => Boolean(p.isCoinbaseWallet),
  },
  {
    id: "rabby",
    name: "Rabby",
    description: "Multi-chain browser wallet",
    installUrl: "https://rabby.io/",
    match: (p) => Boolean(p.isRabby),
  },
  {
    id: "okx",
    name: "OKX Wallet",
    description: "Extension · EVM + Arc",
    installUrl: "https://www.okx.com/download",
    match: (p) => Boolean(p.isOkxWallet || p.isOKExWallet),
  },
  {
    id: "brave",
    name: "Brave Wallet",
    description: "Built into Brave browser",
    installUrl: "https://brave.com/wallet/",
    match: (p) => Boolean(p.isBraveWallet),
  },
  {
    id: "injected",
    name: "Browser wallet",
    description: "Any other EIP-1193 wallet on Arc",
    installUrl: "https://chainlist.org/chain/5042",
    match: () => true,
  },
];

function listAllProviders(): InjectedProvider[] {
  if (typeof window === "undefined") return [];
  const out: InjectedProvider[] = [];
  const seen = new Set<InjectedProvider>();

  const push = (p?: InjectedProvider | null) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };

  const eth = window.ethereum;
  if (eth) {
    if (Array.isArray(eth.providers) && eth.providers.length > 0) {
      eth.providers.forEach(push);
    }
    push(eth);
  }
  push(window.okxwallet ?? null);
  push(window.coinbaseWalletExtension ?? null);

  return out;
}

export function getInstalledArcWallets(): ArcWalletOption[] {
  const providers = listAllProviders();
  if (providers.length === 0) {
    return ARC_WALLET_OPTIONS.filter((w) => w.id !== "injected");
  }

  const installed: ArcWalletOption[] = [];
  for (const option of ARC_WALLET_OPTIONS) {
    if (option.id === "injected") continue;
    if (providers.some((p) => option.match(p))) {
      installed.push(option);
    }
  }

  // Always offer a generic fallback when something injects ethereum.
  if (installed.length === 0 && providers.length > 0) {
    installed.push(ARC_WALLET_OPTIONS.find((w) => w.id === "injected")!);
  }

  return installed.length > 0
    ? installed
    : ARC_WALLET_OPTIONS.filter((w) => w.id !== "injected");
}

export function findProviderForWallet(
  walletId: ArcWalletId
): InjectedProvider | null {
  const providers = listAllProviders();
  const option = ARC_WALLET_OPTIONS.find((w) => w.id === walletId);
  if (!option) return null;

  if (walletId === "injected") {
    return providers[0] ?? null;
  }

  return providers.find((p) => option.match(p)) ?? null;
}

const SELECTED_PROVIDER_KEY = "arcadex_selected_wallet_id";

export function getSelectedWalletId(): ArcWalletId | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SELECTED_PROVIDER_KEY);
  if (!raw) return null;
  return ARC_WALLET_OPTIONS.some((w) => w.id === raw)
    ? (raw as ArcWalletId)
    : null;
}

export function setSelectedWalletId(id: ArcWalletId | null): void {
  if (typeof window === "undefined") return;
  if (!id) {
    localStorage.removeItem(SELECTED_PROVIDER_KEY);
    return;
  }
  localStorage.setItem(SELECTED_PROVIDER_KEY, id);
}

/** Preferred injected provider: last user choice, then MetaMask → Rabby → Coinbase → first. */
export function getPreferredInjectedProvider(): InjectedProvider | null {
  const selected = getSelectedWalletId();
  if (selected) {
    const preferred = findProviderForWallet(selected);
    if (preferred) return preferred;
  }

  const providers = listAllProviders();
  if (providers.length === 0) return null;

  return (
    providers.find((p) => p.isMetaMask && !p.isRabby && !p.isBraveWallet) ||
    providers.find((p) => p.isRabby) ||
    providers.find((p) => p.isCoinbaseWallet) ||
    providers.find((p) => p.isOkxWallet || p.isOKExWallet) ||
    providers.find((p) => p.isBraveWallet) ||
    providers[0]
  );
}

function toHexChainId(id: number): `0x${string}` {
  return `0x${id.toString(16)}` as `0x${string}`;
}

/** wallet_switchEthereumChain + wallet_addEthereumChain for Arc mainnet. */
export async function ensureArcChain(
  provider: InjectedProvider = getPreferredInjectedProvider()!
): Promise<void> {
  if (!provider?.request) {
    throw new Error("Connect a wallet that supports Arc to continue.");
  }

  const target = toHexChainId(ARC_CHAIN_ID);

  try {
    const current = (await provider.request({
      method: "eth_chainId",
    })) as string;
    if (current?.toLowerCase() === target.toLowerCase()) return;
  } catch {
    // Continue — try switch anyway
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target }],
    });
    return;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? Number((err as { code: unknown }).code)
        : 0;
    // 4902 = unrecognized chain — add it
    if (code !== 4902 && code !== -32603) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/unrecognized|not added|4902/i.test(msg)) {
        throw new Error(
          msg.includes("reject") || msg.includes("denied")
            ? "Switch to Arc was cancelled in your wallet."
            : "Could not switch your wallet to Arc. Add Arc (chain 5042) and try again."
        );
      }
    }
  }

  const rpcUrl =
    process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim() || ARC_DEFAULT_RPC_URL;

  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: target,
          chainName: "Arc",
          nativeCurrency: {
            name: "USDC",
            symbol: "USDC",
            decimals: 18,
          },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: ["https://explorer.arc.io"],
        },
      ],
    });
  } catch (err) {
    // Already on Arc / user rejected / wallet already has the chain
    const msg = err instanceof Error ? err.message : String(err);
    if (/reject|denied|cancel/i.test(msg)) {
      throw new Error("Switch to Arc was cancelled in your wallet.");
    }
    try {
      const current = (await provider.request({
        method: "eth_chainId",
      })) as string;
      if (current?.toLowerCase() === target.toLowerCase()) return;
    } catch {
      // fall through
    }
    throw new Error(
      "Could not add Arc to your wallet. Add chain 5042 manually, then try again."
    );
  }
}

/**
 * Request accounts from a specific Arc wallet, switch to Arc, return address.
 */
export async function connectArcWallet(
  walletId: ArcWalletId
): Promise<string> {
  const option = ARC_WALLET_OPTIONS.find((w) => w.id === walletId);
  const provider = findProviderForWallet(walletId);

  if (!provider?.request) {
    if (option?.installUrl && typeof window !== "undefined") {
      window.open(option.installUrl, "_blank", "noopener,noreferrer");
    }
    throw new Error(
      `${option?.name ?? "Wallet"} is not installed. Install it, then come back.`
    );
  }

  setSelectedWalletId(walletId);

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[] | undefined;

  const address = accounts?.[0];
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("Wallet did not return an account. Unlock it and try again.");
  }

  await ensureArcChain(provider);

  return address;
}

export function isWalletInstalled(walletId: ArcWalletId): boolean {
  return Boolean(findProviderForWallet(walletId));
}
