import { injected } from "@wagmi/core";
import { createConfig, http } from "wagmi";
import { arcChain } from "@/lib/arc-chain";
import { getArcUpstreamRpcUrls, getBrowserArcRpcUrl } from "@/lib/arc-rpc";

/** Browser → same-origin proxy; server → upstream Arc RPC. */
const rpcUrl =
  typeof window !== "undefined"
    ? getBrowserArcRpcUrl()
    : getArcUpstreamRpcUrls()[0]!;

export const wagmiConfig = createConfig({
  chains: [arcChain],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    [arcChain.id]: http(rpcUrl, { timeout: 12_000 }),
  },
  ssr: true,
});
