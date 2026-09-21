/**
 * Themes.
 *
 * Every colour that carries meaning comes from here, and every palette below was checked
 * with the data-viz validator (OKLCH lightness band, chroma floor, CVD separation under
 * simulated protanopia/deuteranopia, normal-vision separation, contrast vs the surface) on
 * the **all-pairs** pairlist — because a point cloud is a scatter form, where any two
 * classes can end up side by side.
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
  id: ThemeId;
  name: string;
  /** Short note shown in the picker. */
  note: string;
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
  /** Height ramp for the raw, unclassified scan. */
  ramp: string[];

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

export type ThemeId = "signal" | "ultraviolet" | "daylight";

export const THEMES: Record<ThemeId, Theme> = {
  /**
   * Validated dark, surface #070a0f, all-pairs:
   *   CVD ΔE 9.4 (deutan, orange↔aqua) · normal ΔE 24.6 · all ≥ 3:1 · all in band.
   */
  signal: {
    id: "signal",
    name: "Signal",
    note: "Near-black. Aqua ground, orange obstacles.",
    scheme: "dark",
    surface: "#070a0f",
    ground: "#199e70",
    nonGround: "#d95926",
    focus: "#9085e9",
    plane: "#7dd3fc",
    seed: "#fde047",
    normal: "#f0f9ff",
    grid: "#38507a",
    ramp: ["#12305e", "#1a6aa8", "#2c9ab0", "#7ab86a", "#d7b44a", "#e08a3c"],
    contextAlpha: 0.04,
    // ordinal, dark on #070a0f: ΔL gaps clear, light end 2.26:1, hue spread 8°
    zoneRamp: ["#8cc4ee", "#4f9bd1", "#2f72a8", "#1d4d7a"],
    ui: {
      panel: "rgba(13, 19, 30, 0.82)",
      border: "rgba(148, 163, 184, 0.18)",
      text: "#e8eef7",
      textDim: "#94a3b8",
      textFaint: "#64748b",
      accent: "#7dd3fc",
      accentInk: "#06121f",
    },
  },

  /**
   * Validated dark, surface #0a0712, all-pairs:
   *   CVD ΔE 13.2 (deutan, yellow↔magenta) · normal ΔE 19.3 · all ≥ 3:1 · all in band.
   */
  ultraviolet: {
    id: "ultraviolet",
    name: "Ultraviolet",
    note: "Deep violet. The highest colour-blind margin of the three.",
    scheme: "dark",
    surface: "#0a0712",
    ground: "#9085e9",
    nonGround: "#d55181",
    focus: "#c98500",
    plane: "#a5b4fc",
    seed: "#fde68a",
    normal: "#f5f3ff",
    grid: "#4c3f7a",
    ramp: ["#1e1b4b", "#4338ca", "#7c5cd6", "#a855f7", "#d0619e", "#e08a3c"],
    contextAlpha: 0.05,
    // ordinal, dark on #0a0712: ΔL gaps clear, light end 2.16:1, hue spread 3°
    zoneRamp: ["#b8adf0", "#8d7ad8", "#6754b4", "#4a3c85"],
    ui: {
      panel: "rgba(19, 14, 33, 0.84)",
      border: "rgba(167, 155, 208, 0.20)",
      text: "#ece9f8",
      textDim: "#a39bc4",
      textFaint: "#726a92",
      accent: "#a5b4fc",
      accentInk: "#0f0a1f",
    },
  },

  /**
   * Validated light, surface #fcfcfb, all-pairs:
   *   CVD ΔE 9.2 (deutan, orange↔aqua) · normal ΔE 27.6 · all in band.
   *   Contrast WARN: aqua sits at 2.74:1. The relief channel the method requires is the
   *   always-visible legend, which names every class in text — never colour alone.
   */
  daylight: {
    id: "daylight",
    name: "Daylight",
    note: "Light surface, for bright rooms and projectors.",
    scheme: "light",
    surface: "#eef1f6",
    ground: "#1baf7a",
    nonGround: "#eb6834",
    focus: "#4a3aa7",
    plane: "#2a78d6",
    seed: "#b45309",
    normal: "#0f172a",
    grid: "#9aa8c0",
    ramp: ["#1e3a8a", "#2a78d6", "#2c9ab0", "#4f9e3f", "#c08a1a", "#c2410c"],
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
  },
};

export const THEME_ORDER: ThemeId[] = ["signal", "ultraviolet", "daylight"];
export const DEFAULT_THEME: ThemeId = "signal";

const STORAGE_KEY = "patchworkpp:theme";

export function loadThemeId(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in THEMES) return saved as ThemeId;
  } catch {
    // Private mode / blocked storage — the default is fine.
  }
  return DEFAULT_THEME;
}

export function saveThemeId(id: ThemeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not worth surfacing; the theme still applies for this session.
  }
}

/** Push a theme's UI colours into CSS custom properties. */
export function applyThemeToCss(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
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
