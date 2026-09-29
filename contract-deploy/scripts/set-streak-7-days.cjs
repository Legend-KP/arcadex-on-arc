/**
 * Configure (or create) a 7-day STREAK campaign on ArcadeXRewards.
 *
 * If campaign 1 already has participants, requiredDays is frozen — this script
 * creates campaign id NEXT_STREAK_CAMPAIGN_ID (default 2) instead and prints
 * the env var to set.
 *
 * Usage (from contract-deploy/):
 *   npx hardhat run scripts/set-streak-7-days.cjs --network arc
 *
 * Env:
 *   ARCADEX_REWARDS_CONTRACT  (optional; defaults to deployments JSON)
 *   STREAK_CAMPAIGN_ID        target id to update first (default 1)
 *   NEXT_STREAK_CAMPAIGN_ID   fallback new id if ParamsFrozen (default 2)
 */

const { readFileSync, existsSync, writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");
const { getNetworkMeta } = require("./network-meta.cjs");

const SECONDS_PER_DAY = 24 * 60 * 60;
const REQUIRED_DAYS = 7;
const REWARD_OFFCHAIN = 0;
const CAMPAIGN_TYPE_STREAK = 0;

function loadDeployedAddress(meta) {
  const fromEnv = process.env.ARCADEX_REWARDS_CONTRACT?.trim();
  if (fromEnv) return fromEnv;

  const file = resolve(
    __dirname,
    `../../deployments/arcadex-rewards-${meta.fileSuffix}.json`
  );
  if (!existsSync(file)) {
    throw new Error(
      `Missing ${file}. Set ARCADEX_REWARDS_CONTRACT or deploy first.`
    );
  }
  return JSON.parse(readFileSync(file, "utf8")).address;
}

async function setStreakCampaign(contract, campaignId, now) {
  const rewardMeta = hre.ethers.id("INFINITE_SPARK_24H");
  const startTime = now;
  const endTime = now + 365 * SECONDS_PER_DAY;

  const tx = await contract.setCampaign(
    campaignId,
    CAMPAIGN_TYPE_STREAK,
    true,
    REQUIRED_DAYS,
    SECONDS_PER_DAY,
    0,
    startTime,
    endTime,
    REWARD_OFFCHAIN,
    hre.ethers.ZeroAddress,
    0,
    rewardMeta,
    true, // resetAfterMilestone
    false, // requireEligibility
    0
  );
  await tx.wait();
  return { txHash: tx.hash, startTime, endTime, rewardMeta };
}

async function main() {
  const meta = getNetworkMeta(hre);
  const [deployer] = await hre.ethers.getSigners();
  const address = loadDeployedAddress(meta);
  const preferredId = Number(process.env.STREAK_CAMPAIGN_ID?.trim() || "1");
  const fallbackId = Number(process.env.NEXT_STREAK_CAMPAIGN_ID?.trim() || "2");

  console.log(`ArcadeXRewards @ ${address} on ${meta.rpcLabel}`);
  console.log("Signer:", deployer.address);

  const contract = await hre.ethers.getContractAt("ArcadeXRewards", address);
  const owner = await contract.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `Signer is not owner. owner=${owner} signer=${deployer.address}`
    );
  }

  const now = Math.floor(Date.now() / 1000);
  let campaignId = preferredId;
  let result;

  try {
    console.log(`Trying setCampaign(${preferredId}) with requiredDays=${REQUIRED_DAYS}...`);
    result = await setStreakCampaign(contract, preferredId, now);
    console.log("Updated campaign", preferredId);
  } catch (err) {
    const msg = err?.shortMessage || err?.message || String(err);
    const frozen =
      /ParamsFrozen|has participants|frozen/i.test(msg) ||
      err?.data?.includes?.("ParamsFrozen");

    if (!frozen) throw err;

    console.warn(
      `Campaign ${preferredId} is frozen (already has check-ins). Creating campaign ${fallbackId} instead.`
    );
    campaignId = fallbackId;
    result = await setStreakCampaign(contract, fallbackId, now);
    console.log("Created campaign", fallbackId);
  }

  const campaign = await contract.getCampaign(campaignId);
  console.log("On-chain campaign:", {
    id: campaignId,
    active: campaign.active ?? campaign[0],
    requiredDays: Number(campaign.requiredDays ?? campaign[4]),
    minIntervalSeconds: Number(campaign.minIntervalSeconds ?? campaign[5]),
  });

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `streak-7day-${meta.fileSuffix}.json`);
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        contract: "ArcadeXRewards",
        address,
        network: meta.network,
        chainId: meta.chainId,
        campaignId,
        requiredDays: REQUIRED_DAYS,
        setCampaignTxHash: result.txHash,
        updatedAt: new Date().toISOString(),
        env: {
          NEXT_PUBLIC_STREAK_CAMPAIGN_ID: String(campaignId),
          NEXT_PUBLIC_ARCADEX_REWARDS_CONTRACT: address,
        },
      },
      null,
      2
    )
  );

  console.log(`Saved ${outFile}`);
  console.log("");
  console.log("Set these in wrangler / Cloudflare:");
  console.log(`  NEXT_PUBLIC_STREAK_CAMPAIGN_ID=${campaignId}`);
  console.log(`  NEXT_PUBLIC_ARCADEX_REWARDS_CONTRACT=${address}`);
  console.log("Keep DAILY_PLAY_MODE=streak");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
