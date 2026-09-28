import { defineChain } from "viem";
import { arc as viemArc } from "viem/chains";

/** Arc mainnet chain id (must match eth_chainId 0x13b2). */
export const ARC_CHAIN_ID = 5042;

/** Arc mainnet ERC-20 USDC (6 decimals). Same balance as native USDC / 10^12. */
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;

/** Default public RPC — override with NEXT_PUBLIC_ARC_RPC_URL. */
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
