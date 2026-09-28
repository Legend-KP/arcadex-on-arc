/**
 * Preflight checks before Arc contract deploy.
 * Usage: npm run preflight
 *        NETWORK=arcTestnet npm run preflight
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { JsonRpcProvider, Wallet, formatEther } = require("ethers");

async function main() {
  const network = (process.env.NETWORK || "arc").toLowerCase();
  const isTestnet = network === "arctestnet" || network === "testnet";
  const expectedChainId = isTestnet ? 5042002 : 5042;
  const rpc =
    (isTestnet
      ? process.env.ARC_TESTNET_RPC_URL
      : process.env.ARC_RPC_URL) ||
    (isTestnet
      ? "https://rpc.testnet.arc.io"
      : "https://rpc.mainnet.arc.io");

  const pk = process.env.PRIVATE_KEY?.trim();
  if (!pk) {
    console.error("FAIL: PRIVATE_KEY missing in repo-root .env");
    console.error("Add: PRIVATE_KEY=0x...");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(rpc);
  const networkInfo = await provider.getNetwork();
  const chainId = Number(networkInfo.chainId);
  console.log(`RPC: ${rpc}`);
  console.log(`eth_chainId: ${chainId} (expected ${expectedChainId})`);
  if (chainId !== expectedChainId) {
    console.error("FAIL: chainId mismatch — abort deploy");
    process.exit(1);
  }

  const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Native USDC balance: ${formatEther(balance)}`);

  if (balance === 0n) {
    console.error("FAIL: deployer has 0 balance — fund with native USDC for gas");
    process.exit(1);
  }

  console.log("OK: ready to deploy");
  console.log(
    isTestnet
      ? "Next: npm run deploy:all:testnet"
      : "Next: npm run deploy:all"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
