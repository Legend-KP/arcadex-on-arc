require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const privateKey = process.env.PRIVATE_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    arc: {
      url: process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io",
      chainId: 5042,
      accounts: privateKey ? [`0x${privateKey.replace(/^0x/, "")}`] : [],
    },
    arcTestnet: {
      url: process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io",
      chainId: 5042002,
      accounts: privateKey ? [`0x${privateKey.replace(/^0x/, "")}`] : [],
    },
  },
  etherscan: {
    apiKey: {
      arc: process.env.ARCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "empty",
      arcTestnet:
        process.env.ARCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "empty",
    },
    customChains: [
      {
        network: "arc",
        chainId: 5042,
        urls: {
          apiURL: "https://explorer.arc.io/api",
          browserURL: "https://explorer.arc.io",
        },
      },
      {
        network: "arcTestnet",
        chainId: 5042002,
        urls: {
          apiURL: "https://explorer.testnet.arc.io/api",
          browserURL: "https://explorer.testnet.arc.io",
        },
      },
    ],
  },
  sourcify: {
    enabled: true,
  },
};
