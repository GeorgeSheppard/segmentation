/**
 * The theme.
 *
 * Every colour that carries meaning comes from here, checked with the data-viz validator
 * (OKLCH lightness band, chroma floor, CVD separation under simulated protanopia/
 * deuteranopia, normal-vision separation, contrast vs the surface) on the **all-pairs**
 * pairlist — because a point cloud is a scatter form, where any two classes can end up
 * side by side.
 *
 * That gate is why there are only ever THREE meaning-carrying colours on screen at once:
 *
 *   ground     the accepted ground
 *   nonGround  everything rejected
 *   focus      whatever the current step is singling out — noise, seeds, peeled points,
 *              an undecided cell, a reverted cell
 *
 * Four simultaneous hues cannot clear the all-pairs floors (measured: every four-hue
 * combination of the reference ramps fails), and the old green/red pair for ground vs
 * non-ground sat at ΔE 7.9 under deuteranopia — the single most important distinction in
 * the whole visualisation, and the classic red/green trap. Only one focus class is live in
 * any given stage, so the three slots are never oversubscribed.
 *
 * Supporting colours (plane, seed band, normal arrow, grid) are deliberately neutral or
 * tinted surface colours: they are scaffolding, not categories, and must not compete.
 */

export interface Theme {
  scheme: "dark" | "light";

  /** Scene background, and the surface every contrast check above was run against. */
  surface: string;

  /** The three meaning-carrying slots. */
  ground: string;
  nonGround: string;
  focus: string;

  /** Scaffolding — planes, seeds, normals, grid, dimmed context. */
  plane: string;
  seed: string;
  normal: string;
  grid: string;
  /**
   * The unclassified scan: one neutral ink for every point.
   *
   * Deliberately a single colour rather than a height ramp. A ramp is a *finding* — it
   * sorts the scan into bands that look like an answer, which is the one thing the reader
   * must not have before the algorithm runs. Raw returns get no opinion, only a faint
   * lightness wobble from return intensity so the surfaces still read in 3D.
   */
  raw: string;

  /**
   * Opacity for points that are present but not part of the current story. On a dark
   * surface a faint glow still reads; on a light one, dark points at the same alpha
   * disappear, so this is per-theme rather than a constant.
   */
  contextAlpha: number;

  /**
   * The four CZM zones, inner to outer.
   *
   * Zone order is a radial sequence, so this is an ORDINAL encoding, not a categorical
   * one: a single hue with monotone lightness steps, so the ordering is visible in the
   * colour. Each ramp passes the ordinal checks (monotone L, adjacent ΔL ≥ 0.06,
   * light-end contrast ≥ 2:1, single hue) on its own surface.
   */
  zoneRamp: [string, string, string, string];

  /** UI chrome. */
  ui: {
    panel: string;
    border: string;
    text: string;
    textDim: string;
    textFaint: string;
    accent: string;
    accentInk: string;
  };
}

/**
 * Validated light, surface #fcfcfb, all-pairs:
 *   CVD ΔE 9.2 (deutan, orange↔aqua) · normal ΔE 27.6 · all in band.
 *   Contrast WARN: aqua sits at 2.74:1. The relief channel the method requires is the
 *   always-visible legend, which names every class in text — never colour alone.
 */
export const THEME: Theme = {
  scheme: "light",
  surface: "#eef1f6",
  ground: "#1baf7a",
  nonGround: "#eb6834",
  focus: "#4a3aa7",
  plane: "#2a78d6",
  seed: "#b45309",
  normal: "#0f172a",
  grid: "#9aa8c0",
  raw: "#55617a",
  contextAlpha: 0.22,
  // ordinal, light on #eef1f6: ΔL gaps clear, light end 2.62:1, hue spread 4°
  zoneRamp: ["#8397b8", "#5c7ba6", "#3a5a8c", "#1d3a66"],
  ui: {
    panel: "rgba(252, 252, 251, 0.88)",
    border: "rgba(15, 23, 42, 0.14)",
    text: "#0b1220",
    textDim: "#44506a",
    textFaint: "#6b7793",
    accent: "#2a78d6",
    accentInk: "#ffffff",
  },
};

/** Push the theme's UI colours into CSS custom properties. */
export function applyThemeToCss(theme: Theme): void {
  const root = document.documentElement;
  root.style.colorScheme = theme.scheme;
  const set = (name: string, value: string) => root.style.setProperty(name, value);

  set("--surface", theme.surface);
  set("--panel", theme.ui.panel);
  set("--border", theme.ui.border);
  set("--text", theme.ui.text);
  set("--text-dim", theme.ui.textDim);
  set("--text-faint", theme.ui.textFaint);
  set("--accent", theme.ui.accent);
  set("--accent-ink", theme.ui.accentInk);
  set("--ground", theme.ground);
  set("--non-ground", theme.nonGround);
  set("--focus", theme.focus);
  set("--seed", theme.seed);
}
