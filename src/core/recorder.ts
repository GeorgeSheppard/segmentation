/**
 * Records a canvas's rendered frames straight off `captureStream`, no server or headless
 * render pass involved — the same canvas the tutorial already draws to.
 */
export class CanvasRecorder {
  private readonly recorder: MediaRecorder;
  private readonly chunks: BlobPart[] = [];
  private readonly done: Promise<Blob>;

  constructor(canvas: HTMLCanvasElement, fps = 24) {
    const stream = canvas.captureStream(fps);
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.done = new Promise((resolve) => {
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType }));
    });
    this.recorder.start();
  }

  async stop(): Promise<Blob> {
    this.recorder.stop();
    return this.done;
  }
}

function pickMimeType(): string | undefined {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

/** Save a blob the way a real download would, for a one-off manual capture in a real browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
