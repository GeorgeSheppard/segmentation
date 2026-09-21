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

/** Skip to the end of the current stage and wait for the transport to settle. */
export async function finishStage(page: Page): Promise<void> {
  await page.click("#btn-continue");
  await expect(page.locator("#progress-bar")).toHaveAttribute("style", /width:\s*100%/, {
    timeout: 30_000,
  });
}

export function stageTitle(page: Page) {
  return page.locator("#stage-title");
}
