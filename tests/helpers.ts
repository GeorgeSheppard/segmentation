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
 * actionability wait) until the stage reports done, rather than assuming a single click
 * gets there.
 */
export async function finishStage(page: Page): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const done = await page.evaluate(() => {
      if (document.getElementById("progress-bar")?.style.width === "100%") return true;
      (document.getElementById("btn-continue") as HTMLButtonElement | null)?.click();
      return false;
    });
    if (done) break;
  }
  await expect(page.locator("#progress-bar")).toHaveAttribute("style", /width:\s*100%/, {
    timeout: 30_000,
  });
}

export function stageTitle(page: Page) {
  return page.locator("#stage-title");
}
