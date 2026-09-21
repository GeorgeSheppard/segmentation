/**
 * A tiny deterministic keyframe engine.
 *
 * A stage is a list of clips on a single virtual clock. The clock only ever moves forward;
 * replaying a stage rebuilds it from scratch, which keeps clip handlers free to capture
 * state on entry (camera poses, colours) without worrying about seeking.
 */

export interface ClipHandlers {
  /** Called once, the first time the clock reaches the clip. */
  onEnter?: () => void;
  /** Called every frame while the clip is live, with `t` eased into [0, 1]. */
  onUpdate?: (t: number) => void;
  /** Called once when the clock passes the clip's end (always with t = 1 applied first). */
  onExit?: () => void;
}

export interface Clip extends ClipHandlers {
  start: number;
  duration: number;
  ease?: (t: number) => number;
}

export type Easing = (t: number) => number;

export const Ease = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  out: (t: number) => 1 - (1 - t) ** 3,
  in: (t: number) => t * t * t,
  /** Slow start, slow end, with a long cruise — good for long camera moves. */
  cinematic: (t: number) => t * t * (3 - 2 * t),
} satisfies Record<string, Easing>;

export class Timeline {
  readonly clips: Clip[];
  readonly duration: number;
  time = 0;

  private entered = new Set<Clip>();
  private exited = new Set<Clip>();

  constructor(clips: Clip[]) {
    this.clips = [...clips].sort((a, b) => a.start - b.start);
    this.duration = this.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  }

  get finished(): boolean {
    return this.time >= this.duration;
  }

  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.time / this.duration) : 1;
  }

  advance(dt: number): void {
    this.time = Math.min(this.duration, this.time + dt);
    for (const clip of this.clips) {
      if (this.time < clip.start) continue;
      if (this.exited.has(clip)) continue;

      if (!this.entered.has(clip)) {
        this.entered.add(clip);
        clip.onEnter?.();
      }

      const raw = clip.duration > 0 ? (this.time - clip.start) / clip.duration : 1;
      const clamped = Math.max(0, Math.min(1, raw));
      clip.onUpdate?.((clip.ease ?? Ease.linear)(clamped));

      if (raw >= 1) {
        this.exited.add(clip);
        clip.onExit?.();
      }
    }
  }

  /** Run straight to the end, firing every handler. Used by "skip to the end of this stage". */
  finish(): void {
    this.advance(this.duration - this.time + 1e-6);
  }
}

/** Fluent builder. `add` places a clip at the cursor and advances it; `with` runs in parallel. */
export class Track {
  private clips: Clip[] = [];
  private cursor = 0;
  private lastStart = 0;

  constructor(private readonly caption?: (text: string) => void) {}

  get time(): number {
    return this.cursor;
  }

  at(time: number): this {
    this.cursor = time;
    return this;
  }

  wait(seconds: number): this {
    this.cursor += seconds;
    return this;
  }

  add(duration: number, handlers: ClipHandlers, ease?: Easing): this {
    this.lastStart = this.cursor;
    this.clips.push({ start: this.cursor, duration, ease, ...handlers });
    this.cursor += duration;
    return this;
  }

  /** Same start time as the previous `add`; does not move the cursor. */
  with(duration: number, handlers: ClipHandlers, ease?: Easing): this {
    this.clips.push({ start: this.lastStart, duration, ease, ...handlers });
    return this;
  }

  /** A clip that fires once and takes no time. */
  cue(fn: () => void): this {
    return this.add(0, { onEnter: fn });
  }

  /** Show a line of narration for `duration` seconds, then advance. */
  say(text: string, duration: number): this {
    return this.add(duration, { onEnter: () => this.caption?.(text) });
  }

  build(): Timeline {
    return new Timeline(this.clips);
  }
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
