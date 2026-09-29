"use client";

import type { Hash, Hex } from "viem";
import { arcChain } from "@/lib/arc-chain";
import { waitForArcTransactionReceipt } from "@/lib/arc-public-client";
import { createInjectedWalletClient, prepareWalletForArcTx } from "@/lib/wallet";
import {
  ARCADEX_REWARDS_ABI,
  ARCADEX_REWARDS_CONTRACT_ADDRESS,
  DEFAULT_STREAK_CAMPAIGN_ID,
  isArcadeXRewardsConfigured,
} from "@/lib/arcadex-rewards";

/**
 * wallet write of ArcadeXRewards.checkIn
 * (campaigns without eligibility use deadline=0, signature=0x).
 *
 * Returns the tx hash even when local receipt polling flakes — `/api/streak/sync`
 * re-verifies on the server so an explorer-confirmed check-in still unlocks the app.
 */
export async function checkInOnChain(
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID,
  opts?: { deadline?: bigint; signature?: Hex }
): Promise<{ txHash: Hash }> {
  if (!isArcadeXRewardsConfigured()) {
    throw new Error("ArcadeXRewards is not configured yet.");
  }

  await prepareWalletForArcTx();

  const walletClient = createInjectedWalletClient();
  if (!walletClient) {
    throw new Error("Connect a wallet to check in.");
  }

  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No wallet account available.");
  }

  // Campaigns without requireEligibility ignore these (pass 0 / 0x).
  const deadline = opts?.deadline ?? BigInt(0);
  const signature = opts?.signature ?? ("0x" as Hex);

  const hash = await walletClient.writeContract({
    account,
    chain: arcChain,
    address: ARCADEX_REWARDS_CONTRACT_ADDRESS,
    abi: ARCADEX_REWARDS_ABI,
    functionName: "checkIn",
    args: [BigInt(campaignId), deadline, signature],
  });

  try {
    const receipt = await waitForArcTransactionReceipt(hash);
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
    // Tx was submitted — sync endpoint verifies the receipt server-side.
  }

  return { txHash: hash };
}
