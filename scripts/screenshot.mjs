/**
 * Walk every tutorial stage in headless Chromium and save a screenshot of each.
 *
 * Needs a dev server on :5173 and Playwright, which is deliberately not a dependency:
 *   npm run dev
 *   npm i -D playwright && node scripts/screenshot.mjs ./shots
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const OUT = process.argv[2] ?? "./shots";
// Software rendering runs at ~10 fps, so a stage takes roughly twice its wall-clock
// duration to play here. Wait long enough that the "mid" shot is actually mid-stage.
const MID_WAIT = Number(process.env.MID_WAIT ?? 8000);
const URL = process.env.URL ?? "http://localhost:5173/";
const EXECUTABLE = process.env.CHROMIUM_PATH; // set when Playwright's own download is skipped

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.getElementById("loading").classList.contains("hidden"), {
  timeout: 60_000,
});
await page.waitForTimeout(1500);

const total = Number(await page.textContent("#step-total"));
for (let i = 0; i < total; i++) {
  const n = String(i).padStart(2, "0");
  await page.waitForTimeout(MID_WAIT);
  await page.screenshot({ path: `${OUT}/${n}-mid.png` });
  await page.click("#btn-continue"); // skip to the end of this stage
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${n}-end.png` });
  console.log(`${n}  ${await page.textContent("#stage-title")}`);
  if (i < total - 1) {
    await page.click("#btn-continue");
    await page.waitForTimeout(600);
  }
}

console.log(errors.length ? `\nconsole errors:\n${errors.join("\n")}` : "\nno console errors");
await browser.close();
