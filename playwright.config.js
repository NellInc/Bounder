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
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run build && python3 -m http.server 4173 --bind 127.0.0.1 --directory _site",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: false,
    timeout: 30_000
  }
});
