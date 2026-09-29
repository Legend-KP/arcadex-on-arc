"use client";

import type { Address, Hash, Hex } from "viem";
import { arcChain } from "@/lib/arc-chain";
import {
  formatChainError,
  getArcPublicClient,
  waitForArcTransactionReceipt,
} from "@/lib/arc-public-client";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import { createInjectedWalletClient, prepareWalletForArcTx } from "@/lib/wallet";

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

  await prepareWalletForArcTx();

  const walletClient = createInjectedWalletClient();
  if (!walletClient) {
    throw new Error("Connect a wallet to shuffle.");
  }

  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No wallet account available.");
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
      account,
      address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "spin",
      args,
    });
  } catch (err) {
    throw new Error(formatChainError(err));
  }

  const hash = await walletClient.writeContract({
    account,
    chain: arcChain,
    address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    abi: ARCADEX_REWARDS_ABI,
    functionName: "spin",
    args,
      });

  try {
    const receipt = await waitForArcTransactionReceipt(hash);
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
    // Submitted — sync re-verifies on the server.
  }

  return { txHash: hash };
}

export async function claimShuffleRewardOnChain(
  campaignId: number = DEFAULT_SHUFFLE_CAMPAIGN_ID
): Promise<{ txHash: Hash }> {
  if (!isArcadeXRewardsConfigured()) {
    throw new Error("ArcadeXRewards is not configured yet.");
  }

  await prepareWalletForArcTx();

  const walletClient = createInjectedWalletClient();
  if (!walletClient) {
    throw new Error("Connect a wallet to claim.");
  }

  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No wallet account available.");
  }

  const hash = await walletClient.writeContract({
    account,
    chain: arcChain,
    address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    abi: ARCADEX_REWARDS_ABI,
    functionName: "claim",
    args: [BigInt(campaignId)],
      });

  const receipt = await waitForArcTransactionReceipt(hash);
  if (receipt.status !== "success") {
    throw new Error("Claim transaction failed.");
  }

  return { txHash: hash };
}
