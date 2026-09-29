import type { Address } from "viem";
import {
  CELO_USDC_ADDRESS,
  CELO_USDC_FEE_CURRENCY,
  CELO_USDT_ADDRESS,
  CELO_USDT_FEE_CURRENCY,
  ERC20_ABI,
  SPARK_REFILL_ABI,
  STABLECOIN_DECIMALS,
  ARC_USDC_TOKEN_ADDRESS,
} from "@/lib/spark-refill";

/** Arc mainnet ScoreSubmit — fallback if NEXT_PUBLIC_* missing at build time. */
const ARC_MAINNET_SCORE_SUBMIT =
  "0x393A322846Cb9b95E9aFC6521e727Cf6C8af8501" as const;

export const SCORE_SUBMIT_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_SCORE_SUBMIT_CONTRACT?.trim() ||
  ARC_MAINNET_SCORE_SUBMIT
) as Address;

export type ScoreSubmitPaymentToken = "USDC";

export const SCORE_SUBMIT_ABI = SPARK_REFILL_ABI;

export {
  ARC_USDC_TOKEN_ADDRESS,
  CELO_USDC_ADDRESS,
  CELO_USDC_FEE_CURRENCY,
  CELO_USDT_ADDRESS,
  CELO_USDT_FEE_CURRENCY,
  ERC20_ABI,
  STABLECOIN_DECIMALS,
};

export function tokenAddress(_token: ScoreSubmitPaymentToken = "USDC"): Address {
  return ARC_USDC_TOKEN_ADDRESS;
}

/** @deprecated CIP-64 unused on Arc. */
export function tokenFeeCurrency(
  _token: ScoreSubmitPaymentToken = "USDC"
): Address {
  return CELO_USDC_FEE_CURRENCY;
}
