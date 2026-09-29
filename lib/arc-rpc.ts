/**
 * Arc JSON-RPC endpoints.
 * Browser must use the same-origin proxy (`/api/rpc`) — public Arc RPC hosts
 * are frequently blocked by ad blockers (net::ERR_BLOCKED_BY_CLIENT).
 */

import { ARC_DEFAULT_RPC_URL } from "@/lib/arc-chain";

/** Same-origin path used by the browser public client / wagmi. */
export const ARC_BROWSER_RPC_PATH = "/api/rpc";

const UPSTREAM_RPC_URLS = [
  ARC_DEFAULT_RPC_URL,
  "https://rpc.blockdaemon.mainnet.arc.io",
  "https://rpc.drpc.mainnet.arc.io",
] as const;

/** Upstream Arc RPCs for server / Workers (never expose as browser default). */
export function getArcUpstreamRpcUrls(): string[] {
  const primary =
    process.env.ARC_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim();
  const urls = primary
    ? [primary, ...UPSTREAM_RPC_URLS.filter((url) => url !== primary)]
    : [...UPSTREAM_RPC_URLS];
  return [...new Set(urls.filter(Boolean))];
}

/** RPC URL for browser-side viem/wagmi — always same-origin proxy. */
export function getBrowserArcRpcUrl(): string {
  if (typeof window === "undefined") {
    return getArcUpstreamRpcUrls()[0]!;
  }
  return ARC_BROWSER_RPC_PATH;
}
