import { injected } from "@wagmi/core";
import { createConfig, http } from "wagmi";
import { ARC_DEFAULT_RPC_URL, arcChain } from "@/lib/arc-chain";

const rpcUrl =
  process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim() || ARC_DEFAULT_RPC_URL;

export const wagmiConfig = createConfig({
  chains: [arcChain],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    [arcChain.id]: http(rpcUrl),
  },
  ssr: true,
});
