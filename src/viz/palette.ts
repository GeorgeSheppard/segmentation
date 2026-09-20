import { Color } from "three";
import { PointLabel } from "../patchwork/types.ts";

/**
 * One palette for the whole app. Hues are assigned by meaning, not by module:
 * green = accepted ground, warm = rejected, violet = removed by a preprocessing step,
 * cyan = rescued by a second-chance rule, amber = undecided.
 */
export const COLORS = {
  ground: "#4ade80",
  groundFar: "#86efac",
  groundReverted: "#22d3ee",
  nonGround: "#f87171",
  rejectedTilted: "#fb923c",
  rejectedHeading: "#f472b6",
  rejectedCandidate: "#ef4444",
  candidate: "#fbbf24",
  noise: "#e879f9",
  vertical: "#a78bfa",
  sparse: "#64748b",
  outOfRange: "#334155",
  seed: "#fde047",
  lpr: "#fb7185",
  plane: "#38bdf8",
  normal: "#f0f9ff",
  accent: "#60a5fa",
  dim: "#1e293b",
} as const;

export const LABEL_COLORS: Record<number, Color> = {
  [PointLabel.Unassigned]: new Color("#ff00ff"),
  [PointLabel.Noise]: new Color(COLORS.noise),
  [PointLabel.OutOfRange]: new Color(COLORS.outOfRange),
  [PointLabel.SparseBin]: new Color(COLORS.sparse),
  [PointLabel.VerticalPlane]: new Color(COLORS.vertical),
  [PointLabel.AbovePlane]: new Color(COLORS.nonGround),
  [PointLabel.RejectedTilted]: new Color(COLORS.rejectedTilted),
  [PointLabel.RejectedHeading]: new Color(COLORS.rejectedHeading),
  [PointLabel.RejectedCandidate]: new Color(COLORS.rejectedCandidate),
  [PointLabel.Ground]: new Color(COLORS.ground),
  [PointLabel.GroundFar]: new Color(COLORS.groundFar),
  [PointLabel.GroundReverted]: new Color(COLORS.groundReverted),
};

/** Binary view: is this point in the final ground set? */
export const BINARY_COLORS = {
  ground: new Color(COLORS.ground),
  nonGround: new Color(COLORS.nonGround),
};

/**
 * Height ramp for the "raw scan" look — deep blue through teal to warm sand.
 * Perceptually ordered and readable on a dark background.
 */
const HEIGHT_STOPS: Array<[number, Color]> = [
  [0.0, new Color("#1e3a8a")],
  [0.25, new Color("#0ea5e9")],
  [0.5, new Color("#22d3ee")],
  [0.7, new Color("#a3e635")],
  [0.85, new Color("#fcd34d")],
  [1.0, new Color("#fb923c")],
];

const tmp = new Color();

export function heightColor(t: number, out: Color = tmp): Color {
  const c = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HEIGHT_STOPS.length; i++) {
    const [p1, c1] = HEIGHT_STOPS[i];
    if (c <= p1) {
      const [p0, c0] = HEIGHT_STOPS[i - 1];
      const f = (c - p0) / (p1 - p0);
      return out.copy(c0).lerp(c1, f);
    }
  }
  return out.copy(HEIGHT_STOPS[HEIGHT_STOPS.length - 1][1]);
}

export const ZONE_COLORS = [
  new Color("#38bdf8"),
  new Color("#818cf8"),
  new Color("#c084fc"),
  new Color("#f472b6"),
];
