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
 * bar, regardless of how many lines the stage has or how far autoplay has already gotten.
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
