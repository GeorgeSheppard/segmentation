import { Color } from "three";
import { isGroundLabel, PointLabel } from "../patchwork/index.ts";
import type { Theme } from "./themes.ts";

/**
 * The semantic colours a stage may use.
 *
 * Only `ground`, `nonGround` and `focus` carry meaning about a point's class — see
 * `themes.ts` for why there are exactly three. Everything else is scaffolding: planes,
 * seed bands, normals, grid lines, and the dimmed context behind whatever is in focus.
 */
export interface Palette {
  ground: Color;
  nonGround: Color;
  /** Whatever the current step is singling out. Only one such class per stage. */
  focus: Color;

  /** Unclassified returns — the scan before anyone has an opinion about it. */
  raw: Color;

  plane: Color;
  seed: Color;
  normal: Color;
  grid: Color;
  /** Points that are present but not part of the current story. */
  dim: Color;
  /** Unassigned points — a bug if you ever see it. */
  debug: Color;
}

export function paletteFor(theme: Theme): Palette {
  return {
    ground: new Color(theme.ground),
    nonGround: new Color(theme.nonGround),
    focus: new Color(theme.focus),
    raw: new Color(theme.raw),
    plane: new Color(theme.plane),
    seed: new Color(theme.seed),
    normal: new Color(theme.normal),
    grid: new Color(theme.grid),
    dim: new Color(theme.ui.textFaint),
    debug: new Color("#ff00ff"),
  };
}

/**
 * The classified view is deliberately BINARY: ground or not.
 *
 * Every rejection reason (tilted plane, plane above the sensor, too sparse, above the
 * fitted plane, rejected by TGR) lands on the same colour. The reason is carried by the
 * narration at the moment it matters, not by a hue the reader has to hold
 * in their head for twelve stages.
 */
export function labelColor(label: PointLabel, palette: Palette): Color {
  if (label === PointLabel.Unassigned) return palette.debug;
  if (label === PointLabel.OutOfRange) return palette.dim;
  return isGroundLabel(label) ? palette.ground : palette.nonGround;
}

/**
 * Zone tints for the CZM grid — the theme's ordinal ramp, inner zone to outer.
 *
 * Scaffolding, not identity: one hue in stepped lightness, so the radial ordering is
 * legible without competing with the three meaning-carrying colours.
 */
export function zoneColors(theme: Theme): Color[] {
  return theme.zoneRamp.map((hex) => new Color(hex));
}
