const RECENT_GAMES_KEY = "arcadex_recent_games";
const MAX_RECENT = 24;

/** Most-recently opened game ids (newest first), for Continue playing. */
export function readRecentGameIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_GAMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function rememberRecentGame(gameId: string): void {
  if (typeof window === "undefined" || !gameId) return;
  const next = [gameId, ...readRecentGameIds().filter((id) => id !== gameId)].slice(
    0,
    MAX_RECENT
  );
  try {
    localStorage.setItem(RECENT_GAMES_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — ignore
  }
}
