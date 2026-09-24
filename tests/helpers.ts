import { expect, type Page } from "@playwright/test";

/** Load the app (optionally deep-linked to a stage) and wait for it to be interactive. */
export async function open(page: Page, stage = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // A missing favicon is not a failure worth policing.
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text());
  });

  await page.goto(stage ? `/#${stage}` : "/");
  await expect(page.locator("#loading")).toHaveClass(/hidden/, { timeout: 60_000 });
  return errors;
}

/**
 * Skip to the end of the current stage and wait for the transport to settle. Continue now
 * steps one line at a time — one tap to jump to the end of a line, another to release the
 * next one — so this drives the button directly (skipping Playwright's per-call
 * actionability wait) until the stage reports done.
 *
 * The click and the "are we done" check share one animation frame each, rather than
 * racing a tight loop against the render tick: the visible progress bar only updates once
 * a frame, so polling it from back-to-back calls with no pacing can read a stale
 * not-quite-100% value after the click that actually finished the stage, click once more,
 * and roll straight into the next stage — the button does exactly that for a real reader.
 */
export async function finishStage(page: Page): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const done = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          requestAnimationFrame(() => {
            if (document.getElementById("progress-bar")?.style.width === "100%") {
              resolve(true);
              return;
            }
            (document.getElementById("btn-continue") as HTMLButtonElement | null)?.click();
            resolve(false);
          });
        }),
    );
    if (done) break;
  }
  await expect(page.locator("#progress-bar")).toHaveAttribute("style", /width:\s*100%/, {
    timeout: 30_000,
  });
}

export function stageTitle(page: Page) {
  return page.locator("#stage-title");
}

/**
 * Wait for Continue to be paused for the reader (pulsing) again.
 *
 * What a click does next — jump to the end of the current line, or release the next one —
 * depends on whether the clock is already paused, and that depends on real time elapsed
 * since the last click. Reading state (like the progress bar) right after a click without
 * waiting for this is a race: on a release, the clock does not move until the next
 * animation frame, so an immediate read sees the same value as before the click.
 */
export async function waitForPause(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.getElementById("btn-continue")?.classList.contains("pulse") ?? false,
  );
}
