"use client";

import { useEffect, useRef, useState } from "react";
import Logo from "@/components/Logo";
import SparkBatteryBar from "@/components/SparkBatteryBar";
import ActivityLeaderboardButton from "@/components/ActivityLeaderboardButton";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";

interface WebHeaderProps {
  search: string;
  onSearchChange: (value: string) => void;
  activityBoardOpen: boolean;
  onActivityBoardOpenChange: (open: boolean) => void;
}

function shortenWallet(wallet: string): string {
  if (wallet.length < 10) return wallet;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

export default function WebHeader({
  search,
  onSearchChange,
  activityBoardOpen,
  onActivityBoardOpenChange,
}: WebHeaderProps) {
  const { playerName, walletAddress, changeWallet, disconnectWallet } =
    usePlayerProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const initial =
    playerName.trim().charAt(0).toUpperCase() ||
    (walletAddress ? walletAddress.slice(2, 3).toUpperCase() : "?");

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="web-header">
      <Logo variant="header" />

      <label className="web-search">
        <span className="web-search__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path
              d="M20 20l-3.5-3.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search games..."
          aria-label="Search games"
          autoComplete="off"
        />
      </label>

      <div className="web-header__actions">
        <ActivityLeaderboardButton
          open={activityBoardOpen}
          onOpenChange={onActivityBoardOpenChange}
        />
        <SparkBatteryBar />

        <div className="profile-menu" ref={menuRef}>
          <button
            type="button"
            className="profile-menu__trigger"
            aria-label="Profile menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="profile-menu__avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="profile-menu__caret" aria-hidden="true">
              ▾
            </span>
          </button>

          {menuOpen && (
            <div className="profile-menu__dropdown" role="menu">
              <div className="profile-menu__identity">
                <p className="profile-menu__name">
                  {playerName.trim() || "Player"}
                </p>
                {walletAddress ? (
                  <p className="profile-menu__wallet">
                    {shortenWallet(walletAddress)}
                  </p>
                ) : (
                  <p className="profile-menu__wallet">No wallet connected</p>
                )}
              </div>
              <button
                type="button"
                className="profile-menu__item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  changeWallet();
                }}
              >
                Change wallet
              </button>
              <button
                type="button"
                className="profile-menu__item profile-menu__item--danger"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  disconnectWallet();
                }}
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
