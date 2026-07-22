import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const collectErrors = (page) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

test("homepage is responsive and has no detectable accessibility violations", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.route("**/simulator.html?embed=1", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html lang='en'><title>Bounder simulator test placeholder</title><body></body></html>"
  }));
  await page.goto("/");
  await expect(page).toHaveTitle(/Bounder/);
  await expect(page.locator("h1")).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("simulator loads recorded evidence and responds to keyboard navigation", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/simulator.html?scenario=safe");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true");
  await expect(stage).toHaveAttribute("data-webgl", "ready");
  await expect(stage).toHaveAttribute("data-routes-clear", "true");

  const canvas = page.locator(".simulator-stage canvas");
  await canvas.focus();
  await page.keyboard.down("KeyW");
  await expect(stage).toHaveAttribute("data-last-navigation-key", "KeyW");

  expect(errors).toEqual([]);
});

test("receipt failure pauses the simulator without granting authority", async ({ page }) => {
  await page.route("**/data/bounder-receipts.v1.json", (route) => route.abort("failed"));
  await page.goto("/simulator.html?webgl=off");
  await expect(page.locator(".simulator-stage")).toHaveAttribute("data-receipts-ready", "false");
  await expect(page.locator(".decision-code")).toHaveText("fixture_unavailable");
  await expect(page.locator(".adapter-output")).toHaveText("No command authority");
  await expect(page.getByRole("button", { name: "Pause simulation" })).toBeDisabled();
});

test("evidence remains usable when WebGL is unavailable", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/simulator.html?webgl=off");
  const stage = page.locator(".simulator-stage");
  await expect(stage).toHaveAttribute("data-webgl", "unavailable");
  await expect(stage).toHaveAttribute("data-receipts-ready", "true");
  await expect(page.locator(".webgl-fallback")).toBeVisible();
  await expect(page.locator("[data-receipt='evidence']")).toHaveText("30s old · gold evidence");
  await expect(page.locator("body")).not.toContainText("undefined");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await expect(page.locator(".decision-code")).toHaveText("allowed");
  await page.getByRole("button", { name: "Friendly separation" }).click();
  await expect(page.locator(".decision-code")).toHaveText("friendly_force_proximity");
  expect(errors).toEqual([]);
});

test("published Creed Space vector verifies locally and remains held after expiry", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/simulator.html?webgl=off");
  await page.getByRole("button", { name: "Verify published example" }).click();
  const status = page.locator("[data-policy-status]");
  await expect(status).toHaveAttribute("data-state", "held");
  await expect(status).toContainText("Signature verified");
  await expect(page.locator("[data-policy-step='signature']")).toHaveAttribute("data-state", "verified");
  await expect(page.locator("[data-policy-step='receipt']")).toHaveAttribute("data-state", "evidenced");
  await expect(page.locator("[data-policy-field='subject']")).toHaveText("bounder-alpha");
  expect(errors).toEqual([]);
});

test("mobile pages do not overflow and retain usable controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/simulator.html?webgl=off", "/contact.html", "/privacy.html", "/terms.html", "/404.html"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} overflows the mobile viewport`).toBeLessThanOrEqual(1);
    await expect(page.locator("h1")).toHaveCount(1);
    if (path.includes("simulator.html")) {
      await expect(page.getByRole("button", { name: "Verify published example" })).toBeVisible();
    }
  }
});

test("interior pages have no detectable accessibility violations", async ({ page }) => {
  // Audit 2026-07: axe previously ran only on the homepage and simulator, so
  // contrast/focus regressions on interior pages went unguarded.
  test.setTimeout(90_000);
  for (const path of ["/contact.html", "/privacy.html", "/terms.html", "/404.html"]) {
    const errors = collectErrors(page);
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${path} has accessibility violations`).toEqual([]);
    expect(errors, `${path} logged console errors`).toEqual([]);
  }
});

test("primary and footer navigation are consistent across pages", async ({ page }) => {
  // Audit 2026-07: every page carried a different nav set. Interior headers and
  // all footers are now canonical; this pins them.
  const interior = ["/simulator.html?webgl=off", "/contact.html", "/privacy.html", "/terms.html"];
  // Compare lowercased: CSS text-transform is styling, not content.
  const expectedHeader = ["architecture", "applications", "simulator", "safety", "contact"];
  const expectedFooter = ["terms", "privacy", "contact", "github"];
  for (const path of interior) {
    await page.goto(path);
    const header = (await page.locator("nav.header-nav a").allInnerTexts()).map((s) => s.trim().toLowerCase());
    expect(header, `${path} header nav diverges`).toEqual(expectedHeader);
  }
  for (const path of ["/", ...interior]) {
    await page.goto(path);
    const footer = (await page.locator("nav.secondary-nav a").allInnerTexts()).map((s) => s.trim().toLowerCase());
    expect(footer, `${path} footer nav diverges`).toEqual(expectedFooter);
  }
});
