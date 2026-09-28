"use client";

import { usePathname } from "next/navigation";
import WalletProvider from "@/components/WalletProvider";
import PlayerProfileProvider from "@/components/PlayerProfileProvider";
import SparkProvider from "@/components/SparkProvider";
import TouchSfxListener from "@/components/TouchSfxListener";

export default function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin");

  if (isAdminRoute) {
    return <>{children}</>;
  }

  return (
    <WalletProvider>
      <PlayerProfileProvider>
        <SparkProvider>
          <TouchSfxListener />
          {children}
        </SparkProvider>
      </PlayerProfileProvider>
    </WalletProvider>
  );
}
