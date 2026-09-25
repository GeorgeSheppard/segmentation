/**
 * Record a low-res WebM per tutorial stage by loading the app in real Chromium and letting
 * `?record` drive it: each stage plays straight through at real speed while `captureStream`
 * grabs the canvas, so this takes roughly as long as the tutorial itself does end to end.
 *
 * Needs a server up and Playwright, which is deliberately not a dependency:
 *   npm run dev
 *   npm i -D playwright && node scripts/record-stage-videos.mjs ./videos
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const OUT = process.argv[2] ?? "./videos";
const URL = process.env.URL ?? "http://localhost:5173/";
const EXECUTABLE = process.env.CHROMIUM_PATH; // set when Playwright's own download is skipped

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: [
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

// `App` hands each finished recording to this hook instead of triggering a browser download,
// which lets us write straight to disk without dealing with Chromium's download UI.
await page.exposeFunction("__saveRecording", (id, base64) => {
  writeFileSync(`${OUT}/${id}.webm`, Buffer.from(base64, "base64"));
  console.log(`saved ${id}.webm`);
});
await page.addInitScript(() => {
  window.__onStageRecorded = (id, blob) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1];
      // @ts-expect-error — exposed by Playwright above, not declared to the page's own types.
      window.__saveRecording(id, base64);
    };
    reader.readAsDataURL(blob);
  };
});

await page.goto(`${URL}?record`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__recordingComplete === true, { timeout: 20 * 60_000 });

console.log(errors.length ? `\nconsole errors:\n${errors.join("\n")}` : "\nno console errors");
await browser.close();
