import { defineChain } from "viem";
import { arc as viemArc } from "viem/chains";

/** Arc mainnet chain id (must match eth_chainId 0x13b2). Never use testnet 5042002. */
export const ARC_CHAIN_ID = 5042;

/**
 * Arc mainnet ERC-20 USDC interface (6 decimals) at the canonical precompile.
 * Native gas balance (eth_getBalance) uses **18 decimals** — different scale,
 * same underlying USDC stock (1e18 native wei ≈ 1e6 ERC-20 units).
 */
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;

/** Default public RPC — override with ARC_RPC_URL (server) / NEXT_PUBLIC_ARC_RPC_URL. */
export const ARC_DEFAULT_RPC_URL = "https://rpc.mainnet.arc.io";

/**
 * Arc drops txs whose maxFeePerGas is under 20 Gwei (no receipt).
 * Enforce this floor on every client send.
 */
export const ARC_MIN_MAX_FEE_PER_GAS_WEI = BigInt(20_000_000_000);

/** Prefer the viem built-in `arc` chain; fall back if an older viem is installed. */
export const arcChain =
  viemArc ??
  defineChain({
    id: ARC_CHAIN_ID,
    name: "Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: {
      default: { http: [ARC_DEFAULT_RPC_URL] },
    },
    blockExplorers: {
      default: {
        name: "Arc Explorer",
        url: "https://explorer.arc.io",
        apiUrl: "https://explorer.arc.io/api/v2",
      },
    },
  });
