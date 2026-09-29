"use client";

import { useEffect, useMemo, useState } from "react";
import { Game, gameIsNewArrival } from "@/types";
import AppFooter from "@/components/AppFooter";
import GameCard from "@/components/GameCard";
import WebHeader from "@/components/WebHeader";
import PromoPopupHost from "@/components/PromoPopupHost";
import {
  readCachedGamesList,
  shouldBackgroundRefreshGamesList,
  writeCachedGamesList,
} from "@/lib/games-list-client-cache";
import { fetchHomeShell } from "@/lib/home-client";
import { getCachedWallet } from "@/lib/player-id";
import { readRecentGameIds } from "@/lib/recent-games";
import { sortGames } from "@/lib/game-sort";

type HomeFilter = "for-you" | "all" | "continue" | "new";

const FILTERS: { id: HomeFilter; label: string }[] = [
  { id: "for-you", label: "For you" },
  { id: "all", label: "All" },
  { id: "continue", label: "Continue playing" },
  { id: "new", label: "New" },
];

export default function HomePage() {
  const [games, setGames] = useState<Game[]>(() => {
    return readCachedGamesList()?.games ?? [];
  });
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(() => {
    return readCachedGamesList()?.playCounts ?? {};
  });
  const [testGameId, setTestGameId] = useState<string | null>(() => {
    return readCachedGamesList()?.testGameId ?? null;
  });
  const [loading, setLoading] = useState(() => !readCachedGamesList());
  const [error, setError] = useState("");
  const [activityBoardOpen, setActivityBoardOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<HomeFilter>("all");
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    setRecentIds(readRecentGameIds());
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setRecentIds(readRecentGameIds());
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Fetch games immediately — do not wait for wallet / streak / profile.
  useEffect(() => {
    let cancelled = false;
    const hadCache = Boolean(readCachedGamesList());

    async function loadGames(background = false) {
      if (!background) {
        setLoading(true);
        setError("");
      }

      try {
        const data = await fetchHomeShell(getCachedWallet() ?? undefined);
        if (cancelled) return;

        const nextGames = data.games ?? [];
        const nextPlayCounts = data.playCounts ?? {};
        const nextTestGameId = data.testGameId ?? null;
        setGames(nextGames);
        setPlayCounts(nextPlayCounts);
        setTestGameId(nextTestGameId);
        writeCachedGamesList({
          games: nextGames,
          playCounts: nextPlayCounts,
          testGameId: nextTestGameId,
          fetchedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        if (!background || !hadCache) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load games. Please try again."
          );
        }
      } finally {
        if (!cancelled && !background) setLoading(false);
      }
    }

    if (hadCache) {
      void loadGames(true);
    } else {
      void loadGames(false);
    }

    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        shouldBackgroundRefreshGamesList()
      ) {
        void loadGames(true);
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const filteredGames = useMemo(() => {
    const query = search.trim().toLowerCase();
    let list = sortGames(games);

    if (filter === "for-you") {
      list = [...list].sort(
        (a, b) => (playCounts[b.id] ?? 0) - (playCounts[a.id] ?? 0)
      );
    } else if (filter === "continue") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list
        .filter((g) => order.has(g.id))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else if (filter === "new") {
      list = list.filter((g) => gameIsNewArrival(g));
    }

    if (query) {
      list = list.filter((g) => g.name.toLowerCase().includes(query));
    }

    return list;
  }, [games, playCounts, filter, search, recentIds]);

  const emptyMessage =
    filter === "continue"
      ? "Play a game to see it here."
      : filter === "new"
        ? "No new arrivals right now."
        : search.trim()
          ? "No games match your search."
          : "No games yet. Check back soon!";

  return (
    <div className="home">
      <div className="home-ambient" aria-hidden />
      <div className="home-shell">
        <WebHeader
          search={search}
          onSearchChange={setSearch}
          activityBoardOpen={activityBoardOpen}
          onActivityBoardOpenChange={setActivityBoardOpen}
        />

        <nav className="web-nav" aria-label="Main">
          <span className="web-nav__tab web-nav__tab--active">Home</span>
        </nav>

        <div className="filter-bar" role="tablist" aria-label="Game filters">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`filter-chip${filter === item.id ? " filter-chip--active" : ""}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <main className="home-main">
          {error ? (
            <p className="no-games">{error}</p>
          ) : loading ? (
            <div
              className="games-grid games-grid--loading"
              aria-busy="true"
              aria-label="Loading games"
            >
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="game-card-skeleton" aria-hidden />
              ))}
            </div>
          ) : filteredGames.length === 0 ? (
            <p className="no-games">{emptyMessage}</p>
          ) : (
            <div className="games-grid">
              {filteredGames.map((game, index) => (
                <GameCard
                  key={game.id}
                  game={game}
                  playCount={playCounts[game.id] ?? 0}
                  priority={index < 8}
                />
              ))}
            </div>
          )}
        </main>

        <AppFooter testGameId={testGameId} />
      </div>

      <PromoPopupHost
        games={games}
        onOpenActivityBoard={() => setActivityBoardOpen(true)}
      />
    </div>
  );
}
