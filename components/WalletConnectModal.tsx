"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Logo from "@/components/Logo";
import {
  ARC_WALLET_OPTIONS,
  connectArcWallet,
  isWalletInstalled,
  startEip6963Discovery,
  type ArcWalletId,
} from "@/lib/arc-wallet";
import { normalizeWalletAddress } from "@/lib/wallet-address";

interface WalletConnectModalProps {
  open: boolean;
  connecting?: boolean;
  error?: string;
  onConnected: (walletAddress: string) => void;
  onError?: (message: string) => void;
}

const PRIMARY_IDS: ArcWalletId[] = [
  "metamask",
  "rainbow",
  "coinbase",
  "rabby",
  "okx",
  "brave",
];

export default function WalletConnectModal({
  open,
  connecting = false,
  error,
  onConnected,
  onError,
}: WalletConnectModalProps) {
  const [busyId, setBusyId] = useState<ArcWalletId | null>(null);
  const [localError, setLocalError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    startEip6963Discovery();
  }, []);

  useEffect(() => {
    if (!open) {
      setBusyId(null);
      setLocalError("");
    }
  }, [open]);

  const wallets = useMemo(
    () =>
      ARC_WALLET_OPTIONS.filter((w) => PRIMARY_IDS.includes(w.id)).map((w) => ({
        ...w,
        installed: isWalletInstalled(w.id),
      })),
    [open]
  );

  if (!open || !mounted) return null;

  const displayError = localError || error || "";
  const locked = connecting || Boolean(busyId);

  async function handlePick(id: ArcWalletId) {
    if (locked) return;
    setLocalError("");
    setBusyId(id);
    try {
      const address = await connectArcWallet(id);
      onConnected(normalizeWalletAddress(address));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not connect wallet. Try another Arc wallet.";
      setLocalError(message);
      onError?.(message);
    } finally {
      setBusyId(null);
    }
  }

  const modal = (
    <div className="player-modal-backdrop">
      <div
        className="player-modal wallet-connect-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-connect-title"
      >
        <Logo variant="login" />
        <p className="player-modal-subtitle">ArcadeX on Arc</p>
        <h2 id="wallet-connect-title" className="player-modal-title">
          Choose your wallet
        </h2>
        <p className="player-modal-hint">
          Pick any Arc-compatible wallet. We&apos;ll add Arc (chain 5042) if
          needed.
        </p>

        <ul className="wallet-connect-list" role="list">
          {wallets.map((wallet) => {
            const isBusy = busyId === wallet.id;
            return (
              <li key={wallet.id}>
                <button
                  type="button"
                  className={`wallet-connect-option${
                    wallet.installed ? " wallet-connect-option--ready" : ""
                  }`}
                  disabled={locked}
                  onClick={() => void handlePick(wallet.id)}
                >
                  <span className="wallet-connect-option__main">
                    <span className="wallet-connect-option__name">
                      {wallet.name}
                    </span>
                    <span className="wallet-connect-option__desc">
                      {wallet.installed
                        ? wallet.description
                        : `Install ${wallet.name} to continue`}
                    </span>
                  </span>
                  <span className="wallet-connect-option__badge">
                    {isBusy
                      ? "Connecting…"
                      : wallet.installed
                        ? "Connect"
                        : "Install"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {displayError ? <p className="error-msg">{displayError}</p> : null}

        <p className="wallet-connect-footnote">
          Gas on Arc is USDC. Fund a small USDC balance after connecting.
        </p>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
