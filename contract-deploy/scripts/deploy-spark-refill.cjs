const { writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");
const { getNetworkMeta } = require("./network-meta.cjs");

async function main() {
  const meta = getNetworkMeta(hre);
  const [deployer] = await hre.ethers.getSigners();

  console.log(`Deploying SparkRefill on ${meta.rpcLabel} with:`, deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "USDC (native)");

  const SparkRefill = await hre.ethers.getContractFactory("SparkRefill");
  const contract = await SparkRefill.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const fee = await contract.fee();

  console.log("SparkRefill deployed to:", address);
  console.log("Refill fee (6 decimals):", fee.toString(), "($0.05)");

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });

  const outFile = `spark-refill-${meta.fileSuffix}.json`;
  const deployment = {
    contract: "SparkRefill",
    network: meta.network,
    chainId: meta.chainId,
    address,
    usdc: "0x3600000000000000000000000000000000000000",
    usdcDecimals: 6,
    fee: fee.toString(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: contract.deploymentTransaction()?.hash ?? null,
  };

  writeFileSync(join(outDir, outFile), JSON.stringify(deployment, null, 2));
  console.log(`Saved deployments/${outFile}`);
  console.log("Set NEXT_PUBLIC_SPARK_REFILL_CONTRACT=" + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
