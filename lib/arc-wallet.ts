/**
 * Arc-compatible wallet catalog + EIP-6963 discovery + chain switch.
 * The same provider object used for connect() is reused for switch + send.
 */

import type { EIP1193Provider } from "viem";
import { ARC_CHAIN_ID } from "@/lib/arc-chain";
import { getWalletAddChainRpcUrl } from "@/lib/arc-rpc";

export type ArcWalletId =
  | "metamask"
  | "rainbow"
  | "coinbase"
  | "rabby"
  | "okx"
  | "brave"
  | "injected";

export interface ArcWalletOption {
  id: ArcWalletId;
  name: string;
  description: string;
  installUrl: string;
  /** EIP-6963 rdns values (and legacy flags). */
  rdns: string[];
  match: (p: InjectedProvider) => boolean;
}

export type InjectedProvider = EIP1193Provider & {
  isMetaMask?: boolean;
  isRainbow?: boolean;
  isRainbowWallet?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
  isBraveWallet?: boolean;
  providers?: InjectedProvider[];
};

export type Eip6963ProviderDetail = {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  provider: InjectedProvider;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
    okxwallet?: InjectedProvider;
    coinbaseWalletExtension?: InjectedProvider;
    rainbow?: InjectedProvider;
  }

  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent<Eip6963ProviderDetail>;
  }
}

export const ARC_WALLET_OPTIONS: ArcWalletOption[] = [
  {
    id: "metamask",
    name: "MetaMask",
    description: "Browser extension · Arc via custom network",
    installUrl: "https://metamask.io/download/",
    rdns: ["io.metamask", "io.metamask.flask"],
    match: (p) =>
      Boolean(p.isMetaMask) &&
      !p.isRainbow &&
      !p.isRainbowWallet &&
      !p.isRabby &&
      !p.isBraveWallet,
  },
  {
    id: "rainbow",
    name: "Rainbow",
    description: "Ethereum wallet · supports Arc",
    installUrl: "https://rainbow.me/download",
    rdns: ["me.rainbow"],
    match: (p) => Boolean(p.isRainbow || p.isRainbowWallet),
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    description: "Extension or Smart Wallet",
    installUrl: "https://www.coinbase.com/wallet/downloads",
    rdns: ["com.coinbase.wallet"],
    match: (p) => Boolean(p.isCoinbaseWallet),
  },
  {
    id: "rabby",
    name: "Rabby",
    description: "Multi-chain browser wallet",
    installUrl: "https://rabby.io/",
    rdns: ["io.rabby"],
    match: (p) => Boolean(p.isRabby),
  },
  {
    id: "okx",
    name: "OKX Wallet",
    description: "Extension · EVM + Arc",
    installUrl: "https://www.okx.com/download",
    rdns: ["com.okex.wallet"],
    match: (p) => Boolean(p.isOkxWallet || p.isOKExWallet),
  },
  {
    id: "brave",
    name: "Brave Wallet",
    description: "Built into Brave browser",
    installUrl: "https://brave.com/wallet/",
    rdns: ["com.brave.wallet"],
    match: (p) => Boolean(p.isBraveWallet),
  },
  {
    id: "injected",
    name: "Browser wallet",
    description: "Any other EIP-1193 wallet on Arc",
    installUrl: "https://chainlist.org/chain/5042",
    rdns: [],
    match: () => true,
  },
];

const SELECTED_WALLET_ID_KEY = "arcadex_selected_wallet_id";
const SELECTED_RDNS_KEY = "arcadex_selected_wallet_rdns";
const SELECTED_UUID_KEY = "arcadex_selected_wallet_uuid";

let eip6963Providers: Eip6963ProviderDetail[] = [];
let eip6963Listening = false;
/** Strong ref to the exact provider object used for connect/switch/send. */
let activeProvider: InjectedProvider | null = null;

export function startEip6963Discovery(): void {
  if (typeof window === "undefined" || eip6963Listening) return;
  eip6963Listening = true;

  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = event.detail;
    if (!detail?.info?.uuid || !detail.provider) return;
    const idx = eip6963Providers.findIndex(
      (p) => p.info.uuid === detail.info.uuid
    );
    if (idx >= 0) eip6963Providers[idx] = detail;
    else eip6963Providers.push(detail);
  });

  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function getEip6963Providers(): Eip6963ProviderDetail[] {
  startEip6963Discovery();
  return [...eip6963Providers];
}

function listLegacyProviders(): InjectedProvider[] {
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
  push(window.rainbow ?? null);

  return out;
}

export function getInstalledArcWallets(): ArcWalletOption[] {
  startEip6963Discovery();
  const eip = getEip6963Providers();
  const legacy = listLegacyProviders();

  const installed: ArcWalletOption[] = [];
  for (const option of ARC_WALLET_OPTIONS) {
    if (option.id === "injected") continue;
    const viaEip = eip.some((d) =>
      option.rdns.some((r) => d.info.rdns.toLowerCase() === r.toLowerCase())
    );
    const viaLegacy = legacy.some((p) => option.match(p));
    if (viaEip || viaLegacy) installed.push(option);
  }

  if (installed.length === 0 && (eip.length > 0 || legacy.length > 0)) {
    installed.push(ARC_WALLET_OPTIONS.find((w) => w.id === "injected")!);
  }

  return installed.length > 0
    ? installed
    : ARC_WALLET_OPTIONS.filter((w) => w.id !== "injected");
}

export function getSelectedWalletId(): ArcWalletId | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SELECTED_WALLET_ID_KEY);
  if (!raw) return null;
  return ARC_WALLET_OPTIONS.some((w) => w.id === raw)
    ? (raw as ArcWalletId)
    : null;
}

export function setSelectedWalletId(id: ArcWalletId | null): void {
  if (typeof window === "undefined") return;
  if (!id) {
    localStorage.removeItem(SELECTED_WALLET_ID_KEY);
    return;
  }
  localStorage.setItem(SELECTED_WALLET_ID_KEY, id);
}

function getSelectedRdns(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SELECTED_RDNS_KEY);
}

function getSelectedUuid(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SELECTED_UUID_KEY);
}

function persistProviderIdentity(detail: Eip6963ProviderDetail | null): void {
  if (typeof window === "undefined") return;
  if (!detail) {
    localStorage.removeItem(SELECTED_RDNS_KEY);
    localStorage.removeItem(SELECTED_UUID_KEY);
    return;
  }
  localStorage.setItem(SELECTED_RDNS_KEY, detail.info.rdns);
  localStorage.setItem(SELECTED_UUID_KEY, detail.info.uuid);
}

export function setActiveProvider(provider: InjectedProvider | null): void {
  activeProvider = provider;
}

/**
 * Resolve the exact provider for switch + send.
 * Order: in-memory active → EIP-6963 uuid/rdns → selected wallet flags → legacy.
 */
export function getPreferredInjectedProvider(): InjectedProvider | null {
  startEip6963Discovery();

  if (activeProvider?.request) return activeProvider;

  const uuid = getSelectedUuid();
  const rdns = getSelectedRdns();
  const eip = getEip6963Providers();

  if (uuid) {
    const byUuid = eip.find((d) => d.info.uuid === uuid);
    if (byUuid?.provider) {
      activeProvider = byUuid.provider;
      return byUuid.provider;
    }
  }

  if (rdns) {
    const byRdns = eip.find(
      (d) => d.info.rdns.toLowerCase() === rdns.toLowerCase()
    );
    if (byRdns?.provider) {
      activeProvider = byRdns.provider;
      return byRdns.provider;
    }
  }

  const selected = getSelectedWalletId();
  if (selected) {
    const option = ARC_WALLET_OPTIONS.find((w) => w.id === selected);
    if (option) {
      const byRdns = eip.find((d) =>
        option.rdns.some((r) => d.info.rdns.toLowerCase() === r.toLowerCase())
      );
      if (byRdns?.provider) {
        activeProvider = byRdns.provider;
        persistProviderIdentity(byRdns);
        return byRdns.provider;
      }
      const legacy = listLegacyProviders().find((p) => option.match(p));
      if (legacy) {
        activeProvider = legacy;
        return legacy;
      }
    }
  }

  // Prefer EIP-6963 announced providers over fighting for window.ethereum.
  if (eip[0]?.provider) {
    activeProvider = eip[0].provider;
    return eip[0].provider;
  }

  const legacy = listLegacyProviders();
  const preferred =
    legacy.find(
      (p) =>
        p.isMetaMask &&
        !p.isRainbow &&
        !p.isRainbowWallet &&
        !p.isRabby &&
        !p.isBraveWallet
    ) ||
    legacy.find((p) => p.isRainbow || p.isRainbowWallet) ||
    legacy.find((p) => p.isRabby) ||
    legacy.find((p) => p.isCoinbaseWallet) ||
    legacy.find((p) => p.isOkxWallet || p.isOKExWallet) ||
    legacy.find((p) => p.isBraveWallet) ||
    legacy[0] ||
    null;

  activeProvider = preferred;
  return preferred;
}

export function findProviderForWallet(
  walletId: ArcWalletId
): InjectedProvider | null {
  startEip6963Discovery();
  const option = ARC_WALLET_OPTIONS.find((w) => w.id === walletId);
  if (!option) return null;

  const eip = getEip6963Providers();
  const byRdns = eip.find((d) =>
    option.rdns.some((r) => d.info.rdns.toLowerCase() === r.toLowerCase())
  );
  if (byRdns?.provider) return byRdns.provider;

  if (walletId === "injected") {
    return eip[0]?.provider ?? listLegacyProviders()[0] ?? null;
  }

  return listLegacyProviders().find((p) => option.match(p)) ?? null;
}

function toHexChainId(id: number): `0x${string}` {
  return `0x${id.toString(16)}` as `0x${string}`;
}

/** wallet_switchEthereumChain + wallet_addEthereumChain for Arc mainnet only. */
export async function ensureArcChain(
  provider: InjectedProvider = getPreferredInjectedProvider()!
): Promise<void> {
  if (!provider?.request) {
    throw new Error("Connect a wallet that supports Arc to continue.");
  }

  setActiveProvider(provider);
  const target = toHexChainId(ARC_CHAIN_ID);

  const readChainId = async (): Promise<string | null> => {
    try {
      return (
        ((await provider.request({
          method: "eth_chainId",
        })) as string) ?? null
      );
    } catch {
      return null;
    }
  };

  const current = await readChainId();
  if (current?.toLowerCase() === target.toLowerCase()) return;

  // Wrong chain (e.g. testnet 5042002) — force switch/add mainnet.
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target }],
    });
    const afterSwitch = await readChainId();
    if (afterSwitch?.toLowerCase() === target.toLowerCase()) return;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? Number((err as { code: unknown }).code)
        : 0;
    const msg = err instanceof Error ? err.message : String(err);
    if (/reject|denied|cancel/i.test(msg) && code === 4001) {
      throw new Error("Switch to Arc was cancelled in your wallet.");
    }
    // 4902 / unrecognized → add chain below
  }

  const rpcUrl = getWalletAddChainRpcUrl();

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
            decimals: 18, // native gas is 18 decimals — NOT ERC-20 6
          },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: ["https://explorer.arc.io"],
        },
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/reject|denied|cancel/i.test(msg)) {
      throw new Error("Adding Arc was cancelled in your wallet.");
    }
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target }],
    });
  } catch {
    // verify below
  }

  const finalId = await readChainId();
  if (finalId?.toLowerCase() === target.toLowerCase()) return;

  if (finalId && Number.parseInt(finalId, 16) === 5042002) {
    throw new Error(
      "Your wallet is on Arc Testnet (5042002). Switch to Arc Mainnet (5042)."
    );
  }

  throw new Error(
    "Could not switch to Arc Mainnet (5042). Remove any old Arc entry in your wallet, add Arc again, then retry."
  );
}

export async function connectArcWallet(
  walletId: ArcWalletId
): Promise<string> {
  startEip6963Discovery();
  // Give extensions a tick to announce.
  await new Promise((r) => setTimeout(r, 50));
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, 50));

  const option = ARC_WALLET_OPTIONS.find((w) => w.id === walletId);
  const eip = getEip6963Providers();
  const detail =
    eip.find((d) =>
      option?.rdns.some((r) => d.info.rdns.toLowerCase() === r.toLowerCase())
    ) ?? null;
  const provider = detail?.provider ?? findProviderForWallet(walletId);

  if (!provider?.request) {
    if (option?.installUrl && typeof window !== "undefined") {
      window.open(option.installUrl, "_blank", "noopener,noreferrer");
    }
    throw new Error(
      `${option?.name ?? "Wallet"} is not installed. Install it, then come back.`
    );
  }

  setSelectedWalletId(walletId);
  persistProviderIdentity(detail);
  setActiveProvider(provider);

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
