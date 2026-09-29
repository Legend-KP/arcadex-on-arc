"use client";

import type { Hash, Hex } from "viem";
import { waitForArcTransactionReceipt } from "@/lib/arc-public-client";
import { sendArcContractWrite } from "@/lib/arc-send";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
  DEFAULT_STREAK_CAMPAIGN_ID,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";

/**
 * ArcadeXRewards.checkIn — daily streak / app sign-in on Arc.
 * Sync with `/api/streak/sync` after this returns.
 */
export async function checkInOnChain(
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID,
  opts?: { deadline?: bigint; signature?: Hex }
): Promise<{ txHash: Hash }> {
  if (!isArcadeXRewardsConfigured()) {
    throw new Error("ArcadeXRewards is not configured yet.");
  }

  const deadline = opts?.deadline ?? BigInt(0);
  const signature = opts?.signature ?? ("0x" as Hex);

  const { txHash } = await sendArcContractWrite({
    address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    abi: ARCADEX_REWARDS_ABI as import("viem").Abi,
    functionName: "checkIn",
    args: [BigInt(campaignId), deadline, signature],
  });

  try {
    const receipt = await waitForArcTransactionReceipt(txHash);
    if (receipt.status !== "success") {
      throw new Error("Check-in transaction failed.");
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("Check-in transaction failed.")
    ) {
      throw err;
    }
    // Submitted — `/api/streak/sync` re-verifies server-side.
  }

  return { txHash };
}
