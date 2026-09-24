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
 * Jump straight to the end of the current stage by clicking the far right of the progress
 * bar — a seek releases every checkpoint it passes over, so this reaches the end in one
 * step regardless of how many lines the stage has.
 */
export async function finishStage(page: Page): Promise<void> {
  const bar = await page.locator("#progress").boundingBox();
  if (!bar) throw new Error("#progress has no box");
  await page.mouse.click(bar.x + bar.width - 1, bar.y + bar.height / 2);
  await expect(page.locator("#progress-bar")).toHaveAttribute("style", /width:\s*100%/, {
    timeout: 30_000,
  });
}

export function stageTitle(page: Page) {
  return page.locator("#stage-title");
}

/**
 * Wait for the transport to read "Play" again — the clock is holding, either at the end of
 * a line or the end of the stage, and a press will move it on rather than pause it.
 */
export async function waitForPlayable(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = document.getElementById("btn-play")?.dataset.state;
    return state === "play" || state === "next" || state === "explore";
  });
}
