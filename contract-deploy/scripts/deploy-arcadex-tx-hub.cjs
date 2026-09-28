const { writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");
const { getNetworkMeta } = require("./network-meta.cjs");

async function main() {
  const meta = getNetworkMeta(hre);
  const [deployer] = await hre.ethers.getSigners();

  console.log(`Deploying ArcadeXTxHub on ${meta.rpcLabel} with:`, deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "USDC (native)");

  const ArcadeXTxHub = await hre.ethers.getContractFactory("ArcadeXTxHub");
  const contract = await ArcadeXTxHub.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const owner = await contract.owner();

  console.log("ArcadeXTxHub deployed to:", address);
  console.log("Owner:", owner);

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });

  const outFile = `arcadex-tx-hub-${meta.fileSuffix}.json`;
  const deployment = {
    contract: "ArcadeXTxHub",
    network: meta.network,
    chainId: meta.chainId,
    address,
    owner,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: contract.deploymentTransaction()?.hash ?? null,
    notes:
      "General Arc hub: signIn(purpose) free; payWithUSDC(purpose) after setFee.",
  };

  writeFileSync(join(outDir, outFile), JSON.stringify(deployment, null, 2));
  console.log(`Saved deployments/${outFile}`);
  console.log("Set NEXT_PUBLIC_ARCADEX_TX_HUB_CONTRACT=" + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
