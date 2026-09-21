import { defineConfig, devices } from "@playwright/test";

/**
 * The tutorial is a WebGL app, so CI runs it in a real browser against the production
 * build. Software rendering is slow (~10 fps), hence the generous timeouts — the tests
 * assert behaviour, never frame timing.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 90_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: {
      // CI runners have no GPU; SwiftShader gives us a real WebGL context anyway.
      args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
      // Sandboxes that ship their own Chromium can point at it instead of downloading one.
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    },
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      // iPhone 13 metrics, but Chromium — the point is to exercise the responsive layout
      // and touch targets, and WebKit is not worth installing on CI for that.
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  webServer: {
    command: "pnpm run build && pnpm exec vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
