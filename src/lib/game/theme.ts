import type { CSSProperties } from "react";
import { Color } from "three";
import { useGameStore, type SceneId } from "@/store/gameStore";

// Each scene's color signature. The fog and the overhead spotlight take on a
// pastel wash of it (Stage's Atmosphere springs between them), so the white
// world shifts hue with the game instead of growing colored borders.
export const SCENE_THEMES: Record<SceneId, string> = {
  hub: "#e0f7fa", // icy blue
  pingpong: "#00e5ff", // cyan
  bowling: "#ff8a65", // amber
  golf: "#69f0ae", // mint
};

/** Each signature's deep shade, the UI's accent: dark enough for text on white (at least 4.5:1). */
export const SCENE_INKS: Record<SceneId, string> = {
  hub: "#2b6a85",
  pingpong: "#00758a",
  bowling: "#b84a1f",
  golf: "#0b7a4b",
};

/** How much of the signature the fog takes: 0 is white, 1 the full color. */
const PASTEL = 0.3;

const FOG_COLORS = Object.fromEntries(
  Object.entries(SCENE_THEMES).map(([scene, hex]) => [scene, `#${new Color("#ffffff").lerp(new Color(hex), PASTEL).getHexString()}`]),
) as Record<SceneId, string>;

export const useColorTheme = () => useGameStore((s) => FOG_COLORS[s.scene]);

/**
 * The scene's colors as CSS variables for the DOM overlay (globals.css
 * registers them, so the `themed` utility eases them like the fog).
 */
export function themeVars(scene: SceneId) {
  return { "--accent": SCENE_THEMES[scene], "--accent-ink": SCENE_INKS[scene], "--wash": FOG_COLORS[scene] } as CSSProperties;
}
