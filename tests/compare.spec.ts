import { expect, test } from "@playwright/test";

test.describe("scene comparison page", () => {
  test("loads the first scene and switches on click, with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text());
    });

    await page.goto("/compare.html");
    await expect(page.locator("#loading")).toHaveClass(/hidden/, { timeout: 30_000 });

    const info = page.locator("#cmp-info");
    await expect(info).toBeVisible();
    await expect(page.locator("#cmp-stats")).toContainText("points");
    // Real camera colour only ever covers a fraction of the sweep.
    await expect(page.locator("#cmp-stats")).toContainText("% seen by the camera");

    const buttons = page.locator("#cmp-strip button");
    await expect(buttons).toHaveCount(4);
    await expect(buttons.first()).toHaveClass(/active/);

    const firstDesc = await page.locator("#cmp-desc").textContent();
    await buttons.nth(1).click();
    await expect(buttons.nth(1)).toHaveClass(/active/);
    await expect(buttons.first()).not.toHaveClass(/active/);
    await expect(page.locator("#cmp-desc")).not.toHaveText(firstDesc ?? "");

    expect(errors).toEqual([]);
  });
});
