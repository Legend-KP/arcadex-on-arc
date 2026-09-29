/**
 * Arc JSON-RPC endpoints + browser proxy path.
 * Browser always uses same-origin `/api/rpc` (avoids ad-blocker + keeps API keys server-side).
 */

import { ARC_CHAIN_ID, ARC_DEFAULT_RPC_URL } from "@/lib/arc-chain";

/** Same-origin path used by the browser public client / wagmi. */
export const ARC_BROWSER_RPC_PATH = "/api/rpc";

/** Public mainnet endpoints (no API key). Used for failover + wallet_addEthereumChain. */
export const ARC_PUBLIC_RPC_URLS = [
  ARC_DEFAULT_RPC_URL,
  "https://rpc.blockdaemon.mainnet.arc.io",
  "https://rpc.drpc.mainnet.arc.io",
  "https://rpc.quicknode.mainnet.arc.io",
] as const;

/** Never use testnet (5042002) in production config. */
export const ARC_TESTNET_CHAIN_ID = 5042002;

export function assertMainnetRpcUrl(url: string): void {
  const lower = url.toLowerCase();
  if (
    lower.includes("testnet") ||
    lower.includes("5042002") ||
    lower.includes("arcscan")
  ) {
    throw new Error(
      `Refusing testnet RPC URL on Arc mainnet (${ARC_CHAIN_ID}): ${url}`
    );
  }
}

/**
 * Upstream Arc RPCs for Workers /api/rpc.
 * Prefer ARC_RPC_URL (server-only). Optional ARC_RPC_API_KEY / ARC_RPC_AUTH_HEADER
 * for permissioned providers (Alchemy, QuickNode, etc.).
 */
export function getArcUpstreamRpcUrls(): string[] {
  const primary =
    process.env.ARC_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim();

  const extras = (process.env.ARC_RPC_FALLBACK_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const urls = [
    ...(primary ? [primary] : []),
    ...extras,
    ...ARC_PUBLIC_RPC_URLS,
  ];

  const deduped = [...new Set(urls.filter(Boolean))];
  for (const url of deduped) {
    assertMainnetRpcUrl(url);
  }
  return deduped;
}

/** Headers for authenticated upstream RPC (never sent to the browser). */
export function getArcUpstreamRpcHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };

  const apiKey = process.env.ARC_RPC_API_KEY?.trim();
  const authHeader = process.env.ARC_RPC_AUTH_HEADER?.trim();

  if (authHeader) {
    headers.authorization = authHeader;
  } else if (apiKey) {
    // Common patterns: Bearer <key> or raw key — Bearer is safest default.
    headers.authorization = apiKey.toLowerCase().startsWith("bearer ")
      ? apiKey
      : `Bearer ${apiKey}`;
  }

  return headers;
}

/** Public RPC for wallet_addEthereumChain (wallets cannot use our authed proxy). */
export function getWalletAddChainRpcUrl(): string {
  const preferred =
    process.env.NEXT_PUBLIC_ARC_WALLET_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim() ||
    ARC_DEFAULT_RPC_URL;
  assertMainnetRpcUrl(preferred);
  return preferred;
}

/** RPC URL for browser-side viem/wagmi — always same-origin proxy. */
export function getBrowserArcRpcUrl(): string {
  if (typeof window === "undefined") {
    return getArcUpstreamRpcUrls()[0]!;
  }
  return ARC_BROWSER_RPC_PATH;
}
