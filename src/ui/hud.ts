/** All DOM outside the canvas: header, captions, legend, readout, controls, chapters. */

export interface LegendItem {
  color: string;
  label: string;
  note?: string;
}

export interface ReadoutRow {
  label: string;
  value: string;
  state?: "pass" | "fail";
}

export interface HudCallbacks {
  onContinue: () => void;
  onPrev: () => void;
  onReplay: () => void;
  onSpeed: (speed: number) => void;
  onJump: (index: number) => void;
}

const SPEEDS = [0.5, 1, 1.5, 2];

export class Hud {
  private readonly stepNum = byId("step-num");
  private readonly stepTotal = byId("step-total");
  private readonly title = byId("stage-title");
  private readonly subtitle = byId("stage-subtitle");
  private readonly captionText = byId("caption-text");
  private readonly legend = byId("legend");
  private readonly readout = byId("readout");
  private readonly progressBar = byId("progress-bar");
  private readonly chapters = byId("chapters");
  private readonly chaptersToggle = byId("chapters-toggle") as HTMLButtonElement;
  private readonly btnContinue = byId("btn-continue") as HTMLButtonElement;
  private readonly btnPrev = byId("btn-prev") as HTMLButtonElement;
  private readonly btnReplay = byId("btn-replay") as HTMLButtonElement;
  private readonly speedGroup = byId("speed");
  private readonly loading = byId("loading");
  private readonly loadingText = byId("loading-text");

  private currentCaption = "";

  constructor(private readonly cb: HudCallbacks) {
    this.btnContinue.addEventListener("click", () => cb.onContinue());
    this.btnPrev.addEventListener("click", () => cb.onPrev());
    this.btnReplay.addEventListener("click", () => cb.onReplay());

    for (const s of SPEEDS) {
      const b = document.createElement("button");
      b.textContent = `${s}×`;
      b.dataset.speed = String(s);
      b.addEventListener("click", () => {
        cb.onSpeed(s);
        this.setSpeed(s);
      });
      this.speedGroup.appendChild(b);
    }
    this.setSpeed(1);

    this.chaptersToggle.addEventListener("click", () => this.toggleChapters());
    document.addEventListener("keydown", (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    switch (e.key) {
      case " ":
      case "Enter":
      case "ArrowRight":
        e.preventDefault();
        this.cb.onContinue();
        break;
      case "ArrowLeft":
        e.preventDefault();
        this.cb.onPrev();
        break;
      case "r":
      case "R":
        this.cb.onReplay();
        break;
      case "Escape":
        this.setChaptersOpen(false);
        break;
    }
  }

  // ------------------------------------------------------------------ loading

  setLoading(text: string): void {
    this.loadingText.textContent = text;
  }

  hideLoading(): void {
    this.loading.classList.add("hidden");
    window.setTimeout(() => {
      this.loading.style.display = "none";
    }, 600);
  }

  // ------------------------------------------------------------------ stage

  setStage(index: number, total: number, title: string, subtitle: string): void {
    this.stepNum.textContent = String(index + 1);
    this.stepTotal.textContent = String(total);
    this.title.textContent = title;
    this.subtitle.innerHTML = subtitle;
    this.btnPrev.disabled = index === 0;
    this.btnContinue.querySelector("span")!.textContent =
      index === total - 1 ? "Start over" : "Continue";
    for (const [i, el] of [...this.chapters.children].entries()) {
      el.classList.toggle("active", i === index);
    }
  }

  setChapters(titles: string[]): void {
    this.chapters.replaceChildren();
    titles.forEach((t, i) => {
      const b = document.createElement("button");
      b.innerHTML = `<span class="idx">${String(i + 1).padStart(2, "0")}</span><span>${t}</span>`;
      b.addEventListener("click", () => {
        this.cb.onJump(i);
        this.setChaptersOpen(false);
      });
      this.chapters.appendChild(b);
    });
  }

  private toggleChapters(): void {
    this.setChaptersOpen(this.chapters.hidden);
  }

  private setChaptersOpen(open: boolean): void {
    this.chapters.hidden = !open;
    this.chaptersToggle.setAttribute("aria-expanded", String(open));
  }

  // ------------------------------------------------------------------ caption

  setCaption(text: string): void {
    if (text === this.currentCaption) return;
    this.currentCaption = text;
    if (!text) {
      this.captionText.classList.remove("visible");
      return;
    }
    this.captionText.classList.remove("visible");
    // Let the fade-out land before swapping the text.
    window.setTimeout(() => {
      if (this.currentCaption !== text) return;
      this.captionText.innerHTML = text;
      this.captionText.classList.add("visible");
    }, 130);
  }

  // ------------------------------------------------------------------ panels

  setLegend(items: LegendItem[] | null): void {
    if (!items || items.length === 0) {
      this.legend.hidden = true;
      return;
    }
    this.legend.hidden = false;
    this.legend.replaceChildren();
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML =
        `<span class="swatch" style="background:${item.color};color:${item.color}"></span>` +
        `<span><strong>${item.label}</strong>${item.note ? ` — ${item.note}` : ""}</span>`;
      this.legend.appendChild(row);
    }
  }

  setReadout(title: string | null, rows: ReadoutRow[] = []): void {
    if (!title) {
      this.readout.hidden = true;
      return;
    }
    this.readout.hidden = false;
    this.readout.replaceChildren();
    const head = document.createElement("div");
    head.className = "title";
    head.textContent = title;
    this.readout.appendChild(head);
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = `row${r.state ? ` ${r.state}` : ""}`;
      row.innerHTML = `<span>${r.label}</span><b>${r.value}</b>`;
      this.readout.appendChild(row);
    }
  }

  // ------------------------------------------------------------------ transport

  setProgress(p: number): void {
    this.progressBar.style.width = `${Math.round(p * 100)}%`;
  }

  setFinished(finished: boolean): void {
    this.btnContinue.classList.toggle("pulse", finished);
  }

  private setSpeed(speed: number): void {
    for (const b of this.speedGroup.children) {
      b.classList.toggle("active", (b as HTMLElement).dataset.speed === String(speed));
    }
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}
