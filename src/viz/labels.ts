import { Vector3 } from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

/**
 * A DOM chip pinned to a point in the scene. Cheaper and far more legible than 3D text,
 * and it can carry the same typography as the rest of the UI.
 */
export class SceneLabel {
  readonly object: CSS2DObject;
  private readonly el: HTMLDivElement;

  constructor(text: string, variant: "" | "accent" | "warn" | "good" | "bad" = "") {
    this.el = document.createElement("div");
    this.el.className = `scene-label${variant ? ` ${variant}` : ""}`;
    this.el.innerHTML = text;
    this.el.style.opacity = "0";
    this.object = new CSS2DObject(this.el);
  }

  set text(value: string) {
    this.el.innerHTML = value;
  }

  set variant(v: "" | "accent" | "warn" | "good" | "bad") {
    this.el.className = `scene-label${v ? ` ${v}` : ""}`;
  }

  setPosition(p: Vector3 | [number, number, number]): this {
    if (p instanceof Vector3) this.object.position.copy(p);
    else this.object.position.set(p[0], p[1], p[2]);
    return this;
  }

  set opacity(v: number) {
    this.el.style.opacity = String(v);
    this.el.style.display = v < 0.01 ? "none" : "block";
  }

  dispose(): void {
    this.object.removeFromParent();
    this.el.remove();
  }
}
