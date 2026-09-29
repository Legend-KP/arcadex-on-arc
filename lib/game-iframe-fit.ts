/** All ArcadeX Unity builds target portrait 1080×1920. */
export const GAME_DESIGN_WIDTH = 1080;
export const GAME_DESIGN_HEIGHT = 1920;

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
 * Keeps the iframe at the design resolution (1080×1920) so every WebGL build
 * — fullscreen CSS or legacy fixed-`1080px` — sees a true 9:16 viewport, then
 * scales that rect to cover the screen (no letterbox/pillarbox bars).
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
