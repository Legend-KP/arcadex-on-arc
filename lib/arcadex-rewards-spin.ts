"use client";

import type { Address, Hash, Hex } from "viem";
import {
  formatChainError,
  getArcPublicClient,
  waitForArcTransactionReceipt,
} from "@/lib/arc-public-client";
import { sendArcContractWrite } from "@/lib/arc-send";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";

export async function spinOnChain(opts: {
  campaignId?: number;
  rewardMode: number;
  rewardTarget: Address;
  rewardAmount: bigint;
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
}): Promise<{ txHash: Hash }> {
  if (!isArcadeXRewardsConfigured()) {
    throw new Error("ArcadeXRewards is not configured yet.");
  }

  const campaignId = opts.campaignId ?? DEFAULT_SHUFFLE_CAMPAIGN_ID;
  const args = [
    BigInt(campaignId),
    opts.rewardMode,
    opts.rewardTarget,
    opts.rewardAmount,
    opts.nonce,
    opts.deadline,
    opts.signature,
  ] as const;

  try {
    await getArcPublicClient().simulateContract({
      address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "spin",
      args,
    });
  } catch (err) {
    throw new Error(formatChainError(err));
  }

  const { txHash } = await sendArcContractWrite({
    address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    abi: ARCADEX_REWARDS_ABI as import("viem").Abi,
    functionName: "spin",
    args,
  });

  try {
    const receipt = await waitForArcTransactionReceipt(txHash);
    if (receipt.status !== "success") {
      throw new Error("Shuffle transaction failed.");
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("Shuffle transaction failed.")
    ) {
      throw err;
    }
  }

  return { txHash };
}

export async function claimShuffleRewardOnChain(
  campaignId: number = DEFAULT_SHUFFLE_CAMPAIGN_ID
): Promise<{ txHash: Hash }> {
  if (!isArcadeXRewardsConfigured()) {
    throw new Error("ArcadeXRewards is not configured yet.");
  }

  const { txHash } = await sendArcContractWrite({
    address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    abi: ARCADEX_REWARDS_ABI as import("viem").Abi,
    functionName: "claim",
    args: [BigInt(campaignId)],
  });

  const receipt = await waitForArcTransactionReceipt(txHash);
  if (receipt.status !== "success") {
    throw new Error("Claim transaction failed.");
  }

  return { txHash };
}
