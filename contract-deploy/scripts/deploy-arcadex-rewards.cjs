const { writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");
const { getNetworkMeta } = require("./network-meta.cjs");

const SECONDS_PER_DAY = 24 * 60 * 60;
/** New Arc campaign — do NOT reuse Celo campaign 4. */
const CAMPAIGN_ID = 1;
/** Match live ArcadeX 30-day off-chain Infinite Spark ladder. */
const REQUIRED_DAYS = 30;
const REWARD_OFFCHAIN = 0;
const CAMPAIGN_TYPE_STREAK = 0;

async function main() {
  const meta = getNetworkMeta(hre);
  const [deployer] = await hre.ethers.getSigners();

  console.log(`Deploying ArcadeXRewards on ${meta.rpcLabel} with:`, deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "USDC (native)");

  // Pass deployer as initial eligibility signer (can rotate later). Zero skips gated campaigns.
  const ArcadeXRewards = await hre.ethers.getContractFactory("ArcadeXRewards");
  const contract = await ArcadeXRewards.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("ArcadeXRewards deployed to:", address);

  const rewardMeta = hre.ethers.id("INFINITE_SPARK_24H");
  const now = Math.floor(Date.now() / 1000);
  const startTime = now;
  const endTime = now + 365 * SECONDS_PER_DAY; // 1 year window; shorten via setCampaign later

  const tx = await contract.setCampaign(
    CAMPAIGN_ID,
    CAMPAIGN_TYPE_STREAK,
    true, // active
    REQUIRED_DAYS,
    SECONDS_PER_DAY,
    0, // maxClaims (N/A for off-chain)
    startTime,
    endTime,
    REWARD_OFFCHAIN,
    hre.ethers.ZeroAddress,
    0,
    rewardMeta,
    true, // resetAfterMilestone
    false, // requireEligibility — open for Infinite Spark streak
    0 // maxSinglePayout (STREAK only; must be 0)
  );
  await tx.wait();

  console.log(
    "Campaign",
    CAMPAIGN_ID,
    "configured (30-day OFFCHAIN Infinite Spark STREAK)"
  );
  console.log("  startTime:", startTime);
  console.log("  endTime:", endTime);
  console.log("  requireEligibility: false");
  console.log("  campaignType: STREAK");
  console.log("  requiredDays:", REQUIRED_DAYS);

  // Shuffle needs an on-chain spinResultSigner. Prefer SPIN_RESULT_PRIVATE_KEY
  // address; otherwise use deployer so preview smoke can run.
  let spinResultSigner = deployer.address;
  const spinPk = process.env.SPIN_RESULT_PRIVATE_KEY?.trim();
  if (spinPk) {
    spinResultSigner = new hre.ethers.Wallet(
      spinPk.startsWith("0x") ? spinPk : `0x${spinPk}`
    ).address;
  }
  const spinTx = await contract.setSpinResultSigner(spinResultSigner);
  await spinTx.wait();
  console.log("spinResultSigner set to:", spinResultSigner);

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });

  const outFile = `arcadex-rewards-${meta.fileSuffix}.json`;
  const deployment = {
    contract: "ArcadeXRewards",
    network: meta.network,
    chainId: meta.chainId,
    address,
    campaignId: CAMPAIGN_ID,
    campaignType: "STREAK",
    requiredDays: REQUIRED_DAYS,
    minIntervalSeconds: SECONDS_PER_DAY,
    rewardMode: REWARD_OFFCHAIN,
    rewardMeta,
    resetAfterMilestone: true,
    requireEligibility: false,
    maxSinglePayout: 0,
    startTime,
    endTime,
    eligibilitySigner: deployer.address,
    spinResultSigner,
    constructorArgs: [deployer.address],
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: contract.deploymentTransaction()?.hash ?? null,
    setCampaignTxHash: tx.hash,
    setSpinResultSignerTxHash: spinTx.hash,
  };

  writeFileSync(join(outDir, outFile), JSON.stringify(deployment, null, 2));

  console.log(`Saved deployments/${outFile}`);
  console.log("Set NEXT_PUBLIC_ARCADEX_REWARDS_CONTRACT=" + address);
  console.log("Set NEXT_PUBLIC_STREAK_CAMPAIGN_ID=" + CAMPAIGN_ID);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
