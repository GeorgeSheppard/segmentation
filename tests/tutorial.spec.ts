import { expect, test } from "@playwright/test";
import { finishStage, open, stageTitle, waitForPause } from "./helpers.ts";

test.describe("tutorial", () => {
  test("loads, segments the scan, and shows the first stage", async ({ page }) => {
    const errors = await open(page);

    await expect(stageTitle(page)).toHaveText("How the scan is made");
    await expect(page.locator("#step-num")).toHaveText("1");
    await expect(page.locator("#step-total")).toHaveText("12");

    // The caption is fed from the live segmentation, so this asserts the algorithm ran.
    await expect(page.locator("#caption-text")).toContainText("123,494");
    expect(errors).toEqual([]);
  });

  test("walks every stage without error, then offers to explore", async ({ page }) => {
    // Continue now steps one line at a time, so clicking through every line of every stage
    // is a lot more round trips than the old skip-to-end click — give it the room, especially
    // under CI's parallel workers sharing one CPU for software-rendered WebGL.
    test.setTimeout(600_000);
    const errors = await open(page);
    const total = Number(await page.locator("#step-total").textContent());
    const titles: string[] = [];

    for (let i = 0; i < total - 1; i++) {
      await expect(page.locator("#step-num")).toHaveText(String(i + 1));
      titles.push((await stageTitle(page).textContent()) ?? "");
      await finishStage(page);
      await page.click("#btn-continue");
    }
    await expect(page.locator("#step-num")).toHaveText(String(total));
    titles.push((await stageTitle(page).textContent()) ?? "");
    await finishStage(page);

    // The last stage's Continue does not loop back to the start — it hands the finished
    // scene over, chrome and all, until Restart is pressed.
    await page.click("#btn-continue");
    await expect(page.locator("#app")).toHaveClass(/exploring/);
    await expect(page.locator("#btn-restart")).toBeVisible();
    await expect(page.locator("#top")).toBeHidden();

    await page.click("#btn-restart");
    await expect(page.locator("#app")).not.toHaveClass(/exploring/);
    await expect(page.locator("#step-num")).toHaveText("1");

    expect(new Set(titles).size).toBe(total);
    expect(errors).toEqual([]);
  });

  test("the opening stage builds the scan out of beams", async ({ page }) => {
    const errors = await open(page, "sensor");

    await expect(stageTitle(page)).toHaveText("How the scan is made");
    // The scan is built up on screen with nothing labelled in 3D — no legend needed either.
    await expect(page.locator("#legend")).toBeHidden();
    // The measured range on screen comes from a real return, not from a script.
    await expect(page.locator("#caption-text")).toContainText("123,494");
    await finishStage(page);
    await page.click("#btn-continue");
    await expect(stageTitle(page)).toHaveText("One LiDAR scan");
    expect(errors).toEqual([]);
  });

  test("Continue steps one line at a time, then advances the stage", async ({ page }) => {
    await open(page);
    const width = () => page.locator("#progress-bar").getAttribute("style");

    expect(await width()).not.toMatch(/width:\s*100%/);
    await page.click("#btn-continue");
    // A click's effect depends on whether the clock was already paused when it landed, so
    // wait for the pause it produces before reading state off the page.
    await waitForPause(page);
    const afterOneLine = await width();
    // One line at a time: the first tap does not jump straight to the end of the stage.
    expect(afterOneLine).not.toMatch(/width:\s*100%/);
    await page.click("#btn-continue");
    await waitForPause(page);
    expect(await width()).not.toEqual(afterOneLine);
    await expect(page.locator("#step-num")).toHaveText("1");

    await finishStage(page);
    await page.click("#btn-continue");
    await expect(page.locator("#step-num")).toHaveText("2");
  });

  test("Replay restarts the current stage", async ({ page }) => {
    await open(page, "rgpf");
    await finishStage(page);

    await page.click("#btn-replay");
    await expect(page.locator("#progress-bar")).not.toHaveAttribute("style", /width:\s*100%/);
    await expect(stageTitle(page)).toContainText("R-GPF");
  });

  test("Back steps to the previous stage and is disabled on the first", async ({ page }) => {
    await open(page, "czm");
    await expect(page.locator("#step-num")).toHaveText("4");

    await page.click("#btn-prev");
    await expect(page.locator("#step-num")).toHaveText("3");

    await open(page);
    await expect(page.locator("#btn-prev")).toBeDisabled();
  });

  test("deep links open a named stage and the URL follows navigation", async ({ page }) => {
    await open(page, "tgr");
    await expect(stageTitle(page)).toContainText("TGR");

    await page.click("#btn-prev");
    await expect(page).toHaveURL(/#sweep$/);
  });
});

test.describe("the step rail", () => {
  test("lights the step the stage is about", async ({ page }) => {
    await open(page, "rvpf");

    await expect(page.locator('#rail li[data-step="rvpf"]')).toHaveClass(/active/);
    // Everything earlier in the pipeline is marked covered.
    await expect(page.locator('#rail li[data-step="rnr"]')).toHaveClass(/done/);
    await expect(page.locator('#rail li[data-step="tgr"]')).not.toHaveClass(/active|done/);
  });

  test("lights every step the full-sweep stage covers", async ({ page }) => {
    await open(page, "sweep");
    for (const step of ["seeds", "rvpf", "rgpf", "gle"]) {
      await expect(page.locator(`#rail li[data-step="${step}"]`)).toHaveClass(/active/);
    }
    await expect(page.locator('#rail li[data-step="agle"]')).not.toHaveClass(/active/);
  });
});

test.describe("theme", () => {
  test("keeps ground, non-ground and focus distinct", async ({ page }) => {
    await open(page);
    const vars = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return ["--ground", "--non-ground", "--focus"].map((n) => s.getPropertyValue(n).trim());
    });
    expect(new Set(vars).size, "the theme reuses a colour").toBe(3);
  });
});

test.describe("layout", () => {
  test("nothing overflows the viewport", async ({ page }) => {
    await open(page, "sweep");

    const offenders = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const bad: string[] = [];
      for (const id of ["top", "rail", "bottom", "controls", "caption", "panels"]) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 || r.left < -1) bad.push(`#${id} ${r.left}..${r.right} > ${vw}`);
      }
      return bad;
    });
    expect(offenders).toEqual([]);
  });

  test("the transport stays reachable and finger-sized", async ({ page }) => {
    await open(page, "sweep");
    for (const id of ["#btn-continue", "#btn-replay", "#btn-prev"]) {
      const box = await page.locator(id).boundingBox();
      expect(box, `${id} has no box`).not.toBeNull();
      expect(box!.height, `${id} is too short to tap`).toBeGreaterThanOrEqual(36);
      expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    }
  });

  test("the legend sits above the scene, not over the controls", async ({ page }) => {
    await open(page, "rnr");
    const legend = page.locator("#legend");
    await expect(legend).toBeVisible();

    const strip = (await legend.boundingBox())!;
    const controls = (await page.locator("#controls").boundingBox())!;
    expect(strip.y + strip.height).toBeLessThan(controls.y);
    // Above the halfway line: it belongs to the header, not to the bottom stack.
    expect(strip.y).toBeLessThan(page.viewportSize()!.height / 2);
  });

  test("an empty legend is not rendered", async ({ page }) => {
    await open(page, "sweep");
    const legend = page.locator("#legend");
    if (await legend.isHidden()) await expect(legend).toHaveCSS("display", "none");
  });
});

test.describe("getting around", () => {
  test("the page is readable while the scan is still downloading", async ({ page }) => {
    // Hold the scan back so the loading state is observable rather than a flash.
    await page.route("**/data/*.pcq", async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });

    await page.goto("/");

    // Titles, the pipeline rail and the transport are all there before the points are.
    await expect(stageTitle(page)).toHaveText("How the scan is made");
    await expect(page.locator("#rail li").first()).toBeVisible();
    await expect(page.locator("#loading")).not.toHaveClass(/hidden/);
    await expect(page.locator("#btn-continue")).toBeDisabled();

    await expect(page.locator("#loading")).toHaveClass(/hidden/, { timeout: 60_000 });
    await expect(page.locator("#btn-continue")).toBeEnabled();
    await expect(page.locator("#caption-text")).toContainText("123,494");
  });

  test("dragging the scene takes the camera, and Recentre hands it back", async ({ page }) => {
    await open(page);
    const recentre = page.locator("#btn-recentre");
    await expect(recentre).toBeHidden();

    // A drag on the scene, mid-stage: it has to reach the orbit controls even while the
    // tour is flying the camera somewhere.
    const size = page.viewportSize()!;
    await page.mouse.move(size.width / 2, size.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(size.width / 2 + 60, size.height * 0.42 + 30, { steps: 8 });
    await page.mouse.up();

    await expect(recentre).toBeVisible();
    await recentre.click();
    await expect(recentre).toBeHidden();
  });

  test("the gesture hint shows where fingers are the input", async ({ page }) => {
    await open(page);
    const touch = await page.evaluate(
      () => window.matchMedia("(hover: none) and (pointer: coarse)").matches,
    );
    const hint = page.locator("#gesture-hint");
    if (touch) {
      await expect(hint).toBeVisible();
      await expect(hint).toContainText("two fingers");
    } else {
      await expect(hint).toBeHidden();
    }
  });
});
