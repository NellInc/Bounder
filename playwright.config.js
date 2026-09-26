import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    // Continuous filmstrip readbacks can stall software WebGL under host pressure.
    // Keep DOM/source traces and the explicit visual QA captures instead.
    trace: { mode: "retain-on-failure", screenshots: false, snapshots: true, sources: true }
  },
  webServer: {
    command: "npm run build && node scripts/serve-site.mjs --root _site --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
