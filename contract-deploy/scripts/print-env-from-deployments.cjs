/**
 * Print Worker / .env public vars from deployments/*-arc-*.json
 * Usage: node scripts/print-env-from-deployments.cjs
 *        NETWORK=arc-testnet node scripts/print-env-from-deployments.cjs
 */
const { readFileSync, existsSync } = require("fs");
const { join, resolve } = require("path");

const suffix = (process.env.NETWORK || "arc-mainnet").replace(/^arc$/, "arc-mainnet");
const dir = resolve(__dirname, "../../deployments");

const files = {
  SPARK_REFILL: `spark-refill-${suffix}.json`,
  SCORE_SUBMIT: `score-submit-${suffix}.json`,
  INFINITE_SPARK: `infinite-spark-${suffix}.json`,
  ARCADEX_TX_HUB: `arcadex-tx-hub-${suffix}.json`,
  ARCADEX_REWARDS: `arcadex-rewards-${suffix}.json`,
};

function readAddress(file) {
  const path = join(dir, file);
  if (!existsSync(path)) {
    return { missing: true, path };
  }
  const json = JSON.parse(readFileSync(path, "utf8"));
  return {
    address: json.address || "",
    chainId: json.chainId,
    campaignId: json.campaignId,
    path,
  };
}

const chainId = suffix.includes("testnet") ? 5042002 : 5042;
const rpc =
  chainId === 5042002
    ? "https://rpc.testnet.arc.io"
    : "https://rpc.mainnet.arc.io";

const spark = readAddress(files.SPARK_REFILL);
const score = readAddress(files.SCORE_SUBMIT);
const infinite = readAddress(files.INFINITE_SPARK);
const hub = readAddress(files.ARCADEX_TX_HUB);
const rewards = readAddress(files.ARCADEX_REWARDS);

const missing = [spark, score, infinite, hub, rewards].filter((x) => x.missing);
if (missing.length) {
  console.error("Missing deployment files:");
  for (const m of missing) console.error(" -", m.path);
  console.error("Deploy first, then re-run.");
  process.exit(1);
}

const campaignId = rewards.campaignId ?? 1;

console.log("# Paste into Cloudflare Worker vars / .env (public)");
console.log(`NEXT_PUBLIC_CHAIN_ID=${chainId}`);
console.log(`NEXT_PUBLIC_ARC_RPC_URL=${rpc}`);
console.log(`NEXT_PUBLIC_SPARK_REFILL_CONTRACT=${spark.address}`);
console.log(`NEXT_PUBLIC_SCORE_SUBMIT_CONTRACT=${score.address}`);
console.log(`NEXT_PUBLIC_INFINITE_SPARK_CONTRACT=${infinite.address}`);
console.log(`NEXT_PUBLIC_ARCADEX_TX_HUB_CONTRACT=${hub.address}`);
console.log(`NEXT_PUBLIC_ARCADEX_REWARDS_CONTRACT=${rewards.address}`);
console.log(`NEXT_PUBLIC_STREAK_CAMPAIGN_ID=${campaignId}`);
