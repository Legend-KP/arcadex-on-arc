const { writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");
const { getNetworkMeta } = require("./network-meta.cjs");

async function main() {
  const meta = getNetworkMeta(hre);
  const [deployer] = await hre.ethers.getSigners();

  console.log(`Deploying InfiniteSpark on ${meta.rpcLabel} with:`, deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "USDC (native)");

  const InfiniteSpark = await hre.ethers.getContractFactory("InfiniteSpark");
  const contract = await InfiniteSpark.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const fee = await contract.fee();

  console.log("InfiniteSpark deployed to:", address);
  console.log("Entry fee (6 decimals):", fee.toString(), "($0.10)");

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });

  const outFile = `infinite-spark-${meta.fileSuffix}.json`;
  const deployment = {
    contract: "InfiniteSpark",
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
  console.log("Set NEXT_PUBLIC_INFINITE_SPARK_CONTRACT=" + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
