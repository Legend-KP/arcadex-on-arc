"use client";

import { ReactNode, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useConnect } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi-config";
import { hasInjectedWallet } from "@/lib/wallet";

const queryClient = new QueryClient();

/** Auto-connect when an injected wallet is already available. */
function WalletAutoConnect({ children }: { children: ReactNode }) {
  const { connect, connectors } = useConnect();

  useEffect(() => {
    if (!hasInjectedWallet()) return;
    const connector = connectors[0];
    if (!connector) return;
    connect({ connector });
  }, [connect, connectors]);

  return <>{children}</>;
}

export default function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletAutoConnect>{children}</WalletAutoConnect>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
