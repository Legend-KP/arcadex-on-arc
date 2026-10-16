/** Canonical portrait design size for legacy fixed-canvas Unity builds. */
export const GAME_DESIGN_WIDTH = 1080;
export const GAME_DESIGN_HEIGHT = 1920;

export type GameIframeFitMode = "cover" | "fill";

export interface GameIframeLayout {
  mode: GameIframeFitMode;
  width: number;
  height: number;
  scale: number;
  left: number;
  top: number;
}

export interface GameIframeCoverLayout {
  width: number;
  height: number;
  scale: number;
  left: number;
  top: number;
}

/**
 * Cover-fit a portrait Unity iframe inside the shell viewport.
 *
 * Keeps the iframe at the design resolution (1080×1920) so legacy WebGL builds
 * that assume a fixed 9:16 canvas still see that viewport, then scales the rect
 * to cover the screen (no letterbox/pillarbox bars).
 */
export function computeGameIframeCoverLayout(
  viewportWidth: number,
  viewportHeight: number,
  designWidth: number = GAME_DESIGN_WIDTH,
  designHeight: number = GAME_DESIGN_HEIGHT
): GameIframeCoverLayout | null {
  if (viewportWidth <= 0 || viewportHeight <= 0) return null;

  const scale = Math.max(
    viewportWidth / designWidth,
    viewportHeight / designHeight
  );

  return {
    width: designWidth,
    height: designHeight,
    scale,
    left: (viewportWidth - designWidth * scale) / 2,
    top: (viewportHeight - designHeight * scale) / 2,
  };
}

/**
 * Responsive games (built for all screens) should receive the real shell size
 * on landscape / desktop. Forcing 9:16 cover there crops the playfield and
 * leaves large empty regions around landscape layouts (e.g. 6×3 grids).
 *
 * Portrait shells (phones / MiniPay) keep cover so older fixed-canvas builds
 * still get a true 9:16 viewport.
 */
export function shouldUseFillLayout(
  viewportWidth: number,
  viewportHeight: number
): boolean {
  if (viewportWidth <= 0 || viewportHeight <= 0) return false;
  // Wider than tall → desktop / tablet landscape / phone landscape
  return viewportWidth >= viewportHeight;
}

export function computeGameIframeLayout(
  viewportWidth: number,
  viewportHeight: number
): GameIframeLayout | null {
  if (viewportWidth <= 0 || viewportHeight <= 0) return null;

  if (shouldUseFillLayout(viewportWidth, viewportHeight)) {
    return {
      mode: "fill",
      width: viewportWidth,
      height: viewportHeight,
      scale: 1,
      left: 0,
      top: 0,
    };
  }

  const cover = computeGameIframeCoverLayout(viewportWidth, viewportHeight);
  if (!cover) return null;
  return { mode: "cover", ...cover };
}

export function applyGameIframeCoverLayout(
  iframe: HTMLIFrameElement,
  layout: GameIframeCoverLayout
): void {
  iframe.style.position = "absolute";
  iframe.style.width = `${layout.width}px`;
  iframe.style.height = `${layout.height}px`;
  iframe.style.left = `${layout.left}px`;
  iframe.style.top = `${layout.top}px`;
  iframe.style.right = "auto";
  iframe.style.bottom = "auto";
  iframe.style.maxWidth = "none";
  iframe.style.maxHeight = "none";
  iframe.style.transform = `scale(${layout.scale})`;
  iframe.style.transformOrigin = "0 0";
}

/** Let Unity see the real shell viewport (responsive / all-screen builds). */
export function applyGameIframeFillLayout(iframe: HTMLIFrameElement): void {
  iframe.style.position = "absolute";
  iframe.style.inset = "0";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.left = "0";
  iframe.style.top = "0";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.maxWidth = "none";
  iframe.style.maxHeight = "none";
  iframe.style.transform = "none";
  iframe.style.transformOrigin = "0 0";
}

export function applyGameIframeLayout(
  iframe: HTMLIFrameElement,
  layout: GameIframeLayout
): void {
  if (layout.mode === "fill") {
    applyGameIframeFillLayout(iframe);
    return;
  }
  applyGameIframeCoverLayout(iframe, layout);
}
