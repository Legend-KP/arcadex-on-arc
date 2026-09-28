/**
 * Resolve Arc network labels from the connected Hardhat network.
 * chainId 5042 = mainnet, 5042002 = testnet.
 */
function getNetworkMeta(hre) {
  const chainId = Number(hre.network.config.chainId);
  if (chainId === 5042) {
    return {
      chainId,
      network: "arc-mainnet",
      fileSuffix: "arc-mainnet",
      rpcLabel: "Arc mainnet",
    };
  }
  if (chainId === 5042002) {
    return {
      chainId,
      network: "arc-testnet",
      fileSuffix: "arc-testnet",
      rpcLabel: "Arc testnet",
    };
  }
  throw new Error(
    `Unsupported chainId ${chainId}. Use --network arc (5042) or --network arcTestnet (5042002).`
  );
}

module.exports = { getNetworkMeta };
