/**
 * ArcadeX on Arc — transaction → contract function map.
 * All client writes go through these helpers (viem wallet client / eth_sendTransaction).
 */

import { checkInOnChain } from "@/lib/arcadex-rewards-check-in";
import {
  claimShuffleRewardOnChain,
  spinOnChain,
} from "@/lib/arcadex-rewards-spin";
import {
  playPurpose,
  scoreSubmitPurpose,
  signInOnChain,
} from "@/lib/arcadex-tx-hub";
import { purchaseInfiniteSparkOnChain } from "@/lib/infinite-spark-purchase";
import { purchaseScoreSubmitOnChain } from "@/lib/score-submit-purchase";
import { purchaseSparkRefillOnChain } from "@/lib/spark-refill-purchase";

/** Product action → on-chain function (and follow-up API). */
export const ARC_TX_MAP = {
  dailyCheckIn: {
    contract: "ArcadeXRewards",
    functionName: "checkIn",
    client: "checkInOnChain",
    confirmApi: "/api/streak/sync",
  },
  dailyShuffleSpin: {
    contract: "ArcadeXRewards",
    functionName: "spin",
    client: "spinOnChain",
    confirmApi: "/api/shuffle/sync",
  },
  dailyShuffleClaim: {
    contract: "ArcadeXRewards",
    functionName: "claim",
    client: "claimShuffleRewardOnChain",
    confirmApi: null,
  },
  startGame: {
    contract: "ArcadeXTxHub",
    functionName: "signIn",
    purpose: "PLAY:{gameId}",
    client: "signInOnChain(playPurpose)",
    confirmApi: "/api/sparks/spend",
  },
  sparkRefill: {
    contract: "USDC approve → SparkRefill.payWithUSDC",
    functionName: "approve + payWithUSDC",
    client: "purchaseSparkRefillOnChain",
    confirmApi: "/api/sparks/refill",
  },
  infiniteSpark: {
    contract: "USDC approve → InfiniteSpark.payWithUSDC",
    functionName: "approve + payWithUSDC",
    client: "purchaseInfiniteSparkOnChain",
    confirmApi: "/api/sparks/infinite",
  },
  scoreSubmitContest: {
    contract: "USDC approve → ScoreSubmit.payWithUSDC",
    functionName: "approve + payWithUSDC",
    client: "purchaseScoreSubmitOnChain",
    confirmApi: "/api/games/[id]/leaderboard/submit",
  },
  scoreSubmitFree: {
    contract: "ArcadeXTxHub",
    functionName: "signIn",
    purpose: "SCORE_SUBMIT:{gameId}",
    client: "signInOnChain(scoreSubmitPurpose)",
    confirmApi: "/api/games/[id]/leaderboard/submit",
  },
} as const;

export {
  checkInOnChain,
  claimShuffleRewardOnChain,
  playPurpose,
  purchaseInfiniteSparkOnChain,
  purchaseScoreSubmitOnChain,
  purchaseSparkRefillOnChain,
  scoreSubmitPurpose,
  signInOnChain,
  spinOnChain,
};
