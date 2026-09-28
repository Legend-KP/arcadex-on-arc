import type { Hex } from "viem";

/**
 * Celo MiniPay attribution tags are not used on Arc.
 * Kept as no-ops so call sites that append a data suffix stay compile-clean.
 */

export function getAttributionSuffix(): Hex {
  return "0x";
}

/** Identity on Arc — no Celo attribution bytes appended. */
export function appendAttributionSuffix(data: Hex): Hex {
  return data;
}
